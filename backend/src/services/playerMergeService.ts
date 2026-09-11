import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { ApiError } from "../utils/errors";

type DbOrTx = NodePgDatabase<typeof schema>;

/**
 * Merges a guest/placeholder player (e.g. one created by the legacy
 * spreadsheet import) into a real, account-linked player - typically used
 * when an admin approves a new user's registration and recognizes them as
 * someone who already has history under a guest profile.
 *
 * With no `season`, all of the guest's registrations, team assignments, and
 * gameday stats are reassigned to the target player. Pass a calendar year to
 * scope this to just that season instead (e.g. the guest played 2022-2023
 * for real, but a spreadsheet re-import also created a duplicate 2024 under
 * the same name that shouldn't be attributed to them) - everything outside
 * that year is left on the guest untouched. If the guest happens to already
 * share a gameday/result with the target (e.g. the target somehow already
 * has a row for the same gameday), the guest's row for that gameday is
 * dropped instead of reassigned, since a player can only have one
 * registration/assignment/stat row per gameday.
 *
 * The guest player record is deleted once (and only once) nothing of
 * theirs is left in any season - a season-scoped merge that doesn't drain
 * every last row leaves the guest in place with whatever remains.
 *
 * Logs the merge (guest name/id, season, and exactly which rows moved) so
 * it shows up on the admin page and can be reversed with `undoPlayerMerge`
 * later.
 */
export async function mergeGuestIntoPlayer(
  tx: DbOrTx,
  guestPlayerId: number,
  targetPlayerId: number,
  mergedByUserId: number,
  season?: number
) {
  if (guestPlayerId === targetPlayerId) {
    throw ApiError.badRequest("Cannot merge a player into itself");
  }

  const guest = await tx.query.players.findFirst({ where: eq(schema.players.id, guestPlayerId) });
  if (!guest) throw ApiError.notFound("Guest player not found");
  if (!guest.isGuest) throw ApiError.badRequest("Only guest/placeholder players can be merged this way");

  const target = await tx.query.players.findFirst({ where: eq(schema.players.id, targetPlayerId) });
  if (!target) throw ApiError.notFound("Target player not found");

  // `inSeason` is a no-op (always true) when `season` is omitted, so the
  // rest of this function reads the same for a full or scoped merge.
  const seasonStart = season !== undefined ? new Date(Date.UTC(season, 0, 1)) : null;
  const seasonEnd = season !== undefined ? new Date(Date.UTC(season + 1, 0, 1)) : null;
  function inSeason(date: Date): boolean {
    return !seasonStart || !seasonEnd || (date >= seasonStart && date < seasonEnd);
  }

  // --- registrations (unique on gamedayId + playerId) ---
  const [guestRegsAll, targetRegs] = await Promise.all([
    tx.query.registrations.findMany({ where: eq(schema.registrations.playerId, guestPlayerId), with: { gameday: true } }),
    tx.query.registrations.findMany({ where: eq(schema.registrations.playerId, targetPlayerId) }),
  ]);
  const guestRegs = guestRegsAll.filter((r) => inSeason(r.gameday.date));
  const targetRegGamedays = new Set(targetRegs.map((r) => r.gamedayId));
  const regsToMove = guestRegs.filter((r) => !targetRegGamedays.has(r.gamedayId));
  const regsToDrop = guestRegs.filter((r) => targetRegGamedays.has(r.gamedayId));
  if (regsToMove.length > 0) {
    await tx
      .update(schema.registrations)
      .set({ playerId: targetPlayerId })
      .where(inArray(schema.registrations.id, regsToMove.map((r) => r.id)));
  }
  if (regsToDrop.length > 0) {
    await tx.delete(schema.registrations).where(inArray(schema.registrations.id, regsToDrop.map((r) => r.id)));
  }

  // --- team assignments (unique on gamedayId + playerId) ---
  const [guestAssignmentsAll, targetAssignments] = await Promise.all([
    tx.query.teamAssignments.findMany({ where: eq(schema.teamAssignments.playerId, guestPlayerId), with: { gameday: true } }),
    tx.query.teamAssignments.findMany({ where: eq(schema.teamAssignments.playerId, targetPlayerId) }),
  ]);
  const guestAssignments = guestAssignmentsAll.filter((a) => inSeason(a.gameday.date));
  const targetAssignmentGamedays = new Set(targetAssignments.map((a) => a.gamedayId));
  const assignmentsToMove = guestAssignments.filter((a) => !targetAssignmentGamedays.has(a.gamedayId));
  const assignmentsToDrop = guestAssignments.filter((a) => targetAssignmentGamedays.has(a.gamedayId));
  if (assignmentsToMove.length > 0) {
    await tx
      .update(schema.teamAssignments)
      .set({ playerId: targetPlayerId })
      .where(inArray(schema.teamAssignments.id, assignmentsToMove.map((a) => a.id)));
  }
  if (assignmentsToDrop.length > 0) {
    await tx.delete(schema.teamAssignments).where(inArray(schema.teamAssignments.id, assignmentsToDrop.map((a) => a.id)));
  }

  // --- gameday stats (unique on resultId + playerId) ---
  const [guestStatsAll, targetStats] = await Promise.all([
    tx.query.playerGamedayStats.findMany({
      where: eq(schema.playerGamedayStats.playerId, guestPlayerId),
      with: { result: { with: { gameday: true } } },
    }),
    tx.query.playerGamedayStats.findMany({ where: eq(schema.playerGamedayStats.playerId, targetPlayerId) }),
  ]);
  const guestStats = guestStatsAll.filter((s) => inSeason(s.result.gameday.date));
  const targetStatResults = new Set(targetStats.map((s) => s.resultId));
  const statsToMove = guestStats.filter((s) => !targetStatResults.has(s.resultId));
  const statsToDrop = guestStats.filter((s) => targetStatResults.has(s.resultId));
  if (statsToMove.length > 0) {
    await tx
      .update(schema.playerGamedayStats)
      .set({ playerId: targetPlayerId })
      .where(inArray(schema.playerGamedayStats.id, statsToMove.map((s) => s.id)));
  }
  if (statsToDrop.length > 0) {
    await tx.delete(schema.playerGamedayStats).where(inArray(schema.playerGamedayStats.id, statsToDrop.map((s) => s.id)));
  }

  await tx.insert(schema.playerMerges).values({
    guestPlayerName: guest.name,
    guestPlayerId,
    season: season ?? null,
    targetPlayerId,
    mergedByUserId,
    movedRegistrationIds: JSON.stringify(regsToMove.map((r) => r.id)),
    movedTeamAssignmentIds: JSON.stringify(assignmentsToMove.map((a) => a.id)),
    movedStatIds: JSON.stringify(statsToMove.map((s) => s.id)),
  });

  // Only delete the guest once every season's worth of theirs is gone - a
  // season-scoped merge that leaves other years behind keeps the guest
  // around for those. ON DELETE SET NULL then clears guestPlayerId on this
  // (and any earlier) merge log row that pointed at them.
  const [remainingRegs, remainingAssignments, remainingStats] = await Promise.all([
    tx.query.registrations.findMany({ where: eq(schema.registrations.playerId, guestPlayerId) }),
    tx.query.teamAssignments.findMany({ where: eq(schema.teamAssignments.playerId, guestPlayerId) }),
    tx.query.playerGamedayStats.findMany({ where: eq(schema.playerGamedayStats.playerId, guestPlayerId) }),
  ]);
  if (remainingRegs.length === 0 && remainingAssignments.length === 0 && remainingStats.length === 0) {
    await tx.delete(schema.players).where(eq(schema.players.id, guestPlayerId));
  }
}

