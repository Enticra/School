import { useState } from 'react';
import { Bar, Icon, Loading, Modal, PageHead, Seg, Switch, useApp, useConfirm, useLoad } from '../ui';
import { Letterhead, Stats, Table, Tabs, day, dayLabel, inr, pick, printDoc, saveDocument, useDemo, useRoster } from './kit';
import { MyLeave } from './StaffDesk';

// ---------------------------------------------------------------- requests inbox: leave, re-evaluation, data requests

export type Req = { id: string; kind: 'Leave' | 'Re-evaluation' | 'Data request'; who: string; student: string; cls: string; detail: string; via: string; when: string; status: 'Pending' | 'Approved' | 'Declined' | 'Done'; reply?: string; days?: number; age?: number; auto?: boolean };
export const REQS: Req[] = [
  { id: 'r1', kind: 'Leave', who: 'Mr. Kannan (father)', student: 'Ragul M', cls: '10-B', detail: '“Ragul has fever, he will not come today and tomorrow.” Replied to the absence message.', via: 'WhatsApp reply', when: dayLabel(0) + ', 8:41 am', status: 'Pending', days: 2, age: 0 },
  { id: 'r2', kind: 'Leave', who: 'Mrs. Kala (mother)', student: 'Dinesh K', cls: '9-A', detail: 'Family function, 3 days from ' + dayLabel(3) + '.', via: 'Parent page', when: dayLabel(-1), status: 'Pending', days: 3, age: 1 },
  { id: 'r3', kind: 'Re-evaluation', who: 'Mrs. P. Priya (mother)', student: 'Arun Kumar P', cls: '10-A', detail: 'Revision Test 1, Maths, Q4: “He wrote the formula and the unit, but got 3 of 5.”', via: 'Parent page', when: dayLabel(-1), status: 'Pending', age: 1 },
  { id: 'r4', kind: 'Re-evaluation', who: 'Harini K (student)', student: 'Harini K', cls: '10-A', detail: 'Unit Test 2, Science, Q7: diagram not counted.', via: 'Student app', when: dayLabel(-3), status: 'Approved', age: 3 },
  { id: 'r5', kind: 'Data request', who: 'Mr. Anand (father)', student: 'Abinaya S', cls: '10-A', detail: 'Correct the date of birth on record (12 Mar → 21 Mar 2011).', via: 'Parent page', when: dayLabel(-2), status: 'Pending', age: 2 },
  { id: 'r6', kind: 'Leave', who: 'Mrs. Sumathi (mother)', student: 'Swetha J', cls: '10-B', detail: 'Inter-school chess tournament, 1 day.', via: 'WhatsApp reply', when: dayLabel(-4), status: 'Approved', days: 1, age: 4 },
  { id: 'r7', kind: 'Leave', who: 'Mrs. Uma (mother)', student: 'Shalini R', cls: '10-B', detail: '“Shalini has a dental appointment, she will come after lunch.”', via: 'WhatsApp reply', when: dayLabel(0) + ', 7:55 am', status: 'Pending', days: 1, age: 0 },
  { id: 'r8', kind: 'Leave', who: 'Mr. Ganesan (father)', student: 'Surya N', cls: '10-B', detail: '“Surya is down with cold and cough today.” Replied to the absence message.', via: 'WhatsApp reply', when: dayLabel(0) + ', 9:02 am', status: 'Pending', days: 1, age: 0 },
  { id: 'r9', kind: 'Leave', who: 'Mrs. Bhuvana (mother)', student: 'Vignesh T', cls: '10-B', detail: 'Native place for a temple festival, 4 days from ' + dayLabel(6) + '.', via: 'Parent page', when: dayLabel(-1), status: 'Pending', days: 4, age: 1 },
  { id: 'r10', kind: 'Data request', who: 'Mrs. Malathi (mother)', student: 'Sandhya V', cls: '10-B', detail: 'New mobile number for WhatsApp messages.', via: 'Parent page', when: dayLabel(-3), status: 'Pending', age: 3 },
  { id: 'r11', kind: 'Re-evaluation', who: 'Saravanan P (student)', student: 'Saravanan P', cls: '10-B', detail: 'Revision Test 1, Maths, Q5: second method not given marks.', via: 'Student app', when: dayLabel(-2), status: 'Pending', age: 2 },
  { id: 'r12', kind: 'Leave', who: 'Mr. Saravanan (father)', student: 'Yamini L', cls: '10-B', detail: '“Yamini has a fever since last night.”', via: 'WhatsApp reply', when: dayLabel(-1) + ', 8:20 am', status: 'Pending', days: 2, age: 1 },
];

