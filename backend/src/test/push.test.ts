import "./testDb";
import { beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { createApp } from "../app";
import { db } from "../db/client";
import { pushSubscriptions } from "../db/schema";
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
  vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as never);
  return resetDb();
});
afterAll(closeDb);

async function loginAs(name: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ name, password });
  return res.body.token as string;
}

/** A player+user with a push subscription, ready to be registered for a gameday by playerId. */
async function createSubscribedCandidate(index: number) {
  const { player, user } = await createAdmin(`Candidate${index}`, "password123");
  const endpoint = `https://push.example/candidate${index}`;
  await db.insert(pushSubscriptions).values({ userId: user.id, endpoint, p256dh: `k${index}`, auth: `a${index}` });
  return { player, user, endpoint };
}

async function registerCandidate(token: string, gamedayId: number, playerId: number) {
  const res = await request(app)
    .post(`/api/gamedays/${gamedayId}/register`)
    .set("Authorization", `Bearer ${token}`)
    .send({ playerId });
  expect(res.status).toBe(201);
}

function payloadsSent(): { title: string; body: string; url?: string }[] {
  return vi.mocked(webpush.sendNotification).mock.calls.map(([, body]) => JSON.parse(body as string));
}

function endpointsNotified(): string[] {
  return vi.mocked(webpush.sendNotification).mock.calls.map(([sub]) => (sub as { endpoint: string }).endpoint);
}

describe("GET /push/vapid-public-key", () => {
  it("returns the configured public key", async () => {
    const res = await request(app).get("/api/push/vapid-public-key");
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe(process.env.VAPID_PUBLIC_KEY);
  });
});

describe("POST /push/subscribe and /push/unsubscribe", () => {
  it("creates a subscription for the authenticated user", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);

    const res = await request(app)
      .post("/api/push/subscribe")
      .set("Authorization", `Bearer ${token}`)
      .send({ endpoint: "https://push.example/abc", keys: { p256dh: "p256dh-key", auth: "auth-key" } });

    expect(res.status).toBe(201);
    const rows = await db.query.pushSubscriptions.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: "https://push.example/abc", p256dh: "p256dh-key", auth: "auth-key" });
  });

  it("upserts by endpoint instead of duplicating on re-subscribe", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const body = { endpoint: "https://push.example/abc", keys: { p256dh: "old-key", auth: "auth-key" } };

    await request(app).post("/api/push/subscribe").set("Authorization", `Bearer ${token}`).send(body);
    await request(app)
      .post("/api/push/subscribe")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...body, keys: { ...body.keys, p256dh: "new-key" } });

    const rows = await db.query.pushSubscriptions.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("new-key");
  });

  it("removes a subscription by endpoint", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    await request(app)
      .post("/api/push/subscribe")
      .set("Authorization", `Bearer ${token}`)
      .send({ endpoint: "https://push.example/abc", keys: { p256dh: "p256dh-key", auth: "auth-key" } });

    const res = await request(app)
      .post("/api/push/unsubscribe")
      .set("Authorization", `Bearer ${token}`)
      .send({ endpoint: "https://push.example/abc" });

    expect(res.status).toBe(200);
    expect(await db.query.pushSubscriptions.findMany()).toHaveLength(0);
  });
});

describe("POST /gamedays notifies subscribed devices", () => {
  it("sends a push notification to every existing subscription", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    await db.insert(pushSubscriptions).values([
      { userId: user.id, endpoint: "https://push.example/1", p256dh: "k1", auth: "a1" },
      { userId: user.id, endpoint: "https://push.example/2", p256dh: "k2", auth: "a2" },
    ]);

    const res = await request(app)
      .post("/api/gamedays")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2026-09-10T19:00:00.000Z" });

    expect(res.status).toBe(201);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    const [subArg, payloadArg] = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(subArg.endpoint).toMatch(/^https:\/\/push\.example\//);
    const payload = JSON.parse(payloadArg as string);
    expect(payload).toMatchObject({ title: "New matchday posted", url: `/gamedays/${res.body.gameday.id}` });
  });

  it("prunes a subscription the push service reports as gone (410)", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    await db.insert(pushSubscriptions).values({ userId: user.id, endpoint: "https://push.example/dead", p256dh: "k", auth: "a" });
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 });

    const res = await request(app).post("/api/gamedays").set("Authorization", `Bearer ${token}`).send({ date: "2026-09-10T19:00:00.000Z" });

    expect(res.status).toBe(201);
    const remaining = await db.query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.endpoint, "https://push.example/dead") });
    expect(remaining).toBeUndefined();
  });
});

