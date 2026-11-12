import { createSeed, SEED_VERSION, type Db } from '@enticra/core';

/**
 * PostgreSQL persistence.
 *
 * Every collection in the Db (schools, students, attendance, marks, ...) is its own table:
 *   id text primary key, school_id text, seq integer (list order), data jsonb, updated_at timestamptz
 *
 * The app keeps working on the in-memory Db. Whenever it changes something, `save()` is called;
 * a quarter of a second later only the rows that were added, changed or removed are written, in
 * one transaction. A failed write is retried, and nothing is marked saved until it succeeds.
 *
 * Sample data is loaded only when the database is empty. It is never wiped on restart or when the
 * sample data changes; `npm run db:reset` reloads it on purpose.
 *
 * Where the database lives:
 *   DATABASE_URL set   -> that PostgreSQL server (Neon, Supabase, or PostgreSQL on your PC)
 *   DATABASE_URL empty -> PGlite: a full PostgreSQL that runs inside Node and keeps its files in
 *                         DATA_DIR/pgdata. Nothing to install, but only one process can open it at a time.
 */

export const COLLECTIONS = [
  'schools', 'users', 'classes', 'students', 'attendance', 'homework', 'submissions', 'formerStudents',
  'reportArchive', 'halls', 'examPlans', 'timetableEdits', 'staffAttendance', 'staffLeave', 'exams',
  'marks', 'scripts', 'messages', 'audit',
] as const satisfies readonly Exclude<keyof Db, 'meta'>[];
type Collection = (typeof COLLECTIONS)[number];

type Query = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: R[] }>;

/** The few calls the store needs; node-postgres and PGlite both provide them. */
export interface Sql {
  query: Query;
  transaction<T>(fn: (tx: { query: Query }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: string;
}

export const tableName = (c: Collection) => c.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const rowId = (c: Collection, item: any): string => (c === 'formerStudents' ? item.student.id : item.id);
const rowSchool = (c: Collection, item: any): string | null =>
  (c === 'schools' ? item.id : c === 'formerStudents' ? item.student.schoolId : item.schoolId) ?? null;

/** Opens a database: DATABASE_URL if given, otherwise an embedded PGlite in `dataDir` (or in memory). */
export async function connect(opts: { url?: string; dataDir?: string }): Promise<Sql> {
  if (opts.url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: opts.url, max: 5 });
    pool.on('error', (e) => console.error('[db] idle connection error:', e.message));
    return {
      kind: `postgres (${new URL(opts.url).hostname})`,
      query: (text, params) => pool.query(text, params as any[]) as any,
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (t, p) => client.query(t, p as any[]) as any });
          await client.query('COMMIT');
          return out;
        } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  await db.waitReady;
  return {
    kind: opts.dataDir ? `built-in PostgreSQL in ${opts.dataDir}` : 'built-in PostgreSQL in memory',
    query: (text, params) => db.query(text, params) as any,
    transaction: (fn) => db.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) as any })),
    close: () => db.close(),
  };
}

export async function migrate(sql: { query: Query }) {
  await sql.query(`CREATE TABLE IF NOT EXISTS enticra_meta (key text PRIMARY KEY, value jsonb NOT NULL)`);
  for (const c of COLLECTIONS) {
    const t = tableName(c);
    await sql.query(`CREATE TABLE IF NOT EXISTS ${t} (
      id text PRIMARY KEY,
      school_id text,
      seq integer NOT NULL,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now())`);
    await sql.query(`CREATE INDEX IF NOT EXISTS ${t}_school_idx ON ${t} (school_id)`);
  }
}

type Snapshot = Record<Collection, Map<string, { seq: number; json: string }>>;
const emptySnapshot = () => Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])) as Snapshot;
const snapshotOf = (db: Db) => {
  const s = emptySnapshot();
  for (const c of COLLECTIONS) ((db[c] ?? []) as any[]).forEach((item, seq) => s[c].set(rowId(c, item), { seq, json: JSON.stringify(item) }));
  return s;
};

