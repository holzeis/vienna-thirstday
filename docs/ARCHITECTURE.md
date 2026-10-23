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
- **Baseline hardening**: `helmet()` sets standard security headers on every
  response (`backend/src/app.ts`), and `POST /auth/login` is throttled
  per-account (`backend/src/middleware/loginRateLimit.ts`, decision #11
  below).

## Components

| Path | Role |
| --- | --- |
| `backend/src/app.ts` | Express app assembly — mounts every router |
| `backend/src/routes/*` | One file per resource area: `auth`, `gamedays`, `gamedayShare` (public, token-based, no login), `players`, `standings`, `hallOfFame`, `push`, `invites`/`adminInvites`, `adminUsers`, `adminPlayers`, `guests`, `passwordReset` (public, token-based, no login) |
| `backend/src/services/*` | Business logic factored out of route handlers so it's unit-testable: `playerStatsService`, `registrationService`, `pushService`, `playerMergeService`, `accessEventService`, `weatherService` (Open-Meteo forecast/observed weather per gameday) |
| `backend/src/utils/*` | Pure/computational logic, one test file per module: `scoring`, `waitlist`, `matchday`, `timezone`, `gamedayStatus`, `weather`, `achievementThresholds`, `userAgent` |
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

The cluster manifests are **not in this repo** — they're managed separately
with Flux. What runs there, for context:

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
- One-off migration / seed `Job`s for runs outside the normal rollout path.

### CI/CD

`.github/workflows/docker-publish.yml` builds `backend` and
`frontend` (multi-arch: `linux/amd64` + `linux/arm64`) and pushes to
GHCR on a merge to `main` (and on `vX.Y.Z` tags). Pull requests only build —
nothing is pushed until the change lands on `main`. Each image is tagged `latest`, the short SHA, and the git commit count
(`git rev-list --count HEAD`) as its version number — monotonic, so Flux
can pin or order releases by it. Rolling the new images
out is Flux's job (see the Flux repo), not this repo's.

## Security model

- **Auth**: stateless JWT bearer tokens, no session table; see `System
  overview` above.
- **Non-root everywhere**: every container in the cluster runs under
  Kubernetes' `restricted` Pod Security Standard (enforced at the namespace
  level, in the Flux-managed manifests). Each workload was adjusted individually
  rather than carving out an exception:
  - `postgres` runs as uid/gid `70` directly (`runAsUser`/`fsGroup`),
    matching the alpine image's real `postgres` user — this skips the
    image's own root-to-postgres privilege-drop step entirely rather than
    fighting it.
  - `frontend` uses `nginxinc/nginx-unprivileged` (uid `101`, port `8080`)
    instead of stock `nginx`, which needs root to bind port 80.
  - `backend` and the one-off Jobs run as a plain numeric
    non-root `USER` with capabilities dropped and (where the entrypoint
    allows it) a read-only root filesystem plus an `emptyDir` for `/tmp`.
  - Local docker-compose deliberately leaves `postgres` **unhardened**
    (`cap_drop`/`no-new-privileges` break its entrypoint's own initial
    `chown` of the data directory) — acceptable since it's not
    internet-facing there; see the comment in `docker-compose.yml`. The
    same tradeoff applies to the local-only `metabase` service.
- **Secrets**: DB password, JWT secret, VAPID push keys, and the Cloudflare
  tunnel token live in a Kubernetes `Secret` managed outside this repo (never commit real
  values). See `CLAUDE.md`'s Security
  section for the rule this repo is worked on under: never read or print a
  secret's actual value into the conversation, logs, or a file.
- **Metabase** (or any external BI tool) connects with a dedicated
  **read-only** Postgres role (`backend/scripts/setup-metabase-role.sql`),
  never the app's own credentials.

## Key architectural decisions & recurring patterns

New code should follow these; if you're about to do something that
conflicts with one, treat that as a signal to either follow the pattern or
update this document to reflect a deliberate change.

1. **No self-service registration; onboarding is admin-issued invites, of
   two kinds.** A guest-linked invite promotes that guest in place
   (`is_guest → false`) rather than merging into a separately created
   account, and is single-use. Why: keeps exactly one player row per person
   from day one, with no later merge/reconciliation step needed for someone
   who already has history under a guest profile. An open invite (no guest)
   is the escape hatch for someone with no prior history - reusable until
   expiry/revocation, each acceptance a brand-new player - and can have a
   guest's history attached afterward through the ordinary merge tool
   (`playerMergeService.ts`) if one turns up later. A guest-linked invite
   may also carry a `season`: then the guest is not promoted, and accepting
   creates a new player and runs the ordinary season-scoped merge for that
   year, so a guest profile holding someone else's season isn't attached
   wholesale and the merge stays logged/undoable. Every acceptance of
   either kind is logged to `invite_redemptions` (see `docs/DATA_MODEL.md`),
   which is what lets the admin page show who joined via a given link.
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
7. **Deploys are owned by Flux, outside this repo.** CI publishes images
   to GHCR; the Flux-managed manifests (not kept here) decide how and when
   they roll out. The backend's `migrate` initContainer applies any pending
   schema migration first. This repo contains no cluster manifests, so an
   app change never needs a manifest change here.
