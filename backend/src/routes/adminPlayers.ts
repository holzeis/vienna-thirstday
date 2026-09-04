import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { players, playerGamedayStats } from "../db/schema";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth, requireAdmin);

/**
 * All guest/placeholder players (includes both ad-hoc guests added by
 * players, and unclaimed players created by the legacy spreadsheet import) -
 * used to populate the "merge into this account" picker when approving a new
 * user. Includes a games-played count so an admin can tell "Benji (19 games)"
 * apart from someone who only ever played once as a guest.
 */
router.get(
  "/guests",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: players.id,
        name: players.name,
        gamesPlayed: sql<number>`count(${playerGamedayStats.id})`.mapWith(Number),
      })
      .from(players)
      .leftJoin(playerGamedayStats, eq(playerGamedayStats.playerId, players.id))
      .where(eq(players.isGuest, true))
      .groupBy(players.id, players.name)
      .orderBy(players.name);

    res.json({ guests: rows });
  })
);

export default router;
