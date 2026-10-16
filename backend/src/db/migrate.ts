import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";
import { backfillGuestPromotions } from "../services/playerMergeService";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  console.log("Running migrations from ./drizzle ...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  // Idempotent data catch-up that has to follow the schema change above.
  const loggedPromotions = await db.transaction((tx) => backfillGuestPromotions(tx));
  if (loggedPromotions > 0) console.log(`Logged ${loggedPromotions} past guest promotion(s) under "Recent guest merges".`);

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
