import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { passwordResetTokens, users } from "../db/schema";
import { signToken } from "../utils/jwt";
import { ApiError } from "../utils/errors";
import { asyncHandler } from "../utils/asyncHandler";
import { sanitizeUser } from "./auth";

const router = Router();

/**
 * Public - anyone with a valid token, no auth. An admin generates the link
 * from the "Reset password" button on the user (see adminUsers.ts's POST
 * /:id/reset-link); whoever holds it proves they're the intended person
 * just by having it, same trust model as an invite link. Re-checked here
 * and again in the POST below, since a link can sit open in a browser tab
 * past expiry.
 */
async function loadValidResetToken(token: string) {
  const resetToken = await db.query.passwordResetTokens.findFirst({ where: eq(passwordResetTokens.token, token) });
  if (!resetToken) throw ApiError.notFound("Reset link not found");
  if (resetToken.usedAt) throw ApiError.gone("This reset link has already been used. Ask an admin for a new one.");
  if (resetToken.expiresAt.getTime() < Date.now()) throw ApiError.gone("This reset link has expired. Ask an admin for a new one.");
  return resetToken;
}

router.get(
  "/:token",
  asyncHandler(async (req, res) => {
    await loadValidResetToken(req.params.token);
    res.json({ valid: true });
  })
);

const resetSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

router.post(
  "/:token",
  asyncHandler(async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid password", parsed.error.flatten());

    const resetToken = await loadValidResetToken(req.params.token);
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    const user = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, resetToken.userId))
        .returning();
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, resetToken.id));
      return updated;
    });

    // Same UX as accepting an invite - log them straight in with the new
    // password rather than sending them to the login page to re-enter it.
    const authToken = signToken({ userId: user.id, isAdmin: user.isAdmin });
    res.json({ token: authToken, user: sanitizeUser(user) });
  })
);

export default router;
