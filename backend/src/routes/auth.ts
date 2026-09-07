import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db/client";
import { users, players } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { signToken } from "../utils/jwt";
import { ApiError } from "../utils/errors";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { recordAccessEvent } from "../services/accessEventService";

const router = Router();

// There is no self-service registration. Accounts are created only by
// accepting an admin-issued invite (see routes/invites.ts) - that's what
// replaces both a register endpoint and any pending-approval step.

/** True if some OTHER account-linked player already has this name (case-insensitive). Unclaimed guests never collide - only login disambiguation matters here. */
export async function nameTakenByAnotherPlayer(name: string, excludePlayerId: number): Promise<boolean> {
  const row = await db
    .select({ id: players.id })
    .from(players)
    .innerJoin(users, eq(users.playerId, players.id))
    .where(sql`lower(${players.name}) = lower(${name}) and ${players.id} != ${excludePlayerId}`)
    .limit(1);
  return row.length > 0;
}

const loginSchema = z.object({
  // Historically just the player name - now also accepts the account's
  // email, since not everyone remembers which one they registered with.
  name: z.string().min(1),
  password: z.string().min(1),
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid login data");
    }
    const { name, password } = parsed.data;

    const [match] = await db
      .select({ user: users, playerName: players.name })
      .from(users)
      .innerJoin(players, eq(users.playerId, players.id))
      .where(sql`lower(${players.name}) = lower(${name}) or lower(${users.email}) = lower(${name})`)
      .limit(1);
    if (!match) {
      throw ApiError.unauthorized("Invalid name/email or password");
    }
    const valid = await bcrypt.compare(password, match.user.passwordHash);
    if (!valid) {
      throw ApiError.unauthorized("Invalid name/email or password");
    }

    const token = signToken({ userId: match.user.id, isAdmin: match.user.isAdmin });
    await recordAccessEvent({
      req,
      eventType: "LOGIN",
      isGuest: false,
      playerId: match.user.playerId,
      playerName: match.playerName,
      userId: match.user.id,
    });
    res.json({ token, user: sanitizeUser(match.user) });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.userId),
      with: { player: true },
    });
    if (!user) throw ApiError.notFound("User not found");
    res.json({ user: sanitizeUser(user), player: (user as any).player ?? null });
  })
);

const updateMeSchema = z.object({
  name: z.string().min(1, "Name is required").max(255).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters").optional(),
});

/** Self-service account settings: name (own player, must be unique), email (optional), and/or password. */
router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid update", parsed.error.flatten());
    const { name, email, currentPassword, newPassword } = parsed.data;

    const user = await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) });
    if (!user) throw ApiError.notFound("User not found");

    if (newPassword) {
      if (!currentPassword) throw ApiError.badRequest("Current password is required to set a new password");
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) throw ApiError.unauthorized("Current password is incorrect");
    }

    const normalizedEmail = email?.toLowerCase();
    if (normalizedEmail && normalizedEmail !== user.email) {
      const existing = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
      if (existing && existing.id !== user.id) throw ApiError.conflict("An account with this email already exists");
    }

    if (name && user.playerId && (await nameTakenByAnotherPlayer(name, user.playerId))) {
      throw ApiError.conflict("This name is already taken");
    }

    await db.transaction(async (tx) => {
      const userUpdates: Record<string, unknown> = {};
      if (normalizedEmail) userUpdates.email = normalizedEmail;
      if (newPassword) userUpdates.passwordHash = await bcrypt.hash(newPassword, 10);
      if (Object.keys(userUpdates).length > 0) {
        userUpdates.updatedAt = new Date();
        await tx.update(users).set(userUpdates).where(eq(users.id, user.id));
      }
      if (name && user.playerId) {
        await tx.update(players).set({ name }).where(eq(players.id, user.playerId));
      }
    });

    const updated = await db.query.users.findFirst({ where: eq(users.id, user.id), with: { player: true } });
    res.json({ user: sanitizeUser(updated!), player: (updated as any).player ?? null });
  })
);

export function sanitizeUser(user: typeof users.$inferSelect) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export default router;
