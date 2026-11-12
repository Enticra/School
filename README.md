# Enticra School

An AI school management portal for Tamil Nadu schools: attendance with WhatsApp alerts to parents, homework, tests and marks, AI answer-sheet correction with teacher approval, student 360 profiles, report cards, and per-school branding and rules. Built as the pilot MVP from the AI School Portal Blueprint.

## What's in the MVP

| Area | What works |
|---|---|
| Sign in | Phone number + 6-digit code. Roles: Enticra admin, principal, teacher, parent. Demo code `123456` in dev mode. |
| Attendance | One-tap register per class (Present → Absent → Late), daily or morning/afternoon mode, late cut-off. Saving messages each parent (arrived, absent, late); re-saving only messages parents whose child's status changed. |
| Homework | Post per class and subject, optional photo of the board, WhatsApp preview, parents notified. |
| Tests and marks | Tests with questions, chapters, answer keys and step-mark schemes. Marks entry per question, chapter analysis, publish to parents. |
| AI correction | Scan or upload script pages. The grader awards step marks with a reason, a confidence score and student feedback; low-confidence answers are flagged. Teacher overrides any mark, then approves; only approved marks are written. Agreement with the teacher is tracked. |
| Student profiles | Attendance calendar, marks trend per subject, weakest and strongest chapters, answer-wise feedback, activities, interests, teacher observations, at-risk flags. |
| Report cards | School letterhead, crest, grading scale, rank, attendance, auto remarks; send a whole class to parents on WhatsApp. |
| Parent view | Today's status, homework due, latest marks, report card, WhatsApp history. |
| Multi-school | Each school is a tenant: name, colours, crest/logo, motto, letterhead, board, exam types, grading scale, pass mark, marking policy (board-strict or school), AI review threshold, attendance mode, message language (English/Tamil), quiet hours, which messages go out, and which modules are on. Settings are validated and versioned; changes go to an audit log. Enticra admins create new schools. |
| Messages | English and Tamil templates, quiet hours (held until morning), consent check (no consent, no message), delivery status log. |

Sample data: two fictional schools (Sri Vidya Matric, a Matriculation school; Little Flower, a CBSE school with Tamil-first messages, two-session attendance and AI correction switched off), 40 students, a month of attendance, two rounds of tests, and 11 scanned Maths revision scripts waiting for AI correction.

## Run it

```bash
npm install
npm run dev            # API on :8787 and web on :5173 (open http://localhost:5173)
npm test               # unit and API tests
node qa/showcase.mjs   # walks every screen of every role (after build:demo)
npm run build:demo     # one-file demo that runs in the browser with no server: apps/web/dist-demo/index.html
npm run e2e            # Playwright walk-through of every role, with screenshots in qa/shots
npm start              # production-style: builds the web app and serves it from the API
npm run db:reset -- --yes   # throw away saved changes and load the sample data again (stop the server first)
```

Environment variables (see `.env.example`):

- `ANTHROPIC_API_KEY`: turns on real AI correction with Claude vision. Without it the keyword grader is used, which only marks the typed sample scripts and cannot read any uploaded photo (the AI correction screen shows a warning).
- `GRADER_MODEL`: defaults to `claude-sonnet-5-5`, as in the blueprint.
- `DATABASE_URL`: the PostgreSQL database (Neon, Supabase, or local). Empty means the built-in PostgreSQL in `DATA_DIR/pgdata`. See [docs/database.md](docs/database.md).
- `PORT`, `DATA_DIR`: server port, and where the built-in database and WhatsApp outbox log live.
- `NODE_ENV=production`: turns off the demo code and sample-account list.
- `WHATSAPP_*`: real WhatsApp messages to phones you link, for pitch demos. See [docs/whatsapp-live-demo.md](docs/whatsapp-live-demo.md).

### Uploading answer scripts

Teachers can upload any phone photo, not just scans. `apps/api/src/pages.ts` cleans every page before it is stored and sent to Claude:

- JPEG, PNG, WebP, AVIF, TIFF, GIF and BMP photos, plus iPhone HEIC/HEIF photos (converted on the server, since Chrome and Windows can't open them).
- PDFs from scanner apps such as Adobe Scan or Google Drive are split into one image per page (up to 12 pages a script).
- Sideways photos are turned upright from the camera's orientation tag, and the teacher can turn any page by hand before uploading.
- Dim or grey photos are brightened so the paper is near white and the ink stays dark.
- Every page is stored as a JPEG of at most 2000 px on its long edge, enough for small handwriting.

Claude also reports any page it could not read well (blurred, too dark, cut off). Those pages show as "Re-take page N" on the script list and as a note on the review screen, and blank answers on such a script are flagged for the teacher.

## How it's built

```
packages/core   Domain model, permissions, attendance/homework/exam/grading/report logic, templates, sample data.
                One Portal class; every method takes the signed-in user and checks role and school first.
apps/api        Express server: phone OTP sessions, POST /api/rpc/:method (allow-listed), Claude grader,
                WhatsApp outbox, PostgreSQL storage (store.ts), serves the built web app.
apps/web        React + Vite portal. The same UI runs against the API, or fully in the browser (demo build)
                by running packages/core locally with localStorage.
qa/e2e.mjs      End-to-end checks: sign-in, AI correction review and approval, attendance, homework, test
                creation and publishing, settings and branding, module switches, admin, phone width, dark theme.
brand/          Enticra logo SVGs and tokens from the Enticra knowledge pack.
```

Tenant isolation is enforced in one place (`Portal.school()`, `classFor()`, `studentFor()`): staff can only reach their own school, teachers only their classes, parents only their children. Tests cover this over HTTP too.

## What's stubbed, and the next steps

1. **WhatsApp sending is simulated.** Messages are rendered, consent- and quiet-hour-checked and logged (`data/outbox.log`), but not sent. Next: WhatsApp Cloud API with each school's approved templates, delivery webhooks, and OTP delivery through the authentication template.
2. **Storage is PostgreSQL** (one table per collection, rows tagged with `school_id`, changes saved automatically; see [docs/database.md](docs/database.md)). Next: row-level security on `school_id` as in the blueprint, and daily backups.
3. **Demo grader.** The in-browser demo uses a keyword grader on typed transcripts of the sample scripts, so it cannot read uploaded photos. The server uses Claude vision when `ANTHROPIC_API_KEY` is set. Before trusting AI marks in a pilot, build the 1,000-script agreement test set described in the blueprint.
4. **Not yet built:** Excel/EMIS student import, QR cover sheets for scans, Android teacher app with offline attendance, PDF export of report cards (print works in the server build), parent leave replies on WhatsApp, the 11th-group guidance report.
