import { useEffect, useRef, useState } from 'react';
import { formatDate, isoDate } from '@enticra/core';
import { Bar, Icon, Loading, PageHead, readImage, useApp, useConfirm, useLoad } from '../ui';
import { StudentProfile } from '../pages/Students';
import { GuidanceReport } from './People';
import { MATHS_CHAPTERS } from './Academics';
import { Stats, Table, Tabs, dayLabel, useDemo } from './kit';
import { StudentHomework, TodayPeriods } from './School';

type MCQ = { q: string; options: string[]; answer: number; why: string; chapter: string };
const TRIG: MCQ[] = [
  { q: 'sin²θ + cos²θ equals', options: ['0', '1', 'tan θ', '2'], answer: 1, why: 'This is the basic Pythagorean identity.', chapter: 'Trigonometry' },
  { q: 'If tan θ = 1, then θ is', options: ['30°', '45°', '60°', '90°'], answer: 1, why: 'tan 45° = 1, because sin 45° = cos 45°.', chapter: 'Trigonometry' },
  { q: 'The angle of elevation of the sun is 45°. A 10 m pole casts a shadow of', options: ['5 m', '10 m', '10√3 m', '20 m'], answer: 1, why: 'tan 45° = height ÷ shadow = 1, so the shadow equals the height.', chapter: 'Trigonometry' },
  { q: '(1 + tan²θ) equals', options: ['sec²θ', 'cosec²θ', 'cot²θ', '1'], answer: 0, why: 'Divide sin²θ + cos²θ = 1 by cos²θ.', chapter: 'Trigonometry' },
  { q: 'cos 60° is', options: ['√3/2', '1/2', '1', '0'], answer: 1, why: 'cos 60° = 1/2. Learn the 0°, 30°, 45°, 60°, 90° table.', chapter: 'Trigonometry' },
];
const MENSURATION: MCQ[] = [
  { q: 'Curved surface area of a cylinder is', options: ['πr²h', '2πrh', '2πr(h + r)', '⅓πr²h'], answer: 1, why: 'CSA = 2πrh. Total adds the two circles: 2πr(h + r).', chapter: 'Mensuration' },
  { q: 'Volume of a cone is', options: ['πr²h', '⅓πr²h', '4/3 πr³', '2πrh'], answer: 1, why: 'A cone holds one third of the cylinder with the same base and height.', chapter: 'Mensuration' },
  { q: 'A sphere of radius 3 cm has volume', options: ['36π cm³', '27π cm³', '12π cm³', '9π cm³'], answer: 0, why: '4/3 × π × 27 = 36π cm³.', chapter: 'Mensuration' },
  { q: 'Slant height of a cone with r = 6, h = 8 is', options: ['10', '12', '14', '7'], answer: 0, why: 'l = √(r² + h²) = √100 = 10.', chapter: 'Mensuration' },
];

