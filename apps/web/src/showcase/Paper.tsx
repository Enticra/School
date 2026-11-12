import type { Question } from '@enticra/core';
import { Icon, Modal, useApp } from '../ui';
import { Letterhead, printDoc, saveDocument } from './kit';

export type PartType = 'mcq' | 'short' | 'long' | 'construct';
/** One part of a paper: how many questions are printed, how many the student answers, and marks for each. */
export type BlueprintPart = { type: PartType; marks: number; set: number; answer: number };
export type Blueprint = { maxMarks: number; time: string; parts: BlueprintPart[] };
export type SavedPaper = { id: string; name: string; classId: string; classLabel: string; seed: number; createdAt: string; testId?: string; by?: string; byName?: string; blueprint?: Blueprint; subject?: string; grade?: number; pools?: Pools };
export type Item = { q: string; key: string; chapter: string; opts?: string[] };
export type Pools = Record<PartType, Item[]>;

export const PART_TYPES: Record<PartType, { name: string }> = {
  mcq: { name: 'Multiple choice' }, short: { name: 'Short answer' }, long: { name: 'Answer in detail' }, construct: { name: 'Diagram, graph or composition' },
};
export const PRESETS: Record<string, { label: string; bp: Blueprint }> = {
  board: { label: 'Board pattern · 100', bp: { maxMarks: 100, time: '3 hours', parts: [{ type: 'mcq', marks: 1, set: 14, answer: 14 }, { type: 'short', marks: 2, set: 14, answer: 10 }, { type: 'long', marks: 5, set: 14, answer: 10 }, { type: 'construct', marks: 8, set: 2, answer: 2 }] } },
  half: { label: 'Mid-term · 50', bp: { maxMarks: 50, time: '1½ hours', parts: [{ type: 'mcq', marks: 1, set: 10, answer: 10 }, { type: 'short', marks: 2, set: 7, answer: 5 }, { type: 'long', marks: 5, set: 6, answer: 4 }, { type: 'construct', marks: 0, set: 0, answer: 0 }] } },
  unit: { label: 'Unit test · 25', bp: { maxMarks: 25, time: '45 minutes', parts: [{ type: 'mcq', marks: 1, set: 5, answer: 5 }, { type: 'short', marks: 2, set: 6, answer: 5 }, { type: 'long', marks: 5, set: 2, answer: 2 }, { type: 'construct', marks: 0, set: 0, answer: 0 }] } },
};
export const DEFAULT_BP = PRESETS.board.bp;
export const bpTotal = (bp: Blueprint) => bp.parts.reduce((t, p) => t + p.answer * p.marks, 0);
/** What is wrong with a blueprint, in plain words, or null when it is ready. */
export function bpProblem(bp: Blueprint, pools: Pools = SAMPLE_POOLS): string | null {
  for (const p of bp.parts) {
    const n = PART_TYPES[p.type].name;
    if (p.set > pools[p.type].length) return `${n}: the bank has ${pools[p.type].length} of these questions for this standard and subject. Add more in the Question bank, or print fewer.`;
    if (p.answer > p.set) return `${n}: students can’t answer more questions than are printed.`;
    if (p.set > 0 && p.marks <= 0) return `${n}: give each question at least 1 mark.`;
  }
  const total = bpTotal(bp);
  if (!total) return 'Add at least one part.';
  if (total !== bp.maxMarks) return `The parts add up to ${total} marks, but the maximum is ${bp.maxMarks}. Change a part or the maximum.`;
  return null;
}

