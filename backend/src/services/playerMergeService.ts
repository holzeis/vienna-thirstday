import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
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
  mergedByUserId: number | null,
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
 * Logs a guest's promotion to an account as a merge, so it appears under
 * "Recent guest merges" and can be undone: undoing moves the guest-era
 * history onto a fresh guest named `guestName` (the promoted player keeps
 * their account but loses that history), from where the ordinary merge tool
 * can attach just the right season(s) again.
 *
 * Nothing is moved here - the rows are already on the player - this only
 * records which ones were the guest's: all of them, or with `upTo` only
 * those from gamedays on or before it (for a backfill, so games played
 * *as the account* afterwards aren't swept into an undo). Rows that a logged
 * merge already moved onto this player are left out: they have their own
 * entry and their own undo. Idempotent: a player gets at most one promotion
 * entry, and one with no guest-era rows isn't logged. Returns whether an
 * entry was written.
 */
export async function recordGuestPromotion(
  tx: DbOrTx,
  opts: { playerId: number; guestName: string; mergedByUserId: number | null; upTo?: Date; at?: Date }
): Promise<boolean> {
  const priorMerges = await tx.query.playerMerges.findMany({ where: eq(schema.playerMerges.targetPlayerId, opts.playerId) });
  if (priorMerges.some((m) => m.isPromotion)) return false;

  // Ids already accounted for by a live (not undone) merge into this player.
  const mergedIds = (column: "movedRegistrationIds" | "movedTeamAssignmentIds" | "movedStatIds") =>
    new Set(priorMerges.filter((m) => !m.undoneAt).flatMap((m) => JSON.parse(m[column]) as number[]));
  const mergedRegs = mergedIds("movedRegistrationIds");
  const mergedAssignments = mergedIds("movedTeamAssignmentIds");
  const mergedStats = mergedIds("movedStatIds");

  const keep = (date: Date) => !opts.upTo || date.getTime() <= opts.upTo.getTime();
  const [regs, assignments, stats] = await Promise.all([
    tx.query.registrations.findMany({ where: eq(schema.registrations.playerId, opts.playerId), with: { gameday: true } }),
    tx.query.teamAssignments.findMany({ where: eq(schema.teamAssignments.playerId, opts.playerId), with: { gameday: true } }),
    tx.query.playerGamedayStats.findMany({
      where: eq(schema.playerGamedayStats.playerId, opts.playerId),
      with: { result: { with: { gameday: true } } },
    }),
  ]);
  const regIds = regs.filter((r) => keep(r.gameday.date) && !mergedRegs.has(r.id)).map((r) => r.id);
  const assignmentIds = assignments.filter((a) => keep(a.gameday.date) && !mergedAssignments.has(a.id)).map((a) => a.id);
  const statIds = stats.filter((s) => keep(s.result.gameday.date) && !mergedStats.has(s.id)).map((s) => s.id);
  if (regIds.length + assignmentIds.length + statIds.length === 0) return false;

  await tx.insert(schema.playerMerges).values({
    guestPlayerName: opts.guestName,
    guestPlayerId: null,
    season: null,
    isPromotion: true,
    targetPlayerId: opts.playerId,
    mergedByUserId: opts.mergedByUserId,
    movedRegistrationIds: JSON.stringify(regIds),
    movedTeamAssignmentIds: JSON.stringify(assignmentIds),
    movedStatIds: JSON.stringify(statIds),
    ...(opts.at ? { createdAt: opts.at } : {}),
  });
  return true;
}

/**
 * An early version of the backfill logged *every* pre-account row, including
 * ones a logged merge had moved in. Undoing both would fight over the same
 * rows, so strip from each live promotion entry any id that a live merge
 * into the same player owns. Idempotent (a clean entry is left as is).
 */
async function trimPromotionOverlap(tx: DbOrTx) {
  const live = (await tx.query.playerMerges.findMany()).filter((m) => !m.undoneAt);
  for (const promotion of live.filter((m) => m.isPromotion)) {
    const others = live.filter((m) => m.targetPlayerId === promotion.targetPlayerId && m.id !== promotion.id);
    const trim = (column: "movedRegistrationIds" | "movedTeamAssignmentIds" | "movedStatIds") => {
      const owned = new Set(others.flatMap((m) => JSON.parse(m[column]) as number[]));
      const ids = JSON.parse(promotion[column]) as number[];
      return { ids: ids.filter((id) => !owned.has(id)), changed: ids.some((id) => owned.has(id)) };
    };
    const regs = trim("movedRegistrationIds");
    const assignments = trim("movedTeamAssignmentIds");
    const stats = trim("movedStatIds");
    if (!regs.changed && !assignments.changed && !stats.changed) continue;
    await tx
      .update(schema.playerMerges)
      .set({
        movedRegistrationIds: JSON.stringify(regs.ids),
        movedTeamAssignmentIds: JSON.stringify(assignments.ids),
        movedStatIds: JSON.stringify(stats.ids),
      })
      .where(eq(schema.playerMerges.id, promotion.id));
  }
}

/**
 * Idempotent catch-up for promotions that happened before they were logged.
 * Covers every account, not just ones made from a guest-linked invite: the
 * oldest accounts predate invites (or were linked to an imported player
 * directly), so there is no invite to find - but any history on a gameday
 * dated before the account existed can only have been the guest's. So the
 * cutoff is when the account came into being (a whole-guest invite's
 * acceptance time when there is one, else the user's creation), and rows
 * already moved in by a logged merge are excluded. Runs with the migrations
 * (db/migrate.ts), so every environment gets it. The guest's pre-rename
 * name wasn't kept, so the player's current name stands in for it.
 */
export async function backfillGuestPromotions(tx: DbOrTx): Promise<number> {
  await trimPromotionOverlap(tx);

  const accounts = await tx.query.users.findMany({ where: isNotNull(schema.users.playerId), with: { player: true } });
  const wholeGuestInvites = await tx.query.invites.findMany({
    where: and(isNotNull(schema.invites.guestPlayerId), isNull(schema.invites.season), isNotNull(schema.invites.usedAt)),
  });
  const inviteByPlayer = new Map(wholeGuestInvites.map((i) => [i.guestPlayerId!, i]));

  let logged = 0;
  for (const account of accounts) {
    if (!account.player) continue;
    const invite = inviteByPlayer.get(account.player.id);
    const accountSince = invite?.usedAt ?? account.createdAt;
    const wrote = await recordGuestPromotion(tx, {
      playerId: account.player.id,
      guestName: account.player.name,
      mergedByUserId: invite?.createdByUserId ?? null,
      upTo: accountSince,
      at: accountSince,
    });
    if (wrote) logged++;
  }
  return logged;
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