describe("registration threshold notifications", () => {
  it("notifies every confirmed player once the count reaches minPlayers, but not before", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, new Date("2026-09-24T19:00:00Z"), { minPlayers: 8, maxPlayers: 14 });
    const candidates: Awaited<ReturnType<typeof createSubscribedCandidate>>[] = [];
    for (let i = 1; i <= 8; i++) candidates.push(await createSubscribedCandidate(i));

    for (let i = 0; i < 7; i++) await registerCandidate(token, gameday.id, candidates[i].player.id);
    expect(webpush.sendNotification).not.toHaveBeenCalled();

    await registerCandidate(token, gameday.id, candidates[7].player.id);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(8);
    expect(payloadsSent()[0]).toMatchObject({ title: "Matchday confirmed", url: `/gamedays/${gameday.id}` });
    expect(endpointsNotified().sort()).toEqual(candidates.map((c) => c.endpoint).sort());
  });

  it("notifies the remaining confirmed players when a cancellation drops below minPlayers", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, new Date("2026-09-24T19:00:00Z"), { minPlayers: 8, maxPlayers: 14 });
    const candidates: Awaited<ReturnType<typeof createSubscribedCandidate>>[] = [];
    for (let i = 1; i <= 8; i++) candidates.push(await createSubscribedCandidate(i));
    for (const c of candidates) await registerCandidate(token, gameday.id, c.player.id);

    const detail = await request(app).get(`/api/gamedays/${gameday.id}`).set("Authorization", `Bearer ${token}`);
    const toCancel = detail.body.gameday.registrations.find((r: any) => r.player.id === candidates[0].player.id);
    vi.mocked(webpush.sendNotification).mockClear();

    const res = await request(app).delete(`/api/gamedays/${gameday.id}/register/${toCancel.id}`).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(7);
    expect(payloadsSent()[0]).toMatchObject({ title: "Matchday at risk" });
    expect(endpointsNotified().sort()).toEqual(candidates.slice(1).map((c) => c.endpoint).sort());
  });

  it("notifies only the player promoted off the waitlist, with no false status-change alert", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(user.id, new Date("2026-09-24T19:00:00Z"), { minPlayers: 8, maxPlayers: 14 });
    const candidates: Awaited<ReturnType<typeof createSubscribedCandidate>>[] = [];
    for (let i = 1; i <= 9; i++) candidates.push(await createSubscribedCandidate(i));
    for (const c of candidates) await registerCandidate(token, gameday.id, c.player.id);

    const detail = await request(app).get(`/api/gamedays/${gameday.id}`).set("Authorization", `Bearer ${token}`);
    const regs = detail.body.gameday.registrations;
    const waitlisted = regs.find((r: any) => r.status === "WAITLISTED");
    expect(waitlisted).toBeDefined();
    const toCancel = regs.find((r: any) => r.status === "CONFIRMED" && r.player.id !== waitlisted.player.id);
    vi.mocked(webpush.sendNotification).mockClear();

    const res = await request(app).delete(`/api/gamedays/${gameday.id}/register/${toCancel.id}`).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
    // Confirmed count stays at 8 (the waitlisted player backfills the cancelled
    // spot) - only the promotion notification should fire, no status-change one.
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(payloadsSent()[0]).toMatchObject({ title: "You're in!" });
    const promoted = candidates.find((c) => c.player.id === waitlisted.player.id)!;
    expect(endpointsNotified()).toEqual([promoted.endpoint]);
  });
});