export function TakeTest({ title, questions, minutes, onDone }: { title: string; questions: MCQ[]; minutes: number; onDone?: (score: number) => void }) {
  const [ans, setAns] = useState<(number | null)[]>(() => questions.map(() => null));
  const [left, setLeft] = useState(minutes * 60);
  const [done, setDone] = useState(false);
  const score = ans.filter((a, i) => a === questions[i].answer).length;
  useEffect(() => { if (done) return; const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000); return () => window.clearInterval(t); }, [done]);
  useEffect(() => { if (left === 0 && !done) { setDone(true); onDone?.(score); } }, [left, done, score, onDone]);
  const [ask, confirmEl] = useConfirm();
  const blank = ans.filter((a) => a === null).length;
  const submit = async () => {
    if (!(await ask({ title: 'Submit your answers?', body: blank ? `${blank} question${blank > 1 ? 's are' : ' is'} not answered yet. You can’t change answers after submitting.` : 'You can’t change answers after submitting.', confirm: 'Submit' }))) return;
    setDone(true); onDone?.(score);
  };
  return (
    <div className="card stack" style={{ gap: 16 }}>
      {confirmEl}
      <div className="row between"><h2>{title}</h2>{done ? <span className="pill ok" style={{ fontSize: '.95rem' }}>{score} / {questions.length}</span> : <span className={`pill ${left < 60 ? 'bad' : 'accent'}`}><Icon name="clock" size={14} />{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}</div>
      {questions.map((q, i) => (
        <div key={i} className="stack" style={{ gap: 8 }}>
          <b>{i + 1}. {q.q}</b>
          <div className="grid cols-2" style={{ gap: 8 }}>
            {q.options.map((o, j) => {
              const cls = done ? (j === q.answer ? 'right' : ans[i] === j ? 'wrong' : '') : '';
              return <button key={j} className={`opt ${cls}`} aria-pressed={ans[i] === j} disabled={done} onClick={() => setAns(ans.map((a, k) => (k === i ? j : a)))}><span className="pill">{String.fromCharCode(97 + j)}</span>{o}</button>;
            })}
          </div>
          {done && <p className="small" style={{ color: ans[i] === q.answer ? 'var(--ok)' : 'var(--bad)' }}>{ans[i] === q.answer ? '✓ Correct. ' : ans[i] === null ? 'Not answered. ' : '✗ Not quite. '}<span className="muted">{q.why}</span></p>}
        </div>
      ))}
      {!done && <div className="row"><button className="btn" onClick={() => void submit()}>Submit answers</button>{blank > 0 && <span className="dim small">{blank} not answered</span>}</div>}
    </div>
  );
}

export function StudentHome() {
  const { api, session, go, toast } = useApp();
  const me = session.children[0];
  const hw = useLoad(() => api.listHomework({ classId: me.classId }), []);
  const prof = useLoad(() => api.getStudent(me.id), []);
  const today = isoDate(new Date());
  const due = (hw.data ?? []).filter((h) => h.dueDate >= today);
  if (!prof.data) return <Loading />;
  const latest = [...prof.data.results].reverse().find((r) => r.pct !== null);
  return (
    <>
      <PageHead eyebrow={formatDate(today)} title={`Hi ${me.name.split(' ')[0]}`} lede={`${prof.data.classLabel} · ${session.school?.shortName}`}>
        <button className="btn" onClick={() => go({ page: 'tests' })}><Icon name="pen" size={18} />Trigonometry test is live</button>
      </PageHead>
      <Stats items={[{ label: 'Attendance', value: <>{prof.data.attendance.pct}<small>%</small></> }, { label: 'Latest test', value: latest ? <>{latest.total}<small>/ {latest.max}</small></> : '–', foot: latest ? `${latest.subject} · ${latest.name}` : undefined }, { label: 'Practice streak', value: '6 days' }, { label: 'Homework due', value: due.filter((h) => !h.mine).length }]} />
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Homework</h2><button className="btn sm ghost" onClick={() => go({ page: 'homework' })}>All homework</button></div>
          <StudentHomework compact />
        </div>
        <div className="card">
          <div className="card-head"><h2>Today</h2><button className="btn sm ghost" onClick={() => go({ page: 'timetable' })}>Week</button></div>
          <TodayPeriods />
        </div>
      </div>
    </>
  );
}

export function StudentTests() {
  const [taking, setTaking] = useState(false);
  const [score, setScore] = useDemo<number | null>('trig-score', null);
  return (
    <>
      <PageHead eyebrow="Online tests" title="Tests" lede="Timed tests from your teachers. You see your marks and the reason for every answer as soon as you submit." />
      {taking ? <TakeTest title="Trigonometry quick check" questions={TRIG} minutes={8} onDone={setScore} /> : (
        <div className="card">
          <Table head={['Test', 'Subject', 'When', '']} rows={[
            ['Trigonometry quick check', 'Maths', dayLabel(0) + ', live now', score === null ? <button key="s" className="btn sm" onClick={() => setTaking(true)}>Start · 8 min</button> : <span key="s" className="pill ok">{score} / {TRIG.length}</span>],
            ['Optics MCQ practice', 'Science', dayLabel(-2), <span key="s" className="pill ok">14 / 20</span>],
            ['SSLC 2025 Part I (MCQ)', 'Maths', dayLabel(2) + ', 9:30 am', <span key="s" className="pill">Scheduled</span>],
          ].map((r) => [<b key="n">{r[0]}</b>, r[1], r[2], r[3]])} />
        </div>
      )}
    </>
  );
}

