import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { db } from "../db/client";
import { players, playerGamedayStats, registrations, teamAssignments } from "../db/schema";
import { resetDb, closeDb, createAdmin, createGuestPlayer, createCompletedGameday } from "./helpers";

/** Registers and assigns a player to a gameday's team, alongside their stats - createCompletedGameday alone only creates the stat row. */
async function registerAndAssign(adminUserId: number, gamedayId: number, playerId: number, team: "A" | "B") {
  await db.insert(registrations).values({ gamedayId, playerId, status: "CONFIRMED", registeredByUserId: adminUserId });
  await db.insert(teamAssignments).values({ gamedayId, playerId, team });
}

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

  it("with a season, only attaches that year's history and leaves the guest in place with the rest", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Richi");

    const { gameday: gd2022 } = await createCompletedGameday(user.id, new Date("2022-06-05T18:00:00Z"), { teamA: 5, teamB: 2 }, [
      { playerId: guest.id, team: "A", points: 4, goalDiff: 3 },
    ]);
    await registerAndAssign(user.id, gd2022.id, guest.id, "A");
    const { gameday: gd2023 } = await createCompletedGameday(user.id, new Date("2023-06-05T18:00:00Z"), { teamA: 2, teamB: 5 }, [
      { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
    ]);
    await registerAndAssign(user.id, gd2023.id, guest.id, "B");

    const res = await request(app)
      .post(`/api/admin/players/${player.id}/merge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ guestPlayerId: guest.id, season: 2022 });
    expect(res.status).toBe(200);

    // The guest survives - 2023 is still theirs.
    const remainingGuest = await db.query.players.findFirst({ where: eq(players.id, guest.id) });
    expect(remainingGuest?.isGuest).toBe(true);
    const guestStats = await db.query.playerGamedayStats.findMany({ where: eq(playerGamedayStats.playerId, guest.id) });
    expect(guestStats).toHaveLength(1);
    expect(guestStats[0].goalDiff).toBe(-3);

    // The target only got 2022.
    const targetStats = await db.query.playerGamedayStats.findMany({ where: eq(playerGamedayStats.playerId, player.id) });
    expect(targetStats).toHaveLength(1);
    expect(targetStats[0].goalDiff).toBe(3);
    const targetRegs = await db.query.registrations.findMany({ where: eq(registrations.playerId, player.id) });
    expect(targetRegs.map((r) => r.gamedayId)).toEqual([gd2022.id]);
  });

  it("deletes the guest anyway once a season-scoped merge happens to drain their only season", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Richi");
    await createCompletedGameday(user.id, new Date("2022-06-05T18:00:00Z"), { teamA: 5, teamB: 2 }, [
      { playerId: guest.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    await request(app)
      .post(`/api/admin/players/${player.id}/merge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ guestPlayerId: guest.id, season: 2022 });

    const remainingGuest = await db.query.players.findFirst({ where: eq(players.id, guest.id) });
    expect(remainingGuest).toBeUndefined();
  });

  it("undoing a season-scoped merge moves the rows back onto the same, still-alive guest rather than recreating one", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Richi");
    const { gameday: gd2022 } = await createCompletedGameday(user.id, new Date("2022-06-05T18:00:00Z"), { teamA: 5, teamB: 2 }, [
      { playerId: guest.id, team: "A", points: 4, goalDiff: 3 },
    ]);
    await createCompletedGameday(user.id, new Date("2023-06-05T18:00:00Z"), { teamA: 2, teamB: 5 }, [
      { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
    ]);

    await request(app)
      .post(`/api/admin/players/${player.id}/merge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ guestPlayerId: guest.id, season: 2022 });

    const merge = await db.query.playerMerges.findFirst({ where: (m, { eq }) => eq(m.season, 2022) });
    const undoRes = await request(app).post(`/api/admin/players/merges/${merge!.id}/undo`).set("Authorization", `Bearer ${token}`);
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.guest.id).toBe(guest.id);

    const guestStats = await db.query.playerGamedayStats.findMany({ where: eq(playerGamedayStats.playerId, guest.id) });
    expect(guestStats).toHaveLength(2);
    const targetStats = await db.query.playerGamedayStats.findMany({ where: eq(playerGamedayStats.playerId, player.id) });
    expect(targetStats).toHaveLength(0);

    // Only one player named "Richi" exists - the undo didn't spawn a duplicate.
    const richis = await db.query.players.findMany({ where: (p, { eq }) => eq(p.name, "Richi") });
    expect(richis).toHaveLength(1);
  });
});

describe("GET /admin/players/merges", () => {
  it("identifies who performed a merge by name, not email - which is optional", async () => {
    const { user, player, password } = await createAdmin("Admin", "password123"); // no email
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Richi");

    await request(app)
      .post(`/api/admin/players/${player.id}/merge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ guestPlayerId: guest.id });

    const res = await request(app).get("/api/admin/players/merges").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.merges[0].mergedBy).toEqual({ id: user.id, name: "Admin" });
  });
});

describe("GET /admin/players/guests", () => {
  it("lists only the seasons a guest actually has games in, not every league season", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Richi");
    // A different player's 2021 season shouldn't leak into Richi's list.
    const other = await createGuestPlayer("Other");

    await createCompletedGameday(user.id, new Date("2022-06-05T18:00:00Z"), { teamA: 5, teamB: 2 }, [
      { playerId: guest.id, team: "A", points: 4, goalDiff: 3 },
    ]);
    await createCompletedGameday(user.id, new Date("2023-06-05T18:00:00Z"), { teamA: 2, teamB: 5 }, [
      { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
    ]);
    await createCompletedGameday(user.id, new Date("2021-06-05T18:00:00Z"), { teamA: 5, teamB: 2 }, [
      { playerId: other.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).get("/api/admin/players/guests").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const richi = res.body.guests.find((g: any) => g.id === guest.id);
    expect(richi.seasons).toEqual([2023, 2022]);
    const otherGuest = res.body.guests.find((g: any) => g.id === other.id);
    expect(otherGuest.seasons).toEqual([2021]);
  });

  it("returns an empty seasons list for a guest with no games", async () => {
    await createAdmin();
    const token = await loginAs("Admin", "password123");
    await createGuestPlayer("Never Played");

    const res = await request(app).get("/api/admin/players/guests").set("Authorization", `Bearer ${token}`);
    expect(res.body.guests[0].seasons).toEqual([]);
  });
});
