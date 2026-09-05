/**
 * Bootstraps a first admin account so someone can log in and start creating
 * gamedays and invites. Safe to run multiple times (idempotent on name).
 * Configure via env vars or edit the defaults below.
 *
 * Usage: npm run seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, pool } from "./client";
import { users, players } from "./schema";
import { sql } from "drizzle-orm";

async function main() {
  const name = process.env.ADMIN_NAME || "Admin";
  const password = process.env.ADMIN_PASSWORD || "changeme123";
  const email = process.env.ADMIN_EMAIL?.toLowerCase();

  const existing = await db.query.players.findFirst({ where: sql`lower(${players.name}) = lower(${name})` });
  if (existing) {
    console.log(`Player "${name}" already exists (id=${existing.id}). Nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await db.transaction(async (tx) => {
    const [player] = await tx.insert(players).values({ name, isGuest: false }).returning();
    await tx.insert(users).values({
      email: email || null,
      passwordHash,
      isAdmin: true,
      playerId: player.id,
    });
  });

  console.log(`Created admin user: ${name} / ${password}`);
  console.log("IMPORTANT: change this password after first login.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