/** Writes only what differs from `previous`. Returns the new snapshot. */
async function writeChanges(tx: { query: Query }, db: Db, previous: Snapshot): Promise<Snapshot> {
  const next = snapshotOf(db);
  for (const c of COLLECTIONS) {
    const before = previous[c];
    const ids: string[] = []; const schools: (string | null)[] = []; const seqs: number[] = []; const datas: string[] = [];
    ((db[c] ?? []) as any[]).forEach((item) => {
      const id = rowId(c, item);
      const now = next[c].get(id)!;
      const old = before.get(id);
      if (old && old.json === now.json && old.seq === now.seq) return;
      ids.push(id); schools.push(rowSchool(c, item)); seqs.push(now.seq); datas.push(now.json);
    });
    const gone = [...before.keys()].filter((id) => !next[c].has(id));
    const t = tableName(c);
    if (gone.length) await tx.query(`DELETE FROM ${t} WHERE id = ANY($1::text[])`, [gone]);
    for (let i = 0; i < ids.length; i += 500) {
      await tx.query(
        `INSERT INTO ${t} (id, school_id, seq, data, updated_at)
         SELECT id, school_id, seq, data::jsonb, now() FROM unnest($1::text[], $2::text[], $3::int[], $4::text[]) AS r(id, school_id, seq, data)
         ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id, seq = EXCLUDED.seq, data = EXCLUDED.data, updated_at = now()`,
        [ids.slice(i, i + 500), schools.slice(i, i + 500), seqs.slice(i, i + 500), datas.slice(i, i + 500)],
      );
    }
  }
  await tx.query(`INSERT INTO enticra_meta (key, value) VALUES ('meta', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(db.meta)]);
  return next;
}

async function readAll(sql: { query: Query }): Promise<Db | null> {
  const meta = await sql.query<{ value: string }>(`SELECT value::text AS value FROM enticra_meta WHERE key = 'meta'`);
  if (!meta.rows.length) return null;
  const db = { meta: JSON.parse(meta.rows[0].value) } as Db;
  for (const c of COLLECTIONS) {
    const res = await sql.query<{ data: string }>(`SELECT data::text AS data FROM ${tableName(c)} ORDER BY seq, id`);
    (db as any)[c] = res.rows.map((r) => JSON.parse(r.data));
  }
  return db;
}

export interface Store {
  db: Db;
  /** Call after any change; the changes are written shortly after. */
  save(): void;
  /** Writes any pending changes now. */
  flush(): Promise<void>;
  /** Replaces everything with fresh sample data. */
  reset(): Promise<void>;
  close(): Promise<void>;
  /** True when this start loaded the sample data into an empty database. */
  seeded: boolean;
  kind: string;
}

export async function openStore(sql: Sql, opts: { delayMs?: number; log?: (msg: string) => void } = {}): Promise<Store> {
  const delay = opts.delayMs ?? 250;
  const log = opts.log ?? ((m: string) => console.log(`[db] ${m}`));
  await migrate(sql);

  let db = await readAll(sql);
  let snapshot: Snapshot;
  let seeded = false;
  if (db) {
    snapshot = snapshotOf(db);
    if (db.meta?.seedVersion !== SEED_VERSION) log(`your saved data was started from sample data version ${db.meta?.seedVersion}; the app now ships version ${SEED_VERSION}. Your data is kept. Run "npm run db:reset" if you want the new sample data instead.`);
  } else {
    const fresh = createSeed();
    snapshot = await sql.transaction((tx) => writeChanges(tx, fresh, emptySnapshot()));
    db = fresh;
    seeded = true;
    log('the database was empty, so the sample data was loaded');
  }
  const live = db;

  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let dirty = false;
  let failures = 0;

  const writeOnce = async () => {
    dirty = false;
    try {
      snapshot = await sql.transaction((tx) => writeChanges(tx, live, snapshot));
      if (failures) log('saving works again');
      failures = 0;
    } catch (e: any) {
      dirty = true;
      failures++;
      console.error(`[db] save failed (attempt ${failures}), will retry: ${e?.message ?? e}`);
    }
  };
  const schedule = (ms: number) => { if (!timer) timer = setTimeout(() => { timer = null; void pump(); }, ms); };
  const pump = (): Promise<void> => {
    if (running) return running;
    running = (async () => { do await writeOnce(); while (dirty && failures === 0); })().finally(() => {
      running = null;
      if (dirty) schedule(Math.min(30_000, 1000 * 2 ** failures));
    });
    return running;
  };

  const store: Store = {
    db: live,
    seeded,
    kind: sql.kind,
    save() { dirty = true; schedule(delay); },
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (running) await running;
      if (dirty) await pump();
      if (dirty) throw new Error('could not save to the database');
    },
    async reset() {
      await store.flush();
      const fresh = createSeed();
      for (const k of Object.keys(live) as (keyof Db)[]) delete (live as any)[k];
      Object.assign(live, fresh);
      dirty = true;
      await store.flush();
    },
    async close() { try { await store.flush(); } finally { await sql.close(); } },
  };
  return store;
}

/** Opens the store from environment settings (DATABASE_URL, else built-in PostgreSQL in dataDir/pgdata). */
export async function openStoreFromEnv(env: NodeJS.ProcessEnv, dataDir: string) {
  const url = env.DATABASE_URL?.trim() || undefined;
  const sql = await connect(url ? { url } : { dataDir: `${dataDir.replace(/[\\/]+$/, '')}/pgdata` });
  return openStore(sql);
}
