/**
 * House scoring rule: two teams play one match per gameday.
 *  - Win  -> 4 points, goal difference = own goals - opponent goals (positive)
 *  - Draw -> 2 points, goal difference = 0
 *  - Loss -> 1 point,  goal difference = own goals - opponent goals (negative)
 * Every player on a team receives that team's points/goal-difference identically.
 */
export function computeTeamResult(teamScore: number, opponentScore: number): { points: number; goalDiff: number } {
  const diff = teamScore - opponentScore;
  const points = diff > 0 ? 4 : diff < 0 ? 1 : 2;
  return { points, goalDiff: diff };
}
