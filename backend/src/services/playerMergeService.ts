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
 */
export async function mergeGuestIntoPlayer(tx: DbOrTx, guestPlayerId: number, targetPlayerId: number) {
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

  // The guest identity is now fully absorbed into the target player.
  await tx.delete(schema.players).where(eq(schema.players.id, guestPlayerId));
}
