import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Extracted so the keying logic is unit-testable without going through
 * express-rate-limit/supertest. Falls back through ipKeyGenerator (not raw
 * req.ip) so an IPv6 address gets normalized to its /56 subnet first -
 * without that, express-rate-limit logs an ERR_ERL_KEY_GEN_IPV6 validation
 * warning on every startup, since a bare IPv6 address defeats rate limiting
 * (an attacker can cycle through addresses within their own /64 for free).
 */
export function loginRateLimitKey(req: Pick<Request, "body" | "ip">): string {
  const name = String(req.body?.name ?? "").trim().toLowerCase();
  if (name) return name;
  return req.ip ? ipKeyGenerator(req.ip) : "unknown";
}

/**
 * Throttles POST /auth/login. Keyed by the submitted name/email rather than
 * source IP: the app sits behind two proxy hops in production (ingress-nginx,
 * then the frontend nginx container - see k8s/ingress.yaml and
 * frontend/nginx/default.conf.template) but only one locally in
 * docker-compose, so there's no single `trust proxy` hop count that's
 * correct in both places, and getting it wrong either lets an attacker spoof
 * X-Forwarded-For past the limit or collapses every real user onto one
 * shared bucket (since Express's default req.ip would otherwise just be the
 * nearest proxy's IP for everyone). Keying by account instead sidesteps
 * that entirely and directly targets the actual threat - credential
 * guessing against one account - regardless of network topology.
 *
 * Skipped in tests: the same in-memory store persists for a whole test
 * file's app instance, and plenty of files log in as "Admin" dozens of
 * times (see backend/src/test/*.test.ts), which isn't the behavior being
 * tested here.
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginRateLimitKey,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many login attempts. Please try again later." },
});
