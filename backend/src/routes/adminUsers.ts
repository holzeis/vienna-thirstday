import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { players, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { sanitizeUser } from "./auth";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const all = await db.query.users.findMany({ with: { player: true } });
    res.json({ users: all.map((u) => ({ ...sanitizeUser(u), player: (u as any).player })) });
  })
);

const rolesSchema = z.object({
  isAdmin: z.boolean().optional(),
});

router.patch(
  "/:id/roles",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = rolesSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid roles payload");

    const [updated] = await db
      .update(users)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!updated) throw ApiError.notFound("User not found");
    res.json({ user: sanitizeUser(updated) });
  })
);

/**
 * Deletes a user's login - email, password, and (via cascade) push
 * subscriptions - but never their player's history. If they have a linked
 * player, it's reverted to a guest (isGuest -> true, same as an unused
 * invite being revoked) rather than touched: every registration, team
 * assignment, and gameday stat stays exactly as it was, still pointing at
 * that same player, so this never affects any other player's stats either.
 * An admin can re-invite that guest later, or attach it to a different
 * account via the merge tool, exactly like any other guest.
 *
 * Every other place a deleted user is referenced - who created a gameday,
 * entered a result, registered someone, issued/accepted an invite, or
 * performed a merge - has that attribution set to null rather than blocking
 * the deletion (see the `onDelete: "set null"` on each of those columns in
 * schema.ts); the record itself (the gameday, the result, the registration,
 * the invite, the merge log) is untouched, just anonymized.
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.user!.userId) throw ApiError.badRequest("You can't delete your own account");

    const target = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!target) throw ApiError.notFound("User not found");

    if (target.isAdmin) {
      const admins = await db.query.users.findMany({ where: eq(users.isAdmin, true) });
      if (admins.length <= 1) throw ApiError.badRequest("Can't delete the last remaining admin");
    }

    await db.transaction(async (tx) => {
      if (target.playerId) {
        await tx.update(players).set({ isGuest: true }).where(eq(players.id, target.playerId));
      }
      await tx.update(players).set({ addedByUserId: null }).where(eq(players.addedByUserId, id));
      await tx.delete(users).where(eq(users.id, id));
    });

    res.status(204).send();
  })
);

export default router;