const MCQ: Item[] = [
  { q: 'If n(A × B) = 6 and A = {1, 3}, then n(B) is', opts: ['1', '2', '3', '6'], key: '(c) 3', chapter: 'Relations and Functions' },
  { q: 'The 8th term of the sequence 1, 1, 2, 3, 5, 8, … is', opts: ['25', '24', '23', '21'], key: '(d) 21', chapter: 'Numbers and Sequences' },
  { q: 'The HCF of 65 and 117 is', opts: ['4', '13', '7', '11'], key: '(b) 13', chapter: 'Numbers and Sequences' },
  { q: 'The roots of x² − 5x + 6 = 0 are', opts: ['2, 3', '−2, −3', '1, 6', '−1, 6'], key: '(a) 2, 3', chapter: 'Algebra' },
  { q: 'If ΔABC ~ ΔDEF and AB/DE = 2/3, the ratio of their areas is', opts: ['2 : 3', '4 : 9', '3 : 2', '9 : 4'], key: '(b) 4 : 9', chapter: 'Geometry' },
  { q: 'The slope of a line parallel to the x-axis is', opts: ['1', '−1', '0', 'not defined'], key: '(c) 0', chapter: 'Coordinate Geometry' },
  { q: 'The distance between (0, 0) and (3, 4) is', opts: ['3', '4', '5', '7'], key: '(c) 5', chapter: 'Coordinate Geometry' },
  { q: 'sin²θ + cos²θ equals', opts: ['0', '1', 'tan θ', '2'], key: '(b) 1', chapter: 'Trigonometry' },
  { q: 'If tan θ = 1, then θ is', opts: ['30°', '45°', '60°', '90°'], key: '(b) 45°', chapter: 'Trigonometry' },
  { q: 'The curved surface area of a cylinder is', opts: ['πr²h', '2πrh', '2πr(h + r)', '⅓πr²h'], key: '(b) 2πrh', chapter: 'Mensuration' },
  { q: 'The volume of a cone is', opts: ['πr²h', '⅓πr²h', '4/3 πr³', '2πrh'], key: '(b) ⅓πr²h', chapter: 'Mensuration' },
  { q: 'The range of 12, 25, 7, 31, 18 is', opts: ['24', '19', '31', '13'], key: '(a) 24', chapter: 'Statistics and Probability' },
  { q: 'The probability of a sure event is', opts: ['0', '½', '1', '2'], key: '(c) 1', chapter: 'Statistics and Probability' },
  { q: 'A relation from A to B is a subset of', opts: ['A', 'B', 'A × B', 'B × A'], key: '(c) A × B', chapter: 'Relations and Functions' },
];
const TWO: Item[] = [
  { q: 'If A = {1, 2} and B = {3, 4}, find A × B.', key: '{(1, 3), (1, 4), (2, 3), (2, 4)}: 1 mark for the method, 1 for all four pairs.', chapter: 'Relations and Functions' },
  { q: 'Find the 15th term of the A.P. 7, 11, 15, …', key: 'a = 7, d = 4; t₁₅ = 7 + 14 × 4 = 63.', chapter: 'Numbers and Sequences' },
  { q: 'Use Euclid’s division lemma to find the HCF of 84 and 120.', key: '120 = 84 × 1 + 36; 84 = 36 × 2 + 12; 36 = 12 × 3. HCF = 12.', chapter: 'Numbers and Sequences' },
  { q: 'Find the LCM of x³ − 1 and x² − 1.', key: '(x − 1)(x + 1)(x² + x + 1).', chapter: 'Algebra' },
  { q: 'Solve: 2x + 3y = 13, x − y = 1.', key: 'x = 16/5, y = 11/5 (substitution or elimination, both steps shown).', chapter: 'Algebra' },
  { q: 'In ΔABC, DE ∥ BC. If AD = 4 cm, DB = 6 cm and AE = 5 cm, find EC.', key: 'By BPT, AD/DB = AE/EC, so EC = 7.5 cm.', chapter: 'Geometry' },
  { q: 'Find the slope of the line joining (2, 3) and (6, 11).', key: 'm = (11 − 3)/(6 − 2) = 2.', chapter: 'Coordinate Geometry' },
  { q: 'Find the midpoint of (−2, 4) and (6, −8).', key: '(2, −2).', chapter: 'Coordinate Geometry' },
  { q: 'Prove that sin²θ + cos²θ = 1.', key: 'From the right triangle: (opp² + adj²)/hyp² = 1 by Pythagoras.', chapter: 'Trigonometry' },
  { q: 'Find the height of a tower whose 20 m shadow is cast when the sun’s altitude is 60°.', key: 'h = 20 tan 60° = 20√3 m ≈ 34.64 m.', chapter: 'Trigonometry' },
  { q: 'Find the total surface area of a cylinder of radius 7 cm and height 10 cm.', key: '2πr(h + r) = 2 × 22/7 × 7 × 17 = 748 cm².', chapter: 'Mensuration' },
  { q: 'Find the volume of a sphere of radius 3 cm.', key: '4/3 × π × 27 = 36π ≈ 113.04 cm³.', chapter: 'Mensuration' },
  { q: 'Two dice are rolled. Find the probability that the sum is 8.', key: '5 favourable outcomes of 36: P = 5/36.', chapter: 'Statistics and Probability' },
  { q: 'Find the standard deviation of 2, 4, 6, 8, 10.', key: 'Mean 6; variance 8; σ = 2√2 ≈ 2.83.', chapter: 'Statistics and Probability' },
];
const FIVE: Item[] = [
  { q: 'Show that the function f(x) = 2x + 3 from ℝ to ℝ is one-one and onto.', key: 'One-one: f(a) = f(b) ⇒ a = b (2 marks). Onto: y = 2x + 3 ⇒ x = (y − 3)/2 ∈ ℝ (2 marks). Conclusion (1 mark).', chapter: 'Relations and Functions' },
  { q: 'Find the sum of the first 20 terms of 3 + 7 + 11 + …', key: 'Sₙ = n/2[2a + (n − 1)d] = 10[6 + 76] = 820.', chapter: 'Numbers and Sequences' },
  { q: 'Find the sum of 6 + 66 + 666 + … to n terms.', key: '6/9[(10 + 100 + …) − n] = 2/27(10ⁿ⁺¹ − 10 − 9n).', chapter: 'Numbers and Sequences' },
  { q: 'Solve x² − 5x + 6 = 0 by completing the square.', key: '(x − 5/2)² = 1/4 ⇒ x = 3 or 2.', chapter: 'Algebra' },
  { q: 'Find the square root of 64x⁴ − 16x³ + 17x² − 2x + 1 by long division.', key: '|8x² − x + 1|.', chapter: 'Algebra' },
  { q: 'State and prove the Basic Proportionality Theorem.', key: 'Statement (1), figure (1), construction (1), proof with area ratios (2).', chapter: 'Geometry' },
  { q: 'Prove that the angle bisector of a triangle divides the opposite side in the ratio of the other two sides.', key: 'Figure and construction (2), proof using BPT (3).', chapter: 'Geometry' },
  { q: 'Find the area of the triangle with vertices (1, 2), (4, 6) and (7, 2).', key: '½|x₁(y₂ − y₃) + …| = 12 sq. units.', chapter: 'Coordinate Geometry' },
  { q: 'Find the equation of the line through (3, −2) parallel to 2x − y = 5.', key: 'Slope 2; y + 2 = 2(x − 3) ⇒ 2x − y − 8 = 0.', chapter: 'Coordinate Geometry' },
  { q: 'Prove that (1 − cos θ)/(1 + cos θ) = (cosec θ − cot θ)².', key: 'Expand RHS as (1 − cos θ)²/sin²θ, use sin²θ = 1 − cos²θ, simplify.', chapter: 'Trigonometry' },
  { q: 'From the top of a 50 m tower, the angles of depression of two cars are 30° and 60°. Find the distance between them.', key: '50√3 − 50/√3 = 100/√3 ≈ 57.73 m.', chapter: 'Trigonometry' },
  { q: 'A cone of height 24 cm and radius 6 cm is reshaped into a sphere. Find its radius.', key: '⅓π(36)(24) = 4/3πr³ ⇒ r = 6 cm.', chapter: 'Mensuration' },
  { q: 'Find the volume of a frustum with radii 8 cm and 4 cm and height 6 cm.', key: '⅓πh(R² + Rr + r²) = 224π ≈ 703.7 cm³.', chapter: 'Mensuration' },
  { q: 'Find the coefficient of variation of 20, 18, 32, 24, 26.', key: 'Mean 24, σ = 4.9, CV = 20.4%.', chapter: 'Statistics and Probability' },
];
const EIGHT: Item[] = [
  { q: 'Construct a triangle similar to a given triangle PQR with its sides equal to 3/5 of the corresponding sides of PQR (scale factor 3/5 < 1).', key: 'Rough figure (1), construction steps (5), final triangle and verification (2).', chapter: 'Geometry' },
  { q: 'Draw the graph of y = x² − 4x + 3 and use it to solve x² − 4x + 3 = 0.', key: 'Table of values (2), correct plot and curve (4), roots x = 1, 3 read from the graph (2).', chapter: 'Algebra' },
];

