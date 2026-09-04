import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../utils/jwt";
import { ApiError } from "../utils/errors";

/** Verifies the JWT if present and attaches req.user. Does not require auth. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length);
    try {
      req.user = verifyToken(token);
    } catch {
      // ignore invalid token for optional auth
    }
  }
  next();
}

/** Requires a valid JWT. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw ApiError.unauthorized("Missing bearer token");
  }
  const token = header.slice("Bearer ".length);
  try {
    req.user = verifyToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired token");
  }
  next();
}

/** Requires the authenticated user to have the Admin role. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    throw ApiError.unauthorized();
  }
  if (!req.user.isAdmin) {
    throw ApiError.forbidden("Admin role required");
  }
  next();
}
