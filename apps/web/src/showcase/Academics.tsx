import { useMemo, useState } from 'react';
import { formatDate, isoDate } from '@enticra/core';
import { Icon, Loading, Modal, PageHead, Seg, relTime, useApp, useConfirm, useLoad } from '../ui';
import { DEFAULT_BP, PART_TYPES, PRESETS, PaperView, SAMPLE_POOLS, bpProblem, bpTotal, paperParts, paperQuestions, type Blueprint, type Item, type PartType, type Pools, type SavedPaper } from './Paper';
import { WaBubble } from '../pages/Messages';
import { TimetableView } from './School';
import { Bar } from '../ui';
import { Letterhead, PrintModal, QR, SHARED_SAMPLE, Stats, Table, Tabs, day, dayLabel, heat, pick, useDemo, useRoster, useTyping, type Shared } from './kit';

const HSC_MATHS = ['Matrices and Determinants', 'Complex Numbers', 'Theory of Equations', 'Inverse Trigonometric Functions', 'Analytical Geometry', 'Vector Algebra', 'Differential Calculus', 'Integral Calculus'];
export const MATHS_CHAPTERS = ['Relations and Functions', 'Numbers and Sequences', 'Algebra', 'Geometry', 'Coordinate Geometry', 'Trigonometry', 'Mensuration', 'Statistics and Probability'];
const SCIENCE_CHAPTERS = ['Laws of Motion', 'Optics', 'Thermal Physics', 'Electricity', 'Acoustics', 'Atoms and Molecules', 'Periodic Classification', 'Solutions'];
const STEMS: Record<string, string[]> = {
  'Relations and Functions': ['If A = {1, 2} and B = {3, 4}, find A × B.', 'Show that the function f(x) = 2x + 3 is one-one.', 'Represent the relation R = {(x, y) : y = x + 2} as an arrow diagram.'],
  'Numbers and Sequences': ['Find the 15th term of the A.P. 7, 11, 15, …', 'Use Euclid’s division lemma to find the HCF of 84 and 120.', 'Find the sum of the first 20 terms of 3 + 7 + 11 + …'],
  Algebra: ['Solve x² − 5x + 6 = 0 by factorisation.', 'Find the LCM of x³ − 1 and x² − 1.', 'Solve the pair of equations 2x + 3y = 13, x − y = 1.'],
  Geometry: ['State and prove the Basic Proportionality Theorem.', 'In ΔABC, DE ∥ BC. If AD = 4 cm, DB = 6 cm and AE = 5 cm, find EC.', 'Construct a triangle similar to a given triangle with scale factor 3/5.'],
  'Coordinate Geometry': ['Find the slope of the line joining (2, 3) and (6, 11).', 'Find the area of the triangle with vertices (1, 2), (4, 6), (7, 2).', 'Find the equation of the line through (3, −2) parallel to 2x − y = 5.'],
  Trigonometry: ['Prove that sin²θ + cos²θ = 1.', 'A tower casts a 20 m shadow when the sun’s altitude is 60°. Find its height.', 'Prove that (1 − cos θ)/(1 + cos θ) = (cosec θ − cot θ)².'],
  Mensuration: ['Find the total surface area of a cylinder of radius 7 cm and height 10 cm.', 'A cone of height 24 cm and radius 6 cm is reshaped into a sphere. Find its radius.', 'Find the volume of a frustum with radii 8 cm, 4 cm and height 6 cm.'],
  'Statistics and Probability': ['Find the range of 12, 25, 7, 31, 18.', 'Two dice are rolled. Find the probability that the sum is 8.', 'Find the standard deviation of the first 10 natural numbers.'],
};
type Level = 'Easy' | 'Medium' | 'Hard';
/** One question in the bank: either a built-in one (sample or starter) or the school's own. */
type BankQ = Item & { id: string; type: PartType; grade: number; subject: string; level: Level; source: string; own?: boolean; replaces?: string };
/** The school's own questions; built-in questions removed (hidden) or replaced by an edited copy (replaced). */
type OwnBank = { own: BankQ[]; hidden: string[]; replaced?: string[] };
const LEVELS: Level[] = ['Easy', 'Medium', 'Hard'];
const TYPE_MARKS: Record<PartType, string> = { mcq: '1 mark', short: '2 marks', long: '5 marks', construct: '8 marks' };
const LANGS = ['Tamil', 'English'];

/** Questions that come with the product for a standard and subject. 10th Maths has the full sample bank; every other standard gets starter questions per chapter for teachers to edit. */
function baseBank(grade: number, subject: string): BankQ[] {
  if (grade === 10 && subject === 'Maths') {
    return (Object.keys(SAMPLE_POOLS) as PartType[]).flatMap((type) => SAMPLE_POOLS[type].map((it, i) => ({ ...it, id: `b-${type}-${i}`, type, grade, subject, level: LEVELS[i % 3], source: i % 3 === 0 ? 'Board paper' : i % 3 === 1 ? 'Mr. K. Karthik' : 'AI draft, reviewed' })));
  }
  const lang = LANGS.includes(subject);
  const out: BankQ[] = [];
  chaptersOf(grade, subject).forEach((ch, ci) => {
    const add = (type: PartType, i: number, q: string, key: string, opts?: string[]) => out.push({ id: `b-${grade}-${subject}-${type}-${ci}-${i}`, type, grade, subject, chapter: ch, q, key, opts, level: LEVELS[(ci + i) % 3], source: 'Starter' });
    add('mcq', 0, `Which of these is a key idea from “${ch}”?`, 'Teacher to set the correct option.', ['Option 1', 'Option 2', 'Option 3', 'Option 4']);
    add('mcq', 1, `Choose the correct statement about “${ch}”.`, 'Teacher to set the correct option.', ['Statement 1', 'Statement 2', 'Statement 3', 'Statement 4']);
    add('mcq', 2, `Fill in the blank with the right word from “${ch}”.`, 'Teacher to set the answer.', ['Word 1', 'Word 2', 'Word 3', 'Word 4']);
    add('short', 0, lang ? `Give the meaning of two words from “${ch}” and use each in a sentence.` : `Define two key terms from “${ch}”.`, 'One mark for each correct definition.');
    add('short', 1, `Give one example from “${ch}” and explain it in two lines.`, 'One mark for the example, one for the explanation.');
    add('short', 2, lang ? `Answer in one or two sentences: what is “${ch}” about?` : `Write two differences between ideas you learnt in “${ch}”.`, 'One mark for each correct point.');
    add('long', 0, lang ? `Write a paragraph on “${ch}” in your own words.` : `Explain the main ideas of “${ch}” with an example.`, 'Main points (3), example (1), neat presentation (1).');
    add('long', 1, `Answer in detail: what did you learn from “${ch}”? Give reasons.`, 'Content (3), reasons (2).');
    add('long', 2, lang ? `Summarise “${ch}” in about 100 words.` : `Write short notes on “${ch}”.`, 'Any five correct points, one mark each.');
    if (ci < 2) add('construct', 0, lang ? `Write a letter or an essay of about 200 words linked to “${ch}”.` : subject === 'Maths' ? `Draw a neat graph or construction from “${ch}” and explain the steps.` : `Draw a neat labelled diagram from “${ch}” and explain it.`, 'Layout or figure (3), content (4), neatness (1).');
  });
  return out;
}
const toPools = (qs: BankQ[]): Pools => ({ mcq: qs.filter((q) => q.type === 'mcq'), short: qs.filter((q) => q.type === 'short'), long: qs.filter((q) => q.type === 'long'), construct: qs.filter((q) => q.type === 'construct') });
const blankQ = (grade: number, subject: string, chapter: string): BankQ => ({ id: '', type: 'short', grade, subject, chapter, q: '', key: '', level: 'Medium', source: '', own: true });

// ---------------------------------------------------------------- question bank and paper builder

