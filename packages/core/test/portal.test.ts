import { describe, expect, it, beforeEach } from 'vitest';
import { Portal, PortalError, createSeed, mockGrader, REVISION_PAPER, scoreSteps, normalize, inWindow, type Db, type User } from '../src';

// A fixed Monday morning so attendance messages are not held for quiet hours.
const NOW = new Date(2026, 9, 26, 9, 15);
let db: Db;
let portal: Portal;
const u = (id: string) => db.users.find((x) => x.id === id) as User;

beforeEach(() => {
  db = createSeed(NOW);
  portal = new Portal(db, { now: () => NOW });
});

function expectError(fn: () => unknown, status: number) {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(PortalError); expect((e as PortalError).status).toBe(status); return; }
  throw new Error('expected an error');
}

describe('seed', () => {
  it('creates two schools with sample people', () => {
    expect(db.schools).toHaveLength(2);
    expect(db.students.length).toBe(120);
    expect(db.scripts.length).toBeGreaterThan(8);
    const priya = u('u_s1_parent');
    expect(db.students.filter((s) => priya.studentIds!.includes(s.id)).map((s) => s.guardian.phone)).toEqual(['9840044444', '9840044444']);
  });
});

describe('tenant isolation', () => {
  it('blocks a principal from another school’s students and settings', () => {
    const other = u('u_s2_principal');
    expectError(() => portal.getStudent(other, 'stu_cls_s1_10a_1'), 403);
    expectError(() => portal.getSchool(other, 'sch_srividya'), 403);
    expect(portal.listStudents(other).every((s) => s.schoolId === 'sch_littleflower')).toBe(true);
  });
  it('limits teachers to their classes and parents to their children', () => {
    const maths = u('u_s1_maths');
    expectError(() => portal.getAttendance(maths, 'cls_s1_9a', '2026-10-26'), 403);
    const parent = u('u_s1_parent');
    expect(portal.listStudents(parent).map((s) => s.name)).toEqual(['Arun Kumar P', 'Divya P']);
    expectError(() => portal.getStudent(parent, 'stu_cls_s1_10a_2'), 403);
    expect(portal.listMessages(parent).every((m) => parent.studentIds!.includes(m.studentId))).toBe(true);
  });
  it('only Enticra staff can create schools', () => {
    expectError(() => portal.createSchool(u('u_s1_principal'), { name: 'New School', board: 'CBSE', principalName: 'X', principalPhone: '9999999999' }), 403);
    const { school, principal } = portal.createSchool(u('u_enticra'), { name: 'Green Valley Matric School', board: 'Matriculation', principalName: 'Mr. Anand', principalPhone: '98765 43210' });
    expect(school.branding.primary).toBe('#0B333B');
    expect(principal.phone).toBe('9876543210');
    expect(portal.listStudents(principal)).toHaveLength(0);
  });
});

describe('attendance', () => {
  it('marks a class and messages parents with the right template and language', () => {
    const teacher = u('u_s1_science');
    const { students } = portal.getAttendance(teacher, 'cls_s1_10a', '2026-10-26');
    const marks: Record<string, 'P' | 'A' | 'L'> = Object.fromEntries(students.map((s) => [s.id, 'P' as const]));
    marks[students[1].id] = 'A';
    marks[students[2].id] = 'L';
    const res = portal.markAttendance(teacher, { classId: 'cls_s1_10a', date: '2026-10-26', marks });
    expect(res.counts).toEqual({ P: 10, A: 1, L: 1 });
    expect(res.messages).toHaveLength(12);
    const absent = res.messages.find((m) => m.studentId === students[1].id)!;
    expect(absent.template).toBe('absent');
    expect(absent.body).toContain('Sri Vidya Matric');
    // Re-marking with one change only messages that one parent
    marks[students[1].id] = 'P';
    expect(portal.markAttendance(teacher, { classId: 'cls_s1_10a', date: '2026-10-26', marks }).messages).toHaveLength(1);
  });
  it('rejects incomplete registers and future dates', () => {
    const teacher = u('u_s1_science');
    expectError(() => portal.markAttendance(teacher, { classId: 'cls_s1_10a', date: '2026-10-26', marks: {} }), 400);
    expectError(() => portal.markAttendance(teacher, { classId: 'cls_s1_10a', date: '2026-10-30', marks: {} }), 400);
  });
  it('holds messages during quiet hours', () => {
    const late = new Portal(db, { now: () => new Date(2026, 9, 26, 22, 0) });
    const teacher = u('u_s1_maths');
    const r = late.createHomework(teacher, { classId: 'cls_s1_10a', subject: 'Maths', title: 'Exercise 8.1', dueDate: '2026-10-28' });
    expect(r.messages.every((m) => m.status === 'scheduled')).toBe(true);
    expect(r.messages[0].sendAt).toBe('2026-10-27T07:00:00');
    expect(late.releaseScheduled()).toBe(0);
    const sent: string[] = [];
    const morning = new Portal(db, { now: () => new Date(2026, 9, 27, 7, 1), onMessage: (m) => { sent.push(m.id); } });
    expect(morning.releaseScheduled()).toBe(r.messages.length);
    expect(sent).toHaveLength(r.messages.length);
  });
  it('tracks real WhatsApp delivery without going backwards', () => {
    const r = portal.createHomework(u('u_s1_maths'), { classId: 'cls_s1_10a', subject: 'Maths', title: 'Exercise 8.2', dueDate: '2026-10-28' });
    const m = r.messages.find((x) => x.status === 'sent')!;
    portal.messageAccepted(m.id, 'wamid.1');
    expect(m.live).toBe(true);
    portal.messageStatus('wamid.1', 'read');
    portal.messageStatus('wamid.1', 'delivered');
    expect(m.status).toBe('read');
    portal.messageStatus('wamid.1', 'failed', 'Number not on WhatsApp');
    expect(m).toMatchObject({ status: 'failed', error: 'Number not on WhatsApp' });
    expect(portal.messageStatus('unknown', 'read')).toBeNull();
  });
  it('respects WhatsApp consent', () => {
    const r = portal.createHomework(u('u_s1_maths'), { classId: 'cls_s1_10b', subject: 'Maths', title: 'Exercise 3.6', dueDate: '2026-10-27' });
    expect(r.messages.filter((m) => m.status === 'skipped_no_consent')).toHaveLength(1);
  });
});

