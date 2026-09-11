import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStandings, listGamedays, listSeasons } from "../api/endpoints";
import type { GamedaySummary, StandingRow } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { formatDate } from "../utils/format";
import { usePolling } from "../hooks/usePolling";
import { CurrentFormBadges } from "../components/CurrentFormBadges";
import { PreviousSeasonTitleBadge } from "../components/PreviousSeasonTitleBadge";
import { NewcomerBadge } from "../components/NewcomerBadge";
import { Spinner } from "../components/LoadingScreen";

function loadUpcoming(setUpcoming: (gamedays: GamedaySummary[]) => void) {
  listGamedays()
    .then((res) => {
      const now = Date.now();
      const future = res.gamedays
        .filter((g) => new Date(g.date).getTime() >= now - 1000 * 60 * 60 * 12 && g.status !== "CANCELLED")
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setUpcoming(future.slice(0, 3));
    })
    .catch(() => setUpcoming([]));
}

export function Overview() {
  const { user, player } = useAuth();
  const [upcoming, setUpcoming] = useState<GamedaySummary[] | null>(null);
  const [top, setTop] = useState<StandingRow[] | null>(null);
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    loadUpcoming(setUpcoming);

    listSeasons().then((res) => {
      const currentYear = new Date().getUTCFullYear();
      const y = res.seasons.includes(currentYear) ? currentYear : res.seasons[0];
      if (!y) {
        setTop([]);
        return;
      }
      setYear(y);
      getStandings(y).then((r) => setTop(r.standings.slice(0, 5)));
    });
  }, []);

  usePolling(() => {
    loadUpcoming(setUpcoming);
    if (year !== null) getStandings(year).then((r) => setTop(r.standings.slice(0, 5)));
  }, 30000);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Welcome{player ? `, ${player.name}` : ""}</h2>
          <p>Here's what's coming up and how the season table looks.</p>
        </div>
      </div>

      {user?.isAdmin && (
        <div className="card">
          <div className="card-title">Admin shortcuts</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/gamedays?new=1" className="btn btn-primary btn-sm">
              Create a matchday
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Next matchdays</div>
          {upcoming === null && <Spinner />}
          {upcoming?.length === 0 && <div className="empty-state">No upcoming matchdays yet.</div>}
          {upcoming && upcoming.length > 0 && (
            <ul className="subtle-list">
              {upcoming.map((g) => (
                <li key={g.id} style={{ padding: 0 }}>
                  <Link
                    to={`/gamedays/${g.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      width: "100%",
                      padding: "8px 10px",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <strong>{formatDate(g.date)}</strong>
                    <span className="badge badge-confirmed">
                      {g.confirmedCount + g.waitlistedCount}/{g.maxPlayers}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="card-footer">
            <Link to="/gamedays" className="btn btn-sm">
              View all matchdays
            </Link>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Season {year ?? ""} — Top 5</div>
          {top === null && <Spinner />}
          {top?.length === 0 && <div className="empty-state">No results recorded yet.</div>}
          {top && top.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th className="num">Pts</th>
                  <th className="num">GD</th>
                </tr>
              </thead>
              <tbody>
                {top.map((row) => (
                  <tr key={row.playerId} className={row.playerId === player?.id ? "me" : ""}>
                    <td className={row.rank <= 3 ? `rank-${row.rank}` : ""}>{row.rank}</td>
                    <td>
                      <span className="player-cell">
                        <Link to={`/players/${row.playerId}`} style={{ textDecoration: "none", color: "inherit" }}>
                          {row.name}
                        </Link>
                        <PreviousSeasonTitleBadge title={row.previousSeasonTitle} season={(year ?? new Date().getUTCFullYear()) - 1} />
                        <NewcomerBadge isNewcomer={row.isNewcomer} />
                        <CurrentFormBadges currentForm={row.currentForm} />
                      </span>
                    </td>
                    <td className="num">{row.points}</td>
                    <td className="num">{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="card-footer">
            <Link to="/standings" className="btn btn-sm">
              Full leaderboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
