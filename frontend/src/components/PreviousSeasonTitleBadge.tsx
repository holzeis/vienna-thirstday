import type { PreviousSeasonTitle } from "../api/types";

/** Badge marking last season's champion/vice-champion - shared between the full leaderboard and the Home Screen's Top 5. */
export function PreviousSeasonTitleBadge({ title, season }: { title: PreviousSeasonTitle; season: number }) {
  if (title === "champion") {
    return (
      <span className="mini-badge" title={`Champion, ${season} season`}>
        👑
      </span>
    );
  }
  if (title === "viceChampion") {
    return (
      <span className="mini-badge" title={`Vice champion, ${season} season`}>
        🥈
      </span>
    );
  }
  return null;
}
