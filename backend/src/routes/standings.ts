import { Router } from "express";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { gamedays, playerGamedayStats, players, results } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import {
  computeCurrentForm,
  computeIsNewcomer,
  computeMomentum,
  computeSeasonPodiums,
  fetchStatRows,
  type CurrentForm,
} from "../services/playerStatsService";

const router = Router();

const NO_CURRENT_FORM: CurrentForm = { veteran: false, undefeated: false, unlucky: false, ghost: false };

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

/** Points/goal-diff-ranked players (guests included, flagged via isGuest) for gamedays in [from, to). */
async function fetchRanked(from: Date, to: Date) {
  const rows = await db
    .select({
      playerId: players.id,
      name: players.name,
      isGuest: players.isGuest,
      points: sql<number>`sum(${playerGamedayStats.points})`.mapWith(Number),
      goalDiff: sql<number>`sum(${playerGamedayStats.goalDiff})`.mapWith(Number),
      gamesPlayed: sql<number>`count(*)`.mapWith(Number),
    })
    .from(playerGamedayStats)
    .innerJoin(results, eq(playerGamedayStats.resultId, results.id))
    .innerJoin(gamedays, eq(results.gamedayId, gamedays.id))
    .innerJoin(players, eq(playerGamedayStats.playerId, players.id))
    .where(and(gte(gamedays.date, from), lt(gamedays.date, to)))
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
    // debut) has nothing to compare against. Only meaningful for the season
    // that's still ongoing - a past, concluded season has no "since the last
    // matchday" to speak of, so it's left as "new" (no arrow) for every row.
    const isCurrentSeason = year === new Date().getUTCFullYear();
    let beforeRankByPlayer = new Map<number, number>();
    if (isCurrentSeason) {
      const [mostRecent] = await db
        .select({ date: gamedays.date })
        .from(gamedays)
        .innerJoin(results, eq(gamedays.id, results.gamedayId))
        .where(and(gte(gamedays.date, seasonStart), lt(gamedays.date, seasonEnd)))
        .orderBy(sql`${gamedays.date} desc`)
        .limit(1);

      if (mostRecent) {
        const before = await fetchRanked(seasonStart, mostRecent.date);
        beforeRankByPlayer = new Map(before.map((r) => [r.playerId, r.rank]));
      }
    }

    // Current form (Locker Room) badges reflect the live league state, so
    // - like momentum - they only make sense while looking at the current,
    // ongoing season; a past season shows none of them.
    const allRows = isCurrentSeason ? await fetchStatRows(db) : null;

    // Champion/vice-champion badge: whoever topped the season immediately
    // before the one being viewed - relative to `year`, not always "last
    // year", so browsing a past season correctly shows who held the title
    // going into *that* season rather than always the most recent one.
    const previousSeasonRows = await fetchStatRows(db, { year: year - 1 });
    const previousRanking = computeSeasonPodiums(previousSeasonRows).ranking;
    const previousChampionId = previousRanking.gold?.playerId ?? null;
    const previousViceChampionId = previousRanking.silver?.playerId ?? null;

    const standingsWithExtras = standings.map((s) => ({
      ...s,
      momentum: computeMomentum(beforeRankByPlayer.get(s.playerId), s.rank),
      currentForm: allRows ? computeCurrentForm(allRows, s.playerId) : NO_CURRENT_FORM,
      // Newcomer is also a live/"as of today" fact (their first-ever game
      // being this calendar year), not something that made sense to ask
      // about a past, concluded season - same current-season gate as
      // currentForm above.
      isNewcomer: allRows ? computeIsNewcomer(allRows.filter((r) => r.playerId === s.playerId)) : false,
      previousSeasonTitle:
        s.playerId === previousChampionId ? "champion" : s.playerId === previousViceChampionId ? "viceChampion" : null,
    }));

    res.json({ year, standings: standingsWithExtras });
  })
);

export default router;
