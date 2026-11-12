import { useState } from 'react';
import { formatDate } from '@enticra/core';
import { Icon, Loading, Modal, PageHead, Seg, useApp, useConfirm, useLoad } from '../ui';
import { BusMap } from './Office';
import { BotChat, Gallery, PtmBooking } from './Engage';
import { GuidanceReport, REQS, type Req } from './People';
import { Letterhead, PrintModal, QR, Table, Tabs, day, dayLabel, inr, useDemo } from './kit';

export function ParentFees() {
  const { toast, session } = useApp();
  const [paid, setPaid] = useDemo<boolean>('parent-paid', false);
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<(string | number)[] | null>(null);
  const kids = session.children;
  return (
    <>
      <PageHead eyebrow="Fees" title="Fees and receipts" lede="Pay by UPI from here or from the WhatsApp link. Receipts arrive on WhatsApp straight away." />
      <div className="grid cols-2">
        {kids.map((k, i) => (
          <div key={k.id} className="card stack">
            <div className="row between"><b>{k.name}</b>{i === 0 && !paid ? <span className="pill bad">Due {dayLabel(12)}</span> : <span className="pill ok">Paid up</span>}</div>
            <div className="stat"><span className="eyebrow">Term 2</span><span className="value">{i === 0 && !paid ? inr(18500) : inr(0)}</span><span className="foot">Tuition {inr(14000)} · Transport {inr(3600)} · Lab {inr(900)}</span></div>
            {i === 0 && !paid && <button className="btn" onClick={() => setOpen(true)}><Icon name="rupee" size={18} />Pay {inr(18500)} by UPI</button>}
          </div>
        ))}
      </div>
      <div className="card"><div className="card-head"><h3>Receipts</h3></div><Table head={['Receipt', 'For', 'Amount', 'Paid', '']} rows={[...(paid ? [['R-2026-0431', 'Term 2', 18500, dayLabel(0)]] : []), ['R-2026-0417', 'Term 1', 18500, dayLabel(-110)], ['R-2026-0098', 'Admission and books', 13800, dayLabel(-150)]].map((r) => [<b key="r" className="num">{r[0]}</b>, r[1], <span key="a" className="num">{inr(r[2] as number)}</span>, r[3], <button key="d" className="btn sm ghost" onClick={() => setReceipt(r)}><Icon name="file" size={16} />View receipt</button>])} /></div>
      <PrintModal title={`Receipt ${receipt?.[0] ?? ''}`} open={!!receipt} onClose={() => setReceipt(null)}>
        {receipt && <Letterhead title={`Fee receipt · ${receipt[0]}`}>
          <div className="facts"><div><b>Received from</b>{session.user.name}</div><div><b>Student</b>{kids[0]?.name}</div><div><b>Date</b>{receipt[3]}</div><div><b>Paid by</b>UPI</div></div>
          <table><thead><tr><th>For</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody><tr><td>{receipt[1]}</td><td style={{ textAlign: 'right' }}>{inr(receipt[2] as number)}</td></tr><tr style={{ fontWeight: 700 }}><td>Total</td><td style={{ textAlign: 'right' }}>{inr(receipt[2] as number)}</td></tr></tbody></table>
          <div className="sig"><span>Accountant</span><span>Computer-generated receipt</span></div>
        </Letterhead>}
      </PrintModal>
      <Modal open={open} onClose={() => setOpen(false)} title="Pay by UPI">
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <QR text="upi-term2" size={160} />
          <b style={{ fontSize: '1.4rem' }}>{inr(18500)}</b>
          <span className="muted small">Scan with any UPI app, or tap to open GPay, PhonePe or Paytm on this phone. Sample only: no money moves.</span>
          <span className="dim small">In the live portal the payment is confirmed by the bank, never by a button. Nothing is marked paid until the money arrives.</span>
          <div className="row" style={{ justifyContent: 'center' }}><button className="btn" onClick={() => { setPaid(true); setOpen(false); toast('Payment received. Receipt R-2026-0431 sent on WhatsApp.'); }}>Simulate a successful payment</button><button className="btn ghost" onClick={() => setOpen(false)}>Not now</button></div>
        </div>
      </Modal>
    </>
  );
}

export function ParentBus() {
  return (
    <>
      <PageHead eyebrow="School bus" title="Where is the bus?" lede="You get a WhatsApp message when the bus is 5 minutes from your stop, and when your child gets off at school." />
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="card stack"><div className="row between"><b>Route 4 · TN 38 AB 1234</b><span className="pill accent"><span className="dot" />6 min away</span></div><BusMap /></div>
        <div className="card"><div className="tl">{[['6:55', 'Left the depot'], ['7:12', 'Gandhi Park stop'], ['7:20', 'Market stop'], ['7:31', 'Your stop (expected)'], ['7:52', 'School']].map(([t, s], i) => <div key={t}><span className="num dim">{t}</span><span style={{ fontWeight: i === 3 ? 700 : undefined }}>{s}</span></div>)}</div><p className="dim small" style={{ marginTop: 10 }}>Driver: Mr. Selvam · Attendant: Mrs. Rani</p></div>
      </div>
    </>
  );
}

