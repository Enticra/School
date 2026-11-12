// Sample data for the pilot demo. All people, schools and numbers here are
// fictional and shown in the app with a "Sample data" label.
import type {
  AnswerScript, ArchivedReport, AttendanceMark, AttendanceRecord, ClassRoom, Db, Exam, ExamHall, ExamPlan, Homework, HomeworkSubmission, MarkSheet, OutboundMessage,
  Question, School, SchoolSettings, StaffAttendance, StaffLeave, Student, User,
} from './types';
import { academicYear, addDays, examTimingFor, isoDate, lastSchoolDays, localDates, prng, round1 } from './util';
import { render } from './templates';
import { allocateSeats, groupSittings } from './seating';

export const SEED_VERSION = 11;

export function defaultSettings(board: SchoolSettings['board'] = 'Matriculation'): SchoolSettings {
  return {
    version: 1,
    board,
    attendanceMode: 'daily',
    lateCutoff: '08:45',
    language: 'en',
    quietHours: { start: '21:00', end: '07:00' },
    notify: { arrived: true, absent: true, late: true, homework: true, marks: true, report: true },
    modules: { attendance: true, homework: true, exams: true, aiGrading: true, profiles: true, reports: true },
    examTypes: ['Unit Test', 'Revision Test', 'Quarterly', 'Half-yearly', 'Model Exam', 'Annual'],
    gradingScale: [
      { min: 91, grade: 'A1', remark: 'Outstanding' },
      { min: 81, grade: 'A2', remark: 'Excellent' },
      { min: 71, grade: 'B1', remark: 'Very good' },
      { min: 61, grade: 'B2', remark: 'Good' },
      { min: 51, grade: 'C1', remark: 'Satisfactory' },
      { min: 41, grade: 'C2', remark: 'Needs practice' },
      { min: 35, grade: 'D', remark: 'Needs support' },
      { min: 0, grade: 'E', remark: 'Needs urgent support' },
    ],
    passMark: 35,
    markingPolicy: 'board',
    aiConfidenceThreshold: 0.8,
  };
}

// ---------- The AI-correction demo paper (10th Maths, TN board style) ----------

export const REVISION_PAPER: Question[] = [
  {
    no: '1', maxMarks: 1, chapter: 'Relations and Functions',
    text: 'If A = {1, 2} and B = {3, 4}, then n(A × B) is (a) 2 (b) 4 (c) 8 (d) 16',
    answerKey: '(b) 4',
    steps: [{ text: 'Chooses (b) 4', marks: 1, keywords: ['(b)', 'b)4', 'optionb'] }],
  },
  {
    no: '2', maxMarks: 2, chapter: 'Numbers and Sequences',
    text: 'Find the 12th term of the A.P. 3, 7, 11, …',
    answerKey: 'a = 3, d = 4, t12 = a + 11d = 47',
    steps: [
      { text: 'Finds a = 3 and d = 4', marks: 1, keywords: ['d=4', 'd=7-3=4'] },
      { text: 't12 = a + 11d = 47', marks: 1, keywords: ['=47'] },
    ],
  },
  {
    no: '3', maxMarks: 2, chapter: 'Coordinate Geometry',
    text: 'Find the slope of the line joining (2, 3) and (6, 11).',
    answerKey: 'm = (11 − 3)/(6 − 2) = 8/4 = 2',
    steps: [
      { text: 'Uses m = (y2 − y1)/(x2 − x1)', marks: 1, keywords: ['(y2-y1)', '(11-3)', '8/4'] },
      { text: 'Gets m = 2', marks: 1, keywords: ['=2\n', 'm=2', 'slope=2', '8/4=2'] },
    ],
  },
  {
    no: '4', maxMarks: 3, chapter: 'Algebra',
    text: 'Solve x² − 5x + 6 = 0 by factorisation.',
    answerKey: 'x² − 2x − 3x + 6 = 0, (x − 2)(x − 3) = 0, x = 2 or 3',
    steps: [
      { text: 'Splits the middle term (−2x − 3x)', marks: 1, keywords: ['-2x-3x', '-3x-2x'] },
      { text: 'Factorises to (x − 2)(x − 3) = 0', marks: 1, keywords: ['(x-2)(x-3)', '(x-3)(x-2)'] },
      { text: 'States both roots x = 2 and x = 3', marks: 1, keywords: ['x=2,x=3', 'x=2,3', 'x=2orx=3', 'x=2andx=3', 'x=3,x=2'] },
    ],
  },
  {
    no: '5', maxMarks: 5, chapter: 'Mensuration',
    text: 'A cylinder has radius 7 cm and height 10 cm. Find its curved surface area and total surface area. (π = 22/7)',
    answerKey: 'CSA = 2πrh = 440 cm², TSA = 2πr(h + r) = 748 cm²',
    steps: [
      { text: 'Writes CSA = 2πrh', marks: 1, keywords: ['2pirh', '2x22/7x7x10'] },
      { text: 'CSA = 440 cm²', marks: 1.5, keywords: ['440'] },
      { text: 'Writes TSA = 2πr(h + r)', marks: 1, keywords: ['2pir(h+r)', '2pir(r+h)', '2x22/7x7x17'] },
      { text: 'TSA = 748 cm²', marks: 1, keywords: ['748'] },
      { text: 'Gives units (cm²)', marks: 0.5, keywords: ['cm2', 'sq.cm', 'sqcm'] },
    ],
  },
  {
    no: '6', maxMarks: 2, chapter: 'Statistics and Probability',
    text: 'Find the mean of 10, 20, 30, 40, 50.',
    answerKey: 'Sum = 150, mean = 150/5 = 30',
    steps: [
      { text: 'Finds the sum = 150', marks: 1, keywords: ['150'] },
      { text: 'Mean = 150/5 = 30', marks: 1, keywords: ['150/5=30', 'mean=30'] },
    ],
  },
];

