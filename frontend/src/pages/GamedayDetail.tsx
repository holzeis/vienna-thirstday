import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  cancelRegistration,
  createGuest,
  getGameday,
  listMyGuests,
  registerForGameday,
  setResult,
  setTeams,
} from "../api/endpoints";
import type { GamedayDetail as GamedayDetailType, Player, RegistrationView, Team } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiClientError } from "../api/client";
import { formatDateTime } from "../utils/format";

const statusClass: Record<string, string> = {
  OPEN: "badge-open",
  COMPLETED: "badge-completed",
  CANCELLED: "badge-cancelled",
  CLOSED: "badge-completed",
};

export function GamedayDetail() {
  const { id } = useParams();
  const gamedayId = parseInt(id!, 10);
  const { user, player } = useAuth();

  const [gameday, setGameday] = useState<GamedayDetailType | null>(null);
  const [myGuests, setMyGuests] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    getGameday(gamedayId)
      .then((res) => setGameday(res.gameday))
      .catch(() => setGameday(null));
  }

  useEffect(load, [gamedayId]);
  useEffect(() => {
    listMyGuests().then((res) => setMyGuests(res.guests));
  }, []);

  if (gameday === null) return <div className="loading">Loading...</div>;

  const activeRegs = gameday.registrations;
  const confirmed = activeRegs.filter((r) => r.status === "CONFIRMED");
  const waitlisted = activeRegs.filter((r) => r.status === "WAITLISTED");
  const myRegistration = activeRegs.find((r) => r.player.id === player?.id);
  const myGuestRegistrations = activeRegs.filter(
    (r) => r.player.isGuest && r.registeredBy.id === user?.id && r.player.id !== player?.id
  );

  async function doAction(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{formatDateTime(gameday.date)}</h2>
          <p>{gameday.location || "Location TBD"}</p>
        </div>
        <span className={`badge ${statusClass[gameday.status] || ""}`}>{gameday.status}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">
            Confirmed ({confirmed.length}/{gameday.maxPlayers})
          </div>
          <PlayerList
            regs={confirmed}
            currentUserId={user!.id}
            isAdmin={!!user?.isAdmin}
            busy={busy}
            onCancel={(regId) => doAction(() => cancelRegistration(gamedayId, regId))}
          />
        </div>
        <div className="card">
          <div className="card-title">Waitlist ({waitlisted.length})</div>
          <PlayerList
            regs={waitlisted}
            currentUserId={user!.id}
            isAdmin={!!user?.isAdmin}
            busy={busy}
            onCancel={(regId) => doAction(() => cancelRegistration(gamedayId, regId))}
          />
        </div>
      </div>

      {gameday.status === "OPEN" && (
        <div className="card">
          <div className="card-title">Sign up</div>
          {!myRegistration ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => doAction(() => registerForGameday(gamedayId))}>
              I'm in
            </button>
          ) : (
            <div className="badge badge-confirmed">You're {myRegistration.status.toLowerCase()}</div>
          )}

          <div className="divider" />
          <GuestSignup
            myGuests={myGuests}
            alreadyRegisteredGuestIds={myGuestRegistrations.map((r) => r.player.id)}
            busy={busy}
            onCreateAndRegister={async (name) => {
              setError(null);
              setBusy(true);
              try {
                const { guest } = await createGuest(name);
                setMyGuests((g) => [...(g || []), guest]);
                await registerForGameday(gamedayId, guest.id);
                load();
              } catch (err) {
                setError(err instanceof ApiClientError ? err.message : "Could not add guest");
              } finally {
                setBusy(false);
              }
            }}
            onRegisterExisting={(playerId) => doAction(() => registerForGameday(gamedayId, playerId))}
          />
        </div>
      )}

      {user?.isAdmin && <AdminSection gamedayId={gamedayId} gameday={gameday} activeRegs={activeRegs} onChanged={load} />}

      {gameday.result && (
        <div className="card">
          <div className="card-title">Result</div>
          <div className="score-box">
            <span>{gameday.result.teamAScore}</span>
            <span className="dash">:</span>
            <span>{gameday.result.teamBScore}</span>
          </div>
          <div className="team-columns">
            <div className="team-col">
              <h4>Team A</h4>
              <ul className="subtle-list">
                {gameday.result.playerStats
                  .filter((s) => s.team === "A")
                  .map((s) => (
                    <li key={s.id}>
                      {s.player.name}
                      <span>
                        {s.points} pts / {s.goalDiff > 0 ? `+${s.goalDiff}` : s.goalDiff} GD
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="vs">VS</div>
            <div className="team-col">
              <h4>Team B</h4>
              <ul className="subtle-list">
                {gameday.result.playerStats
                  .filter((s) => s.team === "B")
                  .map((s) => (
                    <li key={s.id}>
                      {s.player.name}
                      <span>
                        {s.points} pts / {s.goalDiff > 0 ? `+${s.goalDiff}` : s.goalDiff} GD
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerList({
  regs,
  currentUserId,
  isAdmin,
  busy,
  onCancel,
}: {
  regs: RegistrationView[];
  currentUserId: number;
  isAdmin: boolean;
  busy: boolean;
  onCancel: (regId: number) => void;
}) {
  if (regs.length === 0) return <div className="empty-state">Nobody yet.</div>;
  return (
    <ul className="subtle-list">
      {regs.map((r) => {
        const canCancel = isAdmin || r.registeredBy.id === currentUserId;
        return (
          <li key={r.id}>
            <span>
              {r.player.name} {r.player.isGuest && <span className="badge badge-guest">Guest</span>}
            </span>
            {canCancel && (
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onCancel(r.id)}>
                Cancel
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GuestSignup({
  myGuests,
  alreadyRegisteredGuestIds,
  busy,
  onCreateAndRegister,
  onRegisterExisting,
}: {
  myGuests: Player[] | null;
  alreadyRegisteredGuestIds: number[];
  busy: boolean;
  onCreateAndRegister: (name: string) => void;
  onRegisterExisting: (playerId: number) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [newName, setNewName] = useState("");

  const available = (myGuests || []).filter((g) => !alreadyRegisteredGuestIds.includes(g.id));

  return (
    <div>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Bring a guest
      </div>
      {available.length > 0 && (
        <div className="form-row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label>Existing guest</label>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select a guest...</option>
              {available.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn"
            disabled={busy || !selected}
            onClick={() => {
              onRegisterExisting(parseInt(selected, 10));
              setSelected("");
            }}
          >
            Register guest
          </button>
        </div>
      )}
      <div className="form-row" style={{ alignItems: "flex-end", marginTop: 8 }}>
        <div className="field">
          <label>New guest name</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Bob" />
        </div>
        <button
          className="btn"
          disabled={busy || !newName.trim()}
          onClick={() => {
            onCreateAndRegister(newName.trim());
            setNewName("");
          }}
        >
          Add &amp; register guest
        </button>
      </div>
    </div>
  );
}

function AdminSection({
  gamedayId,
  gameday,
  activeRegs,
  onChanged,
}: {
  gamedayId: number;
  gameday: GamedayDetailType;
  activeRegs: RegistrationView[];
  onChanged: () => void;
}) {
  const [assignments, setAssignments] = useState<Record<number, Team | "">>({});
  const [teamAScore, setTeamAScore] = useState(gameday.result?.teamAScore ?? 0);
  const [teamBScore, setTeamBScore] = useState(gameday.result?.teamBScore ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const initial: Record<number, Team | ""> = {};
    for (const r of activeRegs) initial[r.player.id] = "";
    for (const ta of gameday.teamAssignments) initial[ta.player.id] = ta.team;
    setAssignments(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameday.id, gameday.teamAssignments.length]);

  async function saveTeams() {
    setError(null);
    setBusy(true);
    try {
      const list = Object.entries(assignments)
        .filter(([, team]) => team === "A" || team === "B")
        .map(([playerId, team]) => ({ playerId: parseInt(playerId, 10), team: team as Team }));
      await setTeams(gamedayId, list);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save teams");
    } finally {
      setBusy(false);
    }
  }

  async function saveResult() {
    setError(null);
    setBusy(true);
    try {
      await setResult(gamedayId, teamAScore, teamBScore);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save result");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">Admin: teams &amp; result</div>
      {error && <div className="alert alert-error">{error}</div>}

      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Team</th>
          </tr>
        </thead>
        <tbody>
          {activeRegs.map((r) => (
            <tr key={r.player.id}>
              <td>
                {r.player.name} {r.player.isGuest && <span className="badge badge-guest">Guest</span>}
              </td>
              <td>
                <select
                  className="select select-sm"
                  value={assignments[r.player.id] || ""}
                  onChange={(e) =>
                    setAssignments((prev) => ({ ...prev, [r.player.id]: e.target.value as Team | "" }))
                  }
                >
                  <option value="">Unassigned</option>
                  <option value="A">Team A</option>
                  <option value="B">Team B</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={saveTeams}>
          Save teams
        </button>
      </div>

      <div className="divider" />

      <div className="form-row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Team A score</label>
          <input
            type="number"
            min={0}
            value={teamAScore}
            onChange={(e) => setTeamAScore(parseInt(e.target.value, 10) || 0)}
          />
        </div>
        <div className="field">
          <label>Team B score</label>
          <input
            type="number"
            min={0}
            value={teamBScore}
            onChange={(e) => setTeamBScore(parseInt(e.target.value, 10) || 0)}
          />
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={saveResult}>
          Save result
        </button>
      </div>
    </div>
  );
}