describe('AI correction', () => {
  it('normalises maths notation', () => {
    expect(normalize('CSA = 440 cm²')).toBe('csa=440cm2');
    expect(normalize('x² − 5x')).toBe('x2-5x');
  });
  it('awards step marks from the marking scheme', () => {
    const q5 = REVISION_PAPER[4];
    const partial = scoreSteps(q5, 'CSA = 2πrh = 440\nTSA = 2πr² + 2πrh = 308 + 440 = 738', 'board');
    expect(partial.reduce((t, s) => t + s.awarded, 0)).toBe(2.5);
    const full = scoreSteps(q5, 'CSA = 2πrh = 440 cm²\nTSA = 2πr(h + r) = 748 cm²', 'board');
    expect(full.reduce((t, s) => t + s.awarded, 0)).toBe(5);
    // School mode forgives a missing unit when the final answer is right
    const noUnit = scoreSteps(q5, 'CSA = 2πrh = 440\nTSA = 2πr(h + r) = 748', 'school');
    expect(noUnit.reduce((t, s) => t + s.awarded, 0)).toBe(5);
  });
  it('grades scripts, flags low confidence, and writes marks only after approval', async () => {
    const teacher = u('u_s1_maths');
    const exam = 'exm_s1_10a_maths_revision1';
    const after = await portal.gradeScripts(teacher, exam);
    expect(after.scripts.every((s) => s.status === 'graded')).toBe(true);
    expect(after.marks).toHaveLength(0);
    const imran = after.scripts.find((s) => s.studentId === 'stu_cls_s1_10a_7')!;
    expect(imran.responses.find((r) => r.no === '6')!.needsReview).toBe(true);
    const r = portal.reviewScript(teacher, imran.id, { overrides: { '6': 1 }, approve: true });
    expect(r.script.status).toBe('approved');
    const sheet = db.marks.find((m) => m.examId === exam && m.studentId === 'stu_cls_s1_10a_7')!;
    expect(sheet.source).toBe('ai_reviewed');
    expect(sheet.perQuestion['6']).toBe(1);
    expect(portal.gradingAgreement(teacher, exam).scripts).toBe(1);
  });
  it('records grader failures without losing the script', async () => {
    const failing = new Portal(db, { now: () => NOW, grader: { name: 'claude', grade: async () => { throw new Error('rate limited'); } } });
    const res = await failing.gradeScripts(u('u_s1_maths'), 'exm_s1_10a_maths_revision1');
    expect(res.scripts.every((s) => s.status === 'failed' && s.error === 'rate limited')).toBe(true);
  });
  it('uses the mock grader by default', () => { expect(portal.grader).toBe(mockGrader); });
});

describe('exams and reports', () => {
  it('validates step marks against question marks', () => {
    expectError(() => portal.createExam(u('u_s1_maths'), { classId: 'cls_s1_10a', subject: 'Maths', name: 'UT3', type: 'Unit Test', date: '2026-10-26', questions: [{ no: '1', text: 'Q', maxMarks: 2, chapter: 'Algebra', answerKey: '', steps: [{ text: 'a', marks: 1, keywords: [] }] }] }), 400);
  });
  it('publishes marks and notifies parents', () => {
    const teacher = u('u_s1_maths');
    const exam = portal.createExam(teacher, { classId: 'cls_s1_10a', subject: 'Maths', name: 'Unit Test 3', type: 'Unit Test', date: '2026-10-26', questions: [{ no: '1', text: 'Q1', maxMarks: 5, chapter: 'Algebra', answerKey: 'x = 2', steps: [] }] });
    portal.saveMarks(teacher, exam.id, 'stu_cls_s1_10a_1', { '1': 4 });
    expectError(() => portal.saveMarks(teacher, exam.id, 'stu_cls_s1_10a_1', { '1': 6 }), 400);
    const { messages } = portal.publishExam(teacher, exam.id);
    expect(messages[0].body).toContain('4/5');
  });
  it('builds a report card with the school’s grading scale', () => {
    const rc = portal.reportCard(u('u_s1_parent'), 'stu_cls_s1_10a_1', 'Unit Test 2');
    expect(rc.rows).toHaveLength(5);
    expect(rc.grade).toMatch(/^(A1|A2|B1|B2|C1|C2|D|E)$/);
    expect(rc.rank).toBeGreaterThan(0);
    const cbse = portal.reportCard(u('u_s2_parent'), 'stu_cls_s2_10a_4', 'Periodic Test 2');
    expect(cbse.grade).toMatch(/^(A\+|A|B|C|D|E)$/);
  });
  it('flags at-risk students on the dashboard', () => {
    const d = portal.dashboard(u('u_s1_principal'));
    expect(d.atRisk.map((a) => a.name)).toContain('Gokul V');
    expect(d.kpis.scriptsWaiting).toBeGreaterThan(0);
  });
});

