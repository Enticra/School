import { useEffect, useMemo, useState } from 'react';
import { formatDate } from '@enticra/core';
import type { Result } from '../api';
import { Icon, Loading, Modal, PageHead, Seg, useAction, useApp, useConfirm, useLoad } from '../ui';
import { Letterhead, PrintModal, QR, Stats, Table, Tabs, day } from './kit';

// ---------------------------------------------------------------- school exams: timetable, halls, seating and hall tickets

type Plan = Result<'getExamPlan'>;
type Paper = Plan['papers'][number];
type Hall = Plan['halls'][number];
type Row = Plan['students'][number];

/** A soft colour per standard, readable in light and dark themes, so mixed seating is easy to see. */
export const gradeTint = (g: number) => `hsl(${(g * 53) % 360} 65% 50% / .18)`;
const time = (t: string) => new Date(`2000-01-01T${t}`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const mins = (a: string, b: string) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); };
const dur = (a: string, b: string) => { const m = mins(a, b); return m <= 0 ? '–' : `${Math.floor(m / 60) ? `${Math.floor(m / 60)} h` : ''}${m % 60 ? ` ${m % 60} min` : ''}`.trim(); };

/** Each standard's exam timing, grouped where standards share one. Young children write short papers; 10 to 12 write the full board-style paper. */
function TimingCard({ p }: { p: Plan }) {
  const { api } = useApp();
  const ro = useReadOnly();
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<null | { grades: number[]; start: string; end: string; maxMarks: number; apply: boolean }>(null);
  const groups: { grades: number[]; start: string; end: string; maxMarks: number }[] = [];
  for (const g of [...p.grades].sort((a, b) => a - b)) {
    const t = p.timings[String(g)];
    const last = groups.at(-1);
    if (last && last.start === t.start && last.end === t.end && last.maxMarks === t.maxMarks) last.grades.push(g);
    else groups.push({ grades: [g], ...t });
  }
  const off = (g: number) => p.papers.filter((x) => x.grade === g && (x.start !== p.timings[String(g)].start || x.end !== p.timings[String(g)].end)).length;
  const span = (gs: number[]) => (gs.length === 1 ? `Standard ${gs[0]}` : gs.every((g, i) => i === 0 || g === gs[i - 1] + 1) ? `Standards ${gs[0]} to ${gs.at(-1)}` : `Standards ${gs.join(', ')}`);
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="card-head" style={{ margin: 0 }}>
        <div><h2>Timing by standard</h2><span className="dim small">Younger children write shorter papers. A new paper takes its standard’s timing.</span></div>
      </div>
      <Table head={['Standards', 'Time', 'Duration', 'Marks', '']} rows={groups.map((x) => [
        <b key="g">{span(x.grades)}</b>, <span key="t" className="small">{time(x.start)} – {time(x.end)}</span>, dur(x.start, x.end), x.maxMarks,
        ro ? <span key="a">{x.grades.some(off) ? <span className="pill warn">Some papers differ</span> : null}</span> : <button key="a" className="btn sm ghost" aria-label={`Change timing for ${span(x.grades).toLowerCase()}`} onClick={() => setEdit({ ...x, grades: [...x.grades], apply: true })}>Change</button>,
      ])} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Change exam timing">
        {edit && <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.setExamTiming(p.id, edit.grades, { start: edit.start, end: edit.end, maxMarks: edit.maxMarks }, edit.apply), (r) => `Timing saved for ${span(r.grades).toLowerCase()}.${r.moved ? ` ${r.moved} papers moved to ${time(edit.start)}.` : ''}`)) setEdit(null); }}>
          <div className="field"><span className="label">For standards</span><div className="row">{[...p.grades].sort((a, b) => a - b).map((g) => <label key={g} className="row" style={{ gap: 6 }}><input type="checkbox" checked={edit.grades.includes(g)} onChange={() => setEdit({ ...edit, grades: edit.grades.includes(g) ? edit.grades.filter((x) => x !== g) : [...edit.grades, g] })} />{g}</label>)}</div></div>
          <div className="grid cols-3" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="et-a">Starts</label><input id="et-a" type="time" className="input" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} /></div>
            <div className="field"><label htmlFor="et-b">Ends</label><input id="et-b" type="time" className="input" value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} /></div>
            <div className="field"><label htmlFor="et-m">Marks</label><input id="et-m" type="number" min={5} max={200} className="input" value={edit.maxMarks} onChange={(e) => setEdit({ ...edit, maxMarks: Number(e.target.value) })} /></div>
          </div>
          <span className="dim small">{edit.start < edit.end ? `${dur(edit.start, edit.end)} per paper.` : 'The paper must end after it starts.'}</span>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={edit.apply} onChange={() => setEdit({ ...edit, apply: !edit.apply })} />Move this exam’s papers for these standards to the new time</label>
          {p.published && edit.apply && <p className="small" style={{ color: 'var(--warn)' }}>This exam is published. Students and parents see the new time straight away.</p>}
          <div className="row"><button className="btn" disabled={busy || !edit.grades.length || edit.start >= edit.end}>Save timing</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>}
      </Modal>
    </div>
  );
}

/** The principal views exams; the exam coordinator plans and changes them. */
const useReadOnly = () => useApp().session.user.role !== 'teacher';