// Handwritten answers (as transcribed) at three levels: full, partial, wrong.
const ANSWERS: Record<string, [string, string, string]> = {
  '1': ['(b) 4', '(b) 4', '(c) 8'],
  '2': [
    'a = 3, d = 7 − 3 = 4\nt12 = a + 11d\n= 3 + 11(4) = 47',
    'a = 3, d = 4\nt12 = a + 12d = 3 + 48 = 51',
    't12 = 12 × 3 = 36',
  ],
  '3': [
    'm = (y2 − y1)/(x2 − x1)\n= (11 − 3)/(6 − 2) = 8/4 = 2',
    'm = (11 − 3)/(6 + 2) = 8/8 = 1',
    'm = 6/2 = 3',
  ],
  '4': [
    'x² − 2x − 3x + 6 = 0\nx(x − 2) − 3(x − 2) = 0\n(x − 2)(x − 3) = 0\nx = 2, x = 3',
    'x² − 5x + 6 = 0\n(x − 2)(x − 3) = 0\nx = 2',
    '(x + 2)(x + 3) = 0\nx = −2, x = −3',
  ],
  '5': [
    'CSA = 2πrh = 2 × 22/7 × 7 × 10\n= 440 cm²\nTSA = 2πr(h + r) = 2 × 22/7 × 7 × 17\n= 748 cm²',
    'CSA = 2πrh = 440\nTSA = 2πr² + 2πrh = 308 + 440 = 738',
    'Volume = πr²h = 22/7 × 49 × 10 = 1540 cm³',
  ],
  '6': [
    'Sum = 10 + 20 + 30 + 40 + 50 = 150\nMean = 150/5 = 30',
    'Sum = 150\nMean = 150/10 = 15',
    'Mean = 50 − 10 = 40',
  ],
};

const CHAPTERS: Record<string, string[]> = {
  Maths: ['Relations and Functions', 'Numbers and Sequences', 'Algebra', 'Geometry', 'Coordinate Geometry', 'Trigonometry', 'Mensuration', 'Statistics and Probability'],
  Science: ['Laws of Motion', 'Optics', 'Electricity', 'Periodic Classification', 'Chemical Reactions', 'Plant Anatomy', 'Heredity'],
  'Social Science': ['World War I', 'Indian National Movement', 'India: Location and Relief', 'Indian Constitution', 'Gross Domestic Product'],
  English: ['Prose', 'Poem', 'Supplementary Reader', 'Grammar', 'Writing'],
  Tamil: ['இயல் 1', 'இயல் 2', 'இயல் 3', 'இலக்கணம்', 'கட்டுரை'],
  EVS: ['Plants around us', 'Animals and their homes', 'Food we eat', 'Water', 'Our neighbourhood'],
  Physics: ['Units and Measurement', 'Kinematics', 'Laws of Motion', 'Work, Energy and Power', 'Gravitation'],
  Chemistry: ['Basic Concepts', 'Atomic Structure', 'Periodic Classification', 'Chemical Bonding', 'Hydrocarbons'],
  Biology: ['Diversity of Living World', 'Plant Kingdom', 'Cell Biology', 'Human Physiology', 'Genetics'],
};

/** The rest of the school: one section for each standard, so every feature works for every standard. */
const FIRST_F = ['Aishwarya', 'Bhavana', 'Charulatha', 'Dharshini', 'Eswari', 'Gayathri', 'Hema', 'Indhu', 'Jeevitha', 'Keerthana', 'Lavanya', 'Madhumitha', 'Nandhini', 'Oviya', 'Pavithra', 'Ramya', 'Sangeetha', 'Thenmozhi', 'Yazhini', 'Vaishnavi'];
const FIRST_M = ['Aakash', 'Balaji', 'Chandru', 'Dinesh', 'Ezhil', 'Gowtham', 'Hari', 'Jagan', 'Kishore', 'Lokesh', 'Manoj', 'Naveen', 'Pranav', 'Rahul', 'Santhosh', 'Tamilselvan', 'Udhay', 'Vignesh', 'Yuvan', 'Surya'];
const INITIALS = 'ABCDEGJKMNPRSTV';
export const MORE_CLASSES: { grade: number; teacher: string }[] = [
  { grade: 1, teacher: 'u_s1_p1' }, { grade: 2, teacher: 'u_s1_p2' }, { grade: 3, teacher: 'u_s1_p3' }, { grade: 4, teacher: 'u_s1_p4' }, { grade: 5, teacher: 'u_s1_p5' },
  { grade: 6, teacher: 'u_s1_soc2' }, { grade: 7, teacher: 'u_s1_eng2' }, { grade: 8, teacher: 'u_s1_tam2' }, { grade: 11, teacher: 'u_s1_phy' }, { grade: 12, teacher: 'u_s1_mathshs' },
];
export const subjectsFor = (grade: number) => grade <= 5 ? ['Tamil', 'English', 'Maths', 'EVS'] : grade <= 10 ? ['Tamil', 'English', 'Maths', 'Science', 'Social Science'] : ['Tamil', 'English', 'Maths', 'Physics', 'Chemistry', 'Biology'];

function genericPaper(subject: string, chapterOffset: number, rnd: () => number): Question[] {
  const chapters = CHAPTERS[subject] ?? CHAPTERS.English;
  const pattern = [2, 2, 3, 3, 5, 10];
  return pattern.map((m, i) => {
    const chapter = chapters[(i + chapterOffset) % chapters.length];
    return {
      no: String(i + 1), maxMarks: m, chapter,
      text: `${m}-mark question on ${chapter}`,
      answerKey: `Model answer for ${chapter}`,
      steps: [{ text: `Key points for ${chapter}`, marks: m, keywords: [chapter.toLowerCase().slice(0, 6)] }],
    } satisfies Question;
  }).sort(() => rnd() - 0.5).map((q, i) => ({ ...q, no: String(i + 1) }));
}

interface Persona { name: string; gender: 'F' | 'M'; ability: number; absence: number; mathsBias?: number }