describe('settings', () => {
  it('versions settings and validates input', () => {
    const p = u('u_s1_principal');
    const s = portal.updateSchool(p, { settings: { lateCutoff: '08:40' } });
    expect(s.settings.version).toBe(2);
    expectError(() => portal.updateSchool(p, { branding: { primary: 'blue' } }), 400);
    expectError(() => portal.updateSchool(p, { settings: { lateCutoff: '25:00' } }), 400);
    expectError(() => portal.updateSchool(u('u_s1_maths'), { settings: { passMark: 40 } }), 403);
  });
  it('switches modules off per school', () => {
    expectError(() => portal.uploadScript(u('u_s2_maths'), { examId: db.exams.find((e) => e.schoolId === 'sch_littleflower')!.id, studentId: 'stu_cls_s2_10a_1', pages: [{ transcript: {} }] }), 403);
  });
  it('handles quiet-hour windows across midnight', () => {
    expect(inWindow('22:00', '21:00', '07:00')).toBe(true);
    expect(inWindow('06:59', '21:00', '07:00')).toBe(true);
    expect(inWindow('12:00', '21:00', '07:00')).toBe(false);
  });
});

describe('editing tests', () => {
  it('changes date and name before publishing, locks after, and deletes only empty tests', () => {
    const teacher = u('u_s1_maths');
    const exam = portal.createExam(teacher, { classId: 'cls_s1_10a', subject: 'Maths', name: 'Model Exam 1', type: 'Model Exam', date: '2026-11-03', questions: [{ no: '1', text: 'Q1', maxMarks: 5, chapter: 'Algebra', answerKey: 'x = 2', steps: [] }] });
    portal.updateExam(teacher, exam.id, { date: '2026-11-10', name: 'Model Exam 2' });
    expect(portal.getExam(teacher, exam.id).exam).toMatchObject({ date: '2026-11-10', name: 'Model Exam 2' });
    expectError(() => portal.updateExam(teacher, exam.id, { date: 'next week' }), 400);
    expectError(() => portal.updateExam(u('u_s2_maths'), exam.id, { date: '2026-11-11' }), 403);
    portal.saveMarks(teacher, exam.id, 'stu_cls_s1_10a_1', { '1': 4 });
    expectError(() => portal.deleteExam(teacher, exam.id), 409);
    portal.publishExam(teacher, exam.id);
    expectError(() => portal.updateExam(teacher, exam.id, { date: '2026-11-12' }), 409);
    const empty = portal.createExam(teacher, { classId: 'cls_s1_10a', subject: 'Maths', name: 'Mistake', type: 'Unit Test', date: '2026-11-03', questions: [{ no: '1', text: 'Q1', maxMarks: 2, chapter: 'Algebra', answerKey: '', steps: [] }] });
    portal.deleteExam(teacher, empty.id);
    expect(db.exams.some((e) => e.id === empty.id)).toBe(false);
  });
});

