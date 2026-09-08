import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStandings, listSeasons } from "../api/endpoints";
import type { StandingRow } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { usePolling } from "../hooks/usePolling";
import { CurrentFormBadges } from "../components/CurrentFormBadges";
import { Spinner } from "../components/LoadingScreen";

export function Standings() {
  const { player } = useAuth();
  const [seasons, setSeasons] = useState<number[] | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [rows, setRows] = useState<StandingRow[] | null>(null);

  useEffect(() => {
    listSeasons().then((res) => {
      setSeasons(res.seasons);
      const currentYear = new Date().getUTCFullYear();
      setYear(res.seasons.includes(currentYear) ? currentYear : res.seasons[0] ?? currentYear);
    });
  }, []);

  useEffect(() => {
    if (year === null) return;
    setRows(null);
    getStandings(year).then((res) => setRows(res.standings));
  }, [year]);

  // Refreshes the same year's rows in place (no setRows(null) - avoids
  // flashing back to the loading state on every poll tick).
  usePolling(() => {
    if (year !== null) getStandings(year).then((res) => setRows(res.standings));
  }, 30000);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Season leaderboard</h2>
          <p>Ranked by points, then goal difference. Jan 1 – Dec 31 each year.</p>
        </div>
      </div>

      {seasons && seasons.length > 0 && (
        <div className="season-tabs">
          {seasons.map((s) => (
            <button key={s} className={s === year ? "active" : ""} onClick={() => setYear(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        {rows === null && <Spinner />}
        {rows?.length === 0 && <div className="empty-state">No results recorded for this season yet.</div>}
        {rows && rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th className="num">Games</th>
                <th className="num">PTS</th>
                <th className="num">GD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.playerId} className={row.playerId === player?.id ? "me" : ""}>
                  <td className={row.rank <= 3 ? `rank-${row.rank}` : ""} style={{ whiteSpace: "nowrap" }}>
                    {row.rank}
                    {typeof row.momentum === "number" && row.momentum !== 0 && (
                      <span
                        className={`momentum ${row.momentum > 0 ? "momentum-up" : "momentum-down"}`}
                        title={row.momentum > 0 ? `Up ${row.momentum} since the last matchday` : `Down ${Math.abs(row.momentum)} since the last matchday`}
                      >
                        {row.momentum > 0 ? "▲" : "▼"}
                        {Math.abs(row.momentum)}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="player-cell">
                      <Link to={`/players/${row.playerId}`} style={{ textDecoration: "none", color: "inherit" }}>
                        {row.name}
                      </Link>
                      <CurrentFormBadges currentForm={row.currentForm} />
                    </span>
                  </td>
                  <td className="num">{row.gamesPlayed}</td>
                  <td className="num">{row.points}</td>
                  <td className="num">{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