export function QuestionBank() {
  const { toast } = useApp();
  const { api, go, session } = useApp();
  const viewOnly = session.user.role === 'principal';
  const [assigned, setAssigned] = useDemo<string[]>('board-assigned', []);
  const [tab, setTab] = useState<'bank' | 'builder' | 'saved' | 'board'>('bank');
  const classes = useLoad(() => api.listClasses(), []);
  const all = classes.data ?? [];
  const grades = [...new Set(all.map((c) => c.grade))].sort((a, b) => b - a);
  const [grade, setGrade] = useDemo<number>('qb-grade', 10);
  const subjects = [...new Set(all.filter((c) => c.grade === grade).flatMap((c) => c.subjects))];
  const [subjectPick, setSubject] = useDemo<string>('qb-subject', 'Maths');
  const subject = subjects.includes(subjectPick) ? subjectPick : subjects[0] ?? 'Maths';
  const [store, setStore] = useDemo<OwnBank>('qbank-v2', { own: [], hidden: [] });
  const base = useMemo(() => baseBank(grade, subject), [grade, subject]);
  const bank = [...base.filter((q) => !store.hidden.includes(q.id) && !(store.replaced ?? []).includes(q.id)), ...store.own.filter((q) => q.grade === grade && q.subject === subject)];
  const removedHere = base.filter((q) => store.hidden.includes(q.id)).length;
  const pools = toPools(bank);
  const chapters = chaptersOf(grade, subject);
  const [chapter, setChapter] = useState('All');
  const [kind, setKind] = useState('All');
  const [editing, setEditing] = useState<BankQ | null>(null);
  const [built, setBuilt] = useDemo<boolean>('paper-built', false);
  const [seed, setSeed] = useDemo<number>('paper-seed', 1);
  const [papersRaw, setPapers] = useDemo<SavedPaper[]>('papers', []);
  // A test made from a paper can be deleted in Tests and marks; then the paper can be made into a test again.
  const tests = useLoad(() => api.listExams(), []);
  // Teachers see the papers they made; the principal sees every paper in the school.
  const papers = (viewOnly ? papersRaw : papersRaw.filter((p) => !p.by || p.by === session.user.id));
  const papersChecked = tests.data ? papers.map((p) => (p.testId && !tests.data!.some((e) => e.id === p.testId) ? { ...p, testId: undefined } : p)) : papers;
  const [bp, setBp] = useDemo<Blueprint>('paper-blueprint', DEFAULT_BP);
  const problem = bpProblem(bp, pools);
  const setPart = (type: PartType, k: 'marks' | 'set' | 'answer', v: number) => setBp({ ...bp, parts: bp.parts.map((p) => (p.type === type ? { ...p, [k]: Math.max(0, Math.round(v || 0)), ...(k === 'set' && p.answer > v ? { answer: Math.max(0, Math.round(v || 0)) } : {}) } : p)) });
  const preset = Object.entries(PRESETS).find(([, x]) => JSON.stringify(x.bp) === JSON.stringify(bp))?.[0] ?? 'custom';
  const parts = built ? paperParts(seed, bp, pools) : [];
  const coverage: Record<string, number> = {};
  for (const p of parts) for (const it of p.items.slice(0, p.answer)) coverage[it.chapter] = (coverage[it.chapter] ?? 0) + p.marks;
  const starters = parts.flatMap((p) => p.items).filter((it) => (it as BankQ).source === 'Starter').length;
  const forSubject = (g: number, s: string) => all.filter((c) => c.grade === g && c.subjects.includes(s));
  const here = forSubject(grade, subject);
  const [classId, setClassId] = useState('');
  const cls = here.find((c) => c.id === classId) ?? here[0];
  const [name, setName] = useState('Model Exam 1');
  const [viewing, setViewing] = useState<SavedPaper | null>(null);
  const draft = (): SavedPaper | null => (cls ? { id: `pp${Date.now()}`, name: name.trim() || 'Model Exam', classId: cls.id, classLabel: cls.label, seed, createdAt: new Date().toISOString(), blueprint: bp, grade, subject, pools } : null);
  const save = (p: SavedPaper) => { setPapers([{ ...p, by: p.by ?? session.user.id, byName: p.byName ?? session.user.name }, ...papersRaw.filter((x) => x.id !== p.id)]); tests.reload(); return p; };
  const types = session.school?.settings.examTypes ?? [];
  const [testFor, setTestFor] = useState<SavedPaper | null>(null);
  const [tf, setTf] = useState({ name: '', classId: '', date: '', type: '' });
  const [practice, setPractice] = useState<string | null>(null);
  const [pf, setPf] = useState({ classes: [] as string[], due: '' });
  const [confirm, confirmEl] = useConfirm();
  const testClasses = testFor ? forSubject(testFor.grade ?? 10, testFor.subject ?? 'Maths') : [];
  const makeTest = (p: SavedPaper) => { setTf({ name: p.name, classId: p.classId, date: '', type: types.find((t) => /model|pre-board/i.test(t)) ?? types[0] ?? '' }); setTestFor(p); };
  const createTest = async () => {
    if (!testFor) return;
    const c = testClasses.find((x) => x.id === tf.classId);
    if (!tf.date) return toast('Pick the date the test will be written.', 'err');
    try {
      const exam = await api.createExam({ classId: tf.classId, subject: testFor.subject ?? 'Maths', name: tf.name, type: tf.type, date: tf.date, questions: paperQuestions(testFor.seed, testFor.blueprint, testFor.pools) });
      save({ ...testFor, name: tf.name, classId: tf.classId, classLabel: c?.label ?? testFor.classLabel, testId: exam.id });
      setTestFor(null);
      toast(`${tf.name} is set for ${c?.label} on ${formatDate(tf.date)}. You can change the date in Tests and marks until it is published.`);
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const saveQ = (q: BankQ) => {
    if (!q.q.trim()) return toast('Write the question.', 'err');
    if (q.type === 'mcq' && (q.opts ?? []).filter((o) => o.trim()).length < 2) return toast('Give at least two options.', 'err');
    const clean: BankQ = { ...q, q: q.q.trim(), key: q.key.trim() || 'Teacher to set.', opts: q.type === 'mcq' ? (q.opts ?? []).map((o) => o.trim()).filter(Boolean) : undefined, own: true, source: session.user.name };
    if (!q.id) setStore({ ...store, own: [...store.own, { ...clean, id: `oq${Date.now()}` }] });
    else if (q.own) setStore({ ...store, own: store.own.map((x) => (x.id === q.id ? clean : x)) });
    else setStore({ ...store, own: [...store.own, { ...clean, id: `oq${Date.now()}`, replaces: q.id }], replaced: [...(store.replaced ?? []), q.id] });
    setEditing(null);
    toast(q.id ? 'Question updated.' : `Question added to Class ${grade} ${subject}.`);
  };
  const removeQ = async (q: BankQ) => {
    if (!(await confirm({ title: 'Remove this question?', body: 'It will not be picked for new papers. Papers already saved keep their questions.', confirm: 'Remove question', danger: true }))) return;
    const orig = q.replaces;
    setStore(q.own ? { ...store, own: store.own.filter((x) => x.id !== q.id), replaced: (store.replaced ?? []).filter((id) => id !== orig), hidden: orig ? [...store.hidden, orig] : store.hidden } : { ...store, hidden: [...store.hidden, q.id] });
    toast('Question removed.');
  };
  const list = bank.filter((q) => (chapter === 'All' || q.chapter === chapter) && (kind === 'All' || q.type === kind));
  const board = grade === 10 ? 'SSLC' : grade === 12 ? 'HSC' : null;
  const covered = chapters.filter((c) => bank.some((q) => q.chapter === c)).length;

  return (
    <>
      <PageHead eyebrow="Question papers" title="Question bank and paper builder" lede="Questions for every standard and subject, tagged by chapter, question type and difficulty. Add your own, build a paper in minutes, print it, or send it to AI correction as a test.">
        {!viewOnly && <button className="btn ghost" onClick={() => setEditing(blankQ(grade, subject, chapters[0]))}><Icon name="plus" size={18} />Add question</button>}
        {!viewOnly && <button className="btn" onClick={() => setTab('builder')}><Icon name="file" size={18} />Build a paper</button>}
      </PageHead>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="field" style={{ width: 'auto' }}><label htmlFor="qb-g" className="label">Standard</label><select id="qb-g" className="input" style={{ width: 'auto' }} value={grade} onChange={(e) => { setGrade(Number(e.target.value)); setChapter('All'); }}>{grades.map((g) => <option key={g} value={g}>Class {g}</option>)}</select></div>
        <div className="field" style={{ width: 'auto' }}><label htmlFor="qb-s" className="label">Subject</label><select id="qb-s" className="input" style={{ width: 'auto' }} value={subject} onChange={(e) => { setSubject(e.target.value); setChapter('All'); }}>{subjects.map((s) => <option key={s}>{s}</option>)}</select></div>
      </div>
      <Stats items={[{ label: 'Questions', value: String(bank.length), foot: `Class ${grade} ${subject}` }, { label: 'Your own questions', value: String(bank.filter((q) => q.own).length), foot: `${store.own.length} across the school` }, { label: 'Saved papers', value: String(papersChecked.length) }, { label: 'Chapters covered', value: `${covered} of ${chapters.length}` }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'bank', label: 'Question bank' }, ...(viewOnly ? [] : [{ value: 'builder' as const, label: 'Paper builder' }]), { value: 'saved' as const, label: `Saved papers (${papersChecked.length})` }, ...(board && !viewOnly ? [{ value: 'board' as const, label: 'Previous board papers' }] : [])]} />

      {tab === 'bank' && (
        <div className="card stack" style={{ gap: 14 }}>
          <div className="row between">
            <div className="row">
              <select aria-label="Chapter" className="input" style={{ width: 'auto', minWidth: 220 }} value={chapter} onChange={(e) => setChapter(e.target.value)}><option>All</option>{chapters.map((c) => <option key={c}>{c}</option>)}</select>
              <Seg label="Question type" value={kind} onChange={setKind} options={[{ value: 'All', label: 'All types' }, ...(Object.keys(PART_TYPES) as PartType[]).map((t) => ({ value: t, label: PART_TYPES[t].name }))]} />
            </div>
            {removedHere > 0 && !viewOnly && <button className="btn sm ghost" onClick={() => { setStore({ ...store, hidden: store.hidden.filter((id) => !base.some((q) => q.id === id)) }); toast(`${removedHere} removed question${removedHere > 1 ? 's' : ''} restored.`); }}>Restore {removedHere} removed</button>}
          </div>
          {base.some((q) => q.source === 'Starter') && <p className="dim small" style={{ margin: 0 }}>Starter questions are placeholders for each chapter. Edit them into your own questions, or add new ones, before you print a paper.</p>}
          <Table head={['Question', 'Chapter', 'Type', 'Level', 'Source', '']} empty="No questions match. Add one with Add question." rows={list.map((q) => [
            <span key="t" style={{ display: 'block', minWidth: 240 }}>{q.q}{q.opts && <span className="dim small" style={{ display: 'block' }}>{q.opts.map((o, j) => `(${String.fromCharCode(97 + j)}) ${o}`).join('  ')}</span>}</span>, q.chapter,
            <span key="m" className="small">{PART_TYPES[q.type].name}</span>,
            <span key="l" className={`pill ${q.level === 'Hard' ? 'bad' : q.level === 'Medium' ? 'warn' : 'ok'}`}>{q.level}</span>,
            q.source === 'Starter' ? <span key="s" className="pill">Starter</span> : <span key="s" className="dim small">{q.source}</span>,
            viewOnly ? <span key="a" /> : <div key="a" className="row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn sm ghost" aria-label={`Edit question: ${q.q}`} onClick={() => setEditing({ ...q, opts: q.opts ? [...q.opts] : undefined })}>Edit</button>
              <button className="btn sm ghost" aria-label={`Remove question: ${q.q}`} onClick={() => void removeQ(q)}>Remove</button>
            </div>,
          ])} />
        </div>
      )}

      {tab === 'builder' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ gap: 14 }}>
            <div className="card-head" style={{ margin: 0 }}><h2>New paper · Class {grade} {subject}</h2><span className={`pill ${problem ? 'warn' : 'ok'}`}>{bpTotal(bp)} of {bp.maxMarks} marks · {bp.time}</span></div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="pb-name">Paper name</label><input id="pb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="field"><span className="label">Class</span><select aria-label="Class" className="input" value={cls?.id ?? ''} onChange={(e) => setClassId(e.target.value)}>{here.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row between"><span className="eyebrow">Marks allocation</span><Seg label="Pattern" value={preset} onChange={(v) => { if (v !== 'custom') setBp(PRESETS[v].bp); }} options={[...Object.entries(PRESETS).map(([k, x]) => ({ value: k, label: x.label })), { value: 'custom', label: 'Custom' }]} /></div>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Part</th><th>Question type</th><th className="r">Marks each</th><th className="r">Printed</th><th className="r">Students answer</th><th className="r">Marks</th></tr></thead>
                <tbody>
                  {bp.parts.map((p) => (
                    <tr key={p.type} style={p.set === 0 ? { opacity: .55 } : undefined}>
                      <td><b>{p.set ? `Part ${['I', 'II', 'III', 'IV'][bp.parts.filter((x) => x.set > 0).indexOf(p)] ?? ''}` : 'Not used'}</b></td>
                      <td>{PART_TYPES[p.type].name}<div className="dim small">{pools[p.type].length} in the bank</div></td>
                      <td className="r"><input aria-label={`${PART_TYPES[p.type].name} marks each`} type="number" min={0} max={20} className="input num" style={{ width: 70 }} value={p.marks} onChange={(e) => setPart(p.type, 'marks', Number(e.target.value))} /></td>
                      <td className="r"><input aria-label={`${PART_TYPES[p.type].name} questions printed`} type="number" min={0} max={pools[p.type].length} className="input num" style={{ width: 70 }} value={p.set} onChange={(e) => setPart(p.type, 'set', Number(e.target.value))} /></td>
                      <td className="r"><input aria-label={`${PART_TYPES[p.type].name} questions to answer`} type="number" min={0} max={p.set} className="input num" style={{ width: 70 }} value={p.answer} onChange={(e) => setPart(p.type, 'answer', Number(e.target.value))} /></td>
                      <td className="r num">{p.answer} × {p.marks} = <b>{p.answer * p.marks}</b></td>
                    </tr>
                  ))}
                  <tr><td colSpan={3}><div className="row" style={{ gap: 8 }}><label htmlFor="pb-max" className="small">Maximum marks</label><input id="pb-max" type="number" min={5} max={200} className="input num" style={{ width: 80 }} value={bp.maxMarks} onChange={(e) => setBp({ ...bp, maxMarks: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /><label htmlFor="pb-time" className="small">Time</label><input id="pb-time" className="input" style={{ width: 120 }} value={bp.time} onChange={(e) => setBp({ ...bp, time: e.target.value })} /></div></td><td colSpan={2} className="r"><b>Total</b></td><td className="r num"><b style={{ color: problem ? 'var(--bad)' : 'var(--ok)' }}>{bpTotal(bp)} / {bp.maxMarks}</b></td></tr>
                </tbody>
              </table></div>
              {problem ? <span className="small" role="alert" style={{ color: 'var(--bad)' }}>{problem}</span> : <span className="dim small">Marks add up. Choice questions: students answer {bp.parts.filter((p) => p.answer < p.set).map((p) => `${p.answer} of ${p.set} ${PART_TYPES[p.type].name.toLowerCase()}`).join(', ') || 'all questions'}.</span>}
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <span className="eyebrow">Chapter coverage{built ? ' (marks a student can score)' : ''}</span>
              {chapters.map((c) => <Bar key={c} value={built ? Math.round(((coverage[c] ?? 0) / Math.max(1, ...Object.values(coverage))) * 100) : 0} label={c} sub={built ? `${coverage[c] ?? 0} marks · ${Math.round(((coverage[c] ?? 0) / Math.max(1, bpTotal(bp))) * 100)}%` : undefined} thresholds={[0, 0]} />)}
            </div>
            {built && starters > 0 && <span className="small" style={{ color: 'var(--warn)' }}>{starters} starter question{starters > 1 ? 's are' : ' is'} in this paper. Edit them in the Question bank before you print.</span>}
            <div className="row">
              <button className="btn" disabled={!!problem} onClick={() => { if (built) setSeed(seed + 1); setBuilt(true); toast(`${bp.parts.reduce((t, p) => t + p.set, 0)} questions picked for Class ${grade} ${subject}.`); }}><Icon name="spark" size={18} />{built ? 'Pick again' : 'Auto-fill from the bank'}</button>
              <button className="btn ghost" disabled={!built || !cls || !!problem} onClick={() => { const p = save(draft()!); setViewing(p); toast(`${p.name} saved. Find it under Saved papers.`); }}><Icon name="file" size={18} />Save and open paper and key</button>
              <button className="btn ghost" disabled={!built || !cls || !!problem} onClick={() => { const p = save(draft()!); makeTest(p); }}><Icon name="pen" size={18} />Save and create as a test</button>
            </div>
            {!here.length && <span className="dim small">No class in Class {grade} studies {subject}.</span>}
          </div>
          <div className="card stack">
            <h3>Paper preview</h3>
            {built && !problem ? (
              <div className="doc" style={{ fontSize: '.86rem' }}>
                {parts.map((p) => <span key={p.title}><b>{p.title}</b>{`  ${p.answer} × ${p.marks} = ${p.answer * p.marks}\n`}{p.items.slice(0, 2).map((it) => `• ${it.q}\n`).join('')}{`  … ${p.items.length - 2 > 0 ? `${p.items.length - 2} more` : ''}\n\n`}</span>)}
              </div>
            ) : <div className="empty">{problem ? 'Fix the marks allocation to see the paper.' : 'Pick questions to see the paper.'}</div>}
          </div>
        </div>
      )}

      {tab === 'saved' && (
        <div className="card">
          <Table head={['Paper', 'Class', 'Subject', 'Marks', 'Saved', 'Status', '']} empty="No papers yet. Build one in the Paper builder and save it." rows={papersChecked.filter((p) => !viewOnly || (p.grade ?? 10) === grade).map((p) => [
            <div key="n"><b>{p.name}</b>{viewOnly && p.byName && <div className="dim small">{p.byName}</div>}</div>, p.classLabel, p.subject ?? 'Maths', <span key="m" className="num">{bpTotal(p.blueprint ?? DEFAULT_BP)}</span>, <span key="d" className="small">{relTime(p.createdAt)}</span>,
            p.testId ? <span key="s" className="pill ok">Test created</span> : <span key="s" className="pill">Draft paper</span>,
            <div key="a" className="row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn sm" onClick={() => setViewing(p)}>Open paper and key</button>
              {p.testId ? <button className="btn sm ghost" onClick={() => go({ page: 'tests', id: p.testId })}>Go to test</button> : !viewOnly && <button className="btn sm ghost" onClick={() => makeTest(p)}>Create as a test</button>}
              {!viewOnly && <button className="btn sm ghost" aria-label={`Delete ${p.name}`} onClick={async () => { if (await confirm({ title: `Delete ${p.name}?`, body: p.testId ? 'The saved paper is removed. The test made from it stays in Tests and marks.' : 'The saved paper is removed. You can build a new one any time.', confirm: 'Delete paper', danger: true })) { setPapers(papersRaw.filter((x) => x.id !== p.id)); toast(`${p.name} deleted.`); } }}>Delete</button>}
            </div>,
          ])} />
        </div>
      )}

      {tab === 'board' && board && (
        <div className="card">
          <Table head={['Paper', 'Subject', 'Questions', 'Key', '']} rows={['March 2026', 'September 2025 (supplementary)', 'March 2025', 'March 2024', 'March 2023'].map((p) => {
            const k = `${board} ${p} ${subject}`;
            return [
              <b key="p">{board} {p}</b>, subject, <span key="q" className="num">{subject === 'Maths' ? 47 : 42}</span>, <span key="k" className="pill ok">Official key</span>,
              assigned.includes(k) ? <span key="b" className="row" style={{ flexWrap: 'nowrap' }}><span className="pill ok">✓ Assigned</span><button className="btn sm ghost" onClick={() => { setAssigned(assigned.filter((a) => a !== k)); toast(`${k} removed from practice.`); }}>Undo</button></span> : <button key="b" className="btn sm ghost" onClick={() => { setPf({ classes: here.map((c) => c.id), due: '' }); setPractice(k); }}>Assign as practice</button>,
            ];
          })} />
        </div>
      )}
      <PaperView paper={viewing} open={!!viewing} onClose={() => setViewing(null)} />
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit question' : `Add a question · Class ${grade} ${subject}`}>
        {editing && (
          <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); saveQ(editing); }}>
            <div className="grid cols-3" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="oq-c">Chapter</label><select id="oq-c" className="input" value={editing.chapter} onChange={(e) => setEditing({ ...editing, chapter: e.target.value })}>{chapters.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="field"><label htmlFor="oq-t">Question type</label><select id="oq-t" className="input" value={editing.type} onChange={(e) => { const type = e.target.value as PartType; setEditing({ ...editing, type, opts: type === 'mcq' ? editing.opts ?? ['', '', '', ''] : undefined }); }}>{(Object.keys(PART_TYPES) as PartType[]).map((t) => <option key={t} value={t}>{PART_TYPES[t].name} ({TYPE_MARKS[t]} in the board pattern)</option>)}</select></div>
              <div className="field"><label htmlFor="oq-l">Level</label><select id="oq-l" className="input" value={editing.level} onChange={(e) => setEditing({ ...editing, level: e.target.value as Level })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
            </div>
            <div className="field"><label htmlFor="oq-q">Question</label><textarea id="oq-q" className="input" rows={3} required value={editing.q} onChange={(e) => setEditing({ ...editing, q: e.target.value })} /></div>
            {editing.type === 'mcq' && (
              <div className="grid cols-2" style={{ gap: 8 }}>
                {(editing.opts ?? ['', '', '', '']).map((o, j) => <div key={j} className="field"><label htmlFor={`oq-o${j}`}>Option ({String.fromCharCode(97 + j)})</label><input id={`oq-o${j}`} className="input" value={o} onChange={(e) => setEditing({ ...editing, opts: (editing.opts ?? ['', '', '', '']).map((x, i) => (i === j ? e.target.value : x)) })} /></div>)}
              </div>
            )}
            <div className="field"><label htmlFor="oq-k">Answer and marking scheme</label><textarea id="oq-k" className="input" rows={2} value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} placeholder="The answer, and how marks are given" /></div>
            {editing.id && !editing.own && <p className="dim small" style={{ margin: 0 }}>Saving makes this your school’s own copy. Papers already saved keep the old wording.</p>}
            <button className="btn" disabled={!editing.q.trim()}>{editing.id ? 'Save changes' : 'Add question'}</button>
          </form>
        )}
      </Modal>
      <Modal open={!!testFor} onClose={() => setTestFor(null)} title="Create a test from this paper">
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void createTest(); }}>
          <div className="field"><label htmlFor="tf-name">Test name</label><input id="tf-name" className="input" required value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} /></div>
          <div className="grid cols-3" style={{ gap: 12 }}>
            <div className="field"><span className="label">Class</span><select aria-label="Class" className="input" value={tf.classId} onChange={(e) => setTf({ ...tf, classId: e.target.value })}>{testClasses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
            <div className="field"><label htmlFor="tf-date">Date of the test</label><input id="tf-date" type="date" className="input" required min={day(0)} value={tf.date} onChange={(e) => setTf({ ...tf, date: e.target.value })} /></div>
            <div className="field"><span className="label">Type</span><select aria-label="Type" className="input" value={tf.type} onChange={(e) => setTf({ ...tf, type: e.target.value })}>{types.map((t) => <option key={t}>{t}</option>)}</select></div>
          </div>
          {testFor && <p className="dim small">The test is out of {bpTotal(testFor.blueprint ?? DEFAULT_BP)}, with marks for each question as in the paper. For choice questions, marks are entered against the questions the student answered. Nothing is sent to parents until you publish marks.</p>}
          <button className="btn" disabled={!tf.date || !tf.name.trim()}>Create test</button>
        </form>
      </Modal>
      <Modal open={!!practice} onClose={() => setPractice(null)} title="Assign as practice">
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (!pf.classes.length || !pf.due) return; setAssigned([...assigned, practice!]); setPractice(null); toast(`Assigned to ${pf.classes.map((id) => here.find((c) => c.id === id)?.label).join(', ')}, due ${formatDate(pf.due)}. Students see it under Practice.`); }}>
          <div className="field"><span className="label">Classes</span><div className="row">{here.map((c) => <label key={c.id} className="row" style={{ gap: 6 }}><input type="checkbox" checked={pf.classes.includes(c.id)} onChange={() => setPf({ ...pf, classes: pf.classes.includes(c.id) ? pf.classes.filter((x) => x !== c.id) : [...pf.classes, c.id] })} />{c.label}</label>)}</div></div>
          <div className="field"><label htmlFor="pf-due">Finish by</label><input id="pf-due" type="date" className="input" style={{ width: 200 }} required min={day(0)} value={pf.due} onChange={(e) => setPf({ ...pf, due: e.target.value })} /></div>
          <button className="btn" disabled={!pf.classes.length || !pf.due}>Assign</button>
        </form>
      </Modal>
      {confirmEl}
    </>
  );
}

