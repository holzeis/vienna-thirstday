import "./testDb";
import { beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { createApp } from "../app";
import { db } from "../db/client";
import { gamedays } from "../db/schema";
import { resetDb, closeDb, createAdmin, createOpenGameday } from "./helpers";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

const app = createApp();

beforeEach(() => {
  vi.mocked(webpush.sendNotification).mockClear();
  return resetDb();
});
afterAll(closeDb);

async function loginAs(name: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ name, password });
  return res.body.token as string;
}

const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000);
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
// Earlier the same calendar day - kickoff has passed (so effectively CLOSED)
// but not a past *local day* yet, so the link itself hasn't expired (410).
const EARLIER_TODAY = new Date(Date.now() - 60 * 60 * 1000);

describe("POST /gamedays/:id/share-link", () => {
  it("generates a token, and returns the same one on a second call", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW);

    const first = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.shareToken).toEqual(expect.any(String));

    const second = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);
    expect(second.body.shareToken).toBe(first.body.shareToken);
  });
});

describe("GET /gameday-share/:token", () => {
  it("returns a public summary for a valid, not-yet-happened link", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW, { minPlayers: 8, maxPlayers: 14 });
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    const res = await request(app).get(`/api/gameday-share/${shareRes.body.shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.gameday).toMatchObject({
      id: gameday.id,
      status: "OPEN",
      minPlayers: 8,
      maxPlayers: 14,
      confirmedCount: 0,
      waitlistedCount: 0,
      confirmed: [],
      waitlisted: [],
      myStatus: null,
    });
  });

  it("lists who's confirmed/waitlisted by name, and reports myStatus for a given playerId", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW, { minPlayers: 1, maxPlayers: 2 });
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    const first = await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Robert" });
    const second = await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Alice" });
    expect(first.body.status).toBe("CONFIRMED");
    expect(second.body.status).toBe("WAITLISTED"); // past minPlayers, waits to pair up with a 3rd

    const res = await request(app).get(`/api/gameday-share/${shareRes.body.shareToken}?playerId=${second.body.playerId}`);
    expect(res.body.gameday.confirmed).toEqual([{ name: "Robert", isGuest: true }]);
    expect(res.body.gameday.waitlisted).toEqual([{ name: "Alice", isGuest: true }]);
    expect(res.body.gameday.myStatus).toBe("WAITLISTED");
  });

  it("reports myStatus null for a playerId with no registration here", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW);
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    const res = await request(app).get(`/api/gameday-share/${shareRes.body.shareToken}?playerId=999999`);
    expect(res.body.gameday.myStatus).toBeNull();
  });

  it("404s for an unknown token", async () => {
    const res = await request(app).get("/api/gameday-share/not-a-real-token");
    expect(res.status).toBe(404);
  });

  it("410s once the matchday's local day has passed", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, THREE_DAYS_AGO);
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    const res = await request(app).get(`/api/gameday-share/${shareRes.body.shareToken}`);
    expect(res.status).toBe(410);
  });

  it("shows CLOSED (not OPEN) once kickoff has passed today, even though the link itself hasn't expired", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, EARLIER_TODAY);
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    const res = await request(app).get(`/api/gameday-share/${shareRes.body.shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.gameday.status).toBe("CLOSED");
  });
});

describe("GET /gameday-share/:token/guests", () => {
  it("lists existing guest names, excluding anyone already registered for this gameday", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW);
    const otherGameday = await createOpenGameday(user.id, new Date(TOMORROW.getTime() + 24 * 60 * 60 * 1000));
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    // Robert exists system-wide (registered for a different gameday) - should still be suggested here.
    const otherShareRes = await request(app).post(`/api/gamedays/${otherGameday.id}/share-link`).set("Authorization", `Bearer ${token}`);
    await request(app).post(`/api/gameday-share/${otherShareRes.body.shareToken}/register-guest`).send({ name: "Robert" });
    // Alice is already registered for *this* gameday - should be excluded.
    await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Alice" });

    const res = await request(app).get(`/api/gameday-share/${shareRes.body.shareToken}/guests`);
    expect(res.status).toBe(200);
    expect(res.body.names).toEqual(["Robert"]);
  });

  it("404s for an unknown token", async () => {
    const res = await request(app).get("/api/gameday-share/not-a-real-token/guests");
    expect(res.status).toBe(404);
  });
});

describe("POST /gameday-share/:token/register-guest", () => {
  it("registers a new guest by name, no auth required", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW);
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    const res = await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Robert" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("CONFIRMED");

    const guest = await db.query.players.findFirst({ where: (p, { eq, and }) => and(eq(p.name, "Robert"), eq(p.isGuest, true)) });
    expect(guest).toBeDefined();
    expect(res.body.playerId).toBe(guest!.id);
    const reg = await db.query.registrations.findFirst({ where: (r, { eq }) => eq(r.playerId, guest!.id) });
    expect(reg?.status).toBe("CONFIRMED");
  });

  it("rejects a second sign-up under the same name while already registered", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW);
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);
    await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Robert" });

    const res = await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Robert" });
    expect(res.status).toBe(409);
  });

  it("refuses sign-up once the gameday is no longer OPEN, even if the date hasn't passed", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW);
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);
    await db.update(gamedays).set({ status: "CANCELLED" }).where(eq(gamedays.id, gameday.id));

    const res = await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Robert" });
    expect(res.status).toBe(400);
  });

  it("refuses sign-up once kickoff has passed today, even though the raw status is still OPEN", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, EARLIER_TODAY);
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    const res = await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Robert" });
    expect(res.status).toBe(400);
  });

  it("notifies an already-confirmed real player when a share-link guest sign-up crosses minPlayers", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, TOMORROW, { minPlayers: 2, maxPlayers: 14 });
    const shareRes = await request(app).post(`/api/gamedays/${gameday.id}/share-link`).set("Authorization", `Bearer ${token}`);

    // The admin registers themselves first (confirmed count 1, below minPlayers 2).
    await request(app).post(`/api/gamedays/${gameday.id}/register`).set("Authorization", `Bearer ${token}`).send({});

    const { pushSubscriptions } = await import("../db/schema");
    await db.insert(pushSubscriptions).values({ userId: user.id, endpoint: "https://push.example/1", p256dh: "k1", auth: "a1" });
    vi.mocked(webpush.sendNotification).mockClear();

    // The guest's share-link sign-up is the 2nd registration, crossing minPlayers 2 -
    // the admin (a guest has no account/subscription to notify) should get "confirmed".
    const res = await request(app).post(`/api/gameday-share/${shareRes.body.shareToken}/register-guest`).send({ name: "Robert" });

    expect(res.status).toBe(201);
    // Notification dispatch is fire-and-forget - the response doesn't wait for it.
    await vi.waitFor(() => expect(webpush.sendNotification).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
    expect(payload).toMatchObject({ title: "Matchday confirmed" });
  });
});
