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
 * All of the guest's registrations, team assignments, and gameday stats are
 * reassigned to the target player, then the guest player record is deleted.
 * If the guest happens to already share a gameday/result with the target
 * (e.g. the target somehow already has a row for the same gameday), the
 * guest's row for that gameday is dropped instead of reassigned, since a
 * player can only have one registration/assignment/stat row per gameday.
 *
 * Logs the merge (guest name + exactly which rows moved) so it shows up on
 * the admin page and can be reversed with `undoPlayerMerge` later.
 */
export async function mergeGuestIntoPlayer(tx: DbOrTx, guestPlayerId: number, targetPlayerId: number, mergedByUserId: number) {
  if (guestPlayerId === targetPlayerId) {
    throw ApiError.badRequest("Cannot merge a player into itself");
  }

  const guest = await tx.query.players.findFirst({ where: eq(schema.players.id, guestPlayerId) });
  if (!guest) throw ApiError.notFound("Guest player not found");
  if (!guest.isGuest) throw ApiError.badRequest("Only guest/placeholder players can be merged this way");

  const target = await tx.query.players.findFirst({ where: eq(schema.players.id, targetPlayerId) });
  if (!target) throw ApiError.notFound("Target player not found");

  // --- registrations (unique on gamedayId + playerId) ---
  const [guestRegs, targetRegs] = await Promise.all([
    tx.query.registrations.findMany({ where: eq(schema.registrations.playerId, guestPlayerId) }),
    tx.query.registrations.findMany({ where: eq(schema.registrations.playerId, targetPlayerId) }),
  ]);
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
  const [guestAssignments, targetAssignments] = await Promise.all([
    tx.query.teamAssignments.findMany({ where: eq(schema.teamAssignments.playerId, guestPlayerId) }),
    tx.query.teamAssignments.findMany({ where: eq(schema.teamAssignments.playerId, targetPlayerId) }),
  ]);
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
  const [guestStats, targetStats] = await Promise.all([
    tx.query.playerGamedayStats.findMany({ where: eq(schema.playerGamedayStats.playerId, guestPlayerId) }),
    tx.query.playerGamedayStats.findMany({ where: eq(schema.playerGamedayStats.playerId, targetPlayerId) }),
  ]);
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
    targetPlayerId,
    mergedByUserId,
    movedRegistrationIds: JSON.stringify(regsToMove.map((r) => r.id)),
    movedTeamAssignmentIds: JSON.stringify(assignmentsToMove.map((a) => a.id)),
    movedStatIds: JSON.stringify(statsToMove.map((s) => s.id)),
  });

  // The guest identity is now fully absorbed into the target player.
  await tx.delete(schema.players).where(eq(schema.players.id, guestPlayerId));
}

/**
 * Reverses a logged merge: recreates a guest player under the original name
 * and points exactly the rows that were moved (by id, captured at merge
 * time) back at it. Rows that were dropped as duplicates at merge time
 * (rare - only when the target already had its own row for that gameday)
 * can't be restored, since they no longer exist.
 */
export async function undoPlayerMerge(tx: DbOrTx, mergeId: number) {
  const merge = await tx.query.playerMerges.findFirst({ where: eq(schema.playerMerges.id, mergeId) });
  if (!merge) throw ApiError.notFound("Merge not found");
  if (merge.undoneAt) throw ApiError.badRequest("This merge was already undone");

  const [restoredGuest] = await tx
    .insert(schema.players)
    .values({ name: merge.guestPlayerName, isGuest: true })
    .returning();

  const regIds: number[] = JSON.parse(merge.movedRegistrationIds);
  const assignmentIds: number[] = JSON.parse(merge.movedTeamAssignmentIds);
  const statIds: number[] = JSON.parse(merge.movedStatIds);

  if (regIds.length > 0) {
    await tx.update(schema.registrations).set({ playerId: restoredGuest.id }).where(inArray(schema.registrations.id, regIds));
  }
  if (assignmentIds.length > 0) {
    await tx.update(schema.teamAssignments).set({ playerId: restoredGuest.id }).where(inArray(schema.teamAssignments.id, assignmentIds));
  }
  if (statIds.length > 0) {
    await tx.update(schema.playerGamedayStats).set({ playerId: restoredGuest.id }).where(inArray(schema.playerGamedayStats.id, statIds));
  }

  await tx.update(schema.playerMerges).set({ undoneAt: new Date() }).where(eq(schema.playerMerges.id, mergeId));

  return restoredGuest;
}
