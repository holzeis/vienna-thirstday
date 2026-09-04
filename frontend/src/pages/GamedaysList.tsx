import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createGameday, listGamedays } from "../api/endpoints";
import type { GamedaySummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiClientError } from "../api/client";
import { formatDateTime, toDatetimeLocalValue } from "../utils/format";

const statusClass: Record<string, string> = {
  OPEN: "badge-open",
  COMPLETED: "badge-completed",
  CANCELLED: "badge-cancelled",
  CLOSED: "badge-completed",
};

export function GamedaysList() {
  const { user } = useAuth();
  const [gamedays, setGamedays] = useState<GamedaySummary[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    listGamedays()
      .then((res) => setGamedays(res.gamedays.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())))
      .catch(() => setGamedays([]));
  }

  useEffect(load, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Gamedays</h2>
          <p>Sign up, bring a guest, or check who's confirmed.</p>
        </div>
        {user?.isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "+ New gameday"}
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

      <div className="card">
        {gamedays === null && <div className="loading">Loading...</div>}
        {gamedays?.length === 0 && <div className="empty-state">No gamedays yet.</div>}
        {gamedays && gamedays.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Location</th>
                <th>Status</th>
                <th className="num">Players</th>
              </tr>
            </thead>
            <tbody>
              {gamedays.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link to={`/gamedays/${g.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      {formatDateTime(g.date)}
                    </Link>
                  </td>
                  <td>{g.location || "—"}</td>
                  <td>
                    <span className={`badge ${statusClass[g.status] || ""}`}>{g.status}</span>
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

function CreateGamedayForm({ onCreated, onError }: { onCreated: () => void; onError: (m: string | null) => void }) {
  const [date, setDate] = useState(toDatetimeLocalValue());
  const [location, setLocation] = useState("");
  const [minPlayers, setMinPlayers] = useState(8);
  const [maxPlayers, setMaxPlayers] = useState(14);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onError(null);
    setSubmitting(true);
    try {
      await createGameday({
        date: new Date(date).toISOString(),
        location: location || undefined,
        minPlayers,
        maxPlayers,
      });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiClientError ? err.message : "Could not create gameday");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">New gameday</div>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="date">Date &amp; time</label>
            <input id="date" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="location">Location</label>
            <input id="location" placeholder="e.g. Platz 7" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="min">Min players</label>
            <input
              id="min"
              type="number"
              min={2}
              value={minPlayers}
              onChange={(e) => setMinPlayers(parseInt(e.target.value, 10))}
            />
          </div>
          <div className="field">
            <label htmlFor="max">Max players</label>
            <input
              id="max"
              type="number"
              min={2}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(parseInt(e.target.value, 10))}
            />
          </div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create gameday"}
        </button>
      </form>
    </div>
  );
}
