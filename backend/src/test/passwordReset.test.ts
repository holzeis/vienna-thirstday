import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { db } from "../db/client";
import { passwordResetTokens, players, users } from "../db/schema";
import { resetDb, closeDb, createAdmin } from "./helpers";

const app = createApp();

beforeEach(resetDb);
afterAll(closeDb);

async function loginAs(name: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ name, password });
  return res.body.token as string;
}

async function createNonAdmin(name: string, password = "oldpassword1") {
  const passwordHash = await bcrypt.hash(password, 10);
  const [player] = await db.insert(players).values({ name, isGuest: false }).returning();
  const [user] = await db.insert(users).values({ passwordHash, isAdmin: false, playerId: player.id }).returning();
  return { user, player, password };
}

describe("POST /admin/users/:id/reset-link", () => {
  it("requires admin auth", async () => {
    const { user: target } = await createNonAdmin("Target");
    const res = await request(app).post(`/api/admin/users/${target.id}/reset-link`);
    expect(res.status).toBe(401);
  });

  it("generates a token that expires about an hour from now", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const { user: target } = await createNonAdmin("Target");

    const before = Date.now();
    const res = await request(app).post(`/api/admin/users/${target.id}/reset-link`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");

    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before + 59 * 60 * 1000);
    expect(expiresAt).toBeLessThan(before + 61 * 60 * 1000);

    const row = await db.query.passwordResetTokens.findFirst({ where: eq(passwordResetTokens.token, res.body.token) });
    expect(row?.userId).toBe(target.id);
    expect(row?.usedAt).toBeNull();
  });

  it("404s for a nonexistent user", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const res = await request(app).post("/api/admin/users/999999/reset-link").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("invalidates the previous link when a new one is generated", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const { user: target } = await createNonAdmin("Target");

    const first = await request(app).post(`/api/admin/users/${target.id}/reset-link`).set("Authorization", `Bearer ${token}`);
    const second = await request(app).post(`/api/admin/users/${target.id}/reset-link`).set("Authorization", `Bearer ${token}`);
    expect(first.body.token).not.toBe(second.body.token);

    const oldRow = await db.query.passwordResetTokens.findFirst({ where: eq(passwordResetTokens.token, first.body.token) });
    expect(oldRow).toBeUndefined();

    const checkOld = await request(app).get(`/api/password-reset/${first.body.token}`);
    expect(checkOld.status).toBe(404);

    const checkNew = await request(app).get(`/api/password-reset/${second.body.token}`);
    expect(checkNew.status).toBe(200);
  });
});

describe("password reset (public token flow)", () => {
  it("404s on GET/POST for an unknown token", async () => {
    const getRes = await request(app).get("/api/password-reset/does-not-exist");
    expect(getRes.status).toBe(404);
    const postRes = await request(app).post("/api/password-reset/does-not-exist").send({ password: "newpassword1" });
    expect(postRes.status).toBe(404);
  });

  it("sets a new password, logs the user in, and lets them log in again with it - old password stops working", async () => {
    const { password: adminPassword } = await createAdmin();
    const adminToken = await loginAs("Admin", adminPassword);
    const { user: target, password: oldPassword } = await createNonAdmin("Target");

    const genRes = await request(app).post(`/api/admin/users/${target.id}/reset-link`).set("Authorization", `Bearer ${adminToken}`);
    const resetToken = genRes.body.token as string;

    const postRes = await request(app).post(`/api/password-reset/${resetToken}`).send({ password: "brandnewpassword1" });
    expect(postRes.status).toBe(200);
    expect(postRes.body.token).toBeTruthy();
    expect(postRes.body.user.id).toBe(target.id);

    const oldLogin = await request(app).post("/api/auth/login").send({ name: "Target", password: oldPassword });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post("/api/auth/login").send({ name: "Target", password: "brandnewpassword1" });
    expect(newLogin.status).toBe(200);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const { password: adminPassword } = await createAdmin();
    const adminToken = await loginAs("Admin", adminPassword);
    const { user: target } = await createNonAdmin("Target");
    const genRes = await request(app).post(`/api/admin/users/${target.id}/reset-link`).set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app).post(`/api/password-reset/${genRes.body.token}`).send({ password: "short" });
    expect(res.status).toBe(400);
  });

  it("is single-use - a second attempt with the same token fails", async () => {
    const { password: adminPassword } = await createAdmin();
    const adminToken = await loginAs("Admin", adminPassword);
    const { user: target } = await createNonAdmin("Target");
    const genRes = await request(app).post(`/api/admin/users/${target.id}/reset-link`).set("Authorization", `Bearer ${adminToken}`);
    const resetToken = genRes.body.token as string;

    const first = await request(app).post(`/api/password-reset/${resetToken}`).send({ password: "brandnewpassword1" });
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/password-reset/${resetToken}`).send({ password: "anotherpassword1" });
    expect(second.status).toBe(410);
  });

  it("rejects an expired token", async () => {
    const { password: adminPassword } = await createAdmin();
    const adminToken = await loginAs("Admin", adminPassword);
    const { user: target } = await createNonAdmin("Target");
    const genRes = await request(app).post(`/api/admin/users/${target.id}/reset-link`).set("Authorization", `Bearer ${adminToken}`);
    const resetToken = genRes.body.token as string;

    await db
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetTokens.token, resetToken));

    const getRes = await request(app).get(`/api/password-reset/${resetToken}`);
    expect(getRes.status).toBe(410);

    const postRes = await request(app).post(`/api/password-reset/${resetToken}`).send({ password: "brandnewpassword1" });
    expect(postRes.status).toBe(410);
  });
});
