import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { sanitizeUser } from "./auth";

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

router.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const [updated] = await db.update(users).set({ status: "APPROVED", updatedAt: new Date() }).where(eq(users.id, id)).returning();
    if (!updated) throw ApiError.notFound("User not found");
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
