import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { players } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";

const router = Router();

router.use(requireAuth);

/** List guest profiles created by the current user. */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const guests = await db.query.players.findMany({
      where: and(eq(players.isGuest, true), eq(players.addedByUserId, req.user!.userId)),
      orderBy: (p, { asc }) => asc(p.name),
    });
    res.json({ guests });
  })
);

const createGuestSchema = z.object({
  name: z.string().min(1).max(255),
});

/** Create a new reusable guest profile owned by the current user. */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createGuestSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid guest data");

    const [guest] = await db
      .insert(players)
      .values({ name: parsed.data.name, isGuest: true, addedByUserId: req.user!.userId })
      .returning();
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
