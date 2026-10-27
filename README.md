# Vienna Thirstday Kicken

A web app (installable as a PWA) for running a weekly Thursday pickup football
group: invite-only accounts, guest players, matchday sign-up with an
auto-managed waitlist, teams and results, season standings, a hall of fame,
weather forecasts and push notifications.

## Architecture

```
┌──────────┐      /api/*      ┌──────────┐        SQL        ┌────────────┐
│ frontend │ ───────────────► │ backend  │ ─────────────────► │ PostgreSQL │
│ (nginx)  │ ◄─────────────── │ (Express)│ ◄───────────────── │            │
└──────────┘                  └──────────┘                    └────────────┘
```

- **Backend**: Node.js + TypeScript + Express, JWT auth, PostgreSQL via
  [Drizzle ORM](https://orm.drizzle.team/) (plain SQL migrations in `backend/drizzle`).
- **Frontend**: React + TypeScript + Vite, React Router, plain CSS. It only
  talks to `/api/...`, proxied by Vite in dev and by nginx in the production
  image, so it never needs to know the backend's hostname.
- **CI/CD**: GitHub Actions runs the backend and frontend tests, builds both
  images on every PR, and publishes them to GHCR from `main` only. Deployment
  to the cluster is managed separately with Flux and doesn't live in this repo.

More detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (technical decision
log) and [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) (schema).

## Running locally

### With Docker Compose

Starts Postgres, the backend and the frontend (nginx, port 8081):

```bash
docker compose up --build
# in another terminal, once: create the first admin (migrations run on backend startup)
docker compose run --rm backend node dist/db/seed.js
```

Open http://localhost:8081. Postgres is exposed on `localhost:5433`.

### Without Docker

Prerequisites: Node.js 24, `npm`, a running PostgreSQL 16.

```bash
# Backend (http://localhost:4000)
cd backend
npm install
cp .env.example .env     # DATABASE_URL points at port 5433 (the compose Postgres); adjust if needed
npm run db:migrate       # apply drizzle/*.sql
npm run seed             # create the first admin
npm run dev

# Frontend (http://localhost:5173, proxies /api to :4000)
cd frontend
npm install
npm run dev
```

Log in with the seeded admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, see below) and
invite players from **Admin → Users**.

### Tests

```bash
cd backend && npm test    # Vitest + supertest against a real Postgres
cd frontend && npm test   # Vitest + Testing Library (jsdom)
```

The backend integration tests use a separate `vienna_thirstday_test` database
on the same Postgres server (override with `TEST_DATABASE_URL`) and run the
real migrations against it. Both suites run in CI on every pull request.

## Configuration

### Backend (`backend/.env`, see `.env.example`)

| Variable          | Purpose                                             | Default                        |
| ----------------- | ---------------------------------------------------- | ------------------------------- |
| `DATABASE_URL`    | Postgres connection string                           | -                               |
| `JWT_SECRET`      | Signing secret for auth tokens - **change in prod**  | -                               |
| `JWT_EXPIRES_IN`  | Token lifetime                                       | `7d`                            |
| `PORT`            | API port                                             | `4000`                          |
| `CORS_ORIGIN`     | Allowed origin for browser requests                  | `http://localhost:5173`         |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Used only by `npm run seed` | `admin@vienna-thirstday.local` / `changeme123` / `Admin` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push key pair (`npx web-push generate-vapid-keys`); unset disables push | -  |
| `WEATHER_LATITUDE` / `WEATHER_LONGITUDE` | Coordinates weather is fetched for (the pitch) | central Vienna |
| `WEATHER_ENABLED` | Set `false` to disable weather lookups               | `true`                          |

### Frontend

| Variable       | When       | Purpose                                                    | Default        |
| -------------- | ---------- | ------------------------------------------------------------ | -------------- |
| `VITE_API_URL` | build time | Base URL the frontend calls; leave as is when using the bundled nginx proxy | `/api` |
| `BACKEND_HOST` | runtime (container) | `host:port` nginx forwards `/api/` to                | `backend:4000` |

With Docker Compose, put overrides (`JWT_SECRET`, `CORS_ORIGIN`, `ADMIN_*`, ...)
in a `.env` file next to `docker-compose.yml`.

## Deploying

`.github/workflows/docker-publish.yml` publishes
`ghcr.io/<owner>/<repo>-backend` and `-frontend` (`linux/amd64` + `linux/arm64`),
tagged `latest`, the short SHA and the git commit count. What the images expect
from whatever deploys them:

- **Config/secrets:** the backend variables above.
- **Migrations:** run `npm run db:migrate` (e.g. in an initContainer) before the
  backend starts; it's a no-op when nothing is pending.
- **First admin:** run the seed script once; it's safe to re-run.
- **Frontend:** `nginxinc/nginx-unprivileged` on port `8080`, proxying `/api` to
  the backend Service.

## Usage metrics and Metabase

Logins, app opens and guest sign-ups are recorded in the `access_events` table
(who, when, OS/browser/device, PWA vs. browser tab, app version). It's meant to
be queried with SQL from a BI tool such as [Metabase](https://www.metabase.com/)
rather than shown in the app. Columns are documented in
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

Connect external tools with a **read-only** Postgres role, not the app's own
credentials: run `backend/scripts/setup-metabase-role.sql` (usage is in the
comment at the top) against the database you're connecting to.

`docker compose up -d metabase` starts Metabase on <http://localhost:3000>, with
its own settings kept in the `metabase-data` volume. It's local-only by design
and nothing is exposed to the internet. After Metabase's first-run setup, add a
database connection using that read-only role:

- **Local dev database:** host `postgres`, port `5432`, database `vienna_thirstday`.
- **Live cluster:** Postgres isn't exposed outside the cluster, so port-forward
  it first, then connect to host `host.docker.internal`, port `5434`:

  ```sh
  kubectl port-forward -n <namespace> svc/<postgres-service> 5434:5432
  ```

  (Namespace and Service name are defined in the Flux repo.)

Example query, app opens per week:

```sql
SELECT date_trunc('week', occurred_at) AS week, count(*)
FROM access_events
WHERE event_type = 'APP_OPEN'
GROUP BY week
ORDER BY week DESC;
```
