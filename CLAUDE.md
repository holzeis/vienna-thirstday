# Vienna Thirstday Kicken — working conventions

Web app (installable PWA) for a weekly Thursday pickup football group: invite-only
accounts, guest players, matchday sign-up with an auto-managed waitlist, teams and
results, season standings, hall of fame, weather and web push. These are the
standing conventions for this repo — follow them without being asked each time.

## Stack and layout

- **Backend** (`backend/`): Node 24 + TypeScript + Express 5, JWT auth, Drizzle ORM
  on Postgres 16. `routes/` (HTTP, one file per resource), `services/` (business
  logic that must be unit-testable), `utils/` (pure logic), `db/` (schema, seeds),
  `drizzle/` (checked-in SQL migrations), `test/` (integration-test harness).
- **Frontend** (`frontend/`): Vite + React 19 + TypeScript SPA, React Router, plain
  CSS, PWA service worker in `src/sw.ts`. Talks to the backend only through `/api`
  (Vite proxy in dev, nginx in the image).
- **Infra**: `docker-compose.yml` runs `postgres`, `backend`, `frontend` (nginx) and
  an optional local-only `metabase`. Cluster deployment lives in a separate Flux
  repo — this repo only builds and publishes images (GHCR) via
  `.github/workflows/docker-publish.yml`.
- **Docs**: `README.md` (overview, setup, config), `docs/ARCHITECTURE.md` (structure,
  decisions, patterns — read before deviating), `docs/DATA_MODEL.md` (schema).

Ports on this machine: compose Postgres `localhost:5433`, frontend `localhost:8081`,
backend `localhost:4000` (dev), Vite `localhost:5173`, Metabase `localhost:3000`.
A kubectl port-forward to the live DB for Metabase uses `5434`, never `5433`.

## Commands

```bash
# backend/
npm run dev | build | test          # ts-node-dev / tsc / vitest run
npm run db:generate | db:migrate    # create / apply migrations
npm run seed | seed:sample          # first admin / sample data

# frontend/
npm run dev | build | test | lint   # build = tsc -b && vite build; lint = oxlint
```

Postgres is reachable on `localhost:5433`, so one-off scripts (`seed:sample`,
migrations, ...) run straight from `backend/` against the running container.

## Developing a new feature

1. Create a feature branch (see Git below), then make the change (backend and/or frontend).
2. `cd backend && npm run build && npm test` — both must pass.
3. `cd frontend && npm run build && npm test && npx oxlint` — all must pass
   (`tsc` catches type errors; `npm test` runs the Vitest suite; oxlint must
   stay at zero warnings).
4. Add or update tests for any new/changed logic (see Testing below) — do this as
   part of the change, not as a follow-up.
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
9. Once the feature (and all its commits) is complete, push the feature branch
   and open a pull request against `main` — no need to wait to be asked. Never
   push to `main` directly; merging is the user's call (see Git below).

Every change, however small (docs, CI, dependency bumps included), starts on its
own feature branch cut from an up-to-date `main` — create it before the first edit.

## Testing

