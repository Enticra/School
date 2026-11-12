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

async function http<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Could not reach the server. Check your connection.');
  return data as T;
}

export const httpBackend: Backend = {
  async config() { const r = await fetch('/api/config'); return r.json(); },
  requestCode: (phone) => http('/api/auth/request', { phone }),
  async verify(phone, code) { return http<Session>('/api/auth/verify', { phone, code }); },
  async restore(token) {
    try { const r = await http<{ result: Omit<Session, 'token'> }>('/api/rpc/me', { args: [] }, token); return { token, ...r.result }; } catch { return null; }
  },
  async logout(token) { await http('/api/auth/logout', {}, token).catch(() => {}); },
  api: (token) => proxy(async (method, args) => (await http<{ result: unknown }>(`/api/rpc/${method}`, { args }, token)).result),
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
