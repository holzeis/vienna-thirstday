import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, ne } from "drizzle-orm";
import * as schema from "../db/schema";
import { computeWaitlistAssignments } from "../utils/waitlist";

type DbOrTx = NodePgDatabase<typeof schema>;

/**
 * Re-evaluates confirmed vs waitlisted status for every active registration on a
 * gameday, and persists any status changes. Call this after any registration is
 * added or cancelled.
 */
export async function recomputeGamedayWaitlist(tx: DbOrTx, gamedayId: number) {
  const gameday = await tx.query.gamedays.findFirst({ where: eq(schema.gamedays.id, gamedayId) });
  if (!gameday) return;

  const active = await tx.query.registrations.findMany({
    where: and(eq(schema.registrations.gamedayId, gamedayId), ne(schema.registrations.status, "CANCELLED")),
  });

  const decisions = computeWaitlistAssignments(
    active.map((r) => ({ id: r.id, signupAt: r.signupAt })),
    gameday.minPlayers,
    gameday.maxPlayers
  );

  for (const reg of active) {
    const decided = decisions.get(reg.id);
    if (decided && decided !== reg.status) {
      await tx.update(schema.registrations).set({ status: decided }).where(eq(schema.registrations.id, reg.id));
    }
  }
}