const rot = <T,>(a: T[], n: number) => a.map((_, i) => a[(i + n) % a.length]);
/** The sample 10th Maths bank that ships with the demo. */
export const SAMPLE_POOLS: Pools = { mcq: MCQ, short: TWO, long: FIVE, construct: EIGHT };
const STEP: Record<PartType, number> = { mcq: 1, short: 3, long: 5, construct: 0 };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
export function paperParts(seed: number, bp: Blueprint = DEFAULT_BP, pools: Pools = SAMPLE_POOLS) {
  return bp.parts.filter((p) => p.set > 0 && p.answer > 0).map((p, i) => {
    const all = p.answer === p.set;
    const note = p.type === 'mcq' && pools.mcq.some((it) => it.opts) ? `${all ? 'Answer all the questions' : `Answer any ${p.answer} questions`}. Choose the correct answer and write the option code with the answer.`
      : all ? (p.set === 2 ? 'Answer both questions.' : 'Answer all the questions.') : `Answer any ${p.answer} of the ${p.set} questions.`;
    return { title: `PART – ${ROMAN[i]}`, note, type: p.type, marks: p.marks, answer: p.answer, items: pools[p.type].length ? rot(pools[p.type], (seed * STEP[p.type]) % pools[p.type].length).slice(0, p.set) : [] };
  });
}

