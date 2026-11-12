import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Portal } from '@enticra/core';
import { connect, openStore, type Sql } from '../src/store';

// Runs against the built-in PostgreSQL (PGlite). Set TEST_DATABASE_URL to also run against a real server.
const targets: [string, () => Promise<{ open: () => Promise<Sql>; done: () => Promise<void> }>][] = [
  ['built-in PostgreSQL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'enticra-db-'));
    return { open: () => connect({ dataDir: dir }), done: async () => rmSync(dir, { recursive: true, force: true }) };
  }],
];
if (process.env.TEST_DATABASE_URL) targets.push(['PostgreSQL server', async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const wipe = async () => { const s = await connect({ url }); await s.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await s.close(); };
  await wipe();
  return { open: () => connect({ url }), done: wipe };
}]);

const quiet = { log: () => {} };

describe.each(targets)('database store (%s)', (_name, target) => {
  it('loads sample data only into an empty database and keeps saved changes across restarts', async () => {
    const t = await target();
    try {
      let store = await openStore(await t.open(), quiet);
      expect(store.seeded).toBe(true);
      const seedCounts = { students: store.db.students.length, marks: store.db.marks.length };
      const firstStudent = store.db.students[0];
      firstStudent.name = 'Renamed In Test';
      store.db.audit.push({ ...store.db.audit[0], id: 'aud_test', action: 'test', detail: 'saved by test' });
      store.save();
      await store.close();

      store = await openStore(await t.open(), quiet);
      expect(store.seeded).toBe(false);
      expect(store.db.students.length).toBe(seedCounts.students);
      expect(store.db.marks.length).toBe(seedCounts.marks);
      expect(store.db.students[0].name).toBe('Renamed In Test');
      expect(store.db.audit.at(-1)!.id).toBe('aud_test');
      await store.close();
    } finally { await t.done(); }
  });

  it('saves changes made through the app automatically, including removals, in order', async () => {
    const t = await target();
    try {
      const sql = await t.open();
      let store = await openStore(sql, { ...quiet, delayMs: 10 });
      const order = store.db.students.map((s) => s.id);
      const portal = new Portal(store.db, { onChange: store.save });
      const advisor = store.db.users.find((u) => u.id === 'u_s1_science')!;
      const removed = 'stu_cls_s1_10a_1';
      portal.removeStudent(advisor, removed, { reason: 'Transfer certificate issued' });
      await new Promise((r) => setTimeout(r, 300)); // no flush: the automatic save must write it
      const rows = await sql.query<{ id: string }>('SELECT id FROM former_students');
      expect(rows.rows.map((r) => r.id)).toEqual([removed]);
      await store.close();

      store = await openStore(await t.open(), quiet);
      expect(store.db.students.map((s) => s.id)).toEqual(order.filter((id) => id !== removed));
      expect(store.db.formerStudents.map((f) => f.student.id)).toEqual([removed]);
      await store.close();
    } finally { await t.done(); }
  });

  it('keeps saved data when the sample data version changes, and reloads it only on reset', async () => {
    const t = await target();
    try {
      let store = await openStore(await t.open(), quiet);
      store.db.meta.seedVersion = -1;
      store.db.students[0].name = 'Keep Me';
      store.save();
      await store.close();

      const logs: string[] = [];
      store = await openStore(await t.open(), { log: (m) => logs.push(m) });
      expect(store.db.students[0].name).toBe('Keep Me');
      expect(logs.join(' ')).toMatch(/db:reset/);
      await store.reset();
      expect(store.db.students[0].name).not.toBe('Keep Me');
      await store.close();

      store = await openStore(await t.open(), quiet);
      expect(store.db.students[0].name).not.toBe('Keep Me');
      expect(store.db.meta.seedVersion).toBeGreaterThan(0);
      await store.close();
    } finally { await t.done(); }
  });
});
