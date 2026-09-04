export type WaitlistDecision = "CONFIRMED" | "WAITLISTED";

export interface RegistrationForWaitlist {
  id: number;
  signupAt: Date;
}

/**
 * Recomputes which active (non-cancelled) registrations for a gameday should be
 * CONFIRMED vs WAITLISTED.
 *
 * Rules (per the club's house rules):
 *  - Below `minPlayers`, everyone who signs up is confirmed - there's no
 *    reason to waitlist anyone while the gameday isn't even guaranteed to
 *    run yet (that's a separate admin judgement call, see gameday status).
 *  - From `minPlayers` upward, confirmed slots must be filled in pairs so two
 *    even teams can be formed: once at least `minPlayers` are confirmed, an
 *    additional signup only gets confirmed once it completes a pair. E.g.
 *    with min 8 / max 14, the 9th signup waits until a 10th arrives, then
 *    both are confirmed together; the 11th waits for a 12th, etc.
 *  - Hard cap at `maxPlayers`; anyone beyond that is waitlisted regardless of
 *    parity.
 *
 * Example (min 8, max 14): confirmed count grows 1, 2, ... 8 (all confirmed
 * one by one), then 9th waits, 10th arrives -> both 9th and 10th confirmed,
 * 11th waits, 12th confirms both, ... up to 14, after which everyone else
 * waits no matter what.
 */
export function computeWaitlistAssignments(
  activeRegistrations: RegistrationForWaitlist[],
  minPlayers: number,
  maxPlayers: number
): Map<number, WaitlistDecision> {
  const ordered = [...activeRegistrations].sort((a, b) => a.signupAt.getTime() - b.signupAt.getTime());

  const effectiveMax = maxPlayers - (maxPlayers % 2); // round cap down to even
  const rawCount = ordered.length;

  let confirmedCount: number;
  if (rawCount <= minPlayers) {
    confirmedCount = rawCount;
  } else {
    const beyondMin = rawCount - minPlayers;
    confirmedCount = minPlayers + (beyondMin - (beyondMin % 2)); // pair up everything past the minimum
  }
  confirmedCount = Math.min(confirmedCount, effectiveMax);

  const decisions = new Map<number, WaitlistDecision>();
  ordered.forEach((reg, index) => {
    decisions.set(reg.id, index < confirmedCount ? "CONFIRMED" : "WAITLISTED");
  });
  return decisions;
}
