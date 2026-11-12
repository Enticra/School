import { useEffect, useState } from 'react';
import { formatDate, isoDate, type LeaveKind, type StaffMark } from '@enticra/core';
import { Icon, Loading, Modal, PageHead, Seg, initials, useAction, useApp, useConfirm, useLoad } from '../ui';
import { Stats, Table, Tabs } from './kit';

const MARK: Record<StaffMark, { label: string; tone: string }> = { P: { label: 'Present', tone: 'ok' }, A: { label: 'Absent', tone: 'bad' }, L: { label: 'On leave', tone: 'warn' }, OD: { label: 'On duty', tone: 'accent' } };
const NEXT: Record<StaffMark, StaffMark> = { P: 'A', A: 'L', L: 'OD', OD: 'P' };
const KINDS: LeaveKind[] = ['Casual', 'Sick', 'Earned', 'On duty'];
const ALLOWED: Record<LeaveKind, number | null> = { Casual: 12, Sick: 10, Earned: 15, 'On duty': null };
const daysText = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- principal: staff attendance

export function StaffAttendance() {
  const { api, go } = useApp();
  const [tab, setTab] = useState<'day' | 'month'>('day');
  const [date, setDate] = useState(isoDate(new Date()));
  const [month, setMonth] = useState(isoDate(new Date()).slice(0, 7));
  const day = useLoad(() => api.getStaffAttendance(date), [date]);
  const mon = useLoad(() => api.staffAttendanceMonth(month), [month]);
  const leave = useLoad(() => api.listLeave(), []);
  const { run, busy } = useAction();
  const [marks, setMarks] = useState<Record<string, StaffMark>>({});
  useEffect(() => { if (day.data) setMarks(Object.fromEntries(day.data.staff.map((s) => [s.id, (s.mark ?? 'P') as StaffMark]))); }, [day.data]);
  if (!day.data || !mon.data) return <Loading />;
  const d = day.data;
  const count = (m: StaffMark) => Object.values(marks).filter((x) => x === m).length;
  const pending = (leave.data ?? []).filter((l) => l.status === 'Pending').length;
  const sunday = new Date(`${date}T12:00:00`).getDay() === 0;
  return (
    <>
      <PageHead eyebrow="Staff" title="Staff attendance" lede="Mark every teacher present, absent, on leave or on duty each morning. Approved leave is filled in for you. Absent teachers’ periods can be covered from Timetable." >
        {pending > 0 && <button className="btn ghost" onClick={() => go({ page: 'requests' })}>{pending} leave request{pending > 1 ? 's' : ''} waiting</button>}
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'day', label: 'Daily register' }, { value: 'month', label: 'Monthly summary' }]} />
      {tab === 'day' && (
        <>
          <Stats items={[
            { label: 'Staff', value: d.staff.length },
            { label: 'Present', value: count('P') + count('OD'), foot: count('OD') ? `${count('OD')} on duty outside school` : undefined },
            { label: 'Absent', value: count('A'), tone: count('A') ? 'bad' : undefined },
            { label: 'On leave', value: count('L') },
          ]} />
          <div className="card stack" style={{ gap: 12 }}>
            <div className="card-head" style={{ margin: 0 }}>
              <div className="row"><label htmlFor="sa-d" className="small">Date</label><input id="sa-d" type="date" className="input" style={{ width: 170 }} max={isoDate(new Date())} value={date} onChange={(e) => setDate(e.target.value || isoDate(new Date()))} /></div>
              <span className="dim small">{d.record ? `Saved by ${d.record.markedBy} at ${new Date(d.record.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'Not marked yet. Tap a mark to change it, then save.'}</span>
            </div>
            {sunday ? <div className="empty">Sunday: no register.</div> : (
              <>
                <Table head={['Teacher', 'Mark', 'Leave']} rows={d.staff.map((s) => {
                  const m = marks[s.id] ?? 'P';
                  return [
                    <div key="n" className="row" style={{ flexWrap: 'nowrap' }}><span className="avatar">{initials(s.name)}</span><div><b>{s.name}</b><div className="dim small">{s.title}</div></div></div>,
                    <button key="m" type="button" className={`pill ${MARK[m].tone}`} style={{ border: 0, cursor: 'pointer', font: 'inherit' }} aria-label={`${s.name}: ${MARK[m].label}. Change`} onClick={() => setMarks({ ...marks, [s.id]: NEXT[m] })}>{MARK[m].label}</button>,
                    s.leave ? <span key="l" className="small">{s.leave}</span> : <span key="l" className="dim">–</span>,
                  ];
                })} />
                <div className="row"><button className="btn" disabled={busy} onClick={() => void run(() => api.markStaffAttendance(date, marks), (r) => `Saved for ${formatDate(r.date)}: ${r.present} present, ${r.absent} absent, ${r.leave} on leave or duty.`)}><Icon name="check" size={18} />{d.record ? 'Save changes' : 'Save register'}</button>
                  {count('A') > 0 && <button className="btn ghost" onClick={() => go({ page: 'timetable' })}>Arrange substitutes</button>}</div>
              </>
            )}
          </div>
        </>
      )}
      {tab === 'month' && (
        <div className="card stack" style={{ gap: 12 }}>
          <div className="card-head" style={{ margin: 0 }}>
            <div className="row"><label htmlFor="sa-m" className="small">Month</label><input id="sa-m" type="month" className="input" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value || month)} /></div>
            <span className="dim small">{mon.data.days} working days marked</span>
          </div>
          <Table head={['Teacher', 'Present', 'On duty', 'On leave', 'Absent', 'Attendance']} empty="No register marked this month." rows={mon.data.days ? mon.data.rows.map((r) => [
            <b key="n">{r.name}</b>, <span key="p" className="num">{r.P}</span>, <span key="o" className="num">{r.OD}</span>, <span key="l" className="num">{r.L}</span>,
            r.A ? <span key="a" className="pill bad">{r.A}</span> : <span key="a" className="num">0</span>, <b key="t" className="num" style={r.pct !== null && r.pct < 90 ? { color: 'var(--bad)' } : undefined}>{r.pct === null ? '–' : `${r.pct}%`}</b>,
          ]) : []} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- principal: staff leave

export function StaffLeave() {
  const { api } = useApp();
  const list = useLoad(() => api.listLeave(), []);
  const { run, busy } = useAction();
  const [status, setStatus] = useState('Pending');
  const [declining, setDeclining] = useState<null | { id: string; name: string; reply: string }>(null);
  if (!list.data) return <Loading />;
  const rows = list.data.filter((l) => status === 'all' || l.status === status);
  const n = (s: string) => list.data!.filter((l) => l.status === s).length;
  return (
    <>
      <PageHead eyebrow="Staff" title="Staff leave" lede="Leave that teachers apply for. Approved leave is marked in staff attendance on those days. Leave and other requests from parents go to each class advisor." />
      <Stats items={[{ label: 'Waiting for you', value: n('Pending'), tone: n('Pending') ? 'bad' : undefined }, { label: 'Approved', value: n('Approved') }, { label: 'Declined', value: n('Declined') }]} />
      <Seg label="Status" value={status} onChange={setStatus} options={[{ value: 'Pending', label: `Waiting (${n('Pending')})` }, { value: 'Approved', label: 'Approved' }, { value: 'Declined', label: 'Declined' }, { value: 'all', label: 'All' }]} />
      <div className="card">
        <Table head={['Teacher', 'Leave', 'Dates', 'Reason', 'Used this year', '']} empty="Nothing here." rows={rows.map((l) => [
          <b key="n">{l.name}</b>, `${l.kind}, ${daysText(l.days)}`, <span key="d" className="small">{formatDate(l.dates[0])}{l.days > 1 ? ` to ${formatDate(l.dates.at(-1)!)}` : ''}</span>,
          <span key="r" className="small">{l.reason}{l.reply && <span className="dim" style={{ display: 'block' }}>Reply: {l.reply}</span>}</span>,
          <span key="u" className="small num">{ALLOWED[l.kind] ? `${l.usedThisYear} of ${ALLOWED[l.kind]} days` : `${l.usedThisYear} days`}</span>,
          l.status === 'Pending' ? <span key="a" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <button className="btn sm" disabled={busy} aria-label={`Approve ${l.name}’s leave`} onClick={() => void run(() => api.decideLeave(l.id, true), (r) => `${r.name}’s leave approved. It shows in staff attendance on those days.`)}>Approve</button>
            <button className="btn sm ghost" aria-label={`Decline ${l.name}’s leave`} onClick={() => setDeclining({ id: l.id, name: l.name, reply: '' })}>Decline</button>
          </span> : <span key="a" className={`pill ${l.status === 'Approved' ? 'ok' : l.status === 'Declined' ? 'bad' : ''}`}>{l.status}</span>,
        ])} />
      </div>
      <Modal open={!!declining} onClose={() => setDeclining(null)} title={declining ? `Decline ${declining.name}’s leave?` : ''}>
        {declining && (
          <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.decideLeave(declining.id, false, declining.reply), (r) => `${r.name}’s leave declined. They see your reason.`)) setDeclining(null); }}>
            <div className="field"><label htmlFor="lv-r">Reason the teacher will see</label><textarea id="lv-r" className="input" rows={2} value={declining.reply} onChange={(e) => setDeclining({ ...declining, reply: e.target.value })} placeholder="For example: exams that week; please take the following Saturday." /></div>
            <div className="row"><button className="btn danger" disabled={busy || !declining.reply.trim()}>Decline</button><button type="button" className="btn ghost" onClick={() => setDeclining(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- teacher: my leave

export function MyLeave() {
  const { api } = useApp();
  const list = useLoad(() => api.listLeave(), []);
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [f, setF] = useState({ kind: 'Casual' as LeaveKind, from: '', days: '1', reason: '' });
  if (!list.data) return <Loading />;
  const used = (k: LeaveKind) => list.data!.filter((l) => l.kind === k && l.status === 'Approved').reduce((n, l) => n + l.days, 0);
  const apply = async () => { if (await run(() => api.applyLeave({ ...f, days: Number(f.days) }), (l) => `${l.kind} leave asked for ${daysText(l.days)} from ${formatDate(l.from)}. The principal decides.`)) setF({ ...f, from: '', days: '1', reason: '' }); };
  const pending = list.data.filter((l) => l.status === 'Pending').length;
  const left = (k: LeaveKind) => (ALLOWED[k] ?? 0) - used(k);
  return (
    <div className="stack" style={{ gap: 16 }}>
      {confirmEl}
      <Stats items={[
        ...KINDS.filter((k) => ALLOWED[k]).map((k) => ({ label: `${k} leave left`, value: `${left(k)} of ${ALLOWED[k]}`, foot: `${daysText(used(k))} used this year`, tone: left(k) <= 2 ? 'bad' as const : undefined })),
        { label: 'Waiting for the principal', value: pending, foot: pending ? 'You can withdraw these below' : 'Nothing waiting' },
      ]} />
      <div className="card stack" style={{ gap: 12 }}>
        <h2>Apply for leave</h2>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void apply(); }}>
          <div className="grid cols-4" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="ml-k">Kind</label><select id="ml-k" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LeaveKind })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
            <div className="field"><label htmlFor="ml-f">From</label><input id="ml-f" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
            <div className="field"><label htmlFor="ml-d">Days</label><input id="ml-d" type="number" min={1} max={30} className="input" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>
            <div className="field"><label htmlFor="ml-r">Reason</label><input id="ml-r" className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="For example: family function" /></div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <span className="dim small">{ALLOWED[f.kind] != null && Number(f.days) > left(f.kind) ? <b style={{ color: 'var(--bad)' }}>This is more than the {left(f.kind)} {f.kind.toLowerCase()} days you have left. </b> : null}Sundays are skipped when counting days. Substitutes can cover your periods once the principal approves.</span>
            <button className="btn" disabled={busy || !f.from || !f.reason.trim()}>Send to the principal</button>
          </div>
        </form>
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        <h2>My requests</h2>
        <Table head={['Leave', 'Dates', 'Days', 'Status', '']} empty="You have not asked for leave this year." rows={list.data.map((l) => [
          <span key="k"><b>{l.kind}</b><span className="dim small" style={{ display: 'block' }}>{l.reason}</span></span>,
          <span key="d" className="small">{formatDate(l.dates[0])}{l.days > 1 ? ` to ${formatDate(l.dates.at(-1)!)}` : ''}</span>,
          <span key="n" className="small">{daysText(l.days)}</span>,
          <span key="s"><span className={`pill ${l.status === 'Approved' ? 'ok' : l.status === 'Declined' ? 'bad' : l.status === 'Pending' ? 'warn' : ''}`}>{l.status}</span>{l.reply && <span className="dim small" style={{ display: 'block' }}>{l.reply}</span>}</span>,
          l.status === 'Pending' ? <button key="w" className="btn sm quiet" disabled={busy} onClick={async () => { if (await ask({ title: 'Withdraw this leave request?', body: 'The principal no longer sees it.', confirm: 'Withdraw', danger: true })) void run(() => api.withdrawLeave(l.id), 'Request withdrawn.'); }}>Withdraw</button> : <span key="w" />,
        ])} />
      </div>
    </div>
  );
}
