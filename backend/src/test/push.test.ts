import "./testDb";
import { beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { createApp } from "../app";
import { db } from "../db/client";
import { pushSubscriptions } from "../db/schema";
import { resetDb, closeDb, createAdmin } from "./helpers";

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
