import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { players, playerGamedayStats } from "../db/schema";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { undoPlayerMerge } from "../services/playerMergeService";

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

/** Guest-into-player merge history, so an admin can spot and undo a wrong one. */
router.get(
  "/merges",
  asyncHandler(async (_req, res) => {
    const merges = await db.query.playerMerges.findMany({
      with: { targetPlayer: true, mergedBy: true },
      orderBy: (m, { desc }) => desc(m.createdAt),
    });
    res.json({
      merges: merges.map((m) => ({
        id: m.id,
        guestPlayerName: m.guestPlayerName,
        targetPlayer: { id: m.targetPlayer.id, name: m.targetPlayer.name },
        mergedBy: { id: m.mergedBy.id, email: m.mergedBy.email },
        undoneAt: m.undoneAt,
        createdAt: m.createdAt,
      })),
    });
  })
);

/** Reverses a merge: recreates the guest and moves back exactly the rows that were reassigned. */
router.post(
  "/merges/:id/undo",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const restored = await db.transaction((tx) => undoPlayerMerge(tx, id));
    res.json({ guest: restored });
  })
);

export default router;
