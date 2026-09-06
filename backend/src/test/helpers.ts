import "./testDb";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { gamedays, players, playerGamedayStats, results, users } from "../db/schema";

/** Wipes every table between tests so route tests don't see each other's data. */
export async function resetDb() {
  await db.execute(
    sql`TRUNCATE users, players, gamedays, registrations, team_assignments, results, player_gameday_stats, player_merges, invites, push_subscriptions RESTART IDENTITY CASCADE`
  );
}

export async function closeDb() {
  await pool.end();
}

/** Creates an admin user (and its player) directly in the DB, bypassing the invite flow, for tests that just need to be logged in as an admin. */
export async function createAdmin(name = "Admin", password = "password123", email?: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [player] = await db.insert(players).values({ name, isGuest: false }).returning();
  const [user] = await db.insert(users).values({ passwordHash, isAdmin: true, playerId: player.id, email: email ?? null }).returning();
  return { player, user, password };
}

/** Creates a non-admin guest player directly in the DB, for tests exercising the invite flow. */
export async function createGuestPlayer(name: string) {
  const [player] = await db.insert(players).values({ name, isGuest: true }).returning();
  return player;
}

/** Creates an OPEN gameday for registration/waitlist tests. */
export async function createOpenGameday(adminUserId: number, date: Date, opts: { minPlayers?: number; maxPlayers?: number } = {}) {
  const [gameday] = await db
    .insert(gamedays)
    .values({ date, status: "OPEN", createdByUserId: adminUserId, minPlayers: opts.minPlayers ?? 8, maxPlayers: opts.maxPlayers ?? 14 })
    .returning();
  return gameday;
}

/** Creates a completed gameday with a result and per-player stat rows, for standings/Hall of Fame tests. */
export async function createCompletedGameday(
  adminUserId: number,
  date: Date,
  score: { teamA: number; teamB: number },
  stats: { playerId: number; team: "A" | "B"; points: number; goalDiff: number }[]
) {
  const [gameday] = await db.insert(gamedays).values({ date, status: "COMPLETED", createdByUserId: adminUserId }).returning();
  const [result] = await db
    .insert(results)
    .values({ gamedayId: gameday.id, teamAScore: score.teamA, teamBScore: score.teamB, enteredByUserId: adminUserId })
    .returning();
  if (stats.length > 0) {
    await db.insert(playerGamedayStats).values(stats.map((s) => ({ resultId: result.id, ...s })));
  }
  return { gameday, result };
}
