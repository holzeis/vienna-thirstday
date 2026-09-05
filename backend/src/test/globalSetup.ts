/**
 * Runs once before the whole route-test run (vitest `globalSetup`, a
 * separate process from the actual test files): makes sure the test
 * database's schema is current by running the real migrations against it.
 */
import "./testDb";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export default async function setup() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
}