export function ExamHall() {
  const { api } = useApp();
  const ro = useReadOnly();
  const plans = useLoad(() => api.listExamPlans(), []);
  const [sel, setSel] = useState('');
  const id = sel || (plans.data?.find((x) => x.published) ?? plans.data?.[0])?.id || '';
  const plan = useLoad(() => (id ? api.getExamPlan(id) : Promise.resolve(null)), [id]);
  const [tab, setTab] = useState<'timetable' | 'halls' | 'seating' | 'tickets'>('timetable');
  const [planEdit, setPlanEdit] = useState<null | { mode: 'new' | 'edit' }>(null);
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  if (!plans.data) return <Loading />;
  const p = plan.data;
  const publish = async (on: boolean) => {
    if (!p) return;
    if (on && !(await ask({ title: `Publish ${p.name}?`, body: <>Students and parents of standards {p.grades.join(', ')} ({p.students.length} students) see their timetable, hall, seat and hall ticket in their portal.{Object.keys(p.withheld).length > 0 && <> {Object.keys(p.withheld).length} hall tickets stay withheld with the reason you gave.</>}</>, confirm: 'Publish' }))) return;
    if (!on && !(await ask({ title: `Take back ${p.name}?`, body: 'Students and parents no longer see this exam until you publish it again. Use this while you make big changes.', confirm: 'Unpublish', danger: true }))) return;
    await run(() => api.publishExamPlan(p.id, on), on ? 'Published. Students and parents can see it now.' : 'Unpublished. Make your changes, then publish again.');
  };
  const remove = async () => {
    if (!p || !(await ask({ title: `Delete ${p.name}?`, body: <>Its timetable ({p.papers.length} papers), seating and hall tickets are deleted.{p.published && <> It is published, so students and parents will no longer see it.</>} Halls are kept.</>, confirm: 'Delete exam', danger: true }))) return;
    if (await run(() => api.deleteExamPlan(p.id), (r) => `${r.deleted} deleted.`)) setSel('');
  };
  return (
    <>
      <PageHead eyebrow="Exams" title={p?.name ?? 'Exams'} lede="The timetable for every standard, exam halls, seating that mixes standards so neighbours write different papers, and hall tickets for every student.">
        {plans.data.length > 1 && <><label className="sr" htmlFor="xp-sel">Exam</label><select id="xp-sel" className="input" style={{ width: 'auto' }} value={id} onChange={(e) => setSel(e.target.value)}>{plans.data.map((x) => <option key={x.id} value={x.id}>{x.name}{x.published ? '' : ' (draft)'}</option>)}</select></>}
        {!ro && <button className="btn ghost" onClick={() => setPlanEdit({ mode: 'new' })}><Icon name="plus" size={18} />New exam</button>}
        {p && !ro && (p.published ? <button className="btn ghost" disabled={busy} onClick={() => void publish(false)}>Unpublish</button> : <button className="btn" disabled={busy || p.problems.length > 0} title={p.problems[0]} onClick={() => void publish(true)}>Publish</button>)}
      </PageHead>
      {confirmEl}
      <PlanModal open={!!planEdit} onClose={() => setPlanEdit(null)} plan={planEdit?.mode === 'edit' ? p ?? undefined : undefined} onCreated={(x) => setSel(x)} />
      {!p ? (plan.loading || plans.data.length ? <Loading /> : <div className="card empty">{ro ? 'No exams planned yet. The exam coordinator plans them.' : <>No exams yet. Click <b>New exam</b> to plan one for any standards.</>}</div>) : (
        <>
          <div className="row between">
            <span className="row" style={{ gap: 8 }}>
              {p.published ? <span className="pill ok">✓ Published to students and parents</span> : <span className="pill warn">Draft: students don’t see it yet</span>}
              <span className="dim small">Standards {p.grades.join(', ')}</span>
            </span>
            {!ro && <span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => setPlanEdit({ mode: 'edit' })}><Icon name="pen" size={16} />Edit exam</button><button className="btn sm quiet" onClick={() => void remove()}>Delete exam</button></span>}
          </div>
          {p.problems.length > 0 && <div className="card" style={{ borderColor: 'var(--warn)' }}><b>{ro ? 'Still to do before it is published' : 'Before you publish'}</b><ul className="small" style={{ margin: '6px 0 0 18px' }}>{p.problems.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {p.published && <p className="dim small">Changes you make now are seen by students and parents straight away.</p>}
          <Stats items={[
            { label: 'Standards', value: p.grades.length, foot: `${p.papers.length} papers` },
            { label: 'Students', value: p.students.length },
            { label: 'Seated', value: `${p.students.filter((s) => s.seat).length} of ${p.students.length}`, tone: p.students.some((s) => !s.seat) ? 'bad' : 'ok', foot: `${p.halls.filter((h) => h.inUse).length} halls` },
            { label: 'Hall tickets withheld', value: Object.keys(p.withheld).length, tone: Object.keys(p.withheld).length ? 'bad' : undefined },
          ]} />
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'timetable', label: 'Timetable' }, { value: 'halls', label: `Halls (${p.halls.length})` }, { value: 'seating', label: 'Seating' }, { value: 'tickets', label: 'Hall tickets' }]} />
          {tab === 'timetable' && <TimetableTab p={p} />}
          {tab === 'halls' && <HallsTab p={p} />}
          {tab === 'seating' && <SeatingTab p={p} />}
          {tab === 'tickets' && <TicketsTab p={p} />}
        </>
      )}
    </>
  );
}