describe('people, homework hand-in, results and timetables', () => {
  it('lets only the class advisor add students, and gives the parent a sign-in', () => {
    const input = { classId: 'cls_s1_10a', name: 'Nila R', gender: 'F' as const, dob: '2011-05-04', guardianName: 'Mr. Rajesh', guardianPhone: '98765 00001', whatsappConsent: true };
    expectError(() => portal.addStudent(u('u_s1_maths'), input), 403); // teaches 10-A but is class advisor of 10-B
    const st = portal.addStudent(u('u_s1_science'), input);
    expect(st.rollNo).toBe(13);
    expect(portal.userByPhone('9876500001')?.studentIds).toEqual([st.id]);
    expectError(() => portal.addStudent(u('u_s1_science'), input), 409);
    expectError(() => portal.addStudent(u('u_s1_principal'), input), 403);
    expectError(() => portal.addStudent(u('u_s1_science'), { ...input, name: 'X Y', guardianPhone: '123' }), 400);
  });
  it('lets the principal add a teacher who can then sign in and teach', () => {
    expectError(() => portal.addTeacher(u('u_s1_maths'), { name: 'Mr. New', phone: '9876500002', subjects: ['Maths'], classIds: ['cls_s1_10a'] }), 403);
    expectError(() => portal.addTeacher(u('u_s1_principal'), { name: 'Mr. New', phone: '9840022222', subjects: ['Maths'], classIds: ['cls_s1_10a'] }), 409);
    const t = portal.addTeacher(u('u_s1_principal'), { name: 'Mr. New Teacher', phone: '9876500002', subjects: ['Maths'], classIds: ['cls_s1_9a'], classTeacherOf: 'cls_s1_9a' });
    expect(db.classes.find((c) => c.id === 'cls_s1_9a')!.classTeacherId).toBe(t.id);
    expect(portal.listClasses(t).map((c) => c.id)).toEqual(['cls_s1_9a']);
  });
  it('takes homework from students and shows it only to the teacher who set it', () => {
    const arun = u('u_s1_student');
    const hw = portal.listHomework(arun).find((h) => h.subject === 'Science')!;
    expect(hw.mine).toBeNull();
    portal.submitHomework(arun, hw.id, { note: 'Diagram done' });
    expect(portal.listHomework(arun).find((h) => h.id === hw.id)!.mine?.status).toBe('submitted');
    const list = portal.listSubmissions(u('u_s1_science'), hw.id);
    expect(list.rows.find((r) => r.studentId === 'stu_cls_s1_10a_1')?.note).toBe('Diagram done');
    expectError(() => portal.listSubmissions(u('u_s1_maths'), hw.id), 403);
    expectError(() => portal.reviewSubmission(u('u_s1_science'), hw.id, 'stu_cls_s1_10a_1', { status: 'redo' }), 400);
    portal.reviewSubmission(u('u_s1_science'), hw.id, 'stu_cls_s1_10a_1', { status: 'checked', remark: 'Good' });
    expectError(() => portal.withdrawHomework(arun, hw.id), 409);
  });
  it('builds timetables with no teacher in two places at once, and limits who sees which', () => {
    const p = u('u_s1_principal');
    const { options } = portal.timetable(p);
    const slots = new Map<string, string>();
    for (const t of options.teachers) {
      const v = portal.timetable(p, { teacherId: t.id }).view!;
      v.cells.forEach((day, d) => day.forEach((c, i) => { if (c) { const k = `${t.id}${d}${i}`; expect(slots.has(k)).toBe(false); slots.set(k, c.with); } }));
    }
    const tenA = portal.timetable(p, { classId: 'cls_s1_10a' }).view!;
    expect(tenA.cells.flat().filter(Boolean).length).toBe(48);
    expect(tenA.cells.flat().filter((c) => c?.subject === 'Maths').length).toBeGreaterThanOrEqual(8);
    const lakshmi = portal.timetable(u('u_s1_science'));
    expect(lakshmi.view?.kind).toBe('teacher');
    expect(lakshmi.options.classes.map((c) => c.id).sort()).toEqual(['cls_s1_10a', 'cls_s1_9a']);
    expectError(() => portal.timetable(u('u_s1_maths'), { classId: 'cls_s1_10a' }), 403);
    expect(portal.timetable(u('u_s1_student')).view?.label).toBe('10-A');
  });
  it('summarises results by teacher and by class for the principal', () => {
    const t = portal.teacherOverview(u('u_s1_principal'));
    expect(t.find((x) => x.name === 'Mrs. V. Revathi')?.pairs).toHaveLength(3);
    const c = portal.classResults(u('u_s1_principal'));
    expect(c).toHaveLength(13);
    expect(c[0].avgPct).toBeGreaterThan(0);
    expectError(() => portal.teacherOverview(u('u_s1_maths')), 403);
  });
});

