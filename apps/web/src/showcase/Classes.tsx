import { useState } from 'react';
import { isoDate } from '@enticra/core';
import type { Result } from '../api';
import { Icon, Loading, Modal, PageHead, Seg, useAction, useApp, useConfirm, useLoad } from '../ui';
import { AddStudentModal, ClassModal, TimetableView } from './School';
import { Stats, Table } from './kit';

type Cls = Result<'listClasses'>[number];
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v}%`);

// ---------------------------------------------------------------- principal: every standard, section, advisor and subject teacher

export function ClassesAndStandards() {
  const { api } = useApp();
  const classes = useLoad(() => api.listClasses(), []);
  const teachers = useLoad(() => api.teacherOverview(), []);
  const { run } = useAction();
  const [ask, confirmEl] = useConfirm();
  const [edit, setEdit] = useState<null | { id: string | null; grade?: number }>(null);
  const [staffing, setStaffing] = useState<string | null>(null);
  const [tt, setTt] = useState<string | null>(null);
  if (!classes.data || !teachers.data) return <Loading />;
  const all = classes.data;
  const grades = [...new Set(all.map((c) => c.grade))].sort((a, b) => b - a);
  const gaps = all.reduce((n, c) => n + c.subjectTeacherList.filter((x) => !x.teacherId).length, 0);
  const subjectsFor = (g: number) => [...new Set(all.filter((c) => c.grade === g).flatMap((c) => c.subjects))];
  const remove = async (c: Cls) => {
    if (!(await ask({ title: `Remove ${c.label}?`, body: 'Only a class with no students, tests or homework can be removed, for example one opened by mistake. Move students to another section first.', confirm: 'Remove class', danger: true }))) return;
    await run(() => api.removeClass(c.id), (r) => `${r.removed} removed.`);
  };
  const editing = all.find((c) => c.id === edit?.id);
  return (
    <>
      <PageHead eyebrow="People" title="Classes and standards" lede="Every standard and section in the school, with its class advisor, subjects and the teacher for each subject. Class timetables are made from these and can be changed by the principal or the class advisor.">
        <button className="btn" onClick={() => setEdit({ id: null })}><Icon name="plus" size={18} />Add class</button>
      </PageHead>
      {confirmEl}
      <Stats items={[
        { label: 'Standards', value: grades.length, foot: grades.length ? `${grades[grades.length - 1]} to ${grades[0]}` : undefined },
        { label: 'Sections', value: all.length },
        { label: 'Students', value: all.reduce((n, c) => n + c.students, 0) },
        { label: 'Subjects without a teacher', value: gaps, tone: gaps ? 'bad' : undefined, foot: gaps ? 'Assign them under Subject teachers' : 'Every subject has a teacher' },
      ]} />
      {grades.map((g) => {
        const secs = all.filter((c) => c.grade === g);
        return (
          <div key={g} className="card stack" style={{ gap: 10 }}>
            <div className="card-head" style={{ margin: 0 }}>
              <div><h2>Standard {g}</h2><span className="dim small">{secs.length} section{secs.length > 1 ? 's' : ''} · {secs.reduce((n, c) => n + c.students, 0)} students · {subjectsFor(g).join(', ')}</span></div>
              <button className="btn sm ghost" aria-label={`Add a section to standard ${g}`} onClick={() => setEdit({ id: null, grade: g })}><Icon name="plus" size={16} />Add section</button>
            </div>
            <Table head={['Class', 'Class advisor', 'Students', 'Subject teachers', '']} rows={secs.map((c) => {
              const miss = c.subjectTeacherList.filter((x) => !x.teacherId);
              return [
                <b key="c">{c.label}</b>, c.teacher || <span key="t" className="pill bad">None</span>, <span key="n" className="num">{c.students}</span>,
                miss.length ? <span key="s" className="pill warn" title={miss.map((x) => x.subject).join(', ')}>{miss.length} of {c.subjects.length} need a teacher</span> : <span key="s" className="pill ok">All {c.subjects.length} assigned</span>,
                <span key="a" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <button className="btn sm ghost" aria-label={`Subject teachers for ${c.label}`} onClick={() => setStaffing(c.id)}>Subject teachers</button>
                  <button className="btn sm ghost" aria-label={`Timetable for ${c.label}`} onClick={() => setTt(c.id)}>Timetable</button>
                  <button className="btn sm quiet" aria-label={`Edit ${c.label}`} onClick={() => setEdit({ id: c.id })}>Edit</button>
                  <button className="btn sm quiet" aria-label={`Remove ${c.label}`} onClick={() => void remove(c)}>Remove</button>
                </span>,
              ];
            })} />
          </div>
        );
      })}
      <ClassModal open={!!edit} onClose={() => setEdit(null)} cls={editing} teachers={teachers.data} grade={edit?.grade ?? 9} subjects={edit?.grade ? subjectsFor(edit.grade) : [...new Set(all.flatMap((c) => c.subjects))]} />
      <SubjectTeachers cls={all.find((c) => c.id === staffing) ?? null} teachers={teachers.data} onClose={() => setStaffing(null)} />
      <Modal open={!!tt} onClose={() => setTt(null)} title={`Timetable · ${all.find((c) => c.id === tt)?.label ?? ''}`} wide>
        {tt && <TimetableView id={`c:${tt}`} lockClass />}
      </Modal>
    </>
  );
}

function SubjectTeachers({ cls, teachers, onClose }: { cls: Cls | null; teachers: { id: string; name: string; subjects: string[] }[]; onClose: () => void }) {
  const { api } = useApp();
  const { run, busy } = useAction();
  return (
    <Modal open={!!cls} onClose={onClose} title={cls ? `Subject teachers · ${cls.label}` : ''}>
      {cls && (
        <div className="stack" style={{ gap: 12 }}>
          <p className="dim small" style={{ margin: 0 }}>Each change saves at once. The timetable, homework, tests and marks for that subject follow the teacher you choose. Class advisor: <b>{cls.teacher}</b>.</p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Subject</th><th>Teacher</th></tr></thead>
            <tbody>{cls.subjectTeacherList.map((x, i) => {
              const sorted = [...teachers].sort((a, b) => Number(b.subjects.includes(x.subject)) - Number(a.subjects.includes(x.subject)) || a.name.localeCompare(b.name));
              return (
                <tr key={x.subject}>
                  <td><b>{x.subject}</b></td>
                  <td><select id={`stx-${i}`} aria-label={`${x.subject} teacher`} className="input" disabled={busy} value={x.teacherId ?? ''} onChange={(e) => void run(() => api.setSubjectTeacher(cls.id, x.subject, e.target.value || null), (r) => r.teacher ? `${r.teacher} now teaches ${r.subject} in ${r.classLabel}.` : `${r.subject} in ${r.classLabel} has no teacher now.`)}>
                    <option value="">No teacher yet</option>
                    {sorted.map((t) => <option key={t.id} value={t.id}>{t.name}{t.subjects.includes(x.subject) ? '' : ` (${t.subjects.join(', ')})`}</option>)}
                  </select></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <div className="row"><button className="btn ghost" onClick={onClose}>Done</button></div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- class advisor: my class

export function MyClass() {
  const { api, session, go } = useApp();
  const classes = useLoad(() => api.listClasses(), []);
  const mine = (classes.data ?? []).filter((c) => c.classTeacherId === session.user.id);
  const [pick, setPick] = useState('');
  const cls = mine.find((c) => c.id === pick) ?? mine[0];
  const students = useLoad(() => (cls ? api.listStudents({ classId: cls.id }) : Promise.resolve([])), [cls?.id]);
  const att = useLoad(() => (cls ? api.getAttendance(cls.id, isoDate(new Date())) : Promise.resolve(null)), [cls?.id]);
  const [adding, setAdding] = useState(false);
  if (!classes.data) return <Loading />;
  if (!cls) return (
    <>
      <PageHead eyebrow="My class" title="My class" lede="Class advisors look after one class: its students, attendance and timetable." />
      <div className="card empty">You are not a class advisor this year. The principal chooses one class advisor for each class.</div>
    </>
  );
  const list = students.data ?? [];
  const marks = att.data?.record ? Object.values(att.data.record.marks) : [];
  const absent = marks.filter((m) => m === 'A').length;
  const avg = (k: 'attendancePct' | 'average') => { const v = list.map((s) => s[k]).filter((x): x is number => typeof x === 'number'); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  return (
    <>
      <PageHead eyebrow="My class" title={`Class ${cls.label}`} lede="You are the class advisor: you mark attendance, look after these students and their parents, and keep the class timetable right.">
        <button className="btn ghost" onClick={() => go({ page: 'attendance' })}><Icon name="check" size={18} />Mark attendance</button>
        <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add student</button>
      </PageHead>
      {mine.length > 1 && <Seg label="Class" value={cls.id} onChange={setPick} options={mine.map((c) => ({ value: c.id, label: c.label }))} />}
      <Stats items={[
        { label: 'Students', value: list.length, foot: `${list.filter((s) => s.gender === 'F').length} girls · ${list.filter((s) => s.gender === 'M').length} boys` },
        { label: 'Today', value: att.data?.record ? `${marks.length - absent} present` : 'Not marked', tone: att.data?.record ? undefined : 'bad', foot: att.data?.record ? `${absent} absent` : 'Mark attendance before 10 am' },
        { label: 'Attendance this year', value: pct(avg('attendancePct')) },
        { label: 'Class average', value: pct(avg('average')), foot: 'All published tests' },
      ]} />
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="card-head" style={{ margin: 0 }}><h2>Students</h2><span className="dim small">Click a student to open their record</span></div>
          <Table head={['Roll', 'Student', 'Parent', 'Attendance', 'Average']} empty="No students yet. Add the first one." rows={list.map((s) => [
            <span key="r" className="num">{s.rollNo}</span>,
            <button key="n" className="btn sm quiet" onClick={() => go({ page: 'students', id: s.id })}><b>{s.name}</b></button>,
            <span key="p" className="small">{s.guardian.name}</span>,
            <span key="a" className="num" style={typeof s.attendancePct === 'number' && s.attendancePct < 75 ? { color: 'var(--bad)' } : undefined}>{pct(s.attendancePct)}</span>,
            <span key="m" className="num">{pct(s.average)}</span>,
          ])} />
        </div>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="card-head" style={{ margin: 0 }}><h2>Subject teachers</h2></div>
          <div className="list">{cls.subjectTeacherList.map((x) => <div key={x.subject} className="row between"><b>{x.subject}</b>{x.teacher ? <span className="small">{x.teacher}</span> : <span className="pill warn">No teacher yet</span>}</div>)}</div>
          <span className="dim small">The principal assigns subject teachers. Ask them if one is missing.</span>
        </div>
      </div>
      <TimetableView id={`c:${cls.id}`} lockClass />
      <AddStudentModal open={adding} onClose={() => setAdding(false)} classes={[cls]} onSaved={() => students.reload()} />
    </>
  );
}
