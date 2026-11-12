import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, isoDate } from '@enticra/core';
import type { Result } from '../api';
import { Bar, Icon, Loading, Modal, PageHead, Seg, initials, readImage, relTime, useAction, useApp, useConfirm, useLoad } from '../ui';
import { ReportCard, ReportHistory } from '../pages/Reports';
import { PrintModal, SHARED_SAMPLE, Stats, Table, Tabs, downloadCsv, useDemo, type Shared } from './kit';

// ---------------------------------------------------------------- add a student (class advisor or principal)

type Cls = Result<'listClasses'>[number];

type StudentRec = Result<'getStudent'>['student'];

/** Add a student, or edit one when `student` is given. */
export function AddStudentModal({ open, onClose, classes, student, onSaved }: { open: boolean; onClose: () => void; classes: Cls[]; student?: StudentRec; onSaved?: () => void }) {
  const { api } = useApp();
  const { run, busy } = useAction();
  const blank = { classId: classes[0]?.id ?? '', name: '', gender: '' as '' | 'F' | 'M', dob: '', guardianName: '', guardianRelation: 'Mother', guardianPhone: '', lang: 'en' as 'en' | 'ta', emis: '', whatsappConsent: false };
  const from = (x: StudentRec) => ({ classId: x.classId, name: x.name, gender: x.gender as '' | 'F' | 'M', dob: x.dob, guardianName: x.guardian.name, guardianRelation: x.guardian.relation, guardianPhone: x.guardian.phone, lang: x.guardian.lang as 'en' | 'ta', emis: x.emis, whatsappConsent: x.consent.whatsapp });
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF(student ? from(student) : { ...blank, classId: classes[0]?.id ?? '' }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ok = f.classId && f.name.trim() && f.gender && f.dob && f.guardianName.trim() && f.guardianPhone.replace(/\D/g, '').length >= 10;
  const save = async () => {
    if (!ok || !f.gender) return;
    if (student) {
      const before = from(student);
      const patch = Object.fromEntries(Object.entries(f).filter(([k, v]) => before[k as keyof typeof before] !== v));
      if (!Object.keys(patch).length) return onClose();
      const r = await run(() => api.updateStudent(student.id, patch), (x) => `${x.name}: ${x.changes.join(', ')} saved.`);
      if (r) { onClose(); onSaved?.(); }
      return;
    }
    const r = await run(() => api.addStudent({ ...f, gender: f.gender as 'F' | 'M' }), (s) => `${s.name} added to ${s.classLabel} as roll ${s.rollNo}. The parent can sign in with +91 ${s.guardian.phone}.`);
    if (r) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={student ? `Edit ${student.name}` : 'Add a student'}>
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="as-c">Class</label><select id="as-c" className="input" value={f.classId} disabled={classes.length < 2} onChange={(e) => setF({ ...f, classId: e.target.value })}>{classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>{student && f.classId !== student.classId && <span className="dim small">Moves them to the end of the new class’s roll list.</span>}</div>
          <div className="field"><label htmlFor="as-n">Student’s name</label><input id="as-n" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><span className="label">Gender</span><Seg label="Gender" value={f.gender} onChange={(v) => setF({ ...f, gender: v })} options={[{ value: 'F', label: 'Girl' }, { value: 'M', label: 'Boy' }]} /></div>
          <div className="field"><label htmlFor="as-d">Date of birth</label><input id="as-d" type="date" className="input" required max={isoDate(new Date())} value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} /></div>
          <div className="field"><label htmlFor="as-g">Parent’s name</label><input id="as-g" className="input" required value={f.guardianName} onChange={(e) => setF({ ...f, guardianName: e.target.value })} /></div>
          <div className="field"><label htmlFor="as-r">Relation</label><select id="as-r" className="input" value={f.guardianRelation} onChange={(e) => setF({ ...f, guardianRelation: e.target.value })}>{['Mother', 'Father', 'Guardian'].map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="field"><label htmlFor="as-p">Parent’s mobile</label><input id="as-p" className="input" inputMode="numeric" required placeholder="98400 12345" value={f.guardianPhone} onChange={(e) => setF({ ...f, guardianPhone: e.target.value })} /></div>
          <div className="field"><label htmlFor="as-e">EMIS number (optional)</label><input id="as-e" className="input" inputMode="numeric" placeholder="13 digits" value={f.emis} onChange={(e) => setF({ ...f, emis: e.target.value })} /></div>
          <div className="field"><span className="label">Messages in</span><Seg label="Message language" value={f.lang} onChange={(v) => setF({ ...f, lang: v })} options={[{ value: 'en', label: 'English' }, { value: 'ta', label: 'Tamil' }]} /></div>
        </div>
        <label className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}><input type="checkbox" checked={f.whatsappConsent} onChange={(e) => setF({ ...f, whatsappConsent: e.target.checked })} /><span className="small">The parent has agreed to get school updates on WhatsApp. Leave this unticked until they have; no messages go out without it.</span></label>
        <div className="row"><button className="btn" disabled={!ok || busy}>{student ? 'Save changes' : 'Add student'}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- teachers and classes (principal)

export function Teachers() {
  const { api, go } = useApp();
  const t = useLoad(() => api.teacherOverview(), []);
  const c = useLoad(() => api.classResults(), []);
  const classes = useLoad(() => api.listClasses(), []);
  const [tab, setTab] = useState<'teachers' | 'classes'>('teachers');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [classEdit, setClassEdit] = useState<null | { id: string | null }>(null);
  const [former, setFormer] = useState(false);
  const left = useLoad(() => api.listFormerTeachers(), []);
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  if (!t.data || !c.data || !classes.data) return <Loading />;
  const pct = (v: number | null) => (v === null ? '–' : `${v}%`);
  const cur = t.data.find((x) => x.id === open);
  const editT = t.data.find((x) => x.id === editing);
  const removeTeacher = async (x: NonNullable<typeof cur>) => {
    if (!(await ask({ title: `Remove ${x.name}?`, body: <>They can no longer sign in, and their classes ({x.pairs.map((p) => `${p.classLabel} ${p.subject}`).join(', ') || 'none'}) show no teacher until you give them to someone else. Their homework, tests and marks keep their name. You can restore them from <b>Former teachers</b>.</>, confirm: 'Remove teacher', danger: true }))) return;
    if (await run(() => api.removeTeacher(x.id), (r) => `${r.removed} removed.`)) setOpen(null);
  };
  const removeClass = async (id: string, label: string) => {
    if (!(await ask({ title: `Remove ${label}?`, body: 'Only a class with no students, tests or homework can be removed, for example one opened by mistake.', confirm: 'Remove class', danger: true }))) return;
    await run(() => api.removeClass(id), (r) => `${r.removed} removed.`);
  };
  return (
    <>
      <PageHead eyebrow="People" title="Teachers" lede="Every teacher with the classes and subjects they teach, and how those classes are doing. Standards, sections, class advisors and subject teachers are set in Classes and standards.">
        {(left.data?.length ?? 0) > 0 && <button className="btn ghost" onClick={() => setFormer(true)}>Former teachers ({left.data!.length})</button>}
        <button className="btn ghost" onClick={() => setClassEdit({ id: null })}><Icon name="plus" size={18} />Add class</button>
        <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add teacher</button>
      </PageHead>
      <Modal open={former} onClose={() => setFormer(false)} title="Former teachers">
        {!left.data?.length ? <div className="empty">No former teachers.</div> : <div className="list">{left.data.map((x) => <div key={x.id} className="row between"><span><b>{x.name}</b><div className="dim small">{x.subjects.join(', ')} · removed {formatDate(x.removedAt.slice(0, 10))}</div></span><button className="btn sm ghost" disabled={busy} onClick={() => void run(() => api.restoreTeacher(x.id), (r) => `${r.name} restored. Give them classes again with Edit.`)}>Restore</button></div>)}</div>}
      </Modal>
      <ClassModal open={!!classEdit} onClose={() => setClassEdit(null)} cls={classes.data.find((x) => x.id === classEdit?.id)} teachers={t.data} subjects={[...new Set(classes.data.flatMap((x) => x.subjects))]} />
      <AddTeacherModal open={!!editT} onClose={() => setEditing(null)} classes={classes.data} teacher={editT && { id: editT.id, name: editT.name, phone: editT.phone, subjects: editT.subjects, classIds: editT.classIds, classTeacherOf: editT.classTeacherOf[0]?.classId ?? '' }} />
      <Stats items={[
        { label: 'Teachers', value: t.data.length },
        { label: 'Class advisors', value: t.data.filter((x) => x.classTeacherOf.length).length },
        { label: 'School average', value: pct(Math.round(c.data.reduce((s, x) => s + (x.avgPct ?? 0), 0) / Math.max(1, c.data.length))), foot: 'All published tests' },
        { label: 'Students below pass mark', value: c.data.reduce((s, x) => s + x.belowPass, 0), tone: 'bad' },
      ]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'teachers', label: 'By teacher' }, { value: 'classes', label: 'By class' }]} />
      {tab === 'teachers' && (
        <div className="card">
          <Table head={['Teacher', 'Teaches', 'Class advisor of', 'Tests', 'Average', 'Pass rate', 'Homework (30 days)', '']} rows={t.data.map((x) => [
            <div key="n" className="row" style={{ flexWrap: 'nowrap' }}><span className="avatar">{initials(x.name)}</span><div><b>{x.name}</b><div className="dim small">{x.subjects.join(', ')}</div>{x.examCoordinator && <span className="pill accent" style={{ marginTop: 4 }}>Exam coordinator</span>}</div></div>,
            <span key="c" className="small">{x.pairs.map((p) => `${p.classLabel} ${p.subject}`).join(', ')}</span>,
            x.classTeacherOf.length ? <span key="ct" className="chip-list">{x.classTeacherOf.map((k) => <span key={k.classId} className={`pill ${k.attendanceMarkedToday ? 'ok' : 'warn'}`} title={k.attendanceMarkedToday ? 'Attendance marked today' : 'Attendance not marked yet today'}>{k.classLabel}</span>)}</span> : <span key="ct" className="dim">–</span>,
            <span key="t" className="num">{x.pairs.reduce((s, p) => s + p.tests, 0)}</span>,
            <div key="a" style={{ minWidth: 110 }}>{x.avgPct === null ? '–' : <Bar value={x.avgPct} label="" thresholds={[45, 60]} />}</div>,
            pct(x.passPct), <span key="h" className="num">{x.pairs.reduce((s, p) => s + p.homework, 0)}</span>,
            <span key="o" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setOpen(x.id)}>Details</button><button className="btn sm quiet" onClick={() => setEditing(x.id)}>Edit</button></span>,
          ])} />
        </div>
      )}
      {tab === 'classes' && (
        <div className="stack">
          <div className="card">
            <Table head={['Class', 'Class advisor', 'Students', 'Average', 'Pass rate', 'Below pass', 'Top student', '']} rows={c.data.map((x) => [
              <b key="c">{x.classLabel}</b>, x.classTeacher, x.students,
              <div key="a" style={{ minWidth: 110 }}>{x.avgPct === null ? '–' : <Bar value={x.avgPct} label="" thresholds={[45, 60]} />}</div>,
              pct(x.passPct), x.belowPass ? <span key="b" className="pill bad">{x.belowPass}</span> : <span key="b" className="pill ok">0</span>,
              <span key="t" className="small">{x.top ? `${x.top.name} · ${x.top.avg}%` : '–'}</span>,
              <span key="s" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setClassEdit({ id: x.classId })}>Edit</button><button className="btn sm quiet" onClick={() => void removeClass(x.classId, x.classLabel)}>Remove</button></span>,
            ])} />
          </div>
          <div className="grid cols-3">
            {c.data.map((x) => (
              <div key={x.classId} className="card stack" style={{ gap: 10 }}>
                <div className="card-head" style={{ margin: 0 }}><h3>{x.classLabel} by subject</h3><span className="dim small">{x.tests} tests</span></div>
                {x.subjects.map((sub) => <Bar key={sub.subject} value={sub.avgPct ?? 0} label={sub.subject} sub={`${sub.teacher} · pass ${pct(sub.passPct)}`} thresholds={[45, 60]} />)}
              </div>
            ))}
          </div>
        </div>
      )}
      <Modal open={!!cur} onClose={() => setOpen(null)} title={cur?.name ?? ''} wide>
        {cur && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 18 }}><span className="muted">{cur.title}</span><span className="dim small">Signs in with +91 {cur.phone}</span></div>
            <Table head={['Class', 'Subject', 'Students', 'Tests', 'Average', 'Pass rate', 'Homework (30 days)']} rows={cur.pairs.map((p) => [<b key="c">{p.classLabel}</b>, p.subject, p.students, p.tests, <div key="a" style={{ minWidth: 110 }}>{p.avgPct === null ? '–' : <Bar value={p.avgPct} label="" thresholds={[45, 60]} />}</div>, pct(p.passPct), p.homework])} empty="No classes assigned yet." />
            <div className="row">
              <button className="btn ghost" onClick={() => { setOpen(null); go({ page: 'timetable', id: `t:${cur.id}` }); }}><Icon name="grid" size={18} />See timetable</button>
              <button className="btn ghost" onClick={() => { setOpen(null); setEditing(cur.id); }}><Icon name="pen" size={18} />Edit</button>
              <button className="btn ghost" disabled={busy} onClick={() => void run(() => api.setExamCoordinator(cur.id, !cur.examCoordinator), (r) => r.examCoordinator ? `${r.name} is now exam coordinator and can plan exams, halls, seating and hall tickets.` : `${r.name} is no longer exam coordinator.`)}>{cur.examCoordinator ? 'Stop being exam coordinator' : 'Make exam coordinator'}</button>
              {cur.classTeacherOf.length ? <span className="dim small" style={{ marginLeft: 'auto' }}>Class advisor of {cur.classTeacherOf.map((k) => k.classLabel).join(', ')}: change that first to remove them.</span>
                : <button className="btn quiet" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void removeTeacher(cur)}>Remove teacher</button>}
            </div>
          </div>
        )}
      </Modal>
      <AddTeacherModal open={adding} onClose={() => setAdding(false)} classes={classes.data} />
      {confirmEl}
    </>
  );
}