export function Practice() {
  const { api, session } = useApp();
  const prof = useLoad(() => api.getStudent(session.children[0].id), []);
  const [tab, setTab] = useState<'weak' | 'board'>('weak');
  const [go, setGo] = useState(false);
  const [board, setBoard] = useState<string | null>(null);
  const [best, setBest] = useDemo<Record<string, string>>('board-best', {});
  const [assigned] = useDemo<string[]>('board-assigned', []);
  if (!prof.data) return <Loading />;
  const weak = prof.data.chapters.slice(0, 5);
  return (
    <>
      <PageHead eyebrow="Practice" title="Practice on your weak chapters" lede="Questions are picked from where you lost marks in tests and AI-corrected papers. They get harder as you get them right." />
      <Tabs value={tab} onChange={(v) => { setTab(v); setGo(false); setBoard(null); }} tabs={[{ value: 'weak', label: 'My weak chapters' }, { value: 'board', label: 'Previous board papers' }]} />
      {tab === 'weak' && (go ? <TakeTest title="Adaptive practice · Mensuration" questions={MENSURATION} minutes={6} /> : (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ gap: 12 }}><h3>Where you lose marks</h3>{weak.map((c) => <Bar key={c.chapter} value={c.pct} label={c.chapter} />)}</div>
          <div className="card stack"><h3>Today’s practice</h3><p className="muted small">4 questions on Mensuration, about 6 minutes. Then 2 on {MATHS_CHAPTERS[5]}.</p><button className="btn" onClick={() => setGo(true)}>Start practice</button></div>
        </div>
      ))}
      {tab === 'board' && (board ? <TakeTest title={`${board} · Part I (MCQ)`} questions={[...TRIG, ...MENSURATION]} minutes={12} onDone={(sc) => setBest({ ...best, [board]: `${sc} / ${TRIG.length + MENSURATION.length}` })} /> : <div className="card"><Table head={['Paper', 'Subject', 'Your best', '']} rows={['March 2026', 'March 2025', 'March 2024'].flatMap((p) => ['Maths', 'Science'].map((sub) => `SSLC ${p} ${sub}`)).map((name) => [<b key="p">{name.replace(/ (Maths|Science)$/, '')}</b>, name.endsWith('Maths') ? 'Maths' : 'Science', best[name] ?? <span key="b" className="dim">Not tried</span>, <span key="s" className="row" style={{ flexWrap: 'nowrap' }}>{assigned.includes(name) && <span className="pill accent">Set by teacher</span>}<button className="btn sm ghost" onClick={() => setBoard(name)}>Start Part I</button></span>])} /></div>)}
    </>
  );
}

