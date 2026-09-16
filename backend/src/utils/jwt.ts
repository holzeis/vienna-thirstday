import jwt from "jsonwebtoken";
import { config } from "../config";

export interface JwtPayload {
  userId: number;
  isAdmin: boolean;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any, algorithm: "HS256" });
}

// Pinning the algorithm here (rather than trusting the token's own `alg`
// header) closes the classic "alg: none" / algorithm-confusion class of JWT
// attacks - jsonwebtoken already defends against those, but pinning is a
// cheap explicit guarantee that isn't dependent on that library behavior.
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as JwtPayload;
}
