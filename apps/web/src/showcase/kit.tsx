import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SEED_VERSION, addDays, formatDate, isoDate } from '@enticra/core';
import { store } from '../api';
import { Crest, Icon, Modal, useApp, useLoad } from '../ui';

/** Per-viewer state for the pitch screens, kept in the browser so a demo survives a refresh. */
export function useDemo<T>(key: string, initial: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] {
  const { session } = useApp();
  // Keyed by the sample-data version, so a new version or a reset starts every page fresh with the database.
  const k = `ent-show-v${SEED_VERSION}-${session.school?.id ?? 'platform'}-${key}`;
  const [v, setV] = useState<T>(() => {
    const raw = store.get(k);
    if (raw) { try { return JSON.parse(raw) as T; } catch { /* use initial */ } }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  useEffect(() => { store.set(k, JSON.stringify(v)); }, [k, v]);
  return [v, setV];
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const day = (offset: number) => isoDate(addDays(new Date(), offset));
export const dayLabel = (offset: number) => formatDate(day(offset));
export const pick = <T,>(arr: T[], i: number) => arr[((i % arr.length) + arr.length) % arr.length];

export function Stats({ items }: { items: { label: string; value: ReactNode; foot?: ReactNode; tone?: 'bad' | 'ok' }[] }) {
  return (
    <div className={`grid cols-${Math.min(items.length, 4)}`}>
      {items.map((s) => (
        <div key={s.label} className="card stat">
          <span className="eyebrow">{s.label}</span>
          <span className="value" style={s.tone ? { color: `var(--${s.tone})` } : undefined}>{s.value}</span>
          {s.foot && <span className="foot">{s.foot}</span>}
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.value} role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>{t.label}</button>)}
    </div>
  );
}

export function Table({ head, rows, empty = 'Nothing here yet.' }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Heat colour for a 0–100 score: red when weak, teal when strong. */
export function heat(p: number) {
  if (p < 45) return { background: 'var(--bad-bg)', color: 'var(--bad)' };
  if (p < 60) return { background: 'var(--warn-bg)', color: 'var(--warn)' };
  if (p < 75) return { background: 'var(--sf-2)', color: 'var(--tx)' };
  return { background: 'var(--ok-bg)', color: 'var(--ok)' };
}

/** The signed-in school's students (staff only); falls back to the user's own children. */
export function useRoster() {
  const { api, session } = useApp();
  const staff = session.user.role === 'principal' || session.user.role === 'teacher';
  const r = useLoad(() => (staff ? api.listStudents({}) : Promise.resolve(session.children.map((c) => ({ ...c, classLabel: '', attendancePct: 0, average: null })))), []);
  return r.data ?? [];
}

/** Text that appears a few words at a time, like a model writing it. */
export function useTyping(text: string, speed = 18) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    const words = text.split(/(\s+)/);
    let i = 0;
    const t = window.setInterval(() => { i += 3; setN(i); if (i >= words.length) window.clearInterval(t); }, speed);
    return () => window.clearInterval(t);
  }, [text, speed]);
  const words = text.split(/(\s+)/);
  return { shown: words.slice(0, n).join(''), done: n >= words.length };
}

export function Letterhead({ children, title }: { children: ReactNode; title: string }) {
  const { session } = useApp();
  const s = session.school!;
  return (
    <article className="report" aria-label={title}>
      <header className="lh">
        <Crest school={s} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: '1.15rem', letterSpacing: '-.02em' }}>{s.name}</div>
          <div style={{ fontSize: '.8rem', opacity: .8 }}>{s.branding.letterhead || s.settings.board}{s.branding.motto ? ` · “${s.branding.motto}”` : ''}</div>
        </div>
      </header>
      <div className="body">
        <h2 style={{ color: '#10232a' }}>{title}</h2>
        {children}
      </div>
    </article>
  );
}

/** A sample QR pattern (not scannable), stable for a given text. */
export function QR({ text, size = 120 }: { text: string; size?: number }) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const cells = Array.from({ length: 121 }, (_, i) => {
    const r = Math.floor(i / 11), c = i % 11;
    const finder = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
    if (finder) return !(r === 1 && (c === 1 || c === 9)) && !(r === 9 && c === 1);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h & 7) > 3;
  });
  return <span className="qrcode" style={{ width: size, height: size }} role="img" aria-label="Sample QR code">{cells.map((on, i) => <i key={i} className={on ? '' : 'o'} />)}</span>;
}