export function ParentConnect() {
  const { api, toast, session } = useApp();
  const [tab, setTab] = useState<'ptm' | 'leave' | 'reeval' | 'bot'>('ptm');
  const [leave, setLeave] = useState({ child: session.children[0]?.id ?? '', from: '', days: '1', reason: '' });
  const [reeval, setReeval] = useState({ child: session.children[0]?.id ?? '', paper: '', q: '', note: '' });
  const results = useLoad(() => (reeval.child ? api.getStudent(reeval.child) : Promise.resolve(null)), [reeval.child]);
  const papers = (results.data?.results ?? []).filter((r) => r.total !== null);
  const [ask, confirmEl] = useConfirm();
  const [reqs, setReqs] = useDemo<Req[]>('requests', REQS);
  const kid = (id: string) => session.children.find((c) => c.id === id) ?? session.children[0];
  const add = (r: Omit<Req, 'id' | 'who' | 'when' | 'status' | 'via' | 'cls' | 'student'> & { childId: string }) => { const c = kid(r.childId); setReqs([{ id: `r${Date.now()}`, kind: r.kind, student: c.name, cls: c.classId.replace(/^cls_s\d_/, '').replace(/(\d+)([a-z])/, (_m, g, x) => `${g}-${x.toUpperCase()}`), detail: r.detail, who: session.user.name, via: 'Parent page', when: dayLabel(0), status: 'Pending' }, ...reqs]); };
  const mine = reqs.filter((r) => r.who === session.user.name);
  const withdraw = async (r: Req) => {
    if (!(await ask({ title: `Withdraw this ${r.kind.toLowerCase()} request?`, body: `“${r.detail}” will be taken back. The school sees that you withdrew it.`, confirm: 'Withdraw', danger: true }))) return;
    setReqs(reqs.filter((x) => x.id !== r.id));
    toast('Request withdrawn.');
  };
  const days = Number(leave.days);
  const leaveOk = !!leave.from && Number.isInteger(days) && days >= 1 && days <= 30 && !!leave.reason.trim();
  const reevalDup = mine.some((r) => r.kind === 'Re-evaluation' && r.status === 'Pending' && r.detail.startsWith(`${reeval.paper}, ${reeval.q}:`));
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Talk to the school" title="Meetings and requests" lede="Book a PTM slot, apply for leave, ask for a paper to be re-checked, or ask the WhatsApp bot." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'ptm', label: 'PTM booking' }, { value: 'leave', label: 'Leave' }, { value: 'reeval', label: 'Re-check a paper' }, { value: 'bot', label: 'Ask the bot' }]} />
      {tab === 'ptm' && <PtmBooking />}
      {tab === 'leave' && (
        <form className="card stack" style={{ gap: 12, maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); if (!leaveOk) return; add({ kind: 'Leave', childId: leave.child, detail: `${days} day${days > 1 ? 's' : ''} from ${formatDate(leave.from)}: ${leave.reason.trim()}` }); toast('Leave request sent to the class advisor. It appears under Your requests below.'); setLeave({ ...leave, from: '', days: '1', reason: '' }); }}>
          {session.children.length > 1 && <div className="field"><span className="label">Child</span><Seg label="Child" value={leave.child} onChange={(v) => setLeave({ ...leave, child: v })} options={session.children.map((c) => ({ value: c.id, label: c.name.split(' ')[0] }))} /></div>}
          <div className="grid cols-2" style={{ gap: 12 }}><div className="field"><label htmlFor="lv-f">From</label><input id="lv-f" type="date" className="input" min={day(-7)} required value={leave.from} onChange={(e) => setLeave({ ...leave, from: e.target.value })} /></div><div className="field"><label htmlFor="lv-d">Number of school days</label><input id="lv-d" type="number" className="input" min={1} max={30} required value={leave.days} onChange={(e) => setLeave({ ...leave, days: e.target.value })} /></div></div>
          <div className="field"><label htmlFor="lv-r">Reason</label><textarea id="lv-r" className="input" placeholder="Fever, family function…" value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} /></div>
          <button className="btn" disabled={!leaveOk}>Send to class advisor</button>
          <span className="dim small">You can also just reply to the absence message on WhatsApp.</span>
        </form>
      )}
      {tab === 'reeval' && (
        <form className="card stack" style={{ gap: 12, maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); if (!reeval.paper || !reeval.q || !reeval.note.trim() || reevalDup) return; add({ kind: 'Re-evaluation', childId: reeval.child, detail: `${reeval.paper}, ${reeval.q}: ${reeval.note.trim()}` }); toast('Re-check request sent. It appears under Your requests below.'); setReeval({ ...reeval, q: '', note: '' }); }}>
          {session.children.length > 1 && <div className="field"><span className="label">Child</span><Seg label="Child" value={reeval.child} onChange={(v) => setReeval({ ...reeval, child: v, paper: '', q: '' })} options={session.children.map((c) => ({ value: c.id, label: c.name.split(' ')[0] }))} /></div>}
          <div className="field"><label htmlFor="re-p">Paper</label><select id="re-p" className="input" required value={reeval.paper} onChange={(e) => setReeval({ ...reeval, paper: e.target.value })}><option value="">Choose a marked paper</option>{papers.map((r) => { const v = `${r.name}, ${r.subject}`; return <option key={r.examId} value={v}>{r.name} · {r.subject} · {r.total} / {r.max}</option>; })}</select></div>
          <div className="field"><span className="label">Question</span><Seg label="Question" value={reeval.q} onChange={(v) => setReeval({ ...reeval, q: v })} options={['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Whole paper'].map((q) => ({ value: q, label: q }))} /></div>
          <div className="field"><label htmlFor="re-n">What should be checked?</label><textarea id="re-n" className="input" value={reeval.note} onChange={(e) => setReeval({ ...reeval, note: e.target.value })} /></div>
          {reevalDup && <span className="small" style={{ color: 'var(--warn)' }}>You already asked about this question. The school will reply to that request.</span>}
          <button className="btn" disabled={!reeval.paper || !reeval.q || !reeval.note.trim() || reevalDup}>Ask for a re-check</button>
        </form>
      )}
      {tab === 'bot' && <BotChat />}
      {(tab === 'leave' || tab === 'reeval') && <MyRequests list={mine} onWithdraw={withdraw} />}
    </>
  );
}

