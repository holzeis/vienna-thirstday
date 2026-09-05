import { Router } from "express";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { gamedays, playerGamedayStats, players, results } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { computeCurrentForm, computeMomentum, fetchStatRows } from "../services/playerStatsService";

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

/** Points/goal-diff-ranked, non-guest players for gamedays in [from, to). */
async function fetchRanked(from: Date, to: Date) {
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
    .where(and(eq(players.isGuest, false), gte(gamedays.date, from), lt(gamedays.date, to)))
    .groupBy(players.id, players.name)
    .orderBy(sql`sum(${playerGamedayStats.points}) desc`, sql`sum(${playerGamedayStats.goalDiff}) desc`);

  return rows.map((r, index) => ({ rank: index + 1, ...r }));
}

/** Season standings: points then goal-difference, registered (non-guest) players only. */
router.get(
  "/:year/standings",
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const seasonStart = new Date(Date.UTC(year, 0, 1));
    const seasonEnd = new Date(Date.UTC(year + 1, 0, 1));

    const standings = await fetchRanked(seasonStart, seasonEnd);

    // Momentum: rank movement caused specifically by the most recent
    // gameday - compare against the standings as they stood immediately
    // before it. A player absent from that "before" snapshot (their season
    // debut) has nothing to compare against.
    const [mostRecent] = await db
      .select({ date: gamedays.date })
      .from(gamedays)
      .innerJoin(results, eq(gamedays.id, results.gamedayId))
      .where(and(gte(gamedays.date, seasonStart), lt(gamedays.date, seasonEnd)))
      .orderBy(sql`${gamedays.date} desc`)
      .limit(1);

    let beforeRankByPlayer = new Map<number, number>();
    if (mostRecent) {
      const before = await fetchRanked(seasonStart, mostRecent.date);
      beforeRankByPlayer = new Map(before.map((r) => [r.playerId, r.rank]));
    }

    // Current form (Locker Room) badges reflect the live league state, not
    // this season's history, so they're computed from all-time rows
    // regardless of which season tab is being viewed.
    const allRows = await fetchStatRows(db);

    const standingsWithExtras = standings.map((s) => ({
      ...s,
      momentum: computeMomentum(beforeRankByPlayer.get(s.playerId), s.rank),
      currentForm: computeCurrentForm(allRows, s.playerId),
    }));

    res.json({ year, standings: standingsWithExtras });
  })
);

export default router;
