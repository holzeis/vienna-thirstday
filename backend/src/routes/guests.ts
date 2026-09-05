import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { players } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";

const router = Router();

router.use(requireAuth);

/**
 * List every guest player system-wide (imported-from-spreadsheet guests
 * included), not just ones the current user personally added - the "bring a
 * guest" picker needs to find any existing guest by name to avoid creating a
 * duplicate for someone who already exists in the system.
 */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const guests = await db.query.players.findMany({
      where: eq(players.isGuest, true),
      orderBy: (p, { asc }) => asc(p.name),
    });
    res.json({ guests });
  })
);

const createGuestSchema = z.object({
  name: z.string().min(1).max(255),
});

/**
 * Finds an existing guest by exact (case-insensitive) name, or creates a new
 * one - never a silent duplicate for a name that already exists.
 */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createGuestSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid guest data");
    const name = parsed.data.name.trim();

    const existing = await db.query.players.findFirst({
      where: and(eq(players.isGuest, true), sql`lower(${players.name}) = lower(${name})`),
    });
    if (existing) {
      res.status(200).json({ guest: existing });
      return;
    }

    const [guest] = await db.insert(players).values({ name, isGuest: true, addedByUserId: req.user!.userId }).returning();
    res.status(201).json({ guest });
  })
);

/** Delete a guest profile the current user owns (only if not used anywhere yet is not enforced; FK cascade rules apply). */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const guest = await db.query.players.findFirst({ where: eq(players.id, id) });
    if (!guest || !guest.isGuest) throw ApiError.notFound("Guest not found");
    if (guest.addedByUserId !== req.user!.userId && !req.user!.isAdmin) {
      throw ApiError.forbidden("You can only remove guests you added");
    }
    await db.delete(players).where(eq(players.id, id));
    res.status(204).send();
  })
);

export default router;
