import { useEffect, useMemo, useState } from 'react';
import { formatDate, isoDate, type Question } from '@enticra/core';
import { Bar, Icon, Loading, Modal, PageHead, Seg, useAction, useApp, useConfirm, useLoad } from '../ui';
import { Letterhead, PrintModal, Tabs } from '../showcase/kit';

export function Tests() {
  const { api, go, session } = useApp();
  const [classId, setClassId] = useState('all');
  const [std, setStd] = useState('all');
  const [creating, setCreating] = useState(false);
  const viewOnly = session.user.role === 'principal';
  const classes = useLoad(() => api.listClasses(), []);
  const exams = useLoad(() => api.listExams(), []);
  if (!classes.data || !exams.data) return <Loading />;
  const gradeOf = new Map(classes.data.map((c) => [c.id, c.grade]));
  const grades = [...new Set(classes.data.map((c) => c.grade))].sort((a, b) => b - a);
  const inStd = (id: string) => std === 'all' || String(gradeOf.get(id)) === std;
  const list = exams.data.filter((e) => inStd(e.classId) && (classId === 'all' || e.classId === classId));

  return (
    <>
      <PageHead title="Tests and marks" lede={viewOnly ? 'Every test set by teachers, by standard and class, with marks and class averages. Teachers create tests, enter marks and publish them.' : 'Create a test with its marking scheme, enter marks per question, or let AI correction do the first pass. Parents hear when you publish.'}>
        {!viewOnly && <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" size={18} />New test</button>}
      </PageHead>
      <div className="card">
        <div className="card-head">
          <div className="row">
            {grades.length > 1 && <><label className="sr" htmlFor="ts-g">Standard</label><select id="ts-g" className="input" style={{ width: 'auto' }} value={std} onChange={(e) => { setStd(e.target.value); setClassId('all'); }}><option value="all">All standards</option>{grades.map((g) => <option key={g} value={g}>Standard {g}</option>)}</select></>}
            <label className="sr" htmlFor="ts-c">Class</label><select id="ts-c" className="input" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="all">All classes</option>{classes.data.filter((c) => inStd(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </div>
          <span className="dim small">{list.length} tests</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Test</th><th>Class</th><th>Date</th><th>Status</th><th className="r">Marked</th><th style={{ width: '22%' }}>Class average</th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="click" onClick={() => go({ page: 'tests', id: e.id })}>
                  <td><b>{e.subject} · {e.name}</b><div className="dim small">{e.questions.length} questions · {e.max} marks</div></td>
                  <td>{e.classLabel}</td>
                  <td className="small">{formatDate(e.date)}</td>
                  <td>{e.status === 'published' ? <span className="pill ok">Published</span> : e.scripts.total ? <span className="pill accent"><span className="dot" />{e.scripts.toReview ? `${e.scripts.toReview} to review` : e.scripts.waiting ? `${e.scripts.waiting} scripts waiting` : 'Ready to publish'}</span> : <span className="pill warn">Marking</span>}</td>
                  <td className="r num">{e.marked}</td>
                  <td>{e.average === null ? <span className="dim small">–</span> : <Bar value={e.average} label="" thresholds={[45, 60]} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <NewTest open={creating} onClose={() => setCreating(false)} classes={classes.data} examTypes={session.school!.settings.examTypes} subjects={session.user.subjects} onCreated={(id) => { setCreating(false); go({ page: 'tests', id }); }} />
    </>
  );
}

type Draft = { text: string; maxMarks: string; chapter: string; answerKey: string; steps: { text: string; marks: string; keywords: string }[] };
const blankQ = (): Draft => ({ text: '', maxMarks: '2', chapter: '', answerKey: '', steps: [{ text: '', marks: '2', keywords: '' }] });

const toDraft = (q: Question): Draft => ({ text: q.text, maxMarks: String(q.maxMarks), chapter: q.chapter, answerKey: q.answerKey, steps: q.steps.map((x) => ({ text: x.text, marks: String(x.marks), keywords: x.keywords.join(', ') })) });

function NewTest({ open, onClose, classes, examTypes, subjects, onCreated, editing }: { open: boolean; onClose: () => void; classes: { id: string; label: string; subjects: string[] }[]; examTypes: string[]; subjects?: string[]; onCreated: (id: string) => void; editing?: { examId: string; questions: Question[] } }) {
  const { api } = useApp();
  const { run, busy } = useAction();
  const [meta, setMeta] = useState({ classId: classes[0]?.id ?? '', subject: '', name: '', type: examTypes[0], date: isoDate(new Date()) });
  const [qs, setQs] = useState<Draft[]>([blankQ()]);
  useEffect(() => { if (open && editing) setQs(editing.questions.map(toDraft)); }, [open, editing]);
  const cls = classes.find((c) => c.id === meta.classId);
  useEffect(() => { if (cls && !cls.subjects.includes(meta.subject)) setMeta((m) => ({ ...m, subject: subjects?.find((s) => cls.subjects.includes(s)) ?? cls.subjects[0] })); }, [cls, meta.subject, subjects]);
  const total = qs.reduce((t, q) => t + (Number(q.maxMarks) || 0), 0);
  const upd = (i: number, patch: Partial<Draft>) => setQs((x) => x.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  const save = async () => {
    const questions: Question[] = qs.map((q, i) => ({
      no: String(i + 1), text: q.text, maxMarks: Number(q.maxMarks), chapter: q.chapter, answerKey: q.answerKey,
      steps: q.steps.filter((s) => s.text.trim()).map((s) => ({ text: s.text, marks: Number(s.marks), keywords: s.keywords.split(',') })),
    }));
    if (editing) { if (await run(() => api.updateExam(editing.examId, { questions }), 'Questions saved.')) onCreated(editing.examId); return; }
    const exam = await run(() => api.createExam({ ...meta, questions }), 'Test created. Enter marks or upload scripts for AI correction.');
    if (exam) { onCreated(exam.id); setQs([blankQ()]); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit questions' : 'New test'} wide>
      <div className="stack" style={{ gap: 16 }}>
        {!editing && <>
        <div className="grid cols-4" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="nt-class">Class</label><select id="nt-class" className="input" value={meta.classId} onChange={(e) => setMeta({ ...meta, classId: e.target.value })}>{classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          <div className="field"><label htmlFor="nt-subject">Subject</label><select id="nt-subject" className="input" value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })}>{cls?.subjects.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="nt-type">Exam type</label><select id="nt-type" className="input" value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value })}>{examTypes.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="nt-date">Date</label><input id="nt-date" type="date" className="input" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="nt-name">Test name</label><input id="nt-name" className="input" placeholder={`${meta.type} 3`} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></div>
        </>}
        <div className="row between"><h3>Questions and marking scheme</h3><span className="pill">{qs.length} questions · {total} marks</span></div>
        {qs.map((q, i) => (
          <div key={i} className="qcard">
            <div className="row between"><b>Q{i + 1}</b>{qs.length > 1 && <button className="btn sm ghost" onClick={() => setQs((x) => x.filter((_, j) => j !== i))}>Remove</button>}</div>
            <div className="grid" data-collapse style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,1.4fr) 90px', gap: 10 }}>
              <div className="field"><label htmlFor={`q${i}-text`}>Question</label><input id={`q${i}-text`} className="input" value={q.text} onChange={(e) => upd(i, { text: e.target.value })} /></div>
              <div className="field"><label htmlFor={`q${i}-ch`}>Chapter</label><input id={`q${i}-ch`} className="input" value={q.chapter} onChange={(e) => upd(i, { chapter: e.target.value })} /></div>
              <div className="field"><label htmlFor={`q${i}-m`}>Marks</label><input id={`q${i}-m`} className="input num" inputMode="decimal" value={q.maxMarks} onChange={(e) => upd(i, { maxMarks: e.target.value, steps: q.steps.length === 1 ? [{ ...q.steps[0], marks: e.target.value }] : q.steps })} /></div>
            </div>
            <div className="field"><label htmlFor={`q${i}-key`}>Answer key</label><input id={`q${i}-key`} className="input" value={q.answerKey} onChange={(e) => upd(i, { answerKey: e.target.value })} /></div>
            <span className="label small muted" style={{ fontWeight: 650 }}>Step marks (what an examiner looks for)</span>
            {q.steps.map((s, k) => (
              <div key={k} className="grid" data-collapse style={{ gridTemplateColumns: 'minmax(0,2fr) 80px minmax(0,2fr)', gap: 8 }}>
                <input aria-label="Step" className="input" placeholder="Writes the formula CSA = 2πrh" value={s.text} onChange={(e) => upd(i, { steps: q.steps.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
                <input aria-label="Step marks" className="input num" value={s.marks} onChange={(e) => upd(i, { steps: q.steps.map((x, j) => (j === k ? { ...x, marks: e.target.value } : x)) })} />
                <input aria-label="Keywords" className="input" placeholder="Keywords, comma separated: 2πrh, 440" value={s.keywords} onChange={(e) => upd(i, { steps: q.steps.map((x, j) => (j === k ? { ...x, keywords: e.target.value } : x)) })} />
              </div>
            ))}
            <button className="btn sm quiet" style={{ alignSelf: 'flex-start' }} onClick={() => upd(i, { steps: [...q.steps, { text: '', marks: '1', keywords: '' }] })}><Icon name="plus" size={16} />Add step</button>
          </div>
        ))}
        <div className="row between">
          <button className="btn ghost" onClick={() => setQs((x) => [...x, blankQ()])}><Icon name="plus" size={18} />Add question</button>
          <button className="btn" onClick={save} disabled={busy}>{editing ? 'Save questions' : 'Create test'}</button>
        </div>
      </div>
    </Modal>
  );
}

export function TestDetail({ id }: { id: string }) {
  const { api, go, session } = useApp();
  const { data, error } = useLoad(() => api.getExam(id), [id]);
  const { run, busy } = useAction();
  const useConfirmHook = useConfirm();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'marks' | 'paper' | 'analysis'>('marks');
  const [printing, setPrinting] = useState(false);
  const [editQs, setEditQs] = useState(false);
  const classes = useLoad(() => api.listClasses(), []);
  const [details, setDetails] = useState({ name: '', date: '', type: '' });
  const [edit, setEdit] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => {
    if (!data) return;
    setEdit(Object.fromEntries(data.students.map((s) => {
      const m = data.marks.find((x) => x.studentId === s.id);
      return [s.id, Object.fromEntries(data.exam.questions.map((q) => [q.no, m?.perQuestion[q.no] !== undefined ? String(m.perQuestion[q.no]) : '']))];
    })));
  }, [data]);
  const totals = useMemo(() => Object.fromEntries(Object.entries(edit).map(([sid, row]) => [sid, Object.values(row).reduce((t, v) => t + (Number(v) || 0), 0)])), [edit]);
  if (!data) return error ? (
    <>
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => go({ page: 'tests' })}><Icon name="back" size={16} />All tests</button>
      <div className="card empty stack" style={{ alignItems: 'center' }}><b>This test is no longer here.</b><span>It may have been deleted, or the sample data was reset. Find your tests in Tests and marks.</span></div>
    </>
  ) : <Loading />;
  const { exam } = data;
  const published = exam.status === 'published';
  const canEdit = session.user.role === 'teacher' && !published;
  const dirty = data.students.filter((s) => {
    const m = data.marks.find((x) => x.studentId === s.id);
    return exam.questions.some((q) => (edit[s.id]?.[q.no] ?? '') !== (m?.perQuestion[q.no] !== undefined ? String(m.perQuestion[q.no]) : ''));
  });

  const [confirm, confirmEl] = useConfirmHook;
  const types = session.school?.settings.examTypes ?? [];
  const canDelete = canEdit && !data.marks.length && !data.scripts.length;
  const publish = async () => {
    if (await confirm({ title: 'Publish to parents?', body: <>Parents of {data.marks.length} students get a WhatsApp message with their child’s marks. After publishing, marks and test details are locked.</>, confirm: 'Publish and notify parents' })) run(() => api.publishExam(exam.id), (r) => `Published. ${r.messages.length} parents notified.`);
  };
  const remove = async () => {
    if (await confirm({ title: `Delete ${exam.name}?`, body: 'This test has no marks or scripts yet. Deleting it cannot be undone.', confirm: 'Delete test', danger: true })) { go({ page: 'tests' }); await run(() => api.deleteExam(exam.id), 'Test deleted.'); }
  };
  const saveAll = async () => {
    await run(async () => { for (const s of dirty) await api.saveMarks(exam.id, s.id, Object.fromEntries(Object.entries(edit[s.id]).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]))); return dirty.length; }, (n) => `Saved marks for ${n} students.`);
  };

  return (
    <>
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => go({ page: 'tests' })}><Icon name="back" size={16} />All tests</button>
      <PageHead eyebrow={`${data.classLabel} · ${exam.type} · ${formatDate(exam.date)}`} title={`${exam.subject} · ${exam.name}`} lede={`${exam.questions.length} questions, ${data.max} marks. ${data.marks.length} of ${data.students.length} students marked.`}>
        {data.scripts.length > 0 && session.user.role === 'teacher' && <button className="btn ghost" onClick={() => go({ page: 'correction', id: exam.id })}><Icon name="spark" size={18} />AI correction</button>}
        {canEdit && <button className="btn ghost" disabled={!dirty.length || busy} onClick={saveAll}>Save {dirty.length || ''} changes</button>}
        {canEdit && <button className="btn ghost" onClick={() => { setDetails({ name: exam.name, date: exam.date, type: exam.type }); setEditing(true); }}><Icon name="pen" size={18} />Edit name, date or type</button>}
        {canDelete && <button className="btn ghost" onClick={remove}>Delete</button>}
        {canEdit && <button className="btn" disabled={busy || !data.marks.length || dirty.length > 0} title={!data.marks.length ? 'Enter marks first' : dirty.length ? 'Save your changes first' : undefined} onClick={publish}><Icon name="send" size={18} />Publish to parents</button>}
        {published && <span className="pill ok">Published</span>}
      </PageHead>
      {confirmEl}
      <Modal open={editing} onClose={() => setEditing(false)} title="Edit test details">
        <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.updateExam(exam.id, details), 'Test details saved.')) setEditing(false); }}>
          <div className="field"><label htmlFor="ed-name">Name</label><input id="ed-name" className="input" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} /></div>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="ed-date">Date</label><input id="ed-date" type="date" className="input" required value={details.date} onChange={(e) => setDetails({ ...details, date: e.target.value })} /></div>
            <div className="field"><span className="label">Type</span><select aria-label="Type" className="input" value={details.type} onChange={(e) => setDetails({ ...details, type: e.target.value })}>{types.map((t) => <option key={t}>{t}</option>)}</select></div>
          </div>
          <p className="dim small">You can change these until the test is published to parents.</p>
          <button className="btn" disabled={busy}>Save details</button>
        </form>
      </Modal>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'marks', label: 'Marks' }, { value: 'paper', label: `Question paper (${exam.questions.length})` }, { value: 'analysis', label: 'Analysis' }]} />
      {tab === 'paper' && (() => {
        const qAvg = (no: string, max: number) => { const v = data.marks.filter((m) => m.perQuestion[no] !== undefined); return v.length ? Math.round((v.reduce((t, m) => t + m.perQuestion[no], 0) / (v.length * max)) * 100) : null; };
        const locked = data.marks.length > 0 || data.scripts.length > 0;
        return (
          <div className="card stack" style={{ gap: 14 }}>
            <div className="card-head" style={{ margin: 0 }}>
              <div><h2>{exam.subject} · {exam.name}</h2><span className="dim small">{data.classLabel} · {exam.type} · {formatDate(exam.date)} · {exam.questions.length} questions · {data.max} marks</span></div>
              <div className="row">
                <button className="btn sm ghost" onClick={() => setPrinting(true)}><Icon name="file" size={16} />Print paper</button>
                {canEdit && <button className="btn sm ghost" disabled={locked} title={locked ? 'Marks or scripts are in, so the questions are locked' : undefined} onClick={() => setEditQs(true)}><Icon name="pen" size={16} />Edit questions</button>}
              </div>
            </div>
            {canEdit && locked && <span className="dim small">Marks or scripts are already in, so the questions are locked. You can still change the name, date and type.</span>}
            {exam.questions.map((q) => {
              const a = qAvg(q.no, q.maxMarks);
              return (
                <div key={q.no} className="qcard stack" style={{ gap: 8 }}>
                  <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <span><b>Q{q.no}.</b> {q.text}</span>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><span className="pill">{q.maxMarks} mark{q.maxMarks === 1 ? '' : 's'}</span>{a !== null && <span className={`pill ${a < 45 ? 'bad' : a < 60 ? 'warn' : 'ok'}`} title="Class average on this question">{a}%</span>}</span>
                  </div>
                  <span className="dim small">Chapter: {q.chapter}</span>
                  {q.answerKey && <span className="small"><b>Answer:</b> {q.answerKey}</span>}
                  {q.steps.length > 0 && <div className="small"><b>Marking scheme</b><ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>{q.steps.map((st, i) => <li key={i}>{st.text} <span className="dim">({st.marks})</span></li>)}</ul></div>}
                </div>
              );
            })}
            <PrintModal title={`${exam.subject} · ${exam.name}`} open={printing} onClose={() => setPrinting(false)} note="Students' copy: questions only, no answers.">
              <Letterhead title={`${exam.subject} · ${exam.name}`}>
                <div style={{ color: '#10232a' }}>
                  <p>Class {data.classLabel} · {formatDate(exam.date)} · Maximum marks {data.max}</p>
                  <ol style={{ paddingLeft: 20 }}>{exam.questions.map((q) => <li key={q.no} style={{ marginBottom: 8 }}>{q.text} <b>({q.maxMarks})</b></li>)}</ol>
                </div>
              </Letterhead>
            </PrintModal>
            {classes.data && <NewTest open={editQs} onClose={() => setEditQs(false)} classes={classes.data} examTypes={types} subjects={session.user.subjects} editing={{ examId: exam.id, questions: exam.questions }} onCreated={() => setEditQs(false)} />}
          </div>
        );
      })()}
      {tab === 'analysis' && (() => {
        const totals = data.marks.map((m) => (m.total / data.max) * 100);
        const bands = [['Below 35%', 0, 35], ['35–59%', 35, 60], ['60–74%', 60, 75], ['75–89%', 75, 90], ['90% and above', 90, 101]] as const;
        const ranked = data.students.map((st) => ({ ...st, m: data.marks.find((x) => x.studentId === st.id) })).filter((x) => x.m).sort((a, b) => a.m!.total - b.m!.total);
        return (
          <div className="grid cols-2">
            <div className="card stack" style={{ gap: 12 }}>
              <h2>By chapter</h2>
              {data.chapters.length ? data.chapters.slice().sort((a, b) => a.pct - b.pct).map((c) => <Bar key={c.chapter} value={c.pct} label={c.chapter} />) : <div className="empty">Appears once marks are in.</div>}
            </div>
            <div className="card stack" style={{ gap: 12 }}>
              <h2>How the class scored</h2>
              {totals.length ? bands.map(([l, lo, hi]) => { const n = totals.filter((t) => t >= lo && t < hi).length; return <Bar key={l} value={Math.round((n / totals.length) * 100)} label={l} sub={`${n} student${n === 1 ? '' : 's'}`} thresholds={[0, 0]} />; }) : <div className="empty">Appears once marks are in.</div>}
            </div>
            <div className="card stack" style={{ gap: 10 }}>
              <h2>Needs help</h2>
              {ranked.length ? ranked.slice(0, 5).map((x) => <div key={x.id} className="row between"><span>{x.name}</span><b className="num">{Math.round(x.m!.total * 10) / 10} / {data.max}</b></div>) : <div className="empty">Appears once marks are in.</div>}
            </div>
            <div className="card stack" style={{ gap: 10 }}>
              <h2>Top scorers</h2>
              {ranked.length ? ranked.slice(-5).reverse().map((x) => <div key={x.id} className="row between"><span>{x.name}</span><b className="num">{Math.round(x.m!.total * 10) / 10} / {data.max}</b></div>) : <div className="empty">Appears once marks are in.</div>}
            </div>
          </div>
        );
      })()}
      {tab === 'marks' && <div className="split" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Marks by question</h2>{canEdit && <span className="dim small">Type marks; totals update as you go</span>}</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th>Student</th>{exam.questions.map((q) => <th key={q.no} className="r" title={`${q.chapter}: ${q.text}`}>Q{q.no}<div className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>/{q.maxMarks}</div></th>)}<th className="r">Total</th></tr></thead>
              <tbody>
                {data.students.map((s) => {
                  const src = data.marks.find((m) => m.studentId === s.id)?.source;
                  return (
                    <tr key={s.id}>
                      <td className="dim num">{s.rollNo}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{s.name}{src === 'ai_reviewed' && <span className="pill accent" style={{ marginLeft: 6 }} title="AI first pass, approved by the teacher">AI + teacher</span>}</td>
                      {exam.questions.map((q) => (
                        <td key={q.no} className="r">
                          {canEdit ? <input aria-label={`${s.name} Q${q.no}`} className="mark-input" style={{ width: 54, height: 32 }} inputMode="decimal" value={edit[s.id]?.[q.no] ?? ''} onChange={(e) => setEdit((x) => ({ ...x, [s.id]: { ...x[s.id], [q.no]: e.target.value } }))} /> : <span className="num">{edit[s.id]?.[q.no] || '–'}</span>}
                        </td>
                      ))}
                      <td className="r num"><b>{Math.round((totals[s.id] ?? 0) * 10) / 10}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card stack" style={{ gap: 12 }}>
          <div className="card-head" style={{ margin: 0 }}><h2>By chapter</h2><button className="btn sm ghost" onClick={() => setTab('paper')}>See the questions</button></div>
          {data.chapters.length ? data.chapters.slice().sort((a, b) => a.pct - b.pct).map((c) => <Bar key={c.chapter} value={c.pct} label={c.chapter} />) : <div className="empty">Appears once marks are in.</div>}
        </div>
      </div>}
    </>
  );
}
