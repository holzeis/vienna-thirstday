/**
 * Route/integration tests run against a real, separate Postgres database
 * (same server as dev, different name) rather than mocking Drizzle - the
 * whole point is to exercise real queries/transactions/constraints. This
 * must be imported (for its side effect of setting DATABASE_URL) before
 * anything that imports db/client.ts, which reads the env var at module
 * load time.
 */
const DEFAULT_TEST_DATABASE_URL = "postgresql://vienna:vienna@localhost:5432/vienna_thursday_test";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
