import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStandings, listSeasons } from "../api/endpoints";
import type { StandingRow } from "../api/types";
import { useAuth } from "../auth/AuthContext";

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Season leaderboard</h2>
          <p>Ranked by points, then goal difference. Jan 1 – Dec 31 each year. Guests aren't ranked.</p>
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
        {rows === null && <div className="loading">Loading...</div>}
        {rows?.length === 0 && <div className="empty-state">No results recorded for this season yet.</div>}
        {rows && rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th className="num">Games</th>
                <th className="num">Points</th>
                <th className="num">Goal diff</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.playerId} className={row.playerId === player?.id ? "me" : ""}>
                  <td className={row.rank <= 3 ? `rank-${row.rank}` : ""}>
                    {row.rank}
                    {typeof row.momentum === "number" && row.momentum !== 0 && (
                      <span
                        className={`momentum ${row.momentum > 0 ? "momentum-up" : "momentum-down"}`}
                        title={row.momentum > 0 ? `Up ${row.momentum} since the last gameday` : `Down ${Math.abs(row.momentum)} since the last gameday`}
                      >
                        {row.momentum > 0 ? "▲" : "▼"}
                        {Math.abs(row.momentum)}
                      </span>
                    )}
                  </td>
                  <td>
                    <Link to={`/players/${row.playerId}`} style={{ textDecoration: "none", color: "inherit" }}>
                      {row.name}
                    </Link>
                    {row.currentForm.veteran && (
                      <span className="mini-badge" title="Veteran - played all of the last 5">
                        🎖️
                      </span>
                    )}
                    {row.currentForm.undefeated && (
                      <span className="mini-badge" title="Undefeated - unbeaten in the last 5">
                        🛡️
                      </span>
                    )}
                    {row.currentForm.unlucky && (
                      <span className="mini-badge" title="Unlucky - lost the last 5">
                        🌧️
                      </span>
                    )}
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
