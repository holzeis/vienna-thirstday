import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { pushSubscriptions } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { config } from "../config";

const router = Router();

/** Public: the frontend needs this before a user has necessarily done anything auth-gated with push. */
router.get(
  "/vapid-public-key",
  asyncHandler(async (_req, res) => {
    if (!config.vapidPublicKey) throw ApiError.notFound("Push notifications are not configured on this server");
    res.json({ publicKey: config.vapidPublicKey });
  })
);

router.use(requireAuth);

const subscribeSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Upserts by endpoint - re-subscribing the same browser/device updates its keys instead of duplicating. */
router.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid subscription payload", parsed.error.flatten());
    const { endpoint, keys } = parsed.data;

    await db
      .insert(pushSubscriptions)
      .values({ userId: req.user!.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: req.user!.userId, p256dh: keys.p256dh, auth: keys.auth },
      });

    res.status(201).json({ ok: true });
  })
);

const unsubscribeSchema = z.object({ endpoint: z.string().min(1) });

router.post(
  "/unsubscribe",
  asyncHandler(async (req, res) => {
    const parsed = unsubscribeSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid payload", parsed.error.flatten());
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
    res.json({ ok: true });
  })
);

export default router;
