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

describe("GET /hall-of-fame", () => {
  it("lets a guest win a podium spot, flagged via isGuest, for a completed season", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const lastYear = new Date().getUTCFullYear() - 1;

    await createCompletedGameday(user.id, new Date(Date.UTC(lastYear, 5, 5, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: guest.id, team: "A", points: 4, goalDiff: 3 },
      { playerId: player.id, team: "B", points: 1, goalDiff: -3 },
    ]);

    const res = await request(app).get(`/api/hall-of-fame?year=${lastYear}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.podiums.ranking.gold).toMatchObject({ playerId: guest.id, isGuest: true });
    expect(res.body.podiums.ranking.silver).toMatchObject({ playerId: player.id, isGuest: false });
  });
});
