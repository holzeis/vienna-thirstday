# Architecture

This document covers system structure, deployment topology, and the
recurring decisions/patterns that new code should follow. For feature-level
docs (what the app does, environment variables, running it locally) see
`README.md`; for the schema, see `docs/DATA_MODEL.md`; for day-to-day
working conventions, see `CLAUDE.md`.

## System overview

- **Backend**: Node/Express + Drizzle ORM + Postgres. Stateless JWT auth
  (`backend/src/middleware/auth.ts`) — no server-side session table; a
  bearer token is verified per request via `optionalAuth` (attaches
  `req.user` if present, never rejects) or `requireAuth` (rejects if
  missing/invalid).
- **Frontend**: Vite + React + TypeScript SPA, installable as a PWA (service
  worker in `frontend/src/sw.ts` handles offline caching and Web Push).
- **Web server**: nginx serves the built frontend and reverse-proxies `/api`
  to the backend same-origin — the browser never talks to the backend on a
  different host/port.
- **Database**: a single Postgres database (`vienna_thirstday`). Schema and
  migrations live in `backend/src/db/schema.ts` / `backend/drizzle/`.

## Components

| Path | Role |
| --- | --- |
| `backend/src/app.ts` | Express app assembly — mounts every router |
| `backend/src/routes/*` | One file per resource area: `auth`, `gamedays`, `gamedayShare` (public, token-based, no login), `players`, `standings`, `hallOfFame`, `push`, `invites`/`adminInvites`, `adminUsers`, `adminPlayers`, `guests` |
| `backend/src/services/*` | Business logic factored out of route handlers so it's unit-testable: `playerStatsService`, `registrationService`, `pushService`, `playerMergeService`, `accessEventService` |
| `backend/src/utils/*` | Pure/computational logic, one test file per module: `scoring`, `waitlist`, `matchday`, `timezone`, `gamedayStatus`, `achievementThresholds`, `userAgent` |
| `backend/src/db/` | Drizzle schema, migrations, seed scripts |
| `frontend/src/api/` | Typed HTTP client — `client.ts` wraps `fetch` (auth header, `X-Standalone` header, offline detection), `endpoints.ts` is the typed call surface |
| `frontend/src/auth/AuthContext.tsx` | Holds the JWT, calls `GET /auth/me` once on app load to hydrate the session |
| `frontend/src/pages/`, `components/` | UI |

## Deployment topology

### Local (docker-compose)

`postgres` → `backend` (runs pending migrations on start, then serves the
API) → `frontend` (nginx, proxies `/api`). `metabase` is optional and
local-only — see README's "Usage metrics" section.

### Cluster (k3s homelab, namespace `vienna-thirstday`)

- **postgres** — `StatefulSet` + Longhorn-backed PVC.
- **backend** — `Deployment`; a `migrate` initContainer applies any pending
  schema migration before the app container starts (safe no-op otherwise).
- **frontend** — `Deployment` on `nginxinc/nginx-unprivileged`.
- **cloudflared** — `Deployment` holding an outbound-only connection to
  Cloudflare's edge, so nothing needs an open inbound port; Cloudflare
  proxies the public hostname through the tunnel to ingress-nginx.
- **ingress** (ingress-nginx) — routes by Host header; the public hostname
  (`vienna-thirstday.holzeis.me`) gets a real Let's Encrypt cert via the
  `letsencrypt-dns01` `ClusterIssuer` (DNS-01, so no inbound port needs to be
  open for issuance either); a `.local` hostname stays plain HTTP for LAN
  access.
- **image-watcher** — `CronJob`, every 5 minutes: polls GHCR for the
  `backend`/`frontend` image digests and `kubectl rollout restart`s the
  matching `Deployment` when one changes. This is what actually deploys a
  merge to `main` — there's no push-based deploy step from CI itself. RBAC
  is scoped to `get`/`patch` on exactly those two Deployments by name, plus
  one ConfigMap it uses to remember the last digest seen.
- **backend-migration-job**, **backend-seed-job** — one-off `Job`s for
  manual migration runs / seeding outside the normal rollout path.

### CI/CD

`.github/workflows/docker-publish.yml` builds `backend`, `frontend`, and
`image-watcher` (multi-arch: `linux/amd64` + `linux/arm64`) and pushes to
GHCR on a merge to `main` (and on `vX.Y.Z` tags). Pull requests only build —
nothing is pushed until the change lands on `main`.

