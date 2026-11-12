import type { ExamHall, ExamSeat } from './types';

/**
 * Seat students hall by hall, row by row, so that two students sitting side by side are from different
 * standards wherever possible (they write different papers). Takes from the standard with the most students
 * left that differs from the neighbour on the left. Returns null when the halls are too small.
 */
export function allocateSeats(students: { id: string; grade: number; section: string; rollNo: number }[], halls: ExamHall[]): ExamSeat[] | null {
  const capacity = halls.reduce((t, h) => t + h.rows * h.cols, 0);
  if (capacity < students.length) return null;
  const queues = new Map<number, typeof students>();
  for (const s of [...students].sort((a, b) => a.section.localeCompare(b.section) || a.rollNo - b.rollNo)) {
    if (!queues.has(s.grade)) queues.set(s.grade, []);
    queues.get(s.grade)!.push(s);
  }
  const seats: ExamSeat[] = [];
  let left = students.length;
  for (const h of halls) {
    let prev: number | null = null;
    for (let i = 0; i < h.rows * h.cols && left > 0; i++) {
      if (i % h.cols === 0) prev = null; // new row
      const options = [...queues.entries()].filter(([, q]) => q.length).sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
      const pick = options.find(([g]) => g !== prev) ?? options[0];
      const s = pick[1].shift()!;
      seats.push({ studentId: s.id, hallId: h.id, seat: i + 1 });
      prev = pick[0];
      left--;
    }
  }
  return seats;
}

/**
 * Standards that write at overlapping times share the halls in one sitting, mixed so neighbours write different
 * papers. Standards whose papers never overlap (for example juniors in the afternoon) are a separate sitting and
 * reuse the same halls. Two standards join if their timings overlap, or if any of their papers overlap on a day.
 */
export function groupSittings(grades: number[], timings: Record<string, { start: string; end: string }>, papers: { grade: number; date: string; start: string; end: string }[]) {
  const parent = new Map(grades.map((g) => [g, g]));
  const find = (g: number): number => { const p = parent.get(g)!; return p === g ? g : find(p); };
  const join = (a: number, b: number) => { const x = find(a), y = find(b); if (x !== y) parent.set(Math.max(x, y), Math.min(x, y)); };
  const over = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start < b.end && b.start < a.end;
  for (const a of grades) for (const b of grades) if (a < b && timings[String(a)] && timings[String(b)] && over(timings[String(a)], timings[String(b)])) join(a, b);
  for (const a of papers) for (const b of papers) if (a.grade < b.grade && grades.includes(a.grade) && grades.includes(b.grade) && a.date === b.date && over(a, b)) join(a.grade, b.grade);
  const groups = new Map<number, number[]>();
  for (const g of grades) { const r = find(g); groups.set(r, [...(groups.get(r) ?? []), g]); }
  return [...groups.values()].map((gs) => {
    const ts = gs.map((g) => timings[String(g)]).filter(Boolean);
    const start = ts.map((t) => t.start).sort()[0] ?? '';
    const end = ts.map((t) => t.end).sort().at(-1) ?? '';
    return { key: `s${[...gs].sort((a, b) => a - b).join('-')}`, grades: [...gs].sort((a, b) => b - a), start, end };
  }).sort((a, b) => a.start.localeCompare(b.start) || b.grades[0] - a.grades[0]);
}
