import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { db } from "../db/client";
import { playerMerges } from "../db/schema";
import { resolvePlayerIdForName, diffRoster, diffStats } from "../db/import-xlsx-seed";
import { resetDb, closeDb, createGuestPlayer } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

describe("resolvePlayerIdForName", () => {
  it("returns null when no player or merge log matches the name", async () => {
    expect(await resolvePlayerIdForName("Nobody")).toBeNull();
  });

  it("resolves to a live player's id by exact current name", async () => {
    const player = await createGuestPlayer("Richie");
    expect(await resolvePlayerIdForName("Richie")).toBe(player.id);
  });

  it("resolves a name that was merged away to the merge's target player, not a new guest", async () => {
    const target = await createGuestPlayer("Richie");
    await db.insert(playerMerges).values({
      guestPlayerName: "Richi",
      targetPlayerId: target.id,
      movedRegistrationIds: "[]",
      movedTeamAssignmentIds: "[]",
      movedStatIds: "[]",
    });

    expect(await resolvePlayerIdForName("Richi")).toBe(target.id);
  });

  it("ignores an undone merge - the old name should get a fresh guest instead", async () => {
    const target = await createGuestPlayer("Richie");
    await db.insert(playerMerges).values({
      guestPlayerName: "Richi",
      targetPlayerId: target.id,
      movedRegistrationIds: "[]",
      movedTeamAssignmentIds: "[]",
      movedStatIds: "[]",
      undoneAt: new Date(),
    });

    expect(await resolvePlayerIdForName("Richi")).toBeNull();
  });

  it("prefers a live exact-name match over an old merge log entry under the same name", async () => {
    const originalTarget = await createGuestPlayer("Richie");
    await db.insert(playerMerges).values({
      guestPlayerName: "Richi",
      targetPlayerId: originalTarget.id,
      movedRegistrationIds: "[]",
      movedTeamAssignmentIds: "[]",
      movedStatIds: "[]",
    });
    // A different, unrelated guest later created under the exact old name.
    const newGuest = await createGuestPlayer("Richi");

    expect(await resolvePlayerIdForName("Richi")).toBe(newGuest.id);
  });

  it("uses the most recent non-undone merge when a name was merged more than once", async () => {
    const firstTarget = await createGuestPlayer("Alice");
    const secondTarget = await createGuestPlayer("Bob");
    await db.insert(playerMerges).values({
      guestPlayerName: "Guest",
      targetPlayerId: firstTarget.id,
      movedRegistrationIds: "[]",
      movedTeamAssignmentIds: "[]",
      movedStatIds: "[]",
      undoneAt: new Date(),
      createdAt: new Date("2020-01-01"),
    });
    await db.insert(playerMerges).values({
      guestPlayerName: "Guest",
      targetPlayerId: secondTarget.id,
      movedRegistrationIds: "[]",
      movedTeamAssignmentIds: "[]",
      movedStatIds: "[]",
      createdAt: new Date("2021-01-01"),
    });

    expect(await resolvePlayerIdForName("Guest")).toBe(secondTarget.id);
  });
});

describe("diffRoster", () => {
  it("reports a roster player with no existing row as missing", () => {
    const { missingPlayerIds, staleRowIds } = diffRoster([], [1, 2]);
    expect(missingPlayerIds).toEqual([1, 2]);
    expect(staleRowIds).toEqual([]);
  });

  it("reports an existing row whose player fell off the roster as stale", () => {
    const { missingPlayerIds, staleRowIds } = diffRoster([{ id: 10, playerId: 1 }], []);
    expect(missingPlayerIds).toEqual([]);
    expect(staleRowIds).toEqual([10]);
  });

  it("leaves a player present in both alone", () => {
    const { missingPlayerIds, staleRowIds } = diffRoster([{ id: 10, playerId: 1 }], [1]);
    expect(missingPlayerIds).toEqual([]);
    expect(staleRowIds).toEqual([]);
  });

  it("handles an added and a dropped player in the same reconcile pass (a name correction)", () => {
    // e.g. "Mustafa" (existing row) corrected to "Musti" (new roster entry).
    const { missingPlayerIds, staleRowIds } = diffRoster([{ id: 10, playerId: 1 }], [2]);
    expect(missingPlayerIds).toEqual([2]);
    expect(staleRowIds).toEqual([10]);
  });
});

describe("diffStats", () => {
  it("adds a stat row for a roster player with none yet", () => {
    const { toAdd, toUpdate, staleRowIds } = diffStats([], [{ playerId: 1, team: "A", points: 4, goalDiff: 3 }]);
    expect(toAdd).toEqual([{ playerId: 1, team: "A", points: 4, goalDiff: 3 }]);
    expect(toUpdate).toEqual([]);
    expect(staleRowIds).toEqual([]);
  });

  it("drops a stat row for a player no longer on the roster", () => {
    const existing = [{ id: 5, playerId: 1, team: "A" as const, points: 4, goalDiff: 3 }];
    const { toAdd, toUpdate, staleRowIds } = diffStats(existing, []);
    expect(toAdd).toEqual([]);
    expect(toUpdate).toEqual([]);
    expect(staleRowIds).toEqual([5]);
  });

  it("leaves an unchanged stat row alone", () => {
    const existing = [{ id: 5, playerId: 1, team: "A" as const, points: 4, goalDiff: 3 }];
    const { toAdd, toUpdate, staleRowIds } = diffStats(existing, [{ playerId: 1, team: "A", points: 4, goalDiff: 3 }]);
    expect(toAdd).toEqual([]);
    expect(toUpdate).toEqual([]);
    expect(staleRowIds).toEqual([]);
  });

  it("corrects a stat row in place when the recorded points/goalDiff/team changed", () => {
    const existing = [{ id: 5, playerId: 1, team: "A" as const, points: 1, goalDiff: -4 }];
    const { toAdd, toUpdate, staleRowIds } = diffStats(existing, [{ playerId: 1, team: "A", points: 4, goalDiff: 4 }]);
    expect(toAdd).toEqual([]);
    expect(toUpdate).toEqual([{ id: 5, playerId: 1, team: "A", points: 4, goalDiff: 4 }]);
    expect(staleRowIds).toEqual([]);
  });
});
