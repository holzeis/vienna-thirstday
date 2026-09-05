/**
 * Converts a wall-clock time in a given IANA zone to the equivalent UTC
 * Date, correctly accounting for that zone's DST rules on that specific
 * date - a fixed UTC offset doesn't work here since Vienna is UTC+1 (CET)
 * in winter and UTC+2 (CEST) in summer, and this league plays weekly
 * year-round.
 *
 * No timezone library needed: format a naive guess through Intl in the
 * target zone, see how far its wall-clock reading has drifted from the
 * guess, and correct by that amount. Not exact at the DST-transition
 * instant itself (an hour that's skipped or repeated), which doesn't matter
 * here - kickoff is always a stable hour on a Thursday, never at 2-3am.
 */
export function zonedTimeToUtc(dateOnly: string, hour: number, minute: number, timeZone: string): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(naiveUtc)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);

  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = asIfUtc - naiveUtc.getTime();
  return new Date(naiveUtc.getTime() - offsetMs);
}
