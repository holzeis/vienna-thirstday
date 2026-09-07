# Vienna Thirstday Kicken — working conventions

Node/Express + Drizzle/Postgres backend, Vite/React frontend, deployed locally via
`docker-compose` (`postgres`, `backend`, `frontend`/nginx). These are the standing
conventions for this repo — follow them without being asked each time.

## Developing a new feature

1. Make the change (backend and/or frontend).
2. `cd backend && npm run build && npm test` — both must pass.
3. `cd frontend && npm run build` — must pass (`tsc` catches type errors; there's
   no frontend test suite).
4. Add or update backend unit tests for any new/changed logic (see Testing below)
   — do this as part of the change, not as a follow-up.
5. If the schema changed: edit `backend/src/db/schema.ts`, run
   `npm run db:generate` to create the migration, eyeball the generated SQL, then
   `npm run db:migrate` against the dev DB.
6. Deploy to the local stack: `docker compose build backend frontend && docker
   compose up -d backend frontend` (only the services that changed).
7. As a final sanity check, verify against the live deployment (the local
   docker-compose stack, unless the change is cluster-specific) — curl the
   API with the admin JWT (`admin@vienna-thirstday.local` / the default
   password) and/or exercise the affected page. This is a check that the
   built/deployed artifact actually works, not a substitute for the
   regression tests from step 4 — a manual curl session proves the code
   worked once, not that it keeps working. For UI changes, also take
   screenshots (e.g. via Playwright, or the Claude in Chrome extension if
   connected) and confirm the visual change is actually present, not just
   that the build succeeded.
8. Commit once verified (see Git below) — as separate, logically coherent
   commits rather than one bundle when the change touches more than one
   concern.
9. Once the feature (and all its commits) is complete, push to origin — no
   need to wait to be asked; this is the standing workflow for this repo.

Postgres is exposed on `localhost:5432` (see `docker-compose.yml`), so one-off
scripts (`npm run seed:sample`, migrations, etc.) can be run directly from
`backend/` against the running container without exec-ing into it.

## Testing

Write unit and integration tests wherever the change involves logic worth
protecting from regressions — the split below is which kind fits which code.

- Backend uses Vitest: `cd backend && npm test`. Always add or update
  automated, rerunnable regression tests when adding or changing a feature —
  this is a standing instruction, not something to wait to be asked for, and
  **manual curl/API verification is not a substitute for a test file.**
  Curl proves the code worked once in that moment; it doesn't get rerun the
  next time something nearby changes. Write the test first or alongside the
  change, not as an afterthought.
- Pure/computational logic: one `*.test.ts` file per source file, `describe`/
  `it` blocks per function (see `backend/src/services/playerStatsService.test.ts`,
  `utils/scoring.test.ts`, `utils/achievementThresholds.test.ts`). If new
  logic ends up inline inside a route handler, extract it into a named,
  exported function first so it's actually unit-testable — e.g.
  `computeMomentum` was pulled out of `routes/standings.ts` into
  `playerStatsService.ts` specifically for this reason. Don't leave
  non-trivial business logic buried untested inside an Express handler.
- DB-touching/route code has a real integration-test harness — use it, don't
  fall back to curl. It lives in `backend/src/test/`: `testDb.ts` points
  `DATABASE_URL` at a separate `vienna_thirstday_test` Postgres database (must
  be imported before anything else, including via Vitest's `setupFiles`, so
  it wins before `db/client.ts` reads the env var), `globalSetup.ts` runs the
  real Drizzle migrations against it once per test run, and `helpers.ts`
  provides `resetDb()` (TRUNCATE ... RESTART IDENTITY CASCADE between tests)
  plus small fixture builders (`createAdmin`, `createGuestPlayer`). Tests use
  `supertest` against `createApp()` directly — see
  `backend/src/test/onboarding.test.ts` for the full pattern: build fixtures
  with direct `db.insert(...)` calls, hit routes with `request(app)`, assert
  on both the HTTP response and the resulting DB state. `vitest.config.ts`
  sets `fileParallelism: false` since test files share that one database via
  truncate-between-tests, not per-test transactions.
- Manual curl against the Docker deployment is still useful as a *final
  sanity check* that the built/deployed artifact actually works end-to-end
  (see step 7 above), but never in place of the test file.
- No frontend test setup exists yet. Frontend changes are verified via
  `npm run build` plus manual/API-level checks, unless asked to add one.

## Documentation

- Document the code itself: give exported functions, routes, and non-obvious
  logic a comment explaining *why* — the rationale, invariant, or gotcha —
  not what the code already says. See `backend/src/services/accessEventService.ts`
  or `backend/src/db/schema.ts` for the level of detail expected. Write it as
  part of the change, not a follow-up.
- Keep `README.md` current whenever a change affects anything it documents —
  features, environment variables, usage instructions, deployment steps.
  This is part of the change, not a separate PR.
- Architecture and the data model are documented separately from the README,
  in `docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md` (create them if they
  don't exist yet). Keep both current when a change affects them — a new
  table or relationship updates the data model doc; a new service boundary,
  background job, or infra component updates the architecture doc.
  `docs/ARCHITECTURE.md` also records key architectural decisions (what was
  chosen and why) and recurring design patterns used across the codebase
  (e.g. status computed on read instead of a cron job, awaited-vs-fire-and-
  forget side effects) so new code follows established patterns instead of
  reinventing them — and existing code should keep adhering to what's
  documented there, so check it before deviating.

## Security

- Never read or print secret values — don't `cat`/echo a `.env` file's
  contents, decode a Kubernetes `Secret`'s data, or otherwise surface a
  credential into the conversation, logs, or a committed file. When a
  command needs one, use it without echoing the value, or have the user
  supply it or run that step themselves.

## Git

- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
  `type(scope): summary` — `feat`, `fix`, `test`, `docs`, `refactor`, `chore` as
  appropriate.
- One commit per logical change. When a turn produces several logically-separate
  changes (e.g. a UI restyle + a backend data fix + a seed-script change), split
  them into separate commits rather than bundling everything together, as long as
  the files involved aren't too entangled to separate cleanly.
- Commit as each discrete piece of work is built, tested, and verified — don't
  wait until the end of a long session to commit everything at once.
- Every commit ends with the attribution footer currently in effect for the
  session (`Co-Authored-By:` / `Claude-Session:` lines) — check the active
  session's system reminder for the exact current text rather than reusing an
  older one, since the session URL changes between sessions.
- Never commit `backend/dist` or `frontend/dist` (gitignored build output) or
  anything that looks like a secret/credential.