describe('editing and removing people, classes and homework', () => {
  const P = () => u('u_s1_principal');
  it('edits a student, moves a section only within the standard, and relinks the parent phone', () => {
    const id = 'stu_cls_s1_10a_2';
    expectError(() => portal.updateStudent(u('u_s1_maths'), id, { name: 'X Y' }), 403);
    const r = portal.updateStudent(u('u_s1_science'), id, { name: 'Renamed Student', guardianPhone: '9876500077' });
    expect(r.changes.length).toBe(2);
    expect(portal.userByPhone('9876500077')?.studentIds).toContain(id);
    expectError(() => portal.updateStudent(P(), id, { classId: 'cls_s1_10b' }), 403);
    expectError(() => portal.updateStudent(u('u_s1_science'), id, { classId: 'cls_s1_9a' }), 400);
    const moved = portal.updateStudent(u('u_s1_science'), id, { classId: 'cls_s1_10b' });
    expect(moved.classLabel).toBe('10-B');
    expectError(() => portal.updateStudent(u('u_s1_maths'), id, {}), 400);
  });
  it('removes a student with a reason, closes the family sign-in, and restores both', () => {
    const arun = 'stu_cls_s1_10a_1';
    expectError(() => portal.removeStudent(u('u_s1_science'), arun, { reason: '' }), 400);
    portal.removeStudent(u('u_s1_science'), arun, { reason: 'Transfer certificate issued' });
    expect(db.students.some((s) => s.id === arun)).toBe(false);
    expect(portal.sessionUser('u_s1_student')).toBeUndefined();
    expect(portal.listFormerStudents(P())[0]).toMatchObject({ id: arun, reason: 'Transfer certificate issued' });
    expectError(() => portal.restoreStudent(P(), arun), 403);
    portal.restoreStudent(u('u_s1_science'), arun);
    expect(db.students.find((s) => s.id === arun)?.rollNo).toBe(1);
    expect(portal.sessionUser('u_s1_student')?.studentIds).toEqual([arun]);
    expect(portal.listStudents(u('u_s1_student')).map((s) => s.id)).toEqual([arun]);
  });
  it('edits and removes teachers, but never leaves a class without a class advisor', () => {
    expectError(() => portal.removeTeacher(P(), 'u_s1_science'), 409);
    expectError(() => portal.updateTeacher(P(), 'u_s1_maths', { classIds: ['cls_s1_10a'] }), 409); // class advisor of 10-B
    const t = portal.updateTeacher(P(), 'u_s1_english', { subjects: ['English'], classIds: ['cls_s1_10a'] });
    expect(t.classIds).toEqual(['cls_s1_10a']);
    portal.removeTeacher(P(), 'u_s1_english');
    expect(portal.userByPhone('9840066666')).toBeUndefined();
    expect(portal.teacherOverview(P()).some((x) => x.id === 'u_s1_english')).toBe(false);
    expect(portal.listHomework(P()).find((h) => h.assignedBy === 'u_s1_english')?.teacher).toBe('Mrs. V. Revathi');
    portal.restoreTeacher(P(), 'u_s1_english');
    expect(portal.userByPhone('9840066666')?.id).toBe('u_s1_english');
  });
  it('adds, edits and removes classes', () => {
    expectError(() => portal.addClass(P(), { grade: 10, section: 'A', classTeacherId: 'u_s1_maths', subjects: ['Maths'] }), 409);
    const c = portal.addClass(P(), { grade: 9, section: 'b', classTeacherId: 'u_s1_tamil', subjects: ['Tamil', 'English', 'Maths'] });
    expect(c.label).toBe('9-B');
    portal.updateClass(P(), c.id, { classTeacherId: 'u_s1_social' });
    expect(db.classes.find((x) => x.id === c.id)!.classTeacherId).toBe('u_s1_social');
    expect(portal.timetable(P(), { classId: c.id }).view!.cells.flat().filter(Boolean).length).toBeGreaterThanOrEqual(44);
    expectError(() => portal.removeClass(P(), 'cls_s1_10a'), 409);
    portal.removeClass(P(), c.id);
    expect(db.classes.some((x) => x.id === c.id)).toBe(false);
    expect(u('u_s1_social').classIds).not.toContain(c.id);
  });
  it('lets the teacher who set homework edit or delete it', () => {
    const hw = portal.listHomework(P()).find((h) => h.assignedBy === 'u_s1_science')!;
    expectError(() => portal.updateHomework(u('u_s1_maths'), hw.id, { title: 'x' }), 403);
    expectError(() => portal.updateHomework(u('u_s1_science'), hw.id, { dueDate: '2000-01-01' }), 400);
    portal.updateHomework(u('u_s1_science'), hw.id, { title: 'Draw and label the eye' });
    expect(db.homework.find((h) => h.id === hw.id)!.title).toBe('Draw and label the eye');
    const r = portal.deleteHomework(P(), hw.id);
    expect(r.deleted).toBe('Draw and label the eye');
    expect(db.submissions.some((s) => s.homeworkId === hw.id)).toBe(false);
  });
});

