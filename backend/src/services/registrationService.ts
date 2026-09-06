import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, ne } from "drizzle-orm";
import * as schema from "../db/schema";
import { computeWaitlistAssignments } from "../utils/waitlist";
import { db } from "../db/client";
import { notifyGameStatusChange, notifyPromotedFromWaitlist } from "./pushService";

type DbOrTx = NodePgDatabase<typeof schema>;

export interface WaitlistRecomputeResult {
  /** Player ids whose status flipped WAITLISTED -> CONFIRMED this time. */
  promotedPlayerIds: number[];
  confirmedCountAfter: number;
  minPlayers: number;
}

/**
 * Re-evaluates confirmed vs waitlisted status for every active registration on a
 * gameday, and persists any status changes. Call this after any registration is
 * added or cancelled. Returns enough about what changed (confirmed count
 * after, who got promoted off the waitlist) for the caller to decide whether
 * a push notification is warranted - see routes/gamedays.ts. Deliberately
 * doesn't report a "confirmed count before" itself: by the time this runs,
 * the caller's own insert/cancel has usually already happened in the same
 * transaction, so the "before" snapshot has to come from the caller, taken
 * before it made that change.
 */
export async function recomputeGamedayWaitlist(tx: DbOrTx, gamedayId: number): Promise<WaitlistRecomputeResult | null> {
  const gameday = await tx.query.gamedays.findFirst({ where: eq(schema.gamedays.id, gamedayId) });
  if (!gameday) return null;

  const active = await tx.query.registrations.findMany({
    where: and(eq(schema.registrations.gamedayId, gamedayId), ne(schema.registrations.status, "CANCELLED")),
  });

  const decisions = computeWaitlistAssignments(
    active.map((r) => ({ id: r.id, signupAt: r.signupAt })),
    gameday.minPlayers,
    gameday.maxPlayers
  );

  const promotedPlayerIds: number[] = [];
  for (const reg of active) {
    const decided = decisions.get(reg.id);
    if (decided && decided !== reg.status) {
      await tx.update(schema.registrations).set({ status: decided }).where(eq(schema.registrations.id, reg.id));
      if (reg.status === "WAITLISTED" && decided === "CONFIRMED") {
        promotedPlayerIds.push(reg.playerId);
      }
    }
  }

  const confirmedCountAfter = Array.from(decisions.values()).filter((d) => d === "CONFIRMED").length;

  return { promotedPlayerIds, confirmedCountAfter, minPlayers: gameday.minPlayers };
}

/** Confirmed-count snapshot, taken before a caller mutates any registration - see notifyOnWaitlistChange. */
export async function countConfirmed(gamedayId: number): Promise<number> {
  const rows = await db.query.registrations.findMany({
    where: and(eq(schema.registrations.gamedayId, gamedayId), eq(schema.registrations.status, "CONFIRMED")),
  });
  return rows.length;
}

/**
 * Fires the "game confirmed"/"game at risk" and "you're off the waitlist"
 * pushes off a recompute's result, if the gameday is still open.
 * `confirmedCountBefore` must be captured by the caller *before* it made
 * its own change (registering/cancelling) - recomputeGamedayWaitlist can't
 * report that itself since by the time it runs, that change has usually
 * already happened in the same transaction. Shared by both the
 * authenticated (routes/gamedays.ts) and public share-link
 * (routes/gamedayShare.ts) registration paths.
 */
export async function notifyOnWaitlistChange(
  gameday: { id: number; date: Date; status: string },
  confirmedCountBefore: number,
  result: WaitlistRecomputeResult | null
) {
  if (!result || gameday.status !== "OPEN") return;
  const { minPlayers, confirmedCountAfter, promotedPlayerIds } = result;

  if (confirmedCountBefore < minPlayers && confirmedCountAfter >= minPlayers) {
    await notifyGameStatusChange(db, gameday, true);
  } else if (confirmedCountBefore >= minPlayers && confirmedCountAfter < minPlayers) {
    await notifyGameStatusChange(db, gameday, false);
  }

  if (result.promotedPlayerIds.length > 0) {
    await notifyPromotedFromWaitlist(db, promotedPlayerIds, gameday);
  }
}
