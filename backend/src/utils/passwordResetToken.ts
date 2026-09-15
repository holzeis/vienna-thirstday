import crypto from "crypto";

/**
 * A long, URL-safe, unguessable token for an admin-issued password-reset
 * link - same shape as an invite token (see utils/inviteToken.ts), since
 * this is the only credential needed to set a new password.
 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// Short-lived by design - unlike an invite, this is issued to recover from a
// forgotten password right now, not to be sent ahead of time.
export const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;

export function resetTokenExpiry(): Date {
  return new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);
}
