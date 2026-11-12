// Domain model for Enticra School. Every tenant-owned record carries schoolId,
// and every service call checks it against the signed-in user (see portal.ts).

export type Role = 'enticra_admin' | 'principal' | 'teacher' | 'parent' | 'student';
export type Lang = 'en' | 'ta';
export type ModuleKey = 'attendance' | 'homework' | 'exams' | 'aiGrading' | 'profiles' | 'reports';
export type NotifyKey = 'arrived' | 'absent' | 'late' | 'homework' | 'marks' | 'report';
export type AttendanceMark = 'P' | 'A' | 'L';

export interface GradeBand { min: number; grade: string; remark: string }

export interface SchoolSettings {
  version: number;
  board: 'TN State Board' | 'Matriculation' | 'CBSE' | 'ICSE';
  attendanceMode: 'daily' | 'session';
  lateCutoff: string; // HH:MM
  language: Lang;
  quietHours: { start: string; end: string };
  notify: Record<NotifyKey, boolean>;
  modules: Record<ModuleKey, boolean>;
  examTypes: string[];
  gradingScale: GradeBand[]; // sorted high to low
  passMark: number; // percent
  markingPolicy: 'board' | 'school';
  aiConfidenceThreshold: number; // below this, an answer is flagged for teacher review
}

export interface SchoolBranding {
  primary: string; // header band, letterhead
  accent: string; // buttons, highlights
  crest: string; // 1-3 letters shown in the crest
  motto: string;
  letterhead: string; // address line printed on report cards
  logoDataUrl?: string;
}

export interface School {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  plan: 'pilot' | 'standard' | 'branded';
  branding: SchoolBranding;
  settings: SchoolSettings;
  createdAt: string;
}

export interface User {
  id: string;
  schoolId: string | null; // null only for Enticra staff
  role: Role;
  name: string;
  phone: string;
  title?: string;
  classIds?: string[]; // teacher: classes they teach
  subjects?: string[];
  studentIds?: string[]; // parent: their children
  /** false hides the account from the sample sign-in list (it can still sign in). */
  listed?: boolean;
  /** A teacher who plans exams, halls, seating and hall tickets for the school. */
  examCoordinator?: boolean;
  /** Set when a teacher leaves. They can no longer sign in; their past work keeps their name. */
  removedAt?: string;
}

export interface ClassRoom {
  id: string;
  schoolId: string;
  grade: number;
  section: string;
  /** The class advisor: marks attendance, looks after the students and sees the class timetable. */
  classTeacherId: string;
  subjects: string[];
  /** Who teaches each subject in this class. A subject set to null has no teacher yet. */
  subjectTeachers?: Record<string, string | null>;
}

/** Staff attendance: P present, A absent, L on approved leave, OD on duty outside school. */
export type StaffMark = 'P' | 'A' | 'L' | 'OD';
export interface StaffAttendance { id: string; schoolId: string; date: string; marks: Record<string, StaffMark>; markedBy: string; at: string }
export type LeaveKind = 'Casual' | 'Sick' | 'Earned' | 'On duty';
export interface StaffLeave { id: string; schoolId: string; userId: string; kind: LeaveKind; from: string; days: number; reason: string; status: 'Pending' | 'Approved' | 'Declined' | 'Withdrawn'; reply?: string; decidedBy?: string; createdAt: string }

/** A change made by hand to one period of a class timetable. A null subject leaves the period free. */
export interface TimetableEdit { classId: string; day: number; period: number; subject: string | null; by: string; at: string }

export interface Activity { id: string; kind: 'Art' | 'Music' | 'Dance' | 'Sports' | 'Club' | 'Competition' | 'Other'; title: string; detail: string; date: string }

export interface Student {
  id: string;
  schoolId: string;
  classId: string;
  rollNo: number;
  name: string;
  gender: 'F' | 'M';
  dob: string;
  emis: string;
  guardian: { name: string; relation: string; phone: string; lang: Lang };
  consent: { whatsapp: boolean; recordedAt: string };
  activities: Activity[];
  interests: string[];
  observations: { by: string; text: string; date: string }[];
}

export interface AttendanceRecord {
  id: string;
  schoolId: string;
  classId: string;
  date: string; // YYYY-MM-DD
  session: 'day' | 'am' | 'pm';
  marks: Record<string, AttendanceMark>; // studentId -> mark
  lateTimes?: Record<string, string>;
  markedBy: string;
  markedAt: string;
}

export interface Homework {
  id: string;
  schoolId: string;
  classId: string;
  subject: string;
  title: string;
  details: string;
  dueDate: string;
  photoDataUrl?: string;
  assignedBy: string;
  createdAt: string;
}

export interface HomeworkSubmission {
  id: string;
  schoolId: string;
  homeworkId: string;
  studentId: string;
  note: string;
  photoDataUrl?: string;
  submittedAt: string;
  /** checked: the teacher has seen it; redo: the teacher asked for it again. */
  status: 'submitted' | 'checked' | 'redo';
  remark?: string;
  reviewedBy?: string;
}

