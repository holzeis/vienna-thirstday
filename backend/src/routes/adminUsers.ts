import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { sanitizeUser } from "./auth";
import { mergeGuestIntoPlayer } from "../services/playerMergeService";

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
        await mergeGuestIntoPlayer(tx, parsed.data.mergeGuestPlayerId!, user.playerId);
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
  isPlayer: z.boolean().optional(),
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

export default router;
