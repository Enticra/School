import type { AnswerScript, Exam, PageIssue, Question, ResponseGrade, SchoolSettings, StepResult } from './types';
import { round1 } from './util';

export interface GradeInput {
  exam: Exam;
  script: AnswerScript;
  policy: SchoolSettings['markingPolicy'];
  threshold: number;
}

/** Marks per question, plus any pages the grader could not read well. */
export type GradeResult = ResponseGrade[] & { pageIssues?: PageIssue[] };

/** A grader reads an answer script and proposes marks. The teacher always approves. */
export interface Grader {
  name: 'mock' | 'claude';
  grade(input: GradeInput): Promise<GradeResult>;
}

/** Lower-case, strip spaces and unify symbols so "x = 2" matches "x=2" and "cm²" matches "cm2". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/π/g, 'pi')
    .replace(/[×✕]/g, 'x')
    .replace(/[−–—]/g, '-')
    .replace(/θ/g, 'theta')
    .replace(/\s+/g, '');
}

export function scoreSteps(q: Question, answer: string, policy: SchoolSettings['markingPolicy']): StepResult[] {
  const a = normalize(answer);
  return q.steps.map((step) => {
    const found = step.keywords.some((k) => a.includes(normalize(k)));
    // School mode is lenient on the presentation steps (units, formula statement) when the final answer is right.
    return { text: step.text, max: step.marks, awarded: found ? step.marks : 0, found };
  }).map((r, i, all) => {
    if (policy === 'school' && !r.found && /unit|formula|statement/i.test(r.text)) {
      const finalFound = all.filter((x) => !/unit|formula|statement/i.test(x.text)).at(-1)?.found;
      if (finalFound) return { ...r, awarded: r.max, found: true };
    }
    return r;
  });
}

function feedbackFor(q: Question, steps: StepResult[]): string {
  const missed = steps.filter((s) => !s.found);
  if (missed.length === 0) return 'Complete answer. Every step in the marking scheme is shown.';
  if (missed.length === steps.length) return `Revise "${q.chapter}". Start from: ${q.steps[0].text.toLowerCase()}.`;
  return `Show this step to get full marks: ${missed.map((m) => m.text.toLowerCase()).join('; ')}.`;
}

/**
 * Keyword grader used in demo mode and as the offline fallback. It reads the
 * page transcript (typed sample scripts) and checks each marking-scheme step.
 */
export const mockGrader: Grader = {
  name: 'mock',
  async grade({ exam, script, policy, threshold }) {
    const transcript: Record<string, string> = {};
    for (const p of script.pages) Object.assign(transcript, p.transcript ?? {});
    return exam.questions.map((q) => {
      const answer = transcript[q.no];
      if (answer === undefined) {
        return {
          no: q.no, transcription: '', aiMarks: 0, maxMarks: q.maxMarks, confidence: 0,
          reason: 'Could not read this answer from the scan. Please mark it yourself.',
          feedback: '', steps: q.steps.map((s) => ({ text: s.text, max: s.marks, awarded: 0, found: false })),
          needsReview: true,
        };
      }
      const steps = scoreSteps(q, answer, policy);
      const aiMarks = round1(Math.min(q.maxMarks, steps.reduce((t, s) => t + s.awarded, 0)));
      const hit = steps.filter((s) => s.found).length;
      const ratio = hit / steps.length;
      let confidence = ratio === 1 || ratio === 0 ? 0.94 : 0.62 + 0.2 * ratio;
      if (answer.trim().length < 3) confidence = 0.55;
      if (q.maxMarks >= 5 && ratio > 0 && ratio < 1) confidence -= 0.06;
      confidence = Math.round(confidence * 100) / 100;
      const parts = steps.map((s) => `${s.found ? '✓' : '✗'} ${s.text} (${s.awarded}/${s.max})`);
      return {
        no: q.no,
        transcription: answer,
        aiMarks,
        maxMarks: q.maxMarks,
        confidence,
        reason: parts.join(' · '),
        feedback: feedbackFor(q, steps),
        steps,
        needsReview: confidence < threshold,
      };
    });
  },
};

export function scriptTotal(responses: ResponseGrade[]): number {
  return round1(responses.reduce((t, r) => t + (r.teacherMarks ?? r.aiMarks), 0));
}

export function examMax(exam: Exam): number {
  return exam.questions.reduce((t, q) => t + q.maxMarks, 0);
}
