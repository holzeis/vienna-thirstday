/**
 * One-off fix-up for databases where `npm run seed:import-xlsx` was already
 * run before it started creating imported players as guests. Marks every
 * player that has no linked user account as a guest, matching what a fresh
 * import now does directly. Safe to re-run; only touches unclaimed players
 * and never un-marks a player that already has an account.
 *
 * Usage: npx ts-node --transpile-only src/db/mark-unclaimed-as-guests.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "./client";
import { players, users } from "./schema";

async function main() {
  const allUsers = await db.query.users.findMany();
  const linkedPlayerIds = new Set(allUsers.map((u) => u.playerId).filter((id): id is number => id !== null));

  const nonGuestPlayers = await db.query.players.findMany({ where: eq(players.isGuest, false) });
  const unclaimed = nonGuestPlayers.filter((p) => !linkedPlayerIds.has(p.id));

  for (const p of unclaimed) {
    await db.update(players).set({ isGuest: true }).where(eq(players.id, p.id));
  }

  console.log(`Marked ${unclaimed.length} unclaimed player(s) as guests (out of ${nonGuestPlayers.length} non-guest players checked).`);
}

main()
  .catch((err) => {
    console.error("Fix-up failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
