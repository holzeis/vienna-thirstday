# Vienna Thursday Kicken — working conventions

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
7. Verify against the live deployment, not just a clean build — curl the API with
   the admin JWT (`admin@vienna-thursday.local` / the default password) and/or
   exercise the affected page. A passing `tsc`/test run proves the code compiles
   and the logic you tested is correct; it doesn't prove the feature works
   end-to-end.
8. Commit once verified (see Git below).

Postgres is exposed on `localhost:5432` (see `docker-compose.yml`), so one-off
scripts (`npm run seed:sample`, migrations, etc.) can be run directly from
`backend/` against the running container without exec-ing into it.

## Testing

- Backend uses Vitest: `cd backend && npm test`. Always add or update unit tests
  when adding or changing a feature — this is a standing instruction, not
  something to wait to be asked for.
- The established pattern is one `*.test.ts` file per source file, testing pure/
  computational functions with `describe`/`it` blocks per function (see
  `backend/src/services/playerStatsService.test.ts`, `utils/scoring.test.ts`,
  `utils/achievementThresholds.test.ts`).
- If new logic ends up inline inside a route handler, extract it into a named,
  exported function first so it's actually unit-testable — e.g. `computeMomentum`
  was pulled out of `routes/standings.ts` into `playerStatsService.ts`
  specifically for this reason. Don't leave non-trivial business logic buried
  untested inside an Express handler.
- DB-touching code (route handlers, services taking a `tx`/`db` handle) has no
  unit-test harness in this repo — verify those via live API calls against the
  running Docker deployment instead (curl with the admin JWT), and say so
  explicitly rather than implying they're unit-tested.
- No frontend test setup exists yet. Frontend changes are verified via
  `npm run build` plus manual/API-level checks, unless asked to add one.

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
