# Enticra School: deploy rules for Claude

Claude reads this file at the start of every session in this repo.

## Project settings

| Setting | Value |
|---|---|
| Live branch (every push here goes live) | `main` |
| Web app | **Vercel**, from `vercel.json` (static build of `apps/web`) |
| API | **Render**, from `render.yaml` (service `enticra-school-api`, Singapore, free plan) |
| Database | PostgreSQL via `DATABASE_URL` on Render (Neon, see `docs/database.md`) |
| Node version | 22 |
| Install command | `npm ci` |
| Test / check command | `npm test && npm run typecheck` |
| Web build command | `npm run build -w @enticra/web` → `apps/web/dist` |
| API start command | `npm start -w @enticra/api` |
| Live URL (web) | Vercel project URL: fill in once created |
| API URL | `https://enticra-school-api.onrender.com` (health: `/api/health`) |

This is an npm-workspaces monorepo (`packages/core`, `apps/api`, `apps/web`). There is
no root `build` script; use the commands above.

**How the two halves connect:** the browser only talks to the Vercel domain.
`vercel.json` rewrites `/api/*` to the Render service, so the web code keeps calling
relative `/api/...` paths and there is no CORS. If the Render service URL ever changes,
update the rewrite destination in `vercel.json` in the same commit.

## How a push deploys

- **Vercel** builds and deploys every push to `main` (preview deploys for other branches).
- **Render** deploys `main` after the `CI` workflow (`.github/workflows/ci.yml`) passes
  (`autoDeployTrigger: checksPass`). A red CI run means the API stays on the old version.
- Changing `render.yaml` only takes effect after a Blueprint sync in the Render dashboard.

## Standing permission

The owner gives Claude **standing permission** to:

1. Commit changes directly to `main`.
2. Push to `main`, which deploys to production.
3. Re-run a failed deploy, and roll back a broken deploy (see *Rollback*).

Claude does not need a pull request or review as long as every check in
*Before every push* passes. When the owner asks for a change, that request is the
approval to ship it live. Everything under *Still ask the owner first* is excluded.

## Workflow for every change

1. **Sync:** `git fetch origin main && git checkout main && git pull --ff-only`
2. **Make the change.** Keep it to what was asked.
3. **Run the checks** below. Never skip, delete or disable a test to make it pass.
4. **Commit** with a short, plain message saying what changed and why.
5. **Push:** `git push -u origin main`. On a network failure retry up to 4 times
   (2s, 4s, 8s, 16s). If the remote moved, `git pull --rebase`, re-run the checks,
   push again. Never force-push.
6. **Watch:** `gh run list --branch main --limit 1` then `gh run watch <id> --exit-status`
   for CI; commit statuses for Vercel and Render:
   `gh api repos/Enticra/School/commits/<sha>/status` and `.../check-runs`.
7. **Verify live:** the Vercel URL loads, and `<vercel-url>/api/health` returns
   `{"ok":true,...}` (the free Render plan sleeps, so the first call can take ~1 minute).
   If Claude's network can't reach them, say so and rely on the deploy statuses.
8. **Report** to the owner: what changed, that it is live, and the commit link.

## Before every push (all must pass)

- [ ] `npm ci`, `npm test`, `npm run typecheck` and `npm run build -w @enticra/web` pass.
- [ ] `git diff` holds only the intended change: no `node_modules`, `dist`, `dist-demo`,
      `apps/api/data/`, `.env`.
- [ ] **No secrets:** `git diff --cached | grep -nEi '(api[_-]?key|secret|token|password|BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?://[^@ ]+@)'`
      Names with empty values in `.env.example` are fine; real values are not.
- [ ] A new third-party script, font or domain is added to the CSP in **both**
      `vercel.json` and `apps/api/src/app.ts`.

If a check fails and can't be fixed, do not push. Tell the owner what failed.

## Still ask the owner first

- Deleting pages, data or files in bulk; `npm run db:reset` against the live database.
- Changing domains, DNS, `vercel.json` rewrites to a different host, or Render/Vercel
  plans and settings.
- **Sign-in and permissions:** `apps/api/src/auth.ts`, the OTP flow, `DEMO_LOGIN`, and the
  tenant checks in `packages/core` (`Portal.school()`, `classFor()`, `studentFor()`).
- **Anything that sends real WhatsApp messages to parents** (`apps/api/src/whatsapp.ts`,
  the `WHATSAPP_*` settings), and consent or quiet-hours logic.
- How AI marks are approved (only teacher-approved marks may be written).
- Database schema or data-shape changes that rewrite existing school data.
- Adding or rotating secrets, or changing who has access.
- Force-pushing, rewriting history, or deleting branches.

## Secrets

- Set only in the Render dashboard (Environment): `DATABASE_URL`, `ANTHROPIC_API_KEY`,
  `WHATSAPP_*`. They are `sync: false` in `render.yaml` and never committed.
- Vercel needs no secrets: the web build has none.
- Claude never prints a secret value in logs or replies.
- Student and parent data is children's personal data. Never paste real records into
  chat, commits, test fixtures or logs.
- `DEMO_LOGIN=1` lets anyone sign in with code `123456` and lists the accounts on the
  login page. Acceptable on sample data only; it must be off before any real school data.

## Rollback

1. `git log --oneline -5` to find the bad commit.
2. `git revert <bad-sha> --no-edit` (never rewrite history), run the checks, push.
3. Faster for the web: Vercel → Deployments → last good one → **Promote to Production**.
   For the API: Render → the service → Events → **Rollback** on the last good deploy.
   Then still revert in git so the next push doesn't bring the bug back.
4. Tell the owner what broke, that it is rolled back, and what the fix will be.
