import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createGameday, listGamedays } from "../api/endpoints";
import type { GamedaySummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiClientError } from "../api/client";
import { formatMatchdayDate, toDatetimeLocalValue } from "../utils/format";
import { usePolling } from "../hooks/usePolling";

const statusClass: Record<string, string> = {
  OPEN: "badge-open",
  COMPLETED: "badge-completed",
  CANCELLED: "badge-cancelled",
  CLOSED: "badge-completed",
};

// "Completed" ran wide on the mobile table - same meaning, half the width.
const statusLabel: Record<string, string> = {
  COMPLETED: "Done",
};

export function GamedaysList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [gamedays, setGamedays] = useState<GamedaySummary[] | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const [error, setError] = useState<string | null>(null);

  function load() {
    listGamedays()
      .then((res) => setGamedays(res.gamedays.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())))
      .catch(() => setGamedays([]));
  }

  useEffect(load, []);
  usePolling(load, 30000);

  // Derived client-side (not from /seasons, which only lists years with a
  // completed result) so a brand-new season with only upcoming gamedays
  // still gets its own tab instead of being hidden.
  const years = useMemo(() => {
    if (!gamedays) return [];
    return Array.from(new Set(gamedays.map((g) => new Date(g.date).getUTCFullYear()))).sort((a, b) => b - a);
  }, [gamedays]);

  useEffect(() => {
    if (year !== null || years.length === 0) return;
    const currentYear = new Date().getUTCFullYear();
    setYear(years.includes(currentYear) ? currentYear : years[0]);
  }, [years, year]);

  const visible = gamedays?.filter((g) => new Date(g.date).getUTCFullYear() === year) ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Matchdays</h2>
          <p>Sign up, bring a guest, or check who's confirmed.</p>
        </div>
        {user?.isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "+ New matchday"}
          </button>
        )}
      </div>

      {showForm && (
        <CreateGamedayForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
          onError={setError}
        />
      )}
      {error && <div className="alert alert-error">{error}</div>}

      {years.length > 0 && (
        <div className="season-tabs">
          {years.map((y) => (
            <button key={y} className={y === year ? "active" : ""} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        {gamedays === null && <div className="loading">Loading...</div>}
        {gamedays?.length === 0 && <div className="empty-state">No matchdays yet.</div>}
        {gamedays && gamedays.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Score</th>
                <th>Status</th>
                <th className="num">Players</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => (
                <tr key={g.id} onClick={() => navigate(`/gamedays/${g.id}`)} style={{ cursor: "pointer" }}>
                  <td>{g.matchday}</td>
                  <td>
                    <Link to={`/gamedays/${g.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      {formatMatchdayDate(g.date)}
                    </Link>
                  </td>
                  <td>{g.result ? `${g.result.teamAScore}:${g.result.teamBScore}` : "—"}</td>
                  <td>
                    <span className={`badge ${statusClass[g.status] || ""}`}>{statusLabel[g.status] || g.status}</span>
                  </td>
                  <td className="num">
                    {g.confirmedCount}/{g.maxPlayers}
                    {g.waitlistedCount > 0 ? ` (+${g.waitlistedCount})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function defaultGamedayDate(): string {
  const d = new Date();
  d.setHours(19, 0, 0, 0);
  return toDatetimeLocalValue(d.toISOString());
}

function CreateGamedayForm({ onCreated, onError }: { onCreated: () => void; onError: (m: string | null) => void }) {
  const [date, setDate] = useState(defaultGamedayDate);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onError(null);
    setSubmitting(true);
    try {
      await createGameday({ date: new Date(date).toISOString() });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiClientError ? err.message : "Could not create matchday");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">New matchday</div>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="date">Date &amp; time</label>
            <input id="date" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create matchday"}
        </button>
      </form>
    </div>
  );
}
