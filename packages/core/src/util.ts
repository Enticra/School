let counter = 0;

export function uid(prefix: string): string {
  counter = (counter + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function isSchoolDay(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/** The last `n` school days up to and including `end` (if it is one), oldest first. */
export function lastSchoolDays(end: Date, n: number): string[] {
  const out: string[] = [];
  let d = new Date(end);
  while (out.length < n) {
    if (isSchoolDay(d)) out.unshift(isoDate(d));
    d = addDays(d, -1);
  }
  return out;
}

export function formatDate(iso: string, lang: 'en' | 'ta' = 'en'): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = lang === 'ta'
    ? ['ஜன', 'பிப்', 'மார்', 'ஏப்', 'மே', 'ஜூன்', 'ஜூலை', 'ஆக', 'செப்', 'அக்', 'நவ', 'டிச']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Is HH:MM inside a window that may wrap past midnight (e.g. 21:00 to 07:00)? */
export function inWindow(time: string, start: string, end: string): boolean {
  if (start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

/** Deterministic PRNG so seeded sample data is stable between runs. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

export function classLabel(c: { grade: number; section: string }): string {
  return `${c.grade}-${c.section}`;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}


/** Show ISO dates in messages the way parents write them ("26 Oct 2026" or "26 அக் 2026"). */
export function localDates(vars: Record<string, string | number>, lang: 'en' | 'ta') {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, lang) : v]));
}

/** Default exam timing by age: short papers for the youngest, the full board-style paper for 10 to 12. */
export function examTimingFor(grade: number): { start: string; end: string; maxMarks: number } {
  // Juniors write in the afternoon sitting, so the same halls seat the seniors in the forenoon.
  if (grade <= 2) return { start: '14:00', end: '15:00', maxMarks: 50 };
  if (grade <= 5) return { start: '14:00', end: '15:30', maxMarks: 50 };
  if (grade <= 9) return { start: '10:00', end: '12:30', maxMarks: 100 };
  return { start: '10:00', end: '13:15', maxMarks: 100 };
}

/** The academic year a date falls in, June to May: 2026-11-05 → "2026–27". */
export function academicYear(d: Date, back = 0): string {
  const y = (d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1) - back;
  return `${y}–${String((y + 1) % 100).padStart(2, '0')}`;
}
