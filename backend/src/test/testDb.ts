/**
 * Route/integration tests run against a real, separate Postgres database
 * (same server as dev, different name) rather than mocking Drizzle - the
 * whole point is to exercise real queries/transactions/constraints. This
 * must be imported (for its side effect of setting DATABASE_URL) before
 * anything that imports db/client.ts, which reads the env var at module
 * load time.
 */
const DEFAULT_TEST_DATABASE_URL = "postgresql://vienna:vienna@localhost:5432/vienna_thirstday_test";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

// Structurally-valid but not-for-real-delivery VAPID key pair, just so
// pushService's web-push.setVapidDetails() doesn't reject at import time -
// tests mock web-push's actual sendNotification, so these are never used to
// talk to a real push service.
process.env.VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY || "BGyEXQRdc05U1juvnZfIS_7kYym8MPOV9WvBavFqQCxjXhLSMM7SdtHmCOOgUQKXWMqt95461ST9cG4VMqHJWc4";
process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "0lu2gTG5vVWfq03yZ-HukKajPGzbsDzlHC6ibdDdUfI";
process.env.VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:test@vienna-thirstday.local";