type TeacherForm = { id: string; name: string; phone: string; subjects: string[]; classIds: string[]; classTeacherOf: string };
function AddTeacherModal({ open, onClose, classes, teacher }: { open: boolean; onClose: () => void; classes: Cls[]; teacher?: TeacherForm }) {
  const { api } = useApp();
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [f, setF] = useState({ name: '', phone: '', subjects: [] as string[], classIds: [] as string[], classTeacherOf: '' });
  useEffect(() => { if (open) setF(teacher ? { name: teacher.name, phone: teacher.phone, subjects: teacher.subjects, classIds: teacher.classIds, classTeacherOf: teacher.classTeacherOf } : { name: '', phone: '', subjects: [], classIds: [], classTeacherOf: '' }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const subjects = [...new Set(classes.flatMap((c) => c.subjects))];
  const toggle = (k: 'subjects' | 'classIds', v: string) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v], ...(k === 'classIds' && f.classTeacherOf === v ? { classTeacherOf: '' } : {}) });
  const replacing = classes.find((c) => c.id === f.classTeacherOf && c.classTeacherId !== teacher?.id);
  const ok = f.name.trim() && f.phone.replace(/\D/g, '').length >= 10 && f.subjects.length && f.classIds.length;
  const save = async () => {
    if (!ok) return;
    if (replacing && !(await ask({ title: `Make ${f.name} class advisor of ${replacing.label}?`, body: `${replacing.teacher} is class advisor of ${replacing.label} now. They stay as a subject teacher; attendance, report cards and adding students for ${replacing.label} move to ${f.name}.`, confirm: 'Change class advisor' }))) return;
    if (teacher) {
      const r = await run(() => api.updateTeacher(teacher.id, { name: f.name, phone: f.phone, subjects: f.subjects, classIds: f.classIds, ...(f.classTeacherOf !== teacher.classTeacherOf ? { classTeacherOf: f.classTeacherOf } : {}) }), (t) => `${t.name} updated.`);
      if (r) onClose();
      return;
    }
    const r = await run(() => api.addTeacher({ ...f, classTeacherOf: f.classTeacherOf || undefined }), (t) => `${t.name} added. They can sign in with +91 ${t.phone}.`);
    if (r) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={teacher ? `Edit ${teacher.name}` : 'Add a teacher'}>
      {confirmEl}
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="at-n">Name</label><input id="at-n" className="input" required placeholder="Mrs. K. Deepa" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="at-p">Mobile (used to sign in)</label><input id="at-p" className="input" inputMode="numeric" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        </div>
        <div className="field"><span className="label">Subjects</span><div className="row">{subjects.map((s) => <label key={s} className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.subjects.includes(s)} onChange={() => toggle('subjects', s)} />{s}</label>)}</div></div>
        <div className="field"><span className="label">Classes they teach</span><div className="row">{classes.map((c) => <label key={c.id} className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.classIds.includes(c.id)} onChange={() => toggle('classIds', c.id)} />{c.label}</label>)}</div></div>
        <div className="field"><label htmlFor="at-ct">Class advisor of (optional)</label><select id="at-ct" className="input" value={f.classTeacherOf} onChange={(e) => setF({ ...f, classTeacherOf: e.target.value })}><option value="">Not a class advisor</option>{classes.filter((c) => f.classIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label}{c.classTeacherId === teacher?.id ? '' : ` (now ${c.teacher})`}</option>)}</select></div>
        <p className="dim small">Their timetable is made from the subjects and classes chosen here. They see only these classes.</p>
        {teacher?.classTeacherOf && f.classTeacherOf !== teacher.classTeacherOf && <p className="small" style={{ color: 'var(--warn)' }}>A class always needs a class advisor. To hand over {classes.find((c) => c.id === teacher.classTeacherOf)?.label}, edit that class in By class and pick its new class advisor.</p>}
        <div className="row"><button className="btn" disabled={!ok || busy}>{teacher ? 'Save changes' : 'Add teacher'}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