Write unit and integration tests wherever the change involves logic worth
protecting from regressions — the split below is which kind fits which code.
CI (`docker-publish.yml`) runs both suites plus both builds on every PR and push;
images are only built if that passes, and only `main` pushes them.

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
- Frontend uses Vitest + Testing Library on jsdom: `cd frontend && npm test`.
  Config in `frontend/vitest.config.ts` (deliberately separate from
  `vite.config.ts` so the PWA plugin doesn't run), shared setup in
  `frontend/src/test/setup.ts`. Tests sit next to their source file
  (`*.test.ts(x)`; see `api/client.test.ts`, `auth/RequireAuth.test.tsx`).
  Add or update tests for new/changed frontend logic and components, same
  standing rule as the backend. Mock `fetch`/`useAuth` rather than hitting a
  server; there are no E2E tests.
- Manual curl against the Docker deployment is still useful as a *final
  sanity check* that the built/deployed artifact actually works end-to-end
  (see step 7 above), but never in place of the test file.

### Test gotchas (all of these have bitten this repo)

- **Time and timezones.** The league runs on `Europe/Vienna`, which changes UTC
  offset at DST. Never hardcode a UTC hour that only maps to a local hour in
  summer (the weather share-link test broke when the clocks changed). Frontend
  format helpers use the viewer's timezone — build test dates from local
  components, not UTC literals.
- **Fire-and-forget side effects** (push notifications, see ARCHITECTURE decision
  #4) outlive the HTTP response. A test that ends before the background work does
  lets `afterAll` close the pool under it ("Cannot use a pool after calling end").
  Await the work (see the last test in `backend/src/test/push.test.ts`).
- **No concurrent queries on a transaction.** A `tx` is one connection: never
  `Promise.all` queries on it (pg deprecates it and throws in pg@9). Run them
  sequentially. This applies to production code, not just tests.
- **A full local suite needs a Postgres with free disk.** If many tests fail with
  Postgres error `53100` ("Check free disk space"), the Docker VM disk is full —
  tell the user instead of pruning Docker yourself.

## Dependencies and tooling

- All npm installs use `--legacy-peer-deps` (the Dockerfiles and CI do too). That
  flag **skips peer dependencies**, so anything a package needs as a peer must be
  declared explicitly: `vite` for the backend's Vitest, `@testing-library/dom` for
  `@testing-library/react`. A missing one shows up as `ERR_MODULE_NOT_FOUND`.
- `react` and `react-dom` must always be the exact same version (React throws at
  startup otherwise); Renovate groups them, and manual bumps must change both.
- macOS is case-insensitive: don't create two files that differ only by case
  (`AuthContext.tsx` vs `authContext.ts` collided). Context/hook modules live next
  to their provider as `context.ts` / `useX.ts` so provider files only export
  components (React fast refresh, enforced by oxlint).
- React lint rules are enforced: derive state instead of `setState` inside effects,
  no `Date.now()`/ref writes during render (use `hooks/useNow.ts`,
  `hooks/usePolling.ts`).

## Documentation

- Document the code itself: give exported functions, routes, and non-obvious
  logic a comment explaining *why* — the rationale, invariant, or gotcha —
  not what the code already says. See `backend/src/services/accessEventService.ts`
  or `backend/src/db/schema.ts` for the level of detail expected. Write it as
  part of the change, not a follow-up.
- Keep `README.md` current whenever a change affects anything it documents —
  setup, environment variables, deployment, Metabase. It is deliberately short
  (overview, architecture, running locally, configuration, deploying, Metabase);
  don't grow it back into a feature list.
- Architecture and the data model are documented separately from the README,
  in `docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md`. Keep both current when a
  change affects them — a new table or relationship updates the data model doc; a
  new service boundary, background job, or infra component updates the
  architecture doc. `docs/ARCHITECTURE.md` also records key architectural
  decisions (what was chosen and why) and recurring design patterns used across
  the codebase (e.g. status computed on read instead of a cron job, awaited-vs-
  fire-and-forget side effects) so new code follows established patterns instead
  of reinventing them — and existing code should keep adhering to what's
  documented there, so check it before deviating.

## Security

- Never read or print secret values — don't `cat`/echo a `.env` file's
  contents, decode a Kubernetes `Secret`'s data, or otherwise surface a
  credential into the conversation, logs, or a committed file. When a
  command needs one, use it without echoing the value, or have the user
  supply it or run that step themselves.
- Never `kubectl`/curl the live production cluster on your own; ask the user or
  use the local docker stack instead.

## Git

- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
  `type(scope): summary` — `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `ci`
  as appropriate.
- One commit per logical change. When a turn produces several logically-separate
  changes (e.g. a UI restyle + a backend data fix + a seed-script change), split
  them into separate commits rather than bundling everything together, as long as
  the files involved aren't too entangled to separate cleanly.
- **Every change goes through its own pull request from a dedicated feature
  branch; never commit to or push `main` directly.** Branch from an up-to-date
  `main` (`git switch main && git pull --rebase origin main && git switch -c
  <type>/<short-slug>`), named after the Conventional Commit type
  (`feat/waitlist-banner`, `fix/dst-weather-test`, `docs/readme-trim`). One branch
  and one PR per logical change; unrelated changes get separate branches, not one
  catch-all PR. If the working tree is on `main` with uncommitted changes, move
  them onto a new branch first (`git switch -c`), don't commit them to `main`.
- Open the PR with `gh pr create --base main` (title = the Conventional Commit
  summary; body = what changed and why, how it was verified, ending with the PR
  attribution line from the session's system reminder). If `gh` isn't installed or
  authenticated, push the branch and give the user the compare URL instead. Do not
  merge the PR yourself — CI (tests + builds) must be green and the user merges.
  Fix review/CI feedback with further commits on the same branch.
- Stage files by name, not `git add -A`: the working tree may hold the user's own
  uncommitted edits, which must not ride along in an unrelated commit.
- Commit as each discrete piece of work is built, tested, and verified — don't
  wait until the end of a long session to commit everything at once.
- Every commit ends with the attribution footer currently in effect for the
  session (`Co-Authored-By:` / `Claude-Session:` lines) — check the active
  session's system reminder for the exact current text rather than reusing an
  older one, since the session URL changes between sessions.
- Never commit `backend/dist` or `frontend/dist` (gitignored build output) or
  anything that looks like a secret/credential.
- Images are pushed to GHCR only from `main`; PRs build but never push. `main` also
  receives Renovate PRs, so rebase the feature branch onto `origin/main` before
  pushing if it has moved.