export function ParentFuture() {
  const { session } = useApp();
  const tenth = session.children.find((c) => c.classId.includes('10')) ?? session.children[0];
  return <><PageHead eyebrow="Future pathways" title={`${tenth.name.split(' ')[0]}’s 11th group guidance`} lede="Made from marks, interests and activities, and checked by the school counsellor. It suggests more than one path." /><GuidanceReport studentId={tenth.id} /></>;
}

export function MyRequests({ list, onWithdraw }: { list: Req[]; onWithdraw?: (r: Req) => void }) {
  return (
    <div className="card">
      <div className="card-head"><h3>Your requests</h3><span className="dim small">The school replies here and on WhatsApp</span></div>
      <Table head={['Request', 'For', 'Details', 'Sent', 'Status', '']} empty="Requests you send appear here." rows={list.map((r) => [<b key="k">{r.kind}</b>, r.student, <span key="d" className="small">{r.detail}{r.reply && <span className="dim" style={{ display: 'block' }}>School: {r.reply}</span>}</span>, r.when, <span key="s" className={`pill ${r.status === 'Pending' ? 'warn' : r.status === 'Declined' ? 'bad' : 'ok'}`}>{r.status === 'Pending' ? 'Waiting for school' : r.status}</span>, r.status === 'Pending' && onWithdraw ? <button key="w" className="btn sm quiet" onClick={() => onWithdraw(r)}>Withdraw</button> : <span key="w" />])} />
    </div>
  );
}

