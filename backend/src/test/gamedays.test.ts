import "./testDb";
import { beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import webpush from "web-push";
import { createApp } from "../app";
import { db } from "../db/client";
import { gamedays, registrations, pushSubscriptions } from "../db/schema";
import { resetDb, closeDb, createAdmin, createGuestPlayer, createOpenGameday, createCompletedGameday } from "./helpers";

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

describe("GET /gamedays", () => {
  it("numbers matchdays chronologically within each year and restarts per year", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);

    const [g2024a] = await db.insert(gamedays).values({ date: new Date("2024-01-04T19:00:00Z"), status: "COMPLETED", createdByUserId: user.id }).returning();
    const [g2024b] = await db.insert(gamedays).values({ date: new Date("2024-01-11T19:00:00Z"), status: "COMPLETED", createdByUserId: user.id }).returning();
    const [g2025a] = await db.insert(gamedays).values({ date: new Date("2025-01-02T19:00:00Z"), status: "COMPLETED", createdByUserId: user.id }).returning();

    const res = await request(app).get("/api/gamedays").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.gamedays.map((g: any) => [g.id, g.matchday]));
    expect(byId.get(g2024a.id)).toBe(1);
    expect(byId.get(g2024b.id)).toBe(2);
    expect(byId.get(g2025a.id)).toBe(1);
  });

  it("filters by ?season= while keeping matchday numbers computed across the full history", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);

    await db.insert(gamedays).values({ date: new Date("2024-06-01T19:00:00Z"), status: "COMPLETED", createdByUserId: user.id });
    const [g2025] = await db.insert(gamedays).values({ date: new Date("2025-06-01T19:00:00Z"), status: "COMPLETED", createdByUserId: user.id }).returning();

    const res = await request(app).get("/api/gamedays?season=2025").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.gamedays).toHaveLength(1);
    expect(res.body.gamedays[0].id).toBe(g2025.id);
    expect(res.body.gamedays[0].matchday).toBe(1);
  });

  it("derives the player count from registrations, not a hardcoded default", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const [gameday] = await db.insert(gamedays).values({ date: new Date(), status: "COMPLETED", createdByUserId: user.id }).returning();
    const guest = await createGuestPlayer("Robert");
    await db.insert(registrations).values({ gamedayId: gameday.id, playerId: guest.id, status: "CONFIRMED", registeredByUserId: user.id });

    const res = await request(app).get("/api/gamedays").set("Authorization", `Bearer ${token}`);
    const match = res.body.gamedays.find((g: any) => g.id === gameday.id);
    expect(match.confirmedCount).toBe(1);
  });

  it("shows CLOSED (not OPEN) once an open gameday's kickoff has passed with no result entered", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const past = await createOpenGameday(user.id, new Date(Date.now() - 1000 * 60 * 60));

    const res = await request(app).get("/api/gamedays").set("Authorization", `Bearer ${token}`);
    const match = res.body.gamedays.find((g: any) => g.id === past.id);
    expect(match.status).toBe("CLOSED");
  });
});