export function ClassModal({ open, onClose, cls, teachers, subjects, grade }: { open: boolean; onClose: () => void; cls?: Cls; teachers: { id: string; name: string }[]; subjects: string[]; grade?: number }) {
  const { api } = useApp();
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [f, setF] = useState({ grade: '9', section: '', classTeacherId: '', subjects: [] as string[], extra: '' });
  useEffect(() => { if (open) setF(cls ? { grade: String(cls.grade), section: cls.section, classTeacherId: cls.classTeacherId, subjects: cls.subjects, extra: '' } : { grade: String(grade ?? 9), section: '', classTeacherId: '', subjects, extra: '' }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const all = [...new Set([...subjects, ...f.subjects])];
  const ok = f.section.trim() && f.classTeacherId && f.subjects.length;
  const save = async () => {
    if (!ok) return;
    if (cls) {
      const was = teachers.find((x) => x.id === cls.classTeacherId)?.name;
      const now = teachers.find((x) => x.id === f.classTeacherId)?.name;
      if (f.classTeacherId !== cls.classTeacherId && !(await ask({ title: `Make ${now} class advisor of ${cls.label}?`, body: `${was ?? 'The current class advisor'} stays as a subject teacher. Attendance, report cards and adding students for ${cls.label} move to ${now}.`, confirm: 'Change class advisor' }))) return;
      const r = await run(() => api.updateClass(cls.id, { classTeacherId: f.classTeacherId, subjects: f.subjects }), (x) => `${x.label} updated.`);
      if (r) onClose();
      return;
    }
    const r = await run(() => api.addClass({ grade: Number(f.grade), section: f.section, classTeacherId: f.classTeacherId, subjects: f.subjects }), (x) => `${x.label} added. Its timetable is ready; choose its subject teachers under Classes and standards.`);
    if (r) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={cls ? `Edit ${cls.label}` : 'Add a class'}>
      {confirmEl}
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {!cls && <div className="grid cols-2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="cl-g">Standard</label><select id="cl-g" className="input" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}>{Array.from({ length: 12 }, (_, i) => String(i + 1)).map((g) => <option key={g}>{g}</option>)}</select></div>
          <div className="field"><label htmlFor="cl-s">Section</label><input id="cl-s" className="input" maxLength={2} placeholder="B" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></div>
        </div>}
        <div className="field"><label htmlFor="cl-t">Class advisor</label><select id="cl-t" className="input" value={f.classTeacherId} onChange={(e) => setF({ ...f, classTeacherId: e.target.value })}><option value="">Choose a teacher</option>{teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="field"><span className="label">Subjects</span><div className="row">{all.map((x) => <label key={x} className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.subjects.includes(x)} onChange={() => setF({ ...f, subjects: f.subjects.includes(x) ? f.subjects.filter((y) => y !== x) : [...f.subjects, x] })} />{x}</label>)}</div>
          <div className="row" style={{ marginTop: 6, flexWrap: 'nowrap' }}><input aria-label="New subject" className="input" placeholder="Another subject, e.g. Computer Science" value={f.extra} onChange={(e) => setF({ ...f, extra: e.target.value })} /><button type="button" className="btn sm ghost" disabled={!f.extra.trim()} onClick={() => setF({ ...f, subjects: [...new Set([...f.subjects, f.extra.trim()])], extra: '' })}>Add</button></div>
        </div>
        <div className="row"><button className="btn" disabled={!ok || busy}>{cls ? 'Save changes' : 'Add class'}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- timetables (class and teacher)

export function TimetableView({ id, lockClass }: { id?: string; lockClass?: boolean }) {
  const { api, session } = useApp();
  const role = session.user.role;
  const init = id?.startsWith('t:') ? { teacherId: id.slice(2) } : id?.startsWith('c:') ? { classId: id.slice(2) } : {};
  const [view, setView] = useState<{ classId?: string; teacherId?: string }>(init);
  useEffect(() => { setView(init); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const tt = useLoad(() => api.timetable(view), [view.classId, view.teacherId]);
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [slot, setSlot] = useState<null | { day: number; period: number; subject: string }>(null);
  const today = Math.min(5, Math.max(0, new Date().getDay() - 1));
  if (!tt.data) return <Loading />;
  const { options, view: v } = tt.data;
  const mine = role === 'teacher';
  const choices = [
    ...(mine ? [{ value: `t:${session.user.id}`, label: 'My timetable' }] : []),
    ...options.classes.map((c) => ({ value: `c:${c.id}`, label: mine ? `${c.label} (class advisor)` : c.label })),
  ];
  const cur = v ? `${v.kind === 'class' ? 'c' : 't'}:${v.id}` : '';
  const pick = (x: string) => setView(x.startsWith('t:') ? { teacherId: x.slice(2) } : { classId: x.slice(2) });
  const editable = v?.kind === 'class' && v.editable;
  const reset = async () => {
    if (!v || !(await ask({ title: `Undo all changes to ${v.label}?`, body: `The ${v.changes} periods changed by hand go back to the timetable made from who teaches what.`, confirm: 'Undo changes', danger: true }))) return;
    await run(() => api.resetTimetable(v.id), (r) => `${r.undone} change${r.undone > 1 ? "s" : ""} undone for ${r.classLabel}.`);
  };
  return (
    <div className="card stack" style={{ gap: 12 }}>
      {confirmEl}
      <div className="card-head" style={{ margin: 0 }}>
        <div><h2>{v ? (v.kind === 'class' ? `Class ${v.label}` : v.label) : 'Timetable'}</h2><span className="dim small">{v?.kind === 'teacher' ? `${v.teachingPeriods} teaching periods a week · free periods are blank` : editable ? 'Click a period to change it · today is highlighted' : 'Subject and teacher for every period · today is highlighted'}</span></div>
        <div className="row">
          {role === 'principal' && !lockClass ? (
            <>
              <select aria-label="Class timetable" className="input" style={{ width: 'auto' }} value={v?.kind === 'class' ? cur : ''} onChange={(e) => e.target.value && pick(e.target.value)}><option value="">Class…</option>{options.classes.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.label}</option>)}</select>
              <select aria-label="Teacher timetable" className="input" style={{ width: 'auto' }} value={v?.kind === 'teacher' ? cur : ''} onChange={(e) => e.target.value && pick(e.target.value)}><option value="">Teacher…</option>{options.teachers.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}</select>
            </>
          ) : !lockClass && choices.length > 1 ? <Seg label="Timetable" value={cur} onChange={pick} options={choices} /> : null}
          {editable && v.changes > 0 && <button className="btn sm quiet" disabled={busy} onClick={() => void reset()}>Undo {v.changes} change{v.changes > 1 ? 's' : ''}</button>}
        </div>
      </div>
      {!v ? <div className="empty">No timetable to show.</div> : (
        <div className="table-wrap">
          <div className="tt" style={{ gridTemplateColumns: `72px repeat(${v.days.length}, minmax(96px, 1fr))` }}>
            <span className="h" />{v.days.map((d, i) => <span key={d} className="h" style={{ color: i === today ? 'var(--or-text)' : undefined }}>{d}</span>)}
            {v.periods.map((p, pi) => [
              <span key={p} className="h">{p}</span>,
              ...v.days.map((d, di) => {
                const c = v.cells[di][pi];
                const body = c && c.subject ? <>{c.subject}{c.with && <><br /><small className="dim">{c.with}</small></>}</> : <small className="dim">Free</small>;
                const edited = !!(c && 'edited' in c && c.edited);
                const style = { ...(di === today ? { background: 'var(--tint)' } : {}), ...(edited ? { boxShadow: 'inset 3px 0 0 var(--school-accent)' } : {}) };
                return editable
                  ? <button key={d + p} type="button" className="tt-cell" style={style} aria-label={`${d} ${p}: ${c?.subject || 'Free'}. Change`} title={edited ? 'Changed by hand' : undefined} onClick={() => setSlot({ day: di, period: pi, subject: c?.subject ?? '' })}>{body}</button>
                  : <span key={d + p} style={style}>{body}</span>;
              }),
            ])}
          </div>
        </div>
      )}
      {role === 'teacher' && <span className="dim small">You see your own periods, and the full timetable only of the class you are class advisor of. Other class timetables are seen by their own advisors and the principal.</span>}
      {editable && <span className="dim small">A line on the left marks a period changed by hand. The teacher for a period follows the subject teacher of this class.</span>}
      <Modal open={!!slot} onClose={() => setSlot(null)} title={slot && v ? `${v.label} · ${v.days[slot.day]}, period ${slot.period + 1} (${v.periods[slot.period]})` : ''}>
        {slot && v && (
          <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.setPeriod(v.id, slot.day, slot.period, slot.subject || null), (r) => r.teacher ? `Changed. ${r.teacher} takes this period.` : 'Changed.')) setSlot(null); }}>
            <div className="field"><label htmlFor="tp-s">Subject</label><select id="tp-s" className="input" value={slot.subject} onChange={(e) => setSlot({ ...slot, subject: e.target.value })}><option value="">Free period</option>{v.subjects.map((x) => <option key={x}>{x}</option>)}</select></div>
            <span className="dim small">If the subject teacher is in another class in this period, the change is refused and you are told where they are.</span>
            <div className="row"><button className="btn" disabled={busy || slot.subject === (v.cells[slot.day][slot.period]?.subject ?? '')}>Save period</button><button type="button" className="btn ghost" onClick={() => setSlot(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/** Today's periods for the signed-in student, from their class timetable. */
export function TodayPeriods() {
  const { api } = useApp();
  const tt = useLoad(() => api.timetable({}), []);
  const d = new Date().getDay() - 1;
  const v = tt.data?.view;
  if (!v) return <Loading />;
  if (d < 0 || d > 5) return <div className="empty">No classes today.</div>;
  return <div className="tl">{v.periods.map((p, i) => <div key={p}><span className="dim num">{p}</span><span>{v.cells[d][i]?.subject ?? 'Free'}{v.cells[d][i]?.with ? <span className="dim small"> · {v.cells[d][i]!.with}</span> : ''}</span></div>)}</div>;
}

// ---------------------------------------------------------------- homework hand-in

export function SubmissionsModal({ homeworkId, onClose }: { homeworkId: string | null; onClose: () => void }) {
  const { api } = useApp();
  const { run, busy } = useAction();
  const data = useLoad(() => (homeworkId ? api.listSubmissions(homeworkId) : Promise.resolve(null)), [homeworkId]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [redo, setRedo] = useState<{ studentId: string; name: string; remark: string } | null>(null);
  const d = data.data;
  const review = (studentId: string, status: 'checked' | 'redo' | 'submitted', remark?: string) => run(() => api.reviewSubmission(homeworkId!, studentId, { status, remark }), status === 'checked' ? 'Marked as checked.' : status === 'redo' ? 'Asked to redo. The student sees your note.' : 'Back to handed in.');
  const label = { submitted: 'Handed in', checked: 'Checked', redo: 'Asked to redo', missing: 'Not handed in' } as const;
  return (
    <Modal open={!!homeworkId} onClose={onClose} title={d ? `${d.homework.classLabel} ${d.homework.subject}: ${d.homework.title}` : 'Handed in'} wide>
      {!d ? <Loading /> : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill ok">{d.rows.filter((r) => r.status !== 'missing').length} handed in</span>
            <span className="pill">{d.rows.filter((r) => r.status === 'missing').length} not yet</span>
            <span className="dim small">Due {formatDate(d.homework.dueDate)} · set by {d.homework.teacher}</span>
            <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setPhoto('list')}>Not handed in list</button>
          </div>
          <Table head={['Roll', 'Student', 'Status', 'Handed in', 'Note', '']} rows={d.rows.map((r) => [
            r.rollNo, <b key="n">{r.name}</b>,
            <span key="s" className={`pill ${r.status === 'checked' ? 'ok' : r.status === 'redo' ? 'warn' : r.status === 'missing' ? '' : 'accent'}`}>{label[r.status]}{r.late ? ' · late' : ''}</span>,
            <span key="t" className="small">{r.submittedAt ? relTime(r.submittedAt) : '–'}</span>,
            <span key="no" className="small">{r.note}{r.remark && <span className="dim" style={{ display: 'block' }}>You: {r.remark}</span>}</span>,
            <div key="a" className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              {r.photoDataUrl && <button className="btn sm ghost" onClick={() => setPhoto(r.photoDataUrl)}>Photo</button>}
              {r.status === 'submitted' && <><button className="btn sm" disabled={busy} onClick={() => void review(r.studentId, 'checked')}>Checked</button><button className="btn sm quiet" disabled={busy} onClick={() => setRedo({ studentId: r.studentId, name: r.name, remark: '' })}>Ask to redo</button></>}
              {(r.status === 'checked' || r.status === 'redo') && <button className="btn sm quiet" disabled={busy} onClick={() => void review(r.studentId, 'submitted')}>Undo</button>}
            </div>,
          ])} />
        </div>
      )}
      <Modal open={!!photo} onClose={() => setPhoto(null)} title={photo === 'list' ? 'Not handed in' : 'Handed-in photo'}>
        {photo === 'list' ? <div className="stack">{d?.rows.filter((r) => r.status === 'missing').map((r) => <span key={r.studentId}>Roll {r.rollNo} · {r.name}</span>)}<span className="dim small">Parents are not messaged about this automatically. Remind students in class first.</span></div> : photo && <img src={photo} alt="Student's homework" style={{ maxWidth: '100%', borderRadius: 10 }} />}
      </Modal>
      <Modal open={!!redo} onClose={() => setRedo(null)} title={`Ask ${redo?.name ?? ''} to redo`}>
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (!redo?.remark.trim()) return; if (await review(redo.studentId, 'redo', redo.remark)) setRedo(null); }}>
          <div className="field"><label htmlFor="rd-r">What should they fix?</label><textarea id="rd-r" className="input" required value={redo?.remark ?? ''} onChange={(e) => setRedo(redo && { ...redo, remark: e.target.value })} placeholder="Label the cornea and the retina." /></div>
          <button className="btn" disabled={!redo?.remark.trim() || busy}>Send to student</button>
        </form>
      </Modal>
    </Modal>
  );
}

export function StudentHomework({ compact }: { compact?: boolean }) {
  const { api, session, go } = useApp();
  const me = session.children[0];
  const hw = useLoad(() => api.listHomework({ classId: me.classId }), []);
  const myClass = useLoad(() => api.listClasses(), []);
  const [material] = useDemo<Shared[]>('shared-material', SHARED_SAMPLE);
  const [reading, setReading] = useState<Shared | null>(null);
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [open, setOpen] = useState<null | NonNullable<typeof hw.data>[number]>(null);
  const [f, setF] = useState({ note: '', photo: '' });
  const file = useRef<HTMLInputElement>(null);
  const today = isoDate(new Date());
  if (!hw.data) return <Loading />;
  const list = compact ? hw.data.filter((h) => h.dueDate >= today || (h.mine && h.mine.status === 'redo')) : hw.data;
  const status = (h: (typeof list)[number]) => !h.mine ? (h.dueDate < today ? <span className="pill bad">Not handed in</span> : <span className="pill">Due {formatDate(h.dueDate)}</span>)
    : h.mine.status === 'checked' ? <span className="pill ok">Checked</span> : h.mine.status === 'redo' ? <span className="pill warn">Redo</span> : <span className="pill accent">Handed in</span>;
  const hand = async () => {
    if (!open) return;
    const r = await run(() => api.submitHomework(open.id, { note: f.note, photoDataUrl: f.photo || undefined }), (x) => (x.late ? 'Handed in after the due date. Your teacher can still see it.' : 'Handed in. Your teacher sees it in their list.'));
    if (r) { setOpen(null); hw.reload(); }
  };
  const withdraw = async (h: (typeof list)[number]) => {
    if (!(await ask({ title: 'Take back what you handed in?', body: 'Your teacher will no longer see it. You can hand it in again before they check it.', confirm: 'Take back', danger: true }))) return;
    if (await run(() => api.withdrawHomework(h.id), 'Taken back. Hand it in again when ready.')) hw.reload();
  };
  const body = (
    <>
      {confirmEl}
      {list.length === 0 ? <div className="empty">No homework due.</div> : (
        <div className="list">
          {list.map((h) => (
            <div key={h.id} className="stack" style={{ gap: 6 }}>
              <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span style={{ minWidth: 0 }}><b>{h.subject}: {h.title}</b><div className="dim small">{h.teacher} · due {formatDate(h.dueDate)}</div></span>
                {status(h)}
              </div>
              {!compact && h.details && <span className="muted small">{h.details}</span>}
              {h.mine?.remark && <span className="small" style={{ color: h.mine.status === 'redo' ? 'var(--warn)' : 'var(--ok)' }}>Teacher: {h.mine.remark}</span>}
              <div className="row" style={{ gap: 6 }}>
                {(!h.mine || h.mine.status === 'redo') && <button className="btn sm ghost" onClick={() => { setF({ note: '', photo: '' }); setOpen(h); }}><Icon name="camera" size={16} />{h.mine ? 'Hand in again' : 'Hand in'}</button>}
                {h.mine?.status === 'submitted' && <><button className="btn sm quiet" onClick={() => { setF({ note: h.mine!.note, photo: '' }); setOpen(h); }}>Replace</button><button className="btn sm quiet" disabled={busy} onClick={() => void withdraw(h)}>Take back</button><span className="dim small">Handed in {relTime(h.mine.submittedAt)}</span></>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Hand in: ${open.subject}` : ''}>
        {open && (
          <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void hand(); }}>
            <b>{open.title}</b>
            <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const x = e.target.files?.[0]; if (x) setF({ ...f, photo: await readImage(x, 1000).catch(() => '') }); e.target.value = ''; }} />
            <button type="button" className="drop" style={{ cursor: 'pointer' }} onClick={() => file.current?.click()}>{f.photo ? <img src={f.photo} alt="Your work" style={{ maxHeight: 160, borderRadius: 8 }} /> : <span className="row" style={{ justifyContent: 'center' }}><Icon name="camera" />Take or choose a photo of your work</span>}</button>
            <div className="field"><label htmlFor="hi-n">Note for your teacher (optional)</label><textarea id="hi-n" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="I did sums 1 to 6." /></div>
            <button className="btn" disabled={busy || (!f.photo && !f.note.trim())}>Hand in to {open.teacher}</button>
          </form>
        )}
      </Modal>
    </>
  );
  if (compact) return body;
  return (
    <>
      <PageHead eyebrow="Homework" title="My homework" lede="Hand in a photo of your work. Only the teacher who set it sees it, and their note comes back here." />
      <Stats items={[{ label: 'Due', value: hw.data.filter((h) => !h.mine && h.dueDate >= today).length }, { label: 'Handed in', value: hw.data.filter((h) => h.mine).length }, { label: 'To redo', value: hw.data.filter((h) => h.mine?.status === 'redo').length, tone: hw.data.some((h) => h.mine?.status === 'redo') ? 'bad' : undefined }]} />
      <div className="card">{body}</div>
      {(() => {
        const label = myClass.data?.find((c) => c.id === me.classId)?.label;
        const mine = material.filter((m) => m.cls === label && (!m.to || m.to.includes(me.name)));
        return (
          <div className="card">
            <div className="card-head"><h2>Worksheets and notes</h2><span className="dim small">Shared by your teachers</span></div>
            {mine.length === 0 ? <div className="empty">Nothing shared yet. When a teacher shares a worksheet or notes, it appears here.</div> : (
              <div className="list">{mine.map((m) => (
                <div key={m.id} className="row between" style={{ flexWrap: 'nowrap' }}>
                  <span style={{ minWidth: 0 }}><b>{m.subject}: {m.title}</b><div className="dim small">{m.teacher} · {formatDate(m.at.slice(0, 10))}{m.to ? ' · for you' : ''}</div></span>
                  <button className="btn sm ghost" onClick={() => setReading(m)}>Open</button>
                </div>
              ))}</div>
            )}
          </div>
        );
      })()}
      <Modal open={!!reading} onClose={() => setReading(null)} title={reading ? `${reading.subject}: ${reading.title}` : ''} wide>
        {reading && <div className="stack" style={{ gap: 10 }}><div style={{ whiteSpace: 'pre-wrap' }}>{reading.text}</div><span className="dim small">From {reading.teacher}. Hand in your work as a photo in the homework above if your teacher asks.</span></div>}
      </Modal>
      <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => go({ page: 'home' })}>Back to today</button>
    </>
  );
}

// ---------------------------------------------------------------- student: exams, hall ticket, report cards

export function StudentReports() {
  const { session, toast } = useApp();
  const me = session.children[0];
  return (
    <>
      <PageHead eyebrow="Report cards" title="My report cards" lede="Every report card from every year you have studied here. Pick a standard to narrow the list, then open any card." />
      <ReportHistory studentId={me.id} />
      <span className="dim small" onClick={() => toast('Ask your class advisor if something looks wrong.')}>Something wrong? Ask your class advisor.</span>
    </>
  );
}

// ---------------------------------------------------------------- import students from a spreadsheet

const FIELDS = { name: 'Student name', gender: 'Gender', dob: 'Date of birth', class: 'Class and section', guardianName: 'Parent name', guardianPhone: 'Parent mobile', emis: 'EMIS number', lang: 'Message language', consent: 'WhatsApp consent', skip: 'Skip this column' } as const;
type Field = keyof typeof FIELDS;
const GUESS: [RegExp, Field][] = [[/student|^name/i, 'name'], [/gender|sex/i, 'gender'], [/dob|birth/i, 'dob'], [/class|std|sec/i, 'class'], [/(father|mother|parent|guardian).*(name)|^parent$/i, 'guardianName'], [/mobile|phone|whatsapp no/i, 'guardianPhone'], [/emis/i, 'emis'], [/lang/i, 'lang'], [/consent/i, 'consent']];
const SAMPLE = 'STUDENT_NAME,GENDER,DOB,CLASS_SEC,PARENT_NAME,PARENT_MOBILE,EMIS_NO,LANGUAGE,WHATSAPP_CONSENT\nNila R,F,04-05-2011,10 A,Mr. Rajesh,98765 10001,,English,Yes\nAditya S,M,17-09-2011,10 B,Mrs. Sangeetha,98765 10002,,Tamil,Yes\nThamizh K,M,02-01-2012,9 A,Mr. Kumar,98765 10003,,Tamil,No\nRiya M,F,30-02-2011,10 A,Mrs. Malathi,98765 10004,,English,Yes\nSanjay P,M,11-07-2012,9 A,Mr. Prabhu,,,English,Yes\n';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
function toIso(v: string) {
  const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/) ?? null;
  const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return !Number.isNaN(d.getTime()) && isoDate(d) === iso ? iso : '';
}

export function ImportStudents() {
  const { api, toast } = useApp();
  const classes = useLoad(() => api.listClasses(), []);
  const students = useLoad(() => api.listStudents(), []);
  const { run, busy } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [map, setMap] = useState<Field[]>([]);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{ added: string[]; failed: { row: string[]; why: string }[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = (name: string, text: string) => {
    const rows = parseCsv(text.replace(/^﻿/, ''));
    if (rows.length < 2) return toast('That file has no student rows.', 'err');
    setFile({ name, rows });
    setMap(rows[0].map((h) => GUESS.find(([re]) => re.test(h))?.[1] ?? 'skip'));
    setStep(1); setResult(null);
  };
  const checked = useMemo(() => {
    if (!file || !classes.data || !students.data) return [];
    const get = (r: string[], f: Field) => { const i = map.indexOf(f); return i < 0 ? '' : r[i] ?? ''; };
    const seen = new Set<string>();
    return file.rows.slice(1).map((r) => {
      const name = get(r, 'name').replace(/\s+/g, ' ').trim();
      const cls = classes.data!.find((c) => c.label.replace(/\W/g, '').toLowerCase() === get(r, 'class').replace(/\W/g, '').toLowerCase());
      const dob = toIso(get(r, 'dob'));
      const g = get(r, 'gender').toUpperCase()[0];
      const phone = get(r, 'guardianPhone').replace(/\D/g, '').slice(-10);
      const key = `${cls?.id}|${name.toLowerCase()}|${dob}`;
      const why = !name ? 'No name' : !cls ? `Class “${get(r, 'class') || 'blank'}” not found` : !dob ? `Date of birth “${get(r, 'dob') || 'blank'}” is not a real date` : g !== 'F' && g !== 'M' ? 'Gender should be F or M' : phone.length !== 10 ? 'Parent mobile missing or not 10 digits' : !get(r, 'guardianName') ? 'No parent name'
        : students.data!.some((s) => s.classId === cls.id && s.name.toLowerCase() === name.toLowerCase() && s.dob === dob) || seen.has(key) ? 'Already on record' : '';
      seen.add(key);
      return { r, why, input: cls && { classId: cls.id, name, gender: g as 'F' | 'M', dob, guardianName: get(r, 'guardianName'), guardianPhone: phone, emis: get(r, 'emis'), lang: /ta/i.test(get(r, 'lang')) ? 'ta' as const : 'en' as const, whatsappConsent: /^(y|yes|true|1)$/i.test(get(r, 'consent')) } };
    });
  }, [file, map, classes.data, students.data]);
  const ready = checked.filter((x) => !x.why);
  const doImport = async () => {
    if (!(await ask({ title: `Import ${ready.length} students?`, body: `They are added to their classes with the next roll numbers, and each parent can sign in with their mobile. ${checked.length - ready.length} rows with problems are left out; you can download them to fix.`, confirm: `Import ${ready.length} students` }))) return;
    const added: string[] = [], failed: { row: string[]; why: string }[] = checked.filter((x) => x.why).map((x) => ({ row: x.r, why: x.why }));
    for (const x of ready) { try { const s = await api.addStudent(x.input!); added.push(`${s.name} (${s.classLabel}, roll ${s.rollNo})`); } catch (e) { failed.push({ row: x.r, why: (e as Error).message }); } }
    await run(async () => null, `${added.length} students imported.${failed.length ? ` ${failed.length} rows need fixing.` : ''}`);
    setResult({ added, failed }); setStep(3); students.reload();
  };
  const steps = ['Choose file', 'Match columns', 'Check', 'Done'];
  return (
    <div className="card stack" style={{ gap: 16 }}>
      {confirmEl}
      <div className="row">{steps.map((s, i) => <span key={s} className={`pill ${i < step ? 'ok' : i === step ? 'accent' : ''}`}>{i < step ? '✓' : i + 1} {s}</span>)}</div>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(f.name, await f.text()); e.target.value = ''; }} />
      {step === 0 && (
        <div className="drop stack" style={{ alignItems: 'center' }}>
          <Icon name="upload" />
          <p style={{ margin: 0 }}>Choose a CSV file. From Excel or the EMIS export, use File → Save as → CSV.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn sm" onClick={() => input.current?.click()}>Choose CSV file</button>
            <button className="btn sm ghost" onClick={() => load('sample-students.csv', SAMPLE)}>Try the sample file</button>
            <button className="btn sm ghost" onClick={() => void downloadCsv('student-import-template.csv', ['STUDENT_NAME', 'GENDER', 'DOB', 'CLASS_SEC', 'PARENT_NAME', 'PARENT_MOBILE', 'EMIS_NO', 'LANGUAGE', 'WHATSAPP_CONSENT'], [['Nila R', 'F', '04-05-2011', '10 A', 'Mr. Rajesh', '9876510001', '', 'English', 'Yes']], toast)}><Icon name="download" size={16} />Template</button>
          </div>
        </div>
      )}
      {step === 1 && file && (
        <>
          <span className="muted small">{file.name}: {file.rows.length - 1} rows. Check where each column goes.</span>
          <Table head={['Column in your file', 'Goes to', 'First row']} rows={file.rows[0].map((h, i) => [<code key="c">{h}</code>, <select key="s" aria-label={`Map ${h}`} className="input" value={map[i]} onChange={(e) => setMap(map.map((m, j) => (j === i ? e.target.value as Field : m)))}>{(Object.keys(FIELDS) as Field[]).map((k) => <option key={k} value={k}>{FIELDS[k]}</option>)}</select>, <span key="v" className="dim small">{file.rows[1]?.[i]}</span>])} />
          {(['name', 'class', 'dob', 'gender', 'guardianName', 'guardianPhone'] as Field[]).filter((k) => !map.includes(k)).length > 0 && <span className="small" style={{ color: 'var(--bad)' }}>Still needed: {(['name', 'class', 'dob', 'gender', 'guardianName', 'guardianPhone'] as Field[]).filter((k) => !map.includes(k)).map((k) => FIELDS[k]).join(', ')}.</span>}
          <div className="row"><button className="btn" onClick={() => setStep(2)} disabled={(['name', 'class', 'dob', 'gender', 'guardianName', 'guardianPhone'] as Field[]).some((k) => !map.includes(k))}>Check {file.rows.length - 1} rows</button><button className="btn ghost" onClick={() => setStep(0)}>Choose another file</button></div>
        </>
      )}
      {step === 2 && (
        <>
          <Stats items={[{ label: 'Ready to import', value: ready.length, tone: 'ok' }, { label: 'Fix first', value: checked.length - ready.length, tone: checked.length - ready.length ? 'bad' : undefined }]} />
          <Table head={['Row', 'Student', 'Class', 'Status']} rows={checked.map((x, i) => [i + 2, x.r[map.indexOf('name')] ?? '', x.r[map.indexOf('class')] ?? '', x.why ? <span key="s" className="pill bad">{x.why}</span> : <span key="s" className="pill ok">Ready</span>])} />
          <span className="dim small">WhatsApp messages go only to parents marked as consenting in the file.</span>
          <div className="row"><button className="btn" disabled={!ready.length || busy} onClick={() => void doImport()}>Import {ready.length} students</button><button className="btn ghost" onClick={() => setStep(1)}>Back</button></div>
        </>
      )}
      {step === 3 && result && (
        <div className="stack">
          <b>{result.added.length} students added.</b>
          {result.added.length > 0 && <span className="small muted">{result.added.join(', ')}</span>}
          {result.failed.length > 0 && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => void downloadCsv('rows-to-fix.csv', [...file!.rows[0], 'PROBLEM'], result.failed.map((f) => [...f.row, f.why]), toast)}><Icon name="download" size={16} />Download {result.failed.length} rows to fix</button>}
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { setStep(0); setFile(null); }}>Import another file</button>
        </div>
      )}
      <p className="dim small">The same records feed EMIS and UDISE+ exports, report cards and fee books, so the office enters data once.</p>
    </div>
  );
}
