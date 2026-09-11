import { Router } from "express";
import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { players, playerGamedayStats, results, gamedays } from "../db/schema";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { mergeGuestIntoPlayer, undoPlayerMerge } from "../services/playerMergeService";

const router = Router();

router.use(requireAuth, requireAdmin);

/**
 * All guest/placeholder players (includes both ad-hoc guests added by
 * players, and unclaimed players created by the legacy spreadsheet import) -
 * used to populate the "merge into this account" picker when approving a new
 * user. Includes a games-played count so an admin can tell "Benji (19 games)"
 * apart from someone who only ever played once as a guest, and the list of
 * seasons they actually have games in - so the merge form's season picker
 * only ever offers a year that guest could plausibly be merged for.
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

    const guestIds = rows.map((r) => r.id);
    const seasonsByPlayer = new Map<number, number[]>();
    if (guestIds.length > 0) {
      const seasonRows = await db
        .selectDistinct({
          playerId: playerGamedayStats.playerId,
          year: sql<number>`extract(year from ${gamedays.date})`.mapWith(Number),
        })
        .from(playerGamedayStats)
        .innerJoin(results, eq(playerGamedayStats.resultId, results.id))
        .innerJoin(gamedays, eq(results.gamedayId, gamedays.id))
        .where(inArray(playerGamedayStats.playerId, guestIds));

      for (const { playerId, year } of seasonRows) {
        const list = seasonsByPlayer.get(playerId);
        if (list) list.push(year);
        else seasonsByPlayer.set(playerId, [year]);
      }
    }

    res.json({
      guests: rows.map((r) => ({ ...r, seasons: (seasonsByPlayer.get(r.id) ?? []).sort((a, b) => b - a) })),
    });
  })
);

const mergeSchema = z.object({
  guestPlayerId: z.number().int(),
  // Omitted = merge the guest's whole history; otherwise scopes the merge
  // to just that calendar year, leaving the rest on the guest.
  season: z.number().int().optional(),
});

/**
 * Attaches an unclaimed guest's history to an already-existing (account-linked)
 * player - e.g. a guest imported from the legacy spreadsheet under a name the
 * player has since changed, so the importer created a fresh duplicate instead
 * of matching their real account. Unlike the invite flow (which promotes a
 * guest into a brand-new account), this is for a target that's already claimed.
 */
router.post(
  "/:targetPlayerId/merge",
  asyncHandler(async (req, res) => {
    const targetPlayerId = parseInt(req.params.targetPlayerId, 10);
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid merge payload", parsed.error.flatten());

    const target = await db.query.players.findFirst({ where: eq(players.id, targetPlayerId) });
    if (!target) throw ApiError.notFound("Target player not found");
    if (target.isGuest) throw ApiError.badRequest("Target must be an already-claimed player, not a guest");

    await db.transaction((tx) =>
      mergeGuestIntoPlayer(tx, parsed.data.guestPlayerId, targetPlayerId, req.user!.userId, parsed.data.season)
    );
    res.json({ ok: true });
  })
);

/** Guest-into-player merge history, so an admin can spot and undo a wrong one. */
router.get(
  "/merges",
  asyncHandler(async (_req, res) => {
    const merges = await db.query.playerMerges.findMany({
      with: { targetPlayer: true, mergedBy: { with: { player: true } } },
      orderBy: (m, { desc }) => desc(m.createdAt),
    });
    res.json({
      merges: merges.map((m) => ({
        id: m.id,
        guestPlayerName: m.guestPlayerName,
        // Null = the guest's whole history was merged.
        season: m.season,
        targetPlayer: { id: m.targetPlayer.id, name: m.targetPlayer.name },
        // Null once the admin who performed this merge is later deleted -
        // the merge log itself (and its undo capability) is unaffected.
        // Name, not email - every account has one, but email is optional.
        mergedBy: m.mergedBy ? { id: m.mergedBy.id, name: m.mergedBy.player?.name ?? null } : null,
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