/** The paper as test questions with one-step schemes, so it can go to marks entry and AI correction. */
export function paperQuestions(seed: number, bp: Blueprint = DEFAULT_BP, pools: Pools = SAMPLE_POOLS): Question[] {
  return paperParts(seed, bp, pools).flatMap((p) => p.items.slice(0, p.answer).map((it) => ({ no: '', text: it.q, maxMarks: p.marks, chapter: it.chapter, answerKey: it.key, steps: [{ text: it.key, marks: p.marks, keywords: it.key.split(/[\s,;:()]+/).filter((w) => w.length > 2).slice(0, 4) }] })));
}

export function PaperView({ paper, open, onClose }: { paper: SavedPaper | null; open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  if (!paper) return null;
  const bp = paper.blueprint ?? DEFAULT_BP;
  const parts = paperParts(paper.seed, bp, paper.pools ?? SAMPLE_POOLS).filter((p) => p.items.length);
  const subject = paper.subject ?? 'Maths';
  const subjectName = subject === 'Maths' ? 'Mathematics' : subject;
  let n = 0;
  const numbered = parts.map((p) => ({ ...p, items: p.items.map((it) => ({ ...it, no: ++n })) }));
  const print = () => printDoc(toast);
  return (
    <Modal open={open} onClose={onClose} title={`${paper.name} · ${paper.classLabel} ${subject}`} wide>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => void saveDocument(document.querySelector('.modal .print-paper'), `${paper.name} ${paper.classLabel} ${subject} paper and key`, toast)}><Icon name="download" size={18} />Download paper and key</button>
        <button className="btn ghost" onClick={print}>Print or save as PDF</button>
        <span className="dim small">The downloaded file opens in any browser and prints with the answer key on a new page.</span>
      </div>
      <div className="print-paper">
        <Letterhead title={`${paper.name} · ${subjectName} · Class ${paper.classLabel}`}>
          <div className="row between small" style={{ color: '#4a6a70' }}><span>Time: {bp.time}</span><span>Maximum marks: {bpTotal(bp)}</span></div>
          {numbered.map((p) => (
            <section key={p.title} className="stack" style={{ gap: 8 }}>
              <div className="row between"><b>{p.title}</b><b className="num">{p.answer} × {p.marks} = {p.answer * p.marks}</b></div>
              <i style={{ fontSize: '.86rem' }}>Note: {p.note}</i>
              <ol start={p.items[0].no} style={{ margin: 0, paddingLeft: 26, display: 'grid', gap: 8 }}>
                {p.items.map((it) => <li key={it.no}>{it.q}{it.opts && <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 2 }}>{it.opts.map((o, j) => <span key={j}>({String.fromCharCode(97 + j)}) {o}</span>)}</div>}</li>)}
              </ol>
              {p.type === 'construct' && subject === 'Maths' && <i style={{ fontSize: '.86rem' }}>(Each question has an internal choice in the board paper; one form is shown.)</i>}
            </section>
          ))}
        </Letterhead>
        <div className="page-break" />
        <Letterhead title={`Answer key and marking scheme · ${paper.name}`}>
          <table>
            <thead><tr><th>Q</th><th>Answer and step marks</th><th>Marks</th><th>Chapter</th></tr></thead>
            <tbody>{numbered.flatMap((p) => p.items.map((it) => <tr key={it.no}><td className="num">{it.no}</td><td>{it.key}</td><td className="num">{p.marks}</td><td style={{ fontSize: '.8rem' }}>{it.chapter}</td></tr>))}</tbody>
          </table>
        </Letterhead>
      </div>
    </Modal>
  );
}
