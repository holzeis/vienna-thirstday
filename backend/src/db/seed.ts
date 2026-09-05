/**
 * Bootstraps a first admin account so someone can log in and start approving
 * other users / creating gamedays. Safe to run multiple times (idempotent on
 * email). Configure via env vars or edit the defaults below.
 *
 * Usage: npm run seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, pool } from "./client";
import { users, players } from "./schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@vienna-thursday.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "changeme123";
  const name = process.env.ADMIN_NAME || "Admin";

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    console.log(`Admin user ${email} already exists (id=${existing.id}). Nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await db.transaction(async (tx) => {
    const [player] = await tx.insert(players).values({ name, isGuest: false }).returning();
    await tx.insert(users).values({
      email,
      passwordHash,
      status: "APPROVED",
      isAdmin: true,
      playerId: player.id,
    });
  });

  console.log(`Created admin user: ${email} / ${password}`);
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