describe('school exams: timetable, halls, seating and hall tickets for every standard', () => {
  const P = () => u('u_s1_principal');
  const C = () => u('u_s1_maths'); // exam coordinator
  it('seeds a published exam for every standard with every student seated', () => {
    const plan = portal.getExamPlan(P(), 'xp_halfyearly');
    expect(plan.grades).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(plan.students.length).toBe(db.students.filter((s) => s.schoolId === 'sch_srividya').length);
    expect(plan.students.every((s) => s.seat)).toBe(true);
    expect(plan.problems).toEqual([]);
    const seen = new Set(plan.students.map((s) => `${s.sitting}#${s.hallId}#${s.seat}`));
    expect(seen.size).toBe(plan.students.length);
    // Juniors write in the afternoon, so they reuse the halls the seniors use in the forenoon.
    expect(plan.sittings.map((x) => x.grades)).toEqual([[12, 11, 10, 9, 8, 7, 6], [5, 4, 3, 2, 1]]);
  });
  it('seats overlapping standards together and others in a separate sitting', () => {
    const c = u('u_s1_maths');
    portal.setExamTiming(c, 'xp_halfyearly', [1, 2, 3, 4, 5], { start: '10:00', end: '11:30', maxMarks: 50 }, true);
    let plan = portal.getExamPlan(c, 'xp_halfyearly');
    expect(plan.sittings).toHaveLength(1);
    expect(plan.problems.some((x) => x.includes('Allot seats again'))).toBe(true);
    expectError(() => portal.allotSeats(c, 'xp_halfyearly', ['hall_main']), 409);
    portal.allotSeats(c, 'xp_halfyearly', plan.halls.map((h) => h.id));
    plan = portal.getExamPlan(c, 'xp_halfyearly');
    expect(plan.problems).toEqual([]);
    expect(new Set(plan.students.map((s) => `${s.hallId}#${s.seat}`)).size).toBe(plan.students.length);
  });
  it('mixes standards so neighbours write different papers', () => {
    const plan = portal.getExamPlan(P(), 'xp_halfyearly');
    const hall = plan.halls[0];
    const row = plan.students.filter((s) => s.hallId === hall.id).sort((a, b) => a.seat! - b.seat!).slice(0, hall.cols);
    for (let i = 1; i < row.length; i++) expect(row[i].grade).not.toBe(row[i - 1].grade);
  });
  it('lets the exam coordinator manage halls, papers, seats and tickets, with checks', () => {
    expectError(() => portal.createExamPlan(P(), { name: 'Annual exams', grades: [7, 3] }), 403);
    expectError(() => portal.createExamPlan(u('u_s1_science'), { name: 'Annual exams', grades: [7, 3] }), 403);
    const x = portal.createExamPlan(C(), { name: 'Annual exams', grades: [7, 3] });
    expectError(() => portal.createExamPlan(C(), { name: 'annual exams', grades: [7] }), 409);
    expectError(() => portal.savePaper(C(), x.id, { grade: 7, subject: 'EVS', date: '2027-03-02', start: '10:00', end: '13:00' }), 400);
    const a = portal.savePaper(C(), x.id, { grade: 7, subject: 'Maths', date: '2027-03-02', start: '10:00', end: '13:00' });
    expectError(() => portal.savePaper(C(), x.id, { grade: 7, subject: 'Science', date: '2027-03-02', start: '12:00', end: '14:00' }), 409);
    portal.savePaper(C(), x.id, { id: a.id, grade: 7, subject: 'Maths', date: '2027-03-03', start: '10:00', end: '13:00' });
    expectError(() => portal.publishExamPlan(C(), x.id, true), 409); // standard 3 has no papers, no seats
    portal.savePaper(C(), x.id, { grade: 3, subject: 'EVS', date: '2027-03-03', start: '09:30', end: '11:00', maxMarks: 50 });
    const small = portal.addHall(C(), { name: 'Room 9', where: 'Old block', rows: 2, cols: 2 });
    expectError(() => portal.allotSeats(C(), x.id, [small.id]), 409);
    portal.allotSeats(C(), x.id, [small.id, 'hall_main']);
    expectError(() => portal.updateHall(C(), small.id, { name: 'Room 9', rows: 1, cols: 1 }), 409);
    expectError(() => portal.removeHall(C(), small.id), 409);
    const plan = portal.getExamPlan(C(), x.id);
    const [s1, s2] = plan.students;
    const r = portal.moveSeat(C(), x.id, s1.id, s2.hallId!, s2.seat!);
    expect(r.swappedWith).toBe(s2.name);
    portal.setTicketHold(C(), x.id, s1.id, 'Fee pending');
    portal.publishExamPlan(C(), x.id, true);
    const kid = db.students.find((s) => s.id === s1.id)!;
    const parentLike = { ...u('u_s1_student'), studentIds: [kid.id] };
    const mine = portal.myExams(parentLike).find((e) => e.id === x.id)!;
    expect(mine.withheld).toBe('Fee pending');
    expect(mine.papers.length).toBe(1);
    portal.deleteExamPlan(C(), x.id);
    portal.removeHall(C(), small.id);
  });
  it('shows the student their own papers, hall and seat', () => {
    const mine = portal.myExams(u('u_s1_student'));
    expect(mine[0].papers.every((p) => p.grade === 10)).toBe(true);
    expect(mine[0].hall?.name).toBeTruthy();
    expectError(() => portal.getExamPlan(u('u_s1_student'), 'xp_halfyearly'), 403);
  });
  it('suggests free teachers for an absent teacher’s periods', () => {
    const monday = '2026-11-02';
    const r = portal.substitutions(P(), 'u_s1_science', monday);
    expect(r.periods.length).toBeGreaterThan(0);
    for (const p of r.periods) expect(p.free.some((f) => f.id === 'u_s1_science')).toBe(false);
  });
});

