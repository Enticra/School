import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { School } from '@enticra/core';
import type { Api, Session } from './api';
import logoSvg from './enticra-logo-horizontal.svg?raw';
import markSvg from './enticra-mark.svg?raw';

// ---------------------------------------------------------------- brand

export function EnticraLogo({ className, title = 'enticra' }: { className?: string; title?: string }) {
  return <span className={className} role="img" aria-label={title} style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: logoSvg.replace('<svg ', '<svg height="100%" ') }} />;
}
export function EnticraMark({ size = 28 }: { size?: number }) {
  return <span role="img" aria-label="enticra" style={{ display: 'inline-flex', height: size, width: size * 0.92 }} dangerouslySetInnerHTML={{ __html: markSvg.replace('<svg ', '<svg height="100%" width="100%" ') }} />;
}

/** Readable text colour (near-black teal or near-white) for a background hex. */
export function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.32 ? '#041416' : '#F4FAFA';
}

export function applySchoolTheme(school: School | null) {
  const root = document.documentElement.style;
  const primary = school?.branding.primary ?? '#0B333B';
  const accent = school?.branding.accent ?? '#E26527';
  root.setProperty('--school', primary);
  root.setProperty('--on-school', onColor(primary));
  root.setProperty('--school-accent', accent);
  root.setProperty('--on-accent', onColor(accent));
}

export function Crest({ school, size }: { school: Pick<School, 'branding' | 'name'>; size?: number }) {
  const style = { background: school.branding.accent, color: onColor(school.branding.accent), ...(size ? { width: size, height: size } : {}) };
  return <span className="crest" style={style} aria-hidden="true">{school.branding.logoDataUrl ? <img src={school.branding.logoDataUrl} alt="" /> : school.branding.crest}</span>;
}

// ---------------------------------------------------------------- icons (24px line, stroke 2, round caps)

const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  check: 'M20 6L9 17l-5-5',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  spark: 'M12 3l1.9 5.8L20 10l-5 3.7L16.5 20 12 16.6 7.5 20 9 13.7 4 10l6.1-1.2z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  chat: 'M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 21l2.2-5.4A8.4 8.4 0 1 1 21 11.5z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  building: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1',
  menu: 'M3 6h18M3 12h18M3 18h18',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 18l-6-6 6-6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.4-4.4',
  rupee: 'M6 3h12M6 8h12M6 3c6 0 8 2.5 8 5s-2 5-8 5l8 8',
  bus: 'M4 17V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v11M4 11h16M4 17h16v2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2M7 17v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2M8 14h.01M16 14h.01',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  bot: 'M12 8V4M8 4h8M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 13h.01M15 13h.01M9 17h6',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  award: 'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM8.2 13.9L7 23l5-3 5 3-1.2-9.1',
  database: 'M12 8c5 0 9-1.3 9-3s-4-3-9-3-9 1.3-9 3 4 3 9 3zM21 12c0 1.7-4 3-9 3s-9-1.3-9-3M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  briefcase: 'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  door: 'M3 21h18M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M14 12h.01',
  box: 'M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7L12 12l8.7-5M12 22V12',
  cap: 'M22 10L12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  mic: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2',
  map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16',
  cup: 'M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4zM6 1v3M10 1v3M14 1v3',
  bed: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
};
export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.check} />
    </svg>
  );
}

// ---------------------------------------------------------------- app context

export type Route = { page: string; id?: string; tab?: string };
export interface Ctx {
  session: Session;
  api: Api;
  route: Route;
  go: (r: Route) => void;
  toast: (text: string, kind?: 'ok' | 'err') => void;
  refreshSession: () => Promise<void>;
  tick: number; // bumps after writes so lists reload
  bump: () => void;
}
export const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

/** Load data for a page; reloads when deps change or after any write (tick). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const { tick, toast } = useApp();
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then((data) => live && setState({ data, error: null, loading: false }), (e: Error) => { if (live) { setState({ data: null, error: e.message, loading: false }); toast(e.message, 'err'); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, n]);
  return { ...state, reload: useCallback(() => setN((x) => x + 1), []) };
}

/** Wrap a write: shows errors as a toast, bumps data, returns result or null. */
export function useAction() {
  const { toast, bump } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(typeof success === 'function' ? success(r) : success);
      bump();
      return r;
    } catch (e) {
      toast((e as Error).message, 'err');
      return null;
    } finally { setBusy(false); }
  }, [toast, bump]);
  return { run, busy };
}

// ---------------------------------------------------------------- components

