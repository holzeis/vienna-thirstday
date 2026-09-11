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
    const byId = new Map<number, any>(res.body.standings.map((s: any) => [s.playerId, s]));
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

describe("GET /:year/standings momentum", () => {
  it("computes movement since the last matchday for the current, ongoing season", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const year = new Date().getUTCFullYear();

    await createCompletedGameday(user.id, new Date(Date.UTC(year, 0, 5, 18)), { teamA: 2, teamB: 5 }, [
      { playerId: player.id, team: "A", points: 1, goalDiff: -3 },
      { playerId: guest.id, team: "B", points: 4, goalDiff: 3 },
    ]);
    // Second gameday flips the lead - player overtakes guest.
    await createCompletedGameday(user.id, new Date(Date.UTC(year, 0, 12, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
      { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
    ]);

    const res = await request(app).get(`/api/seasons/${year}/standings`).set("Authorization", `Bearer ${token}`);
    const byId = new Map<number, any>(res.body.standings.map((s: any) => [s.playerId, s]));
    expect(byId.get(player.id)?.momentum).toBe(1);
    expect(byId.get(guest.id)?.momentum).toBe(-1);
  });

  it("never shows momentum for a past, concluded season", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const pastYear = new Date().getUTCFullYear() - 1;

    await createCompletedGameday(user.id, new Date(Date.UTC(pastYear, 0, 5, 18)), { teamA: 2, teamB: 5 }, [
      { playerId: player.id, team: "A", points: 1, goalDiff: -3 },
      { playerId: guest.id, team: "B", points: 4, goalDiff: 3 },
    ]);
    await createCompletedGameday(user.id, new Date(Date.UTC(pastYear, 0, 12, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
      { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
    ]);

    const res = await request(app).get(`/api/seasons/${pastYear}/standings`).set("Authorization", `Bearer ${token}`);
    const byId = new Map<number, any>(res.body.standings.map((s: any) => [s.playerId, s]));
    expect(byId.get(player.id)?.momentum).toBe("new");
    expect(byId.get(guest.id)?.momentum).toBe("new");
  });

  it("never shows current-form (Locker Room) badges for a past, concluded season", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const pastYear = new Date().getUTCFullYear() - 1;

    // Player wins all 5 of that past season's gamedays - would earn
    // veteran/undefeated under the current-form rules if it weren't gated
    // to the current season.
    for (let day = 1; day <= 5; day++) {
      await createCompletedGameday(user.id, new Date(Date.UTC(pastYear, 0, day, 18)), { teamA: 5, teamB: 2 }, [
        { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
        { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
      ]);
    }

    const res = await request(app).get(`/api/seasons/${pastYear}/standings`).set("Authorization", `Bearer ${token}`);
    const byId = new Map<number, any>(res.body.standings.map((s: any) => [s.playerId, s]));
    expect(byId.get(player.id)?.currentForm).toEqual({ veteran: false, undefeated: false, unlucky: false, ghost: false });
    expect(byId.get(guest.id)?.currentForm).toEqual({ veteran: false, undefeated: false, unlucky: false, ghost: false });
  });
});

describe("GET /:year/standings previousSeasonTitle", () => {
  it("badges the previous season's champion and vice-champion", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const year = new Date().getUTCFullYear();

    // Previous season: player wins the title, guest is runner-up.
    await createCompletedGameday(user.id, new Date(Date.UTC(year - 1, 5, 1, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
      { playerId: guest.id, team: "B", points: 2, goalDiff: -3 },
    ]);
    // This season: both play again, order doesn't matter for the badge.
    await createCompletedGameday(user.id, new Date(Date.UTC(year, 0, 5, 18)), { teamA: 2, teamB: 5 }, [
      { playerId: player.id, team: "A", points: 1, goalDiff: -3 },
      { playerId: guest.id, team: "B", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).get(`/api/seasons/${year}/standings`).set("Authorization", `Bearer ${token}`);
    const byId = new Map<number, any>(res.body.standings.map((s: any) => [s.playerId, s]));
    expect(byId.get(player.id)?.previousSeasonTitle).toBe("champion");
    expect(byId.get(guest.id)?.previousSeasonTitle).toBe("viceChampion");
  });

  it("is null for everyone when there's no completed season before the one being viewed", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const year = new Date().getUTCFullYear();

    await createCompletedGameday(user.id, new Date(Date.UTC(year, 0, 5, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).get(`/api/seasons/${year}/standings`).set("Authorization", `Bearer ${token}`);
    expect(res.body.standings[0].previousSeasonTitle).toBeNull();
  });

  it("reflects the season immediately before whichever year is being viewed, not always the most recent one", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const year = new Date().getUTCFullYear();

    // year-2: player is champion.
    await createCompletedGameday(user.id, new Date(Date.UTC(year - 2, 5, 1, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
      { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
    ]);
    // year-1: guest is champion instead.
    await createCompletedGameday(user.id, new Date(Date.UTC(year - 1, 5, 1, 18)), { teamA: 2, teamB: 5 }, [
      { playerId: player.id, team: "A", points: 1, goalDiff: -3 },
      { playerId: guest.id, team: "B", points: 4, goalDiff: 3 },
    ]);

    // Viewing year-1's own standings should reflect year-2's podium (player
    // champion, guest vice-champion there too, being the only other player) -
    // not year-1's own podium, which has them the other way around.
    const res = await request(app).get(`/api/seasons/${year - 1}/standings`).set("Authorization", `Bearer ${token}`);
    const byId = new Map<number, any>(res.body.standings.map((s: any) => [s.playerId, s]));
    expect(byId.get(player.id)?.previousSeasonTitle).toBe("champion");
    expect(byId.get(guest.id)?.previousSeasonTitle).toBe("viceChampion");
  });
});

describe("GET /:year/standings isNewcomer", () => {
  it("badges a player whose first-ever matchday is this calendar year", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const year = new Date().getUTCFullYear();

    // player's first-ever game is this season - a newcomer.
    await createCompletedGameday(user.id, new Date(Date.UTC(year, 0, 5, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
      { playerId: guest.id, team: "B", points: 1, goalDiff: -3 },
    ]);
    // guest already played last season - a veteran of the league, not a newcomer.
    await createCompletedGameday(user.id, new Date(Date.UTC(year - 1, 5, 1, 18)), { teamA: 2, teamB: 5 }, [
      { playerId: guest.id, team: "B", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).get(`/api/seasons/${year}/standings`).set("Authorization", `Bearer ${token}`);
    const byId = new Map<number, any>(res.body.standings.map((s: any) => [s.playerId, s]));
    expect(byId.get(player.id)?.isNewcomer).toBe(true);
    expect(byId.get(guest.id)?.isNewcomer).toBe(false);
  });

  it("never shows isNewcomer for a past, concluded season", async () => {
    const { user, player, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const pastYear = new Date().getUTCFullYear() - 1;

    await createCompletedGameday(user.id, new Date(Date.UTC(pastYear, 0, 5, 18)), { teamA: 5, teamB: 2 }, [
      { playerId: player.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).get(`/api/seasons/${pastYear}/standings`).set("Authorization", `Bearer ${token}`);
    expect(res.body.standings[0].isNewcomer).toBe(false);
  });
});
