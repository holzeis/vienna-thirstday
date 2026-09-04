import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db/client";
import { users, players } from "../db/schema";
import { eq } from "drizzle-orm";
import { signToken } from "../utils/jwt";
import { ApiError } from "../utils/errors";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(255),
});

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid registration data", parsed.error.flatten());
    }
    const { email, password, name } = parsed.data;

    const existing = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
    if (existing) {
      throw ApiError.conflict("An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.transaction(async (tx) => {
      const [player] = await tx.insert(players).values({ name, isGuest: false }).returning();
      const [user] = await tx
        .insert(users)
        .values({
          email: email.toLowerCase(),
          passwordHash,
          status: "PENDING",
          isAdmin: false,
          isPlayer: true,
          playerId: player.id,
        })
        .returning();
      return { user, player };
    });

    res.status(201).json({
      message: "Registration received. An admin needs to approve your account before you can log in.",
      user: sanitizeUser(result.user),
    });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid login data");
    }
    const { email, password } = parsed.data;

    const user = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
    if (!user) {
      throw ApiError.unauthorized("Invalid email or password");
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw ApiError.unauthorized("Invalid email or password");
    }
    if (user.status === "PENDING") {
      throw ApiError.forbidden("Your account is still pending admin approval");
    }
    if (user.status === "REJECTED") {
      throw ApiError.forbidden("Your account registration was rejected");
    }

    const token = signToken({ userId: user.id, isAdmin: user.isAdmin, isPlayer: user.isPlayer });
    res.json({ token, user: sanitizeUser(user) });
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

export function sanitizeUser(user: typeof users.$inferSelect) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export default router;