describe('class advisors, class timetables and subject teachers', () => {
  const T = (id: string) => u(id);
  const P = () => u('u_s1_principal');
  it('shows a class timetable only to its advisor and the principal', () => {
    // u_s1_maths advises 10-B and teaches 10-A, but must not see 10-A's class timetable.
    const t = T('u_s1_maths');
    expect(portal.timetable(t).options.classes.map((c) => c.id)).toEqual(['cls_s1_10b']);
    expect(() => portal.timetable(t, { classId: 'cls_s1_10a' })).toThrow(PortalError);
    expect(portal.timetable(t, { classId: 'cls_s1_10b' }).view?.editable).toBe(true);
    expect(portal.timetable(P(), { classId: 'cls_s1_10a' }).view?.editable).toBe(true);
  });
  it('lets the advisor change a period, refuses clashes and other classes, and can undo', () => {
    const t = T('u_s1_maths');
    const v = portal.timetable(t, { classId: 'cls_s1_10b' }).view!;
    const cur = v.cells[0][0]?.subject;
    const next = ['PT', 'Library'].find((x) => x !== cur)!;
    portal.setPeriod(t, 'cls_s1_10b', 0, 0, next);
    expect(portal.timetable(t, { classId: 'cls_s1_10b' }).view!.cells[0][0]?.subject).toBe(next);
    expect(portal.timetable(t, { classId: 'cls_s1_10b' }).view!.cells[0][0]?.edited).toBe(true);
    portal.setPeriod(t, 'cls_s1_10b', 0, 1, null);
    expect(portal.timetable(t, { classId: 'cls_s1_10b' }).view!.cells[0][1]).toMatchObject({ subject: '' });
    expect(() => portal.setPeriod(t, 'cls_s1_10a', 0, 0, 'PT')).toThrow(/class advisor/);
    // Find a period where the 10-B Maths teacher is busy in another class: putting Maths in 10-B then clashes.
    const tv = portal.timetable(P(), { teacherId: 'u_s1_maths' }).view!;
    let clash: [number, number] | null = null;
    tv.cells.forEach((row, d) => row.forEach((c, p) => { if (!clash && c && c.with !== '10-B') clash = [d, p]; }));
    expect(clash).not.toBeNull();
    expect(() => portal.setPeriod(P(), 'cls_s1_10b', clash![0], clash![1], 'Maths')).toThrow(/teaches/);
    expect(portal.resetTimetable(t, 'cls_s1_10b').undone).toBe(2);
  });
  it('lets the principal choose the teacher for a subject in a class', () => {
    const before = portal.listClasses(P()).find((c) => c.id === 'cls_s1_7a')!.subjectTeacherList.find((x) => x.subject === 'English')!;
    const pick = ['u_s1_eng2', 'u_s1_english'].find((x) => x !== before.teacherId)!;
    portal.setSubjectTeacher(P(), 'cls_s1_7a', 'English', pick);
    const after = portal.listClasses(P()).find((c) => c.id === 'cls_s1_7a')!.subjectTeacherList.find((x) => x.subject === 'English')!;
    expect(after.teacherId).toBe(pick);
    expect(T(pick).classIds).toContain('cls_s1_7a');
    portal.setSubjectTeacher(P(), 'cls_s1_7a', 'English', null);
    expect(portal.listClasses(P()).find((c) => c.id === 'cls_s1_7a')!.subjectTeacherList.find((x) => x.subject === 'English')!.teacherId).toBeNull();
    expect(() => portal.setSubjectTeacher(T('u_s1_maths'), 'cls_s1_10b', 'Maths', 'u_s1_maths')).toThrow(PortalError);
  });
});

describe('staff attendance and staff leave', () => {
  const P = () => u('u_s1_principal');
  it('lets the principal mark staff attendance, with approved leave filled in', () => {
    const t = u('u_s1_english');
    const lv = portal.applyLeave(t, { kind: 'Casual', from: '2026-10-26', days: 1, reason: 'Hospital visit' });
    expectError(() => portal.applyLeave(t, { kind: 'Casual', from: '2026-10-26', days: 1, reason: 'Again' }), 409);
    expectError(() => portal.decideLeave(P(), lv.id, false), 400);
    portal.decideLeave(P(), lv.id, true);
    const day = portal.getStaffAttendance(P(), '2026-10-26');
    expect(day.staff.find((x) => x.id === t.id)?.mark).toBe('L');
    const marks = Object.fromEntries(day.staff.map((x) => [x.id, x.mark ?? 'P'])) as Record<string, 'P' | 'A' | 'L' | 'OD'>;
    expectError(() => portal.markStaffAttendance(P(), '2026-10-26', { [t.id]: 'P' }), 400);
    const r = portal.markStaffAttendance(P(), '2026-10-26', marks);
    expect(r.leave).toBeGreaterThanOrEqual(1);
    expect(portal.staffAttendanceMonth(P(), '2026-10').rows.find((x) => x.id === t.id)!.L).toBeGreaterThanOrEqual(1);
    expectError(() => portal.getStaffAttendance(t, '2026-10-26'), 403);
  });
  it('shows teachers only their own leave and the principal everyone’s', () => {
    const mine = portal.listLeave(u('u_s1_english'));
    expect(mine.every((l) => l.userId === 'u_s1_english')).toBe(true);
    expect(portal.listLeave(P()).length).toBeGreaterThan(mine.length);
    const p = mine.find((l) => l.status === 'Pending')!;
    portal.withdrawLeave(u('u_s1_english'), p.id);
    expectError(() => portal.decideLeave(P(), p.id, true), 409);
  });
  it('lets only the principal choose exam coordinators', () => {
    expectError(() => portal.setExamCoordinator(u('u_s1_maths'), 'u_s1_science', true), 403);
    portal.setExamCoordinator(P(), 'u_s1_science', true);
    expect(portal.listExamPlans(u('u_s1_science')).length).toBeGreaterThan(0);
    portal.setExamCoordinator(P(), 'u_s1_science', false);
    expectError(() => portal.listExamPlans(u('u_s1_science')), 403);
  });
});