// ---------------------------------------------------------------- online tests

type OnlineTest = { id: string; name: string; classLabel: string; subject: string; questions: number; minutes: number; when: string; date?: string; time?: string; status: 'Live' | 'Scheduled' | 'Closed'; submitted: number; of: number; avg: number | null };
const ONLINE: OnlineTest[] = [
  { id: 'ot1', name: 'Trigonometry quick check', classLabel: '10-A', subject: 'Maths', questions: 15, minutes: 20, when: dayLabel(0) + ', 2:00 pm', status: 'Live', submitted: 8, of: 12, avg: 71 },
  { id: 'ot2', name: 'Optics MCQ practice', classLabel: '10-A', subject: 'Science', questions: 20, minutes: 25, when: dayLabel(-2), status: 'Closed', submitted: 12, of: 12, avg: 64 },
  { id: 'ot3', name: 'Algebra: quadratic equations', classLabel: '10-B', subject: 'Maths', questions: 15, minutes: 20, when: dayLabel(-5), status: 'Closed', submitted: 10, of: 10, avg: 58 },
  { id: 'ot4', name: 'SSLC 2025 Part I (MCQ)', classLabel: '10-A, 10-B', subject: 'Maths', questions: 14, minutes: 15, when: dayLabel(2) + ', 9:30 am', status: 'Scheduled', submitted: 0, of: 22, avg: null },
  { id: 'ot5', name: 'Current electricity check', classLabel: '12-A', subject: 'Physics', questions: 20, minutes: 30, when: dayLabel(-3), status: 'Closed', submitted: 8, of: 8, avg: 67 },
  { id: 'ot6', name: 'Plants around us', classLabel: '4-A', subject: 'EVS', questions: 10, minutes: 15, when: dayLabel(-1), status: 'Closed', submitted: 7, of: 8, avg: 78 },
  { id: 'ot7', name: 'Fractions practice', classLabel: '6-A', subject: 'Maths', questions: 15, minutes: 20, when: dayLabel(1) + ', 11:30 am', status: 'Scheduled', submitted: 0, of: 8, avg: null },
];
const ITEM = [92, 88, 75, 71, 69, 66, 61, 58, 52, 47, 44, 38, 35, 31, 22];