export interface SchemeStep { text: string; marks: number; keywords: string[] }

export interface Question {
  no: string;
  text: string;
  maxMarks: number;
  chapter: string;
  answerKey: string;
  steps: SchemeStep[];
}

export interface Exam {
  id: string;
  schoolId: string;
  classId: string;
  subject: string;
  name: string;
  type: string;
  date: string;
  questions: Question[];
  status: 'draft' | 'marking' | 'published';
  createdBy: string;
}

export interface MarkSheet {
  id: string;
  schoolId: string;
  examId: string;
  studentId: string;
  perQuestion: Record<string, number>;
  total: number;
  source: 'manual' | 'ai_reviewed';
  updatedAt: string;
}

export interface StepResult { text: string; awarded: number; max: number; found: boolean }

export interface ResponseGrade {
  no: string;
  transcription: string;
  aiMarks: number;
  maxMarks: number;
  confidence: number; // 0..1
  reason: string;
  feedback: string;
  steps: StepResult[];
  teacherMarks?: number;
  needsReview: boolean;
}

export interface ScriptPage { dataUrl?: string; transcript?: Record<string, string> }

/** A page the AI could not read well (blurred, cut off, too dark), so the teacher can ask for a re-take. */
export interface PageIssue { page: number; issue: string }

export interface AnswerScript {
  id: string;
  schoolId: string;
  examId: string;
  studentId: string;
  pages: ScriptPage[];
  status: 'uploaded' | 'grading' | 'graded' | 'approved' | 'failed';
  grader?: 'mock' | 'claude';
  responses: ResponseGrade[];
  /** Pages the AI flagged as hard to read during the last grading run. */
  pageIssues?: PageIssue[];
  error?: string;
  uploadedBy: string;
  uploadedAt: string;
  gradedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export type MessageStatus = 'sent' | 'delivered' | 'read' | 'scheduled' | 'skipped_no_consent' | 'failed';

export interface OutboundMessage {
  id: string;
  schoolId: string;
  studentId: string;
  to: string;
  guardianName: string;
  template: NotifyKey;
  lang: Lang;
  body: string;
  status: MessageStatus;
  createdAt: string;
  sendAt?: string;
  providerId?: string;
  /** Set when the message went to a real phone through WhatsApp, not the simulation. */
  live?: boolean;
  /** Why WhatsApp refused or could not deliver it, in plain words. */
  error?: string;
}

export interface AuditEntry { id: string; schoolId: string | null; actorId: string; action: string; detail: string; at: string }

export interface ExamHall { id: string; schoolId: string; name: string; where: string; rows: number; cols: number }
export interface ExamPaper { id: string; grade: number; subject: string; date: string; start: string; end: string; maxMarks: number }
export interface ExamTiming { start: string; end: string; maxMarks: number }
/** A seat in one sitting: standards writing at different times reuse the same halls and seat numbers. */
export interface ExamSeat { studentId: string; hallId: string; seat: number; sitting?: string }
/** A school exam (half-yearly, annual…): its timetable for each standard, halls, seating and hall tickets. */
export interface ExamPlan {
  id: string; schoolId: string; name: string; type: string; grades: number[];
  papers: ExamPaper[]; hallIds: string[];
  /** Exam timing for each standard: when papers start and end, and their marks. Young children write shorter papers. */
  timings?: Record<string, ExamTiming>; seats: ExamSeat[]; seatedAt?: string;
  published: boolean; publishedAt?: string;
  /** Hall tickets held back, with the reason the family is told. */
  withheld: Record<string, string>;
  createdAt: string; createdBy: string;
}

/** A report card from an earlier academic year, kept when the student moved up a standard. */
export interface ArchivedReport {
  id: string; schoolId: string; studentId: string; year: string; grade: number; classLabel: string; examName: string;
  rows: { subject: string; marks: number; max: number; pct: number; grade: string }[];
  total: number; max: number; overall: number; letter: string; attendancePct: number; rank: number; classSize: number;
  remark: string; classTeacher: string; result?: string;
}

export interface FormerStudent { student: Student; leftOn: string; reason: string; by: string; accounts: User[] }

export interface Db {
  schools: School[];
  users: User[];
  classes: ClassRoom[];
  students: Student[];
  attendance: AttendanceRecord[];
  homework: Homework[];
  submissions: HomeworkSubmission[];
  /** Students who left (transfer certificate issued, or added by mistake). Kept so they can be restored. */
  formerStudents: FormerStudent[];
  reportArchive: ArchivedReport[];
  halls: ExamHall[];
  examPlans: ExamPlan[];
  timetableEdits: TimetableEdit[];
  staffAttendance: StaffAttendance[];
  staffLeave: StaffLeave[];
  exams: Exam[];
  marks: MarkSheet[];
  scripts: AnswerScript[];
  messages: OutboundMessage[];
  audit: AuditEntry[];
  meta: { seededAt: string; seedVersion: number };
}