## Security model

- **Auth**: stateless JWT bearer tokens, no session table; see `System
  overview` above.
- **Non-root everywhere**: every container in the cluster runs under
  Kubernetes' `restricted` Pod Security Standard (enforced at the namespace
  level, `k8s/namespace.yaml`). Each workload was adjusted individually
  rather than carving out an exception:
  - `postgres` runs as uid/gid `70` directly (`runAsUser`/`fsGroup`),
    matching the alpine image's real `postgres` user — this skips the
    image's own root-to-postgres privilege-drop step entirely rather than
    fighting it.
  - `frontend` uses `nginxinc/nginx-unprivileged` (uid `101`, port `8080`)
    instead of stock `nginx`, which needs root to bind port 80.
  - `backend`, `image-watcher`, and the one-off Jobs run as a plain numeric
    non-root `USER` with capabilities dropped and (where the entrypoint
    allows it) a read-only root filesystem plus an `emptyDir` for `/tmp`.
  - Local docker-compose deliberately leaves `postgres` **unhardened**
    (`cap_drop`/`no-new-privileges` break its entrypoint's own initial
    `chown` of the data directory) — acceptable since it's not
    internet-facing there; see the comment in `docker-compose.yml`. The
    same tradeoff applies to the local-only `metabase` service.
- **Secrets**: DB password, JWT secret, VAPID push keys, and the Cloudflare
  tunnel token live in a Kubernetes `Secret` (`k8s/secret.example.yaml` is
  the template — never commit real values). See `CLAUDE.md`'s Security
  section for the rule this repo is worked on under: never read or print a
  secret's actual value into the conversation, logs, or a file.
- **Metabase** (or any external BI tool) connects with a dedicated
  **read-only** Postgres role (`backend/scripts/setup-metabase-role.sql`),
  never the app's own credentials.

## Key architectural decisions & recurring patterns

New code should follow these; if you're about to do something that
conflicts with one, treat that as a signal to either follow the pattern or
update this document to reflect a deliberate change.

1. **No self-service registration; onboarding is admin-issued invites, and
   every invite starts from an existing guest.** A guest player is promoted
   in place (`is_guest → false`) rather than merged into a separately
   created account. Why: keeps exactly one player row per person from day
   one, with no later merge/reconciliation step needed.
2. **Guests are first-class players, not a separate table.**
   `players.is_guest` is just a flag. Why: guests need to appear in
   registrations/team assignments/stats identically to real players — the
   only real difference is whether a `users` row is linked.
3. **Status is computed on read, never written by a background job.**
   `effectiveGamedayStatus()` (`backend/src/utils/gamedayStatus.ts`) derives
   `CLOSED` from `status === OPEN && date has passed` at the moment it's
   read, applied everywhere a gameday's status is surfaced or checked. Why:
   no cron/worker needed just to flip one column, and it can never drift out
   of sync with "now".
4. **Side effects are fire-and-forget or awaited, chosen deliberately per
   call — not by default.** Push notifications (`pushService.ts`) are
   fire-and-forget: real network round-trips per subscriber that shouldn't
   block the response. `recordAccessEvent` (`accessEventService.ts`) is
   awaited: a single local DB insert has no latency justification for being
   unawaited, and awaiting it also fixed a real Postgres deadlock in the
   test suite (a `TRUNCATE` racing a still-in-flight FK-referencing insert).
5. **Per-gameday stats are precomputed, not derived at query time.**
   `player_gameday_stats` stores points/goal-diff per player per gameday
   when a result is entered; standings and Hall of Fame read that table
   rather than recomputing from raw results. Why: keeps those read paths
   cheap and simple — the tradeoff is that a scoring-rule change needs a
   backfill (see `backend/src/utils/scoring.ts`).
6. **Usage metrics live in their own table, written by the app but never
   read by it.** `access_events` is queried directly by an external BI tool
   (Metabase) via a dedicated read-only role — see `docs/DATA_MODEL.md`.
   Why: keeps analytics concerns completely out of the product's own API
   surface.
7. **Deploys are fully automated from a `main` push — no manual `kubectl
   apply` for an app code change.** CI publishes images to GHCR;
   `image-watcher` notices the new digest and rolls out the Deployment; the
   backend's `migrate` initContainer applies any pending schema migration
   first. Manual `kubectl apply` is only needed for the k8s manifests
   themselves (a new/changed resource, not an app code change).