export function PageHead({ title, lede, eyebrow, children }: { title: ReactNode; lede?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Loading() { return <div className="empty" aria-busy="true">Loading…</div>; }

export function Bar({ value, label, sub, thresholds = [50, 70] }: { value: number; label: ReactNode; sub?: ReactNode; thresholds?: [number, number] }) {
  const cls = value < thresholds[0] ? 'low' : value < thresholds[1] ? 'mid' : '';
  return (
    <div className="bar-row" title={`${typeof label === 'string' ? label : ''} ${value}%`}>
      <div className="lbl">{label}{sub && <span className="dim small"> · {sub}</span>}</div>
      <div className="v">{value}%</div>
      <div className={`bar ${cls}`}><i style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div>
    </div>
  );
}

export function Sparkline({ points, max = 100 }: { points: { label: string; value: number }[]; max?: number }) {
  if (points.length < 2) return null;
  const w = 300, h = 56, pad = 6;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points.at(-1)!;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Trend: ${points.map((p) => `${p.label} ${p.value}%`).join(', ')}`}>
      <line x1={pad} x2={w - pad} y1={y(50)} y2={y(50)} stroke="var(--line-2)" strokeDasharray="3 4" />
      <path d={`${d} L${x(points.length - 1)},${h - pad} L${pad},${h - pad} Z`} fill="var(--school-accent)" opacity=".12" />
      <path d={d} fill="none" stroke="var(--school-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 4 : 2.5} fill={i === points.length - 1 ? 'var(--school-accent)' : 'var(--sf)'} stroke="var(--school-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke"><title>{`${p.label}: ${p.value}%`}</title></circle>)}
      <title>{`Latest ${last.label}: ${last.value}%`}</title>
    </svg>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 16 }}>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return <button id={id} type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  // Long lists (every class in the school, say) read better as a dropdown than a row of buttons.
  if (options.length > 7) return <select aria-label={label} className="input" style={{ width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function initials(name: string) {
  return name.replace(/^(Mr|Mrs|Ms|Dr|Fr)\.?\s+/i, '').split(/\s+/).filter((w) => w.length > 1).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export function Confidence({ value }: { value: number }) {
  const p = Math.round(value * 100);
  const color = p >= 85 ? 'var(--ok)' : p >= 70 ? 'var(--warn)' : 'var(--bad)';
  return <span className="conf" title="How sure the AI is about this mark"><span className="meter"><i style={{ width: `${p}%`, background: color }} /></span><span className="num" style={{ color }}>{p}%</span></span>;
}

export function relTime(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return 'just now';
  if (diff < 60) return `${Math.round(diff)} min ago`;
  if (diff < 60 * 24 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** Resize a photo to keep uploads small (max 1600px, JPEG). */
export function readImage(file: File, maxSide = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image.'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

/** One page of an answer script, ready to upload. preview is empty when the browser cannot show the file (PDF, iPhone HEIC). */
export interface PagePick { dataUrl: string; preview: string; label: string; kind: 'photo' | 'pdf' | 'heic' }

const MAX_RAW_BYTES = 25 * 1024 * 1024;

function readRaw(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(file);
  });
}

/**
 * Read an answer-script file. Photos the browser can open are resized here (the
 * browser also turns them upright). PDFs and iPhone HEIC photos are sent as they
 * are; the server converts them, splits PDF pages and turns them upright.
 */
export async function readPage(file: File): Promise<PagePick> {
  const name = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
  const isHeic = /image\/hei[cf]/.test(file.type) || /\.hei[cf]$/.test(name);
  if (!isPdf && !isHeic) {
    try { const dataUrl = await readImage(file, 2000); return { dataUrl, preview: dataUrl, label: file.name, kind: 'photo' }; }
    catch { /* the browser cannot show it; let the server try */ }
  }
  if (file.size > MAX_RAW_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  if (!isPdf && !isHeic && !file.type.startsWith('image/')) throw new Error(`${file.name} is not a photo or PDF.`);
  return { dataUrl: await readRaw(file), preview: '', label: file.name, kind: isPdf ? 'pdf' : isHeic ? 'heic' : 'photo' };
}

/** Turn a photo a quarter turn clockwise. */
export function rotateImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Could not rotate that page.'));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.height;
      c.height = img.width;
      const ctx = c.getContext('2d')!;
      ctx.translate(c.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------- confirmation before actions that send, pay or can't be undone

export interface ConfirmOptions { title: string; body: ReactNode; confirm: string; danger?: boolean }
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<{ o: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ o, resolve })), []);
  const done = (v: boolean) => { state?.resolve(v); setState(null); };
  const el = state ? (
    <Modal open title={state.o.title} onClose={() => done(false)}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="muted">{state.o.body}</div>
        <div className="row">
          <button className={`btn ${state.o.danger ? 'danger' : ''}`} autoFocus onClick={() => done(true)}>{state.o.confirm}</button>
          <button className="btn ghost" onClick={() => done(false)}>Cancel</button>
        </div>
      </div>
    </Modal>
  ) : null;
  return [ask, el];
}