/**
 * Reverses a logged merge, moving back exactly the rows that were moved (by
 * id, captured at merge time). Rows that were dropped as duplicates at merge
 * time (rare - only when the target already had its own row for that
 * gameday) can't be restored, since they no longer exist.
 *
 * If the guest survived this merge (a season-scoped one that didn't drain
 * every row) `guestPlayerId` still points at them, so the rows go straight
 * back onto that same guest. Otherwise the guest was fully absorbed and
 * deleted, same as a plain merge always was, so a fresh one is recreated
 * under the original name first.
 */
export async function undoPlayerMerge(tx: DbOrTx, mergeId: number) {
  const merge = await tx.query.playerMerges.findFirst({ where: eq(schema.playerMerges.id, mergeId) });
  if (!merge) throw ApiError.notFound("Merge not found");
  if (merge.undoneAt) throw ApiError.badRequest("This merge was already undone");

  let guestId: number;
  if (merge.guestPlayerId !== null) {
    guestId = merge.guestPlayerId;
  } else {
    const [restoredGuest] = await tx.insert(schema.players).values({ name: merge.guestPlayerName, isGuest: true }).returning();
    guestId = restoredGuest.id;
  }

  const regIds: number[] = JSON.parse(merge.movedRegistrationIds);
  const assignmentIds: number[] = JSON.parse(merge.movedTeamAssignmentIds);
  const statIds: number[] = JSON.parse(merge.movedStatIds);

  if (regIds.length > 0) {
    await tx.update(schema.registrations).set({ playerId: guestId }).where(inArray(schema.registrations.id, regIds));
  }
  if (assignmentIds.length > 0) {
    await tx.update(schema.teamAssignments).set({ playerId: guestId }).where(inArray(schema.teamAssignments.id, assignmentIds));
  }
  if (statIds.length > 0) {
    await tx.update(schema.playerGamedayStats).set({ playerId: guestId }).where(inArray(schema.playerGamedayStats.id, statIds));
  }

  await tx.update(schema.playerMerges).set({ undoneAt: new Date() }).where(eq(schema.playerMerges.id, mergeId));

  const restoredGuest = await tx.query.players.findFirst({ where: eq(schema.players.id, guestId) });
  return restoredGuest!;
}
