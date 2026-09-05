import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { db } from "../db/client";
import { players, playerGamedayStats } from "../db/schema";
import { resetDb, closeDb, createAdmin, createGuestPlayer, createCompletedGameday } from "./helpers";

const app = createApp();

beforeEach(resetDb);
afterAll(closeDb);

async function loginAs(name: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ name, password });
  return res.body.token as string;
}

describe("POST /admin/players/:targetPlayerId/merge", () => {
  it("attaches a guest's history to an already-claimed player and removes the guest", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Richi");

    await createCompletedGameday(user.id, new Date("2025-06-05T18:00:00Z"), { teamA: 5, teamB: 2 }, [
      { playerId: guest.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app)
      .post(`/api/admin/players/${player.id}/merge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ guestPlayerId: guest.id });

    expect(res.status).toBe(200);

    const remainingGuest = await db.query.players.findFirst({ where: eq(players.id, guest.id) });
    expect(remainingGuest).toBeUndefined();

    const movedStats = await db.query.playerGamedayStats.findMany({ where: eq(playerGamedayStats.playerId, player.id) });
    expect(movedStats).toHaveLength(1);
    expect(movedStats[0].points).toBe(4);
  });

  it("rejects merging into a target that is itself still a guest", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Richi");
    const otherGuest = await createGuestPlayer("Marco");

    const res = await request(app)
      .post(`/api/admin/players/${otherGuest.id}/merge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ guestPlayerId: guest.id });

    expect(res.status).toBe(400);
  });

  it("rejects merging a non-guest player as the source", async () => {
    const { player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const otherAdmin = await createAdmin("SecondAdmin");

    const res = await request(app)
      .post(`/api/admin/players/${player.id}/merge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ guestPlayerId: otherAdmin.player.id });

    expect(res.status).toBe(400);
  });
});
