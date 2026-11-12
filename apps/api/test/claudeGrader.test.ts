import { describe, expect, it } from 'vitest';
import { createSeed, type AnswerScript } from '@enticra/core';
import { createClaudeGrader } from '../src/claudeGrader';

/** Answers the Messages API call with a canned structured reply, and keeps the request for checks. */
function fakeClaude(reply: unknown) {
  const calls: { body: any }[] = [];
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    const message = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(reply) }] };
    return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('Claude grader', () => {
  const db = createSeed(new Date(2026, 9, 26, 9, 0));
  const exam = db.exams.find((e) => e.questions.length >= 2)!;
  const photo = 'data:image/jpeg;base64,' + Buffer.from('fake').toString('base64');
  const script = { pages: [{ dataUrl: photo }, { dataUrl: photo }] } as AnswerScript;

  it('sends every page photo and reports pages it could not read', async () => {
    const [q1, q2] = exam.questions;
    const { fetchFn, calls } = fakeClaude({
      pages: [{ page: 1, readable: true, issue: '' }, { page: 2, readable: false, issue: 'bottom of the page is cut off' }],
      answers: [
        { no: q1.no, transcription: 'x = 2', steps: q1.steps.map((_, index) => ({ index, awarded: 99 })), confidence: 0.95, reason: 'All steps shown.', feedback: 'Well done.' },
        { no: q2.no, transcription: '', steps: [], confidence: 0.9, reason: 'Blank.', feedback: '' },
      ],
    });
    const grader = createClaudeGrader({ apiKey: 'test', fetch: fetchFn });
    const result = await grader.grade({ exam, script, policy: 'board', threshold: 0.7 });

    const content = calls[0].body.messages[0].content as { type: string }[];
    expect(content.filter((c) => c.type === 'image')).toHaveLength(2);
    expect(result.pageIssues).toEqual([{ page: 2, issue: 'bottom of the page is cut off' }]);
    const r1 = result.find((r) => r.no === q1.no)!;
    expect(r1.aiMarks).toBe(Math.min(q1.maxMarks, q1.steps.reduce((t, s) => t + s.marks, 0)));
    expect(r1.needsReview).toBe(false);
    // Blank answer on a script with an unreadable page goes to the teacher, even at high confidence.
    expect(result.find((r) => r.no === q2.no)!.needsReview).toBe(true);
  });

  it('reports no page issues when every page is readable', async () => {
    const { fetchFn } = fakeClaude({ pages: [{ page: 1, readable: true, issue: '' }], answers: [] });
    const result = await createClaudeGrader({ apiKey: 'test', fetch: fetchFn }).grade({ exam, script, policy: 'board', threshold: 0.7 });
    expect(result.pageIssues).toEqual([]);
    expect(result.every((r) => r.needsReview)).toBe(true); // nothing returned, so the teacher marks it
  });
});
