import { Portal, PortalError, createSeed, mockGrader, SEED_VERSION, type Db, type Grader, type Portal as PortalT, type RpcMethod, type School, type Student, type User } from '@enticra/core';

declare const __DEMO__: boolean;
export const DEMO = __DEMO__;

type P = PortalT;
type Fn<M extends RpcMethod> = P[M] extends (actor: User, ...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
export type Api = { [M in RpcMethod]: Fn<M> };
export type Result<M extends RpcMethod> = Awaited<ReturnType<P[M]>>;

export interface Session { token: string; user: User; school: School | null; children: Student[] }
export interface DemoAccount { phone: string; name: string; role: User['role']; school: string }
export interface Config { devMode: boolean; grader: 'mock' | 'claude'; demoAccounts: DemoAccount[] }

export interface Backend {
  config(): Promise<Config>;
  requestCode(phone: string): Promise<{ sent: boolean; devCode?: string }>;
  verify(phone: string, code: string): Promise<Session>;
  restore(token: string): Promise<Session | null>;
  logout(token: string): Promise<void>;
  api(token: string): Api;
  reset?(): void;
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage full or blocked: the demo still runs in memory */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export { store };

function proxy(call: (method: string, args: unknown[]) => Promise<unknown>): Api {
  return new Proxy({} as Api, { get: (_t, method: string) => (...args: unknown[]) => call(method, args) });
}

// ---------------------------------------------------------------- HTTP backend (apps/api)

// The API runs on Render's free plan, which sleeps after 15 minutes without visitors. The first
// request after that gets a 502/503/504 (or no answer at all) for up to about a minute while it
// starts again. Instead of showing "could not reach the server", the app waits for /api/health
// to answer, tells the person the server is starting, and then sends the request again.

const WAKE_LIMIT_MS = 120_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Waking = (waking: boolean) => void;
const wakingListeners = new Set<Waking>();
let waking = false;
function setWaking(v: boolean) { if (v !== waking) { waking = v; wakingListeners.forEach((fn) => fn(v)); } }
/** Calls `fn(true)` while the server is starting up after sleeping, and `fn(false)` once it answers. */
export function onServerWaking(fn: Waking): () => void { wakingListeners.add(fn); fn(waking); return () => { wakingListeners.delete(fn); }; }

let wakeUp: Promise<boolean> | null = null;
/** Resolves true once /api/health answers ok, or false after about two minutes. Calls share one wait. */
export function waitForServer(): Promise<boolean> {
  wakeUp ??= (async () => {
    const until = Date.now() + WAKE_LIMIT_MS;
    for (let attempt = 0; Date.now() < until; attempt++) {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (r.ok && (await r.json().catch(() => null))?.ok) return true;
      } catch { /* not answering yet */ }
      setWaking(true);
      await sleep(Math.min(1500 * 2 ** attempt, 6000));
    }
    return false;
  })().finally(() => { setWaking(false); wakeUp = null; });
  return wakeUp;
}

/** Status codes that come from Render or Vercel while the API is asleep or starting, never from the API itself. */
const UNAVAILABLE = new Set([502, 503, 504]);
const OFFLINE = 'Could not reach the server. Check your internet connection and try again.';

/**
 * `safe` calls only read, so they may be sent again even after a gateway timeout (504), when the
 * first try might have reached the API. Others are sent again only when the first try certainly did
 * not reach it (no connection, 502 or 503), so nothing is saved twice.
 */
async function http<T>(path: string, body: unknown, token?: string, safe = false): Promise<T> {
  const send = () => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try { res = await send(); } catch { /* no connection, or the server did not answer */ }
    const data = res ? await res.json().catch(() => undefined) : undefined;
    if (res && !UNAVAILABLE.has(res.status) && data !== undefined) {
      if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong. Please try again.');
      return data as T;
    }
    const resend = !res || res.status === 502 || res.status === 503 || safe;
    if (attempt >= 2 || !(await waitForServer())) throw new ApiError(res?.status ?? 0, OFFLINE);
    if (!resend) throw new ApiError(res?.status ?? 0, 'The server was starting up. Please try that again.');
  }
}

async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { const r = await fetch(path, { cache: 'no-store' }); if (r.ok) return (await r.json()) as T; } catch { /* asleep */ }
    if (attempt >= 2 || !(await waitForServer())) throw new ApiError(0, OFFLINE);
  }
}

