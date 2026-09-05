# Vienna Thursday Kicken

A web app for running the weekly Thursday pickup football group: admin-issued
invite links for onboarding (no self-service registration), guest players,
gameday sign-up with an auto-managed waitlist, admin-entered results, and a
Jan 1 – Dec 31 season standings table.

## Contents

- [Features](#features)
- [How the rules work](#how-the-rules-work)
- [Architecture](#architecture)
- [Local development (no Docker)](#local-development-no-docker)
- [Local development with Docker Compose](#local-development-with-docker-compose)
- [Importing the legacy spreadsheet](#importing-the-legacy-spreadsheet)
- [Deploying to Kubernetes](#deploying-to-kubernetes)
- [Environment variables](#environment-variables)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

## Features

- **Accounts & roles.** No self-service registration - every account starts
  from a guest/placeholder player. An admin picks (or first creates) that
  guest on the Admin → Users → "Invite a player" page, which immediately
  promotes it to a real player and generates a link, shared however they'd
  normally reach the group. Opening the link lets that person confirm or
  change their name (this is also their login - no email required), set a
  password, and optionally add a photo and an email address. The account is
  active immediately, no separate approval step. Links expire on a
  configurable timer (default 7 days, up to 90) and can be revoked before
  they're used, which reverts the guest promotion. Any account can also be
  granted the `Admin` role.
- **Guests.** Any logged-in user can create reusable guest profiles and bring
  them to gamedays. Guests count toward a gameday's capacity/waitlist but are
  excluded from the season standings table.
- **Gamedays & waitlist.** Admins create gamedays (date, location, min/max
  players - default 8/14). Anyone can sign up; once at least `minPlayers` are
  confirmed, further sign-ups are only confirmed in pairs (so two even teams
  can always be formed), and the rest wait. Cancelling a confirmed spot
  automatically re-evaluates the list and can promote someone off the
  waitlist. See [How the rules work](#how-the-rules-work) for the exact logic.
- **Teams & results.** Admins assign confirmed players to Team A / Team B
  (any time before or after the gameday) and enter the final score. Points
  and goal difference per player are computed automatically: win = 4 pts,
  draw = 2 pts, loss = 1 pt, plus/minus the goal difference.
- **Season standings.** A season runs Jan 1 – Dec 31. Players are ranked by
  total points, then goal difference. Multiple seasons are kept and browsable.
- **Merging imported/guest players into real accounts.** Historical players
  (from the spreadsheet import) and ad-hoc guests are both stored as "guest"
  players, so they're excluded from standings until claimed. When approving a
  pending user, an admin can optionally pick one of these unclaimed players
  from a dropdown - the new account inherits that player's full history
  (every past registration, team assignment, and gameday stat) and the guest
  record is removed. See [Importing the legacy spreadsheet](#importing-the-legacy-spreadsheet).
- **Light & dark themes.** A toggle in the top bar (next to "Log out") switches
  between a dark, pitch-inspired theme and a light theme. The choice is
  remembered per browser (defaulting to the device's system preference on
  first visit) and applies instantly with no page reload.

## How the rules work

**Waitlist / capacity** (`backend/src/utils/waitlist.ts`): below `minPlayers`,
everyone who signs up is confirmed immediately - there's no reason to
waitlist anyone while it's not yet clear the gameday will run. From
`minPlayers` upward, confirmed spots fill in pairs so two full teams can
always be formed: the 9th sign-up (with the default min of 8) waits until a
10th arrives, then both are confirmed together; the 11th waits for a 12th;
and so on, with a hard cap at `maxPlayers`. Cancelling a confirmed
registration re-runs this calculation immediately, which can bump someone off
the waitlist into a confirmed spot (or drop the group back down to the next
even number, per the same pairing rule).

**Scoring** (`backend/src/utils/scoring.ts`): a gameday is one match between
Team A and Team B. Whichever team's score is higher gets 4 points per player
plus that team's goal difference; the other team gets 1 point plus a negative
goal difference; a tie gives everyone 2 points and 0 goal difference.

Both of these were reverse-engineered from, and verified against, the
group's original spreadsheet - see [Known limitations](#known-limitations).

## Architecture

- **Backend**: Node.js + TypeScript + Express, JWT auth (bcrypt password
  hashing), PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/) (plain SQL
  migrations, no native binaries required).
- **Frontend**: React + TypeScript + Vite, React Router, plain CSS (no UI
  framework). Talks to the backend exclusively through `/api/...`, proxied by
  Vite in dev and by nginx in the production image - so the frontend never
  needs to know the backend's real hostname.
- **Database**: PostgreSQL.

```
┌──────────┐      /api/*      ┌──────────┐        SQL        ┌────────────┐
│ frontend │ ───────────────► │ backend  │ ─────────────────► │ PostgreSQL │
│ (nginx)  │ ◄─────────────── │ (Express)│ ◄───────────────── │            │
└──────────┘                  └──────────┘                    └────────────┘
```

## Local development (no Docker)

Prerequisites: Node.js 20+, a running PostgreSQL 16 instance, `npm`.

1. **Database.** Create a database and user (adjust to taste):

   ```bash
   sudo -u postgres psql -c "CREATE USER vienna WITH PASSWORD 'vienna';"
   sudo -u postgres psql -c "CREATE DATABASE vienna_thursday OWNER vienna;"
   ```

2. **Backend.**

   ```bash
   cd backend
   npm install
   cp .env.example .env   # already points at the DB above; edit if needed
   npm run db:migrate     # applies drizzle/*.sql
   npm run seed           # creates the first admin (see console output for credentials)
   npm run dev            # http://localhost:4000
   ```

   To change the bootstrapped admin's email/password/name, set
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` before running `npm run seed`.

3. **Frontend.**

   ```bash
   cd frontend
   npm install
   npm run dev            # http://localhost:5173, proxies /api to :4000
   ```

4. Open http://localhost:5173, log in with the seeded admin, and start
   inviting players / creating gamedays.

### Useful backend scripts

| Script                      | What it does                                          |
| ---------------------------- | ------------------------------------------------------ |
| `npm run dev`                | Run the API with hot reload                            |
| `npm run build`               | Compile TypeScript to `dist/`                          |
| `npm start`                   | Run the compiled build (`dist/index.js`)                |
| `npm run db:generate`         | Generate a new SQL migration from `src/db/schema.ts`    |
| `npm run db:migrate`          | Apply pending migrations                                |
| `npm run seed`                | Bootstrap the first admin account (idempotent)          |
| `npm run seed:import-xlsx`    | One-time import of the legacy spreadsheet (see below)   |
| `npm run fixup:mark-unclaimed-guests` | Retroactively marks unclaimed imported players as guests (only needed if you ran the importer before the merge feature existed) |

## Local development with Docker Compose

This brings up Postgres, the backend, and the frontend (served by nginx on
port 8080) together:

```bash
docker compose up --build
```

Then, in another terminal, bootstrap the first admin (migrations already run
automatically on backend startup):

```bash
docker compose run --rm backend node dist/db/seed.js
```

Open http://localhost:8080.

Environment overrides (put them in a `.env` file next to `docker-compose.yml`,
or export them before running `docker compose up`): `JWT_SECRET`,
`CORS_ORIGIN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`.

> **Note:** the Compose file and both Dockerfiles were written and
> structurally validated (`docker compose config`), and the equivalent build
> and startup commands were verified to work outside of Docker in this
> environment. The environment this app was built in could not reach Docker
> Hub to actually pull base images and run `docker compose up`, so please do
> a first build/run on your own machine before relying on it - if anything
> doesn't come up cleanly, the Dockerfiles are short and easy to adjust.

## Importing the legacy spreadsheet

The original `Kicken_2026.xlsx` tracker is imported as historical data so the
season continues seamlessly inside the app.

```bash
# 1. Export the spreadsheet to JSON (requires Python + openpyxl)
pip install openpyxl --break-system-packages
python3 scripts/export_xlsx_to_json.py /path/to/Kicken_2026.xlsx \
  backend/src/db/seed-data/kicken-2026-import.json

# 2. Bootstrap an admin if you haven't already (the importer needs one to
#    attribute the imported gamedays/results to)
cd backend && npm run seed

# 3. Import
npm run seed:import-xlsx
```

Pre-generated `kicken-2024-import.json` / `kicken-2025-import.json` /
`kicken-2026-import.json` (one per season, from the spreadsheets supplied
during development) are already committed under `backend/src/db/seed-data/`,
so step 1 is only needed if you want to regenerate one from an updated
spreadsheet. `npm run seed:import-xlsx` with no argument imports every
`*-import.json` file found there; pass a filename to import just one. The
import is idempotent - it skips gamedays that already exist for a given
date, so it's safe to re-run. A player appearing in multiple seasons' files
is matched by exact name and shares one player record across years.

### Onboarding an imported player

The importer creates every historical player as a **guest** - nobody has an
account yet, and guests are excluded from the standings table, so right
after importing, `/standings` will look empty. That's expected. As each real
person joins:

1. On the **Admin → Users** page, under "Invite a player", type or pick their
   name (the field suggests every unclaimed guest with a games-played count,
   e.g. "Benji (15 games)"; typing a name with no match creates a fresh
   guest), set how many days the link should stay valid, and click
   **Create invite link**. This immediately promotes that guest to a real
   player.
2. Send them the generated link however you'd normally reach them.
3. When they open it, confirm or change their name, set a password, and
   optionally add a photo and an email - their account immediately inherits
   that player's entire history (since it's the same player record, not a
   merge) and they'll show up in the standings table with their real season
   total.

> If you already ran the importer before this merge feature existed (so your
> historical players were created as regular, non-guest players instead of
> guests), run `cd backend && npm run fixup:mark-unclaimed-guests` once - it
> retroactively marks every player with no linked account as a guest, without
> touching anyone who's already signed up.

## Deploying to Kubernetes

Manifests live under `k8s/` and are wired together with `kustomize`.

1. **Build and push images** to a registry your cluster can pull from.
   `.github/workflows/docker-publish.yml` does this automatically on every
   push to `main` (and on `vX.Y.Z` tags), publishing to GitHub Container
   Registry at `ghcr.io/<owner>/<repo>-backend` and `-frontend` using the
   repo's built-in `GITHUB_TOKEN` - no secrets to configure. GHCR packages
   are private by default; either make the package public in its GitHub
   settings, or create an `imagePullSecret` in the `vienna-thursday`
   namespace from a PAT with `read:packages` and reference it in
   `backend-deployment.yaml`/`frontend-deployment.yaml`'s `imagePullSecrets`.

   To build and push by hand instead (e.g. a different registry):

   ```bash
   docker build -t <registry>/vienna-thursday-backend:1.0.0 ./backend
   docker build -t <registry>/vienna-thursday-frontend:1.0.0 ./frontend
   docker push <registry>/vienna-thursday-backend:1.0.0
   docker push <registry>/vienna-thursday-frontend:1.0.0
   ```

   Either way, point `k8s/kustomization.yaml`'s `images:` section at them
   (see the comment in that file).

2. **Create the secret** (never commit real secrets - `k8s/secret.yaml` is
   gitignored):

   ```bash
   kubectl create namespace vienna-thursday
   kubectl create secret generic vienna-thursday-secrets \
     --namespace vienna-thursday \
     --from-literal=POSTGRES_PASSWORD='use-a-strong-password' \
     --from-literal=DATABASE_URL='postgresql://vienna:use-a-strong-password@postgres:5432/vienna_thursday' \
     --from-literal=JWT_SECRET="$(openssl rand -base64 48)" \
     --from-literal=ADMIN_PASSWORD='choose-a-first-admin-password' \
     --from-literal=ADMIN_NAME='Admin'
   ```

   (`k8s/secret.example.yaml` shows the same thing as a manifest, if you'd
   rather template it with your own secrets tooling.) `ADMIN_EMAIL` is
   optional - login is by name, not email - so it's left out here; add
   `--from-literal=ADMIN_EMAIL=...` too if you want the seeded admin to have
   one from the start. Add `CLOUDFLARE_TUNNEL_TOKEN` as well if you're doing
   the Cloudflare Tunnel setup below.

3. **Deploy:**

   ```bash
   kubectl apply -k k8s/
   kubectl apply -f k8s/backend-migration-job.yaml
   kubectl wait --for=condition=complete job/backend-migrate -n vienna-thursday --timeout=120s
   kubectl apply -f k8s/backend-seed-job.yaml   # bootstraps the first admin; safe to re-run
   ```

4. Edit `k8s/ingress.yaml`'s `host` (and `CORS_ORIGIN` in
   `k8s/backend-configmap.yaml`) to match your real domain, then re-apply.

`k8s/postgres.yaml` runs Postgres as a single-replica `StatefulSet` with a
5Gi PVC on the `longhorn` storage class (swap `storageClassName` if your
cluster doesn't have Longhorn installed) - fine to get started, but for
anything you care about long-term, point `DATABASE_URL` at a managed
Postgres instance instead and remove `postgres.yaml` from
`kustomization.yaml`.

### Exposing it publicly without forwarding a router port

`k8s/cloudflared.yaml` runs [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
as a Deployment in-cluster. `cloudflared` only makes an *outbound* connection
to Cloudflare's edge, so nothing needs to be opened inbound on your router -
Cloudflare proxies traffic for a hostname you choose through that tunnel to
the ingress-nginx controller already fronting this app, which then routes by
Host header exactly like it does for the local hostname.

1. In the Cloudflare Zero Trust dashboard (dash.cloudflare.com → Zero Trust →
   Networks → Tunnels), create a tunnel with connector type "Cloudflared" and
   copy the token it gives you (a single string - this is the simpler
   token-based setup, no `config.yml`/`cert.pem` file needed).
2. On that tunnel, add a **Public Hostname**: the hostname you want (on a
   domain already in your Cloudflare account), type `HTTP`, service
   `nginx-ingress-nginx-controller.<namespace>.svc.cluster.local:80` (swap in
   whatever namespace your ingress-nginx controller actually runs in).
   Cloudflare creates the DNS record for you.
3. Add that hostname as a second `host:` entry in `k8s/ingress.yaml` (a
   commented example is already there) pointing at the same `frontend`
   backend, and to `CORS_ORIGIN` in `backend-configmap.yaml` if anything will
   ever call the API cross-origin from it (normally not needed - the
   frontend's own nginx proxies `/api` same-origin).
4. Put the token from step 1 into your secret as `CLOUDFLARE_TUNNEL_TOKEN`,
   then uncomment `cloudflared.yaml` in `kustomization.yaml` and re-apply.

Cloudflare terminates TLS at their edge, so the public hostname gets HTTPS
automatically with no cert-manager involvement needed for it.

> **Note:** these manifests (including `cloudflared.yaml` and the Longhorn
> storage class) were validated with `kubectl apply --dry-run=client` against
> a real cluster and `kubectl get storageclass`/`get ns` to confirm `longhorn`
> and the expected namespaces exist, but were not actually applied end-to-end
> from this environment (no image registry or Cloudflare tunnel token were
> available to complete a real deploy). Review resource requests/limits and
> the ingress class/annotations against your actual cluster before relying on
> this in production.

## Environment variables

### Backend (`backend/.env`, see `.env.example`)

| Variable          | Purpose                                            | Default                                                        |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`    | Postgres connection string                          | -                                                                |
| `JWT_SECRET`      | Signing secret for auth tokens - **change in prod**  | -                                                                |
| `JWT_EXPIRES_IN`  | Token lifetime                                       | `7d`                                                             |
| `PORT`            | API port                                             | `4000`                                                           |
| `CORS_ORIGIN`     | Allowed origin for browser requests                  | `http://localhost:5173`                                          |
| `ADMIN_EMAIL`     | Used only by `npm run seed`                          | `admin@vienna-thursday.local`                                    |
| `ADMIN_PASSWORD`  | Used only by `npm run seed`                          | `changeme123`                                                    |
| `ADMIN_NAME`      | Used only by `npm run seed`                          | `Admin`                                                          |

### Frontend (build-time)

| Variable       | Purpose                                                        | Default |
| -------------- | ----------------------------------------------------------------- | ------- |
| `VITE_API_URL` | Base URL the frontend calls. Leave as `/api` unless you're not using the bundled nginx reverse proxy. | `/api`  |

### Frontend container (runtime)

| Variable       | Purpose                                             | Default        |
| -------------- | ------------------------------------------------------ | -------------- |
| `BACKEND_HOST` | `host:port` the nginx reverse proxy forwards `/api/` to | `backend:4000` |

## Project layout

```
backend/
  src/
    routes/         Express route handlers (auth, gamedays, guests, ...)
    services/        Waitlist recompute logic
    utils/           Scoring, waitlist math, JWT, error types
    db/
      schema.ts       Drizzle table definitions
      client.ts        DB connection
      migrate.ts        Runs drizzle/*.sql against DATABASE_URL
      seed.ts            Bootstraps the first admin
      import-xlsx-seed.ts  One-time historical data import
      seed-data/        Pre-exported legacy spreadsheet JSON
  drizzle/            Generated SQL migrations (checked in)
frontend/
  src/
    api/              Typed fetch client
    auth/             Auth context + route guards
    pages/            One file per route
    components/       Shared layout/nav
    styles/           App-wide CSS
scripts/
  export_xlsx_to_json.py   Re-run this if the legacy spreadsheet changes
k8s/                  Kubernetes manifests (kustomize)
docker-compose.yml    Local multi-container setup
```

## Known limitations

- **Historical score reconstruction.** The legacy spreadsheet recorded each
  player's exact points and goal difference per matchday - and those are
  imported verbatim, so once a player is merged into a real account (see
  [Claiming imported players](#claiming-imported-players)), their contribution
  to the season table matches the original spreadsheet's table exactly. What
  it never recorded was the two teams' rosters as a distinct concept, or the
  literal final score (e.g. "5:3"). The importer reconstructs a team split
  (who shared a win/loss) and a placeholder score with the correct goal
  difference purely for display on those historical gamedays; treat the
  reconstructed score and team roster for pre-launch gamedays as
  illustrative, not exact.
- **Every invite starts from a guest, matched by hand.** There's no "brand
  new player" option and no automatic name-matching when an admin creates an
  invite - they always pick (or first create) the specific guest to onboard,
  deliberately, since auto-matching on a name string risks silently pairing
  the wrong person (e.g. two different people who both go by "Max"). The
  underlying `mergeGuestIntoPlayer`/"Recent guest merges" audit log (Admin →
  Users) still exists so a past merge can be reviewed and undone, but nothing
  in the UI currently creates a *new* merge anymore - onboarding doesn't need
  one since it promotes the guest in place. Attaching a second, later-
  discovered guest identity onto an already-onboarded account would need a
  one-off script or a small admin-route addition; there's no button for it
  today.
- **No email delivery.** Invite links are generated in the app but not
  emailed - an admin copies the link and sends it however they'd normally
  reach the group (WhatsApp, email, etc.). Worth automating with a
  transactional email provider if the group grows past the point where
  that's convenient.
- **Single default season length.** Seasons are always calendar years
  (Jan 1 – Dec 31); there's no support for a different season boundary.
