import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { invites, players, users } from "../db/schema";
import { signToken } from "../utils/jwt";
import { ApiError } from "../utils/errors";
import { asyncHandler } from "../utils/asyncHandler";
import { avatarUpload, resizeAvatar } from "../utils/avatarUpload";
import { nameTakenByAnotherPlayer, sanitizeUser } from "./auth";

const router = Router();

/**
 * Public - anyone with a valid token, no auth. This is the only way to
 * create an account: an admin issues the invite (see adminInvites.ts) and
 * whoever holds the link proves they're the intended person just by having
 * it. Re-checked here and again in /accept, since a link can sit open in a
 * browser tab well past being revoked or expiring.
 */
async function loadValidInvite(token: string) {
  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
    with: { guestPlayer: true },
  });
  if (!invite) throw ApiError.notFound("Invite not found");
  if (invite.revokedAt) throw ApiError.gone("This invite has been revoked. Ask an admin for a new one.");
  if (invite.usedAt) throw ApiError.gone("This invite has already been used.");
  if (invite.expiresAt.getTime() < Date.now()) throw ApiError.gone("This invite has expired. Ask an admin for a new one.");
  return invite;
}

router.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const invite = await loadValidInvite(req.params.token);
    res.json({
      guest: { id: invite.guestPlayer.id, name: invite.guestPlayer.name },
    });
  })
);

const acceptSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  // multer hands multipart fields through as strings, and a browser form
  // that left this blank sends an empty string rather than omitting it -
  // accept "" as "not provided" alongside a real email.
  email: z.union([z.string().email(), z.literal("")]).optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * multer parses multipart fields into strings on req.body (matching the
 * plain-JSON shape acceptSchema expects) alongside the optional file on
 * req.file - no separate JSON vs. multipart branching needed.
 */
router.post(
  "/:token/accept",
  (req, res, next) => {
    avatarUpload.single("avatar")(req, res, (err) => {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE" ? "Image is too large - please use one under 10MB" : err.message || "Invalid upload";
        return next(ApiError.badRequest(message));
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid onboarding data", parsed.error.flatten());
    const { name, email, password } = parsed.data;

    const invite = await loadValidInvite(req.params.token);

    if (await nameTakenByAnotherPlayer(name, invite.guestPlayerId)) {
      throw ApiError.conflict("This name is already taken");
    }

    const normalizedEmail = email ? email.toLowerCase() : undefined;
    if (normalizedEmail) {
      const existing = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
      if (existing) throw ApiError.conflict("An account with this email already exists");
    }

    let resizedAvatar: Buffer | null = null;
    if (req.file) {
      try {
        resizedAvatar = await resizeAvatar(req.file.buffer);
      } catch {
        throw ApiError.badRequest("Could not process image - is it a valid JPEG, PNG, or WebP file?");
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await db.transaction(async (tx) => {
      // The guest player IS the account - no new player, no merge. It was
      // already promoted (isGuest -> false) when the invite was created.
      await tx
        .update(players)
        .set({
          name,
          ...(resizedAvatar ? { avatarData: resizedAvatar.toString("base64"), avatarMimeType: "image/jpeg" } : {}),
        })
        .where(eq(players.id, invite.guestPlayerId));

      const [createdUser] = await tx
        .insert(users)
        .values({
          email: normalizedEmail || null,
          passwordHash,
          isAdmin: false,
          playerId: invite.guestPlayerId,
        })
        .returning();

      await tx.update(invites).set({ usedAt: new Date(), usedByUserId: createdUser.id }).where(eq(invites.id, invite.id));

      return createdUser;
    });

    const token = signToken({ userId: user.id, isAdmin: user.isAdmin });
    res.status(201).json({ token, user: sanitizeUser(user) });
  })
);

export default router;