export function OnlineTests() {
  const { api, toast, session } = useApp();
  const viewOnly = session.user.role === 'principal';
  const [std, setStd] = useState('all');
  const [cls, setCls] = useState('all');
  const everyone = useRoster();
  const classes = useLoad(() => api.listClasses(), []);
  const [tests, setTests] = useDemo<OnlineTest[]>('online-tests', ONLINE);
  const [sel, setSel] = useState('ot2');
  const [confirm, confirmEl] = useConfirm();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [reopen, setReopen] = useState<OnlineTest | null>(null);
  const [who, setWho] = useState<'missed' | 'all'>('missed');
  const [form, setForm] = useState({ name: 'Mensuration MCQ', classLabel: '10-B', subject: 'Maths', minutes: 20, questions: 15, date: '', time: '10:00' });
  const startReopen = (x: OnlineTest, mode: 'missed' | 'all' = x.submitted < x.of ? 'missed' : 'all') => { setEditId(null); setReopen(x); setWho(mode); setForm({ name: `${x.name} (${mode === 'all' ? 'retest' : 'for those who missed it'})`, classLabel: x.classLabel, subject: x.subject, minutes: x.minutes, questions: x.questions, date: day(1), time: '15:30' }); setOpen(true); };
  const extend = (x: OnlineTest) => { setTests(tests.map((y) => (y.id === x.id ? { ...y, minutes: y.minutes + 10 } : y))); toast(`${x.name} now runs ${x.minutes + 10} minutes. Students still writing see the new end time.`); };
  const closeNow = async (x: OnlineTest) => { if (await confirm({ title: `Close ${x.name} now?`, body: `${x.of - x.submitted} students have not submitted. What they have answered so far is marked.`, confirm: 'Close now' })) { setTests(tests.map((y) => (y.id === x.id ? { ...y, status: 'Closed', when: dayLabel(0) } : y))); toast(`${x.name} closed. Results are ready.`); } };
  const startNew = () => { setReopen(null); setEditId(null); setForm({ name: '', classLabel: classes.data?.[0]?.label ?? '10-A', subject: classes.data?.[0]?.subjects[0] ?? 'Maths', minutes: 20, questions: 15, date: '', time: '10:00' }); setOpen(true); };
  const startEdit = (x: OnlineTest) => { setReopen(null); setEditId(x.id); setForm({ name: x.name, classLabel: x.classLabel, subject: x.subject, minutes: x.minutes, questions: x.questions, date: x.date ?? day(2), time: x.time ?? '09:30' }); setOpen(true); };
  const inClass = (label: string) => everyone.filter((s) => label.split(', ').includes(s.classLabel));
  const formSubjects = [...new Set(form.classLabel.split(', ').flatMap((l) => classes.data?.find((c) => c.label === l)?.subjects ?? []))];
  const gradeOfLabel = (l: string) => Number(l.split('-')[0]);
  const grades = [...new Set((classes.data ?? []).map((c) => c.grade))].sort((a, b) => b - a);
  const myLabels = (classes.data ?? []).map((c) => c.label);
  const mineOnly = (x: OnlineTest) => session.user.role !== 'teacher' || (x.classLabel.split(', ').some((l) => myLabels.includes(l)) && (session.user.subjects ?? []).includes(x.subject));
  const shown = tests.filter(mineOnly).filter((x) => { const labels = x.classLabel.split(', '); return (std === 'all' || labels.some((l) => String(gradeOfLabel(l)) === std)) && (cls === 'all' || labels.includes(cls)); });
  const t = shown.find((x) => x.id === sel) ?? shown[0];
  const roster = t ? inClass(t.classLabel) : [];

  return (
    <>
      <PageHead eyebrow="Online tests" title="Timed tests, marked instantly" lede={viewOnly ? 'Every online test teachers have set, by standard and class, with how each class did.' : 'Students take MCQ and short-answer tests on any phone. Marks, answer-wise feedback and item analysis appear the moment they submit.'}>
        {!viewOnly && <button className="btn" onClick={startNew}><Icon name="plus" size={18} />New online test</button>}
      </PageHead>
      <Stats items={[{ label: 'Live now', value: tests.filter((x) => x.status === 'Live').length }, { label: 'Tests this month', value: 18 + tests.length - ONLINE.length }, { label: 'Average score', value: <>63<small>%</small></> }, { label: 'Teacher marking time', value: '0 min', foot: 'Every answer marked automatically' }]} />
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row">
            <label className="sr" htmlFor="ot-g">Standard</label><select id="ot-g" className="input" style={{ width: 'auto' }} value={std} onChange={(e) => { setStd(e.target.value); setCls('all'); }}><option value="all">All standards</option>{grades.map((g) => <option key={g} value={g}>Standard {g}</option>)}</select>
            <label className="sr" htmlFor="ot-c">Class</label><select id="ot-c" className="input" style={{ width: 'auto' }} value={cls} onChange={(e) => setCls(e.target.value)}><option value="all">All classes</option>{(classes.data ?? []).filter((c) => std === 'all' || String(c.grade) === std).map((c) => <option key={c.id}>{c.label}</option>)}</select>
          </div>
          <Table head={['Test', 'Class', 'When', 'Status', 'Submitted', 'Average', ...(viewOnly ? [] : [''])]} empty="No online tests for this standard or class." rows={shown.map((x) => [
            <button key="n" className="btn sm quiet" onClick={() => setSel(x.id)} aria-pressed={x.id === sel} style={{ whiteSpace: 'normal', height: 'auto', padding: '6px 12px', textAlign: 'left' }}>{x.name}</button>,
            `${x.classLabel} · ${x.subject}`, <span key="w" className="small">{x.when}</span>,
            <span key="s" className={`pill ${x.status === 'Live' ? 'accent' : x.status === 'Closed' ? 'ok' : ''}`}>{x.status === 'Live' && <span className="dot" />}{x.status}</span>,
            <span key="c" className="num">{x.submitted}/{x.of}</span>, x.avg === null ? '–' : <b key="a" className="num">{x.avg}%</b>,
            ...(viewOnly ? [] : [x.status === 'Scheduled' ? <button key="e" className="btn sm ghost" aria-label={`Edit ${x.name}`} onClick={() => startEdit(x)}>Edit</button>
              : x.status === 'Live' ? <button key="e" className="btn sm ghost" aria-label={`Add 10 minutes to ${x.name}`} onClick={() => extend(x)}>+10 min</button>
              : <button key="e" className="btn sm ghost" aria-label={`Reopen ${x.name}`} onClick={() => startReopen(x)}>Reopen</button>]),
          ])} />
        </div>
        {t && <div className="card stack" style={{ gap: 12 }}>
          <div className="card-head" style={{ margin: 0 }}><h2>{t.name}</h2><span className="dim small">{t.questions} questions · {t.minutes} min</span></div>
          {!viewOnly && t.status === 'Live' && <div className="row"><span className="pill accent"><span className="dot" />{t.submitted} of {t.of} submitted</span><button className="btn sm ghost" onClick={() => extend(t)}>Add 10 minutes</button><button className="btn sm ghost" onClick={() => void closeNow(t)}>Close now</button></div>}
          {!viewOnly && t.status === 'Closed' && <div className="row"><span className="small">{t.submitted < t.of ? `${t.of - t.submitted} students missed it.` : 'Everyone wrote it.'}</span>{t.submitted < t.of && <button className="btn sm ghost" onClick={() => startReopen(t, 'missed')}>Reopen for those who missed it</button>}<button className="btn sm ghost" onClick={() => startReopen(t, 'all')}>Retest the whole class</button></div>}
          {t.status === 'Scheduled' ? <div className="empty stack" style={{ alignItems: 'center' }}><span>Opens {t.when}. Students and parents get a WhatsApp reminder the evening before.</span>{!viewOnly && <><button className="btn sm ghost" onClick={async () => { if (await confirm({ title: `Cancel ${t.name}?`, body: 'The test is removed before it opens. No one is notified, because no reminder has gone out yet.', confirm: 'Cancel test', danger: true })) { setTests(tests.filter((x) => x.id !== t.id)); setSel(tests.find((x) => x.id !== t.id)?.id ?? ''); toast(`${t.name} cancelled.`); } }}>Cancel this test</button><button className="btn sm ghost" onClick={() => startEdit(t)}>Edit</button></>}</div> : (
            <>
              <span className="eyebrow">Item analysis · share who got it right</span>
              <div className="stack" style={{ gap: 8 }}>{ITEM.slice(0, 8).map((p, i) => <Bar key={i} value={Math.max(10, p - (t.id === 'ot3' ? 9 : 0))} label={`Q${i + 1}`} sub={i === 7 ? 'most chose (b): common misconception' : undefined} />)}</div>
              <span className="eyebrow" style={{ marginTop: 6 }}>Students</span>
              <div className="list">{roster.slice(0, t.submitted).slice(0, 8).map((s, i) => { const sc = Math.max(4, Math.min(t.questions, Math.round(((s.average ?? 60) / 100) * t.questions + ((i % 3) - 1)))); return <div key={s.id} className="row between"><span>{s.name}</span><b className="num">{sc}/{t.questions}</b></div>; })}</div>
            </>
          )}
        </div>}
      </div>
      {confirmEl}
      <Modal open={open} onClose={() => setOpen(false)} title={reopen ? 'Reopen test' : editId ? 'Edit online test' : 'New online test'}>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (!form.date || !form.time || !form.name.trim()) return; const when = `${formatDate(form.date)}, ${new Date(`2000-01-01T${form.time}`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`; const id = editId ?? `ot${Date.now()}`; const row: OnlineTest = { id, name: form.name.trim(), classLabel: form.classLabel, subject: formSubjects.includes(form.subject) ? form.subject : formSubjects[0] ?? form.subject, questions: form.questions, minutes: form.minutes, when, date: form.date, time: form.time, status: 'Scheduled', submitted: 0, of: reopen && who === 'missed' ? reopen.of - reopen.submitted : inClass(form.classLabel).length, avg: null }; setTests(editId ? tests.map((x) => (x.id === editId ? row : x)) : [row, ...tests]); setSel(id); setOpen(false); setReopen(null); toast(reopen ? (who === 'missed' ? `Reopened for the ${row.of} students who missed it: opens ${when}. Only they get the reminder.` : `Retest for all ${row.of} students: opens ${when}. Earlier scores stay in the first test; the new scores are kept separately.`) : editId ? `${row.name} updated: opens ${when}.` : `${form.name} scheduled for ${when}. You can change or cancel it until it opens.`); }}>
          {reopen && <div className="field"><span className="label">Who writes it</span><div className="grid cols-2" style={{ gap: 8 }}>
            <button type="button" className="opt" aria-pressed={who === 'missed'} disabled={reopen.submitted >= reopen.of} onClick={() => { setWho('missed'); setForm({ ...form, name: `${reopen.name} (for those who missed it)` }); }}>Only those who missed it ({reopen.of - reopen.submitted})</button>
            <button type="button" className="opt" aria-pressed={who === 'all'} onClick={() => { setWho('all'); setForm({ ...form, name: `${reopen.name} (retest)` }); }}>The whole class ({reopen.of})</button>
          </div></div>}
          <div className="field"><label htmlFor="ot-n">Name</label><input id="ot-n" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field"><span className="label">Class</span><select aria-label="Class" className="input" value={form.classLabel} onChange={(e) => setForm({ ...form, classLabel: e.target.value })}>{[...new Set([...(classes.data ?? []).map((c) => c.label), form.classLabel])].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="field"><span className="label">Subject</span><select aria-label="Subject" className="input" value={formSubjects.includes(form.subject) ? form.subject : formSubjects[0]} onChange={(e) => setForm({ ...form, subject: e.target.value })}>{formSubjects.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="field"><label htmlFor="ot-q">Questions</label><input id="ot-q" type="number" min={5} max={50} className="input" value={form.questions} onChange={(e) => setForm({ ...form, questions: Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor="ot-m">Minutes</label><input id="ot-m" type="number" min={5} max={180} className="input" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} /></div>
          </div>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="ot-d">Opens on</label><input id="ot-d" type="date" className="input" required min={day(0)} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="ot-t">At</label><input id="ot-t" type="time" className="input" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></div>
          </div>
          <p className="dim small">Questions are drawn from the bank for the chapter in the name, with shuffled order and options for each student. Students and parents get a reminder the evening before.</p>
          {editId && <p className="dim small">You can change anything until the test opens. If you change the date or time, students and parents get the new time.</p>}
          <button className="btn" disabled={!form.date || !form.time || !form.name.trim()}>{reopen ? 'Reopen test' : editId ? 'Save changes' : 'Schedule test'}</button>
        </form>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- syllabus tracker