const READ_ONLY = new Set(['me']);

export const httpBackend: Backend = {
  config: () => getJson<Config>('/api/config'),
  requestCode: (phone) => http('/api/auth/request', { phone }),
  async verify(phone, code) { return http<Session>('/api/auth/verify', { phone, code }); },
  async restore(token) {
    // Only a 401 means the sign-in is gone; if the server is unreachable, keep the token and let the caller decide.
    try { const r = await http<{ result: Omit<Session, 'token'> }>('/api/rpc/me', { args: [] }, token, true); return { token, ...r.result }; }
    catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null; throw e; }
  },
  async logout(token) { await http('/api/auth/logout', {}, token).catch(() => {}); },
  api: (token) => proxy(async (method, args) => (await http<{ result: unknown }>(`/api/rpc/${method}`, { args }, token, READ_ONLY.has(method))).result),
};

// ---------------------------------------------------------------- In-browser demo backend

const DB_KEY = `enticra-school-demo-v${SEED_VERSION}`;

function loadDb(): Db {
  const raw = store.get(DB_KEY);
  if (raw) { try { return JSON.parse(raw) as Db; } catch { /* fall through to a fresh seed */ } }
  return createSeed();
}

let saveTimer: number | undefined;
const slowGrader: Grader = { name: 'mock', async grade(input) { await new Promise((r) => setTimeout(r, 260)); return mockGrader.grade(input); } };

function makeLocal(): Backend {
  let db = loadDb();
  const save = (d: Db) => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => store.set(DB_KEY, JSON.stringify(d)), 200); };
  let portal = new Portal(db, { grader: slowGrader, onChange: save });
  const userFor = (token: string) => portal.sessionUser(token.replace(/^demo:/, ''));
  return {
    async config() {
      return { devMode: true, grader: 'mock', demoAccounts: db.users.filter((u) => u.listed !== false && !u.removedAt).map((u) => ({ phone: u.phone, name: u.name, role: u.role, school: db.schools.find((s) => s.id === u.schoolId)?.shortName ?? 'Enticra' })) };
    },
    async requestCode(phone) {
      if (portal.deactivatedPhone(phone)) throw new ApiError(403, 'This sign-in was turned off because the student has left the school. Please contact the school office.');
      return { sent: true, devCode: portal.userByPhone(phone) ? '123456' : undefined };
    },
    async verify(phone, code) {
      const user = portal.userByPhone(phone);
      if (!user || code !== '123456') throw new ApiError(401, 'That code is wrong or has expired. Request a new one.');
      return { token: `demo:${user.id}`, ...portal.me(user) };
    },
    async restore(token) { const u = userFor(token); return u ? { token, ...portal.me(u) } : null; },
    async logout() {},
    api(token) {
      return proxy(async (method, args) => {
        const user = userFor(token);
        if (!user) throw new ApiError(401, 'Please sign in again.');
        try {
          const fn = (portal as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
          // Structured clone keeps the UI from mutating the in-memory database by accident.
          return structuredClone(await fn.call(portal, user, ...args));
        } catch (e) {
          if (e instanceof PortalError) throw new ApiError(e.status, e.message);
          throw e;
        }
      });
    },
    reset() { db = createSeed(); store.set(DB_KEY, JSON.stringify(db)); portal = new Portal(db, { grader: slowGrader, onChange: save }); },
  };
}

export const backend: Backend = DEMO ? makeLocal() : httpBackend;

// ---------------------------------------------------------------- live WhatsApp for pitch demos (server only)

export interface LiveRoute { samplePhone: string; guardianName: string; studentName: string; phoneEnding: string; windowOpenUntil: string | null }
export interface LiveView { enabled: boolean; mode: string | null; routes: LiveRoute[]; parents: { samplePhone: string; guardianName: string; studentName: string }[] }
export const liveWhatsApp = (token: string) => ({
  view: () => http<LiveView>('/api/whatsapp/routes', {}, token),
  set: (samplePhone: string, realPhone: string) => http<LiveView>('/api/whatsapp/routes/set', { samplePhone, realPhone }, token),
  remove: (samplePhone: string) => http<LiveView>('/api/whatsapp/routes/remove', { samplePhone }, token),
  test: (samplePhone: string) => http<{ ok: true }>('/api/whatsapp/test', { samplePhone }, token),
});
