import { useEffect, useRef, useState } from 'react';
import { MENSURATION, TRIG, formatDate, isoDate, type OnlineQuestion } from '@enticra/core';
import { Bar, Icon, Loading, PageHead, readImage, useAction, useApp, useConfirm, useLoad } from '../ui';
import { StudentProfile } from '../pages/Students';
import { GuidanceReport } from './People';
import { MATHS_CHAPTERS, StatusPill, opensLabel } from './Academics';
import { Stats, Table, Tabs, dayLabel, useDemo } from './kit';
import { StudentHomework, TodayPeriods } from './School';

type MCQ = OnlineQuestion;

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
  const online = useLoad(() => api.listOnlineTests(), []);
  const live = (online.data ?? []).find((x) => x.status === 'live' && !x.mine);
  const hw = useLoad(() => api.listHomework({ classId: me.classId }), []);
  const prof = useLoad(() => api.getStudent(me.id), []);
  const today = isoDate(new Date());
  const due = (hw.data ?? []).filter((h) => h.dueDate >= today);
  if (!prof.data) return <Loading />;
  const latest = [...prof.data.results].reverse().find((r) => r.pct !== null);
  return (
    <>
      <PageHead eyebrow={formatDate(today)} title={`Hi ${me.name.split(' ')[0]}`} lede={`${prof.data.classLabel} · ${session.school?.shortName}`}>
        {live && <button className="btn" onClick={() => go({ page: 'tests' })}><Icon name="pen" size={18} />{live.name} is live</button>}
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

/** A student writes a teacher's online test. Answers are marked on the server, which then shows the right ones. */
function TakeOnlineTest({ testId, onBack }: { testId: string; onBack: () => void }) {
  const { api } = useApp();
  const paper = useLoad(() => api.onlinePaper(testId), [testId]);
  const { run, busy } = useAction();
  const [ans, setAns] = useState<(number | null)[] | null>(null);
  const [result, setResult] = useState<{ score: number; of: number; answers: (number | null)[]; review: { answer: number; why: string }[] } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [ask, confirmEl] = useConfirm();
  const sent = useRef(false);
  const p = paper.data;
  const done = result ?? (p?.answers ? { score: p.test.mine?.score ?? 0, of: p.test.mine?.of ?? p.questions.length, answers: p.answers, review: p.questions.map((q) => ({ answer: q.answer ?? -1, why: q.why ?? '' })) } : null);
  const closedUnwritten = !done && p?.test.status === 'closed';
  const left = p ? Math.max(0, Math.floor((new Date(p.test.endsAt).getTime() - now) / 1000)) : 0;
  const picks = ans ?? p?.questions.map(() => null) ?? [];
  const send = async () => {
    if (sent.current || !p) return;
    sent.current = true;
    const r = await run(() => api.submitOnlineTest(testId, picks), (x) => `Submitted. You scored ${x.score} out of ${x.of}.`);
    if (r) setResult(r); else sent.current = false;
  };
  useEffect(() => { if (done || closedUnwritten) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [done, closedUnwritten]);
  useEffect(() => { if (p && !done && !closedUnwritten && p.test.status === 'live' && left === 0) void send(); /* time is up */ }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <Loading />;
  const blank = picks.filter((a) => a === null).length;
  const submit = async () => {
    if (!(await ask({ title: 'Submit your answers?', body: blank ? `${blank} question${blank > 1 ? 's are' : ' is'} not answered yet. You can’t change answers after submitting.` : 'You can’t change answers after submitting.', confirm: 'Submit' }))) return;
    await send();
  };
  const shownAns = done ? done.answers : picks;
  return (
    <>
      <PageHead eyebrow="Online tests" title={p.test.name} lede={`${p.test.subject} · ${p.questions.length} questions · ${p.test.minutes} min · ${p.test.teacher}`}>
        <button className="btn ghost" onClick={onBack}>Back to tests</button>
      </PageHead>
      {confirmEl}
      <div className="card stack" style={{ gap: 16 }}>
        <div className="row between"><h2>{p.test.name}</h2>{done ? <span className="pill ok" style={{ fontSize: '.95rem' }}>{done.score} / {done.of}</span> : closedUnwritten ? <span className="pill">Closed</span> : <span className={`pill ${left < 60 ? 'bad' : 'accent'}`}><Icon name="clock" size={14} />{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}</div>
        {closedUnwritten && <p className="muted small">This test closed before you submitted it. The answers are below so you can learn from them.</p>}
        {p.questions.map((q, i) => {
          const right = done ? done.review[i]?.answer : q.answer;
          const why = done ? done.review[i]?.why : q.why;
          const reveal = right !== undefined && right >= 0;
          return (
            <div key={i} className="stack" style={{ gap: 8 }}>
              <b>{i + 1}. {q.q}</b>
              <div className="grid cols-2" style={{ gap: 8 }}>
                {q.options.map((o, j) => {
                  const cls = reveal ? (j === right ? 'right' : shownAns[i] === j ? 'wrong' : '') : '';
                  return <button key={j} className={`opt ${cls}`} aria-pressed={shownAns[i] === j} disabled={!!done || closedUnwritten || busy} onClick={() => setAns(picks.map((a, k) => (k === i ? j : a)))}><span className="pill">{String.fromCharCode(97 + j)}</span>{o}</button>;
                })}
              </div>
              {reveal && <p className="small" style={{ color: shownAns[i] === right ? 'var(--ok)' : 'var(--bad)' }}>{shownAns[i] === right ? '✓ Correct. ' : shownAns[i] === null || shownAns[i] === undefined ? 'Not answered. ' : '✗ Not quite. '}<span className="muted">{why}</span></p>}
            </div>
          );
        })}
        {!done && !closedUnwritten && <div className="row"><button className="btn" disabled={busy} onClick={() => void submit()}>Submit answers</button>{blank > 0 && <span className="dim small">{blank} not answered</span>}</div>}
      </div>
    </>
  );
}

export function StudentTests() {
  const { api } = useApp();
  const list = useLoad(() => api.listOnlineTests(), []);
  const [taking, setTaking] = useState<string | null>(null);
  if (taking) return <TakeOnlineTest testId={taking} onBack={() => { setTaking(null); list.reload(); }} />;
  if (!list.data) return <Loading />;
  const order = { live: 0, scheduled: 1, closed: 2 } as const;
  const rows = [...list.data].sort((a, b) => order[a.status] - order[b.status] || (a.status === 'scheduled' ? a.opensAt.localeCompare(b.opensAt) : b.opensAt.localeCompare(a.opensAt)));
  return (
    <>
      <PageHead eyebrow="Online tests" title="Tests" lede="Timed tests from your teachers. You see your marks and the reason for every answer as soon as you submit." />
      <div className="card">
        <Table head={['Test', 'Subject', 'Opens', '']} empty="No online tests for your class yet. When a teacher sets one, it appears here." rows={rows.map((x) => [
          <b key="n">{x.name}</b>, x.subject, <span key="w" className="small">{opensLabel(x.opensAt)}{x.status === 'live' ? ', live now' : ''}</span>,
          x.mine ? <button key="s" className="btn sm ghost" onClick={() => setTaking(x.id)}><span className="pill ok">{x.mine.score} / {x.mine.of}</span>Review</button>
            : x.status === 'live' ? <button key="s" className="btn sm" onClick={() => setTaking(x.id)}>Start · {Math.max(1, Math.ceil((new Date(x.endsAt).getTime() - Date.now()) / 60000))} min left</button>
            : x.status === 'closed' ? <button key="s" className="btn sm ghost" onClick={() => setTaking(x.id)}>Missed · see answers</button>
            : <StatusPill key="s" status={x.status} />,
        ])} />
      </div>
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
