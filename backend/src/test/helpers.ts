import "./testDb";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { players, users } from "../db/schema";

/** Wipes every table between tests so route tests don't see each other's data. */
export async function resetDb() {
  await db.execute(
    sql`TRUNCATE users, players, gamedays, registrations, team_assignments, results, player_gameday_stats, player_merges, invites RESTART IDENTITY CASCADE`
  );
}

export async function closeDb() {
  await pool.end();
}

/** Creates an admin user (and its player) directly in the DB, bypassing the invite flow, for tests that just need to be logged in as an admin. */
export async function createAdmin(name = "Admin", password = "password123") {
  const passwordHash = await bcrypt.hash(password, 10);
  const [player] = await db.insert(players).values({ name, isGuest: false }).returning();
  const [user] = await db.insert(users).values({ passwordHash, isAdmin: true, playerId: player.id }).returning();
  return { player, user, password };
}

/** Creates a non-admin guest player directly in the DB, for tests exercising the invite flow. */
export async function createGuestPlayer(name: string) {
  const [player] = await db.insert(players).values({ name, isGuest: true }).returning();
  return player;
}