const S1_10A: Persona[] = [
  { name: 'Arun Kumar P', gender: 'M', ability: 0.66, absence: 0.04, mathsBias: -0.12 },
  { name: 'Abinaya S', gender: 'F', ability: 0.9, absence: 0.02 },
  { name: 'Bharath R', gender: 'M', ability: 0.58, absence: 0.06 },
  { name: 'Deepika M', gender: 'F', ability: 0.82, absence: 0.03 },
  { name: 'Gokul V', gender: 'M', ability: 0.36, absence: 0.3 },
  { name: 'Harini K', gender: 'F', ability: 0.95, absence: 0.01 },
  { name: 'Imran A', gender: 'M', ability: 0.5, absence: 0.07 },
  { name: 'Janani T', gender: 'F', ability: 0.74, absence: 0.04 },
  { name: 'Karthik Raja S', gender: 'M', ability: 0.62, absence: 0.05 },
  { name: 'Keerthana B', gender: 'F', ability: 0.86, absence: 0.02 },
  { name: 'Mohammed Asif', gender: 'M', ability: 0.44, absence: 0.12 },
  { name: 'Nandhini R', gender: 'F', ability: 0.7, absence: 0.03 },
];
const S1_10B: Persona[] = [
  { name: 'Pranav S', gender: 'M', ability: 0.72, absence: 0.03 },
  { name: 'Priyadharshini K', gender: 'F', ability: 0.88, absence: 0.02 },
  { name: 'Ragul M', gender: 'M', ability: 0.4, absence: 0.28 },
  { name: 'Sandhya V', gender: 'F', ability: 0.67, absence: 0.05 },
  { name: 'Saravanan P', gender: 'M', ability: 0.55, absence: 0.06 },
  { name: 'Shalini R', gender: 'F', ability: 0.79, absence: 0.03 },
  { name: 'Surya N', gender: 'M', ability: 0.6, absence: 0.04 },
  { name: 'Swetha J', gender: 'F', ability: 0.92, absence: 0.01 },
  { name: 'Vignesh T', gender: 'M', ability: 0.47, absence: 0.09 },
  { name: 'Yamini L', gender: 'F', ability: 0.83, absence: 0.02 },
];
const S1_9A: Persona[] = [
  { name: 'Divya P', gender: 'F', ability: 0.84, absence: 0.02 },
  { name: 'Aakash R', gender: 'M', ability: 0.6, absence: 0.05 },
  { name: 'Bavithra S', gender: 'F', ability: 0.75, absence: 0.03 },
  { name: 'Dinesh K', gender: 'M', ability: 0.45, absence: 0.1 },
  { name: 'Evangeline J', gender: 'F', ability: 0.88, absence: 0.02 },
  { name: 'Fathima N', gender: 'F', ability: 0.7, absence: 0.04 },
  { name: 'Ganesh M', gender: 'M', ability: 0.52, absence: 0.06 },
  { name: 'Hemalatha V', gender: 'F', ability: 0.66, absence: 0.03 },
  { name: 'Jeeva T', gender: 'M', ability: 0.58, absence: 0.05 },
  { name: 'Kavya S', gender: 'F', ability: 0.8, absence: 0.03 },
];
const S2_10A: Persona[] = [
  { name: 'Aadhav R', gender: 'M', ability: 0.7, absence: 0.03 },
  { name: 'Ishwarya M', gender: 'F', ability: 0.9, absence: 0.02 },
  { name: 'Joel D', gender: 'M', ability: 0.55, absence: 0.06 },
  { name: 'Kaviya S', gender: 'F', ability: 0.78, absence: 0.03 },
  { name: 'Lokesh P', gender: 'M', ability: 0.42, absence: 0.2 },
  { name: 'Meera K', gender: 'F', ability: 0.85, absence: 0.02 },
  { name: 'Naveen J', gender: 'M', ability: 0.63, absence: 0.04 },
  { name: 'Oviya T', gender: 'F', ability: 0.74, absence: 0.03 },
];

const PARENT_NAMES_F = ['Selvi', 'Kala', 'Vasanthi', 'Revathi', 'Malathi', 'Jaya', 'Uma', 'Geetha', 'Sumathi', 'Bhuvana', 'Shanthi', 'Radha'];
const PARENT_NAMES_M = ['Murugan', 'Ramesh', 'Senthil', 'Kannan', 'Ravi', 'Suresh', 'Babu', 'Ganesan', 'Mani', 'Prakash', 'Saravanan', 'Elango'];

