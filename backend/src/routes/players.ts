import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { db } from "../db/client";
import { players, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import {
  computeCareerStats,
  computeCurrentForm,
  computePersonalAwards,
  computePlayerSeasonAwards,
  computeTeammateTally,
  fetchStatRows,
} from "../services/playerStatsService";

const router = Router();

router.use(requireAuth);

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

    const awards = [...computePersonalAwards(career, !!linkedUser?.isAdmin), ...computePlayerSeasonAwards(allRows, id)];
    const currentForm = computeCurrentForm(allRows, id);

    // Teammates card reflects current form too - scoped to this player's own
    // last 5 played games, not their whole career.
    const lastFiveGamedayIds = new Set(
      [...myRows].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(-5).map((r) => r.gamedayId)
    );
    const formRows = allRows.filter((r) => lastFiveGamedayIds.has(r.gamedayId));
    const teammates = computeTeammateTally(formRows, id);

    res.json({
      player: {
        id: player.id,
        name: player.name,
        isGuest: player.isGuest,
        avatarDataUri: player.avatarData
          ? `data:${player.avatarMimeType || "image/jpeg"};base64,${player.avatarData}`
          : null,
        // A real member's join date is when their account was registered;
        // guests/unmerged imports have no account, so fall back to when
        // their player record was first created.
        joinedAt: linkedUser?.createdAt ?? player.createdAt,
      },
      awards,
      currentForm,
      teammates,
    });
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, or WebP images are allowed"));
  },
});

/** Upload/replace a player's avatar. Only the linked user (or an admin) may do this. */
router.put(
  "/:id/avatar",
  (req, res, next) => {
    upload.single("avatar")(req, res, (err) => {
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
      // .rotate() with no args applies the EXIF orientation tag (phone cameras
      // store the sensor image unrotated and just flag how to display it) then
      // strips it, so the resize/crop below operates on the upright image.
      resized = await sharp(file.buffer).rotate().resize(256, 256, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
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
