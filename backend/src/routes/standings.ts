import { Router } from "express";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { gamedays, playerGamedayStats, players, results } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth);

/** List season years (Jan 1 - Dec 31) that have at least one completed result. */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({ date: gamedays.date })
      .from(gamedays)
      .innerJoin(results, eq(gamedays.id, results.gamedayId));

    const years = Array.from(new Set(rows.map((r) => r.date.getUTCFullYear()))).sort((a, b) => b - a);
    res.json({ seasons: years });
  })
);

/** Season standings: points then goal-difference, registered (non-guest) players only. */
router.get(
  "/:year/standings",
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const seasonStart = new Date(Date.UTC(year, 0, 1));
    const seasonEnd = new Date(Date.UTC(year + 1, 0, 1));

    const rows = await db
      .select({
        playerId: players.id,
        name: players.name,
        points: sql<number>`sum(${playerGamedayStats.points})`.mapWith(Number),
        goalDiff: sql<number>`sum(${playerGamedayStats.goalDiff})`.mapWith(Number),
        gamesPlayed: sql<number>`count(*)`.mapWith(Number),
      })
      .from(playerGamedayStats)
      .innerJoin(results, eq(playerGamedayStats.resultId, results.id))
      .innerJoin(gamedays, eq(results.gamedayId, gamedays.id))
      .innerJoin(players, eq(playerGamedayStats.playerId, players.id))
      .where(and(eq(players.isGuest, false), gte(gamedays.date, seasonStart), lt(gamedays.date, seasonEnd)))
      .groupBy(players.id, players.name)
      .orderBy(sql`sum(${playerGamedayStats.points}) desc`, sql`sum(${playerGamedayStats.goalDiff}) desc`);

    const standings = rows.map((r, index) => ({ rank: index + 1, ...r }));
    res.json({ year, standings });
  })
);

export default router;
