import { Router } from "express";
import { db } from "../db/client";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { computeSeasonPodiums, fetchStatRows, type PodiumAward, type SeasonAwardCategory } from "../services/playerStatsService";

const router = Router();

router.use(requireAuth);

const EMPTY_PODIUMS: Record<SeasonAwardCategory, PodiumAward> = {
  ranking: { gold: null, silver: null, bronze: null },
  mostGames: { gold: null, silver: null, bronze: null },
  mostGoals: { gold: null, silver: null, bronze: null },
  longestWinStreak: { gold: null, silver: null, bronze: null },
  longestLossStreak: { gold: null, silver: null, bronze: null },
};

/**
 * Podium (gold/silver/bronze, always exactly one winner per medal) per
 * competitive category for one completed season. A season isn't "complete"
 * until the calendar year has ended, so requesting the current (or a
 * future) year always comes back empty rather than crowning a mid-season
 * leader.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const currentYear = new Date().getUTCFullYear();
    const yearParam = req.query.year as string | undefined;
    const year = yearParam ? parseInt(yearParam, 10) : currentYear - 1;

    if (year >= currentYear) {
      return res.json({ year, seasonComplete: false, podiums: EMPTY_PODIUMS });
    }

    const rows = await fetchStatRows(db, { year });
    const podiums = computeSeasonPodiums(rows.filter((r) => !r.isGuest));

    res.json({ year, seasonComplete: true, podiums });
  })
);

export default router;