describe("GET /gamedays - played", () => {
  it("is true when the caller has a stat row in that gameday's result", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    await createCompletedGameday(user.id, new Date("2025-06-05T18:00:00Z"), { teamA: 4, teamB: 1 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).get("/api/gamedays").set("Authorization", `Bearer ${token}`);
    const match = res.body.gamedays.find((g: any) => g.matchday === 1);
    expect(match.played).toBe(true);
  });

  it("is false when the caller didn't play in that gameday", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Other Guy");
    await createCompletedGameday(user.id, new Date("2025-06-05T18:00:00Z"), { teamA: 4, teamB: 1 }, [
      { playerId: guest.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).get("/api/gamedays").set("Authorization", `Bearer ${token}`);
    const match = res.body.gamedays.find((g: any) => g.matchday === 1);
    expect(match.played).toBe(false);
  });
});

describe("GET /gamedays/:id", () => {
  it("shows CLOSED once an open gameday's kickoff has passed with no result entered", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const past = await createOpenGameday(user.id, new Date(Date.now() - 1000 * 60 * 60));

    const res = await request(app).get(`/api/gamedays/${past.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.body.gameday.status).toBe("CLOSED");
  });

  it("includes each registered player's current-form and previous-season-title badges", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const year = new Date().getUTCFullYear();

    // Previous season: this player is the outright (only) champion.
    await createCompletedGameday(user.id, new Date(Date.UTC(year - 1, 5, 1, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const gameday = await createOpenGameday(user.id, new Date(Date.now() + 1000 * 60 * 60 * 24));
    await request(app).post(`/api/gamedays/${gameday.id}/register`).set("Authorization", `Bearer ${token}`).send({});

    const res = await request(app).get(`/api/gamedays/${gameday.id}`).set("Authorization", `Bearer ${token}`);
    const reg = res.body.gameday.registrations.find((r: any) => r.player.id === player.id);
    expect(reg.player.previousSeasonTitle).toBe("champion");
    expect(reg.player.currentForm).toMatchObject({ veteran: false, undefeated: false, unlucky: false, ghost: false });
  });

  it("badges a registered player as a newcomer when their first-ever matchday was that same past season", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const year = new Date().getUTCFullYear();

    await createCompletedGameday(user.id, new Date(Date.UTC(year, 0, 5, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const gameday = await createOpenGameday(user.id, new Date(Date.now() + 1000 * 60 * 60 * 24));
    await request(app).post(`/api/gamedays/${gameday.id}/register`).set("Authorization", `Bearer ${token}`).send({});

    const res = await request(app).get(`/api/gamedays/${gameday.id}`).set("Authorization", `Bearer ${token}`);
    const reg = res.body.gameday.registrations.find((r: any) => r.player.id === player.id);
    expect(reg.player.isNewcomer).toBe(true);
  });
});

describe("POST /gamedays/:id/register", () => {
  it("refuses registration once an open gameday's kickoff has passed", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const past = await createOpenGameday(user.id, new Date(Date.now() - 1000 * 60 * 60));

    const res = await request(app).post(`/api/gamedays/${past.id}/register`).set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });
});

describe("push notifications to a gameday's creator on sign-up/cancel", () => {
  it("notifies the creator when someone else signs up", async () => {
    const creator = await createAdmin("Creator");
    const other = await createAdmin("Other", "password123");
    const gameday = await createOpenGameday(creator.user.id, new Date(Date.now() + 1000 * 60 * 60 * 24));
    await db.insert(pushSubscriptions).values({ userId: creator.user.id, endpoint: "https://push.example/1", p256dh: "k1", auth: "a1" });

    const otherToken = await loginAs("Other", "password123");
    vi.mocked(webpush.sendNotification).mockClear();
    const res = await request(app).post(`/api/gamedays/${gameday.id}/register`).set("Authorization", `Bearer ${otherToken}`).send({});
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(webpush.sendNotification).toHaveBeenCalled());
    const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
    expect(payload).toMatchObject({ title: "New sign-up" });
    expect(payload.body).toContain("Other");
  });

  it("does not notify the creator about their own sign-up", async () => {
    const creator = await createAdmin("Creator");
    const gameday = await createOpenGameday(creator.user.id, new Date(Date.now() + 1000 * 60 * 60 * 24));
    await db.insert(pushSubscriptions).values({ userId: creator.user.id, endpoint: "https://push.example/1", p256dh: "k1", auth: "a1" });

    const token = await loginAs("Creator", creator.password);
    vi.mocked(webpush.sendNotification).mockClear();
    const res = await request(app).post(`/api/gamedays/${gameday.id}/register`).set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(201);

    // Give any stray async notification a moment to fire before asserting none did.
    await new Promise((r) => setTimeout(r, 50));
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("notifies the creator when someone else cancels", async () => {
    const creator = await createAdmin("Creator");
    const other = await createAdmin("Other", "password123");
    const gameday = await createOpenGameday(creator.user.id, new Date(Date.now() + 1000 * 60 * 60 * 24));
    await db.insert(pushSubscriptions).values({ userId: creator.user.id, endpoint: "https://push.example/1", p256dh: "k1", auth: "a1" });

    const otherToken = await loginAs("Other", "password123");
    await request(app).post(`/api/gamedays/${gameday.id}/register`).set("Authorization", `Bearer ${otherToken}`).send({});
    const reg = await db.query.registrations.findFirst({ where: (r, { eq }) => eq(r.playerId, other.player.id) });

    vi.mocked(webpush.sendNotification).mockClear();
    const res = await request(app)
      .delete(`/api/gamedays/${gameday.id}/register/${reg!.id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(204);

    await vi.waitFor(() => expect(webpush.sendNotification).toHaveBeenCalled());
    const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
    expect(payload).toMatchObject({ title: "Cancellation" });
    expect(payload.body).toContain("Other");
  });

  it("does not notify the creator about cancelling their own registration", async () => {
    const creator = await createAdmin("Creator");
    const gameday = await createOpenGameday(creator.user.id, new Date(Date.now() + 1000 * 60 * 60 * 24));
    await db.insert(pushSubscriptions).values({ userId: creator.user.id, endpoint: "https://push.example/1", p256dh: "k1", auth: "a1" });

    const token = await loginAs("Creator", creator.password);
    await request(app).post(`/api/gamedays/${gameday.id}/register`).set("Authorization", `Bearer ${token}`).send({});
    const reg = await db.query.registrations.findFirst({ where: (r, { eq }) => eq(r.playerId, creator.player.id) });

    vi.mocked(webpush.sendNotification).mockClear();
    const res = await request(app).delete(`/api/gamedays/${gameday.id}/register/${reg!.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    await new Promise((r) => setTimeout(r, 50));
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
