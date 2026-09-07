-- Read-only Postgres role for external BI tools (Metabase or similar) - see
-- README's "Usage metrics" section. Run once per database: locally against
-- the dev DB, and separately against the live cluster's Postgres (they're
-- different databases, so the role has to be created in each).
--
-- Usage:
--   psql "postgresql://vienna:vienna@localhost:5432/vienna_thirstday" \
--     -v metabase_password=choose-a-real-password \
--     -f backend/scripts/setup-metabase-role.sql
--
-- Against the live cluster, port-forward first:
--   kubectl port-forward -n vienna-thirstday svc/postgres 5433:5432
--   psql "postgresql://vienna:<POSTGRES_PASSWORD from the cluster secret>@localhost:5433/vienna_thirstday" \
--     -v metabase_password=choose-a-real-password \
--     -f backend/scripts/setup-metabase-role.sql

SELECT format('CREATE ROLE metabase LOGIN PASSWORD %L', :'metabase_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metabase')
\gexec

GRANT CONNECT ON DATABASE vienna_thirstday TO metabase;
GRANT USAGE ON SCHEMA public TO metabase;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO metabase;
-- Also cover tables created by future migrations, without re-granting each time:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO metabase;