8. **Deleting a user's login never deletes, or is blocked by, anything that
   references them.** If they have a linked player, it reverts to a guest
   (`is_guest → true`, same as revoking an unused invite) rather than being
   touched — every registration, team assignment, and gameday stat stays
   exactly as it was, so no other player's stats are ever affected either.
   Every "who did this" attribution column that points at `users`
   (`gamedays.created_by_user_id`, `results.entered_by_user_id`,
   `registrations.registered_by_user_id`, `invites.created_by_user_id`,
   `invites.used_by_user_id`, `player_merges.merged_by_user_id`) is nullable
   with `ON DELETE SET NULL` for the same reason — see
   `routes/adminUsers.ts` and `docs/DATA_MODEL.md`. Why: an account should
   always be removable without an admin having to first hunt down and
   detach every row it's ever touched, and without silently erasing real
   league history to do it. This is deliberately *not* a GDPR erasure
   feature — the player's name, photo, and full activity history (including
   `access_events`) survive untouched; it only removes login credentials.
   A genuine "erase my data" action, if ever needed, would be a separate,
   explicit feature that anonymizes those fields instead.
9. **A public, unauthenticated write is authorized by a random unguessable
   token, never by an id.** `gamedays.share_token` (the matchday link
   itself), `invites.token`, `registrations.cancel_token` (a guest
   self-cancelling via the share link), and `password_reset_tokens.token`
   (an admin-generated password-reset link) are all 256-bit random strings
   from the same generator family (`utils/inviteToken.ts`,
   `utils/passwordResetToken.ts`). Why: a `playerId` or `gamedayId` is not a
   secret - it's small, sequential, and often already visible in a public
   response (e.g. the share link's own roster/status lookup returns names
   and accepts `?playerId=` to check "am I on this list"), so it can never
   be trusted alone to authorize *changing* something. The token is handed
   back exactly once, in the response to the action that created it, and
   never echoed by any read endpoint.
10. **An admin-generated single-use link keeps at most one live row per
    target, not a history of them.** Generating a new password-reset link
    for a user (`routes/adminUsers.ts`'s POST `/:id/reset-link`) deletes any
    previous `password_reset_tokens` row for that user first, so a link is
    invalidated the instant a new one is issued - not just on use or
    expiry - matching the feature's own request ("regenerating replaces the
    old link"). This is unlike `invites`, which keeps every issued link
    around (revoked, used, or expired) for the admin's own audit trail; a
    reset link has no such list to show, so there's nothing to lose by
    deleting the superseded row outright.
11. **Login brute-force throttling is keyed by account, not source IP.**
    `middleware/loginRateLimit.ts` limits `POST /auth/login` by the
    submitted name/email (case-insensitive), not `req.ip`. Why: the app
    sits behind a different number of reverse-proxy hops in each
    environment (one nginx container in docker-compose, ingress-nginx *and*
    the frontend nginx container in Kubernetes — see the Flux-managed ingress),
    so there's no single `trust proxy` hop count that's correct everywhere;
    getting it wrong either lets an attacker spoof `X-Forwarded-For` past
    the limit, or collapses every real user behind the same proxy onto one
    shared bucket. Keying by account sidesteps the whole question and
    directly targets the actual threat (credential guessing against one
    account) regardless of topology. Skipped entirely when
    `NODE_ENV=test`, since the same in-memory limiter store persists for a
    whole test file's app instance and plenty of files log in as "Admin"
    dozens of times.
12. **Third-party data is refreshed lazily on read, never blocking the list.**
    Weather (`services/weatherService.ts`) follows the same
    compute-on-read idea as #3: `planWeatherRefresh()` decides from the
    stored snapshot whether it is stale (forecast older than 3h, kickoff
    moved, match finished but no observed data yet), and a read triggers the
    refresh - no cron. `GET /gamedays/:id` **awaits** it with a 3s
    timeout so an opened matchday is current, and creating a gameday kicks
    off a **fire-and-forget** fetch. Weather is deliberately not part of the
    list endpoint, so a provider outage can never slow or fail it. Failures
    are swallowed, back off for 5 minutes per gameday, and leave the old
    snapshot in place. An `OBSERVED` row is final. Forecast beyond Open-Meteo's
    16-day horizon is simply absent rather than guessed. Why: no new
    background-job infrastructure, and the app stays fully usable offline from
    the weather API.
