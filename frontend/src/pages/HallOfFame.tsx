import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getHallOfFame, listSeasons } from "../api/endpoints";
import type { HallOfFameResponse, PodiumEntry, SeasonAwardCategory } from "../api/types";

type PodiumTier = "gold" | "silver" | "bronze";

const SEASON_LABELS: Record<SeasonAwardCategory, string> = {
  ranking: "Season Ranking",
  mostGames: "Most Games",
  mostGoals: "Most Goals",
  longestWinStreak: "Win Streak",
  longestLossStreak: "Loss Streak",
};

const SEASON_ICONS: Record<SeasonAwardCategory, string> = {
  ranking: "🏆",
  mostGames: "🏃",
  mostGoals: "⚽",
  longestWinStreak: "🔥",
  longestLossStreak: "🥶",
};

const CATEGORIES: SeasonAwardCategory[] = ["ranking", "mostGames", "mostGoals", "longestWinStreak", "longestLossStreak"];
const TIER_MEDALS: Record<PodiumTier, string> = { gold: "🥇", silver: "🥈", bronze: "🥉" };
const TIERS: PodiumTier[] = ["gold", "silver", "bronze"];

function MedalChip({ tier, entry }: { tier: PodiumTier; entry: PodiumEntry | null }) {
  if (!entry) return <span className="medal-chip medal-chip-empty">—</span>;
  return (
    <Link to={`/players/${entry.playerId}`} className="medal-chip">
      <span className="m">{TIER_MEDALS[tier]}</span>
      <span className="n-group">
        <span className="n">{entry.name}</span>
        {entry.isGuest && (
          <span className="mini-badge" title="Guest">
            👤
          </span>
        )}
      </span>
      <span className="v">{entry.value}</span>
    </Link>
  );
}

export function HallOfFame() {
  const [completedSeasons, setCompletedSeasons] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [data, setData] = useState<HallOfFameResponse | null>(null);

  useEffect(() => {
    const currentYear = new Date().getUTCFullYear();
    listSeasons().then((res) => {
      const completed = res.seasons.filter((y) => y < currentYear);
      setCompletedSeasons(completed);
      setSelected(completed[0] ?? currentYear - 1);
    });
  }, []);

  useEffect(() => {
    if (selected === null) return;
    setData(null);
    getHallOfFame(selected).then((res) => setData(res));
  }, [selected]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Hall of Fame</h2>
          <p>Records for each completed season - a season's awards land once it's over.</p>
        </div>
      </div>

      {completedSeasons !== null && completedSeasons.length === 0 && (
        <div className="empty-state">No completed seasons yet - check back once this season wraps up.</div>
      )}

      {completedSeasons !== null && completedSeasons.length > 0 && (
        <div className="season-tabs">
          {completedSeasons.map((s) => (
            <button key={s} className={s === selected ? "active" : ""} onClick={() => setSelected(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {data === null && completedSeasons !== null && completedSeasons.length > 0 && <div className="loading">Loading...</div>}

      {data && (
        <>
          <div className="card hof-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>🥇 Gold</th>
                  <th>🥈 Silver</th>
                  <th>🥉 Bronze</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat) => {
                  const podium = data.podiums[cat];
                  return (
                    <tr key={cat}>
                      <td>
                        <div className="hof-cat-cell">
                          {SEASON_ICONS[cat]} {SEASON_LABELS[cat]}
                        </div>
                      </td>
                      <td>
                        <MedalChip tier="gold" entry={podium.gold} />
                      </td>
                      <td>
                        <MedalChip tier="silver" entry={podium.silver} />
                      </td>
                      <td>
                        <MedalChip tier="bronze" entry={podium.bronze} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="hof-list-wrap">
            {CATEGORIES.map((cat) => {
              const podium = data.podiums[cat];
              return (
                <div className="card hof-list-card" key={cat}>
                  <div className="hof-cat-cell">
                    {SEASON_ICONS[cat]} {SEASON_LABELS[cat]}
                  </div>
                  {TIERS.map((tier) => (
                    <MedalChip key={tier} tier={tier} entry={podium[tier]} />
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
