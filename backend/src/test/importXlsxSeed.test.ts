import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { db } from "../db/client";
import { playerMerges } from "../db/schema";
import { resolvePlayerIdForName } from "../db/import-xlsx-seed";
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
