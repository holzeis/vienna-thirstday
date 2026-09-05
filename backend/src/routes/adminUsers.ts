import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { gamedays, players, registrations, results, users } from "../db/schema";
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
 * Deletes a user account. Refuses to touch accounts with any activity
 * history (created a gameday, entered a result, or registered someone) -
 * those rows reference the user with a not-null foreign key by design, so
 * real league history can't silently cascade-delete with an account.
 * Guest players this user introduced survive, just ownerless.
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

    const [hasGameday, hasResult, hasRegistration] = await Promise.all([
      db.query.gamedays.findFirst({ where: eq(gamedays.createdByUserId, id) }),
      db.query.results.findFirst({ where: eq(results.enteredByUserId, id) }),
      db.query.registrations.findFirst({ where: eq(registrations.registeredByUserId, id) }),
    ]);
    if (hasGameday || hasResult || hasRegistration) {
      throw ApiError.badRequest(
        "This user has activity on the platform (gamedays, results, or registrations) and can't be deleted, since that would break real game history."
      );
    }

    await db.transaction(async (tx) => {
      await tx.update(players).set({ addedByUserId: null }).where(eq(players.addedByUserId, id));
      await tx.delete(users).where(eq(users.id, id));
    });

    res.status(204).send();
  })
);

export default router;