const CHAPTERS: Record<string, string[]> = {
  Maths: MATHS_CHAPTERS,
  Science: SCIENCE_CHAPTERS,
  English: ['Prose: His First Flight', 'Poem: Life', 'Prose: The Night the Ghost Got In', 'Supplementary: The Tempest', 'Prose: Empowered Women', 'Poem: The Grumble Family', 'Grammar: Tenses and voice', 'Writing: Letters and notices'],
  Tamil: ['இயல் 1: அமுதத் தமிழ்', 'இயல் 2: உயிருக்கு வேர்', 'இயல் 3: கூட்டாஞ்சோறு', 'இயல் 4: நான்காம் தமிழ்', 'இயல் 5: மணற்கேணி', 'இயல் 6: நிலா முற்றம்', 'இயல் 7: விதை நெல்', 'இயல் 8: பெருவழி'],
  'Social Science': ['History: Outbreak of World War I', 'History: The World between the Wars', 'History: World War II', 'Geography: India, location and relief', 'Geography: Climate and vegetation', 'Civics: Indian Constitution', 'Civics: Central Government', 'Economics: Gross Domestic Product', 'Economics: Globalisation'],
};
/** The date each chapter should be finished by, spread over the year. */
const planned = (i: number) => day(-110 + i * 24);
const SEED_DONE: Record<string, number> = { 'cls_s1_10a|Maths': 6, 'cls_s1_10b|Maths': 4, 'cls_s1_10a|Science': 5, 'cls_s1_10b|Science': 5, 'cls_s1_9a|Science': 5, 'cls_s1_10a|Social Science': 4, 'cls_s1_10b|Social Science': 5, 'cls_s1_9a|Social Science': 5 };
type Done = Record<string, Record<string, string>>;
type Chapter = { name: string; by: string };
type Plan = Record<string, Chapter[]>;
/** The chapters for a class and subject: the school's own list if it set one, otherwise the board syllabus. */
/** Chapter names for a standard and subject: the 9th and 10th board lists we have, otherwise numbered units the school renames. */
export const chaptersOf = (grade: number, subject: string): string[] => ((grade === 9 || grade === 10) && CHAPTERS[subject]) || Array.from({ length: grade <= 5 ? 6 : 8 }, (_, i) => `${subject} unit ${i + 1}`);
const chaptersFor = (plan: Plan, key: string, grade: number): Chapter[] => plan[key] ?? chaptersOf(grade, key.split('|')[1]).map((name, i) => ({ name, by: planned(i) }));
/** Chapters ticked for a class and subject. Classes nobody has ticked yet start with the chapters planned more than a week ago. */
const doneFor = (done: Done, key: string, ch: Chapter[]) => done[key] ?? Object.fromEntries(ch.filter((c) => c.by < day(-7)).map((c) => [c.name, c.by]));
function seedDone(): Done {
  const out: Done = {};
  for (const [k, n] of Object.entries(SEED_DONE)) { const ch = CHAPTERS[k.split('|')[1]]; out[k] = Object.fromEntries(ch.slice(0, n).map((c, i) => [c, day(-104 + i * 24)])); }
  for (const cid of ['cls_s1_10a', 'cls_s1_10b', 'cls_s1_9a']) for (const sub of ['English', 'Tamil', 'Maths']) { const k = `${cid}|${sub}`; if (!out[k]) out[k] = Object.fromEntries(CHAPTERS[sub].slice(0, 5).map((c, i) => [c, day(-104 + i * 24)])); }
  return out;
}