export function ParentPrivacy() {
  const { api, toast, session } = useApp();
  const [tab, setTab] = useState<'data' | 'gallery'>('data');
  const [reqs, setReqs] = useDemo<Req[]>('requests', REQS);
  const [childId, setChildId] = useState(session.children[0]?.id ?? '');
  const [showData, setShowData] = useState(false);
  const [ask, setAsk] = useState<null | 'correct' | 'delete'>(null);
  const [note, setNote] = useState('');
  const child = session.children.find((c) => c.id === childId) ?? session.children[0];
  const data = useLoad(() => (showData && child ? api.getStudent(child.id) : Promise.resolve(null)), [showData, childId]);
  const mine = reqs.filter((r) => r.who === session.user.name && r.kind === 'Data request');
  const [confirm, confirmEl] = useConfirm();
  const withdraw = async (r: Req) => {
    if (!(await confirm({ title: 'Withdraw this request?', body: `“${r.detail}” will be taken back.`, confirm: 'Withdraw', danger: true }))) return;
    setReqs(reqs.filter((x) => x.id !== r.id));
    toast('Request withdrawn.');
  };
  const submit = () => {
    setReqs([{ id: `r${Date.now()}`, kind: 'Data request', student: child.name, cls: '', detail: ask === 'delete' ? `Delete ${child.name.split(' ')[0]}’s data${note ? `: ${note}` : ''}` : `Correct: ${note}`, who: session.user.name, via: 'Parent page', when: dayLabel(0), status: 'Pending' }, ...reqs]);
    toast(ask === 'delete' ? 'Deletion request recorded. The school must reply within 7 days.' : 'Correction request sent to the office.');
    setAsk(null); setNote('');
  };
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Your data" title="Your child’s data, photos and consent" lede="See what the school holds, correct it, download it or ask for it to be deleted. Choose what you agree to." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'data', label: 'Data and consent' }, { value: 'gallery', label: 'Event photos' }]} />
      {tab === 'data' && (
        <>
          {session.children.length > 1 && <Seg label="Child" value={childId} onChange={setChildId} options={session.children.map((c) => ({ value: c.id, label: c.name.split(' ')[0] }))} />}
          <div className="grid cols-2">
            <div className="card stack"><h3>What the school holds</h3><div className="list">{['Name, date of birth, EMIS number', 'Parent names and mobile numbers', 'Attendance and marks', 'Answer scripts and AI marking reasons', 'Activities, interests and teacher notes', 'Health record (school nurse only)'].map((x) => <div key={x}>{x}</div>)}</div></div>
            <div className="card stack" style={{ gap: 10 }}>
              <h3>Your choices</h3>
              <button className="btn ghost" onClick={() => setShowData(true)}><Icon name="download" size={18} />See and download all data</button>
              <button className="btn ghost" onClick={() => setAsk('correct')}><Icon name="pen" size={18} />Ask for a correction</button>
              <button className="btn ghost" onClick={() => setAsk('delete')}><Icon name="x" size={18} />Ask for deletion</button>
              <span className="dim small">Consent recorded for {session.children.map((c) => c.name.split(' ')[0]).join(' and ')}: WhatsApp updates, event photos, AI correction. Stored in India.</span>
            </div>
          </div>
          <MyRequests list={mine} onWithdraw={withdraw} />
        </>
      )}
      {tab === 'gallery' && <Gallery />}
      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask === 'delete' ? 'Ask for deletion' : 'Ask for a correction'}>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (ask === 'correct' && !note.trim()) return; submit(); }}>
          {ask === 'delete' && <p className="muted small">The school will delete {child?.name.split(' ')[0]}’s data except what the law requires it to keep (admission register, TC). It must reply within 7 days.</p>}
          <div className="field"><label htmlFor="pv-n">{ask === 'delete' ? 'Reason (optional)' : 'What is wrong, and what should it be?'}</label><textarea id="pv-n" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={ask === 'delete' ? '' : 'Date of birth should be 21 Mar 2011'} /></div>
          <button className="btn">{ask === 'delete' ? 'Send deletion request' : 'Send correction'}</button>
        </form>
      </Modal>
      <PrintModal title={`All data held for ${child?.name ?? ''}`} open={showData} onClose={() => setShowData(false)}>
        {data.data ? <Letterhead title={`Data held for ${data.data.student.name}`}>
          <div className="facts"><div><b>Class</b>{data.data.classLabel} · Roll {data.data.student.rollNo}</div><div><b>EMIS no.</b>{data.data.student.emis}</div><div><b>Date of birth</b>{formatDate(data.data.student.dob)}</div><div><b>Parent</b>{data.data.student.guardian.name} · {data.data.student.guardian.phone}</div><div><b>WhatsApp consent</b>{data.data.student.consent.whatsapp ? 'Given' : 'Not given'}</div><div><b>Attendance</b>{data.data.attendance.pct}% · {data.data.attendance.absent.length} days absent</div></div>
          <table><thead><tr><th>Test</th><th>Subject</th><th style={{ textAlign: 'right' }}>Marks</th></tr></thead><tbody>{data.data.results.map((r) => <tr key={r.examId}><td>{r.name}</td><td>{r.subject}</td><td style={{ textAlign: 'right' }}>{r.total === null ? '–' : `${r.total} / ${r.max}`}</td></tr>)}</tbody></table>
          <div><b style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.07em', color: '#4a6a70' }}>Activities and interests</b><p>{[...data.data.student.activities.map((a) => a.title), ...data.data.student.interests].join(', ') || 'None recorded'}</p></div>
          <div><b style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.07em', color: '#4a6a70' }}>Teacher observations</b>{data.data.student.observations.length ? data.data.student.observations.map((o, i) => <p key={i}>{o.date}: {o.text}</p>) : <p>None recorded</p>}</div>
        </Letterhead> : <Loading />}
      </PrintModal>
    </>
  );
}
