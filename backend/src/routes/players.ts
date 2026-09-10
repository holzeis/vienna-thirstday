import { Router } from "express";
import { db } from "../db/client";
import { players, users } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { avatarUpload, resizeAvatar } from "../utils/avatarUpload";
import {
  computeCareerStats,
  computeCurrentForm,
  computeDreamTeamMate,
  computeFavoriteVictim,
  computeIsNewcomer,
  computeNemesis,
  computeOnFireStreak,
  computePersonalAwards,
  computePlayerSeasonAwards,
  computeTeammateTally,
  fetchStatRows,
  groupRowsByYear,
  recentLeagueGamedayIds,
  type AwardTier,
} from "../services/playerStatsService";

const AWARD_TIER_RANK: Record<AwardTier, number> = { gold: 0, silver: 1, bronze: 2, wood: 3 };

const router = Router();

router.use(requireAuth);

function avatarDataUri(row: { avatarData: string | null; avatarMimeType: string | null }): string | null {
  return row.avatarData ? `data:${row.avatarMimeType || "image/jpeg"};base64,${row.avatarData}` : null;
}

type HasAvatarSlot = { playerId: number; avatarDataUri: string | null };

/**
 * Attaches each record's profile picture - the Locker Room card uses it as
 * that tile's visual anchor. Takes a named bag of nullable records (e.g.
 * `{favorite, unfavorite, mostPlayedWith, nemesis}`) and batches a single
 * lookup for every distinct player involved.
 */
async function attachAvatars<T extends Record<string, HasAvatarSlot | null>>(records: T): Promise<T> {
  const ids = Object.values(records)
    .map((r) => r?.playerId)
    .filter((id): id is number => id !== undefined);
  if (ids.length === 0) return records;

  const rows = await db.query.players.findMany({ where: inArray(players.id, Array.from(new Set(ids))) });
  const byId = new Map(rows.map((r) => [r.id, avatarDataUri(r)]));

  const result = { ...records };
  for (const key of Object.keys(records) as (keyof T)[]) {
    const rec = records[key];
    if (rec) result[key] = { ...rec, avatarDataUri: byId.get(rec.playerId) ?? null } as T[keyof T];
  }
  return result;
}

/** List all registered (non-guest) players - used for admin team assignment, guest pickers, etc. */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const all = await db.query.players.findMany({
      where: eq(players.isGuest, false),
      orderBy: (p, { asc }) => asc(p.name),
    });
    res.json({ players: all });
  })
);

/** A player's earned awards (lifetime + per completed season), current form, and teammate tallies. */
router.get(
  "/:id/profile",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const player = await db.query.players.findFirst({ where: eq(players.id, id) });
    if (!player) throw ApiError.notFound("Player not found");

    const linkedUser = await db.query.users.findFirst({ where: eq(users.playerId, id) });

    const allRows = await fetchStatRows(db);
    const myRows = allRows.filter((r) => r.playerId === id);
    const career = computeCareerStats(myRows);

    const awards = [...computePersonalAwards(career), ...computePlayerSeasonAwards(allRows, id)].sort(
      (a, b) => AWARD_TIER_RANK[a.tier] - AWARD_TIER_RANK[b.tier]
    );
    const currentForm = computeCurrentForm(allRows, id);
    const onFireStreak = computeOnFireStreak(myRows);
    const isNewcomer = computeIsNewcomer(myRows);

    // Teammate chemistry reflects the same "recent" window as the current-form
    // badges - the league's actual last 5 gamedays, not this player's own
    // last 5 played games (which could reach further back for someone who
    // plays sporadically).
    const recentGamedayIds = new Set(recentLeagueGamedayIds(allRows));
    const formRows = allRows.filter((r) => recentGamedayIds.has(r.gamedayId));
    // Dream Team is deliberately season-scoped rather than the last-5-gamedays
    // window - a "best pairing" only means much measured within one season.
    const currentYear = new Date().getUTCFullYear();
    const seasonRows = groupRowsByYear(allRows).get(currentYear) ?? [];
    const { favorite, unfavorite, mostPlayedWith, dreamTeam, nemesis, favoriteVictim } = await attachAvatars({
      ...computeTeammateTally(formRows, id),
      dreamTeam: computeDreamTeamMate(seasonRows, id),
      nemesis: computeNemesis(formRows, id),
      favoriteVictim: computeFavoriteVictim(formRows, id),
    });
    const teammates = { favorite, unfavorite, mostPlayedWith, dreamTeam };

    res.json({
      player: {
        id: player.id,
        name: player.name,
        isGuest: player.isGuest,
        isAdmin: !!linkedUser?.isAdmin,
        avatarDataUri: avatarDataUri(player),
        // The date they first appeared on a completed matchday (earliest
        // player_gameday_stats row) - this is what "joined" the league
        // actually means to the group, not account/player-record creation
        // (which can predate their first game, e.g. an admin-created guest,
        // or lag behind it for a historical import). Falls back to
        // account/player creation for someone who hasn't played yet.
        joinedAt: myRows[0]?.date ?? linkedUser?.createdAt ?? player.createdAt,
      },
      awards,
      currentForm,
      onFireStreak,
      isNewcomer,
      teammates,
      nemesis,
      favoriteVictim,
    });
  })
);

/** Upload/replace a player's avatar. Only the linked user (or an admin) may do this. */
router.put(
  "/:id/avatar",
  (req, res, next) => {
    avatarUpload.single("avatar")(req, res, (err) => {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE" ? "Image is too large - please use one under 10MB" : err.message || "Invalid upload";
        return next(ApiError.badRequest(message));
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!req.user!.isAdmin) {
      const me = await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) });
      if (me?.playerId !== id) throw ApiError.forbidden("You can only update your own avatar");
    }

    const file = req.file;
    if (!file) throw ApiError.badRequest("No image file provided");

    let resized: Buffer;
    try {
      resized = await resizeAvatar(file.buffer);
    } catch {
      throw ApiError.badRequest("Could not process image - is it a valid JPEG, PNG, or WebP file?");
    }

    const [updated] = await db
      .update(players)
      .set({ avatarData: resized.toString("base64"), avatarMimeType: "image/jpeg" })
      .where(eq(players.id, id))
      .returning();
    if (!updated) throw ApiError.notFound("Player not found");

    res.json({ player: updated });
  })
);

export default router;
