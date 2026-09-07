import "./testDb";
import { beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { db } from "../db/client";
import { resetDb, closeDb, createAdmin, createOpenGameday } from "./helpers";

const app = createApp();

beforeEach(resetDb);
afterAll(closeDb);

const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

async function findLatestAccessEvent() {
  return vi.waitFor(async () => {
    const row = await db.query.accessEvents.findFirst({ orderBy: (t, { desc }) => desc(t.id) });
    expect(row).toBeDefined();
    return row!;
  });
}

describe("POST /auth/login records an access event", () => {
  it("records a LOGIN event with the parsed user agent and standalone flag", async () => {
    const { player, user, password } = await createAdmin();

    const res = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", IOS_SAFARI_UA)
      .set("X-Standalone", "1")
      .send({ name: "Admin", password });
    expect(res.status).toBe(200);

    const row = await findLatestAccessEvent();
    expect(row).toMatchObject({
      eventType: "LOGIN",
      isGuest: false,
      playerId: player.id,
      playerName: player.name,
      userId: user.id,
      os: "iOS",
      browser: "Safari",
      deviceType: "mobile",
      isPwa: true,
      userAgent: IOS_SAFARI_UA,
    });
  });

  it("records isPwa as null (not false) when the client sends no X-Standalone header", async () => {
    const { password } = await createAdmin();

    await request(app).post("/api/auth/login").send({ name: "Admin", password });

    const row = await findLatestAccessEvent();
    expect(row.isPwa).toBeNull();
  });

  it("does not record an event for a failed login", async () => {
    await createAdmin();
    await request(app).post("/api/auth/login").send({ name: "Admin", password: "wrong-password" });

    await new Promise((r) => setTimeout(r, 50));
    const row = await db.query.accessEvents.findFirst();
    expect(row).toBeUndefined();
  });
});

describe("GET /auth/me records an access event", () => {
  it("records an APP_OPEN event on every call, not just after a fresh login", async () => {
    const { player, user, password } = await createAdmin();
    const token = (await request(app).post("/api/auth/login").send({ name: "Admin", password })).body.token as string;

    const res = await request(app)
      .get("/api/auth/me")
      .set("User-Agent", IOS_SAFARI_UA)
      .set("X-Standalone", "1")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const row = await findLatestAccessEvent();
    expect(row).toMatchObject({
      eventType: "APP_OPEN",
      isGuest: false,
      playerId: player.id,
      playerName: player.name,
      userId: user.id,
      os: "iOS",
      isPwa: true,
    });
  });

  it("does not record an event for an unauthenticated request", async () => {
    await request(app).get("/api/auth/me");

    await new Promise((r) => setTimeout(r, 50));
    const row = await db.query.accessEvents.findFirst();
    expect(row).toBeUndefined();
  });
});

describe("POST /gameday-share/:token/register-guest records an access event", () => {
  it("records a GUEST_REGISTER event with no linked user", async () => {
    const { user, password } = await createAdmin();
    const token = (await request(app).post("/api/auth/login").send({ name: "Admin", password })).body.token as string;
    const gameday = await createOpenGameday(user.id, new Date(Date.now() + 24 * 60 * 60 * 1000));
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`)
      .set("X-Standalone", "0")
      .send({ name: "Robert" });
    expect(res.status).toBe(201);

    const row = await findLatestAccessEvent();
    expect(row).toMatchObject({
      eventType: "GUEST_REGISTER",
      isGuest: true,
      playerId: res.body.playerId,
      playerName: "Robert",
      userId: null,
      isPwa: false,
    });
  });
});
