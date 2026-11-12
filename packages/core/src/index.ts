export * from './types';
export * from './util';
export * from './templates';
export * from './grading';
export * from './seed';
export * from './portal';
export * from './seating';

/** Portal methods callable over the API. Each takes (actor, ...args). */
export const RPC_METHODS = ['listHalls', 'addHall', 'updateHall', 'removeHall', 'examGrades', 'reportCardList', 'reportCardByKey', 'setExamTiming', 'teacherInsights', 'listExamPlans', 'getExamPlan', 'createExamPlan', 'updateExamPlan', 'deleteExamPlan', 'savePaper', 'removePaper', 'allotSeats', 'moveSeat', 'publishExamPlan', 'setTicketHold', 'myExams', 'substitutions', 'setExamCoordinator', 'getStaffAttendance', 'markStaffAttendance', 'staffAttendanceMonth', 'applyLeave', 'withdrawLeave', 'listLeave', 'decideLeave', 'setPeriod', 'resetTimetable', 'setSubjectTeacher', 'updateStudent', 'removeStudent', 'listFormerStudents', 'restoreStudent', 'removeActivity', 'removeObservation', 'updateTeacher', 'removeTeacher', 'listFormerTeachers', 'restoreTeacher', 'addClass', 'updateClass', 'removeClass', 'updateHomework', 'deleteHomework', 
  'me', 'listSchools', 'createSchool', 'getSchool', 'updateSchool',
  'listClasses', 'listStudents', 'getStudent', 'addActivity', 'addObservation', 'setInterests',
  'getAttendance', 'markAttendance', 'listHomework', 'createHomework', 'submitHomework', 'withdrawHomework', 'listSubmissions', 'reviewSubmission',
  'addStudent', 'addTeacher', 'teacherOverview', 'classResults', 'timetable',
  'listExams', 'createExam', 'updateExam', 'deleteExam', 'getExam', 'saveMarks', 'publishExam',
  'uploadScript', 'gradeScripts', 'reviewScript', 'gradingAgreement',
  'dashboard', 'examNames', 'reportCard', 'sendReportCards', 'listMessages', 'listAudit', 'listStaff',
] as const;

export type RpcMethod = (typeof RPC_METHODS)[number];