/** Open the browser print dialog (Save as PDF). Prints the open dialog, or only the element matching `target`. */
export function printDoc(toast: (t: string, k?: 'ok' | 'err') => void, target?: string) {
  const el = target ? document.querySelector('main ' + target) : null;
  document.body.classList.add(el ? 'print-only' : 'printing');
  const hidden: Element[] = [];
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    for (const sib of Array.from(n.parentElement?.children ?? [])) if (sib !== n) { sib.classList.add('print-hide'); hidden.push(sib); }
  }
  const t0 = performance.now();
  try { window.print(); } catch { /* handled below */ }
  // A print dialog blocks; returning at once means this preview does not allow printing.
  if (performance.now() - t0 < 60) toast('This preview can’t open the print dialog. Use Download document, then print it from your browser.', 'err');
  window.setTimeout(() => { document.body.classList.remove('printing', 'print-only'); hidden.forEach((h) => h.classList.remove('print-hide')); }, 800);
}

/** A document shown in a dialog with a Print or save as PDF button. */
export function PrintModal({ title, open, onClose, children, note }: { title: string; open: boolean; onClose: () => void; children: ReactNode; note?: string }) {
  const { toast } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => void saveDocument(ref.current, title, toast)}><Icon name="download" size={18} />Download document</button>
        <button className="btn ghost" onClick={() => printDoc(toast)}>Print or save as PDF</button>
        <span className="dim small">{note ?? 'The downloaded file opens in any browser and prints the same.'}</span>
      </div>
      <div ref={ref} className="print-paper stack" style={{ gap: 16 }}>{children}</div>
    </Modal>
  );
}

type Toast = (t: string, k?: 'ok' | 'err') => void;
type DownloadsApi = { save(r: { filename: string; data: string | Blob }): Promise<unknown> };

/** Hand the viewer a file: through the Claude viewer's downloads prompt when hosted there, or a normal browser download. */
export async function saveFile(filename: string, data: string, type: string, toast: Toast) {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<DownloadsApi | null> } }).claude;
  const dl = claude?.use ? await claude.use('downloads') : null;
  if (dl) {
    try { await dl.save({ filename, data }); toast(`${filename} saved.`); }
    catch (e) { const code = (e as { code?: string }).code; if (code !== 'declined') toast(code === 'rate_limited' ? 'A save is already waiting for your answer.' : 'This view can’t save files.', 'err'); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${filename} downloaded.`);
}

export function downloadCsv(filename: string, head: string[], rows: (string | number)[][], toast: Toast) {
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return saveFile(filename, '\ufeff' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\n'), 'text/csv', toast);
}

/** A standalone HTML copy of a document on screen, with the page's styles, ready to open and print anywhere. */
export function saveDocument(el: Element | null, title: string, toast: Toast) {
  if (!el) return;
  const root = getComputedStyle(document.documentElement);
  const vars = ['--school', '--on-school', '--school-accent', '--on-accent'].map((v) => `${v}:${root.getPropertyValue(v)}`).join(';');
  const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n') + `\n:root{${vars}}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, '')}</title><style>${css}\nbody{background:#fff;padding:24px}.report{margin:0 auto 24px;max-width:900px}.page-break,.ticket-page+.ticket-page{break-before:page}</style></head><body>${el.outerHTML}</body></html>`;
  return saveFile(`${title.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'document'}.html`, html, 'text/html', toast);
}

/** Preview of an export file, with the file itself as a CSV download. */
export function ExportModal({ title, filename, head, rows, open, onClose, note }: { title: string; filename: string; head: string[]; rows: (string | number)[][]; open: boolean; onClose: () => void; note?: string }) {
  const { toast } = useApp();
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => void downloadCsv(filename, head, rows, toast)}><Icon name="download" size={18} />Download {filename}</button>
        <button className="btn ghost" onClick={() => printDoc(toast)}>Print</button>
        <span className="dim small">{note ?? `${rows.length} rows. 0 validation errors.`}</span>
      </div>
      <div className="print-paper"><Table head={head} rows={rows.map((r) => r.map((c) => c))} /></div>
    </Modal>
  );
}

/** A worksheet or note a teacher shared: the student sees it in Homework, under Worksheets and notes. */
export type Shared = { id: string; title: string; subject: string; kind: string; text: string; cls: string; to?: string[]; teacher: string; at: string };
export const SHARED_SAMPLE: Shared[] = [
  { id: 'sm1', title: 'Worksheet: Trigonometry', subject: 'Maths', kind: 'Worksheet', cls: '10-A', teacher: 'Mr. K. Karthik', at: new Date(Date.now() - 2 * 864e5).toISOString(), text: 'Worksheet: Trigonometry (10-A)\n\nA. Choose the correct answer (1 mark each)\n1. The value of sin²θ + cos²θ is ____.\n2. tan 45° = ____.\n\nB. Answer briefly (2 marks each)\n3. Prove that (1 + tan²θ) cos²θ = 1.\n4. A ladder 10 m long reaches a window 8 m high. Find the angle it makes with the ground.\n\nC. Answer in detail (5 marks)\n5. From the top of a 60 m tower, the angle of depression of a car is 30°. How far is the car from the tower?\n\nAnswer key is with your teacher. Hand in a photo of your work in Homework.' },
];

