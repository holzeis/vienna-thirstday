/**
 * Assigns each gameday a 1-based "matchday" number: its position within its
 * own calendar year, chronologically - the first gameday of a season is
 * Matchday 1, regardless of status (an upcoming Thursday still takes the
 * next number in the sequence). Numbering restarts every year.
 */
export function computeMatchdayNumbers(gamedaysAscByDate: { id: number; date: Date }[]): Map<number, number> {
  const matchdayById = new Map<number, number>();
  const countByYear = new Map<number, number>();
  for (const g of gamedaysAscByDate) {
    const year = g.date.getUTCFullYear();
    const next = (countByYear.get(year) ?? 0) + 1;
    countByYear.set(year, next);
    matchdayById.set(g.id, next);
  }
  return matchdayById;
}