describe('teacher portal', () => {
  it('only the class advisor marks a class register; subject teachers can view it', () => {
    const maths = u('u_s1_maths'); // advisor of 10-B, teaches maths in 10-A
    const { students } = portal.getAttendance(maths, 'cls_s1_10a', '2026-10-26');
    const marks = Object.fromEntries(students.map((s) => [s.id, 'P' as const]));
    expectError(() => portal.markAttendance(maths, { classId: 'cls_s1_10a', date: '2026-10-26', marks }), 403);
    const own = portal.getAttendance(maths, 'cls_s1_10b', '2026-10-26').students;
    expect(portal.markAttendance(maths, { classId: 'cls_s1_10b', date: '2026-10-26', marks: Object.fromEntries(own.map((s) => [s.id, 'P' as const])) }).counts.P).toBe(own.length);
  });
  it('lets a teacher edit questions until marks are in', () => {
    const t = u('u_s1_maths');
    const e = portal.createExam(t, { classId: 'cls_s1_10b', subject: 'Maths', name: 'Quiz', type: db.schools[0].settings.examTypes[0], date: '2026-10-20', questions: [{ no: '1', text: 'Old', maxMarks: 2, chapter: 'Algebra', answerKey: 'x', steps: [] }] });
    portal.updateExam(t, e.id, { questions: [{ no: '1', text: 'New', maxMarks: 3, chapter: 'Algebra', answerKey: 'y', steps: [] }, { no: '2', text: 'Two', maxMarks: 2, chapter: 'Algebra', answerKey: 'z', steps: [] }] });
    expect(portal.getExam(t, e.id).exam.questions.map((q) => q.text)).toEqual(['New', 'Two']);
    const st = portal.getExam(t, e.id).students[0];
    portal.saveMarks(t, e.id, st.id, { 1: 3 });
    expectError(() => portal.updateExam(t, e.id, { questions: [{ no: '1', text: 'Again', maxMarks: 2, chapter: 'A', answerKey: '', steps: [] }] }), 409);
  });
  it('sets exam timing for a group of standards and moves their papers', () => {
    const c = u('u_s1_maths');
    const plan = portal.getExamPlan(c, 'xp_halfyearly');
    const len = (t: { start: string; end: string }) => Number(t.end.replace(':', '')) - Number(t.start.replace(':', ''));
    expect(len(plan.timings['1']) < len(plan.timings['10'])).toBe(true);
    const r = portal.setExamTiming(c, 'xp_halfyearly', [1, 2], { start: '09:00', end: '10:00', maxMarks: 40 }, true);
    expect(r.moved).toBeGreaterThan(0);
    const after = portal.getExamPlan(c, 'xp_halfyearly');
    expect(after.papers.filter((p) => p.grade <= 2).every((p) => p.start === '09:00' && p.maxMarks === 40)).toBe(true);
    expect(after.papers.filter((p) => p.grade === 10).every((p) => p.start === '10:00')).toBe(true);
    expectError(() => portal.setExamTiming(u('u_s1_principal'), 'xp_halfyearly', [1], { start: '09:00', end: '10:00', maxMarks: 40 }), 403);
  });
  it('gives a teacher analytics only for the classes and subjects they teach', () => {
    const r = portal.teacherInsights(u('u_s1_maths'));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.subject === 'Maths')).toBe(true);
    expect(r.map((x) => x.classLabel).sort()).toEqual(['10-A', '10-B']);
    expectError(() => portal.teacherInsights(u('u_s1_principal')), 403);
  });
});

describe('report card history, leaving school, analytics scope', () => {
  const arun = 'stu_cls_s1_10a_1';
  it('lists report cards from earlier standards for the student and parent only', () => {
    const list = portal.reportCardList(u('u_s1_student'), arun);
    expect(new Set(list.map((x) => x.grade))).toEqual(new Set([10, 9, 8, 7]));
    expect(list.filter((x) => x.current).every((x) => x.grade === 10)).toBe(true);
    const old = list.find((x) => x.grade === 9 && x.examName === 'Annual')!;
    const rc = portal.reportCardByKey(u('u_s1_parent'), arun, old.key) as { archived: boolean; result?: string; year: string };
    expect(rc.archived).toBe(true);
    expect(rc.result).toMatch(/Promoted to standard 10/);
    expect(rc.year).not.toBe(list.find((x) => x.current)!.year);
    expectError(() => portal.reportCardList(u('u_s2_principal'), arun), 403);
  });
  it('gives every listed report card a summary that matches the full card', () => {
    const list = portal.reportCardList(u('u_s1_parent'), arun);
    for (const c of list) {
      const rc = portal.reportCardByKey(u('u_s1_parent'), arun, c.key);
      expect(c.overall).toBe(rc.overall);
      expect(c.letter).toBe(rc.grade);
      expect(c.rank).toBe(rc.rank);
    }
  });
  it('turns off a leaving student’s sign-in and says so', () => {
    const phone = u('u_s1_student').phone;
    expect(portal.deactivatedPhone(phone)).toBe(false);
    const r = portal.removeStudent(u('u_s1_science'), arun, { reason: 'Transfer certificate issued' });
    expect(r.signInsClosed.length).toBeGreaterThan(0);
    expect(portal.deactivatedPhone(phone)).toBe(true);
    portal.restoreStudent(u('u_s1_science'), arun);
    expect(portal.deactivatedPhone(phone)).toBe(false);
  });
  it('bases analytics on all tests or only the latest', () => {
    const all = portal.teacherInsights(u('u_s1_maths'));
    const last = portal.teacherInsights(u('u_s1_maths'), { scope: 'last' });
    expect(last.every((x) => x.tests.length <= 1)).toBe(true);
    expect(all[0].testsInAll).toBe(all[0].tests.length);
  });
});