export function createSeed(now: Date = new Date()): Db {
  const rnd = prng(20261025);
  const today = isoDate(now);
  const stamp = (d: string, t = '09:05') => `${d}T${t}:00`;

  const s1: School = {
    id: 'sch_srividya', slug: 'sri-vidya', name: 'Sri Vidya Matriculation Higher Secondary School', shortName: 'Sri Vidya Matric', plan: 'pilot',
    branding: { primary: '#1B3A6B', accent: '#D9822B', crest: 'SV', motto: 'Knowledge is light', letterhead: '14, Gandhi Road, Saibaba Colony · Ph 0422 2440 000' },
    settings: { ...defaultSettings('Matriculation') },
    createdAt: stamp(isoDate(addDays(now, -60))),
  };
  const s2: School = {
    id: 'sch_littleflower', slug: 'little-flower', name: 'Little Flower Public School', shortName: 'Little Flower', plan: 'standard',
    branding: { primary: '#7A1E2C', accent: '#C9971C', crest: 'LF', motto: 'Grow in grace', letterhead: '3rd Cross, Anna Nagar · Ph 044 2626 0000' },
    settings: {
      ...defaultSettings('CBSE'),
      attendanceMode: 'session',
      lateCutoff: '08:30',
      language: 'ta',
      notify: { arrived: false, absent: true, late: true, homework: true, marks: true, report: true },
      modules: { attendance: true, homework: true, exams: true, aiGrading: false, profiles: true, reports: true },
      examTypes: ['Periodic Test', 'Half-yearly', 'Pre-board', 'Annual'],
      gradingScale: [
        { min: 90, grade: 'A+', remark: 'Outstanding' },
        { min: 75, grade: 'A', remark: 'Excellent' },
        { min: 60, grade: 'B', remark: 'Good' },
        { min: 45, grade: 'C', remark: 'Fair' },
        { min: 33, grade: 'D', remark: 'Needs support' },
        { min: 0, grade: 'E', remark: 'Needs urgent support' },
      ],
      passMark: 33,
      markingPolicy: 'school',
    },
    createdAt: stamp(isoDate(addDays(now, -30))),
  };

  const users: User[] = [
    { id: 'u_enticra', schoolId: null, role: 'enticra_admin', name: 'Enticra Support', phone: '9000000001', title: 'Onboarding team' },
    { id: 'u_s1_principal', schoolId: s1.id, role: 'principal', name: 'Mrs. S. Sujatha', phone: '9840011111', title: 'Principal' },
    { id: 'u_s1_maths', schoolId: s1.id, role: 'teacher', name: 'Mr. K. Karthik', phone: '9840022222', title: 'Maths teacher', classIds: ['cls_s1_10a', 'cls_s1_10b'], subjects: ['Maths'] },
    { id: 'u_s1_science', schoolId: s1.id, role: 'teacher', name: 'Mrs. R. Lakshmi', phone: '9840033333', title: 'Science teacher, class advisor 10-A', classIds: ['cls_s1_10a', 'cls_s1_9a'], subjects: ['Science'] },
    { id: 'u_s1_english', schoolId: s1.id, role: 'teacher', name: 'Mrs. V. Revathi', phone: '9840066666', title: 'English teacher', classIds: ['cls_s1_10a', 'cls_s1_10b', 'cls_s1_9a'], subjects: ['English'], listed: false },
    { id: 'u_s1_tamil', schoolId: s1.id, role: 'teacher', name: 'Mrs. S. Meena', phone: '9840077777', title: 'Tamil teacher', classIds: ['cls_s1_10a', 'cls_s1_10b', 'cls_s1_9a'], subjects: ['Tamil'], listed: false },
    { id: 'u_s1_social', schoolId: s1.id, role: 'teacher', name: 'Mr. P. Rajan', phone: '9840088888', title: 'Social Science teacher', classIds: ['cls_s1_10a', 'cls_s1_10b', 'cls_s1_9a'], subjects: ['Social Science'], listed: false },
    { id: 'u_s1_physics', schoolId: s1.id, role: 'teacher', name: 'Mr. A. Joseph', phone: '9840099999', title: 'Science teacher', classIds: ['cls_s1_10b'], subjects: ['Science'], listed: false },
    { id: 'u_s1_maths9', schoolId: s1.id, role: 'teacher', name: 'Mrs. G. Anitha', phone: '9840010101', title: 'Maths teacher', classIds: ['cls_s1_9a'], subjects: ['Maths'], listed: false },
    { id: 'u_s1_parent', schoolId: s1.id, role: 'parent', name: 'Mrs. P. Priya', phone: '9840044444', title: 'Parent', studentIds: ['stu_cls_s1_10a_1', 'stu_cls_s1_9a_1'] },
    { id: 'u_s1_student', schoolId: s1.id, role: 'student', name: 'Arun Kumar P', phone: '9840055555', title: 'Student, 10-A', studentIds: ['stu_cls_s1_10a_1'] },
    { id: 'u_s2_principal', schoolId: s2.id, role: 'principal', name: 'Mrs. Mary Selvi', phone: '9841011111', title: 'Principal' },
    { id: 'u_s2_maths', schoolId: s2.id, role: 'teacher', name: 'Mr. Ravi Shankar', phone: '9841022222', title: 'Maths teacher', classIds: ['cls_s2_10a'], subjects: ['Maths'] },
    { id: 'u_s2_parent', schoolId: s2.id, role: 'parent', name: 'Mr. M. Senthil', phone: '9841033333', title: 'Parent', studentIds: ['stu_cls_s2_10a_4'] },
  ];

  const SUBJ10 = ['Tamil', 'English', 'Maths', 'Science', 'Social Science'];
  const classes: ClassRoom[] = [
    { id: 'cls_s1_10a', schoolId: s1.id, grade: 10, section: 'A', classTeacherId: 'u_s1_science', subjects: SUBJ10 },
    { id: 'cls_s1_10b', schoolId: s1.id, grade: 10, section: 'B', classTeacherId: 'u_s1_maths', subjects: SUBJ10 },
    { id: 'cls_s1_9a', schoolId: s1.id, grade: 9, section: 'A', classTeacherId: 'u_s1_science', subjects: SUBJ10 },
    { id: 'cls_s2_10a', schoolId: s2.id, grade: 10, section: 'A', classTeacherId: 'u_s2_maths', subjects: ['Tamil', 'English', 'Maths', 'Science', 'Social Science'] },
  ];

  const roster: Record<string, Persona[]> = { cls_s1_10a: S1_10A, cls_s1_10b: S1_10B, cls_s1_9a: S1_9A, cls_s2_10a: S2_10A };
  const ability: Record<string, Persona> = {};
  const students: Student[] = [];
  let phoneSeq = 0;
  for (const c of classes) {
    roster[c.id].forEach((p, i) => {
      const id = `stu_${c.id.slice(4)}_${i + 1}`.replace('stu_', 'stu_cls_');
      ability[id] = p;
      phoneSeq++;
      const isMother = rnd() > 0.45;
      let guardianName = isMother ? `Mrs. ${PARENT_NAMES_F[phoneSeq % 12]}` : `Mr. ${PARENT_NAMES_M[phoneSeq % 12]}`;
      let phone = `98${String(43000000 + phoneSeq * 7919).slice(0, 8)}`;
      if (id === 'stu_cls_s1_10a_1' || id === 'stu_cls_s1_9a_1') { guardianName = 'Mrs. P. Priya'; phone = '9840044444'; }
      if (id === 'stu_cls_s2_10a_4') { guardianName = 'Mr. M. Senthil'; phone = '9841033333'; }
      const year = 2026 - c.grade - 5;
      students.push({
        id, schoolId: c.schoolId, classId: c.id, rollNo: i + 1, name: p.name, gender: p.gender,
        dob: `${year}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`,
        emis: String(3300000000000 + Math.floor(rnd() * 1e9)).slice(0, 13),
        guardian: { name: guardianName, relation: guardianName.startsWith('Mrs') ? 'Mother' : 'Father', phone, lang: c.schoolId === s2.id || rnd() > 0.7 ? 'ta' : 'en' },
        consent: { whatsapp: !(i === 7 && c.id === 'cls_s1_10b'), recordedAt: stamp(isoDate(addDays(now, -50))) },
        activities: [], interests: [], observations: [],
      });
    });
  }

  // Student 360 samples
  const arun = students.find((s) => s.id === 'stu_cls_s1_10a_1')!;
  arun.activities = [
    { id: 'act_1', kind: 'Art', title: 'Inter-school drawing competition', detail: 'Second prize, senior category', date: isoDate(addDays(now, -40)) },
    { id: 'act_2', kind: 'Club', title: 'Robotics club', detail: 'Built a line-following robot for the science fair', date: isoDate(addDays(now, -20)) },
    { id: 'act_3', kind: 'Sports', title: 'Kho-kho', detail: 'House team', date: isoDate(addDays(now, -12)) },
  ];
  arun.interests = ['Drawing', 'Design', 'Computers'];
  arun.observations = [{ by: 'Mrs. R. Lakshmi', text: 'Strong visual thinker. Explains diagrams well. Loses marks in multi-step Maths problems by skipping steps.', date: isoDate(addDays(now, -15)) }];
  const divya = students.find((s) => s.id === 'stu_cls_s1_9a_1')!;
  divya.activities = [
    { id: 'act_4', kind: 'Music', title: 'Carnatic vocal', detail: 'Performed at the annual day', date: isoDate(addDays(now, -35)) },
    { id: 'act_5', kind: 'Competition', title: 'Science quiz', detail: 'School team, district round', date: isoDate(addDays(now, -18)) },
  ];
  divya.interests = ['Music', 'Biology'];
  const harini = students.find((s) => s.id === 'stu_cls_s1_10a_6')!;
  harini.activities = [{ id: 'act_6', kind: 'Competition', title: 'Maths Olympiad', detail: 'Cleared the regional round', date: isoDate(addDays(now, -25)) }];
  harini.interests = ['Maths', 'Physics'];
  const kaviya = students.find((s) => s.id === 'stu_cls_s2_10a_4')!;
  kaviya.activities = [{ id: 'act_7', kind: 'Dance', title: 'Bharatanatyam', detail: 'Arangetram planned next year', date: isoDate(addDays(now, -22)) }];
  kaviya.interests = ['Dance', 'Literature'];

  // ---------- Attendance: 25 past school days, plus today for 10-B and 9-A ----------
  const attendance: AttendanceRecord[] = [];
  const pastDays = lastSchoolDays(addDays(now, -1), 25);
  const teacherFor: Record<string, string> = { cls_s1_10a: 'u_s1_science', cls_s1_10b: 'u_s1_maths', cls_s1_9a: 'u_s1_science', cls_s2_10a: 'u_s2_maths' };
  const markDay = (c: ClassRoom, date: string, session: AttendanceRecord['session']) => {
    const marks: Record<string, AttendanceMark> = {};
    const lateTimes: Record<string, string> = {};
    for (const s of students.filter((x) => x.classId === c.id)) {
      const r = rnd();
      const p = ability[s.id];
      if (r < p.absence) marks[s.id] = 'A';
      else if (r < p.absence + 0.03) { marks[s.id] = 'L'; lateTimes[s.id] = `08:${50 + Math.floor(rnd() * 9)}`; }
      else marks[s.id] = 'P';
    }
    attendance.push({ id: `att_${c.id}_${date}_${session}`, schoolId: c.schoolId, classId: c.id, date, session, marks, lateTimes, markedBy: teacherFor[c.id], markedAt: stamp(date, '08:58') });
  };
  for (const c of classes) {
    const sessions: AttendanceRecord['session'][] = c.schoolId === s2.id ? ['am', 'pm'] : ['day'];
    for (const d of pastDays) for (const ses of sessions) markDay(c, d, ses);
  }
  // Today: 10-B and 9-A are already marked so the dashboard has live numbers; 10-A is left for the demo.
  markDay(classes[1], today, 'day');
  markDay(classes[2], today, 'day');
  const t10b = attendance.at(-2)!, t9a = attendance.at(-1)!;
  t10b.marks.stu_cls_s1_10b_3 = 'A';
  t10b.marks.stu_cls_s1_10b_9 = 'L'; t10b.lateTimes!.stu_cls_s1_10b_9 = '08:52';
  t9a.marks.stu_cls_s1_9a_4 = 'A';

  // ---------- Exams and marks ----------
  const exams: Exam[] = [];
  const marks: MarkSheet[] = [];
  const addExam = (c: ClassRoom, subject: string, name: string, type: string, daysAgo: number, qs: Question[], by: string) => {
    const e: Exam = { id: `exm_${c.id.slice(4)}_${subject.replace(/\s/g, '').toLowerCase()}_${name.replace(/\s/g, '').toLowerCase()}`, schoolId: c.schoolId, classId: c.id, subject, name, type, date: isoDate(addDays(now, -daysAgo)), questions: qs, status: 'published', createdBy: by };
    exams.push(e);
    for (const s of students.filter((x) => x.classId === c.id)) {
      const p = ability[s.id];
      const per: Record<string, number> = {};
      for (const q of qs) {
        const chapterHard = (q.chapter.length % 5) * 0.03;
        const bias = subject === 'Maths' ? p.mathsBias ?? 0 : subject === 'Science' && s.id === 'stu_cls_s1_10a_1' ? 0.08 : 0;
        const level = Math.max(0, Math.min(1, p.ability + bias - chapterHard + (rnd() - 0.5) * 0.3));
        per[q.no] = Math.round(level * q.maxMarks * 2) / 2;
      }
      marks.push({ id: `mrk_${e.id}_${s.id}`, schoolId: c.schoolId, examId: e.id, studentId: s.id, perQuestion: per, total: round1(Object.values(per).reduce((a, b) => a + b, 0)), source: 'manual', updatedAt: stamp(e.date, '16:00') });
    }
    return e;
  };
  const teacherBySubject = (c: ClassRoom, subject: string) => users.find((u) => u.role === 'teacher' && u.classIds?.includes(c.id) && u.subjects?.includes(subject))?.id ?? users.find((u) => u.schoolId === c.schoolId && u.role === 'principal')!.id;
  classes.forEach((c, ci) => {
    const names = c.schoolId === s2.id ? [['Periodic Test 1', 'Periodic Test', 30], ['Periodic Test 2', 'Periodic Test', 9]] as const : [['Unit Test 1', 'Unit Test', 32], ['Unit Test 2', 'Unit Test', 10]] as const;
    names.forEach(([name, type, ago], ni) => {
      for (const subject of c.subjects) addExam(c, subject, name, type, ago - c.subjects.indexOf(subject), genericPaper(subject, ni * 3 + ci, rnd), teacherBySubject(c, subject));
    });
  });

  // Revision Test 1 for 10-A Maths: scripts scanned this morning, waiting for AI correction.
  const revision: Exam = { id: 'exm_s1_10a_maths_revision1', schoolId: s1.id, classId: 'cls_s1_10a', subject: 'Maths', name: 'Revision Test 1', type: 'Revision Test', date: isoDate(addDays(now, -1)), questions: REVISION_PAPER, status: 'marking', createdBy: 'u_s1_maths' };
  exams.push(revision);
  const scripts: AnswerScript[] = [];
  for (const s of students.filter((x) => x.classId === 'cls_s1_10a')) {
    const p = ability[s.id];
    if (p.absence > 0.25) continue; // Gokul was absent for the test
    const transcript: Record<string, string> = {};
    for (const q of REVISION_PAPER) {
      const level = p.ability + (p.mathsBias ?? 0) + (rnd() - 0.5) * 0.35 - (q.maxMarks >= 3 ? 0.08 : 0);
      transcript[q.no] = ANSWERS[q.no][level > 0.68 ? 0 : level > 0.42 ? 1 : 2];
    }
    if (s.name === 'Imran A') { transcript['5'] = ''; delete transcript['6']; }
    if (s.name === 'Arun Kumar P') { transcript['4'] = ANSWERS['4'][1]; transcript['5'] = ANSWERS['5'][1]; transcript['2'] = ANSWERS['2'][0]; }
    scripts.push({ id: `scr_${s.id}`, schoolId: s1.id, examId: revision.id, studentId: s.id, pages: [{ transcript }], status: 'uploaded', responses: [], uploadedBy: 'u_s1_maths', uploadedAt: stamp(today, '07:40') });
  }

  // ---------- Homework ----------
  const homework: Homework[] = [];
  const hw = (c: string, subject: string, title: string, details: string, ago: number, dueIn: number, by: string) => {
    const cls = classes.find((x) => x.id === c)!;
    homework.push({ id: `hw_${c}_${subject}_${ago}`.replace(/\s/g, ''), schoolId: cls.schoolId, classId: c, subject, title, details, dueDate: isoDate(addDays(now, -ago + dueIn)), assignedBy: by, createdAt: stamp(isoDate(addDays(now, -ago)), '15:30') });
  };
  hw('cls_s1_10a', 'Maths', 'Exercise 7.2, sums 1 to 6', 'Mensuration. Show the formula in every step and write units.', 1, 2, 'u_s1_maths');
  hw('cls_s1_10a', 'Science', 'Draw and label the human eye', 'Optics. Use a pencil and label at least 8 parts.', 2, 3, 'u_s1_science');
  hw('cls_s1_10a', 'English', 'Write a letter to the editor', 'Topic: plastic-free campus. 150 words.', 3, 4, 'u_s1_english');
  hw('cls_s1_10b', 'Maths', 'Exercise 3.5, sums 1 to 4', 'Algebra: quadratic equations by factorisation.', 1, 2, 'u_s1_maths');
  hw('cls_s1_9a', 'Science', 'Revise Chapter 4 for the quiz', 'Atoms and molecules. Learn the first 20 elements.', 1, 1, 'u_s1_science');
  hw('cls_s2_10a', 'Maths', 'Worksheet 6: Trigonometry identities', 'Prove any five identities.', 1, 2, 'u_s2_maths');

  // ---------- Homework handed in: most of 10-A has handed in the eye diagram; Arun's is left for the demo ----------
  const submissions: HomeworkSubmission[] = [];
  const eye = homework.find((h) => h.classId === 'cls_s1_10a' && h.subject === 'Science')!;
  for (const st of students.filter((x) => x.classId === 'cls_s1_10a' && x.id !== arun.id)) {
    if (ability[st.id].absence > 0.15 || st.rollNo % 5 === 0) continue;
    const checked = st.rollNo % 3 === 0;
    submissions.push({ id: `sub_${eye.id}_${st.id}`, schoolId: s1.id, homeworkId: eye.id, studentId: st.id, note: st.rollNo % 4 === 0 ? 'Labelled 10 parts.' : '', submittedAt: stamp(isoDate(addDays(now, -1)), `1${8 + (st.rollNo % 3)}:${10 + st.rollNo}`), status: checked ? 'checked' : 'submitted', remark: checked ? 'Neat diagram. Label the ciliary muscles too.' : undefined, reviewedBy: checked ? 'u_s1_science' : undefined });
  }

  // ---------- WhatsApp history for the sample parents ----------
  const messages: OutboundMessage[] = [];
  const schoolOf = (id: string) => (id === s1.id ? s1 : s2);
  const pushMsg = (st: Student, template: OutboundMessage['template'], vars: Record<string, string | number>, at: string) => {
    const sch = schoolOf(st.schoolId);
    messages.push({
      id: `msg_${messages.length + 1}`, schoolId: st.schoolId, studentId: st.id, to: st.guardian.phone, guardianName: st.guardian.name,
      template, lang: st.guardian.lang, body: render(template, st.guardian.lang, { student: st.name.split(' ')[0], school: sch.shortName, ...localDates(vars, st.guardian.lang) }),
      status: st.consent.whatsapp ? 'read' : 'skipped_no_consent', createdAt: at,
    });
  };
  for (const st of [arun, divya, kaviya]) {
    for (const d of pastDays.slice(-4)) {
      const rec = attendance.find((a) => a.classId === st.classId && a.date === d);
      const m = rec?.marks[st.id];
      if (m === 'A') pushMsg(st, 'absent', { date: d }, stamp(d, '09:10'));
      else if (m === 'L') pushMsg(st, 'late', { time: rec?.lateTimes?.[st.id] ?? '08:55' }, stamp(d, '09:10'));
      else if (schoolOf(st.schoolId).settings.notify.arrived) pushMsg(st, 'arrived', { time: '08:2' + (d.charCodeAt(9) % 9) }, stamp(d, '08:59'));
    }
    for (const h of homework.filter((x) => x.classId === st.classId)) pushMsg(st, 'homework', { subject: h.subject, title: h.title, due: h.dueDate }, h.createdAt);
    const ut2 = exams.find((e) => e.classId === st.classId && /2$/.test(e.name) && e.subject === 'Maths');
    const mk = ut2 && marks.find((m) => m.examId === ut2.id && m.studentId === st.id);
    if (ut2 && mk) pushMsg(st, 'marks', { exam: ut2.name, subject: ut2.subject, marks: mk.total, max: ut2.questions.reduce((t, q) => t + q.maxMarks, 0) }, stamp(ut2.date, '18:00'));
  }
  // This morning's attendance messages for the classes already marked
  for (const rec of attendance.filter((a) => a.date === today)) {
    for (const st of students.filter((x) => x.classId === rec.classId)) {
      const m = rec.marks[st.id];
      if (m === 'A') pushMsg(st, 'absent', { date: today }, stamp(today, '09:01'));
      else if (m === 'L') pushMsg(st, 'late', { time: rec.lateTimes?.[st.id] ?? '08:55' }, stamp(today, '09:01'));
      else pushMsg(st, 'arrived', { time: '08:4' + (st.rollNo % 10) }, stamp(today, '08:59'));
      messages[messages.length - 1].status = st.consent.whatsapp ? (st.rollNo % 3 ? 'read' : 'delivered') : 'skipped_no_consent';
    }
  }
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // ---------- The rest of the school: standards 1 to 8, 11 and 12 ----------
  const T = (id: string, name: string, n: number, subjects: string[], classIds: string[], title: string): User => ({ id, schoolId: s1.id, role: 'teacher', name, phone: `98402000${String(n).padStart(2, '0')}`, title, classIds, subjects, listed: false });
  const cid = (g: number) => `cls_s1_${g}a`;
  const primary = ['Mrs. A. Kalpana', 'Mrs. B. Nirmala', 'Mrs. C. Usha', 'Mrs. D. Vimala', 'Mrs. E. Saranya'];
  primary.forEach((name, i) => users.push(T(`u_s1_p${i + 1}`, name, i + 1, subjectsFor(1), [cid(i + 1)], `Class advisor ${i + 1}-A, all subjects`)));
  users.push(
    T('u_s1_eng2', 'Mrs. M. Deborah', 11, ['English'], [6, 7, 8, 11, 12].map(cid), 'English teacher, class advisor 7-A'),
    T('u_s1_tam2', 'Mr. R. Velmurugan', 12, ['Tamil'], [6, 7, 8, 11, 12].map(cid), 'Tamil teacher, class advisor 8-A'),
    T('u_s1_soc2', 'Mrs. K. Padma', 13, ['Social Science'], [6, 7, 8].map(cid), 'Social Science teacher, class advisor 6-A'),
    T('u_s1_mathshs', 'Mr. S. Balaji', 14, ['Maths'], [11, 12].map(cid), 'Maths teacher, class advisor 12-A'),
    T('u_s1_phy', 'Mr. T. Ganesh', 15, ['Physics'], [11, 12].map(cid), 'Physics teacher, class advisor 11-A'),
    T('u_s1_chem', 'Mrs. L. Fathima', 16, ['Chemistry'], [11, 12].map(cid), 'Chemistry teacher'),
    T('u_s1_bio', 'Mrs. N. Kavitha', 17, ['Biology'], [11, 12].map(cid), 'Biology teacher'),
  );
  for (const [id, more] of [['u_s1_maths9', [6, 7, 8]], ['u_s1_physics', [6, 7, 8]]] as const) { const u = users.find((x) => x.id === id)!; u.classIds = [...u.classIds!, ...more.map(cid)]; }
  const moreClasses: ClassRoom[] = MORE_CLASSES.map((m) => ({ id: cid(m.grade), schoolId: s1.id, grade: m.grade, section: 'A', classTeacherId: m.teacher, subjects: subjectsFor(m.grade) }));
  classes.push(...moreClasses);
  for (const c of moreClasses) {
    teacherFor[c.id] = c.classTeacherId;
    for (let i = 0; i < 8; i++) {
      const girl = (i + c.grade) % 2 === 0;
      const pool = girl ? FIRST_F : FIRST_M;
      const name = `${pool[(c.grade * 3 + i * 7) % pool.length]} ${INITIALS[(c.grade + i * 4) % INITIALS.length]}`;
      const id = `stu_${c.id}_${i + 1}`;
      ability[id] = { name, gender: girl ? 'F' : 'M', ability: 0.45 + rnd() * 0.5, absence: 0.02 + rnd() * 0.08 };
      phoneSeq++;
      const isMother = rnd() > 0.45;
      const guardianName = isMother ? `Mrs. ${PARENT_NAMES_F[phoneSeq % 12]}` : `Mr. ${PARENT_NAMES_M[phoneSeq % 12]}`;
      students.push({
        id, schoolId: s1.id, classId: c.id, rollNo: i + 1, name, gender: girl ? 'F' : 'M',
        dob: `${2026 - c.grade - 5}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`,
        emis: String(3300000000000 + Math.floor(rnd() * 1e9)).slice(0, 13),
        guardian: { name: guardianName, relation: isMother ? 'Mother' : 'Father', phone: `98${String(43000000 + phoneSeq * 7919).slice(0, 8)}`, lang: rnd() > 0.7 ? 'ta' : 'en' },
        consent: { whatsapp: true, recordedAt: stamp(isoDate(addDays(now, -50))) },
        activities: [], interests: [], observations: [],
      });
    }
    for (const d of pastDays) markDay(c, d, 'day');
    if (c.grade !== 7 && c.grade !== 12) markDay(c, today, 'day'); // two classes still to mark today
    ([['Unit Test 1', 'Unit Test', 32], ['Unit Test 2', 'Unit Test', 10]] as const).forEach(([name, type, ago], ni) => {
      for (const subject of c.subjects) addExam(c, subject, name, type, ago - c.subjects.indexOf(subject), genericPaper(subject, ni * 3 + c.grade, rnd), teacherBySubject(c, subject));
    });
  }

  // ---------- Half-yearly exams for the whole school: timetable, halls and seats (published); Unit Test 3 for 9 and 10 (draft) ----------
  const halls: ExamHall[] = [
    { id: 'hall_main', schoolId: s1.id, name: 'Hall 1', where: 'Main block, ground floor', rows: 6, cols: 6 },
    { id: 'hall_sci', schoolId: s1.id, name: 'Hall 2', where: 'Science block, first floor', rows: 6, cols: 6 },
    { id: 'hall_lib', schoolId: s1.id, name: 'Hall 3', where: 'Library hall', rows: 5, cols: 6 },
    { id: 'hall_aud', schoolId: s1.id, name: 'Hall 4', where: 'Auditorium', rows: 5, cols: 8 },
  ];
  const s1Grades = [...new Set(classes.filter((c) => c.schoolId === s1.id).map((c) => c.grade))].sort((a, b) => a - b);
  const examDays = lastSchoolDays(addDays(now, 22), 12).filter((d) => d > isoDate(addDays(now, 6)));
  const half: ExamPlan = { id: 'xp_halfyearly', schoolId: s1.id, name: 'Half-yearly exams', type: 'Half-yearly', grades: s1Grades, papers: [], hallIds: halls.map((h) => h.id), seats: [], published: true, publishedAt: stamp(isoDate(addDays(now, -2)), '17:00'), withheld: {}, createdAt: stamp(isoDate(addDays(now, -6)), '11:00'), createdBy: 'u_s1_maths' };
  half.timings = Object.fromEntries(s1Grades.map((g) => [String(g), examTimingFor(g)]));
  for (const g of s1Grades) {
    subjectsFor(g).forEach((subject, i) => {
      const t = examTimingFor(g);
      half.papers.push({ id: `pp_hy_${g}_${i}`, grade: g, subject, date: examDays[i * 2 + (g % 2)] ?? examDays.at(-1)!, start: t.start, end: t.end, maxMarks: t.maxMarks });
    });
  }
  const seatable = students.filter((x) => x.schoolId === s1.id).map((x) => { const c = classes.find((y) => y.id === x.classId)!; return { id: x.id, grade: c.grade, section: c.section, rollNo: x.rollNo }; });
  half.seats = groupSittings(half.grades, half.timings!, half.papers).flatMap((sit) => (allocateSeats(seatable.filter((x) => sit.grades.includes(x.grade)), halls) ?? []).map((x) => ({ ...x, sitting: sit.key })));
  half.seatedAt = half.publishedAt;
  const fee = students.find((x) => x.classId === 'cls_s1_10b' && x.rollNo === 5);
  if (fee) half.withheld[fee.id] = 'Term fee pending. Please meet the office before the exam.';
  const unit3: ExamPlan = { id: 'xp_unit3', schoolId: s1.id, name: 'Unit Test 3', type: 'Unit Test', grades: [9, 10], papers: [{ id: 'pp_u3_10_m', grade: 10, subject: 'Maths', date: isoDate(addDays(now, 40)), start: '10:00', end: '11:30', maxMarks: 50 }], hallIds: [], seats: [], published: false, withheld: {}, createdAt: stamp(isoDate(addDays(now, -1)), '15:00'), createdBy: 'u_s1_maths' };
  const examPlans = [half, unit3];
  half.createdBy = unit3.createdBy = 'u_s1_maths';
  // Mr. K. Karthik plans exams for the school.
  const coord = users.find((u) => u.id === 'u_s1_maths');
  if (coord) coord.examCoordinator = true;

  // Staff leave and a month of staff attendance (today left for the principal to mark).
  const s1Teachers = users.filter((u) => u.schoolId === s1.id && u.role === 'teacher');
  const staffLeave: StaffLeave[] = [
    { id: 'lv_1', schoolId: s1.id, userId: 'u_s1_english', kind: 'Casual', from: isoDate(addDays(now, 3)), days: 2, reason: 'Family function in Madurai.', status: 'Pending', createdAt: stamp(isoDate(addDays(now, -1)), '16:10') },
    { id: 'lv_2', schoolId: s1.id, userId: 'u_s1_tam2', kind: 'Sick', from: today, days: 1, reason: 'Fever since last night.', status: 'Pending', createdAt: stamp(today, '07:05') },
    { id: 'lv_3', schoolId: s1.id, userId: 'u_s1_physics', kind: 'On duty', from: isoDate(addDays(now, -6)), days: 1, reason: 'Board exam paper-setting meeting at the district office.', status: 'Approved', decidedBy: 'u_s1_principal', createdAt: stamp(isoDate(addDays(now, -9)), '12:00') },
    { id: 'lv_4', schoolId: s1.id, userId: 'u_s1_maths', kind: 'Earned', from: isoDate(addDays(now, 12)), days: 3, reason: 'Sister’s wedding.', status: 'Pending', createdAt: stamp(isoDate(addDays(now, -2)), '18:30') },
    { id: 'lv_5', schoolId: s1.id, userId: 'u_s1_soc2', kind: 'Casual', from: isoDate(addDays(now, -3)), days: 1, reason: 'Bank work.', status: 'Declined', reply: 'Unit test that day. Please take Saturday afternoon.', decidedBy: 'u_s1_principal', createdAt: stamp(isoDate(addDays(now, -5)), '09:40') },
  ];
  const rndStaff = prng(91);
  const staffAttendance: StaffAttendance[] = lastSchoolDays(addDays(now, -1), 20).map((d) => ({
    id: `sat_${d}`, schoolId: s1.id, date: d, markedBy: 'u_s1_principal', at: stamp(d, '09:20'),
    marks: Object.fromEntries(s1Teachers.map((t) => [t.id, (t.id === 'u_s1_physics' && d === isoDate(addDays(now, -6))) ? 'OD' : rndStaff() < 0.04 ? 'A' : rndStaff() < 0.03 ? 'L' : 'P'])),
  }));

  // Report cards from earlier years: each student keeps up to three past standards' Quarterly, Half-yearly and Annual cards.
  const scale = s1.settings.gradingScale;
  const letter = (p: number) => (scale.find((g) => p >= g.min) ?? scale.at(-1)!).grade;
  const persona = new Map([...S1_10A, ...S1_10B].map((x) => [x.name, x.ability]));
  const reportArchive: ArchivedReport[] = [];
  for (const st of students.filter((x) => x.schoolId === s1.id)) {
    const c = classes.find((x) => x.id === st.classId)!;
    const r = prng([...st.id].reduce((t, ch) => t * 31 + ch.charCodeAt(0), 7) >>> 0);
    const ability = persona.get(st.name) ?? 0.45 + r() * 0.45;
    for (let back = 1; back <= 3 && c.grade - back >= 1; back++) {
      const g = c.grade - back;
      const max = g <= 5 ? 50 : 100;
      const year = academicYear(now, back);
      const adviser = users.find((u) => u.id === c.classTeacherId)?.name ?? '';
      const terms = ['Quarterly', 'Half-yearly', 'Annual'];
      const sizes = 30 + Math.floor(r() * 10);
      terms.forEach((examName, ti) => {
        const rows = subjectsFor(g).map((subject) => {
          const p = Math.max(22, Math.min(99, Math.round((ability + 0.05 * back + (r() - 0.5) * 0.16 + ti * 0.015) * 100)));
          return { subject, marks: Math.round((p / 100) * max), max, pct: p, grade: letter(p) };
        });
        const total = rows.reduce((t, x) => t + x.marks, 0), tmax = rows.length * max, overall = Math.round((total / tmax) * 100);
        reportArchive.push({
          id: `rpa_${st.id}_${g}_${ti}`, schoolId: s1.id, studentId: st.id, year, grade: g, classLabel: `${g}-${c.section}`, examName,
          rows, total, max: tmax, overall, letter: letter(overall), attendancePct: Math.round(88 + r() * 11), rank: Math.max(1, Math.round((1 - ability) * sizes)), classSize: sizes,
          remark: overall >= 85 ? 'Excellent work all year.' : overall >= 65 ? 'Good, steady progress.' : overall >= 45 ? 'Satisfactory. Needs regular practice at home.' : 'Needs support in the basics. Please meet the class advisor.',
          classTeacher: adviser, result: examName === 'Annual' ? `Promoted to standard ${g + 1}` : undefined,
        });
      });
    }
  }

  return {
    schools: [s1, s2], users, classes, students, attendance, reportArchive, homework, submissions, formerStudents: [], halls, examPlans, timetableEdits: [], staffAttendance, staffLeave, exams, marks, scripts, messages,
    audit: [{ id: 'aud_1', schoolId: s1.id, actorId: 'u_enticra', action: 'school.created', detail: `Pilot school set up and ${students.filter((x) => x.schoolId === s1.id).length} students imported from EMIS`, at: s1.createdAt }],
    meta: { seededAt: now.toISOString(), seedVersion: SEED_VERSION },
  };
}
