import Anthropic from '@anthropic-ai/sdk';
import type { GradeResult, Grader, GradeInput, PageIssue, ResponseGrade, StepResult } from '@enticra/core';
import { round1 } from '@enticra/core';

const SYSTEM = `You are an experienced Tamil Nadu board examiner correcting a student's answer script.
For each question you get the question text, the official answer key and a marking scheme of numbered steps with marks.
Read the student's handwriting carefully, including formulas and working. Award each step its marks only when the student's
work shows it; partial credit inside a step is allowed in half marks. Never award more than a step's marks.
Marking policy "board" follows the board scheme strictly. Marking policy "school" may forgive a missing unit or formula
statement when the final answer is correct.
Report a confidence from 0 to 1 for each answer: lower it when handwriting is unclear, the answer is off-page, or the
student's method differs from the scheme. Pages are often phone photos: they may be tilted, sideways, shadowed or slightly
blurred, and answers may continue across pages. Read them as they are. Write the reason for the marks in one or two short sentences a teacher can check,
and one sentence of feedback addressed to the student. If an answer is blank or missing, transcribe it as an empty string.
For each page image, also say whether you could read it. Mark a page unreadable only when part of the student's writing on it
is lost (too blurred, too dark, cut off at the edge, glare, or covered), and describe the problem in a few plain words a teacher
can act on, such as "bottom of the page is cut off". Lower the confidence of any answer on an unreadable page.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers', 'pages'],
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['page', 'readable', 'issue'],
        properties: { page: { type: 'integer' }, readable: { type: 'boolean' }, issue: { type: 'string' } },
      },
    },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['no', 'transcription', 'steps', 'confidence', 'reason', 'feedback'],
        properties: {
          no: { type: 'string' },
          transcription: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['index', 'awarded'],
              properties: { index: { type: 'integer' }, awarded: { type: 'number' } },
            },
          },
          confidence: { type: 'number' },
          reason: { type: 'string' },
          feedback: { type: 'string' },
        },
      },
    },
  },
} as const;

interface ModelPage { page: number; readable: boolean; issue: string }
interface ModelAnswer { no: string; transcription: string; steps: { index: number; awarded: number }[]; confidence: number; reason: string; feedback: string }

function imageBlock(dataUrl: string): Anthropic.Beta.BetaImageBlockParam | null {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png' | 'image/jpeg' | 'image/webp', data: m[2] } };
}

/**
 * Grades answer scripts with Claude vision. Each page photo (or a typed
 * transcript, for sample scripts) is sent with the marking scheme; the model
 * returns per-step marks as structured JSON, which we clamp to the scheme.
 */
export function createClaudeGrader(opts: { apiKey?: string; model?: string; fetch?: typeof fetch } = {}): Grader {
  const client = new Anthropic({ apiKey: opts.apiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const model = opts.model ?? 'claude-sonnet-5-5';
  return {
    name: 'claude',
    async grade({ exam, script, policy, threshold }: GradeInput): Promise<GradeResult> {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      let photos = 0;
      script.pages.forEach((p, i) => {
        const img = p.dataUrl ? imageBlock(p.dataUrl) : null;
        if (img) { photos++; content.push({ type: 'text', text: `Page ${i + 1} of the answer script:` }); content.push(img); }
        if (p.transcript) content.push({ type: 'text', text: `Typed copy of page ${i + 1}, answers by question number:\n${JSON.stringify(p.transcript, null, 1)}` });
      });
      const paper = exam.questions.map((q) => ({
        no: q.no, question: q.text, marks: q.maxMarks, chapter: q.chapter, answer_key: q.answerKey,
        scheme: q.steps.map((s, index) => ({ index, step: s.text, marks: s.marks })),
      }));
      content.push({ type: 'text', text: `Subject: ${exam.subject}. Test: ${exam.name}. Marking policy: ${policy}.\nQuestion paper and marking scheme:\n${JSON.stringify(paper, null, 1)}\n\nGrade every question in the paper.` });

      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      });
      if (response.stop_reason === 'refusal') throw new Error('The AI declined to grade this script. Please mark it by hand.');
      if (response.stop_reason === 'max_tokens') throw new Error('The AI response was cut off. Try again with fewer pages.');
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const parsed = JSON.parse(text) as { answers: ModelAnswer[]; pages?: ModelPage[] };
      const pageIssues: PageIssue[] = photos
        ? (parsed.pages ?? []).filter((p) => !p.readable && p.page >= 1 && p.page <= script.pages.length).map((p) => ({ page: p.page, issue: p.issue.trim() || 'hard to read' }))
        : [];

      const responses: ResponseGrade[] = exam.questions.map((q) => {
        const a = parsed.answers.find((x) => String(x.no) === q.no);
        const steps: StepResult[] = q.steps.map((s, index) => {
          const got = a?.steps.find((x) => x.index === index)?.awarded ?? 0;
          const awarded = Math.max(0, Math.min(s.marks, Math.round(got * 2) / 2));
          return { text: s.text, max: s.marks, awarded, found: awarded > 0 };
        });
        const confidence = Math.max(0, Math.min(1, a?.confidence ?? 0));
        return {
          no: q.no,
          transcription: a?.transcription ?? '',
          aiMarks: round1(Math.min(q.maxMarks, steps.reduce((t, s) => t + s.awarded, 0))),
          maxMarks: q.maxMarks,
          confidence,
          reason: a?.reason ?? 'The AI did not return this answer. Please mark it yourself.',
          feedback: a?.feedback ?? '',
          steps,
          // A blank answer on a script with an unreadable page may just be writing we could not see.
          needsReview: !a || confidence < threshold || (pageIssues.length > 0 && !a.transcription.trim()),
        };
      });
      return Object.assign(responses, { pageIssues });
    },
  };
}