export function Syllabus() {
  const { api, session, toast } = useApp();
  const role = session.user.role;
  const [done, setDone] = useDemo<Done>('syllabus-done', seedDone);
  const [plan, setPlan] = useDemo<Plan>('syllabus-plan', {});
  const [editing, setEditing] = useState(false);
  const [confirm, confirmEl] = useConfirm();
  const over = useLoad(() => (role === 'principal' ? api.teacherOverview() : Promise.resolve(null)), []);
  const classes = useLoad(() => api.listClasses(), []);
  const [cls, setCls] = useState('all');
  const [std, setStd] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const [when, setWhen] = useState(day(0));
  const pairs = useMemo(() => {
    if (role === 'principal') return (over.data ?? []).flatMap((t) => t.pairs.map((p) => ({ key: `${p.classId}|${p.subject}`, classId: p.classId, classLabel: p.classLabel, subject: p.subject, teacher: t.name })));
    return (classes.data ?? []).flatMap((c) => (session.user.subjects ?? []).filter((x) => c.subjects.includes(x)).map((subject) => ({ key: `${c.id}|${subject}`, classId: c.id, classLabel: c.label, subject, teacher: session.user.name })));
  }, [role, over.data, classes.data, session.user]);
  if (!classes.data || (role === 'principal' && !over.data)) return <Loading />;
  const gradeOf = (classId: string) => classes.data!.find((c) => c.id === classId)?.grade ?? 10;
  const rows = pairs.filter((p) => (std === 'all' || String(gradeOf(p.classId)) === std) && (cls === 'all' || p.classId === cls)).map((p) => {
    const ch = chaptersFor(plan, p.key, gradeOf(p.classId));
    const d = doneFor(done, p.key, ch);
    const n = ch.filter((c) => d[c.name]).length;
    const due = ch.filter((c) => c.by <= day(0)).length;
    return { ...p, chapters: ch, total: ch.length, done: n, due, behind: Math.max(0, due - n) };
  }).sort((a, b) => b.behind - a.behind || a.classLabel.localeCompare(b.classLabel) || a.subject.localeCompare(b.subject));
  const cur = rows.find((r) => r.key === (sel ?? (role === 'teacher' ? rows[0]?.key : null)));
  const toggle = async (c: string) => {
    if (!cur || role !== 'teacher') return;
    const d = { ...doneFor(done, cur.key, cur.chapters) };
    if (d[c]) { if (!(await confirm({ title: 'Mark as not finished?', body: `${c} goes back to not finished for ${cur.classLabel} ${cur.subject}. The principal sees the change.`, confirm: 'Mark not finished' }))) return; delete d[c]; }
    else d[c] = when;
    setDone({ ...done, [cur.key]: d });
    if (d[c]) toast(`${c} finished on ${formatDate(when)}.`);
  };
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Academics" title="Syllabus tracker" lede={role === 'teacher' ? 'Tick each chapter as you finish it in each class. Use Edit syllabus to set the chapters and the date each should be finished by.' : 'Chapters finished in every class and subject, against the year plan. Choose a class and subject, then Edit syllabus to set its chapters and dates.'} />
      <Stats items={[{ label: 'On track', value: `${rows.filter((r) => !r.behind).length} of ${rows.length}`, foot: 'class–subject pairs' }, { label: 'Behind plan', value: rows.filter((r) => r.behind).length, tone: rows.some((r) => r.behind) ? 'bad' : undefined, foot: rows.filter((r) => r.behind).slice(0, 2).map((r) => `${r.classLabel} ${r.subject}`).join(', ') || undefined }, { label: 'Chapters finished', value: `${rows.reduce((t, r) => t + r.done, 0)} of ${rows.reduce((t, r) => t + r.total, 0)}` }]} />
      {cur && <SyllabusEditor open={editing} onClose={() => setEditing(false)} pair={cur} chapters={cur.chapters} done={doneFor(done, cur.key, cur.chapters)}
        siblings={pairs.filter((p) => p.subject === cur.subject && p.key !== cur.key).map((p) => ({ key: p.key, label: p.classLabel }))}
        onSave={(list, keys, renamed) => {
          const nextPlan = { ...plan }; const nextDone = { ...done };
          for (const k of keys) {
            nextPlan[k] = list;
            const d = { ...(done[k] ?? doneFor(done, k, cur.chapters)) };
            for (const [from, to] of Object.entries(renamed)) if (d[from]) { d[to] = d[from]; delete d[from]; }
            for (const c of Object.keys(d)) if (!list.some((x) => x.name === c)) delete d[c];
            nextDone[k] = d;
          }
          setPlan(nextPlan); setDone(nextDone); setEditing(false);
          toast(`Syllabus saved for ${keys.length > 1 ? `${keys.length} classes` : `${cur.classLabel} ${cur.subject}`}.`);
        }}
        onReset={plan[cur.key] ? () => { const n = { ...plan }; delete n[cur.key]; setPlan(n); setEditing(false); toast(`${cur.classLabel} ${cur.subject} is back to the default chapter list.`); } : undefined} />}
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head">
            <h2>{role === 'teacher' ? 'My classes' : 'By class and subject'}</h2>
            {role === 'principal' && <div className="row"><select id="sy-g" aria-label="Standard" className="input" style={{ width: 'auto' }} value={std} onChange={(e) => { setStd(e.target.value); setCls('all'); }}><option value="all">All standards</option>{[...new Set(classes.data.map((c) => c.grade))].sort((a, b) => b - a).map((g) => <option key={g} value={g}>Standard {g}</option>)}</select><select aria-label="Class" className="input" style={{ width: 'auto' }} value={cls} onChange={(e) => setCls(e.target.value)}><option value="all">All classes</option>{classes.data.filter((c) => std === 'all' || String(c.grade) === std).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>}
          </div>
          <Table head={['Class', 'Subject', ...(role === 'principal' ? ['Teacher'] : []), 'Chapters finished', 'Status', '']} rows={rows.map((r) => [<b key="c">{r.classLabel}</b>, r.subject, ...(role === 'principal' ? [<span key="t" className="small">{r.teacher}</span>] : []), <div key="b" style={{ minWidth: 140 }}><Bar value={r.total ? Math.round((r.done / r.total) * 100) : 0} label={`${r.done} of ${r.total}`} thresholds={[0, 0]} /></div>, !r.total ? <span key="s" className="pill warn">No chapters yet</span> : r.behind ? <span key="s" className="pill bad">{r.behind} behind plan</span> : <span key="s" className="pill ok">On track</span>, <button key="o" className="btn sm ghost" aria-pressed={cur?.key === r.key} onClick={() => setSel(r.key)}>{role === 'teacher' ? 'Update' : 'Chapters'}</button>])} empty="No subjects to track." />
        </div>
        <div className="card stack">
          {!cur ? <div className="empty">Choose a class and subject to see its chapters.</div> : (
            <>
              <div className="card-head" style={{ margin: 0 }}><div><h2>{cur.classLabel} {cur.subject}</h2><span className="dim small">{cur.teacher}</span></div>{role === 'teacher' && <button className="btn sm ghost" onClick={() => setEditing(true)}><Icon name="pen" size={16} />Edit syllabus</button>}</div>
              {role === 'teacher' && <div className="row" style={{ gap: 8 }}><label htmlFor="sy-d" className="small">Finished on</label><input id="sy-d" type="date" className="input" style={{ width: 170 }} max={day(0)} value={when} onChange={(e) => setWhen(e.target.value || day(0))} /><span className="dim small">used when you tick a chapter</span></div>}
              <div className="list">
                {cur.chapters.length === 0 && <div className="empty">No chapters yet. The subject teacher adds them with Edit syllabus.</div>}
                {cur.chapters.map((ch, i) => {
                  const c = ch.name;
                  const d = doneFor(done, cur.key, cur.chapters)[c];
                  const late = !d && ch.by < day(0);
                  return (
                    <label key={c} className="row between" style={{ flexWrap: 'nowrap', cursor: role === 'teacher' ? 'pointer' : 'default' }}>
                      <span className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                        <input type="checkbox" checked={!!d} disabled={role !== 'teacher'} onChange={() => void toggle(c)} />
                        <span>{i + 1}. {c}</span>
                      </span>
                      <span className={`small ${late ? '' : 'dim'}`} style={late ? { color: 'var(--bad)' } : undefined}>{d ? `Done ${formatDate(d)}` : `Plan: by ${formatDate(ch.by)}`}</span>
                    </label>
                  );
                })}
              </div>
              {role === 'principal' && cur.behind > 0 && <span className="small" style={{ color: 'var(--bad)' }}>{cur.behind} chapter{cur.behind > 1 ? 's' : ''} behind the plan.</span>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SyllabusEditor({ open, onClose, pair, chapters, done, siblings, onSave, onReset }: {
  open: boolean; onClose: () => void; pair: { key: string; classLabel: string; subject: string }; chapters: Chapter[]; done: Record<string, string>;
  siblings: { key: string; label: string }[]; onSave: (list: Chapter[], keys: string[], renamed: Record<string, string>) => void; onReset?: () => void;
}) {
  type Row = Chapter & { was?: string };
  const [rows, setRows] = useState<Row[]>([]);
  const [also, setAlso] = useState<string[]>([]);
  const [paste, setPaste] = useState('');
  const [ask, confirmEl] = useConfirm();
  const [seen, setSeen] = useState(false);
  if (open && !seen) { setSeen(true); setRows(chapters.map((c) => ({ ...c, was: c.name }))); setAlso([]); setPaste(''); }
  if (!open && seen) setSeen(false);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => { const n = [...rows]; [n[i], n[i + d]] = [n[i + d], n[i]]; setRows(n); };
  const nextBy = () => { const last = rows[rows.length - 1]?.by ?? day(0); const t = new Date(last); t.setDate(t.getDate() + 21); return t.toISOString().slice(0, 10); };
  const names = rows.map((r) => r.name.trim().toLowerCase());
  const problem = rows.some((r) => !r.name.trim()) ? 'Every chapter needs a name.' : names.some((n, i) => names.indexOf(n) !== i) ? 'Two chapters have the same name.' : rows.some((r) => !r.by) ? 'Every chapter needs a “finish by” date.' : null;
  const save = async () => {
    const list = rows.map((r) => ({ name: r.name.trim(), by: r.by }));
    const renamed = Object.fromEntries(rows.filter((r) => r.was && r.was !== r.name.trim()).map((r) => [r.was!, r.name.trim()]));
    const removed = chapters.filter((c) => !rows.some((r) => r.was === c.name));
    const lostTicks = removed.filter((c) => done[c.name]);
    const added = rows.filter((r) => !r.was).length;
    const parts = [added && `${added} added`, Object.keys(renamed).length && `${Object.keys(renamed).length} renamed`, removed.length && `${removed.length} removed`].filter(Boolean).join(', ');
    if (removed.length || also.length) {
      if (!(await ask({ title: `Save the ${pair.subject} syllabus?`, body: <>{parts || 'Dates and order changed'}.{lostTicks.length > 0 && <> {lostTicks.map((c) => c.name).join(', ')} {lostTicks.length > 1 ? 'were' : 'was'} already ticked as finished; that record goes too.</>}{also.length > 0 && <> The same list is also used for {siblings.filter((x) => also.includes(x.key)).map((x) => x.label).join(', ')}, replacing their chapters.</>}</>, confirm: 'Save syllabus', danger: lostTicks.length > 0 }))) return;
    }
    onSave(list, [pair.key, ...also], renamed);
  };
  return (
    <Modal open={open} onClose={onClose} title={`Syllabus · ${pair.classLabel} ${pair.subject}`} wide>
      {confirmEl}
      <div className="stack" style={{ gap: 12 }}>
        <p className="dim small">Chapters in teaching order, each with the date it should be finished by. Teachers tick them off; the principal sees who is behind.</p>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>#</th><th>Chapter</th><th>Finish by</th><th>Order</th><th /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td><input aria-label={`Chapter ${i + 1} name`} className="input" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />{r.was && done[r.was] && <div className="dim small">Finished {formatDate(done[r.was])}</div>}</td>
              <td><input aria-label={`Chapter ${i + 1} finish by`} type="date" className="input" style={{ width: 160 }} value={r.by} onChange={(e) => set(i, { by: e.target.value })} /></td>
              <td><span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button type="button" className="btn sm quiet" aria-label={`Move chapter ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button type="button" className="btn sm quiet" aria-label={`Move chapter ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button></span></td>
              <td><button type="button" className="btn sm ghost" aria-label={`Remove chapter ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        {rows.length === 0 && <div className="empty">No chapters. Add them one by one or paste a list.</div>}
        <div className="row"><button type="button" className="btn sm ghost" onClick={() => setRows([...rows, { name: '', by: nextBy() }])}><Icon name="plus" size={16} />Add chapter</button><span className="dim small">{rows.length} chapters</span></div>
        <div className="field"><label htmlFor="sy-paste">Or paste chapter names, one per line</label>
          <textarea id="sy-paste" className="input" rows={3} placeholder={'Chapter 1: Real numbers\nChapter 2: Polynomials'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start', marginTop: 6 }} disabled={!paste.trim()} onClick={() => { const lines = paste.split('\n').map((x) => x.trim()).filter(Boolean); let by = rows[rows.length - 1]?.by ?? day(0); const add = lines.map((name) => { const t = new Date(by); t.setDate(t.getDate() + 21); by = t.toISOString().slice(0, 10); return { name, by }; }); setRows([...rows, ...add]); setPaste(''); }}>Add these to the list</button>
        </div>
        {siblings.length > 0 && <div className="field"><span className="label">Use the same list for</span><div className="row">{siblings.map((x) => <label key={x.key} className="row" style={{ gap: 6 }}><input type="checkbox" checked={also.includes(x.key)} onChange={() => setAlso(also.includes(x.key) ? also.filter((k) => k !== x.key) : [...also, x.key])} />{x.label} {pair.subject}</label>)}</div></div>}
        {problem && <div className="small" style={{ color: 'var(--bad)' }}>{problem}</div>}
        <div className="row">
          <button type="button" className="btn" disabled={!!problem} onClick={() => void save()}>Save syllabus</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          {onReset && <button type="button" className="btn quiet" style={{ marginLeft: 'auto' }} onClick={async () => { if (await ask({ title: 'Go back to the default chapter list?', body: `Your own chapter list for ${pair.classLabel} ${pair.subject} is replaced with the default list. Ticks for chapters with the same name stay.`, confirm: 'Use board syllabus', danger: true })) onReset(); }}>Use default list</button>}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- timetable and substitution

const PERIODS = ['9:00', '9:45', '10:30', '11:30', '12:15', '2:00', '2:45', '3:30'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TT = ['Maths', 'Science', 'English', 'Tamil', 'Social', 'Maths', 'PT', 'Library'];


export function Timetable({ id }: { id?: string }) {
  const { api, toast } = useApp();
  const teachers = useLoad(() => api.teacherOverview(), []);
  const firstDay = () => { const d = new Date(); if (d.getDay() === 0) d.setDate(d.getDate() + 1); return isoDate(d); };
  const [who, setWho] = useState('u_s1_science');
  const [date, setDate] = useState(firstDay);
  const subsFor = useLoad(() => api.substitutions(who, date), [who, date]);
  const [subs, setSubs] = useDemo<Record<string, string>>('subs-v2', {});
  const [notified, setNotified] = useDemo<string[]>('subs-notified-v2', []);
  const [confirm, confirmEl] = useConfirm();
  const key = `${who}|${date}`;
  const done = notified.includes(key);
  const periods = subsFor.data?.periods ?? [];
  const pk = (n: number) => `${key}|${n}`;
  const allPicked = periods.length > 0 && periods.every((x) => subs[pk(x.period)]);
  const name = teachers.data?.find((t) => t.id === who)?.name ?? subsFor.data?.teacher ?? '';
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Academics" title="Timetable and substitution" lede="Timetables for every class and every teacher, made from who teaches what. When a teacher is on leave, pick a substitute for each of their periods from the teachers who are free then." />
      <div className="card stack" style={{ borderColor: done || !periods.length ? undefined : 'var(--bad)', gap: 12 }}>
        <div className="row between">
          <span className="row" style={{ gap: 8 }}>
            <label htmlFor="sb-t" className="small">Teacher on leave</label>
            <select id="sb-t" className="input" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)}>{(teachers.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <label htmlFor="sb-d" className="small">on</label>
            <input id="sb-d" type="date" className="input" style={{ width: 170 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </span>
          {periods.length > 0 && (done ? <span className="pill ok">Covered and notified</span> : <span className="pill bad">{periods.filter((x) => !subs[pk(x.period)]).length} periods uncovered</span>)}
        </div>
        {!subsFor.data ? <Loading /> : !subsFor.data.day ? <span className="dim">No classes on Sundays.</span> : periods.length === 0 ? <span className="dim">{name} has no periods on {subsFor.data.day}.</span> : periods.map((g) => (
          <div key={g.period} className="row between" style={{ flexWrap: 'wrap' }}>
            <span>{g.classLabel} {g.subject}, period {g.period} ({g.time})</span>
            <select aria-label={`Substitute for ${g.classLabel} period ${g.period}`} className="input" style={{ width: 'auto', minWidth: 260 }} disabled={done} value={subs[pk(g.period)] ?? ''} onChange={(e) => setSubs({ ...subs, [pk(g.period)]: e.target.value })}>
              <option value="">Choose a free teacher…</option>
              {g.free.map((t) => <option key={t.id} value={t.name}>{t.name} · {t.subjects.join(', ')}{t.knowsClass ? ' (teaches this class)' : ''}</option>)}
            </select>
          </div>
        ))}
        {periods.length > 0 && (
          <div className="row">
            {done
              ? <button className="btn ghost" onClick={() => { setNotified(notified.filter((x) => x !== key)); toast('Unlocked. Change a substitute, then notify again; the earlier teacher is told they are no longer needed.'); }}>Change substitutes</button>
              : <button className="btn" disabled={!allPicked} onClick={async () => { if (await confirm({ title: 'Notify substitutes?', body: <>{periods.map((g) => <div key={g.period}>{g.classLabel}, period {g.period}: <b>{subs[pk(g.period)]}</b></div>)}<p style={{ marginTop: 8 }}>Each teacher gets a WhatsApp message with the class and period.</p></>, confirm: 'Notify substitutes' })) { setNotified([...notified, key]); toast('Substitutes notified on WhatsApp.'); } }}><Icon name="users" size={18} />Notify substitutes</button>}
            {!allPicked && !done && <span className="dim small">Choose a teacher for every period first.</span>}
          </div>
        )}
      </div>
      <TimetableView key={id} id={id} />
    </>
  );
}

// ---------------------------------------------------------------- teacher AI assistant

const KINDS = { paper: 'Question paper', worksheet: 'Worksheet', lesson: 'Lesson plan', remedial: 'Remedial worksheet' } as const;
function draft(kind: keyof typeof KINDS, chapter: string, cls: string, weak: string[]) {
  const s = STEMS[chapter] ?? [`Define the key terms in ${chapter} and give one example of each.`, `Explain the main idea of ${chapter} in your own words with a diagram or example.`, `Answer the textbook exercise questions on ${chapter}, showing every step.`];
  if (kind === 'lesson') return `Lesson plan: ${chapter} (${cls}, 5 periods)\n\nLearning outcomes\n• State and apply the key results of ${chapter.toLowerCase()}.\n• Solve board-pattern 2-mark and 5-mark problems with full steps.\n\nPeriod 1. Warm-up recap (10 min), concept introduction with a real-life example (25 min), exit ticket (5 min).\nPeriod 2. Worked examples from the textbook, then pairs solve two problems.\nPeriod 3. Exercise practice: ${s[0]}\nPeriod 4. Board-pattern questions, step marks explained: what an examiner looks for.\nPeriod 5. 20-minute online check; the weakest third get the remedial worksheet.\n\nHomework: Exercise questions 1 to 6. Board tip: always write the formula before substituting.`;
  if (kind === 'remedial') return `Remedial worksheet: ${chapter}\nFor: ${weak.join(', ')} (lowest marks on this chapter)\n\nWhere marks were lost: missing formula step, unit not written, sign errors.\n\nStep 1. Fill in the blank: the formula used is ________.\nStep 2. Worked example (copy each line): ${s[0]}\nStep 3. Try it yourself, same method, new numbers: ${s[1]}\nStep 4. Check: did you write the formula, substitute, simplify and write the unit?\n\nFive short questions, easiest first. Answers on the back for self-checking.`;
  if (kind === 'worksheet') return `Worksheet: ${chapter} (${cls})\n\nA. Choose the correct answer (1 mark each)\n1. ${s[0]}\n2. ${s[2]}\n\nB. Answer briefly (2 marks each)\n3. ${s[1]}\n4. ${s[0].replace(/\d+/, (n) => String(Number(n) + 3))}\n\nC. Answer in detail (5 marks)\n5. ${s[2]}\n\nAnswer key and step marks attached for the teacher.`;
  return `Revision test: ${chapter} (${cls}) · 25 marks · 45 minutes\n\nPART I · 5 × 1 = 5\n1. ${s[0]}\n2–5. Multiple choice from the bank, mixed difficulty.\n\nPART II · 5 × 2 = 10 (answer any 5 of 7)\n6. ${s[1]}\n7–12. …\n\nPART III · 2 × 5 = 10 (answer any 2 of 3)\n13. ${s[2]}\n14–15. …\n\nMarking scheme with step marks is ready for AI correction.`;
}

type Draft = { id: string; title: string; text: string; at: string; shared: boolean; cls?: string; to?: string[] };
export function Assistant() {
  const { api, toast, session } = useApp();
  const classes = useLoad(() => api.listClasses(), []);
  const roster = useRoster();
  const [kind, setKind] = useState<keyof typeof KINDS>('worksheet');
  const [classId, setClassId] = useState('cls_s1_10a');
  const c = classes.data?.find((x) => x.id === classId) ?? classes.data?.[0];
  const cls = c?.label ?? '10-A';
  const [subject, setSubject] = useState('Maths');
  const subj = c?.subjects.includes(subject) ? subject : c?.subjects[0] ?? 'Maths';
  const chapters = chaptersOf(c?.grade ?? 10, subj);
  const [chapterPick, setChapter] = useState('Trigonometry');
  const chapter = chapters.includes(chapterPick) ? chapterPick : chapters[0];
  const weak = roster.filter((x) => x.classLabel === cls && x.average !== null).sort((a, b) => a.average! - b.average!).slice(0, 3).map((x) => x.name);
  const [text, setText] = useState('');
  const { shown, done } = useTyping(text);
  const [drafts, setDrafts] = useDemo<Draft[]>('assistant-drafts', []);
  const [material, setMaterial] = useDemo<Shared[]>('shared-material', SHARED_SAMPLE);
  const [body, setBody] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const title = `${KINDS[kind]} · ${subj}: ${chapter} · ${cls}`;
  // Worksheets go to students; question papers and lesson plans stay with the teacher.
  const forStudents = kind === 'worksheet' || kind === 'remedial';
  const keep = (shared: boolean) => {
    const id = current ?? `d${Date.now()}`;
    const rest = drafts.filter((d) => d.id !== id);
    const prev = drafts.find((d) => d.id === id);
    const final = body ?? text;
    const to = kind === 'remedial' ? weak : undefined;
    setDrafts([{ id, title, text: final, at: new Date().toISOString(), shared: shared || !!prev?.shared, cls, to }, ...rest]);
    if (shared) setMaterial([{ id, title: `${KINDS[kind]}: ${chapter}`, subject: subj, kind: KINDS[kind], text: final, cls, to, teacher: session.user.name, at: new Date().toISOString() }, ...material.filter((m) => m.id !== id)]);
    setCurrent(id);
    toast(shared ? (kind === 'remedial' ? `Shared with ${weak.join(', ')}. They see it in Homework, under Worksheets and notes, and their parents get a WhatsApp link.` : `Shared with ${cls}. Students see it in Homework, under Worksheets and notes, and parents get a WhatsApp link.`) : 'Saved to My drafts below.');
  };
  const open = drafts.find((d) => d.id === viewing);
  const [confirm, confirmEl] = useConfirm();
  const share = async () => { if (await confirm({ title: kind === 'remedial' ? `Share with ${weak.length} students?` : `Share with ${cls}?`, body: <>{kind === 'remedial' ? `${weak.join(', ')} see this worksheet. Classmates do not see who received it.` : `Every student in ${cls} sees this worksheet.`} It appears in their app under <b>Homework → Worksheets and notes</b>, and parents get a WhatsApp link. Read it through first: the AI draft may need edits.</>, confirm: 'Share' })) keep(true); };
  return (
    <>
      <PageHead eyebrow="Teacher AI assistant" title="Draft papers, worksheets and lesson plans" lede="Pick a chapter and get a first draft in the board pattern in seconds. Teachers edit it before it reaches students." />
      <div className="split" style={{ alignItems: 'start' }} data-collapse>
        <div className="card stack" style={{ gap: 14 }}>
          <div className="field"><span className="label">What do you need?</span><div className="grid cols-2" style={{ gap: 8 }}>{(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => <button key={k} type="button" className="opt" aria-pressed={kind === k} onClick={() => setKind(k)}>{KINDS[k]}</button>)}</div></div>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field"><span className="label">Class</span><select aria-label="Class" className="input" value={c?.id ?? ''} onChange={(e) => setClassId(e.target.value)}>{(classes.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
            <div className="field"><span className="label">Subject</span><select aria-label="Subject" className="input" value={subj} onChange={(e) => setSubject(e.target.value)}>{(c?.subjects ?? []).map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <div className="field"><span className="label">Chapter</span><select aria-label="Chapter" className="input" value={chapter} onChange={(e) => setChapter(e.target.value)}>{chapters.map((x) => <option key={x}>{x}</option>)}</select></div>
          <button className="btn" onClick={() => { setText(draft(kind, chapter, cls, weak)); setBody(null); setCurrent(null); }}><Icon name="spark" size={18} />Draft it</button>
          <p className="dim small">Grounded in the Samacheer Kalvi textbook and past board papers. Remedial worksheets use each student’s weak chapters from AI correction.</p>
        </div>
        <div className="card stack">
          <div className="card-head" style={{ margin: 0 }}><h2>{KINDS[kind]}</h2>{text && done && <div className="row"><button className="btn sm ghost" onClick={() => keep(false)}>{current ? 'Saved ✓' : 'Save draft'}</button>{forStudents && <button className="btn sm" disabled={!!drafts.find((d) => d.id === current)?.shared} onClick={() => void share()}><Icon name="send" size={16} />{drafts.find((d) => d.id === current)?.shared ? 'Shared ✓' : kind === 'remedial' ? `Share with ${weak.length} students` : `Share with ${cls}`}</button>}</div>}</div>
          {text ? (done ? <textarea aria-label="Edit the draft" className="input doc" style={{ minHeight: 360, fontFamily: 'inherit' }} value={body ?? text} onChange={(e) => setBody(e.target.value)} /> : <div className="doc" aria-live="polite">{shown}</div>) : <div className="empty">Your draft appears here.</div>}
          {text && done && <span className="dim small">{forStudents ? 'Edit anything above, then share. Students see it in Homework → Worksheets and notes.' : `Edit anything above. ${KINDS[kind]}s are for you, so they are saved, not shared with students.`}</span>}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>My drafts</h2><span className="dim small">{drafts.length} saved</span></div>
        <Table head={['Draft', 'Saved', 'Status', '']} empty="Drafts you save appear here." rows={drafts.map((d) => [<b key="t">{d.title}</b>, <span key="a" className="small">{relTime(d.at)}</span>, d.shared ? <span key="s" className="pill ok">{d.to?.length ? `Shared with ${d.to.length} students` : `Shared with ${d.cls ?? 'class'}`}</span> : <span key="s" className="pill">Draft</span>, <span key="o" className="row" style={{ flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setViewing(d.id)}>Open</button><button className="btn sm ghost" onClick={async () => { if (await confirm({ title: `Delete “${d.title}”?`, body: d.shared ? 'It is removed from your drafts and unshared from students.' : 'It is removed from your drafts.', confirm: 'Delete', danger: true })) { setDrafts(drafts.filter((x) => x.id !== d.id)); setMaterial(material.filter((x) => x.id !== d.id)); } }}>Delete</button></span>])} />
      </div>
      {confirmEl}
      <PrintModal title={open?.title ?? ''} open={!!open} onClose={() => setViewing(null)}>
        <Letterhead title={open?.title ?? ''}><div style={{ whiteSpace: 'pre-wrap', color: '#10232a' }}>{open?.text}</div></Letterhead>
      </PrintModal>
    </>
  );
}

// ---------------------------------------------------------------- analytics: heat map, board prediction, summaries

/** A teacher's analytics: only the classes and subjects they teach, and those students. */
function TeacherInsights() {
  const { api, go } = useApp();
  const [scope, setScope] = useState<'all' | 'last3' | 'last'>('all');
  const data = useLoad(() => api.teacherInsights({ scope }), [scope]);
  const [key, setKey] = useState('');
  const [only, setOnly] = useState(false);
  if (!data.data) return <Loading />;
  const pairs = data.data;
  if (!pairs.length) return <><PageHead eyebrow="My analytics" title="How my classes are doing" /><div className="card empty">You are not teaching a subject in any class this year.</div></>;
  const cur = pairs.find((x) => `${x.classId}|${x.subject}` === key) ?? pairs[0];
  const board = cur.grade === 10 || cur.grade === 12;
  const need = cur.students.filter((x) => x.flags.length);
  const rows = (only ? need : cur.students).slice().sort((a, b) => (a.avg ?? 101) - (b.avg ?? 101));
  return (
    <>
      <PageHead eyebrow="My analytics" title="How my classes are doing" lede="Only the classes and subjects you teach, from the tests you have marked. Use it to see which chapters to re-teach and which students need help." />
      <Seg label="Class and subject" value={`${cur.classId}|${cur.subject}`} onChange={setKey} options={pairs.map((x) => ({ value: `${x.classId}|${x.subject}`, label: `${x.classLabel} ${x.subject}` }))} />
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Seg label="Based on" value={scope} onChange={(v) => setScope(v as typeof scope)} options={[{ value: 'all', label: `All tests (${cur.testsInAll})` }, { value: 'last3', label: 'Last 3 tests' }, { value: 'last', label: 'Last test only' }]} />
        <span className="dim small">{scope === 'all' ? 'Averages use every test you have marked for this class this year.' : scope === 'last3' ? 'Averages use only your three most recent marked tests.' : 'Averages use only your most recent marked test.'} “Change” always compares the last two tests.</span>
      </div>
      <Stats items={[
        { label: `${cur.subject} average`, value: cur.average === null ? '–' : <>{cur.average}<small>%</small></>, foot: `${cur.tests.length} test${cur.tests.length === 1 ? '' : 's'} marked` },
        { label: 'Below pass mark', value: cur.students.filter((x) => x.avg !== null && x.avg < cur.passMark).length, tone: cur.students.some((x) => x.avg !== null && x.avg < cur.passMark) ? 'bad' : undefined, foot: `Pass mark ${cur.passMark}%` },
        { label: 'Need attention', value: need.length, foot: 'Low marks, a big drop or low attendance' },
        { label: 'Weakest chapter', value: cur.chapters[0] ? <>{cur.chapters[0].pct}<small>%</small></> : '–', foot: cur.chapters[0]?.chapter ?? 'Appears once marks are in' },
      ]} />
      <div className="grid cols-2">
        <div className="card stack" style={{ gap: 12 }}>
          <div className="card-head" style={{ margin: 0 }}><h2>Chapters, weakest first</h2><button className="btn sm ghost" onClick={() => go({ page: 'assistant' })}><Icon name="spark" size={16} />Make a remedial worksheet</button></div>
          {cur.chapters.length ? cur.chapters.slice(0, 8).map((c) => <Bar key={c.chapter} value={c.pct} label={c.chapter} />) : <div className="empty">Appears once you enter marks for a test.</div>}
        </div>
        <div className="card stack" style={{ gap: 12 }}>
          <div className="card-head" style={{ margin: 0 }}><h2>Test by test</h2><button className="btn sm ghost" onClick={() => go({ page: 'tests' })}>All tests</button></div>
          {cur.tests.length ? cur.tests.map((t) => <Bar key={t.id} value={t.avg} label={t.name} sub={`${formatDate(t.date)}${t.published ? '' : ' · not published yet'}`} />) : <div className="empty">No marked tests yet.</div>}
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>{cur.classLabel} students in {cur.subject}</h2>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={only} onChange={() => setOnly(!only)} />Only those who need attention ({need.length})</label>
        </div>
        <Table head={['Student', `${cur.subject} average`, 'Last test', 'Change', 'Attendance', ...(board ? ['Predicted board'] : []), 'Why']} empty="Everyone is doing fine." rows={rows.map((x) => [
          <button key="n" className="btn sm quiet" onClick={() => go({ page: 'students', id: x.id })}>{x.name}</button>,
          x.avg === null ? '–' : <b key="a" className="num" style={{ color: x.avg < cur.passMark ? 'var(--bad)' : undefined }}>{x.avg}%</b>,
          x.last === null ? '–' : `${x.last}%`,
          x.change === null ? '–' : <span key="c" className="num" style={{ color: x.change <= -10 ? 'var(--bad)' : x.change >= 10 ? 'var(--ok)' : undefined }}>{x.change > 0 ? '+' : ''}{x.change}</span>,
          <span key="t" className="num" style={{ color: x.attendance < 75 ? 'var(--bad)' : undefined }}>{x.attendance}%</span>,
          ...(board ? [x.avg === null ? '–' : `${Math.max(20, Math.round(x.avg * 1.06 + 3) - 5)}–${Math.min(100, Math.round(x.avg * 1.06 + 3) + 4)}`] : []),
          x.flags.length ? <span key="f" className="small">{x.flags.join(' · ')}</span> : <span key="f" className="dim small">–</span>,
        ])} />
        {board && <p className="dim small" style={{ marginTop: 10 }}>The predicted range is for planning extra help. Students and parents never see it.</p>}
      </div>
    </>
  );
}

export function Insights() {
  const { session } = useApp();
  return session.user.role === 'teacher' ? <TeacherInsights /> : <SchoolInsights />;
}

function SchoolInsights() {
  const { api, session } = useApp();
  const [tab, setTab] = useState<'heat' | 'predict' | 'weekly' | 'trends'>('heat');
  const dash = useLoad(() => api.dashboard(), []);
  const staff = useLoad(() => (session.user.role === 'principal' ? api.teacherOverview() : Promise.resolve([])), []);
  const roster = useRoster();
  const [board, setBoard] = useState<'10' | '12'>('10');
  const classes = (dash.data?.byClass ?? []).filter((c) => c.label.startsWith(`${board}-`));
  const chapters = board === '10' ? MATHS_CHAPTERS : HSC_MATHS;
  const cell = (ci: number, ch: number) => Math.max(28, Math.min(96, (classes[ci]?.averagePct ?? 62) + ((ch * 37 + ci * 19) % 41) - 22));
  const predicted = roster.filter((s) => s.classLabel?.startsWith(`${board}-`) && s.average !== null).map((s) => {
    const mid = Math.min(99, Math.round(s.average! * 1.06 + 3));
    return { ...s, lo: Math.max(20, mid - 5), hi: Math.min(100, mid + 4), mid, centum: mid >= 93 };
  }).sort((a, b) => b.mid - a.mid);
  const msg = { id: 'wk', schoolId: '', studentId: '', to: '', guardianName: '', template: 'report' as const, lang: 'en' as const, status: 'sent' as const, createdAt: new Date().toISOString(), body: `Weekly summary, ${session.school?.shortName}\n\nAttendance 93% (last week 91%). 2 students below 75%.\nTests: 14 marked, 11 with AI correction, 96% teacher agreement.\nWeakest: Trigonometry in 10-B (48%).\nBehind syllabus: 10-B Maths by 1 chapter.\nCentum candidates in Maths: ${predicted.filter((p) => p.centum).length}.\nOpen the dashboard for details.` };

  return (
    <>
      <PageHead eyebrow="Learning analytics" title="Board results, before the board exam" lede="Weak topics by class, a predicted board-score range for every 10th and 12th student, centum candidates, and a weekly summary on WhatsApp." />
      <Seg label="Board class" value={board} onChange={setBoard} options={[{ value: '10', label: '10th (SSLC)' }, { value: '12', label: '12th (HSC)' }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'heat', label: 'Weak-topic heat map' }, { value: 'predict', label: 'Predicted board scores' }, { value: 'weekly', label: 'Weekly summary' }, { value: 'trends', label: 'Teachers and trends' }]} />
      {tab === 'heat' && (
        <div className="card stack">
          <div className="card-head" style={{ margin: 0 }}><h2>{board}th Maths · share of marks by chapter</h2><span className="dim small">All tests this term</span></div>
          <div className="table-wrap"><div className="heat" style={{ gridTemplateColumns: `minmax(170px, 1.4fr) repeat(${Math.max(1, classes.length)}, minmax(70px, 1fr))`, minWidth: 360 }}>
            <span className="h">Chapter</span>{classes.map((c) => <span key={c.id} className="h" style={{ textAlign: 'center' }}>{c.label}</span>)}
            {chapters.map((ch, i) => [<span key={ch} className="h">{ch}</span>, ...classes.map((c, ci) => { const v = cell(ci, i); return <span key={c.id + ch} style={heat(v)} title={`${c.label} ${ch}: ${v}%`}>{v}%</span>; })])}
          </div></div>
          <div className="row small dim"><span className="pill bad">Below 45%</span><span className="pill warn">45–59%</span><span className="pill">60–74%</span><span className="pill ok">75% and above</span></div>
        </div>
      )}
      {tab === 'predict' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card">
            <Table head={['Student', 'Class', 'Internal average', 'Predicted board range', '']} rows={predicted.map((p) => [<b key="n">{p.name}</b>, p.classLabel, <span key="a" className="num">{p.average}%</span>, <span key="r" className="num">{p.lo}–{p.hi}</span>, p.centum ? <span key="c" className="pill accent"><Icon name="star" size={14} />Centum candidate</span> : p.mid < 45 ? <span key="c" className="pill bad">Pass at risk</span> : null])} />
          </div>
          <div className="card stack">
            <h3>How the range is worked out</h3>
            <p className="muted small">Internal marks are adjusted by how strictly the school marks compared with board examiners (from AI correction in board mode), then widened by how consistent each student has been. Ranges tighten as more tests are corrected.</p>
            <p className="muted small"><b>Who sees this:</b> the principal and the student’s teachers only. Predictions are for planning extra help; they are never shown to students or parents, and never used to stop a student from taking a subject.</p>
            <Stats items={[{ label: 'Centum candidates', value: predicted.filter((p) => p.centum).length }, { label: 'Pass at risk', value: predicted.filter((p) => p.mid < 45).length, tone: 'bad' }]} />
          </div>
        </div>
      )}
      {tab === 'weekly' && (
        <div className="grid cols-2">
          <div className="wa"><WaBubble m={msg} /></div>
          <div className="card stack"><h3>Sent every Saturday at 6 pm</h3><p className="muted small">To the principal and correspondent. Heads of department get the same summary for their subject.</p></div>
        </div>
      )}
      {tab === 'trends' && (
        <div className="grid cols-2">
          <div className="card">
            <div className="card-head"><h2>Teachers</h2><span className="dim small">This term</span></div>
            <Table head={['Teacher', 'Subject', 'Class average', 'Scripts corrected', 'AI agreement']} rows={(staff.data ?? []).filter((t) => t.avgPct !== null).slice(0, 8).map((t, i) => [t.name, t.subjects.join(', '), t.avgPct!, 40 + ((i * 37) % 160), 91 + (i % 7)] as const).map((r) => [<b key="t">{r[0]}</b>, r[1], <span key="a" className="num">{r[2]}%</span>, <span key="s" className="num">{r[3]}</span>, <span key="g" className="num">{r[4]}%</span>])} />
          </div>
          <div className="card stack" style={{ gap: 12 }}>
            <div className="card-head" style={{ margin: 0 }}><h2>{board}th board results</h2><span className="dim small">Sample history</span></div>
            {[['2024', 91, 4], ['2025', 94, 7], ['2026', 97, 11]].map(([y, p, c]) => <Bar key={y} value={p as number} label={`March ${y}`} sub={`${c} centums`} thresholds={[0, 0]} />)}
            <Bar value={98} label="2027 predicted" sub={`${predicted.filter((p) => p.centum).length * 3} centums`} thresholds={[0, 0]} />
          </div>
        </div>
      )}
    </>
  );
}

export { day };