type Line = { me: boolean; text: string };
export function Doubts() {
  const { session } = useApp();
  const grade = Number(session.children[0]?.classId.match(/_(\d+)[a-z]$/)?.[1] ?? 10);
  const [lines, setLines] = useState<Line[]>([{ me: false, text: `Ask a doubt from your class ${grade} textbooks. I explain step by step, and I only answer school subjects.` }]);
  const [text, setText] = useState('');
  const reply = (q: string) => {
    const s = q.toLowerCase();
    if (s.includes('cone') || s.includes('volume')) return 'Volume of a cone = ⅓ × π × r² × h.\n\nWhy ⅓? A cone with the same base and height as a cylinder holds exactly one third of it.\n\nExample: r = 7 cm, h = 12 cm → ⅓ × 22/7 × 49 × 12 = 616 cm³.\nBoard tip: write the formula, substitute, then write the unit (cm³) for full marks.';
    if (s.includes('ap') || s.includes('a.p') || s.includes('term')) return 'nth term of an A.P. = a + (n − 1)d.\n\nFor 7, 11, 15, …: a = 7, d = 4.\n15th term = 7 + 14 × 4 = 63.\nCheck: the difference between any two terms is always 4.';
    if (s.includes('trig') || s.includes('sin') || s.includes('cos')) return 'Start from sin²θ + cos²θ = 1.\nDivide by cos²θ → tan²θ + 1 = sec²θ.\nDivide by sin²θ → 1 + cot²θ = cosec²θ.\nWith these three you can prove most identities in Exercise 6.1.';
    if (s.includes('photosynthesis') || s.includes('ohm') || s.includes('lens')) return 'Good Science question. Ohm’s law: V = I × R, at constant temperature. If R = 10 Ω and I = 0.5 A, V = 5 V. Draw the circuit with the ammeter in series and voltmeter in parallel.';
    return 'That doesn’t look like a question from your syllabus, so I can’t help with it here. Try a Maths or Science doubt, like “How do I find the volume of a cone?”';
  };
  const ask = (q: string) => { if (!q.trim()) return; setLines((l) => [...l, { me: true, text: q }]); setText(''); window.setTimeout(() => setLines((l) => [...l, { me: false, text: reply(q) }]), 500); };
  return (
    <>
      <PageHead eyebrow="Doubt solver" title="Ask a doubt" lede="Safe, syllabus-limited answers, available after school. Teachers can see the questions their class asks most." />
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="wa">
          <div className="chat" aria-live="polite">{lines.map((l, i) => <div key={i} className={`bubble ${l.me ? 'me' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>{l.text}</div>)}</div>
          <div className="chip-list">{['How do I find the volume of a cone?', 'nth term of an AP?', 'Trig identities trick?', 'Who will win the cricket match?'].map((s) => <button key={s} className="pill" style={{ cursor: 'pointer', border: 0 }} onClick={() => ask(s)}>{s}</button>)}</div>
          <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); ask(text); }}><input aria-label="Your doubt" className="input" placeholder="Type your doubt" value={text} onChange={(e) => setText(e.target.value)} /><button className="btn" aria-label="Ask"><Icon name="send" size={18} /></button></form>
        </div>
        <div className="card stack"><h3>Safe by design</h3><p className="muted small">Answers come only from the Samacheer Kalvi syllabus. Off-topic or unsafe questions are refused, and every conversation is visible to the school.</p></div>
      </div>
    </>
  );
}

const INTERESTS = ['Drawing', 'Music', 'Dance', 'Coding', 'Robotics', 'Biology', 'Business', 'Debate', 'Writing', 'Sports', 'Chess', 'Helping people'];
export function MyFuture() {
  const { api, session, toast, bump } = useApp();
  const me = session.children[0];
  const prof = useLoad(() => api.getStudent(me.id), []);
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? prof.data?.student.interests ?? [];
  return (
    <>
      <PageHead eyebrow="My future" title="Interests and 11th group guidance" lede="Tell us what you enjoy. Your report uses this with your marks and activities, and a counsellor checks it." />
      <div className="card stack">
        <h3>What do you enjoy?</h3>
        <div className="chip-list">{INTERESTS.map((i) => <button key={i} className={`pill ${chosen.includes(i) ? 'accent' : ''}`} style={{ cursor: 'pointer', border: 0, padding: '6px 14px' }} aria-pressed={chosen.includes(i)} onClick={() => setPicked(chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i])}>{chosen.includes(i) ? '✓ ' : ''}{i}</button>)}</div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!picked} onClick={async () => { try { await api.setInterests(me.id, chosen); } catch { /* students may not edit in the server build */ } setPicked(null); bump(); toast('Saved. Your report is updated.'); }}>Save interests</button>
      </div>
      <GuidanceReport studentId={me.id} />
    </>
  );
}

export function StudentProgress() {
  const { session } = useApp();
  return <><PageHead eyebrow="My progress" title="Marks and feedback" lede="Every test, the chapters you’re strong and weak in, and the reasons you lost marks." /><StudentProfile id={session.children[0].id} embedded /></>;
}

export { Tabs };
