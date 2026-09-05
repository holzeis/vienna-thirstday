import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { gamedays, players, registrations, results, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { sanitizeUser } from "./auth";
import { mergeGuestIntoPlayer, undoPlayerMerge } from "../services/playerMergeService";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const statusFilter = req.query.status as string | undefined;
    const all = await db.query.users.findMany({ with: { player: true } });
    const filtered = statusFilter ? all.filter((u) => u.status === statusFilter) : all;
    res.json({ users: filtered.map((u) => ({ ...sanitizeUser(u), player: (u as any).player })) });
  })
);

const approveSchema = z.object({
  // Optional: id of an existing guest/placeholder player (e.g. one created by
  // the legacy spreadsheet import) whose history should be merged into this
  // user's own player profile as part of approving them.
  mergeGuestPlayerId: z.number().int().optional(),
});

router.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw ApiError.badRequest("Invalid approve payload", parsed.error.flatten());

    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw ApiError.notFound("User not found");

    const updated = await db.transaction(async (tx) => {
      if (parsed.data.mergeGuestPlayerId !== undefined) {
        if (!user.playerId) {
          throw ApiError.badRequest("This user has no player profile to merge into");
        }
        await mergeGuestIntoPlayer(tx, parsed.data.mergeGuestPlayerId!, user.playerId, req.user!.userId);
      }
      const [u] = await tx
        .update(users)
        .set({ status: "APPROVED", updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      return u;
    });

    res.json({ user: sanitizeUser(updated) });
  })
);

router.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const [updated] = await db.update(users).set({ status: "REJECTED", updatedAt: new Date() }).where(eq(users.id, id)).returning();
    if (!updated) throw ApiError.notFound("User not found");
    res.json({ user: sanitizeUser(updated) });
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
 * those rows reference the user with a not-null foreign key by design (real
 * league history shouldn't cascade-delete with an account), so a clean
 * "reject" is the right move for revoking access from an active account.
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
        "This user has activity on the platform (gamedays, results, or registrations) and can't be deleted. Reject them instead to remove access."
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