/** Short leave a parent gives when replying to the absence message: safe to approve without the teacher. */
const autoOk = (r: Req) => r.kind === 'Leave' && r.via === 'WhatsApp reply' && (r.days ?? 1) <= 2;
const GROUPS_OF: [Req['kind'], string][] = [['Leave', 'Leave'], ['Re-evaluation', 'Re-evaluations'], ['Data request', 'Record changes']];
const DECLINE_REASONS = ['Exams that week. Please choose other dates.', 'Please send a medical certificate for leave of more than 3 days.', 'Please meet the class advisor first.', 'The correction is right as marked; the step was missing.'];

/** Teachers: requests from the parents of the class they advise, and their own leave. Built for a busy morning: oldest first, bulk approve, and an auto-approve rule. */
export function Requests() {
  const { toast, api, session } = useApp();
  const classes = useLoad(() => api.listClasses(), []);
  const mine = (classes.data ?? []).filter((c) => c.classTeacherId === session.user.id).map((c) => c.label);
  const [tab, setTab] = useState<'students' | 'leave'>('students');
  const [reqs, setReqs] = useDemo<Req[]>('requests', REQS);
  const [rule, setRule] = useDemo<boolean>('requests-auto', false);
  const [kind, setKind] = useState<'all' | Req['kind']>('all');
  const [status, setStatus] = useState<'waiting' | 'decided' | 'all'>('waiting');
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<Req | null>(null);
  const [declining, setDeclining] = useState<Req | null>(null);
  const [reason, setReason] = useState('');
  const ofMine = reqs.filter((r) => mine.includes(r.cls));
  const list = ofMine.filter((r) => (kind === 'all' || r.kind === kind) && (status === 'all' || (status === 'waiting' ? r.status === 'Pending' : r.status !== 'Pending'))).sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
  const waiting = ofMine.filter((r) => r.status === 'Pending');
  const leaveWaiting = list.filter((r) => r.status === 'Pending' && r.kind === 'Leave');
  const set = (ids: string[], st: Req['status'], why?: string, auto = false) => setReqs(reqs.map((r) => (ids.includes(r.id) ? { ...r, status: st, reply: why, auto } : r)));
  const act = (id: string, st: Req['status'], why?: string) => {
    set([id], st, why);
    const r = reqs.find((x) => x.id === id)!;
    setPicked(picked.filter((x) => x !== id));
    if (st === 'Pending') return toast(`${r.kind} for ${r.student} is open again. The parent is told the earlier reply was withdrawn.`);
    toast(st === 'Approved' ? (r.kind === 'Re-evaluation' ? `Sent to the subject teacher with the AI marking reasons for ${r.student}.` : r.kind === 'Data request' ? `${r.student}’s record is updated. The parent was told.` : `${r.kind} approved. The parent was told on WhatsApp and attendance is marked as leave.`) : `${r.kind} declined. The parent was told on WhatsApp with your reason.`);
  };
  const bulk = () => { set(picked, 'Approved'); toast(`${picked.length} leave requests approved. Each parent was told on WhatsApp and the register shows leave.`); setPicked([]); };
  const turnOnRule = (on: boolean) => {
    setRule(on);
    if (!on) return toast('Auto-approve is off. Every request waits for you.');
    const hits = waiting.filter(autoOk).map((r) => r.id);
    if (hits.length) set(hits, 'Approved', undefined, true);
    toast(`Auto-approve is on.${hits.length ? ` ${hits.length} waiting requests matched and were approved.` : ''}`);
  };
  const overdue = waiting.filter((r) => (r.age ?? 0) >= 2).length;
  const age = (r: Req) => (r.age ?? 0) === 0 ? <span className="small">{r.when}</span> : <span className={`pill ${(r.age ?? 0) >= 2 ? 'bad' : 'warn'}`}>{r.age} day{(r.age ?? 0) > 1 ? 's' : ''} waiting</span>;
  return (
    <>
      <PageHead eyebrow="Requests" title="Leave and requests" lede="Requests from the parents of your class, grouped by type with the oldest first, and your own leave." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'students', label: `Student requests${mine.length ? ` · ${mine.join(', ')}` : ''}${waiting.length ? ` (${waiting.length})` : ''}` }, { value: 'leave', label: 'My leave' }]} />
      {tab === 'leave' && <MyLeave />}
      {tab === 'students' && !mine.length && <div className="card empty">Parents’ requests go to each class advisor. You are not a class advisor this year.</div>}
      {tab === 'students' && mine.length > 0 && (
        <div className="card stack" style={{ gap: 14 }}>
          <div className="card-head" style={{ margin: 0 }}>
            <div className="row">
              <Seg label="Status" value={status} onChange={(v) => { setStatus(v); setPicked([]); }} options={[{ value: 'waiting', label: `Waiting (${waiting.length})` }, { value: 'decided', label: 'Decided' }, { value: 'all', label: 'All' }]} />
              <label className="sr" htmlFor="rq-k">Type</label>
              <select id="rq-k" className="input" style={{ width: 'auto' }} value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPicked([]); }}><option value="all">All types</option><option>Leave</option><option>Re-evaluation</option><option value="Data request">Record changes</option></select>
            </div>
            <span className="small">{waiting.length ? <><b>{waiting.length} waiting</b>{overdue ? <span style={{ color: 'var(--bad)' }}> · {overdue} for 2 days or more</span> : null}</> : <span className="dim">All caught up</span>}</span>
          </div>
          <div className="row between" style={{ gap: 12, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)' }}>
            <span className="small"><b>Approve short sick leave automatically</b> <span className="dim">· 1 or 2 days, when a parent replies to the absence message{ofMine.some((r) => r.auto) ? ` · ${ofMine.filter((r) => r.auto).length} approved this way` : ''}</span></span>
            <Switch checked={rule} label="Approve short sick leave automatically" onChange={turnOnRule} />
          </div>
          {list.length === 0 && <div className="empty">{status === 'waiting' ? 'Nothing waiting. You are all caught up.' : 'No requests here.'}</div>}
          {GROUPS_OF.map(([k, title]) => {
            const items = list.filter((r) => r.kind === k);
            if (!items.length) return null;
            const pend = items.filter((r) => r.status === 'Pending');
            return (
              <section key={k} className="stack" style={{ gap: 0 }}>
                <div className="row between" style={{ padding: '6px 0' }}>
                  <h3 style={{ margin: 0 }}>{title} <span className="dim small">{pend.length ? `${pend.length} waiting` : `${items.length}`}</span></h3>
                  {k === 'Leave' && pend.length > 1 && <div className="row">
                    <button className="btn sm ghost" onClick={() => setPicked(picked.length === pend.length ? [] : pend.map((r) => r.id))}>{picked.length === pend.length ? 'Clear selection' : `Select all ${pend.length} leave`}</button>
                    <button className="btn sm" disabled={!picked.length} onClick={bulk}>Approve {picked.length || ''} selected</button>
                  </div>}
                  {k === 'Re-evaluation' && pend.length > 0 && <span className="dim small">Approving sends it to the subject teacher.</span>}
                </div>
                {items.map((r) => (
                  <div key={r.id} className="req">
                    {r.status === 'Pending' && r.kind === 'Leave' ? <input type="checkbox" aria-label={`Select ${r.student}’s leave`} checked={picked.includes(r.id)} onChange={() => setPicked(picked.includes(r.id) ? picked.filter((x) => x !== r.id) : [...picked, r.id])} /> : <span />}
                    <button type="button" className="req-body" onClick={() => setOpen(r)}>
                      <span className="row" style={{ gap: 8 }}><b>{r.student}</b>{r.days ? <span className="pill">{r.days} day{r.days > 1 ? 's' : ''}</span> : null}{r.status === 'Pending' ? age(r) : <span className={`pill ${r.status === 'Declined' ? 'warn' : 'ok'}`}>{r.auto ? 'Auto-approved' : r.status}</span>}</span>
                      <span className="req-detail">{r.detail}</span>
                      <span className="dim small">{r.who} · {r.via} · {r.when}</span>
                    </button>
                    <div className="row acts" style={{ flexWrap: 'nowrap', gap: 6 }}>
                      {r.status === 'Pending'
                        ? <><button className="btn sm" aria-label={`Approve ${r.student}’s ${r.kind.toLowerCase()}`} onClick={() => act(r.id, 'Approved')}>{r.kind === 'Re-evaluation' ? 'Send on' : 'Approve'}</button><button className="btn sm ghost" aria-label={`Decline ${r.student}’s ${r.kind.toLowerCase()}`} onClick={() => { setReason(''); setDeclining(r); }}>Decline</button></>
                        : <button className="btn sm quiet" onClick={() => act(r.id, 'Pending')}>Undo</button>}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.kind} for ${open.student}` : ''}>
        {open && <div className="stack" style={{ gap: 10 }}>
          <p>{open.detail}</p>
          <div className="dim small">{open.who} · {open.via} · {open.when}</div>
          {open.reply && <p className="small" style={{ color: 'var(--bad)' }}>Reason given: {open.reply}</p>}
          {open.status === 'Pending' && <div className="row"><button className="btn" onClick={() => { act(open.id, 'Approved'); setOpen(null); }}>{open.kind === 'Re-evaluation' ? 'Send to the subject teacher' : 'Approve'}</button><button className="btn ghost" onClick={() => { setReason(''); setDeclining(open); setOpen(null); }}>Decline</button></div>}
        </div>}
      </Modal>
      <Modal open={!!declining} onClose={() => setDeclining(null)} title={`Decline ${declining?.kind.toLowerCase() ?? ''} for ${declining?.student ?? ''}?`}>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (!reason.trim() || !declining) return; act(declining.id, 'Declined', reason.trim()); setDeclining(null); }}>
          <div className="row" style={{ gap: 6 }}>{DECLINE_REASONS.map((x) => <button key={x} type="button" className="btn sm quiet" onClick={() => setReason(x)}>{x}</button>)}</div>
          <div className="field"><label htmlFor="dec-r">Reason the parent will see</label><textarea id="dec-r" className="input" placeholder="Pick a reason above or write your own." value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <span className="dim small">A reason is required, so families always know why and what they can do next.</span>
          <button className="btn danger" disabled={!reason.trim()}>Decline and tell the parent</button>
        </form>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- career guidance

const GROUPS = [
  { key: 'bio', name: 'Maths–Biology', subjects: ['Maths', 'Science'], routes: 'Medicine (NEET), engineering (TNEA, JEE), allied health, pure sciences', interests: ['Science club', 'Biology', 'Helping people'] },
  { key: 'cs', name: 'Maths–Computer Science', subjects: ['Maths', 'Science', 'English'], routes: 'Engineering (TNEA, JEE), B.Sc. Computer Science, data and design careers', interests: ['Coding', 'Robotics', 'Chess'] },
  { key: 'com', name: 'Commerce–Computer Applications', subjects: ['Maths', 'English', 'Social Science'], routes: 'B.Com, CA and CMA, BBA, economics, law (CLAT)', interests: ['Business', 'Debate', 'Quiz'] },
  { key: 'arts', name: 'Humanities and Fine Arts', subjects: ['Tamil', 'English', 'Social Science'], routes: 'Design (NIFT, NID), fine arts, journalism, law (CLAT), civil services', interests: ['Drawing', 'Art', 'Music', 'Dance', 'Writing'] },
];

export function GuidanceReport({ studentId }: { studentId: string }) {
  const { api, toast, session } = useApp();
  const { data } = useLoad(() => api.getStudent(studentId), [studentId]);
  const [sent, setSent] = useDemo<string[]>('guidance-sent', []);
  const [asked, setAsked] = useDemo<string[]>('counsel-asked', []);
  const [confirm, confirmEl] = useConfirm();
  if (!data) return <Loading />;
  const bySubject: Record<string, number[]> = {};
  for (const r of data.results) if (r.pct !== null) (bySubject[r.subject] ??= []).push(r.pct);
  const avg = (s: string) => { const v = bySubject[s]; return v?.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 60; };
  const likes = [...data.student.interests, ...data.student.activities.map((a) => a.title)].join(' ').toLowerCase();
  const scored = GROUPS.map((g) => {
    const marks = g.subjects.reduce((t, s) => t + avg(s), 0) / g.subjects.length;
    const fit = g.interests.filter((i) => likes.includes(i.toLowerCase())).length;
    return { ...g, marks: Math.round(marks), score: Math.min(97, Math.round(marks * 0.7 + fit * 12 + 8)), fit };
  }).sort((a, b) => b.score - a.score);
  const first = data.student.name.split(' ')[0];
  const sentTo = sent.includes(studentId), booked = asked.includes(studentId);
  const canSend = session.user.role === 'principal' || session.user.role === 'teacher';
  return (
    <div className="split" style={{ alignItems: 'start' }}>
      {confirmEl}
      <Letterhead title={`Future pathways report · ${data.student.name}`}>
        <div className="facts">
          <div><b>Class</b>{data.classLabel}</div><div><b>Attendance</b>{data.attendance.pct}%</div>
          <div><b>Strongest subjects</b>{Object.keys(bySubject).sort((a, b) => avg(b) - avg(a)).slice(0, 2).join(', ') || '–'}</div>
          <div><b>Interests</b>{data.student.interests.join(', ') || 'Survey pending'}</div>
        </div>
        <table>
          <thead><tr><th>11th group</th><th style={{ textAlign: 'right' }}>Fit</th><th>Why</th></tr></thead>
          <tbody>{scored.map((g, i) => <tr key={g.key}><td><b>{g.name}</b>{i === 0 && <div style={{ fontSize: '.75rem', color: '#B4461A', fontWeight: 650 }}>Best fit</div>}</td><td style={{ textAlign: 'right' }} className="num">{g.score}%</td><td style={{ fontSize: '.84rem' }}>Marks in {g.subjects.join(', ')}: {g.marks}%. {g.fit ? `Matches interest in ${g.interests.filter((x) => likes.includes(x.toLowerCase())).join(', ')}.` : 'No matching activities yet.'}<div style={{ color: '#4a6a70' }}>Leads to: {g.routes}</div></td></tr>)}</tbody>
        </table>
        <p style={{ fontSize: '.9rem' }}>{first} has more than one good path. {scored[0].name} fits {first}’s marks and interests best today, and {scored[1].name} is a close second. Marks can still change before the board exam; we will update this report after the model exams.</p>
        <div className="sig"><span>Counsellor · Ms. A. Fernandez</span><span>Principal</span><span>Parent</span></div>
      </Letterhead>
      <div className="card stack">
        <h3>How this is made</h3>
        <p className="muted small">Marks by subject from every test, the yearly interest and aptitude survey, activities and teacher observations. A counsellor reviews every report before it goes out. It suggests several paths, never just one.</p>
        {canSend && sentTo && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { setSent(sent.filter((x) => x !== studentId)); toast('Marked as not sent. Any update you send replaces the earlier report.'); }}>Edit and resend</button>}
        {canSend && (sentTo ? <span className="pill ok">✓ Approved and sent to {data.student.guardian.name}</span> : <button className="btn" onClick={async () => { if (!(await confirm({ title: `Send ${data.student.name.split(' ')[0]}’s report to the parent?`, body: <>Confirm the counsellor has read it. {data.student.guardian.name} gets it as a PDF on WhatsApp. It shows several paths and says marks can still change; the family decides.</>, confirm: 'Counsellor reviewed, send' }))) return; setSent([...sent, studentId]); toast(`Report sent to ${data.student.guardian.name} as a PDF on WhatsApp.`); }}><Icon name="send" size={18} />Approve and send to parent</button>)}
        {booked ? <span className="pill ok">✓ Counselling requested · Ms. A. Fernandez will offer slots</span> : <button className="btn ghost" onClick={() => { setAsked([...asked, studentId]); toast('Counselling session requested. It appears in Counselling and health.'); }}><Icon name="calendar" size={18} />Book a counselling session</button>}
        <button className="btn ghost" onClick={() => void saveDocument(document.querySelector('main .report'), `Pathways report ${data.student.name}`, toast)}><Icon name="download" size={18} />Download report</button>
        <button className="btn ghost" onClick={() => printDoc(toast, '.report')}>Print or save as PDF</button>
      </div>
    </div>
  );
}

const ROUTES = [
  { exam: 'NEET UG', for: 'Medicine, dental, AYUSH', when: 'May', eligible: 'Maths–Biology' },
  { exam: 'TNEA', for: 'Engineering in Tamil Nadu (by 12th marks)', when: 'June', eligible: 'Maths group' },
  { exam: 'JEE Main', for: 'NITs, IIITs; JEE Advanced for IITs', when: 'Jan, Apr', eligible: 'Maths–Physics–Chemistry' },
  { exam: 'CLAT', for: 'National law universities', when: 'Dec', eligible: 'Any group' },
  { exam: 'NIFT / NID', for: 'Fashion and design', when: 'Feb', eligible: 'Any group' },
  { exam: 'CUET UG', for: 'Central universities', when: 'May', eligible: 'Any group' },
  { exam: 'Sports quota', for: 'State-level players, any college', when: 'With admissions', eligible: 'Certificates needed' },
];
const SCHOLARSHIPS = [
  { name: 'Pudhumai Penn', amount: 12000, for: 'Girls from government schools, ₹1,000 a month in college' },
  { name: 'National Means-cum-Merit (NMMS)', amount: 12000, for: 'Class 8 exam, ₹12,000 a year to class 12' },
  { name: 'Post-matric scholarship (BC/MBC)', amount: 10000, for: 'Family income under ₹2.5 lakh' },
  { name: 'INSPIRE (DST)', amount: 80000, for: 'Top 1% in 12th, pursuing natural sciences' },
];

export function Career() {
  const roster = useRoster().filter((s) => s.classLabel?.startsWith('10'));
  const [tab, setTab] = useState<'report' | 'routes' | 'scholarships'>('report');
  const [sel, setSel] = useState('');
  const id = sel || roster[0]?.id;
  return (
    <>
      <PageHead eyebrow="Future and career guidance" title="11th group and college guidance" lede="A pathways report for every 10th student from marks, aptitude, interests and activities, on the school letterhead, reviewed by a counsellor." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'report', label: '10th: group guidance' }, { value: 'routes', label: '12th: college routes' }, { value: 'scholarships', label: 'Scholarships' }]} />
      {tab === 'report' && (
        <>
          <div className="row"><select aria-label="Student" className="input" style={{ width: 'auto', minWidth: 240 }} value={id} onChange={(e) => setSel(e.target.value)}>{roster.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.classLabel}</option>)}</select><span className="dim small">{roster.length} reports · 14 sent, {Math.max(0, roster.length - 14)} awaiting counsellor review</span></div>
          {id ? <GuidanceReport studentId={id} /> : <Loading />}
        </>
      )}
      {tab === 'routes' && <div className="card"><Table head={['Route', 'Leads to', 'Exam month', 'Who can apply']} rows={ROUTES.map((r) => [<b key="e">{r.exam}</b>, r.for, r.when, r.eligible])} /></div>}
      {tab === 'scholarships' && <div className="card"><Table head={['Scholarship', 'Up to (per year)', 'Who it is for', 'Students matched']} rows={SCHOLARSHIPS.map((s, i) => [<b key="n">{s.name}</b>, <span key="a" className="num">{inr(s.amount)}</span>, s.for, <span key="m" className="pill ok">{[4, 9, 6, 2][i]} students</span>])} /></div>}
    </>
  );
}

// ---------------------------------------------------------------- counselling, health and special needs

export function Wellbeing() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'counselling' | 'health' | 'needs'>('counselling');
  const [slots, setSlots] = useDemo<string[]>('counsel-booked', ['Thu 11:00']);
  const [asked] = useDemo<string[]>('counsel-asked', []);
  const roster = useRoster();
  const [who, setWho] = useDemo<Record<string, string>>('counsel-who', { 'Thu 11:00': 'Gokul V' });
  const [pick, setPick] = useState<string | null>(null);
  const [pickName, setPickName] = useState('');
  const [confirm, confirmEl] = useConfirm();
  return (
    <>
      <PageHead eyebrow="Student wellbeing" title="Counselling, health and support plans" lede="Private to the counsellor, class advisor and parents. Every view is written to the audit log." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'counselling', label: 'Counselling' }, { value: 'health', label: 'Health records' }, { value: 'needs', label: 'Support plans' }]} />
      {tab === 'counselling' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card">
            <div className="card-head"><h2>This week · Ms. A. Fernandez</h2></div>
            <div className="grid cols-3" style={{ gap: 8 }}>
              {['Mon 10:00', 'Mon 2:00', 'Tue 11:00', 'Wed 10:00', 'Wed 3:00', 'Thu 11:00', 'Thu 2:00', 'Fri 10:00', 'Fri 12:00'].map((s) => {
                const taken = slots.includes(s);
                return <button key={s} className="opt" aria-pressed={taken} onClick={async () => {
                  if (!taken) { setPickName(''); setPick(s); return; }
                  if (await confirm({ title: `Cancel ${s} with ${who[s] ?? 'this student'}?`, body: 'The student and parent are told the session is cancelled and offered another slot.', confirm: 'Cancel session', danger: true })) { setSlots(slots.filter((x) => x !== s)); toast(`${s} cancelled.`); }
                }}>{s}<span className="dim small" style={{ marginLeft: 'auto' }}>{taken ? who[s] ?? 'Booked' : 'Free'}</span></button>;
              })}
            </div>
          </div>
          <div className="card stack"><h3>Referrals</h3><div className="list">{asked.map((id) => <div key={id}><b>{roster.find((r) => r.id === id)?.name ?? 'Student'}</b> <span className="pill accent">New</span><div className="muted small">Requested from the guidance report</div></div>)}{[['Gokul V', '10-A', 'Attendance down to 70%, quiet in class'], ['Lokesh P', '10-A', 'Exam stress, parent request'], ['Mohammed Asif', '10-A', 'Group choice: wants Arts, family wants Biology']].map(([n, c, r]) => <div key={n}><b>{n}</b> <span className="dim small">{c}</span><div className="muted small">{r}</div></div>)}</div></div>
        </div>
      )}
      {confirmEl}
      <Modal open={!!pick} onClose={() => setPick(null)} title={`Book ${pick ?? ''}`}>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (!pick || !pickName) return; setSlots([...slots, pick]); setWho({ ...who, [pick]: pickName }); toast(`${pick} booked for ${pickName}. Student and parent told on WhatsApp.`); setPick(null); }}>
          <div className="field"><span className="label">Student</span><select aria-label="Student" className="input" value={pickName} onChange={(e) => setPickName(e.target.value)}><option value="">Choose a student…</option>{roster.map((r) => <option key={r.id}>{r.name}</option>)}</select></div>
          <span className="dim small">Only the counsellor, the class advisor and the parent see the booking.</span>
          <button className="btn" disabled={!pickName}>Book session</button>
        </form>
      </Modal>
      {tab === 'health' && <div className="card"><Table head={['Student', 'Blood group', 'Allergies', 'Last check-up', 'Vision', 'BMI']} rows={[['Arun Kumar P', 'B+', 'None', dayLabel(-60), '6/6', 'Normal'], ['Abinaya S', 'O+', 'Peanuts', dayLabel(-60), '6/9 (glasses)', 'Normal'], ['Gokul V', 'A+', 'None', dayLabel(-60), '6/6', 'Under'], ['Harini K', 'AB+', 'Dust (asthma inhaler)', dayLabel(-60), '6/6', 'Normal'], ['Imran A', 'O−', 'None', dayLabel(-60), '6/12 (referred)', 'Normal']].map((r) => [<b key="n">{r[0]}</b>, r[1], r[2] === 'None' ? <span key="a" className="dim">None</span> : <span key="a" className="pill warn">{r[2]}</span>, r[3], r[4], r[5]])} /></div>}
      {tab === 'needs' && (
        <div className="grid cols-2">
          {[{ n: 'Imran A', c: '10-A', need: 'Dyslexia (assessed)', plan: ['Extra 20 minutes in exams', 'Scribe allowed for Social Science', 'Printed notes in larger font'], review: dayLabel(30) }, { n: 'Fathima N', c: '9-A', need: 'Hearing aid, left ear', plan: ['Front-row seat', 'Teacher repeats homework aloud', 'Homework always posted in writing'], review: dayLabel(45) }].map((p) => (
            <div key={p.n} className="card stack"><div className="row between"><b>{p.n} · {p.c}</b><span className="pill">{p.need}</span></div><ul style={{ margin: 0, paddingLeft: 18 }}>{p.plan.map((x) => <li key={x}>{x}</li>)}</ul><span className="dim small">Next review {p.review} · applied automatically to exam timetables</span></div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- certificates

const CERTS = { tc: 'Transfer certificate', bonafide: 'Bonafide certificate', conduct: 'Conduct certificate', merit: 'Certificate of merit' } as const;

export function Certificates() {
  const { toast } = useApp();
  const roster = useRoster();
  const [kind, setKind] = useState<keyof typeof CERTS>('bonafide');
  const [sid, setSid] = useState('');
  const [purpose, setPurpose] = useState('bank account opening');
  const st = roster.find((s) => s.id === sid) ?? roster[0];
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidWhy, setVoidWhy] = useState('');
  const [confirm, confirmEl] = useConfirm();
  const [issued, setIssued] = useDemo<{ no: string; kind: string; name: string; date: string; void?: string }[]>('certs', [{ no: 'BC/2026/118', kind: 'Bonafide certificate', name: 'Keerthana B', date: dayLabel(-3) }, { no: 'TC/2026/021', kind: 'Transfer certificate', name: 'Lokesh P', date: dayLabel(-9) }]);
  if (!st) return <Loading />;
  const no = `${kind === 'tc' ? 'TC' : kind === 'bonafide' ? 'BC' : kind === 'conduct' ? 'CC' : 'MC'}/2026/${119 + issued.length}`;
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Certificates" title="TC, bonafide, conduct and merit certificates" lede="Filled from the student record, numbered, signed and logged. No retyping in the office." />
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="card stack" style={{ gap: 12 }}>
            <div className="field"><span className="label">Certificate</span><Seg label="Certificate" value={kind} onChange={setKind} options={(Object.keys(CERTS) as (keyof typeof CERTS)[]).map((k) => ({ value: k, label: CERTS[k].replace(' certificate', '').replace('Certificate of ', '') }))} /></div>
            <div className="field"><span className="label">Student</span><select aria-label="Student" className="input" value={st.id} onChange={(e) => setSid(e.target.value)}>{roster.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.classLabel}</option>)}</select></div>
            {kind === 'bonafide' && <div className="field"><label htmlFor="purpose">Purpose</label><input id="purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>}
          </div>
          <div className="print-cert"><Letterhead title={CERTS[kind]}>
            <div className="row between small" style={{ color: '#4a6a70' }}><span>No. {no}</span><span>Date: {dayLabel(0)}</span></div>
            <p style={{ lineHeight: 1.8 }}>
              {kind === 'tc' && <>This is to certify that <b>{st.name}</b>, EMIS {st.emis}, born on {st.dob}, was a student of this school in class {st.classLabel} and has paid all dues. Conduct: good. Reason for leaving: parent’s request.</>}
              {kind === 'bonafide' && <>This is to certify that <b>{st.name}</b>, child of {st.guardian.name}, is a bonafide student of class {st.classLabel} in this school for the academic year 2026–27. This certificate is issued for {purpose}.</>}
              {kind === 'conduct' && <>This is to certify that <b>{st.name}</b> of class {st.classLabel} has shown good conduct and character during the period of study in this school.</>}
              {kind === 'merit' && <>Awarded to <b>{st.name}</b> of class {st.classLabel} for first place in the inter-school science exhibition.</>}
            </p>
            <div className="sig"><span>Office</span><span>Principal</span></div>
          </Letterhead></div>
        </div>
        <div className="card stack">
          <button className="btn" onClick={async () => { if (!(await confirm({ title: `Issue ${CERTS[kind].toLowerCase()} ${no}?`, body: <>For <b>{st.name}</b>, {st.classLabel}. Check the wording on the preview. {kind === 'tc' ? 'A transfer certificate also marks the student as leaving the school.' : ''} The number is recorded in the register; a mistake can be voided, not erased.</>, confirm: 'Issue certificate' }))) return; setIssued([{ no, kind: CERTS[kind], name: st.name, date: dayLabel(0) }, ...issued]); toast(`${no} issued and logged. PDF sent to the parent on WhatsApp.`); }}><Icon name="award" size={18} />Issue certificate</button>
          <button className="btn ghost" onClick={() => void saveDocument(document.querySelector('main .print-cert'), `${CERTS[kind]} ${st.name}`, toast)}><Icon name="download" size={18} />Download certificate</button>
          <button className="btn ghost" onClick={() => printDoc(toast, '.print-cert')}>Print or save as PDF</button>
          <h3 style={{ marginTop: 8 }}>Issued register</h3>
          <div className="list">{issued.map((c) => <div key={c.no}><div className="row between"><b className="num" style={{ textDecoration: c.void ? 'line-through' : undefined }}>{c.no}</b><span className="dim small">{c.date}</span></div><div className="muted small">{c.kind} · {c.name}</div>{c.void ? <span className="pill bad">Void: {c.void}</span> : <button className="btn sm ghost" onClick={() => { setVoiding(c.no); setVoidWhy(''); }}>Void</button>}</div>)}</div>
          <Modal open={!!voiding} onClose={() => setVoiding(null)} title={`Void ${voiding ?? ''}?`}>
            <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (!voidWhy.trim()) return; setIssued(issued.map((c) => (c.no === voiding ? { ...c, void: voidWhy.trim() } : c))); toast(`${voiding} voided. It stays in the register, marked void.`); setVoiding(null); }}>
              <div className="field"><label htmlFor="void-r">Reason</label><input id="void-r" className="input" placeholder="Wrong date of birth" value={voidWhy} onChange={(e) => setVoidWhy(e.target.value)} /></div>
              <button className="btn danger" disabled={!voidWhy.trim()}>Void certificate</button>
            </form>
          </Modal>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- records: import, custom fields, promotion

export function Records() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'fields' | 'promote'>('fields');
  const [fields, setFields] = useDemo('custom-fields', [{ name: 'House', type: 'Choice: Red, Blue, Green, Yellow', on: true }, { name: 'Blood group', type: 'Choice', on: true }, { name: 'Bus stop', type: 'From transport routes', on: true }, { name: 'Community category', type: 'Choice: BC, MBC, SC, ST, OC', on: true }, { name: 'Aadhaar (last 4 digits)', type: 'Text', on: false }]);
  const [promoted, setPromoted] = useDemo('promoted', false);
  const roster = useRoster();
  const [confirm, confirmEl] = useConfirm();
  const [open, setOpen] = useState(false);
  const [nf, setNf] = useState('');
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="School records" title="Student records" lede="Add the fields your school uses and move everyone up a class at year end. Class advisors add or import their own students from the Students page." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'fields', label: 'Custom fields' }, { value: 'promote', label: 'Year-end promotion' }]} />
      {tab === 'fields' && (
        <div className="card stack">
          <div className="card-head" style={{ margin: 0 }}><h2>Extra student fields</h2><button className="btn sm" onClick={() => setOpen(true)}><Icon name="plus" size={16} />Add field</button></div>
          <div className="list">{fields.map((f, i) => <div key={f.name} className="row between"><div><b>{f.name}</b><div className="dim small">{f.type}</div></div><Switch checked={f.on} label={`Show ${f.name}`} onChange={(v) => setFields(fields.map((x, j) => (j === i ? { ...x, on: v } : x)))} /></div>)}</div>
          <Modal open={open} onClose={() => setOpen(false)} title="Add a field"><form className="stack" onSubmit={(e) => { e.preventDefault(); if (nf.trim()) { setFields([...fields, { name: nf.trim(), type: 'Text', on: true }]); toast(`${nf} added to every student record.`); setNf(''); setOpen(false); } }}><div className="field"><label htmlFor="nf">Field name</label><input id="nf" className="input" placeholder="Mother tongue" value={nf} onChange={(e) => setNf(e.target.value)} /></div><button className="btn">Add field</button></form></Modal>
        </div>
      )}
      {tab === 'promote' && (
        <div className="card stack" style={{ gap: 14 }}>
          <Table head={['From', 'To', 'Students', 'Held back', 'Leaving (TC)']} rows={[...new Set(roster.map((s) => s.classLabel))].sort((a, b) => parseInt(b) - parseInt(a) || a.localeCompare(b)).map((label) => { const g = parseInt(label); const n = roster.filter((s) => s.classLabel === label).length; return [<b key="f">{label}</b>, g === 12 ? 'Pass out (transfer certificates issued)' : g === 10 ? '11 (groups from guidance report)' : `${g + 1}-${label.split('-')[1]}`, n, 0, g === 12 ? n : label === '10-A' ? 1 : 0]; })} />
          <div className="row">{promoted ? <><span className="pill ok">✓ Promoted to 2027–28</span><button className="btn sm ghost" onClick={() => { setPromoted(false); toast('Promotion undone. Students are back in their 2026–27 classes.'); }}>Undo promotion</button></> : <button className="btn" onClick={async () => { if (await confirm({ title: 'Promote students to 2027–28?', body: `${roster.filter((s) => parseInt(s.classLabel) < 12).length} students move up a class and ${roster.filter((s) => parseInt(s.classLabel) === 12).length} 12th students pass out with transfer certificates. Marks, attendance and profiles move with each student. You can undo this until the new year’s first attendance is marked.`, confirm: 'Promote students' })) { setPromoted(true); toast('Promotion done for 2027–28. Roll numbers reset, history kept.'); } }}>Promote to 2027–28</button>}<span className="dim small">Marks, attendance and profiles move with each student.</span></div>
        </div>
      )}
    </>
  );
}

export { day, pick };
