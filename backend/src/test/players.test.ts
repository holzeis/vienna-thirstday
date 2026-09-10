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

describe("GET /players/:id/profile joinedAt", () => {
  it("uses the date of their first completed matchday, not their account creation date", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const firstGameday = new Date("2020-03-05T18:00:00Z");

    await createCompletedGameday(user.id, firstGameday, { teamA: 5, teamB: 2 }, [{ playerId: player.id, team: "A", points: 4, goalDiff: 3 }]);

    const res = await request(app).get(`/api/players/${player.id}/profile`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(new Date(res.body.player.joinedAt).toISOString()).toBe(firstGameday.toISOString());
    // Sanity check this genuinely differs from the account's own creation date.
    expect(new Date(res.body.player.joinedAt).toISOString()).not.toBe(new Date(user.createdAt).toISOString());
  });

  it("uses the earliest matchday when they've played several", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const earlier = new Date("2019-01-10T18:00:00Z");
    const later = new Date("2021-06-01T18:00:00Z");

    await createCompletedGameday(user.id, later, { teamA: 5, teamB: 2 }, [{ playerId: player.id, team: "A", points: 4, goalDiff: 3 }]);
    await createCompletedGameday(user.id, earlier, { teamA: 5, teamB: 2 }, [{ playerId: player.id, team: "A", points: 4, goalDiff: 3 }]);

    const res = await request(app).get(`/api/players/${player.id}/profile`).set("Authorization", `Bearer ${token}`);
    expect(new Date(res.body.player.joinedAt).toISOString()).toBe(earlier.toISOString());
  });

  it("falls back to the account's creation date for a player who hasn't played a matchday yet", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);

    const res = await request(app).get(`/api/players/${player.id}/profile`).set("Authorization", `Bearer ${token}`);
    expect(new Date(res.body.player.joinedAt).toISOString()).toBe(new Date(user.createdAt).toISOString());
  });

  it("falls back to the player record's creation date for a guest with no games and no account", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");

    const res = await request(app).get(`/api/players/${guest.id}/profile`).set("Authorization", `Bearer ${token}`);
    expect(new Date(res.body.player.joinedAt).toISOString()).toBe(new Date(guest.createdAt).toISOString());
  });
});
