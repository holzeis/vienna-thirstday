import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { resetDb, closeDb, createAdmin, createGuestPlayer, createCompletedGameday } from "./helpers";

const app = createApp();

beforeEach(resetDb);
afterAll(closeDb);

async function loginAs(name: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ name, password });
  return res.body.token as string;
}

describe("GET /:year/standings", () => {
  it("includes guest players in the ranked list, flagged via isGuest", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");

    await createCompletedGameday(user.id, new Date("2025-06-05T18:00:00Z"), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
      { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
    ]);

    const res = await request(app).get("/api/seasons/2025/standings").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.standings.map((s: any) => [s.playerId, s]));
    expect(byId.get(player.id)).toMatchObject({ isGuest: false, points: 4 });
    expect(byId.get(guest.id)).toMatchObject({ isGuest: true, points: 1 });
  });

  it("ranks guests and registered players together by points, then goal difference", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");

    await createCompletedGameday(user.id, new Date("2025-06-05T18:00:00Z"), { teamA: 2, teamB: 5 }, [
      { playerId: player.id, team: "A", points: 1, goalDiff: -3 },
      { playerId: guest.id, team: "B", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).get("/api/seasons/2025/standings").set("Authorization", `Bearer ${token}`);
    expect(res.body.standings[0]).toMatchObject({ playerId: guest.id, rank: 1 });
    expect(res.body.standings[1]).toMatchObject({ playerId: player.id, rank: 2 });
  });
});
