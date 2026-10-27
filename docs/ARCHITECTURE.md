# Architecture decision log

Technical decisions only; what the app does is in `README.md`, the schema in
`docs/DATA_MODEL.md`, working conventions in `CLAUDE.md`. New code follows these.
To change one, change the code and this entry together.

Each entry: **Decision** — what we chose. **Implications** — what that costs or constrains.

## 1. Stateless JWT auth
**Decision:** Bearer JWTs, verified per request (`middleware/auth.ts`: `optionalAuth` attaches the user, `requireAuth` rejects). No session table.
**Implications:** No server-side revocation; a token lives until it expires (`JWT_EXPIRES_IN`). Deleting a user only takes effect once their token expires or fails a user lookup.

## 2. Same-origin API behind nginx
**Decision:** nginx serves the built SPA and proxies `/api` to the backend; Vite does the same in dev.
**Implications:** The frontend never knows the backend host and CORS is a dev-only concern. `BACKEND_HOST` is the only runtime wiring.

## 3. Time-dependent state is computed on read
**Decision:** Gameday status is derived at read time (`utils/gamedayStatus.ts`: `OPEN` + date passed = `CLOSED`), never flipped by a job.
**Implications:** No cron/worker, no drift from "now". Every place that surfaces or checks status must use `effectiveGamedayStatus()`; filtering on the raw column is wrong.

## 4. Side effects: awaited vs fire-and-forget is a per-call choice
**Decision:** Push notifications are fire-and-forget (network round-trip per subscriber, must not delay the response). Local DB writes such as `recordAccessEvent` are awaited.
**Implications:** Fire-and-forget work must catch and log its own errors. Tests must await it, or it outlives the test and hits a closed pool. Awaiting the metrics insert also removed a deadlock between `TRUNCATE` and an in-flight FK insert.

## 5. Per-gameday stats are precomputed
**Decision:** `player_gameday_stats` stores points/goal-diff when a result is entered; standings and hall of fame read it.
**Implications:** Cheap reads. A scoring-rule change (`utils/scoring.ts`) needs a backfill.

## 6. Third-party data is refreshed lazily on read
**Decision:** Weather (`services/weatherService.ts`) has no job: `planWeatherRefresh()` decides from the stored snapshot whether it is stale. The detail route awaits a refresh with a 3s timeout; creation and list reads are fire-and-forget; the list never depends on the provider.
**Implications:** Provider outages never fail or slow list endpoints. Failures are swallowed with a 5-minute per-gameday backoff and the old snapshot stays. `OBSERVED` rows are final.

## 7. Usage metrics: own table, written by the app, read only externally
**Decision:** `access_events` is written by the app and queried by Metabase through a read-only role (`backend/scripts/setup-metabase-role.sql`).
**Implications:** No analytics API in the product. External tools never get the app's credentials. Schema changes to `access_events` can break dashboards.

## 8. Public writes are authorized by unguessable tokens, never ids
**Decision:** Unauthenticated actions (share link, invite, guest cancel, password reset) require a 256-bit random token (`utils/inviteToken.ts`, `utils/passwordResetToken.ts`). Ids are sequential and often public.
**Implications:** A token is returned once, in the response to the action that creates it, and never by a read endpoint.

## 9. Login throttling is keyed by account, not IP
**Decision:** `middleware/loginRateLimit.ts` limits by submitted name/email. The proxy hop count differs per environment, so `trust proxy` and IP limits can't be right everywhere.
**Implications:** Protects against guessing one account, not spraying many accounts from one IP. Disabled under `NODE_ENV=test` (in-memory store persists across a file's logins).

## 10. Logic lives in services and utils; tests hit a real Postgres
**Decision:** Non-trivial logic is extracted from route handlers into `services/` and `utils/`. DB and route tests run against a separate `vienna_thirstday_test` database with real migrations, truncated between tests, no mocked ORM.
**Implications:** Test files run serially (`fileParallelism: false`). Tests need a Postgres with free disk.

## 11. No concurrent queries on a transaction
**Decision:** Queries on a `tx` run sequentially, never in `Promise.all`.
**Implications:** A transaction is one connection; concurrent queries are deprecated in pg and will throw in pg@9. Slightly slower merge/read paths.

## 12. SQL migrations are checked in and applied before the app starts
**Decision:** Drizzle generates plain SQL (`backend/drizzle/`). Compose applies it on backend start; the cluster runs `npm run db:migrate` in an initContainer.
**Implications:** Migrations must be safe to rerun and compatible with the previous app version during rollout. Generated SQL gets reviewed before commit.

## 13. CI gates and publishes images; deploys live elsewhere
**Decision:** GitHub Actions runs backend tests, frontend tests and both builds on every PR; images are built only if they pass and pushed to GHCR from `main` only. Cluster manifests are managed by Flux in a separate repo.
**Implications:** An app change never needs a manifest change here. Required config (env vars, migrations, seed) is documented in the README for whoever deploys.

## 14. Containers run non-root; local compose is the exception
**Decision:** Every cluster workload runs under the `restricted` Pod Security Standard (non-root, dropped capabilities; nginx-unprivileged on 8080). Local compose Postgres and Metabase are deliberately not hardened because the entrypoint needs to `chown` its data dir.
**Implications:** Images must not assume root or privileged ports. Secrets live outside this repo and are never committed or printed.
