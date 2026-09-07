/**
 * CLOSED is never stored - it's the effective status shown once an OPEN
 * gameday's kickoff has passed but no result has been entered yet (so it
 * hasn't become COMPLETED). Computed on every read rather than written by a
 * scheduled job, so it's always correct the instant you check, with no
 * background job to keep running or drift out of sync. CANCELLED/COMPLETED
 * are real, explicitly-set statuses and pass through unchanged.
 */
export function effectiveGamedayStatus(gameday: { status: string; date: Date }): string {
  if (gameday.status === "OPEN" && gameday.date.getTime() <= Date.now()) return "CLOSED";
  return gameday.status;
}
