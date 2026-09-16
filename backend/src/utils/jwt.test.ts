import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { config } from "../config";
import { signToken, verifyToken } from "./jwt";

describe("signToken / verifyToken", () => {
  it("round-trips a payload", () => {
    const token = signToken({ userId: 1, isAdmin: false });
    expect(verifyToken(token)).toMatchObject({ userId: 1, isAdmin: false });
  });

  it("rejects a token signed with a different algorithm than the one verifyToken pins", () => {
    // Simulates an algorithm-confusion attack: a token that's otherwise
    // validly signed with the right secret, but under an algorithm
    // verifyToken doesn't accept.
    const token = jwt.sign({ userId: 1, isAdmin: true }, config.jwtSecret, { algorithm: "HS384" });
    expect(() => verifyToken(token)).toThrow();
  });

  it("rejects the unsigned 'alg: none' token forgery", () => {
    const forged = jwt.sign({ userId: 1, isAdmin: true }, "", { algorithm: "none" });
    expect(() => verifyToken(forged)).toThrow();
  });
});