function PlanModal({ open, onClose, plan, onCreated }: { open: boolean; onClose: () => void; plan?: Plan; onCreated: (id: string) => void }) {
  const { api } = useApp();
  const grades = useLoad(() => api.examGrades(), []);
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const all = grades.data ?? [];
  const [f, setF] = useState({ name: '', type: 'Half-yearly', grades: [] as number[] });
  useEffect(() => { if (open) setF(plan ? { name: plan.name, type: plan.type, grades: plan.grades } : { name: '', type: 'Annual', grades: all }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, grades.data]);
  const toggle = (g: number) => setF({ ...f, grades: f.grades.includes(g) ? f.grades.filter((x) => x !== g) : [...f.grades, g] });
  const save = async () => {
    if (plan) {
      const dropped = plan.grades.filter((g) => !f.grades.includes(g));
      if (dropped.length && !(await ask({ title: `Remove standard ${dropped.join(', ')} from ${plan.name}?`, body: 'Their papers and seats in this exam are removed.', confirm: 'Remove', danger: true }))) return;
      if (await run(() => api.updateExamPlan(plan.id, f), 'Exam updated.')) onClose();
      return;
    }
    const r = await run(() => api.createExamPlan(f), (x) => `${x.name} created. Add its papers, then allot seats.`);
    if (r) { onCreated(r.id); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title={plan ? `Edit ${plan.name}` : 'New exam'}>
      {confirmEl}
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="xp-n">Name</label><input id="xp-n" className="input" placeholder="Annual exams 2027" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="xp-t">Type</label><select id="xp-t" className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['Unit Test', 'Quarterly', 'Half-yearly', 'Revision Test', 'Model Exam', 'Annual'].map((x) => <option key={x}>{x}</option>)}</select></div>
        </div>
        <div className="field"><span className="label">Standards writing this exam</span>
          <div className="row">{all.map((g) => <label key={g} className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.grades.includes(g)} onChange={() => toggle(g)} />{g}</label>)}</div>
          <span className="row" style={{ gap: 6, marginTop: 6 }}><button type="button" className="btn sm quiet" onClick={() => setF({ ...f, grades: all })}>All</button><button type="button" className="btn sm quiet" onClick={() => setF({ ...f, grades: all.filter((g) => g >= 6) })}>6 to 12</button><button type="button" className="btn sm quiet" onClick={() => setF({ ...f, grades: all.filter((g) => g <= 5) })}>1 to 5</button></span>
        </div>
        <div className="row"><button className="btn" disabled={busy || !f.name.trim() || !f.grades.length}>{plan ? 'Save changes' : 'Create exam'}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- timetable

function TimetableTab({ p }: { p: Plan }) {
  const { api } = useApp();
  const ro = useReadOnly();
  const { run } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [std, setStd] = useState('all');
  const [edit, setEdit] = useState<null | Partial<Paper>>(null);
  const rows = p.papers.filter((x) => std === 'all' || x.grade === Number(std));
  const missing = p.grades.map((g) => ({ g, left: (p.subjectsByGrade[g] ?? []).filter((s) => !p.papers.some((x) => x.grade === g && x.subject === s)) })).filter((x) => x.left.length);
  return (
    <>
    <TimingCard p={p} />
    <div className="card">
      {confirmEl}
      <div className="card-head">
        <span className="row" style={{ gap: 8 }}><label htmlFor="tt-std" className="small">Standard</label><select id="tt-std" className="input" style={{ width: 'auto' }} value={std} onChange={(e) => setStd(e.target.value)}><option value="all">All standards</option>{p.grades.map((g) => <option key={g} value={g}>Standard {g}</option>)}</select></span>
        {!ro && <button className="btn sm" onClick={() => setEdit({ grade: std === 'all' ? p.grades[0] : Number(std) })}><Icon name="plus" size={16} />Add paper</button>}
      </div>
      <Table head={['Date', 'Time', 'Standard', 'Subject', 'Marks', '']} empty="No papers yet. Add the first one."
        rows={rows.map((x) => [<b key="d">{formatDate(x.date)}</b>, <span key="t" className="small">{time(x.start)} – {time(x.end)}<span className="dim"> · {dur(x.start, x.end)}</span></span>, <span key="g" className="pill" style={{ background: gradeTint(x.grade) }}>{x.grade}</span>, x.subject, x.maxMarks,
          ro ? <span key="a" /> : <span key="a" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setEdit(x)}>Edit</button><button className="btn sm quiet" onClick={async () => { if (await ask({ title: `Remove ${x.subject} for standard ${x.grade}?`, body: p.published ? 'The exam is published, so students see the change at once.' : 'It is taken off the timetable.', confirm: 'Remove paper', danger: true })) void run(() => api.removePaper(p.id, x.id), (r) => `${r.removed} removed.`); }}>Remove</button></span>])} />
      {missing.length > 0 && <p className="dim small" style={{ marginTop: 10 }}>Not scheduled yet: {missing.slice(0, 6).map((x) => `${x.g}: ${x.left.join(', ')}`).join(' · ')}{missing.length > 6 ? ' …' : ''}</p>}
      <PaperModal p={p} paper={edit} onClose={() => setEdit(null)} />
    </div>
    </>
  );
}

function PaperModal({ p, paper, onClose }: { p: Plan; paper: Partial<Paper> | null; onClose: () => void }) {
  const { api } = useApp();
  const { run, busy } = useAction();
  const [f, setF] = useState({ grade: 10, subject: '', date: day(14), start: '10:00', end: '13:00', maxMarks: 100 });
  useEffect(() => {
    if (!paper) return;
    const grade = paper.grade ?? p.grades[0];
    const free = (p.subjectsByGrade[grade] ?? []).find((s) => !p.papers.some((x) => x.grade === grade && x.subject === s)) ?? p.subjectsByGrade[grade]?.[0] ?? '';
    const t = p.timings[String(grade)];
    setF({ grade, subject: paper.subject ?? free, date: paper.date ?? day(14), start: paper.start ?? t.start, end: paper.end ?? t.end, maxMarks: paper.maxMarks ?? t.maxMarks });
  }, [paper, p]);
  const subjects = p.subjectsByGrade[f.grade] ?? [];
  const save = async () => { if (await run(() => api.savePaper(p.id, { ...f, id: paper?.id }), paper?.id ? 'Paper updated.' : 'Paper added.')) onClose(); };
  return (
    <Modal open={!!paper} onClose={onClose} title={paper?.id ? 'Edit paper' : 'Add a paper'}>
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="pp-g">Standard</label><select id="pp-g" className="input" value={f.grade} onChange={(e) => { const g = Number(e.target.value); const t = p.timings[String(g)]; setF({ ...f, grade: g, ...(paper?.id ? {} : { start: t.start, end: t.end, maxMarks: t.maxMarks }), subject: (p.subjectsByGrade[g] ?? []).includes(f.subject) ? f.subject : p.subjectsByGrade[g]?.[0] ?? '' }); }}>{p.grades.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
          <div className="field"><label htmlFor="pp-s">Subject</label><select id="pp-s" className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })}>{subjects.map((s) => <option key={s} disabled={s !== paper?.subject && p.papers.some((x) => x.grade === f.grade && x.subject === s)}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="pp-d">Date</label><input id="pp-d" type="date" className="input" min={day(0)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="field"><label htmlFor="pp-m">Maximum marks</label><input id="pp-m" type="number" min={5} max={200} className="input" value={f.maxMarks} onChange={(e) => setF({ ...f, maxMarks: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="pp-a">Starts</label><input id="pp-a" type="time" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          <div className="field"><label htmlFor="pp-b">Ends</label><input id="pp-b" type="time" className="input" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        </div>
        {p.published && <p className="small" style={{ color: 'var(--warn)' }}>This exam is published. Students and parents see the change straight away.</p>}
        <div className="row"><button className="btn" disabled={busy || !f.subject || !f.date || f.start >= f.end}>{paper?.id ? 'Save changes' : 'Add paper'}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- halls

function HallsTab({ p }: { p: Plan }) {
  const { api } = useApp();
  const ro = useReadOnly();
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [edit, setEdit] = useState<null | { id?: string; name: string; where: string; rows: number; cols: number }>(null);
  const seatedIn = (h: Hall) => p.students.filter((s) => s.hallId === h.id).length;
  const save = async () => {
    if (!edit) return;
    const r = await run(() => (edit.id ? api.updateHall(edit.id, edit) : api.addHall(edit)), (h) => `${h.name} saved: ${h.rows * h.cols} seats.`);
    if (r) setEdit(null);
  };
  return (
    <div className="card">
      {confirmEl}
      <div className="card-head"><h2>Exam halls</h2>{!ro && <button className="btn sm" onClick={() => setEdit({ name: `Hall ${p.halls.length + 1}`, where: '', rows: 6, cols: 6 })}><Icon name="plus" size={16} />Add hall</button>}</div>
      <Table head={['Hall', 'Where', 'Layout', 'Seats', 'Seated in this exam', '']} empty="No halls yet."
        rows={p.halls.map((h) => [<b key="n">{h.name}</b>, h.where || <span key="w" className="dim">–</span>, `${h.rows} rows × ${h.cols}`, h.capacity, seatedIn(h) || <span key="s" className="dim">–</span>,
          ro ? <span key="a" /> : <span key="a" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setEdit({ id: h.id, name: h.name, where: h.where, rows: h.rows, cols: h.cols })}>Edit</button><button className="btn sm quiet" disabled={busy} onClick={async () => { if (await ask({ title: `Remove ${h.name}?`, body: 'Only a hall with no students seated in any exam can be removed.', confirm: 'Remove hall', danger: true })) void run(() => api.removeHall(h.id), (r) => `${r.removed} removed.`); }}>Remove</button></span>])} />
      <p className="dim small" style={{ marginTop: 10 }}>{p.halls.reduce((t, h) => t + h.capacity, 0)} seats in all halls for {p.students.length} students writing {p.name}.</p>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'Add a hall'}>
        {edit && (
          <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="hl-n">Name</label><input id="hl-n" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="hl-w">Where</label><input id="hl-w" className="input" placeholder="Main block, first floor" value={edit.where} onChange={(e) => setEdit({ ...edit, where: e.target.value })} /></div>
              <div className="field"><label htmlFor="hl-r">Rows</label><input id="hl-r" type="number" min={1} max={30} className="input" value={edit.rows} onChange={(e) => setEdit({ ...edit, rows: Number(e.target.value) })} /></div>
              <div className="field"><label htmlFor="hl-c">Seats in a row</label><input id="hl-c" type="number" min={1} max={20} className="input" value={edit.cols} onChange={(e) => setEdit({ ...edit, cols: Number(e.target.value) })} /></div>
            </div>
            <span className="dim small">{(edit.rows || 0) * (edit.cols || 0)} seats</span>
            <div className="row"><button className="btn" disabled={busy || !edit.name.trim()}>{edit.id ? 'Save changes' : 'Add hall'}</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- seating

function SeatingTab({ p }: { p: Plan }) {
  const { api } = useApp();
  const ro = useReadOnly();
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [use, setUse] = useState<string[]>(p.halls.filter((h) => h.inUse).map((h) => h.id));
  const [hallId, setHallId] = useState(p.halls.find((h) => h.inUse)?.id ?? p.halls[0]?.id ?? '');
  const [sitPick, setSitting] = useState(p.sittings[0]?.key ?? '');
  const sit = p.sittings.find((x) => x.key === sitPick) ?? p.sittings[0];
  const inSit = (s: Row) => !!sit && sit.grades.includes(s.grade);
  const biggest = Math.max(0, ...p.sittings.map((x) => x.students));
  const sitLabel = (x: (typeof p.sittings)[number]) => `${time(x.start)} · Std ${x.grades.at(-1)}–${x.grades[0]}`;
  const [moving, setMoving] = useState<null | { row: Row; hallId: string; seat: number }>(null);
  const [q, setQ] = useState('');
  const [printing, setPrinting] = useState(false);
  const cap = p.halls.filter((h) => use.includes(h.id)).reduce((t, h) => t + h.capacity, 0);
  const hall = p.halls.find((h) => h.id === hallId);
  const bySeat = useMemo(() => new Map(p.students.filter((s) => s.hallId === hallId && inSit(s)).map((s) => [s.seat!, s])), [p, hallId, sit]); // eslint-disable-line react-hooks/exhaustive-deps
  const found = q.trim().length > 1 ? p.students.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5) : [];
  const allot = async () => {
    if (p.students.some((s) => s.seat) && !(await ask({ title: 'Allot seats again?', body: <>All {p.students.length} students get new seats in the halls ticked. Seats you moved by hand are replaced.{p.published && <> The exam is published, so students see their new seat at once; tell them if hall tickets were already printed.</>}</>, confirm: 'Allot seats', danger: p.published }))) return;
    await run(() => api.allotSeats(p.id, use), (r) => `${r.seated} students seated in ${r.halls} halls${r.sittings > 1 ? `, in ${r.sittings} sittings that reuse the same halls` : ''}, standards mixed.`);
  };
  return (
    <div className="stack">
      {confirmEl}
      {!ro && <div className="card stack" style={{ gap: 10 }}>
        <div className="card-head" style={{ margin: 0 }}><h2>Allot seats</h2><span className={`pill ${cap >= biggest ? 'ok' : 'bad'}`}>{cap} seats for the largest sitting of {biggest}</span></div>
        <div className="row">{p.halls.map((h) => <label key={h.id} className="row" style={{ gap: 6 }}><input type="checkbox" checked={use.includes(h.id)} onChange={() => setUse(use.includes(h.id) ? use.filter((x) => x !== h.id) : [...use, h.id])} />{h.name} ({h.capacity})</label>)}</div>
        <div className="row"><button className="btn" disabled={busy || !use.length || cap < biggest} onClick={() => void allot()}>{p.students.some((s) => s.seat) ? 'Allot seats again' : 'Allot seats'}</button>
          <span className="dim small">Students sit hall by hall, row by row, with a different standard on each side wherever possible.</span></div>
      </div>}
      <div className="card stack" style={{ gap: 10 }}>
        <div className="card-head" style={{ margin: 0 }}><h2>Who shares the halls</h2><span className="dim small">{p.sittings.length} sitting{p.sittings.length > 1 ? 's' : ''}</span></div>
        <p className="muted small" style={{ margin: 0 }}>Standards whose papers are at the same time sit together in one sitting, mixed so the students on either side write a different paper. Standards that write at another time are a separate sitting and use the same halls and seat numbers again. Change the timing of a standard in the Timetable tab to move it to another sitting.</p>
        <Table head={['Sitting', 'Time', 'Students', 'Seated']} rows={p.sittings.map((x) => [<b key="g">Standards {[...x.grades].reverse().join(', ')}</b>, <span key="t" className="small">{time(x.start)} – {time(x.end)}</span>, x.students, <span key="s" className={`pill ${p.students.filter((st) => x.grades.includes(st.grade) && st.seat).length === x.students ? 'ok' : 'bad'}`}>{p.students.filter((st) => x.grades.includes(st.grade) && st.seat).length} of {x.students}</span>])} />
      </div>
      <div className="card stack">
        <div className="card-head" style={{ margin: 0 }}>
          <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{p.sittings.length > 1 && <><label htmlFor="st-s" className="small">Sitting</label><select id="st-s" className="input" style={{ width: 'auto' }} value={sit?.key} onChange={(e) => setSitting(e.target.value)}>{p.sittings.map((x) => <option key={x.key} value={x.key}>{sitLabel(x)}</option>)}</select></>}<label htmlFor="st-h" className="small">Hall</label><select id="st-h" className="input" style={{ width: 'auto' }} value={hallId} onChange={(e) => setHallId(e.target.value)}>{p.halls.map((h) => <option key={h.id} value={h.id}>{h.name}{h.where ? ` · ${h.where}` : ''}</option>)}</select></span>
          <span className="row" style={{ gap: 6 }}><input aria-label="Find a student" className="input" style={{ width: 200 }} placeholder="Find a student" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn sm ghost" onClick={() => setPrinting(true)}><Icon name="download" size={16} />Seating lists</button></span>
        </div>
        {found.length > 0 && <div className="list">{found.map((s) => <div key={s.id} className="row between"><span><b>{s.name}</b> <span className="dim small">{s.classLabel}, roll {s.rollNo}</span></span>{s.seat ? <button className="btn sm ghost" onClick={() => { setHallId(s.hallId!); const k = p.sittings.find((x) => x.grades.includes(s.grade))?.key; if (k) setSitting(k); setQ(''); }}>{s.hall}, seat {s.seat}</button> : <span className="pill warn">No seat</span>}</div>)}</div>}
        {hall && (
          <>
            <div className="seats" style={{ gridTemplateColumns: `repeat(${hall.cols}, minmax(0, 1fr))` }}>
              {Array.from({ length: hall.capacity }, (_, i) => i + 1).map((n) => { const s = bySeat.get(n); return (
                <button key={n} type="button" className="seat" title={s ? `${s.name}, ${s.classLabel}` : `Seat ${n}: empty`} style={{ background: s ? gradeTint(s.grade) : undefined, cursor: 'pointer' }}
                  onClick={() => s && !ro ? setMoving({ row: s, hallId: s.hallId!, seat: s.seat! }) : undefined} aria-label={s ? `Seat ${n}, ${s.name}, ${s.classLabel}${ro ? '' : '. Move'}` : `Seat ${n}, empty`}>
                  <b>{n}{s ? ` · ${s.classLabel}` : ''}</b>{s ? s.name.split(' ')[0] : <span className="dim">Empty</span>}
                </button>
              ); })}
            </div>
            <span className="dim small">Front of the hall is at the top.{ro ? '' : ' Click a student to move them; choosing a taken seat swaps the two.'}</span>
          </>
        )}
      </div>
      <Modal open={!!moving} onClose={() => setMoving(null)} title={moving ? `Move ${moving.row.name}` : ''}>
        {moving && (
          <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.moveSeat(p.id, moving.row.id, moving.hallId, moving.seat), (r) => r.swappedWith ? `Moved. ${moving.row.name} and ${r.swappedWith} swapped seats.` : 'Moved to an empty seat.')) setMoving(null); }}>
            <span className="muted small">{moving.row.classLabel}, roll {moving.row.rollNo} · now in {moving.row.hall}, seat {moving.row.seat}</span>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="mv-h">Hall</label><select id="mv-h" className="input" value={moving.hallId} onChange={(e) => setMoving({ ...moving, hallId: e.target.value, seat: 1 })}>{p.halls.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
              <div className="field"><label htmlFor="mv-s">Seat</label><input id="mv-s" type="number" min={1} max={p.halls.find((h) => h.id === moving.hallId)?.capacity} className="input" value={moving.seat} onChange={(e) => setMoving({ ...moving, seat: Number(e.target.value) })} /></div>
            </div>
            {(() => { const there = p.students.find((s) => s.hallId === moving.hallId && s.seat === moving.seat && s.id !== moving.row.id && s.sitting === moving.row.sitting); return there ? <span className="small">Seat taken by {there.name} ({there.classLabel}). They will swap.</span> : <span className="dim small">Empty seat.</span>; })()}
            <div className="row"><button className="btn" disabled={busy}>Move</button><button type="button" className="btn ghost" onClick={() => setMoving(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
      <PrintModal title={`Seating lists · ${p.name}`} open={printing} onClose={() => setPrinting(false)} note="One list per hall, for the hall door and the invigilator.">
        {p.sittings.flatMap((x) => p.halls.filter((h) => p.students.some((s) => s.hallId === h.id && x.grades.includes(s.grade))).map((h) => (
          <div key={x.key + h.id} className="ticket-page"><Letterhead title={`${p.name} · ${h.name}${h.where ? `, ${h.where}` : ''} · ${time(x.start)} sitting`}>
            <table><thead><tr><th>Seat</th><th>Name</th><th>Class</th><th>Roll</th><th>Hall ticket</th></tr></thead>
              <tbody>{p.students.filter((s) => s.hallId === h.id && x.grades.includes(s.grade)).sort((a, b) => a.seat! - b.seat!).map((s) => <tr key={s.id}><td>{s.seat}</td><td>{s.name}</td><td>{s.classLabel}</td><td>{s.rollNo}</td><td>{s.ticketNo}</td></tr>)}</tbody></table>
          </Letterhead></div>
        )))}
      </PrintModal>
    </div>
  );
}

// ---------------------------------------------------------------- hall tickets

function TicketsTab({ p }: { p: Plan }) {
  const { api } = useApp();
  const ro = useReadOnly();
  const { run, busy } = useAction();
  const classes = [...new Set(p.students.map((s) => s.classLabel))];
  const [cls, setCls] = useState(classes[0] ?? '');
  const [one, setOne] = useState<Row | null>(null);
  const [batch, setBatch] = useState<Row[] | null>(null);
  const [hold, setHold] = useState<null | { row: Row; reason: string }>(null);
  const rows = p.students.filter((s) => cls === 'all' || s.classLabel === cls);
  const ready = (s: Row) => !!s.seat && !s.withheld;
  return (
    <div className="card">
      <div className="card-head">
        <span className="row" style={{ gap: 8 }}><label htmlFor="tk-c" className="small">Class</label><select id="tk-c" className="input" style={{ width: 'auto' }} value={cls} onChange={(e) => setCls(e.target.value)}><option value="all">All classes</option>{classes.map((c) => <option key={c}>{c}</option>)}</select></span>
        <span className="row" style={{ gap: 6 }}>
          <button className="btn sm" disabled={!rows.some(ready)} onClick={() => setBatch(rows.filter(ready))}><Icon name="download" size={16} />Print {rows.filter(ready).length} hall tickets</button>
        </span>
      </div>
      <Table head={['Student', 'Class', 'Hall ticket no.', 'Hall and seat', 'Status', '']} empty="No students."
        rows={rows.map((s) => [<b key="n">{s.name}</b>, `${s.classLabel} · ${s.rollNo}`, <span key="t" className="num">{s.ticketNo}</span>, s.seat ? `${s.hall}, seat ${s.seat}` : <span key="h" className="pill warn">No seat yet</span>,
          s.withheld ? <span key="s" className="pill bad" title={s.withheld}>Withheld</span> : s.seat ? <span key="s" className="pill ok">Ready</span> : <span key="s" className="dim">–</span>,
          <span key="a" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn sm ghost" disabled={!s.seat} onClick={() => setOne(s)}>View</button>
            {ro ? null : s.withheld ? <button className="btn sm quiet" disabled={busy} onClick={() => void run(() => api.setTicketHold(p.id, s.id, null), `${s.name}’s hall ticket released.`)}>Release</button> : <button className="btn sm quiet" onClick={() => setHold({ row: s, reason: '' })}>Withhold</button>}</span>])} />
      {rows.some((s) => s.withheld) && <p className="dim small" style={{ marginTop: 8 }}>Withheld: {rows.filter((s) => s.withheld).map((s) => `${s.name} (${s.withheld})`).join('; ')}</p>}
      <Modal open={!!hold} onClose={() => setHold(null)} title={hold ? `Withhold ${hold.row.name}’s hall ticket?` : ''}>
        {hold && (
          <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.setTicketHold(p.id, hold.row.id, hold.reason), 'Hall ticket withheld. The family sees the reason in their portal.')) setHold(null); }}>
            <p className="small">The student and parent see this reason instead of the hall ticket until you release it.</p>
            <div className="field"><label htmlFor="hd-r">Reason</label><select id="hd-r" className="input" value={hold.reason} onChange={(e) => setHold({ ...hold, reason: e.target.value })}><option value="">Choose a reason</option>{['Term fee pending. Please meet the office before the exam.', 'Attendance below the required level. Please meet the principal.', 'Documents pending. Please meet the office.'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="row"><button className="btn danger" disabled={busy || !hold.reason}>Withhold</button><button type="button" className="btn ghost" onClick={() => setHold(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
      <PrintModal title={one ? `Hall ticket · ${one.name}` : ''} open={!!one} onClose={() => setOne(null)} note={one?.withheld ? `Withheld: ${one.withheld}` : 'Print it or save it as PDF.'}>
        {one && <HallTicket exam={p.name} ticketNo={one.ticketNo} student={one} hall={p.halls.find((h) => h.id === one.hallId) ?? null} seat={one.seat} papers={p.papers.filter((x) => x.grade === one.grade)} />}
      </PrintModal>
      <PrintModal title={`Hall tickets · ${cls === 'all' ? 'all classes' : cls}`} open={!!batch} onClose={() => setBatch(null)} note="One hall ticket per page. Withheld tickets and students without a seat are left out.">
        {batch?.map((s) => <div key={s.id} className="ticket-page"><HallTicket exam={p.name} ticketNo={s.ticketNo} student={s} hall={p.halls.find((h) => h.id === s.hallId) ?? null} seat={s.seat} papers={p.papers.filter((x) => x.grade === s.grade)} /></div>)}
      </PrintModal>
    </div>
  );
}

export function HallTicket({ exam, ticketNo, student, hall, seat, papers }: {
  exam: string; ticketNo: string; student: { id: string; name: string; classLabel: string; rollNo: number };
  hall: { name: string; where: string } | null; seat: number | null; papers: { id: string; subject: string; date: string; start: string; end: string; maxMarks: number }[];
}) {
  const { session } = useApp();
  return (
    <Letterhead title={`Hall ticket · ${exam}`}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'nowrap' }}>
        <div className="facts" style={{ flex: 1 }}>
          <div><b>Student</b>{student.name}</div><div><b>Class</b>{student.classLabel} · Roll {student.rollNo}</div>
          <div><b>Hall ticket no.</b>{ticketNo}</div><div><b>Hall and seat</b>{hall ? `${hall.name}${hall.where ? ` (${hall.where})` : ''} · Seat ${seat}` : 'Not allotted yet'}</div>
        </div>
        <QR text={`${ticketNo}:${student.id}`} size={104} />
      </div>
      <table><thead><tr><th>Date</th><th>Subject</th><th>Time</th><th>Marks</th></tr></thead><tbody>{papers.map((d) => <tr key={d.id}><td>{formatDate(d.date)}</td><td>{d.subject}</td><td>{time(d.start)} – {time(d.end)}</td><td>{d.maxMarks}</td></tr>)}</tbody></table>
      <p className="small" style={{ marginTop: 8 }}>Report 30 minutes before the start. Bring this hall ticket and your ID card. The QR code on this ticket also goes on the answer booklet.</p>
      <div className="sig"><span>Class advisor</span><span>Principal · {session.school?.shortName}</span></div>
    </Letterhead>
  );
}

// ---------------------------------------------------------------- student and parent view

export function StudentExams() {
  const { api, session } = useApp();
  const kids = session.children;
  const [kid, setKid] = useState(kids[0]?.id ?? '');
  const mine = useLoad(() => api.myExams(kid), [kid]);
  const [pick, setPick] = useState('');
  const [printing, setPrinting] = useState(false);
  if (!mine.data) return <Loading />;
  const x = mine.data.find((e) => e.id === pick) ?? mine.data[0];
  return (
    <>
      <PageHead eyebrow="Exams" title={x?.name ?? 'Exams'} lede={session.user.role === 'parent' ? 'Your child’s exam dates, hall, seat and hall ticket.' : 'Your exam dates, where you sit, and your hall ticket.'}>
        {x && !x.withheld && x.seat && <button className="btn" onClick={() => setPrinting(true)}><Icon name="download" size={18} />Hall ticket</button>}
      </PageHead>
      {kids.length > 1 && <Seg label="Child" value={kid} onChange={(v) => { setKid(v); setPick(''); }} options={kids.map((k) => ({ value: k.id, label: k.name }))} />}
      {mine.data.length > 1 && <Seg label="Exam" value={x.id} onChange={setPick} options={mine.data.map((e) => ({ value: e.id, label: e.name }))} />}
      {!x ? <div className="card empty">The school has not published an exam timetable yet. It appears here as soon as it does.</div> : (
        <>
          {x.withheld && <div className="card" style={{ borderColor: 'var(--bad)' }}><b>Hall ticket withheld.</b> <span className="muted">{x.withheld}</span></div>}
          <Stats items={[
            { label: 'Hall', value: x.hall?.name ?? '–', foot: x.hall?.where || undefined },
            { label: 'Seat', value: x.seat ?? '–' },
            { label: 'First exam', value: x.papers[0] ? formatDate(x.papers[0].date) : '–', foot: x.papers[0] ? `${x.papers[0].subject}, ${time(x.papers[0].start)}` : undefined },
            { label: 'Papers', value: x.papers.length, foot: 'Report 30 minutes early' },
          ]} />
          <div className="split" style={{ alignItems: 'start' }}>
            <div className="card"><div className="card-head"><h2>Timetable</h2><span className="dim small">{x.student.classLabel}</span></div>
              <Table head={['Date', 'Subject', 'Time', 'Marks']} empty="No papers yet." rows={x.papers.map((d) => [<b key="d">{formatDate(d.date)}</b>, d.subject, `${time(d.start)} – ${time(d.end)}`, d.maxMarks])} /></div>
            {x.hall && x.seat && (
              <div className="card stack">
                <div className="card-head" style={{ margin: 0 }}><h3>Where you sit · {x.hall.name}</h3></div>
                <div className="seats" style={{ gridTemplateColumns: `repeat(${x.hall.cols}, minmax(0, 1fr))` }}>{Array.from({ length: x.hall.rows * x.hall.cols }, (_, i) => i + 1).map((n) => <span key={n} style={n === x.seat ? { background: 'var(--school-accent)', color: 'var(--on-accent)' } : undefined}><b>{n}</b>{n === x.seat ? 'You' : ''}</span>)}</div>
                <span className="dim small">The front of the hall is at the top. Seats are numbered left to right, row by row.</span>
              </div>
            )}
          </div>
          <PrintModal title={`Hall ticket · ${x.student.name}`} open={printing} onClose={() => setPrinting(false)} note="Print it or save it as PDF.">
            <HallTicket exam={x.name} ticketNo={x.ticketNo} student={x.student} hall={x.hall} seat={x.seat} papers={x.papers} />
          </PrintModal>
        </>
      )}
    </>
  );
}
