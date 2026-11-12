# Enticra School database

Enticra School keeps all its data in PostgreSQL. Every change made in the app (attendance, marks, homework, settings, students leaving, messages) is saved to the database automatically about a quarter of a second after it happens. Nothing needs a Save button and nothing is lost when the server restarts.

## Sample data

The first time the app starts against an empty database, it loads the sample data: two schools, 120 students, a month of attendance, tests and marks, and the scripts waiting for AI correction.

After that, the sample data is never loaded again on its own. Restarting the server or updating the app keeps everything you changed. To start over with fresh sample data, stop the server and run:

```bash
npm run db:reset -- --yes
```

## Where the database lives

Set `DATABASE_URL` in the `.env` file in the project folder (copy `.env.example` to `.env` first).

### Neon (free, recommended)

1. Sign up at https://neon.tech and create a project. Pick the Singapore (ap-southeast-1) region, which is closest to Tamil Nadu.
2. On the project dashboard, click **Connect** and copy the connection string. It looks like `postgresql://neondb_owner:...@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
3. Paste it into `.env`:

   ```
   DATABASE_URL=postgresql://neondb_owner:...@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Run `npm run dev`. The first start creates the tables and loads the sample data. You can see the tables and rows in Neon's **Tables** page.

### Supabase (free)

Create a project at https://supabase.com, open **Connect**, copy the **Session pooler** connection string, put your database password into it, and paste it into `.env` as `DATABASE_URL`. Free Supabase projects pause after a week without use; open the dashboard to wake one up.

### PostgreSQL on your own PC

Install PostgreSQL for Windows from https://www.postgresql.org/download/windows/, create a database called `enticra` in pgAdmin, and set:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/enticra
```

### Nothing set: built-in PostgreSQL

If `DATABASE_URL` is empty, the app uses a built-in PostgreSQL (PGlite) that runs inside the server and keeps its files in `apps/api/data/pgdata`. It needs nothing installed and is fine for trying the app on one computer. Only one server can use it at a time, and the data stays on that computer, so use Neon or another real server once schools are using it.

## Tables

Each kind of record has its own table: `schools`, `users`, `classes`, `students`, `attendance`, `homework`, `submissions`, `former_students`, `report_archive`, `halls`, `exam_plans`, `timetable_edits`, `staff_attendance`, `staff_leave`, `exams`, `marks`, `scripts`, `messages`, `audit`, plus `enticra_meta`.

Every table has the same columns:

| Column | What it holds |
|---|---|
| `id` | The record's id, for example `stu_cls_s1_10a_1` |
| `school_id` | The school it belongs to, so each school's data can be filtered, exported or secured separately |
| `seq` | Its position in the list, so lists come back in the same order |
| `data` | The full record as JSON (`jsonb`) |
| `updated_at` | When it was last saved |

For example, to count students per school in Neon's SQL editor:

```sql
select school_id, count(*) from students group by school_id;
```

## How saving works

The server loads all data into memory when it starts and works on it there, as before. When anything changes, it waits 250 ms, compares each record with what is already in the database, and writes only the added, changed and removed rows in one transaction. If the database cannot be reached, the server keeps the changes in memory and retries with a growing delay (up to every 30 seconds) until the write succeeds. On a normal stop (Ctrl+C) it writes anything pending before exiting.

Run only one server against a database at a time, because each server holds its own copy in memory.

## Still to do

- Row-level security on `school_id`, as described in the blueprint, once the app connects with a separate database role per request.
- Daily backups. Neon can restore to an earlier point in time within a short window on its free plan; for real backups, schedule `pg_dump`.
- The WhatsApp outbox log and linked WhatsApp numbers are still files in `DATA_DIR`.
