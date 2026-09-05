import crypto from "crypto";

/**
 * A long, URL-safe, unguessable token for an onboarding invite - 32 random
 * bytes (256 bits) base64url-encoded to ~43 characters. This is the only
 * credential needed to accept an invite, so it has to be infeasible to
 * guess or enumerate.
 */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export const INVITE_DEFAULT_EXPIRY_DAYS = 7;

export function defaultInviteExpiry(days: number = INVITE_DEFAULT_EXPIRY_DAYS): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
