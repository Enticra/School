import type {
  Activity, AnswerScript, AttendanceMark, AttendanceRecord, ClassRoom, Db, Exam, ExamHall, ExamPaper, ExamPlan, ExamSeat, ExamTiming, Homework, HomeworkSubmission, MarkSheet, NotifyKey,
  LeaveKind, OutboundMessage, Question, ResponseGrade, Role, School, SchoolBranding, SchoolSettings, ScriptPage, StaffLeave, StaffMark, Student, User,
} from './types';
import { examMax, mockGrader, scriptTotal, type Grader } from './grading';
import { render } from './templates';
import { allocateSeats, groupSittings } from './seating';
import { defaultSettings } from './seed';
import { addDays, classLabel, examTimingFor, clone, hhmm, inWindow, isoDate, localDates, pct, round1, uid, academicYear } from './util';

export class PortalError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409, message: string) { super(message); }
}

export interface PortalOptions {
  grader?: Grader;
  now?: () => Date;
  /** Called after every write so the host can persist the database. */
  onChange?: (db: Db) => void;
  /** Called for each new outbound WhatsApp message (the server's provider adapter). */
  onMessage?: (msg: OutboundMessage) => void | Promise<void>;
}

const HEX = /^#[0-9a-f]{6}$/i;
const TT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TT_PERIODS = ['9:00', '9:45', '10:30', '11:30', '12:15', '2:00', '2:45', '3:30'];
const TT_EXTRAS = ['PT', 'Library'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The portal service. Every method takes the signed-in user first and checks
 * role and school before touching data, so the same rules hold for the HTTP
 * API and the in-browser demo.
 */
export class Portal {
  grader: Grader;
  private now: () => Date;
  constructor(public db: Db, private opts: PortalOptions = {}) {
    this.grader = opts.grader ?? mockGrader;
    this.now = opts.now ?? (() => new Date());
    // Databases saved before these lists existed.
    this.db.submissions ??= [];
    this.db.formerStudents ??= [];
    this.db.reportArchive ??= [];
    this.db.halls ??= [];
    this.db.examPlans ??= [];
    this.db.timetableEdits ??= [];
    this.db.staffAttendance ??= [];
    this.db.staffLeave ??= [];
  }

  // ---------------------------------------------------------------- guards

  private changed() { this.opts.onChange?.(this.db); }

  private audit(actor: User, schoolId: string | null, action: string, detail: string) {
    this.db.audit.push({ id: uid('aud'), schoolId, actorId: actor.id, action, detail, at: this.now().toISOString() });
  }

  private role(actor: User, ...roles: Role[]) {
    if (!roles.includes(actor.role)) throw new PortalError(403, 'Your role cannot do this.');
  }

  /** Exams, halls, seating and hall tickets are planned by teachers the principal makes exam coordinator. */
  private coordinator(actor: User) {
    if (actor.role !== 'teacher' || !actor.examCoordinator) throw new PortalError(403, 'Only the exam coordinator can change exams. The principal can view them.');
  }

  private school(actor: User, schoolId?: string): School {
    if (actor.role !== 'enticra_admin' && schoolId && schoolId !== actor.schoolId) throw new PortalError(403, 'Not your school.');
    const id = actor.role === 'enticra_admin' ? schoolId : actor.schoolId;
    const s = this.db.schools.find((x) => x.id === id);
    if (!s) throw new PortalError(404, 'School not found.');
    return s;
  }

  private module(school: School, key: keyof SchoolSettings['modules']) {
    if (!school.settings.modules[key]) throw new PortalError(403, 'This module is switched off for your school.');
  }

  private classFor(actor: User, classId: string): ClassRoom {
    const c = this.db.classes.find((x) => x.id === classId);
    if (!c) throw new PortalError(404, 'Class not found.');
    this.school(actor, c.schoolId);
    if (actor.role === 'teacher' && !actor.classIds?.includes(c.id)) throw new PortalError(403, 'You do not teach this class.');
    if (actor.role === 'parent' || actor.role === 'student') {
      const kids = this.db.students.filter((s) => actor.studentIds?.includes(s.id));
      if (!kids.some((k) => k.classId === c.id)) throw new PortalError(403, 'Not your child’s class.');
    }
    return c;
  }

  private studentFor(actor: User, studentId: string): Student {
    const s = this.db.students.find((x) => x.id === studentId);
    if (!s) throw new PortalError(404, 'Student not found.');
    this.school(actor, s.schoolId);
    if ((actor.role === 'parent' || actor.role === 'student') && !actor.studentIds?.includes(s.id)) throw new PortalError(403, 'Not your child.');
    if (actor.role === 'teacher' && !actor.classIds?.includes(s.classId)) throw new PortalError(403, 'You do not teach this student.');
    return s;
  }

  private examFor(actor: User, examId: string): Exam {
    const e = this.db.exams.find((x) => x.id === examId);
    if (!e) throw new PortalError(404, 'Test not found.');
    this.classFor(actor, e.classId);
    return e;
  }

  userById(id: string): User | undefined { return this.db.users.find((u) => u.id === id); }
  /** The signed-in user, unless their account was removed since they signed in. */
  sessionUser(id: string): User | undefined { const u = this.userById(id); return u && !u.removedAt ? u : undefined; }
  userByPhone(phone: string): User | undefined {
    const p = phone.replace(/\D/g, '').slice(-10);
    return this.db.users.find((u) => u.phone === p && !u.removedAt);
  }
  /** True when this number belonged to a student or parent whose sign-in was turned off because the student left. */
  deactivatedPhone(phone: string): boolean {
    const p = phone.replace(/\D/g, '').slice(-10);
    return !this.userByPhone(p) && this.db.formerStudents.some((f) => f.accounts.some((a) => a.phone === p));
  }
  private teachersOf(schoolId: string) { return this.db.users.filter((u) => u.schoolId === schoolId && u.role === 'teacher' && !u.removedAt); }

  // ---------------------------------------------------------------- messaging

  private send(school: School, st: Student, template: NotifyKey, vars: Record<string, string | number>): OutboundMessage | null {
    if (!school.settings.notify[template]) return null;
    const now = this.now();
    const lang = st.guardian.lang ?? school.settings.language;
    const quiet = inWindow(hhmm(now), school.settings.quietHours.start, school.settings.quietHours.end);
    const msg: OutboundMessage = {
      id: uid('msg'), schoolId: school.id, studentId: st.id, to: st.guardian.phone, guardianName: st.guardian.name, template, lang,
      body: render(template, lang, { student: st.name.split(' ')[0], school: school.shortName, ...localDates(vars, lang) }),
      status: !st.consent.whatsapp ? 'skipped_no_consent' : quiet ? 'scheduled' : 'sent',
      createdAt: now.toISOString(),
      // Held until quiet hours end: later today if it is past midnight, otherwise tomorrow morning.
      sendAt: quiet ? `${isoDate(hhmm(now) < school.settings.quietHours.end ? now : addDays(now, 1))}T${school.settings.quietHours.end}:00` : undefined,
    };
    this.db.messages.push(msg);
    if (msg.status === 'sent') void this.opts.onMessage?.(msg);
    return msg;
  }

  /** Send messages held for quiet hours once their time has come. Called by the server every minute. */
  releaseScheduled() {
    const now = this.now().toISOString();
    const due = this.db.messages.filter((m) => m.status === 'scheduled' && m.sendAt && new Date(m.sendAt).toISOString() <= now);
    for (const m of due) { m.status = 'sent'; void this.opts.onMessage?.(m); }
    if (due.length) this.changed();
    return due.length;
  }

  /** WhatsApp accepted the message for a real phone. */
  messageAccepted(id: string, providerId: string) {
    const m = this.db.messages.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, { providerId, live: true, error: undefined });
    this.changed();
  }

  /** A delivery update from WhatsApp. Updates never go backwards: a read message stays read. */
  messageStatus(providerId: string, status: 'sent' | 'delivered' | 'read' | 'failed', error?: string) {
    const m = this.db.messages.find((x) => x.providerId === providerId);
    if (!m) return null;
    const rank = { scheduled: 0, skipped_no_consent: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;
    if (status === 'failed') { m.status = 'failed'; m.error = error ?? 'WhatsApp could not deliver this message.'; }
    else if (m.status !== 'failed' && rank[status] > rank[m.status]) m.status = status;
    this.changed();
    return m;
  }

  /** Sending to a real phone failed before WhatsApp accepted it. */
  messageFailed(id: string, error: string) {
    const m = this.db.messages.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, { status: 'failed', live: true, error });
    this.changed();
  }

  // ---------------------------------------------------------------- session and schools

  me(actor: User) {
    const school = actor.schoolId ? this.db.schools.find((s) => s.id === actor.schoolId) ?? null : null;
    const children = actor.role === 'parent' || actor.role === 'student' ? this.db.students.filter((s) => actor.studentIds?.includes(s.id)) : [];
    return { user: actor, school, children };
  }

  listSchools(actor: User) {
    this.role(actor, 'enticra_admin');
    return this.db.schools.map((s) => ({
      ...s,
      students: this.db.students.filter((x) => x.schoolId === s.id).length,
      staff: this.db.users.filter((u) => u.schoolId === s.id && !u.removedAt && (u.role === 'teacher' || u.role === 'principal')).length,
      messages: this.db.messages.filter((m) => m.schoolId === s.id).length,
    }));
  }

  createSchool(actor: User, input: { name: string; shortName?: string; board: SchoolSettings['board']; principalName: string; principalPhone: string; primary?: string; accent?: string; language?: 'en' | 'ta' }) {
    this.role(actor, 'enticra_admin');
    const name = input.name?.trim();
    if (!name || name.length < 4) throw new PortalError(400, 'Enter the school’s full name.');
    const phone = input.principalPhone?.replace(/\D/g, '').slice(-10);
    if (!phone || phone.length !== 10) throw new PortalError(400, 'Enter a 10-digit mobile number for the principal.');
    if (this.userByPhone(phone)) throw new PortalError(409, 'That mobile number already has an account.');
    const primary = input.primary && HEX.test(input.primary) ? input.primary : '#0B333B';
    const accent = input.accent && HEX.test(input.accent) ? input.accent : '#E26527';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const crest = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('') || name.slice(0, 2).toUpperCase();
    const school: School = {
      id: uid('sch'), slug, name, shortName: input.shortName?.trim() || name.split(' ').slice(0, 2).join(' '), plan: 'pilot',
      branding: { primary, accent, crest, motto: '', letterhead: '' },
      settings: { ...defaultSettings(input.board), language: input.language ?? 'en' },
      createdAt: this.now().toISOString(),
    };
    this.db.schools.push(school);
    const principal: User = { id: uid('u'), schoolId: school.id, role: 'principal', name: input.principalName?.trim() || 'Principal', phone, title: 'Principal' };
    this.db.users.push(principal);
    this.audit(actor, school.id, 'school.created', `${name} created with principal ${principal.name}`);
    this.changed();
    return { school, principal };
  }

  getSchool(actor: User, schoolId?: string) { return this.school(actor, schoolId); }

  updateSchool(actor: User, patch: { name?: string; shortName?: string; branding?: Partial<SchoolBranding>; settings?: Partial<SchoolSettings> }, schoolId?: string) {
    this.role(actor, 'principal', 'enticra_admin');
    const school = this.school(actor, schoolId);
    const next = clone(school);
    if (patch.name !== undefined) { if (patch.name.trim().length < 4) throw new PortalError(400, 'School name is too short.'); next.name = patch.name.trim(); }
    if (patch.shortName !== undefined) next.shortName = patch.shortName.trim() || next.shortName;
    if (patch.branding) {
      const b = { ...next.branding, ...patch.branding };
      if (!HEX.test(b.primary) || !HEX.test(b.accent)) throw new PortalError(400, 'Colours must be hex values like #1B3A6B.');
      b.crest = b.crest.trim().slice(0, 3).toUpperCase() || next.branding.crest;
      if (b.logoDataUrl && (!b.logoDataUrl.startsWith('data:image/') || b.logoDataUrl.length > 400_000)) throw new PortalError(400, 'Logo must be an image under 300 KB.');
      next.branding = b;
    }
    if (patch.settings) {
      const s = { ...next.settings, ...patch.settings, version: next.settings.version };
      if (!TIME.test(s.lateCutoff) || !TIME.test(s.quietHours.start) || !TIME.test(s.quietHours.end)) throw new PortalError(400, 'Times must be in 24-hour HH:MM format.');
      if (s.passMark < 0 || s.passMark > 100) throw new PortalError(400, 'Pass mark must be between 0 and 100.');
      if (s.aiConfidenceThreshold < 0.5 || s.aiConfidenceThreshold > 0.99) throw new PortalError(400, 'Review threshold must be between 50% and 99%.');
      if (!s.examTypes.length) throw new PortalError(400, 'Keep at least one exam type.');
      s.gradingScale = [...s.gradingScale].sort((a, b) => b.min - a.min);
      if (s.gradingScale.at(-1)?.min !== 0) throw new PortalError(400, 'The lowest grade band must start at 0.');
      s.version += 1;
      next.settings = s;
    }
    Object.assign(school, next);
    this.audit(actor, school.id, 'settings.updated', `Settings saved as version ${school.settings.version}`);
    this.changed();
    return school;
  }

  // ---------------------------------------------------------------- classes and students

  listClasses(actor: User) {
    let list = this.db.classes;
    if (actor.role !== 'enticra_admin') { const school = this.school(actor); list = list.filter((c) => c.schoolId === school.id); }
    if (actor.role === 'teacher') list = list.filter((c) => actor.classIds?.includes(c.id));
    if (actor.role === 'parent' || actor.role === 'student') {
      const kids = this.db.students.filter((s) => actor.studentIds?.includes(s.id)).map((s) => s.classId);
      list = list.filter((c) => kids.includes(c.id));
    }
    // Senior classes first, then by section: 12-A, 11-A, 10-A, 10-B, 9-A … 1-A.
    return [...list].sort((a, b) => b.grade - a.grade || a.section.localeCompare(b.section)).map((c) => ({ ...c, label: classLabel(c), students: this.db.students.filter((s) => s.classId === c.id).length, teacher: this.userById(c.classTeacherId)?.name ?? '',
      subjectTeacherList: c.subjects.map((subject) => { const t = this.subjectTeacher(c.id, subject); return { subject, teacherId: t?.id ?? null, teacher: t?.name ?? '' }; }) }));
  }

  listStudents(actor: User, opts: { classId?: string; q?: string } = {}) {
    this.role(actor, 'principal', 'teacher', 'parent', 'student');
    const school = this.school(actor);
    let list = this.db.students.filter((s) => s.schoolId === school.id);
    if (actor.role === 'teacher') list = list.filter((s) => actor.classIds?.includes(s.classId));
    if (actor.role === 'parent' || actor.role === 'student') list = list.filter((s) => actor.studentIds?.includes(s.id));
    if (opts.classId) list = list.filter((s) => s.classId === opts.classId);
    if (opts.q) { const q = opts.q.toLowerCase(); list = list.filter((s) => s.name.toLowerCase().includes(q) || s.guardian.phone.includes(q)); }
    return list
      .sort((a, b) => a.classId.localeCompare(b.classId) || a.rollNo - b.rollNo)
      .map((s) => ({ ...s, classLabel: classLabel(this.db.classes.find((c) => c.id === s.classId)!), attendancePct: this.attendancePct(s.id), average: this.averagePct(s.id) }));
  }

  private attendancePct(studentId: string): number {
    let present = 0, total = 0;
    for (const r of this.db.attendance) {
      const m = r.marks[studentId];
      if (!m) continue;
      total++;
      if (m !== 'A') present++;
    }
    return total ? pct(present, total) : 100;
  }

  private averagePct(studentId: string): number | null {
    const sheets = this.db.marks.filter((m) => m.studentId === studentId);
    if (!sheets.length) return null;
    let got = 0, max = 0;
    for (const m of sheets) { const e = this.db.exams.find((x) => x.id === m.examId); if (!e || e.status !== 'published') continue; got += m.total; max += examMax(e); }
    return max ? pct(got, max) : null;
  }

  getStudent(actor: User, studentId: string) {
    const s = this.studentFor(actor, studentId);
    const cls = this.db.classes.find((c) => c.id === s.classId)!;
    const days = this.db.attendance.filter((r) => r.marks[s.id]).sort((a, b) => a.date.localeCompare(b.date));
    const exams = this.db.exams.filter((e) => e.classId === s.classId && e.status === 'published').sort((a, b) => a.date.localeCompare(b.date));
    const results = exams.map((e) => {
      const m = this.db.marks.find((x) => x.examId === e.id && x.studentId === s.id);
      return { examId: e.id, name: e.name, subject: e.subject, date: e.date, total: m?.total ?? null, max: examMax(e), pct: m ? pct(m.total, examMax(e)) : null };
    });
    // Chapter strengths from per-question marks
    const chapters: Record<string, { got: number; max: number }> = {};
    for (const e of exams) {
      const m = this.db.marks.find((x) => x.examId === e.id && x.studentId === s.id);
      if (!m) continue;
      for (const q of e.questions) {
        const key = `${e.subject} · ${q.chapter}`;
        chapters[key] ??= { got: 0, max: 0 };
        chapters[key].got += m.perQuestion[q.no] ?? 0;
        chapters[key].max += q.maxMarks;
      }
    }
    const chapterList = Object.entries(chapters).map(([k, v]) => ({ chapter: k, pct: pct(v.got, v.max) })).sort((a, b) => a.pct - b.pct);
    const feedback = this.db.scripts
      .filter((x) => x.studentId === s.id && x.status === 'approved')
      .map((x) => ({ script: x, exam: this.db.exams.find((e) => e.id === x.examId)! }));
    return {
      student: s, classLabel: classLabel(cls), classTeacher: this.userById(cls.classTeacherId)?.name ?? '',
      sections: this.db.classes.filter((c) => c.schoolId === cls.schoolId && c.grade === cls.grade).sort((a, b) => a.section.localeCompare(b.section)).map((c) => ({ id: c.id, label: classLabel(c) })),
      attendance: { pct: this.attendancePct(s.id), absent: days.filter((d) => d.marks[s.id] === 'A').map((d) => d.date), late: days.filter((d) => d.marks[s.id] === 'L').length, total: days.length, recent: days.slice(-20).map((d) => ({ date: d.date, mark: d.marks[s.id] })) },
      results, chapters: chapterList, feedback,
      risk: this.riskFor(s),
    };
  }

  private riskFor(s: Student): string[] {
    const school = this.db.schools.find((x) => x.id === s.schoolId)!;
    const out: string[] = [];
    const att = this.attendancePct(s.id);
    if (att < 75) out.push(`Attendance ${att}%, below 75%`);
    const avg = this.averagePct(s.id);
    if (avg !== null && avg < school.settings.passMark + 10) out.push(`Average ${avg}%, close to the pass mark`);
    return out;
  }

  addActivity(actor: User, studentId: string, a: Omit<Activity, 'id'>) {
    this.role(actor, 'principal', 'teacher');
    const s = this.studentFor(actor, studentId);
    this.module(this.school(actor), 'profiles');
    if (!a.title?.trim()) throw new PortalError(400, 'Give the activity a title.');
    const act: Activity = { id: uid('act'), kind: a.kind, title: a.title.trim(), detail: a.detail?.trim() ?? '', date: a.date || isoDate(this.now()) };
    s.activities.unshift(act);
    this.changed();
    return act;
  }

  addObservation(actor: User, studentId: string, text: string) {
    this.role(actor, 'principal', 'teacher');
    const s = this.studentFor(actor, studentId);
    if (!text?.trim()) throw new PortalError(400, 'Write the observation first.');
    const o = { by: actor.name, text: text.trim(), date: isoDate(this.now()) };
    s.observations.unshift(o);
    this.changed();
    return o;
  }

  setInterests(actor: User, studentId: string, interests: string[]) {
    this.role(actor, 'principal', 'teacher', 'parent', 'student');
    const s = this.studentFor(actor, studentId);
    s.interests = interests.map((i) => i.trim()).filter(Boolean).slice(0, 12);
    this.changed();
    return s.interests;
  }

  // ---------------------------------------------------------------- attendance

  getAttendance(actor: User, classId: string, date: string, session: AttendanceRecord['session'] = 'day') {
    const c = this.classFor(actor, classId);
    const school = this.school(actor);
    const ses = school.settings.attendanceMode === 'session' && session === 'day' ? 'am' : session;
    const record = this.db.attendance.find((r) => r.classId === c.id && r.date === date && r.session === ses) ?? null;
    const students = this.db.students.filter((s) => s.classId === c.id).sort((a, b) => a.rollNo - b.rollNo);
    return { class: { ...c, label: classLabel(c) }, date, session: ses, record, students };
  }

  markAttendance(actor: User, input: { classId: string; date: string; session?: AttendanceRecord['session']; marks: Record<string, AttendanceMark>; lateTimes?: Record<string, string> }) {
    this.role(actor, 'teacher', 'principal');
    const c = this.classFor(actor, input.classId);
    if (actor.role === 'teacher' && c.classTeacherId !== actor.id) throw new PortalError(403, `Only the class advisor of ${classLabel(c)} marks its attendance. You can see who is absent.`);
    const school = this.school(actor);
    this.module(school, 'attendance');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new PortalError(400, 'Pick a valid date.');
    if (input.date > isoDate(this.now())) throw new PortalError(400, 'You cannot mark attendance for a future date.');
    const session = school.settings.attendanceMode === 'session' ? (input.session === 'pm' ? 'pm' : 'am') : 'day';
    const roster = this.db.students.filter((s) => s.classId === c.id);
    for (const s of roster) if (!['P', 'A', 'L'].includes(input.marks[s.id])) throw new PortalError(400, `Mark every student. ${s.name} is missing.`);
    let record = this.db.attendance.find((r) => r.classId === c.id && r.date === input.date && r.session === session);
    const previous = record ? { ...record.marks } : null;
    const nowTime = hhmm(this.now());
    const lateTimes = { ...(record?.lateTimes ?? {}), ...(input.lateTimes ?? {}) };
    for (const s of roster) if (input.marks[s.id] === 'L' && !lateTimes[s.id]) lateTimes[s.id] = nowTime;
    if (!record) {
      record = { id: uid('att'), schoolId: school.id, classId: c.id, date: input.date, session, marks: {}, lateTimes: {}, markedBy: actor.id, markedAt: this.now().toISOString() };
      this.db.attendance.push(record);
    }
    record.marks = Object.fromEntries(roster.map((s) => [s.id, input.marks[s.id]]));
    record.lateTimes = lateTimes;
    record.markedBy = actor.id;
    record.markedAt = this.now().toISOString();

    // Message parents only when a child's status is new or changed, and only for today's record.
    const messages: OutboundMessage[] = [];
    if (input.date === isoDate(this.now()) && session !== 'pm') {
      for (const s of roster) {
        const m = record.marks[s.id];
        if (previous && previous[s.id] === m) continue;
        const key: NotifyKey = m === 'A' ? 'absent' : m === 'L' ? 'late' : 'arrived';
        const msg = this.send(school, s, key, { date: input.date, time: m === 'L' ? lateTimes[s.id] : nowTime });
        if (msg) messages.push(msg);
      }
    }
    const counts = { P: 0, A: 0, L: 0 };
    for (const m of Object.values(record.marks)) counts[m]++;
    this.audit(actor, school.id, 'attendance.marked', `${classLabel(c)} ${input.date}: ${counts.P} present, ${counts.A} absent, ${counts.L} late`);
    this.changed();
    return { record, counts, messages };
  }

  // ---------------------------------------------------------------- homework

  listHomework(actor: User, opts: { classId?: string } = {}) {
    const school = this.school(actor);
    const classIds = this.listClasses(actor).map((c) => c.id);
    return this.db.homework
      .filter((h) => h.schoolId === school.id && classIds.includes(h.classId) && (!opts.classId || h.classId === opts.classId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((h) => {
        const subs = this.db.submissions.filter((x) => x.homeworkId === h.id);
        const mine = actor.role === 'student' ? subs.find((x) => actor.studentIds?.includes(x.studentId)) ?? null : null;
        return {
          ...h, classLabel: classLabel(this.db.classes.find((c) => c.id === h.classId)!), teacher: this.userById(h.assignedBy)?.name ?? '',
          handedIn: subs.length, classSize: this.db.students.filter((x) => x.classId === h.classId).length,
          mine: mine && { status: mine.status, submittedAt: mine.submittedAt, note: mine.note, remark: mine.remark ?? '', hasPhoto: !!mine.photoDataUrl },
        };
      });
  }

  /** A student hands in homework (or replaces what they handed in, unless the teacher has already checked it). */
  submitHomework(actor: User, homeworkId: string, input: { note?: string; photoDataUrl?: string }) {
    this.role(actor, 'student');
    const h = this.db.homework.find((x) => x.id === homeworkId);
    if (!h) throw new PortalError(404, 'Homework not found.');
    const st = this.db.students.find((x) => actor.studentIds?.includes(x.id) && x.classId === h.classId);
    if (!st) throw new PortalError(403, 'This homework is not for your class.');
    if (!input.photoDataUrl && !input.note?.trim()) throw new PortalError(400, 'Add a photo of your work or a note.');
    if (input.photoDataUrl && (!input.photoDataUrl.startsWith('data:image/') || input.photoDataUrl.length > 1_500_000)) throw new PortalError(400, 'Use a photo under 1 MB.');
    const prev = this.db.submissions.find((x) => x.homeworkId === h.id && x.studentId === st.id);
    if (prev?.status === 'checked') throw new PortalError(409, 'Your teacher has already checked this. Ask them if you need to hand it in again.');
    const sub: HomeworkSubmission = { id: prev?.id ?? uid('sub'), schoolId: h.schoolId, homeworkId: h.id, studentId: st.id, note: input.note?.trim() ?? '', photoDataUrl: input.photoDataUrl, submittedAt: this.now().toISOString(), status: 'submitted' };
    this.db.submissions = [...this.db.submissions.filter((x) => x.id !== sub.id), sub];
    this.changed();
    return { status: sub.status, submittedAt: sub.submittedAt, late: isoDate(this.now()) > h.dueDate };
  }

  /** A student takes back what they handed in, before the teacher checks it. */
  withdrawHomework(actor: User, homeworkId: string) {
    this.role(actor, 'student');
    const sub = this.db.submissions.find((x) => x.homeworkId === homeworkId && actor.studentIds?.includes(x.studentId));
    if (!sub) throw new PortalError(404, 'Nothing handed in for this homework.');
    if (sub.status === 'checked') throw new PortalError(409, 'Your teacher has already checked this.');
    this.db.submissions = this.db.submissions.filter((x) => x.id !== sub.id);
    this.changed();
    return { withdrawn: true };
  }

  /** Who handed in a piece of homework: for the teacher who set it, the class advisor and the principal. */
  listSubmissions(actor: User, homeworkId: string) {
    this.role(actor, 'teacher', 'principal');
    const h = this.db.homework.find((x) => x.id === homeworkId);
    if (!h) throw new PortalError(404, 'Homework not found.');
    const c = this.classFor(actor, h.classId);
    if (actor.role === 'teacher' && h.assignedBy !== actor.id && c.classTeacherId !== actor.id) throw new PortalError(403, 'Only the teacher who set this homework can see what was handed in.');
    const rows = this.db.students.filter((x) => x.classId === h.classId).sort((a, b) => a.rollNo - b.rollNo).map((st) => {
      const sub = this.db.submissions.find((x) => x.homeworkId === h.id && x.studentId === st.id);
      return {
        studentId: st.id, name: st.name, rollNo: st.rollNo,
        status: sub ? sub.status : 'missing' as const,
        late: !!sub && sub.submittedAt.slice(0, 10) > h.dueDate,
        submittedAt: sub?.submittedAt ?? null, note: sub?.note ?? '', photoDataUrl: sub?.photoDataUrl ?? null, remark: sub?.remark ?? '',
      };
    });
    return { homework: { ...h, classLabel: classLabel(c), teacher: this.userById(h.assignedBy)?.name ?? '' }, rows };
  }

  /** The teacher marks a submission as checked, or asks for it again, with a remark the student sees. */
  reviewSubmission(actor: User, homeworkId: string, studentId: string, review: { status: 'checked' | 'redo' | 'submitted'; remark?: string }) {
    this.listSubmissions(actor, homeworkId);
    const sub = this.db.submissions.find((x) => x.homeworkId === homeworkId && x.studentId === studentId);
    if (!sub) throw new PortalError(404, 'This student has not handed it in.');
    if (review.status === 'redo' && !review.remark?.trim()) throw new PortalError(400, 'Tell the student what to fix.');
    Object.assign(sub, { status: review.status, remark: review.status === 'submitted' ? undefined : review.remark?.trim() || undefined, reviewedBy: review.status === 'submitted' ? undefined : actor.id });
    this.changed();
    return { status: sub.status };
  }

  createHomework(actor: User, input: { classId: string; subject: string; title: string; details?: string; dueDate: string; photoDataUrl?: string }) {
    this.role(actor, 'teacher', 'principal');
    const c = this.classFor(actor, input.classId);
    const school = this.school(actor);
    this.module(school, 'homework');
    if (!input.title?.trim()) throw new PortalError(400, 'Write what the homework is.');
    if (!c.subjects.includes(input.subject)) throw new PortalError(400, 'Pick a subject taught in this class.');
    if (!input.dueDate || input.dueDate < isoDate(this.now())) throw new PortalError(400, 'Due date must be today or later.');
    if (input.photoDataUrl && input.photoDataUrl.length > 1_500_000) throw new PortalError(400, 'Photo is too large. Use one under 1 MB.');
    const hw: Homework = { id: uid('hw'), schoolId: school.id, classId: c.id, subject: input.subject, title: input.title.trim(), details: input.details?.trim() ?? '', dueDate: input.dueDate, photoDataUrl: input.photoDataUrl, assignedBy: actor.id, createdAt: this.now().toISOString() };
    this.db.homework.push(hw);
    const messages = this.db.students.filter((s) => s.classId === c.id)
      .map((s) => this.send(school, s, 'homework', { subject: hw.subject, title: hw.title, due: hw.dueDate }))
      .filter((m): m is OutboundMessage => !!m);
    this.audit(actor, school.id, 'homework.created', `${classLabel(c)} ${hw.subject}: ${hw.title}`);
    this.changed();
    return { homework: hw, messages };
  }

  private homeworkFor(actor: User, homeworkId: string) {
    this.role(actor, 'teacher', 'principal');
    const h = this.db.homework.find((x) => x.id === homeworkId);
    if (!h) throw new PortalError(404, 'Homework not found.');
    this.classFor(actor, h.classId);
    if (actor.role === 'teacher' && h.assignedBy !== actor.id) throw new PortalError(403, 'Only the teacher who set this homework, or the principal, can change it.');
    return h;
  }

  /** Correct homework after posting. Parents are not messaged again. */
  updateHomework(actor: User, homeworkId: string, input: { title?: string; details?: string; dueDate?: string }) {
    const h = this.homeworkFor(actor, homeworkId);
    if (input.title !== undefined) { if (!input.title.trim()) throw new PortalError(400, 'Write what the homework is.'); h.title = input.title.trim(); }
    if (input.details !== undefined) h.details = input.details.trim();
    if (input.dueDate !== undefined && input.dueDate !== h.dueDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || input.dueDate < isoDate(this.now())) throw new PortalError(400, 'Due date must be today or later.');
      h.dueDate = input.dueDate;
    }
    this.audit(actor, h.schoolId, 'homework.updated', `${h.subject}: ${h.title}`);
    this.changed();
    return h;
  }

  /** Delete homework posted by mistake, with anything students handed in for it. */
  deleteHomework(actor: User, homeworkId: string) {
    const h = this.homeworkFor(actor, homeworkId);
    const n = this.db.submissions.filter((x) => x.homeworkId === h.id).length;
    this.db.homework = this.db.homework.filter((x) => x.id !== h.id);
    this.db.submissions = this.db.submissions.filter((x) => x.homeworkId !== h.id);
    this.audit(actor, h.schoolId, 'homework.deleted', `${h.subject}: ${h.title}${n ? ` (${n} hand-ins removed)` : ''}`);
    this.changed();
    return { deleted: h.title, submissionsRemoved: n };
  }

  // ---------------------------------------------------------------- exams and marks

  listExams(actor: User, opts: { classId?: string } = {}) {
    const school = this.school(actor);
    const classIds = this.listClasses(actor).map((c) => c.id);
    let list = this.db.exams.filter((e) => e.schoolId === school.id && classIds.includes(e.classId) && (!opts.classId || e.classId === opts.classId));
    if (actor.role === 'teacher') list = list.filter((e) => actor.subjects?.includes(e.subject) || e.createdBy === actor.id);
    if (actor.role === 'parent' || actor.role === 'student') list = list.filter((e) => e.status === 'published');
    return list.sort((a, b) => b.date.localeCompare(a.date)).map((e) => {
      const sheets = this.db.marks.filter((m) => m.examId === e.id);
      const scripts = this.db.scripts.filter((s) => s.examId === e.id);
      const max = examMax(e);
      return {
        ...e, classLabel: classLabel(this.db.classes.find((c) => c.id === e.classId)!), max,
        marked: sheets.length, average: sheets.length ? pct(sheets.reduce((t, m) => t + m.total, 0), sheets.length * max) : null,
        scripts: { total: scripts.length, toReview: scripts.filter((s) => s.status === 'graded').length, approved: scripts.filter((s) => s.status === 'approved').length, waiting: scripts.filter((s) => s.status === 'uploaded' || s.status === 'failed').length },
      };
    });
  }

  createExam(actor: User, input: { classId: string; subject: string; name: string; type: string; date: string; questions: Question[] }) {
    this.role(actor, 'teacher');
    const c = this.classFor(actor, input.classId);
    const school = this.school(actor);
    this.module(school, 'exams');
    if (!input.name?.trim()) throw new PortalError(400, 'Name the test, for example "Unit Test 3".');
    if (!school.settings.examTypes.includes(input.type)) throw new PortalError(400, 'Pick one of your school’s exam types.');
    if (!c.subjects.includes(input.subject)) throw new PortalError(400, 'Pick a subject taught in this class.');
    if (!input.questions?.length) throw new PortalError(400, 'Add at least one question.');
    const questions = this.cleanQuestions(input.questions);
    const exam: Exam = { id: uid('exm'), schoolId: school.id, classId: c.id, subject: input.subject, name: input.name.trim(), type: input.type, date: input.date || isoDate(this.now()), questions, status: 'marking', createdBy: actor.id };
    this.db.exams.push(exam);
    this.audit(actor, school.id, 'exam.created', `${classLabel(c)} ${exam.subject}: ${exam.name}`);
    this.changed();
    return exam;
  }

  private cleanQuestions(list: Question[]): Question[] {
    if (!list?.length) throw new PortalError(400, 'Add at least one question.');
    return list.map((q, i) => {
      const max = Number(q.maxMarks);
      if (!(max > 0 && max <= 100)) throw new PortalError(400, `Question ${i + 1} needs marks between 0.5 and 100.`);
      const steps = q.steps?.length ? q.steps.map((s) => ({ text: s.text.trim(), marks: Number(s.marks), keywords: s.keywords.map((k) => k.trim()).filter(Boolean) })) : [{ text: q.answerKey || 'Correct answer', marks: max, keywords: q.answerKey ? [q.answerKey] : [] }];
      const stepSum = round1(steps.reduce((t, s) => t + s.marks, 0));
      if (stepSum !== max) throw new PortalError(400, `Question ${i + 1}: step marks add up to ${stepSum}, but the question is worth ${max}.`);
      return { no: String(i + 1), text: q.text?.trim() || `Question ${i + 1}`, maxMarks: max, chapter: q.chapter?.trim() || 'General', answerKey: q.answerKey?.trim() ?? '', steps };
    });
  }

  /** Rename, re-date or re-type a test before it is published. Questions can change until marks or scripts are in. */
  updateExam(actor: User, examId: string, patch: { name?: string; date?: string; type?: string; questions?: Question[] }) {
    this.role(actor, 'teacher');
    const exam = this.examFor(actor, examId);
    const school = this.school(actor);
    if (exam.status === 'published') throw new PortalError(409, 'This test is already published to parents, so its details are locked.');
    if (patch.name !== undefined) { if (!patch.name.trim()) throw new PortalError(400, 'Name the test, for example "Unit Test 3".'); exam.name = patch.name.trim(); }
    if (patch.date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) throw new PortalError(400, 'Pick a date for the test.'); exam.date = patch.date; }
    if (patch.type !== undefined) { if (!school.settings.examTypes.includes(patch.type)) throw new PortalError(400, 'Pick one of your school’s exam types.'); exam.type = patch.type; }
    if (patch.questions !== undefined) {
      if (this.db.marks.some((m) => m.examId === exam.id) || this.db.scripts.some((x) => x.examId === exam.id)) throw new PortalError(409, 'Marks or scripts are already in for this test, so its questions are locked.');
      exam.questions = this.cleanQuestions(patch.questions);
    }
    this.audit(actor, school.id, 'exam.updated', `${exam.subject}: ${exam.name} on ${exam.date}`);
    this.changed();
    return exam;
  }

  /** Delete a test that has no marks or scripts yet (for example one created by mistake). */
  deleteExam(actor: User, examId: string) {
    this.role(actor, 'teacher');
    const exam = this.examFor(actor, examId);
    if (exam.status === 'published') throw new PortalError(409, 'A published test cannot be deleted.');
    if (this.db.marks.some((m) => m.examId === exam.id) || this.db.scripts.some((x) => x.examId === exam.id)) throw new PortalError(409, 'This test already has marks or scripts. Remove those first, or keep the test.');
    this.db.exams = this.db.exams.filter((e) => e.id !== exam.id);
    this.audit(actor, exam.schoolId, 'exam.deleted', `${exam.subject}: ${exam.name}`);
    this.changed();
    return { deleted: exam.id };
  }

  getExam(actor: User, examId: string) {
    const exam = this.examFor(actor, examId);
    const c = this.db.classes.find((x) => x.id === exam.classId)!;
    let students = this.db.students.filter((s) => s.classId === exam.classId).sort((a, b) => a.rollNo - b.rollNo);
    if (actor.role === 'parent' || actor.role === 'student') students = students.filter((s) => actor.studentIds?.includes(s.id));
    const ids = new Set(students.map((s) => s.id));
    const marks = this.db.marks.filter((m) => m.examId === exam.id && ids.has(m.studentId));
    const scripts = this.db.scripts.filter((s) => s.examId === exam.id && ids.has(s.studentId));
    const max = examMax(exam);
    const chapters: Record<string, { got: number; max: number }> = {};
    for (const m of marks) for (const q of exam.questions) {
      chapters[q.chapter] ??= { got: 0, max: 0 };
      chapters[q.chapter].got += m.perQuestion[q.no] ?? 0;
      chapters[q.chapter].max += q.maxMarks;
    }
    return {
      exam, classLabel: classLabel(c), max, students: students.map((s) => ({ id: s.id, name: s.name, rollNo: s.rollNo })), marks, scripts,
      chapters: Object.entries(chapters).map(([chapter, v]) => ({ chapter, pct: pct(v.got, v.max) })),
    };
  }

  saveMarks(actor: User, examId: string, studentId: string, perQuestion: Record<string, number>) {
    this.role(actor, 'teacher');
    const exam = this.examFor(actor, examId);
    const s = this.studentFor(actor, studentId);
    if (s.classId !== exam.classId) throw new PortalError(400, 'Student is not in this class.');
    const clean: Record<string, number> = {};
    for (const q of exam.questions) {
      const v = perQuestion[q.no];
      if (v === undefined || v === null || Number.isNaN(Number(v))) continue;
      const n = Number(v);
      if (n < 0 || n > q.maxMarks) throw new PortalError(400, `Q${q.no} must be between 0 and ${q.maxMarks}.`);
      clean[q.no] = round1(n);
    }
    return this.writeSheet(exam, s, clean, 'manual');
  }

  private writeSheet(exam: Exam, s: Student, per: Record<string, number>, source: MarkSheet['source']) {
    let sheet = this.db.marks.find((m) => m.examId === exam.id && m.studentId === s.id);
    const total = round1(Object.values(per).reduce((a, b) => a + b, 0));
    if (!sheet) { sheet = { id: uid('mrk'), schoolId: exam.schoolId, examId: exam.id, studentId: s.id, perQuestion: per, total, source, updatedAt: this.now().toISOString() }; this.db.marks.push(sheet); }
    else Object.assign(sheet, { perQuestion: per, total, source, updatedAt: this.now().toISOString() });
    this.changed();
    return sheet;
  }

  publishExam(actor: User, examId: string) {
    this.role(actor, 'teacher');
    const exam = this.examFor(actor, examId);
    const school = this.school(actor);
    if (exam.status === 'published') throw new PortalError(409, 'Marks are already published.');
    const sheets = this.db.marks.filter((m) => m.examId === exam.id);
    if (!sheets.length) throw new PortalError(400, 'Enter or approve marks before publishing.');
    exam.status = 'published';
    const max = examMax(exam);
    const messages = sheets.map((m) => {
      const st = this.db.students.find((x) => x.id === m.studentId)!;
      return this.send(school, st, 'marks', { exam: exam.name, subject: exam.subject, marks: m.total, max });
    }).filter((m): m is OutboundMessage => !!m);
    this.audit(actor, school.id, 'exam.published', `${exam.subject} ${exam.name}: ${sheets.length} students`);
    this.changed();
    return { exam, messages };
  }

  // ---------------------------------------------------------------- AI correction

  uploadScript(actor: User, input: { examId: string; studentId: string; pages: ScriptPage[] }) {
    this.role(actor, 'teacher');
    const exam = this.examFor(actor, input.examId);
    const school = this.school(actor);
    this.module(school, 'aiGrading');
    const s = this.studentFor(actor, input.studentId);
    if (s.classId !== exam.classId) throw new PortalError(400, 'Student is not in this class.');
    if (!input.pages?.length || input.pages.length > 12) throw new PortalError(400, 'Upload between 1 and 12 pages.');
    for (const p of input.pages) {
      if (p.dataUrl && !/^data:image\/(png|jpe?g|webp);base64,/.test(p.dataUrl)) throw new PortalError(400, 'Pages must be PNG, JPEG or WebP photos.');
      if (p.dataUrl && p.dataUrl.length > 6_000_000) throw new PortalError(400, 'A page is too large. Keep each photo under 4 MB.');
    }
    let script = this.db.scripts.find((x) => x.examId === exam.id && x.studentId === s.id);
    if (script?.status === 'approved') throw new PortalError(409, 'This script is already approved.');
    if (!script) { script = { id: uid('scr'), schoolId: school.id, examId: exam.id, studentId: s.id, pages: [], status: 'uploaded', responses: [], uploadedBy: actor.id, uploadedAt: this.now().toISOString() }; this.db.scripts.push(script); }
    Object.assign(script, { pages: input.pages, status: 'uploaded', responses: [], pageIssues: undefined, error: undefined, uploadedAt: this.now().toISOString(), uploadedBy: actor.id });
    this.changed();
    return script;
  }

  /** Grade every waiting script for a test (or the ones listed). Runs the grader one script at a time. */
  async gradeScripts(actor: User, examId: string, scriptIds?: string[], onProgress?: (done: number, total: number) => void) {
    this.role(actor, 'teacher', 'principal');
    const exam = this.examFor(actor, examId);
    const school = this.school(actor);
    this.module(school, 'aiGrading');
    const queue = this.db.scripts.filter((s) => s.examId === exam.id && (scriptIds ? scriptIds.includes(s.id) : s.status === 'uploaded' || s.status === 'failed'));
    let done = 0;
    for (const script of queue) {
      if (script.status === 'approved') continue;
      script.status = 'grading';
      try {
        const responses = await this.grader.grade({ exam, script, policy: school.settings.markingPolicy, threshold: school.settings.aiConfidenceThreshold });
        script.responses = [...responses];
        script.pageIssues = responses.pageIssues?.length ? responses.pageIssues : undefined;
        script.status = 'graded';
        script.grader = this.grader.name;
        script.gradedAt = this.now().toISOString();
        script.error = undefined;
      } catch (err) {
        script.status = 'failed';
        script.error = err instanceof Error ? err.message : 'Grading failed';
      }
      done++;
      onProgress?.(done, queue.length);
      this.changed();
    }
    this.audit(actor, school.id, 'ai.graded', `${exam.subject} ${exam.name}: ${done} scripts by ${this.grader.name} grader`);
    this.changed();
    return this.getExam(actor, examId);
  }

  /** Teacher review: optional overrides per question, then approve. Writes the marks. */
  reviewScript(actor: User, scriptId: string, input: { overrides?: Record<string, number | null>; approve?: boolean }) {
    this.role(actor, 'teacher');
    const script = this.db.scripts.find((s) => s.id === scriptId);
    if (!script) throw new PortalError(404, 'Script not found.');
    const exam = this.examFor(actor, script.examId);
    if (script.status !== 'graded' && script.status !== 'approved') throw new PortalError(409, 'Run AI correction on this script first.');
    for (const [no, v] of Object.entries(input.overrides ?? {})) {
      const r = script.responses.find((x) => x.no === no);
      if (!r) continue;
      if (v === null) { delete r.teacherMarks; continue; }
      if (v < 0 || v > r.maxMarks) throw new PortalError(400, `Q${no} must be between 0 and ${r.maxMarks}.`);
      r.teacherMarks = round1(v);
    }
    if (input.approve) {
      script.status = 'approved';
      script.approvedBy = actor.id;
      script.approvedAt = this.now().toISOString();
      const per = Object.fromEntries(script.responses.map((r) => [r.no, r.teacherMarks ?? r.aiMarks]));
      const st = this.db.students.find((x) => x.id === script.studentId)!;
      this.writeSheet(exam, st, per, 'ai_reviewed');
    }
    this.changed();
    return { script, total: scriptTotal(script.responses), max: examMax(exam) };
  }

  /** How closely the AI matched the teacher on approved scripts. */
  gradingAgreement(actor: User, examId: string) {
    const exam = this.examFor(actor, examId);
    const approved = this.db.scripts.filter((s) => s.examId === exam.id && s.status === 'approved');
    let answers = 0, exact = 0, within2 = 0;
    for (const s of approved) {
      for (const r of s.responses) { answers++; if (r.teacherMarks === undefined || Math.abs(r.teacherMarks - r.aiMarks) <= 0.5) exact++; }
      if (Math.abs(scriptTotal(s.responses) - s.responses.reduce((t, r) => t + r.aiMarks, 0)) <= 2) within2++;
    }
    return { scripts: approved.length, answers, answersWithinHalf: pct(exact, answers), scriptsWithin2: pct(within2, approved.length) };
  }

  // ---------------------------------------------------------------- people: add students and teachers

  /** The class advisor (or the principal) adds a student. Their parent can sign in with the phone number given. */
  addStudent(actor: User, input: { classId: string; name: string; gender: 'F' | 'M'; dob: string; guardianName: string; guardianRelation?: string; guardianPhone: string; lang?: 'en' | 'ta'; emis?: string; whatsappConsent?: boolean }) {
    this.role(actor, 'teacher');
    const c = this.classFor(actor, input.classId);
    if (actor.role === 'teacher' && c.classTeacherId !== actor.id) throw new PortalError(403, `Only the class advisor of ${classLabel(c)} can add students.`);
    const name = input.name?.trim().replace(/\s+/g, ' ');
    if (!name || name.length < 2) throw new PortalError(400, 'Enter the student’s name.');
    if (input.gender !== 'F' && input.gender !== 'M') throw new PortalError(400, 'Choose the gender.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dob ?? '') || input.dob > isoDate(this.now())) throw new PortalError(400, 'Enter a valid date of birth.');
    const phone = String(input.guardianPhone ?? '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) throw new PortalError(400, 'Enter the parent’s 10-digit mobile number.');
    if (!input.guardianName?.trim()) throw new PortalError(400, 'Enter the parent’s name.');
    const emis = String(input.emis ?? '').replace(/\D/g, '');
    if (emis && emis.length !== 13) throw new PortalError(400, 'EMIS number has 13 digits. Leave it empty if you don’t have it yet.');
    if (emis && this.db.students.some((x) => x.emis === emis)) throw new PortalError(409, 'A student with this EMIS number is already on record.');
    const same = this.db.students.find((x) => x.classId === c.id && x.name.toLowerCase() === name.toLowerCase() && x.dob === input.dob);
    if (same) throw new PortalError(409, `${name} with this date of birth is already in ${classLabel(c)}.`);
    const school = this.school(actor);
    const st: Student = {
      id: uid('stu'), schoolId: school.id, classId: c.id, rollNo: Math.max(0, ...this.db.students.filter((x) => x.classId === c.id).map((x) => x.rollNo)) + 1,
      name, gender: input.gender, dob: input.dob, emis,
      guardian: { name: input.guardianName.trim(), relation: input.guardianRelation?.trim() || 'Parent', phone, lang: input.lang === 'ta' ? 'ta' : 'en' },
      consent: { whatsapp: !!input.whatsappConsent, recordedAt: this.now().toISOString() },
      activities: [], interests: [], observations: [],
    };
    this.db.students.push(st);
    // The parent's account: reuse it for a sibling, otherwise create one so they can sign in with this number.
    const parent = this.userByPhone(phone);
    if (parent && parent.role === 'parent' && parent.schoolId === school.id) parent.studentIds = [...(parent.studentIds ?? []), st.id];
    else if (!parent) this.db.users.push({ id: uid('u'), schoolId: school.id, role: 'parent', name: st.guardian.name, phone, title: 'Parent', studentIds: [st.id], listed: false });
    this.audit(actor, school.id, 'student.added', `${name} added to ${classLabel(c)} as roll ${st.rollNo}`);
    this.changed();
    return { ...st, classLabel: classLabel(c) };
  }

  /** The principal adds a teacher: the subjects and classes they teach, and optionally a class they are class advisor of. */
  addTeacher(actor: User, input: { name: string; phone: string; subjects: string[]; classIds: string[]; classTeacherOf?: string }) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const name = input.name?.trim().replace(/\s+/g, ' ');
    if (!name || name.length < 3) throw new PortalError(400, 'Enter the teacher’s name.');
    const phone = String(input.phone ?? '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) throw new PortalError(400, 'Enter a 10-digit mobile number. The teacher signs in with it.');
    if (this.userByPhone(phone)) throw new PortalError(409, 'Someone already signs in with this number.');
    const classes = (input.classIds ?? []).map((id) => this.classFor(actor, id));
    if (!classes.length) throw new PortalError(400, 'Choose at least one class.');
    const subjects = [...new Set(input.subjects ?? [])];
    if (!subjects.length) throw new PortalError(400, 'Choose at least one subject.');
    const bad = subjects.find((sub) => !classes.some((c) => c.subjects.includes(sub)));
    if (bad) throw new PortalError(400, `${bad} is not taught in the classes chosen.`);
    if (input.classTeacherOf && !classes.some((c) => c.id === input.classTeacherOf)) throw new PortalError(400, 'The class advisor’s class must be one of the classes they teach.');
    const t: User = { id: uid('u'), schoolId: school.id, role: 'teacher', name, phone, title: `${subjects.join(' and ')} teacher`, classIds: classes.map((c) => c.id), subjects };
    this.db.users.push(t);
    const ct = input.classTeacherOf ? this.db.classes.find((c) => c.id === input.classTeacherOf)! : null;
    if (ct) { ct.classTeacherId = t.id; t.title += `, class advisor ${classLabel(ct)}`; }
    this.audit(actor, school.id, 'teacher.added', `${name}: ${subjects.join(', ')} for ${classes.map(classLabel).join(', ')}${ct ? `; class advisor of ${classLabel(ct)}` : ''}`);
    this.changed();
    return t;
  }

  /** Change a student's details. Moving them to another section is for the principal only. */
  updateStudent(actor: User, studentId: string, input: { classId?: string; name?: string; gender?: 'F' | 'M'; dob?: string; guardianName?: string; guardianRelation?: string; guardianPhone?: string; lang?: 'en' | 'ta'; emis?: string; whatsappConsent?: boolean }) {
    this.role(actor, 'teacher');
    const st = this.studentFor(actor, studentId);
    const from = this.db.classes.find((c) => c.id === st.classId)!;
    if (actor.role === 'teacher' && from.classTeacherId !== actor.id) throw new PortalError(403, `Only the class advisor of ${classLabel(from)} can change student details.`);
    const changes: string[] = [];
    if (input.name !== undefined) { const n = input.name.trim().replace(/\s+/g, ' '); if (n.length < 2) throw new PortalError(400, 'Enter the student’s name.'); if (n !== st.name) { changes.push(`name ${st.name} → ${n}`); st.name = n; } }
    if (input.gender !== undefined) { if (input.gender !== 'F' && input.gender !== 'M') throw new PortalError(400, 'Choose the gender.'); if (input.gender !== st.gender) { changes.push('gender'); st.gender = input.gender; } }
    if (input.dob !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dob) || input.dob > isoDate(this.now())) throw new PortalError(400, 'Enter a valid date of birth.'); if (input.dob !== st.dob) { changes.push('date of birth'); st.dob = input.dob; } }
    if (input.emis !== undefined) {
      const emis = input.emis.replace(/\D/g, '');
      if (emis && emis.length !== 13) throw new PortalError(400, 'EMIS number has 13 digits. Leave it empty if you don’t have it yet.');
      if (emis && this.db.students.some((x) => x.id !== st.id && x.emis === emis)) throw new PortalError(409, 'Another student has this EMIS number.');
      if (emis !== st.emis) { changes.push('EMIS number'); st.emis = emis; }
    }
    if (input.guardianName !== undefined) { if (!input.guardianName.trim()) throw new PortalError(400, 'Enter the parent’s name.'); if (input.guardianName.trim() !== st.guardian.name) { changes.push('parent’s name'); st.guardian.name = input.guardianName.trim(); } }
    if (input.guardianRelation !== undefined && input.guardianRelation.trim() && input.guardianRelation.trim() !== st.guardian.relation) { changes.push('relation'); st.guardian.relation = input.guardianRelation.trim(); }
    if (input.lang !== undefined && input.lang !== st.guardian.lang) { changes.push('message language'); st.guardian.lang = input.lang === 'ta' ? 'ta' : 'en'; }
    if (input.whatsappConsent !== undefined && input.whatsappConsent !== st.consent.whatsapp) { changes.push(input.whatsappConsent ? 'WhatsApp consent given' : 'WhatsApp consent withdrawn'); st.consent = { whatsapp: input.whatsappConsent, recordedAt: this.now().toISOString() }; }
    if (input.guardianPhone !== undefined) {
      const phone = input.guardianPhone.replace(/\D/g, '').slice(-10);
      if (phone.length !== 10) throw new PortalError(400, 'Enter the parent’s 10-digit mobile number.');
      if (phone !== st.guardian.phone) {
        const owner = this.userByPhone(phone);
        if (owner && owner.role !== 'parent') throw new PortalError(409, 'This number belongs to a staff member.');
        const old = this.db.users.find((u) => u.role === 'parent' && u.studentIds?.includes(st.id));
        if (old) old.studentIds = old.studentIds!.filter((x) => x !== st.id);
        if (owner) owner.studentIds = [...new Set([...(owner.studentIds ?? []), st.id])];
        else if (old && !old.studentIds!.length) { old.phone = phone; old.studentIds = [st.id]; old.name = st.guardian.name; }
        else this.db.users.push({ id: uid('u'), schoolId: st.schoolId, role: 'parent', name: st.guardian.name, phone, title: 'Parent', studentIds: [st.id], listed: false });
        if (old && !old.studentIds!.length && old.phone !== phone) this.db.users = this.db.users.filter((u) => u !== old);
        changes.push('parent’s mobile'); st.guardian.phone = phone;
      }
    }
    if (input.classId && input.classId !== st.classId) {
      const to = this.db.classes.find((c) => c.id === input.classId && c.schoolId === st.schoolId);
      if (!to) throw new PortalError(404, 'Class not found.');
      if (to.grade !== from.grade) throw new PortalError(400, `A student can move only to another section of standard ${from.grade}. Moving up a standard is done by promotion at the end of the year.`);
      st.classId = to.id;
      st.rollNo = Math.max(0, ...this.db.students.filter((x) => x.classId === to.id && x.id !== st.id).map((x) => x.rollNo)) + 1;
      changes.push(`moved ${classLabel(from)} → ${classLabel(to)}, roll ${st.rollNo}`);
    }
    if (!changes.length) throw new PortalError(400, 'Nothing was changed.');
    this.audit(actor, st.schoolId, 'student.updated', `${st.name}: ${changes.join('; ')}`);
    this.changed();
    return { ...st, classLabel: classLabel(this.db.classes.find((c) => c.id === st.classId)!), changes };
  }

  /** A student leaves (or was added by mistake). Their record is kept aside and can be restored. */
  removeStudent(actor: User, studentId: string, input: { reason: string; leftOn?: string }) {
    this.role(actor, 'teacher');
    const st = this.studentFor(actor, studentId);
    const c = this.db.classes.find((x) => x.id === st.classId)!;
    if (actor.role === 'teacher' && c.classTeacherId !== actor.id) throw new PortalError(403, `Only the class advisor of ${classLabel(c)} can remove a student.`);
    if (!input.reason?.trim()) throw new PortalError(400, 'Say why the student is leaving.');
    // Family sign-ins: a parent with other children keeps theirs; otherwise it closes until the student is restored.
    const accounts: User[] = [];
    const closed: string[] = [], kept: string[] = [];
    for (const u of this.db.users.filter((x) => x.studentIds?.includes(st.id))) {
      u.studentIds = u.studentIds!.filter((x) => x !== st.id);
      accounts.push({ ...u, studentIds: [st.id] });
      if (!u.studentIds.length) { this.db.users = this.db.users.filter((x) => x !== u); closed.push(`${u.name} (${u.role})`); } else kept.push(`${u.name} (${u.role}, has another child here)`);
    }
    this.db.students = this.db.students.filter((x) => x.id !== st.id);
    this.db.formerStudents.push({ student: st, leftOn: input.leftOn || isoDate(this.now()), reason: input.reason.trim(), by: actor.id, accounts });
    this.audit(actor, st.schoolId, 'student.removed', `${st.name} (${classLabel(c)}, roll ${st.rollNo}): ${input.reason.trim()}`);
    this.changed();
    return { removed: st.name, classLabel: classLabel(c), signInsClosed: closed, signInsKept: kept };
  }

  listFormerStudents(actor: User) {
    this.role(actor, 'principal', 'teacher');
    const school = this.school(actor);
    return this.db.formerStudents.filter((f) => f.student.schoolId === school.id && (actor.role === 'principal' || actor.classIds?.includes(f.student.classId)))
      .map((f) => ({ id: f.student.id, name: f.student.name, classLabel: classLabel(this.db.classes.find((c) => c.id === f.student.classId) ?? { grade: 0, section: '?' } as ClassRoom), rollNo: f.student.rollNo, leftOn: f.leftOn, reason: f.reason, by: this.userById(f.by)?.name ?? '', signInsClosed: f.accounts.filter((a) => !this.db.users.some((u) => u.id === a.id)).length }))
      .reverse();
  }

  /** Bring back a removed student, with their marks and attendance, and their family's sign-in. */
  restoreStudent(actor: User, studentId: string) {
    this.role(actor, 'teacher');
    const f = this.db.formerStudents.find((x) => x.student.id === studentId);
    if (!f) throw new PortalError(404, 'No removed student with this record.');
    const c = this.db.classes.find((x) => x.id === f.student.classId);
    if (!c) throw new PortalError(409, 'Their class no longer exists. Add the student again instead.');
    this.classFor(actor, c.id);
    if (actor.role === 'teacher' && c.classTeacherId !== actor.id) throw new PortalError(403, `Only the class advisor of ${classLabel(c)} can restore a student.`);
    const st = f.student;
    if (this.db.students.some((x) => x.classId === c.id && x.rollNo === st.rollNo)) st.rollNo = Math.max(0, ...this.db.students.filter((x) => x.classId === c.id).map((x) => x.rollNo)) + 1;
    this.db.students.push(st);
    for (const a of f.accounts) {
      const live = this.userByPhone(a.phone);
      if (live) { if (live.role === a.role) live.studentIds = [...new Set([...(live.studentIds ?? []), st.id])]; }
      else if (!this.userById(a.id)) this.db.users.push({ ...a, studentIds: [st.id] });
    }
    this.db.formerStudents = this.db.formerStudents.filter((x) => x !== f);
    this.audit(actor, st.schoolId, 'student.restored', `${st.name} back in ${classLabel(c)} as roll ${st.rollNo}`);
    this.changed();
    return { ...st, classLabel: classLabel(c) };
  }

  removeActivity(actor: User, studentId: string, activityId: string) {
    this.role(actor, 'principal', 'teacher');
    const s = this.studentFor(actor, studentId);
    if (!s.activities.some((a) => a.id === activityId)) throw new PortalError(404, 'Activity not found.');
    s.activities = s.activities.filter((a) => a.id !== activityId);
    this.changed();
    return { removed: true };
  }

  /** Remove an observation. Only the person who wrote it, or the principal. */
  removeObservation(actor: User, studentId: string, index: number) {
    this.role(actor, 'principal', 'teacher');
    const s = this.studentFor(actor, studentId);
    const o = s.observations[index];
    if (!o) throw new PortalError(404, 'Observation not found.');
    if (actor.role !== 'principal' && o.by !== actor.name) throw new PortalError(403, 'Only the teacher who wrote it, or the principal, can remove it.');
    s.observations.splice(index, 1);
    this.changed();
    return { removed: true };
  }

  /** Change what a teacher teaches. A class advisor can't drop their class until someone else takes it over. */
  updateTeacher(actor: User, teacherId: string, input: { name?: string; phone?: string; subjects?: string[]; classIds?: string[]; classTeacherOf?: string }) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const t = this.teachersOf(school.id).find((u) => u.id === teacherId);
    if (!t) throw new PortalError(404, 'Teacher not found.');
    const changes: string[] = [];
    if (input.name !== undefined) { const n = input.name.trim().replace(/\s+/g, ' '); if (n.length < 3) throw new PortalError(400, 'Enter the teacher’s name.'); if (n !== t.name) { changes.push(`name → ${n}`); t.name = n; } }
    if (input.phone !== undefined) {
      const phone = input.phone.replace(/\D/g, '').slice(-10);
      if (phone.length !== 10) throw new PortalError(400, 'Enter a 10-digit mobile number. The teacher signs in with it.');
      if (phone !== t.phone) { if (this.userByPhone(phone)) throw new PortalError(409, 'Someone already signs in with this number.'); changes.push('mobile'); t.phone = phone; }
    }
    const classIds = input.classIds ?? t.classIds ?? [];
    const classes = classIds.map((id) => this.classFor(actor, id));
    if (!classes.length) throw new PortalError(400, 'Choose at least one class.');
    const subjects = [...new Set(input.subjects ?? t.subjects ?? [])];
    if (!subjects.length) throw new PortalError(400, 'Choose at least one subject.');
    const bad = subjects.find((sub) => !classes.some((c) => c.subjects.includes(sub)));
    if (bad) throw new PortalError(400, `${bad} is not taught in the classes chosen.`);
    const owned = this.db.classes.filter((c) => c.classTeacherId === t.id);
    const keep = input.classTeacherOf === undefined ? owned.map((c) => c.id) : input.classTeacherOf ? [input.classTeacherOf] : [];
    const dropped = owned.find((c) => !keep.includes(c.id) || !classIds.includes(c.id));
    if (dropped) throw new PortalError(409, `${t.name} is class advisor of ${classLabel(dropped)}. Make someone else its class advisor first (Teachers and classes → By class → Edit).`);
    if (input.classTeacherOf && !classIds.includes(input.classTeacherOf)) throw new PortalError(400, 'The class advisor’s class must be one of the classes they teach.');
    if (JSON.stringify(classIds) !== JSON.stringify(t.classIds)) changes.push(`classes → ${classes.map(classLabel).join(', ')}`);
    if (JSON.stringify(subjects) !== JSON.stringify(t.subjects)) changes.push(`subjects → ${subjects.join(', ')}`);
    t.classIds = classIds; t.subjects = subjects;
    const ct = input.classTeacherOf ? this.db.classes.find((c) => c.id === input.classTeacherOf)! : null;
    if (ct && ct.classTeacherId !== t.id) { changes.push(`class advisor of ${classLabel(ct)}`); ct.classTeacherId = t.id; }
    const mine = this.db.classes.filter((c) => c.classTeacherId === t.id);
    t.title = `${subjects.join(' and ')} teacher${mine.length ? `, class advisor ${mine.map(classLabel).join(', ')}` : ''}`;
    if (!changes.length) throw new PortalError(400, 'Nothing was changed.');
    this.audit(actor, school.id, 'teacher.updated', `${t.name}: ${changes.join('; ')}`);
    this.changed();
    return t;
  }

  /** A teacher leaves. They can no longer sign in; their homework, tests and marks keep their name. */
  removeTeacher(actor: User, teacherId: string) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const t = this.teachersOf(school.id).find((u) => u.id === teacherId);
    if (!t) throw new PortalError(404, 'Teacher not found.');
    const owned = this.db.classes.filter((c) => c.classTeacherId === t.id);
    if (owned.length) throw new PortalError(409, `${t.name} is class advisor of ${owned.map(classLabel).join(', ')}. Make someone else the class advisor first.`);
    t.removedAt = this.now().toISOString();
    this.audit(actor, school.id, 'teacher.removed', t.name);
    this.changed();
    return { removed: t.name };
  }

  listFormerTeachers(actor: User) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    return this.db.users.filter((u) => u.schoolId === school.id && u.role === 'teacher' && u.removedAt).map((u) => ({ id: u.id, name: u.name, subjects: u.subjects ?? [], removedAt: u.removedAt! }));
  }

  restoreTeacher(actor: User, teacherId: string) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const t = this.db.users.find((u) => u.id === teacherId && u.schoolId === school.id && u.removedAt);
    if (!t) throw new PortalError(404, 'No removed teacher with this record.');
    if (this.userByPhone(t.phone)) throw new PortalError(409, 'Someone else now signs in with their number. Add them again with a new number.');
    delete t.removedAt;
    t.title = `${(t.subjects ?? []).join(' and ')} teacher`;
    this.audit(actor, school.id, 'teacher.restored', t.name);
    this.changed();
    return t;
  }

  // ---------------------------------------------------------------- classes

  /** The principal opens a new section. */
  addClass(actor: User, input: { grade: number; section: string; classTeacherId: string; subjects: string[] }) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const grade = Math.round(Number(input.grade));
    if (!(grade >= 1 && grade <= 12)) throw new PortalError(400, 'Choose a standard from 1 to 12.');
    const section = String(input.section ?? '').trim().toUpperCase();
    if (!/^[A-Z]{1,2}$/.test(section)) throw new PortalError(400, 'Section is a letter, like A or B.');
    if (this.db.classes.some((c) => c.schoolId === school.id && c.grade === grade && c.section === section)) throw new PortalError(409, `${grade}-${section} already exists.`);
    const subjects = [...new Set((input.subjects ?? []).map((x) => x.trim()).filter(Boolean))];
    if (!subjects.length) throw new PortalError(400, 'Choose the subjects taught in this class.');
    const t = this.teachersOf(school.id).find((u) => u.id === input.classTeacherId);
    if (!t) throw new PortalError(400, 'Choose a class advisor.');
    const c: ClassRoom = { id: uid('cls'), schoolId: school.id, grade, section, classTeacherId: t.id, subjects };
    this.db.classes.push(c);
    t.classIds = [...(t.classIds ?? []), c.id];
    this.audit(actor, school.id, 'class.added', `${classLabel(c)}, class advisor ${t.name}`);
    this.changed();
    return { ...c, label: classLabel(c) };
  }

  /** Change a class's teacher or subjects. */
  updateClass(actor: User, classId: string, input: { classTeacherId?: string; subjects?: string[] }) {
    this.role(actor, 'principal');
    const c = this.classFor(actor, classId);
    const changes: string[] = [];
    if (input.subjects) {
      const subjects = [...new Set(input.subjects.map((x) => x.trim()).filter(Boolean))];
      if (!subjects.length) throw new PortalError(400, 'A class needs at least one subject.');
      if (JSON.stringify(subjects) !== JSON.stringify(c.subjects)) { changes.push(`subjects → ${subjects.join(', ')}`); c.subjects = subjects; }
    }
    if (input.classTeacherId && input.classTeacherId !== c.classTeacherId) {
      const t = this.teachersOf(c.schoolId).find((u) => u.id === input.classTeacherId);
      if (!t) throw new PortalError(400, 'Choose a teacher from this school.');
      if (!t.classIds?.includes(c.id)) t.classIds = [...(t.classIds ?? []), c.id];
      const was = this.userById(c.classTeacherId);
      c.classTeacherId = t.id;
      for (const u of [t, was]) if (u && u.role === 'teacher') { const mine = this.db.classes.filter((x) => x.classTeacherId === u.id); u.title = `${(u.subjects ?? []).join(' and ')} teacher${mine.length ? `, class advisor ${mine.map(classLabel).join(', ')}` : ''}`; }
      changes.push(`class advisor ${was?.name ?? '–'} → ${t.name}`);
    }
    if (!changes.length) throw new PortalError(400, 'Nothing was changed.');
    this.audit(actor, c.schoolId, 'class.updated', `${classLabel(c)}: ${changes.join('; ')}`);
    this.changed();
    return { ...c, label: classLabel(c) };
  }

  /** Remove a section that was opened by mistake. Only possible while it has no students, tests or homework. */
  removeClass(actor: User, classId: string) {
    this.role(actor, 'principal');
    const c = this.classFor(actor, classId);
    const n = this.db.students.filter((s) => s.classId === c.id).length;
    if (n) throw new PortalError(409, `${classLabel(c)} has ${n} students. Move them to another class first.`);
    if (this.db.exams.some((e) => e.classId === c.id) || this.db.homework.some((h) => h.classId === c.id)) throw new PortalError(409, `${classLabel(c)} has tests or homework on record, so it can’t be removed.`);
    this.db.classes = this.db.classes.filter((x) => x.id !== c.id);
    for (const u of this.db.users) if (u.classIds?.includes(c.id)) u.classIds = u.classIds.filter((x) => x !== c.id);
    this.audit(actor, c.schoolId, 'class.removed', classLabel(c));
    this.changed();
    return { removed: classLabel(c) };
  }

  /** Choose who teaches a subject in a class, or leave it without a teacher (null). Their timetable follows. */
  setSubjectTeacher(actor: User, classId: string, subject: string, teacherId: string | null) {
    this.role(actor, 'principal');
    const c = this.classFor(actor, classId);
    if (!c.subjects.includes(subject)) throw new PortalError(400, `${subject} is not taught in ${classLabel(c)}.`);
    const was = this.subjectTeacher(c.id, subject);
    let t: User | null = null;
    if (teacherId) {
      t = this.teachersOf(c.schoolId).find((u) => u.id === teacherId) ?? null;
      if (!t) throw new PortalError(400, 'Choose a teacher from this school.');
    }
    if ((was?.id ?? null) === (t?.id ?? null)) throw new PortalError(400, 'Nothing was changed.');
    c.subjectTeachers = { ...(c.subjectTeachers ?? {}), [subject]: t?.id ?? null };
    if (t) {
      if (!t.classIds?.includes(c.id)) t.classIds = [...(t.classIds ?? []), c.id];
      if (!t.subjects?.includes(subject)) t.subjects = [...(t.subjects ?? []), subject];
    }
    // A teacher who no longer teaches anything in the class (and is not its advisor) stops seeing it.
    if (was && was.id !== t?.id && was.id !== c.classTeacherId && !c.subjects.some((s) => this.subjectTeacher(c.id, s)?.id === was.id)) was.classIds = (was.classIds ?? []).filter((x) => x !== c.id);
    this.audit(actor, c.schoolId, 'class.subject_teacher', `${classLabel(c)} ${subject}: ${was?.name ?? 'none'} → ${t?.name ?? 'none'}`);
    this.changed();
    return { classLabel: classLabel(c), subject, teacher: t?.name ?? null };
  }

  private subjectTeacher(classId: string, subject: string) {
    const c = this.db.classes.find((x) => x.id === classId);
    if (c?.subjectTeachers && subject in c.subjectTeachers) {
      const id = c.subjectTeachers[subject];
      return id ? this.db.users.find((u) => u.id === id && u.role === 'teacher' && !u.removedAt) ?? null : null;
    }
    return this.db.users.find((u) => u.role === 'teacher' && !u.removedAt && u.classIds?.includes(classId) && u.subjects?.includes(subject)) ?? null;
  }

  // ---------------------------------------------------------------- results by teacher and by class

  /** A teacher's own analytics: only the classes and subjects they teach, and only those students. */
  teacherInsights(actor: User, opts: { scope?: 'all' | 'last3' | 'last' } = {}) {
    this.role(actor, 'teacher');
    const keep = opts.scope === 'last' ? 1 : opts.scope === 'last3' ? 3 : Infinity;
    const school = this.school(actor);
    const pm = school.settings.passMark;
    const pairs = this.listClasses(actor).flatMap((c) => c.subjects.filter((sub) => this.subjectTeacher(c.id, sub)?.id === actor.id).map((subject) => ({ c, subject })));
    return pairs.map(({ c, subject }) => {
      const all = this.db.exams.filter((e) => e.classId === c.id && e.subject === subject && this.db.marks.some((m) => m.examId === e.id)).sort((a, b) => a.date.localeCompare(b.date));
      const exams = all.slice(-keep);
      const roster = this.db.students.filter((x) => x.classId === c.id).sort((a, b) => a.rollNo - b.rollNo);
      const chapters: Record<string, { got: number; max: number }> = {};
      const tests = exams.map((e) => {
        const sheets = this.db.marks.filter((m) => m.examId === e.id);
        for (const m of sheets) for (const q of e.questions) { chapters[q.chapter] ??= { got: 0, max: 0 }; chapters[q.chapter].got += m.perQuestion[q.no] ?? 0; chapters[q.chapter].max += q.maxMarks; }
        const max = examMax(e);
        return { id: e.id, name: e.name, date: e.date, published: e.status === 'published', avg: pct(sheets.reduce((t, m) => t + m.total, 0), sheets.length * max), max };
      });
      const students = roster.map((st) => {
        const scores = exams.map((e) => { const m = this.db.marks.find((x) => x.examId === e.id && x.studentId === st.id); return m ? pct(m.total, examMax(e)) : null; }).filter((x): x is number => x !== null);
        const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        // The change always compares the last test with the one before it, whichever tests the averages use.
        const every = all.map((e) => { const m = this.db.marks.find((x) => x.examId === e.id && x.studentId === st.id); return m ? pct(m.total, examMax(e)) : null; }).filter((x): x is number => x !== null);
        const change = every.length >= 2 ? every.at(-1)! - every.at(-2)! : null;
        const attendance = this.attendancePct(st.id);
        const flags = [avg !== null && avg < pm ? `Below pass mark (${pm}%)` : '', change !== null && change <= -10 ? `Dropped ${-change} points in the last test` : '', attendance < 75 ? `Attendance ${attendance}%` : ''].filter(Boolean);
        return { id: st.id, name: st.name, rollNo: st.rollNo, avg, last: scores.at(-1) ?? null, change, attendance, flags };
      });
      const withAvg = students.filter((x) => x.avg !== null);
      return {
        classId: c.id, classLabel: classLabel(c), grade: c.grade, subject, isAdvisor: c.classTeacherId === actor.id,
        students, tests, passMark: pm, testsInAll: all.length,
        average: withAvg.length ? Math.round(withAvg.reduce((t, x) => t + x.avg!, 0) / withAvg.length) : null,
        chapters: Object.entries(chapters).map(([chapter, v]) => ({ chapter, pct: pct(v.got, v.max) })).sort((a, b) => a.pct - b.pct),
      };
    });
  }

  private examStats(exams: Exam[], passMark: number) {
    let got = 0, max = 0, pass = 0, sheets = 0;
    for (const e of exams) {
      const m = examMax(e);
      for (const sh of this.db.marks.filter((x) => x.examId === e.id)) { got += sh.total; max += m; sheets++; if (pct(sh.total, m) >= passMark) pass++; }
    }
    return { avgPct: max ? pct(got, max) : null, passPct: sheets ? pct(pass, sheets) : null };
  }

  /** For the principal: every teacher, the classes and subjects they teach, and how those classes are doing. */
  teacherOverview(actor: User) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const since = isoDate(addDays(this.now(), -30));
    const today = isoDate(this.now());
    return this.teachersOf(school.id).map((t) => {
      const pairs = (t.classIds ?? []).flatMap((cid) => {
        const c = this.db.classes.find((x) => x.id === cid);
        if (!c) return [];
        return (t.subjects ?? []).filter((sub) => c.subjects.includes(sub)).map((subject) => {
          const exams = this.db.exams.filter((e) => e.classId === cid && e.subject === subject && e.status === 'published');
          const hw = this.db.homework.filter((h) => h.classId === cid && h.subject === subject && h.createdAt.slice(0, 10) >= since);
          return { classId: cid, classLabel: classLabel(c), subject, students: this.db.students.filter((x) => x.classId === cid).length, tests: exams.length, ...this.examStats(exams, school.settings.passMark), homework: hw.length };
        });
      });
      const ct = this.db.classes.filter((c) => c.classTeacherId === t.id);
      return {
        id: t.id, name: t.name, phone: t.phone, title: t.title ?? '', subjects: t.subjects ?? [], classIds: t.classIds ?? [], examCoordinator: !!t.examCoordinator,
        classTeacherOf: ct.map((c) => ({ classId: c.id, classLabel: classLabel(c), attendanceMarkedToday: this.db.attendance.some((r) => r.classId === c.id && r.date === today) })),
        pairs,
        ...this.examStats(this.db.exams.filter((e) => e.status === 'published' && pairs.some((p) => p.classId === e.classId && p.subject === e.subject)), school.settings.passMark),
      };
    });
  }

  /** Marks by class: average, pass rate and each subject, from all published tests. */
  classResults(actor: User) {
    this.role(actor, 'principal', 'teacher');
    const school = this.school(actor);
    const pm = school.settings.passMark;
    return this.listClasses(actor).map((c) => {
      const exams = this.db.exams.filter((e) => e.classId === c.id && e.status === 'published');
      const students = this.db.students.filter((x) => x.classId === c.id).map((st) => ({ id: st.id, name: st.name, avg: this.averagePct(st.id) }));
      const ranked = students.filter((x) => x.avg !== null).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
      return {
        classId: c.id, classLabel: c.label, classTeacher: c.teacher, students: c.students, tests: exams.length,
        ...this.examStats(exams, pm),
        belowPass: ranked.filter((x) => (x.avg ?? 0) < pm).length,
        top: ranked[0] ? { name: ranked[0].name, avg: ranked[0].avg } : null,
        subjects: c.subjects.map((subject) => ({ subject, teacher: this.subjectTeacher(c.id, subject)?.name ?? 'Not assigned', ...this.examStats(exams.filter((e) => e.subject === subject), pm) })),
      };
    });
  }

  // ---------------------------------------------------------------- staff attendance and leave

  /** Make a teacher exam coordinator (or stop). Coordinators plan exams, halls, seating and hall tickets. */
  setExamCoordinator(actor: User, teacherId: string, on: boolean) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const t = this.teachersOf(school.id).find((u) => u.id === teacherId);
    if (!t) throw new PortalError(404, 'Teacher not found.');
    if (!!t.examCoordinator === on) throw new PortalError(400, 'Nothing was changed.');
    t.examCoordinator = on;
    this.audit(actor, school.id, 'teacher.exam_coordinator', `${t.name}: ${on ? 'made' : 'no longer'} exam coordinator`);
    this.changed();
    return { name: t.name, examCoordinator: on };
  }

  private leaveDates(l: StaffLeave) {
    const out: string[] = [];
    const d = new Date(`${l.from}T12:00:00`);
    while (out.length < l.days) { if (d.getDay() !== 0) out.push(isoDate(d)); d.setDate(d.getDate() + 1); }
    return out;
  }

  /** The staff register for a day: every teacher, their mark, and approved leave filled in. */
  getStaffAttendance(actor: User, date: string) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new PortalError(400, 'Choose a date.');
    const record = this.db.staffAttendance.find((r) => r.schoolId === school.id && r.date === date) ?? null;
    const approved = this.db.staffLeave.filter((l) => l.schoolId === school.id && l.status === 'Approved');
    const staff = this.teachersOf(school.id).map((t) => {
      const leave = approved.find((l) => l.userId === t.id && this.leaveDates(l).includes(date)) ?? null;
      return { id: t.id, name: t.name, title: t.title ?? '', mark: record?.marks[t.id] ?? (leave ? (leave.kind === 'On duty' ? 'OD' : 'L') as StaffMark : null), leave: leave ? `${leave.kind} leave: ${leave.reason}` : null };
    });
    return { date, record: record ? { markedBy: this.userById(record.markedBy)?.name ?? '', at: record.at } : null, staff };
  }

  markStaffAttendance(actor: User, date: string, marks: Record<string, StaffMark>) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > isoDate(this.now())) throw new PortalError(400, 'Staff attendance can be marked for today or an earlier day.');
    const ids = new Set(this.teachersOf(school.id).map((t) => t.id));
    const clean: Record<string, StaffMark> = {};
    for (const [id, m] of Object.entries(marks ?? {})) { if (ids.has(id) && ['P', 'A', 'L', 'OD'].includes(m)) clean[id] = m; }
    if (Object.keys(clean).length !== ids.size) throw new PortalError(400, 'Mark every teacher before saving.');
    const at = this.now().toISOString();
    const prev = this.db.staffAttendance.find((r) => r.schoolId === school.id && r.date === date);
    if (prev) Object.assign(prev, { marks: clean, markedBy: actor.id, at });
    else this.db.staffAttendance.push({ id: uid('sat'), schoolId: school.id, date, marks: clean, markedBy: actor.id, at });
    const absent = Object.values(clean).filter((m) => m === 'A').length;
    this.audit(actor, school.id, 'staff_attendance.marked', `${date}: ${ids.size - absent} of ${ids.size} in school`);
    this.changed();
    return { date, present: Object.values(clean).filter((m) => m === 'P').length, absent, leave: Object.values(clean).filter((m) => m === 'L' || m === 'OD').length };
  }

  /** A month of staff attendance, teacher by teacher. */
  staffAttendanceMonth(actor: User, month: string) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new PortalError(400, 'Choose a month.');
    const days = this.db.staffAttendance.filter((r) => r.schoolId === school.id && r.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
    const rows = this.teachersOf(school.id).map((t) => {
      const c = { P: 0, A: 0, L: 0, OD: 0 } as Record<StaffMark, number>;
      for (const d of days) { const m = d.marks[t.id]; if (m) c[m]++; }
      return { id: t.id, name: t.name, ...c, pct: days.length ? Math.round(((c.P + c.OD) / days.length) * 100) : null };
    });
    return { month, days: days.length, rows };
  }

  /** A teacher applies for leave. It goes to the principal. */
  applyLeave(actor: User, input: { kind: LeaveKind; from: string; days: number; reason: string }) {
    this.role(actor, 'teacher');
    const school = this.school(actor);
    if (!['Casual', 'Sick', 'Earned', 'On duty'].includes(input.kind)) throw new PortalError(400, 'Choose the kind of leave.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from ?? '')) throw new PortalError(400, 'Choose the first day of leave.');
    const days = Math.round(Number(input.days));
    if (!(days >= 1 && days <= 30)) throw new PortalError(400, 'Leave is 1 to 30 days.');
    const reason = String(input.reason ?? '').trim();
    if (reason.length < 3) throw new PortalError(400, 'Give a short reason.');
    const l: StaffLeave = { id: uid('lv'), schoolId: school.id, userId: actor.id, kind: input.kind, from: input.from, days, reason, status: 'Pending', createdAt: this.now().toISOString() };
    const mine = new Set(this.leaveDates(l));
    if (this.db.staffLeave.some((x) => x.userId === actor.id && (x.status === 'Pending' || x.status === 'Approved') && this.leaveDates(x).some((d) => mine.has(d)))) throw new PortalError(409, 'You already have leave asked for or approved on one of these days.');
    this.db.staffLeave.push(l);
    this.audit(actor, school.id, 'leave.applied', `${actor.name}: ${l.kind}, ${days} day${days > 1 ? 's' : ''} from ${l.from}`);
    this.changed();
    return l;
  }

  withdrawLeave(actor: User, leaveId: string) {
    this.role(actor, 'teacher');
    const l = this.db.staffLeave.find((x) => x.id === leaveId && x.userId === actor.id);
    if (!l) throw new PortalError(404, 'Leave request not found.');
    if (l.status !== 'Pending') throw new PortalError(409, 'Only a request that is still waiting can be withdrawn. Ask the principal to change a decided one.');
    l.status = 'Withdrawn';
    this.changed();
    return l;
  }

  /** Principal: every staff leave request. Teacher: their own, with how much leave they have used this year. */
  listLeave(actor: User) {
    this.role(actor, 'principal', 'teacher');
    const school = this.school(actor);
    const year = String(this.now().getFullYear());
    const all = this.db.staffLeave.filter((l) => l.schoolId === school.id && (actor.role === 'principal' || l.userId === actor.id));
    const used = (uid2: string, kind: LeaveKind) => this.db.staffLeave.filter((l) => l.userId === uid2 && l.kind === kind && l.status === 'Approved' && l.from.startsWith(year)).reduce((n, l) => n + l.days, 0);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((l) => ({ ...l, name: this.userById(l.userId)?.name ?? '', dates: this.leaveDates(l), usedThisYear: used(l.userId, l.kind), decidedByName: l.decidedBy ? this.userById(l.decidedBy)?.name ?? '' : '' }));
  }

  decideLeave(actor: User, leaveId: string, approve: boolean, reply?: string) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const l = this.db.staffLeave.find((x) => x.id === leaveId && x.schoolId === school.id);
    if (!l) throw new PortalError(404, 'Leave request not found.');
    if (l.status === 'Withdrawn') throw new PortalError(409, 'The teacher withdrew this request.');
    if (!approve && !String(reply ?? '').trim()) throw new PortalError(400, 'Give the teacher a reason when you decline.');
    l.status = approve ? 'Approved' : 'Declined';
    l.reply = String(reply ?? '').trim() || undefined;
    l.decidedBy = actor.id;
    const t = this.userById(l.userId);
    this.audit(actor, school.id, 'leave.decided', `${t?.name}: ${l.kind} from ${l.from} ${l.status.toLowerCase()}`);
    this.changed();
    return { ...l, name: t?.name ?? '' };
  }

  // ---------------------------------------------------------------- timetable

  /**
   * Timetables made from who teaches what. The principal sees every class and teacher, a teacher sees their own
   * and their class advisor class, a student or parent sees their class.
   */
  timetable(actor: User, view: { classId?: string; teacherId?: string } = {}) {
    const school = this.school(actor);
    const all = this.db.classes.filter((c) => c.schoolId === school.id).sort((a, b) => b.grade - a.grade || a.section.localeCompare(b.section));
    const teachers = this.teachersOf(school.id);
    let classes: ClassRoom[] = [], people: User[] = [];
    if (actor.role === 'principal') { classes = all; people = teachers; }
    else if (actor.role === 'teacher') { classes = all.filter((c) => c.classTeacherId === actor.id); people = [actor]; }
    else if (actor.role === 'student' || actor.role === 'parent') { const ids = new Set(this.db.students.filter((s) => actor.studentIds?.includes(s.id)).map((s) => s.classId)); classes = all.filter((c) => ids.has(c.id)); }
    else throw new PortalError(403, 'Your role cannot do this.');
    const grid = this.grid(school.id);
    const options = { classes: classes.map((c) => ({ id: c.id, label: classLabel(c) })), teachers: people.map((t) => ({ id: t.id, name: t.name })) };
    let pick: { kind: 'class' | 'teacher'; id: string } | null = null;
    if (view.teacherId) { if (!people.some((t) => t.id === view.teacherId)) throw new PortalError(403, 'You can’t see this teacher’s timetable.'); pick = { kind: 'teacher', id: view.teacherId }; }
    else if (view.classId) { if (!classes.some((c) => c.id === view.classId)) throw new PortalError(403, 'You can’t see this class’s timetable.'); pick = { kind: 'class', id: view.classId }; }
    else if (actor.role === 'teacher') pick = { kind: 'teacher', id: actor.id };
    else if (classes[0]) pick = { kind: 'class', id: classes[0].id };
    if (!pick) return { options, view: null };
    const cells = TT_DAYS.map((_, d) => TT_PERIODS.map((_, p) => {
      if (pick!.kind === 'class') { const x = grid[pick!.id]?.[d][p]; const edited = this.db.timetableEdits.some((e) => e.classId === pick!.id && e.day === d && e.period === p); return x ? { subject: x.subject, with: x.teacherId ? this.userById(x.teacherId)?.name ?? '' : '', edited } : edited ? { subject: '', with: '', edited } : null; }
      const cid = Object.keys(grid).find((k) => grid[k][d][p]?.teacherId === pick!.id);
      const c = cid && all.find((x) => x.id === cid);
      return c ? { subject: grid[cid][d][p]!.subject, with: classLabel(c) } : null;
    }));
    const label = pick.kind === 'class' ? classLabel(all.find((c) => c.id === pick!.id)!) : this.userById(pick.id)!.name;
    const periods = cells.flat().filter((x) => x && (pick!.kind === 'teacher' || x.with)).length;
    const cls = pick.kind === 'class' ? all.find((c) => c.id === pick!.id)! : null;
    const editable = !!cls && (actor.role === 'principal' || (actor.role === 'teacher' && cls.classTeacherId === actor.id));
    const subjects = cls ? [...cls.subjects, ...TT_EXTRAS] : [];
    const changes = cls ? this.db.timetableEdits.filter((e) => e.classId === cls.id).length : 0;
    return { options, view: { ...pick, label, days: TT_DAYS, periods: TT_PERIODS, cells, teachingPeriods: periods, editable, subjects, changes } };
  }

  /** The class advisor or the principal changes one period of a class timetable. Refused if the subject teacher is already in another class then. */
  setPeriod(actor: User, classId: string, day: number, period: number, subject: string | null) {
    this.role(actor, 'principal', 'teacher');
    const c = this.classFor(actor, classId);
    if (actor.role === 'teacher' && c.classTeacherId !== actor.id) throw new PortalError(403, `Only the class advisor of ${classLabel(c)} or the principal can change its timetable.`);
    if (!(day >= 0 && day < TT_DAYS.length && period >= 0 && period < TT_PERIODS.length)) throw new PortalError(400, 'Choose a day and period from the timetable.');
    if (subject !== null && ![...c.subjects, ...TT_EXTRAS].includes(subject)) throw new PortalError(400, `${subject} is not taught in ${classLabel(c)}.`);
    const grid = this.grid(c.schoolId);
    const now = grid[c.id]?.[day][period] ?? null;
    if ((now?.subject ?? null) === subject) throw new PortalError(400, 'That period already has this subject.');
    const t = subject ? this.subjectTeacher(c.id, subject) : null;
    if (t) {
      const other = Object.keys(grid).find((k) => k !== c.id && grid[k][day][period]?.teacherId === t.id);
      const oc = other && this.db.classes.find((x) => x.id === other);
      if (oc) throw new PortalError(409, `${t.name} teaches ${classLabel(oc)} in that period (${TT_DAYS[day]}, ${TT_PERIODS[period]}). Pick another period, or change ${classLabel(oc)} first.`);
    }
    this.db.timetableEdits = this.db.timetableEdits.filter((e) => !(e.classId === c.id && e.day === day && e.period === period));
    this.db.timetableEdits.push({ classId: c.id, day, period, subject, by: actor.id, at: this.now().toISOString() });
    const what = `${classLabel(c)} ${TT_DAYS[day]} period ${period + 1}: ${now?.subject ?? 'free'} → ${subject ?? 'free'}`;
    this.audit(actor, c.schoolId, 'timetable.changed', what);
    this.changed();
    return { changed: what, teacher: t?.name ?? null };
  }

  /** Undo every hand-made change to a class timetable. */
  resetTimetable(actor: User, classId: string) {
    this.role(actor, 'principal', 'teacher');
    const c = this.classFor(actor, classId);
    if (actor.role === 'teacher' && c.classTeacherId !== actor.id) throw new PortalError(403, `Only the class advisor of ${classLabel(c)} or the principal can change its timetable.`);
    const n = this.db.timetableEdits.filter((e) => e.classId === c.id).length;
    if (!n) throw new PortalError(400, 'This timetable has no changes to undo.');
    this.db.timetableEdits = this.db.timetableEdits.filter((e) => e.classId !== c.id);
    this.audit(actor, c.schoolId, 'timetable.reset', `${classLabel(c)}: ${n} changes undone`);
    this.changed();
    return { classLabel: classLabel(c), undone: n };
  }

  /** The timetable as the school runs it: the generated one with the hand-made changes on top. */
  private grid(schoolId: string) {
    const out = this.buildTimetable(schoolId);
    for (const e of this.db.timetableEdits) {
      if (!out[e.classId]) continue;
      out[e.classId][e.day][e.period] = e.subject ? { subject: e.subject, teacherId: this.subjectTeacher(e.classId, e.subject)?.id ?? null } : null;
    }
    return out;
  }

  /** When a teacher is away on a day: their periods, and which teachers are free in each one (those who already teach the class first). */
  substitutions(actor: User, teacherId: string, date: string) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    const t = this.teachersOf(school.id).find((u) => u.id === teacherId);
    if (!t) throw new PortalError(404, 'Teacher not found.');
    const d = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
    if (!(d < TT_DAYS.length)) return { teacher: t.name, day: null, periods: [] };
    const grid = this.grid(school.id);
    const teachers = this.teachersOf(school.id).filter((u) => u.id !== t.id);
    const periods = TT_PERIODS.flatMap((time, p) => {
      const cid = Object.keys(grid).find((k) => grid[k][d][p]?.teacherId === t.id);
      if (!cid) return [];
      const c = this.db.classes.find((x) => x.id === cid)!;
      const busy = new Set(Object.values(grid).map((g) => g[d][p]?.teacherId).filter(Boolean));
      const free = teachers.filter((u) => !busy.has(u.id)).map((u) => ({ id: u.id, name: u.name, subjects: u.subjects ?? [], knowsClass: !!u.classIds?.includes(cid) }))
        .sort((a, b) => Number(b.knowsClass) - Number(a.knowsClass) || a.name.localeCompare(b.name));
      return [{ period: p + 1, time, classId: cid, classLabel: classLabel(c), subject: grid[cid][d][p]!.subject, free }];
    });
    return { teacher: t.name, day: TT_DAYS[d], periods };
  }

  private buildTimetable(schoolId: string) {
    const classes = this.db.classes.filter((c) => c.schoolId === schoolId).sort((a, b) => b.grade - a.grade || a.section.localeCompare(b.section));
    type Slot = { subject: string; teacherId: string | null } | null;
    const out: Record<string, Slot[][]> = {};
    const left: Record<string, Record<string, number>> = {};
    const teacherOf: Record<string, Record<string, string | null>> = {};
    for (const c of classes) {
      out[c.id] = TT_DAYS.map(() => TT_PERIODS.map(() => null));
      const core = [...c.subjects].sort((a, b) => Number(/Maths|Science/.test(b)) - Number(/Maths|Science/.test(a)));
      const total = TT_DAYS.length * TT_PERIODS.length - TT_EXTRAS.length * 3;
      left[c.id] = Object.fromEntries(core.map((sub, i) => [sub, Math.floor(total / core.length) + (i < total % core.length ? 1 : 0)]));
      for (const x of TT_EXTRAS) left[c.id][x] = 3;
      teacherOf[c.id] = Object.fromEntries(core.map((sub) => [sub, this.subjectTeacher(c.id, sub)?.id ?? null]));
    }
    for (let d = 0; d < TT_DAYS.length; d++) for (let p = 0; p < TT_PERIODS.length; p++) {
      const busy = new Set<string>();
      for (let k = 0; k < classes.length; k++) {
        const c = classes[(k + d + p) % classes.length];
        const todays = out[c.id][d];
        const ok = (sub: string, cap: boolean) => {
          if (left[c.id][sub] <= 0) return false;
          const t = teacherOf[c.id][sub];
          if (t && busy.has(t)) return false;
          if (cap && todays.filter((x) => x?.subject === sub).length >= (TT_EXTRAS.includes(sub) ? 1 : 2)) return false;
          return !(p > 0 && todays[p - 1]?.subject === sub && cap);
        };
        const subs = Object.keys(left[c.id]).sort((a, b) => left[c.id][b] - left[c.id][a] || ((a.length + d) % 3) - ((b.length + d) % 3));
        const sub = subs.find((x) => ok(x, true)) ?? subs.find((x) => ok(x, false));
        if (!sub) continue;
        left[c.id][sub]--;
        const t = teacherOf[c.id][sub] ?? null;
        if (t) busy.add(t);
        out[c.id][d][p] = { subject: sub, teacherId: t };
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- school exams: timetable, halls, seating, hall tickets

  private planFor(actor: User, planId: string): ExamPlan {
    const p = this.db.examPlans.find((x) => x.id === planId);
    if (!p) throw new PortalError(404, 'Exam not found.');
    this.school(actor, p.schoolId);
    return p;
  }

  private planStudents(p: ExamPlan) {
    const classes = this.db.classes.filter((c) => c.schoolId === p.schoolId && p.grades.includes(c.grade));
    return this.db.students.filter((s) => classes.some((c) => c.id === s.classId)).map((s) => {
      const c = classes.find((x) => x.id === s.classId)!;
      return { id: s.id, name: s.name, classId: c.id, classLabel: classLabel(c), grade: c.grade, section: c.section, rollNo: s.rollNo };
    }).sort((a, b) => b.grade - a.grade || a.section.localeCompare(b.section) || a.rollNo - b.rollNo);
  }

  private ticketNo(p: ExamPlan, st: { grade: number; section: string; rollNo: number }) {
    return `${p.createdAt.slice(0, 4)}${String(st.grade).padStart(2, '0')}${st.section}${String(st.rollNo).padStart(2, '0')}`;
  }

  /** Clashes and gaps that would confuse students: two papers at once for one standard, a standard with no papers. */
  private planProblems(p: ExamPlan) {
    const out: string[] = [];
    for (const g of p.grades) {
      const ps = p.papers.filter((x) => x.grade === g);
      if (!ps.length) out.push(`Standard ${g} has no papers yet.`);
      for (const a of ps) for (const b of ps) if (a.id < b.id && a.date === b.date && a.start < b.end && b.start < a.end) out.push(`Standard ${g}: ${a.subject} and ${b.subject} overlap on ${a.date}.`);
    }
    const n = this.planStudents(p).length;
    if (!p.seats.length) out.push('Seats are not allotted yet.');
    else if (p.seats.length < n) out.push(`${n - p.seats.length} students have no seat. Allot seats again.`);
    else {
      const sits = this.sittingsOf(p);
      const gradeOf = new Map(this.planStudents(p).map((x) => [x.id, x.grade]));
      if (p.seats.some((x) => sits.find((y) => y.grades.includes(gradeOf.get(x.studentId) ?? -1))?.key !== x.sitting)) out.push('Exam timings changed after seats were allotted, so some standards now write at a different time. Allot seats again.');
    }
    return out;
  }

  listHalls(actor: User) {
    this.role(actor, 'principal', 'teacher');
    const school = this.school(actor);
    return this.db.halls.filter((h) => h.schoolId === school.id).map((h) => ({ ...h, capacity: h.rows * h.cols, usedBy: this.db.examPlans.filter((p) => p.seats.some((s) => s.hallId === h.id)).map((p) => p.name) }));
  }

  private hallInput(input: { name?: string; where?: string; rows?: number; cols?: number }) {
    const name = input.name?.trim(), where = input.where?.trim() ?? '';
    const rows = Math.round(Number(input.rows)), cols = Math.round(Number(input.cols));
    if (!name) throw new PortalError(400, 'Give the hall a name.');
    if (!(rows >= 1 && rows <= 30) || !(cols >= 1 && cols <= 20)) throw new PortalError(400, 'Rows must be 1 to 30 and seats in a row 1 to 20.');
    return { name, where, rows, cols };
  }

  addHall(actor: User, input: { name: string; where?: string; rows: number; cols: number }) {
    this.coordinator(actor);
    const school = this.school(actor);
    const v = this.hallInput(input);
    if (this.db.halls.some((h) => h.schoolId === school.id && h.name.toLowerCase() === v.name.toLowerCase())) throw new PortalError(409, 'A hall with this name already exists.');
    const h: ExamHall = { id: uid('hall'), schoolId: school.id, ...v };
    this.db.halls.push(h);
    this.audit(actor, school.id, 'hall.added', `${h.name}, ${h.rows * h.cols} seats`);
    this.changed();
    return h;
  }

  /** Change a hall. Making it smaller than the seats already allotted in it is refused. */
  updateHall(actor: User, hallId: string, input: { name: string; where?: string; rows: number; cols: number }) {
    this.coordinator(actor);
    const school = this.school(actor);
    const h = this.db.halls.find((x) => x.id === hallId && x.schoolId === school.id);
    if (!h) throw new PortalError(404, 'Hall not found.');
    const v = this.hallInput(input);
    if (this.db.halls.some((x) => x.id !== h.id && x.schoolId === school.id && x.name.toLowerCase() === v.name.toLowerCase())) throw new PortalError(409, 'A hall with this name already exists.');
    const highest = Math.max(0, ...this.db.examPlans.flatMap((p) => p.seats.filter((s) => s.hallId === h.id).map((s) => s.seat)));
    if (highest > v.rows * v.cols) throw new PortalError(409, `Seat ${highest} is already allotted in this hall. Allot seats again first, or keep at least ${highest} seats.`);
    Object.assign(h, v);
    this.audit(actor, school.id, 'hall.updated', `${h.name}, ${h.rows * h.cols} seats`);
    this.changed();
    return h;
  }

  removeHall(actor: User, hallId: string) {
    this.coordinator(actor);
    const school = this.school(actor);
    const h = this.db.halls.find((x) => x.id === hallId && x.schoolId === school.id);
    if (!h) throw new PortalError(404, 'Hall not found.');
    const used = this.db.examPlans.filter((p) => p.seats.some((s) => s.hallId === h.id));
    if (used.length) throw new PortalError(409, `${used.map((p) => p.name).join(', ')} has students seated in ${h.name}. Allot seats again without it first.`);
    this.db.halls = this.db.halls.filter((x) => x !== h);
    for (const p of this.db.examPlans) p.hallIds = p.hallIds.filter((x) => x !== h.id);
    this.audit(actor, school.id, 'hall.removed', h.name);
    this.changed();
    return { removed: h.name };
  }

  /** Default exam timing by age: short papers for the youngest, the full board-style paper for 10 to 12. */
  static defaultTiming(grade: number): ExamTiming { return examTimingFor(grade); }

  private timingsOf(p: ExamPlan): Record<string, ExamTiming> {
    return Object.fromEntries(p.grades.map((g) => {
      const first = p.papers.find((x) => x.grade === g);
      return [String(g), p.timings?.[String(g)] ?? (first ? { start: first.start, end: first.end, maxMarks: first.maxMarks } : Portal.defaultTiming(g))];
    }));
  }

  private sittingsOf(p: ExamPlan) {
    return groupSittings(p.grades, this.timingsOf(p), p.papers);
  }

  /** Set the exam timing for one or more standards, and optionally move their papers to it. */
  setExamTiming(actor: User, planId: string, grades: number[], t: ExamTiming, apply = true) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    const gs = [...new Set((grades ?? []).map(Number))].filter((g) => p.grades.includes(g));
    if (!gs.length) throw new PortalError(400, 'Choose at least one standard writing this exam.');
    if (!/^\d{2}:\d{2}$/.test(t?.start ?? '') || !/^\d{2}:\d{2}$/.test(t?.end ?? '') || t.start >= t.end) throw new PortalError(400, 'The paper must end after it starts.');
    const maxMarks = Math.round(Number(t.maxMarks));
    if (!(maxMarks >= 5 && maxMarks <= 200)) throw new PortalError(400, 'Maximum marks must be between 5 and 200.');
    if (apply) for (const g of gs) {
      const days = p.papers.filter((x) => x.grade === g).map((x) => x.date);
      const twice = days.find((d, i) => days.indexOf(d) !== i);
      if (twice) throw new PortalError(409, `Standard ${g} writes two papers on ${twice}. Move one to another day before giving every paper the same time.`);
    }
    p.timings = { ...(p.timings ?? {}) };
    for (const g of gs) p.timings[String(g)] = { start: t.start, end: t.end, maxMarks };
    let moved = 0;
    if (apply) p.papers = p.papers.map((x) => (gs.includes(x.grade) ? (moved++, { ...x, start: t.start, end: t.end, maxMarks }) : x));
    this.audit(actor, p.schoolId, 'exam.timing', `${p.name}: standards ${gs.sort((a, b) => a - b).join(', ')} write ${t.start} to ${t.end}, ${maxMarks} marks${moved ? ` (${moved} papers moved)` : ''}${p.published ? ' (after publishing)' : ''}`);
    this.changed();
    return { grades: gs, moved, timings: this.timingsOf(p) };
  }

  /** Every standard in the school, so the exam coordinator can plan for all of them. */
  examGrades(actor: User) {
    this.role(actor, 'principal', 'teacher');
    if (actor.role === 'teacher' && !actor.examCoordinator) throw new PortalError(403, 'Only the exam coordinator plans exams. Your principal can make you one.');
    const school = this.school(actor);
    return [...new Set(this.db.classes.filter((c) => c.schoolId === school.id).map((c) => c.grade))].sort((a, b) => b - a);
  }

  listExamPlans(actor: User) {
    this.role(actor, 'principal', 'teacher');
    if (actor.role === 'teacher' && !actor.examCoordinator) throw new PortalError(403, 'Only the exam coordinator plans exams. Your principal can make you one.');
    const school = this.school(actor);
    return this.db.examPlans.filter((p) => p.schoolId === school.id).map((p) => {
      const dates = p.papers.map((x) => x.date).sort();
      return { id: p.id, name: p.name, type: p.type, grades: p.grades, papers: p.papers.length, students: this.planStudents(p).length, seated: p.seats.length, published: p.published, from: dates[0] ?? null, to: dates.at(-1) ?? null, withheld: Object.keys(p.withheld).length };
    }).sort((a, b) => (b.from ?? '').localeCompare(a.from ?? ''));
  }

  getExamPlan(actor: User, planId: string) {
    this.role(actor, 'principal', 'teacher');
    if (actor.role === 'teacher' && !actor.examCoordinator) throw new PortalError(403, 'Only the exam coordinator plans exams. Your principal can make you one.');
    const p = this.planFor(actor, planId);
    const students = this.planStudents(p);
    const halls = this.db.halls.filter((h) => h.schoolId === p.schoolId);
    const seatOf = new Map(p.seats.map((s) => [s.studentId, s]));
    const subjects: Record<number, string[]> = {};
    for (const c of this.db.classes.filter((x) => x.schoolId === p.schoolId)) subjects[c.grade] = [...new Set([...(subjects[c.grade] ?? []), ...c.subjects])];
    return {
      ...p, timings: this.timingsOf(p), sittings: this.sittingsOf(p).map((x) => ({ ...x, students: students.filter((st) => x.grades.includes(st.grade)).length })), papers: [...p.papers].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || b.grade - a.grade),
      grades: [...p.grades].sort((a, b) => b - a), subjectsByGrade: subjects, allGrades: Object.keys(subjects).map(Number).sort((a, b) => b - a),
      halls: halls.map((h) => ({ ...h, capacity: h.rows * h.cols, inUse: p.hallIds.includes(h.id) })),
      students: students.map((st) => { const s = seatOf.get(st.id); const h = s && halls.find((x) => x.id === s.hallId); return { ...st, sitting: s?.sitting ?? null, ticketNo: this.ticketNo(p, st), hallId: s?.hallId ?? null, hall: h?.name ?? null, where: h?.where ?? null, seat: s?.seat ?? null, withheld: p.withheld[st.id] ?? null }; }),
      problems: this.planProblems(p),
    };
  }

  private gradesInput(schoolId: string, grades: number[]) {
    const have = new Set(this.db.classes.filter((c) => c.schoolId === schoolId).map((c) => c.grade));
    const g = [...new Set((grades ?? []).map(Number))].filter((x) => have.has(x));
    if (!g.length) throw new PortalError(400, 'Choose at least one standard.');
    return g;
  }

  createExamPlan(actor: User, input: { name: string; type?: string; grades: number[]; hallIds?: string[] }) {
    this.coordinator(actor);
    const school = this.school(actor);
    const name = input.name?.trim();
    if (!name) throw new PortalError(400, 'Name the exam, for example Half-yearly 2026.');
    if (this.db.examPlans.some((p) => p.schoolId === school.id && p.name.toLowerCase() === name.toLowerCase())) throw new PortalError(409, 'An exam with this name already exists.');
    const p: ExamPlan = {
      id: uid('xp'), schoolId: school.id, name, type: input.type?.trim() || 'Exam', grades: this.gradesInput(school.id, input.grades),
      papers: [], hallIds: (input.hallIds ?? this.db.halls.filter((h) => h.schoolId === school.id).map((h) => h.id)), seats: [], published: false, withheld: {},
      createdAt: this.now().toISOString(), createdBy: actor.id,
    };
    this.db.examPlans.push(p);
    this.audit(actor, school.id, 'examplan.created', `${p.name} for standards ${p.grades.join(', ')}`);
    this.changed();
    return { id: p.id, name: p.name };
  }

  /** Rename an exam or change which standards write it. Students of a removed standard lose their seats. */
  updateExamPlan(actor: User, planId: string, input: { name?: string; type?: string; grades?: number[] }) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new PortalError(400, 'Name the exam.');
      if (this.db.examPlans.some((x) => x.id !== p.id && x.schoolId === p.schoolId && x.name.toLowerCase() === name.toLowerCase())) throw new PortalError(409, 'An exam with this name already exists.');
      p.name = name;
    }
    if (input.type !== undefined) p.type = input.type.trim() || p.type;
    if (input.grades) {
      p.grades = this.gradesInput(p.schoolId, input.grades);
      p.papers = p.papers.filter((x) => p.grades.includes(x.grade));
      const ids = new Set(this.planStudents(p).map((s) => s.id));
      p.seats = p.seats.filter((s) => ids.has(s.studentId));
    }
    this.audit(actor, p.schoolId, 'examplan.updated', p.name);
    this.changed();
    return { id: p.id, name: p.name };
  }

  deleteExamPlan(actor: User, planId: string) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    this.db.examPlans = this.db.examPlans.filter((x) => x !== p);
    this.audit(actor, p.schoolId, 'examplan.deleted', `${p.name}${p.published ? ' (was published)' : ''}`);
    this.changed();
    return { deleted: p.name };
  }

  /** Add or change one paper in the exam timetable. */
  savePaper(actor: User, planId: string, input: { id?: string; grade: number; subject: string; date: string; start: string; end: string; maxMarks?: number }) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    const grade = Number(input.grade);
    if (!p.grades.includes(grade)) throw new PortalError(400, `Standard ${grade} is not writing this exam.`);
    const taught = new Set(this.db.classes.filter((c) => c.schoolId === p.schoolId && c.grade === grade).flatMap((c) => c.subjects));
    if (!taught.has(input.subject)) throw new PortalError(400, `${input.subject} is not taught in standard ${grade}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) throw new PortalError(400, 'Choose the date.');
    if (!/^\d{2}:\d{2}$/.test(input.start ?? '') || !/^\d{2}:\d{2}$/.test(input.end ?? '') || input.start >= input.end) throw new PortalError(400, 'The paper must end after it starts.');
    const maxMarks = Math.round(Number(input.maxMarks ?? 100));
    if (!(maxMarks >= 5 && maxMarks <= 200)) throw new PortalError(400, 'Maximum marks must be between 5 and 200.');
    const others = p.papers.filter((x) => x.id !== input.id && x.grade === grade);
    if (others.some((x) => x.subject === input.subject)) throw new PortalError(409, `Standard ${grade} already has a ${input.subject} paper in this exam.`);
    const clash = others.find((x) => x.date === input.date && input.start < x.end && x.start < input.end);
    if (clash) throw new PortalError(409, `Standard ${grade} already writes ${clash.subject} at that time.`);
    const old = input.id ? p.papers.find((x) => x.id === input.id) : undefined;
    if (input.id && !old) throw new PortalError(404, 'Paper not found.');
    const paper: ExamPaper = { id: old?.id ?? uid('pp'), grade, subject: input.subject, date: input.date, start: input.start, end: input.end, maxMarks };
    p.papers = old ? p.papers.map((x) => (x === old ? paper : x)) : [...p.papers, paper];
    this.audit(actor, p.schoolId, old ? 'paper.updated' : 'paper.added', `${p.name}: standard ${grade} ${paper.subject} on ${paper.date}${p.published ? ' (after publishing)' : ''}`);
    this.changed();
    return paper;
  }

  removePaper(actor: User, planId: string, paperId: string) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    const x = p.papers.find((y) => y.id === paperId);
    if (!x) throw new PortalError(404, 'Paper not found.');
    p.papers = p.papers.filter((y) => y !== x);
    this.audit(actor, p.schoolId, 'paper.removed', `${p.name}: standard ${x.grade} ${x.subject}`);
    this.changed();
    return { removed: `${x.subject}, standard ${x.grade}` };
  }

  /** Seat every student writing this exam in the chosen halls, mixing standards so neighbours write different papers. */
  allotSeats(actor: User, planId: string, hallIds: string[]) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    const halls = hallIds.map((id) => this.db.halls.find((h) => h.id === id && h.schoolId === p.schoolId)).filter((h): h is ExamHall => !!h);
    if (!halls.length) throw new PortalError(400, 'Choose at least one hall.');
    const students = this.planStudents(p);
    const cap = halls.reduce((t, h) => t + h.rows * h.cols, 0);
    const seats: ExamSeat[] = [];
    for (const sit of this.sittingsOf(p)) {
      const group = students.filter((st) => sit.grades.includes(st.grade));
      const got = allocateSeats(group, halls);
      if (!got) throw new PortalError(409, `Standards ${[...sit.grades].reverse().join(', ')} write at the same time: ${group.length} students but only ${cap} seats in the halls chosen. Add a hall, or give some standards a different time.`);
      seats.push(...got.map((x) => ({ ...x, sitting: sit.key })));
    }
    p.hallIds = halls.map((h) => h.id);
    p.seats = seats;
    p.seatedAt = this.now().toISOString();
    this.audit(actor, p.schoolId, 'seats.allotted', `${p.name}: ${seats.length} students in ${halls.map((h) => h.name).join(', ')}`);
    this.changed();
    return { seated: seats.length, halls: halls.length, sittings: this.sittingsOf(p).length };
  }

  /** Move one student to another seat. If someone sits there, the two swap. */
  moveSeat(actor: User, planId: string, studentId: string, hallId: string, seat: number) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    const h = this.db.halls.find((x) => x.id === hallId && x.schoolId === p.schoolId);
    if (!h) throw new PortalError(404, 'Hall not found.');
    if (!(seat >= 1 && seat <= h.rows * h.cols)) throw new PortalError(400, `${h.name} has seats 1 to ${h.rows * h.cols}.`);
    const mine = p.seats.find((s) => s.studentId === studentId);
    if (!this.planStudents(p).some((s) => s.id === studentId)) throw new PortalError(400, 'This student is not writing this exam.');
    const st = this.planStudents(p).find((x) => x.id === studentId);
    const sitting = mine?.sitting ?? this.sittingsOf(p).find((x) => st && x.grades.includes(st.grade))?.key;
    const there = p.seats.find((s) => s.hallId === hallId && s.seat === seat && s.sitting === sitting);
    if (there && mine) { there.hallId = mine.hallId; there.seat = mine.seat; }
    else if (there) throw new PortalError(409, 'That seat is taken. Choose an empty seat.');
    if (mine) { mine.hallId = hallId; mine.seat = seat; } else p.seats.push({ studentId, hallId, seat, sitting });
    if (!p.hallIds.includes(hallId)) p.hallIds.push(hallId);
    this.changed();
    return { swappedWith: there ? this.db.students.find((s) => s.id === there.studentId)?.name ?? null : null };
  }

  /** Publish the timetable, seats and hall tickets to students and parents (or take them back to change them). */
  publishExamPlan(actor: User, planId: string, publish: boolean) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    if (publish) {
      const problems = this.planProblems(p);
      if (problems.length) throw new PortalError(409, `Fix these first: ${problems.join(' ')}`);
    }
    p.published = publish;
    p.publishedAt = publish ? this.now().toISOString() : p.publishedAt;
    this.audit(actor, p.schoolId, publish ? 'examplan.published' : 'examplan.unpublished', p.name);
    this.changed();
    return { published: p.published, students: this.planStudents(p).length };
  }

  /** Hold back one student's hall ticket with a reason the family sees, or release it (reason null). */
  setTicketHold(actor: User, planId: string, studentId: string, reason: string | null) {
    this.coordinator(actor);
    const p = this.planFor(actor, planId);
    const st = this.planStudents(p).find((s) => s.id === studentId);
    if (!st) throw new PortalError(400, 'This student is not writing this exam.');
    if (reason === null) delete p.withheld[studentId];
    else { if (!reason.trim()) throw new PortalError(400, 'Give the reason the family will see.'); p.withheld[studentId] = reason.trim(); }
    this.audit(actor, p.schoolId, reason === null ? 'ticket.released' : 'ticket.withheld', `${p.name}: ${st.name}${reason ? ` (${reason.trim()})` : ''}`);
    this.changed();
    return { withheld: p.withheld[studentId] ?? null };
  }

  /** For a student or parent: published exams with that child's papers, hall, seat and hall ticket. */
  myExams(actor: User, studentId?: string) {
    this.role(actor, 'student', 'parent');
    const st = this.studentFor(actor, studentId ?? actor.studentIds?.[0] ?? '');
    const c = this.db.classes.find((x) => x.id === st.classId)!;
    return this.db.examPlans.filter((p) => p.schoolId === st.schoolId && p.published && p.grades.includes(c.grade)).map((p) => {
      const s = p.seats.find((x) => x.studentId === st.id);
      const h = s && this.db.halls.find((x) => x.id === s.hallId);
      return {
        id: p.id, name: p.name, type: p.type,
        papers: p.papers.filter((x) => x.grade === c.grade).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
        hall: h ? { id: h.id, name: h.name, where: h.where, rows: h.rows, cols: h.cols } : null, seat: s?.seat ?? null,
        ticketNo: this.ticketNo(p, { grade: c.grade, section: c.section, rollNo: st.rollNo }), withheld: p.withheld[st.id] ?? null,
        student: { id: st.id, name: st.name, classLabel: classLabel(c), rollNo: st.rollNo },
      };
    }).sort((a, b) => (a.papers[0]?.date ?? '').localeCompare(b.papers[0]?.date ?? ''));
  }

  // ---------------------------------------------------------------- dashboard

  dashboard(actor: User) {
    this.role(actor, 'principal', 'teacher');
    const school = this.school(actor);
    const today = isoDate(this.now());
    const classes = this.listClasses(actor);
    const classIds = classes.map((c) => c.id);
    const students = this.db.students.filter((s) => classIds.includes(s.classId));
    const todayRecs = this.db.attendance.filter((r) => r.date === today && classIds.includes(r.classId) && r.session !== 'pm');
    let present = 0, absent = 0, late = 0;
    for (const r of todayRecs) for (const m of Object.values(r.marks)) { if (m === 'A') absent++; else { present++; if (m === 'L') late++; } }
    const marked = new Set(todayRecs.map((r) => r.classId));
    const byClass = classes.map((c) => {
      const recs = this.db.attendance.filter((r) => r.classId === c.id);
      let p = 0, t = 0;
      for (const r of recs) for (const m of Object.values(r.marks)) { t++; if (m !== 'A') p++; }
      const exams = this.db.exams.filter((e) => e.classId === c.id && e.status === 'published');
      let got = 0, max = 0;
      for (const e of exams) for (const m of this.db.marks.filter((x) => x.examId === e.id)) { got += m.total; max += examMax(e); }
      const todayRec = todayRecs.find((r) => r.classId === c.id);
      return { id: c.id, label: c.label, students: c.students, attendancePct: pct(p, t), averagePct: pct(got, max), markedToday: marked.has(c.id), absentToday: todayRec ? Object.values(todayRec.marks).filter((m) => m === 'A').length : null };
    });
    const chapterAgg: Record<string, { got: number; max: number; subject: string; chapter: string }> = {};
    for (const e of this.db.exams.filter((x) => classIds.includes(x.classId) && x.status === 'published')) {
      for (const m of this.db.marks.filter((x) => x.examId === e.id)) for (const q of e.questions) {
        const k = `${e.subject}|${q.chapter}`;
        chapterAgg[k] ??= { got: 0, max: 0, subject: e.subject, chapter: q.chapter };
        chapterAgg[k].got += m.perQuestion[q.no] ?? 0;
        chapterAgg[k].max += q.maxMarks;
      }
    }
    const weakChapters = Object.values(chapterAgg).map((v) => ({ subject: v.subject, chapter: v.chapter, pct: pct(v.got, v.max) })).sort((a, b) => a.pct - b.pct).slice(0, 6);
    const atRisk = students.map((s) => ({ id: s.id, name: s.name, classLabel: classLabel(this.db.classes.find((c) => c.id === s.classId)!), reasons: this.riskFor(s) })).filter((x) => x.reasons.length);
    const msgsToday = this.db.messages.filter((m) => m.schoolId === school.id && m.createdAt.startsWith(today));
    const scripts = this.db.scripts.filter((s) => s.schoolId === school.id && this.db.exams.some((e) => e.id === s.examId && classIds.includes(e.classId)));
    return {
      today,
      kpis: {
        students: students.length, present, absent, late,
        attendancePct: present + absent ? pct(present, present + absent) : null,
        classesMarked: marked.size, classes: classes.length,
        messagesToday: msgsToday.length,
        scriptsToReview: scripts.filter((s) => s.status === 'graded').length,
        scriptsWaiting: scripts.filter((s) => s.status === 'uploaded').length,
        scriptsApproved: scripts.filter((s) => s.status === 'approved').length,
      },
      byClass, weakChapters, atRisk,
      recentMessages: this.db.messages.filter((m) => m.schoolId === school.id).slice(-6).reverse(),
    };
  }

  // ---------------------------------------------------------------- reports

  examNames(actor: User, classId: string) {
    this.classFor(actor, classId);
    return [...new Set(this.db.exams.filter((e) => e.classId === classId && e.status === 'published').map((e) => e.name))];
  }

  /** Every report card a student has: this year's from published exams, and earlier years' from the archive. */
  reportCardList(actor: User, studentId: string) {
    const s = this.studentFor(actor, studentId);
    const c = this.db.classes.find((x) => x.id === s.classId)!;
    const year = academicYear(this.now());
    const current = [...new Set(this.db.exams.filter((e) => e.classId === c.id && e.status === 'published').sort((a, b) => a.date.localeCompare(b.date)).map((e) => e.name))]
      .map((examName) => {
        // A short summary for the list, so every card can be seen at a glance before opening one.
        let sum: { overall: number | null; letter: string; rank: number | null; classSize: number | null } = { overall: null, letter: '', rank: null, classSize: null };
        try { const rc = this.reportCard(actor, studentId, examName); sum = { overall: rc.overall, letter: rc.grade, rank: rc.rank, classSize: rc.classSize }; } catch { /* reports module off: list without a summary */ }
        return { key: `now:${examName}`, year, grade: c.grade, classLabel: classLabel(c), examName, current: true, ...sum, result: undefined as string | undefined };
      });
    const past = this.db.reportArchive.filter((r) => r.studentId === s.id)
      .map((r) => ({ key: `old:${r.id}`, year: r.year, grade: r.grade, classLabel: r.classLabel, examName: r.examName, current: false, overall: r.overall as number | null, letter: r.letter, rank: r.rank as number | null, classSize: r.classSize as number | null, result: r.result }));
    return [...current, ...past].sort((a, b) => b.grade - a.grade);
  }

  /** One report card by its key from reportCardList: this year's is worked out live, earlier years' come from the archive. */
  reportCardByKey(actor: User, studentId: string, key: string) {
    if (key.startsWith('now:')) return { ...this.reportCard(actor, studentId, key.slice(4)), year: academicYear(this.now()), archived: false };
    const s = this.studentFor(actor, studentId);
    const school = this.school(actor);
    this.module(school, 'reports');
    const r = this.db.reportArchive.find((x) => `old:${x.id}` === key && x.studentId === s.id);
    if (!r) throw new PortalError(404, 'That report card was not found.');
    return {
      school: { name: school.name, branding: school.branding, board: school.settings.board },
      student: { id: s.id, name: s.name, rollNo: s.rollNo, emis: s.emis, dob: s.dob, guardian: s.guardian.name, classLabel: r.classLabel },
      examName: r.examName, rows: r.rows.map((x) => ({ ...x, pass: x.pct >= school.settings.passMark })), total: r.total, max: r.max, overall: r.overall, grade: r.letter, attendancePct: r.attendancePct,
      rank: r.rank, classSize: r.classSize, remark: r.remark, classTeacher: r.classTeacher,
      principal: this.db.users.find((u) => u.schoolId === school.id && u.role === 'principal')?.name ?? '', activities: [] as Student['activities'],
      year: r.year, archived: true, result: r.result,
    };
  }

  reportCard(actor: User, studentId: string, examName: string) {
    const s = this.studentFor(actor, studentId);
    const school = this.school(actor);
    this.module(school, 'reports');
    const c = this.db.classes.find((x) => x.id === s.classId)!;
    const exams = this.db.exams.filter((e) => e.classId === c.id && e.name === examName && e.status === 'published');
    if (!exams.length) throw new PortalError(404, 'No published results for that exam yet.');
    const rows = c.subjects.map((subject) => {
      const e = exams.find((x) => x.subject === subject);
      const m = e && this.db.marks.find((x) => x.examId === e.id && x.studentId === s.id);
      const max = e ? examMax(e) : 0;
      const p = m && max ? pct(m.total, max) : null;
      return { subject, marks: m?.total ?? null, max, pct: p, grade: p === null ? '–' : this.gradeFor(school, p).grade, pass: p === null ? null : p >= school.settings.passMark };
    });
    const scored = rows.filter((r) => r.marks !== null);
    const total = round1(scored.reduce((t, r) => t + (r.marks ?? 0), 0));
    const max = scored.reduce((t, r) => t + r.max, 0);
    const overall = pct(total, max);
    const band = this.gradeFor(school, overall);
    const sorted = [...scored].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const att = this.attendancePct(s.id);
    // Class rank among classmates for the same exam
    const classmates = this.db.students.filter((x) => x.classId === c.id).map((x) => {
      let t = 0; for (const e of exams) t += this.db.marks.find((m) => m.examId === e.id && m.studentId === x.id)?.total ?? 0; return { id: x.id, t };
    }).sort((a, b) => b.t - a.t);
    const remark = [
      `${band.remark} performance overall.`,
      sorted.length > 1 ? `Strongest in ${sorted[0].subject}; more practice needed in ${sorted.at(-1)!.subject}.` : '',
      att < 75 ? `Attendance is ${att}%, below the required 75%.` : att >= 95 ? 'Excellent attendance.' : '',
    ].filter(Boolean).join(' ');
    return {
      school: { name: school.name, branding: school.branding, board: school.settings.board },
      student: { id: s.id, name: s.name, rollNo: s.rollNo, emis: s.emis, dob: s.dob, guardian: s.guardian.name, classLabel: classLabel(c) },
      examName, rows, total, max, overall, grade: band.grade, attendancePct: att,
      rank: classmates.findIndex((x) => x.id === s.id) + 1, classSize: classmates.length,
      remark, classTeacher: this.userById(c.classTeacherId)?.name ?? '', principal: this.db.users.find((u) => u.schoolId === school.id && u.role === 'principal')?.name ?? '',
      activities: s.activities.slice(0, 3),
    };
  }

  private gradeFor(school: School, p: number) {
    return school.settings.gradingScale.find((g) => p >= g.min) ?? school.settings.gradingScale.at(-1)!;
  }

  sendReportCards(actor: User, classId: string, examName: string) {
    this.role(actor, 'teacher');
    const c = this.classFor(actor, classId);
    const school = this.school(actor);
    const messages: OutboundMessage[] = [];
    for (const s of this.db.students.filter((x) => x.classId === c.id)) {
      const rc = this.reportCard(actor, s.id, examName);
      const msg = this.send(school, s, 'report', { exam: examName, marks: rc.overall, grade: rc.grade });
      if (msg) messages.push(msg);
    }
    this.audit(actor, school.id, 'reports.sent', `${classLabel(c)} ${examName}: ${messages.length} report cards`);
    this.changed();
    return { messages };
  }

  // ---------------------------------------------------------------- messages and audit

  listMessages(actor: User, opts: { studentId?: string; limit?: number } = {}) {
    let list: OutboundMessage[];
    if (actor.role === 'enticra_admin') list = this.db.messages;
    else {
      const school = this.school(actor);
      list = this.db.messages.filter((m) => m.schoolId === school.id);
      if (actor.role === 'parent' || actor.role === 'student') list = list.filter((m) => actor.studentIds?.includes(m.studentId));
      if (actor.role === 'teacher') { const ids = new Set(this.listStudents(actor).map((s) => s.id)); list = list.filter((m) => ids.has(m.studentId)); }
    }
    if (opts.studentId) list = list.filter((m) => m.studentId === opts.studentId);
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, opts.limit ?? 200)
      .map((m) => ({ ...m, studentName: this.db.students.find((s) => s.id === m.studentId)?.name ?? '' }));
  }

  listAudit(actor: User) {
    this.role(actor, 'principal', 'enticra_admin');
    const list = actor.role === 'enticra_admin' ? this.db.audit : this.db.audit.filter((a) => a.schoolId === this.school(actor).id);
    return [...list].reverse().slice(0, 100).map((a) => ({ ...a, actor: this.userById(a.actorId)?.name ?? a.actorId }));
  }

  listStaff(actor: User) {
    this.role(actor, 'principal');
    const school = this.school(actor);
    return this.db.users.filter((u) => u.schoolId === school.id && !u.removedAt && u.role !== 'parent' && u.role !== 'student');
  }
}

export type { ResponseGrade, AnswerScript };
