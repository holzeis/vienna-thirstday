import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  cancelGameday,
  cancelRegistration,
  createGuest,
  deleteGameday,
  getGameday,
  getGamedayShareLink,
  listGuests,
  registerForGameday,
  setResult,
  setTeams,
} from "../api/endpoints";
import type { GamedayDetail as GamedayDetailType, Player, RegistrationView, Team } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiClientError } from "../api/client";
import { formatDateTime } from "../utils/format";
import { usePolling } from "../hooks/usePolling";
import { useToast } from "../toast/ToastContext";
import { statusClass, statusLabel } from "../utils/gamedayStatus";

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const CancelIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <line x1="8" y1="8" x2="16" y2="16" />
  </svg>
);

export function GamedayDetail() {
  const { id } = useParams();
  const gamedayId = parseInt(id!, 10);
  const navigate = useNavigate();
  const { user, player } = useAuth();
  const { showToast } = useToast();

  const [gameday, setGameday] = useState<GamedayDetailType | null>(null);
  const [guests, setGuests] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const [shareToken, setShareToken] = useState<string | null>(null);

  function load() {
    getGameday(gamedayId)
      .then((res) => setGameday(res.gameday))
      .catch(() => setGameday(null));
  }

  useEffect(load, [gamedayId]);
  usePolling(load, 15000);
  useEffect(() => {
    listGuests().then((res) => setGuests(res.guests));
  }, []);

  // Fetched ahead of time (idempotent - always the same token) so the actual
  // "Share" click can copy synchronously: Safari/iOS only allows
  // navigator.clipboard access as the direct, synchronous result of a user
  // gesture, and an intervening `await` for a network call breaks that,
  // silently failing and falling back to a prompt() popup.
  useEffect(() => {
    if (gameday?.status === "OPEN") {
      getGamedayShareLink(gamedayId).then((res) => setShareToken(res.shareToken));
    }
  }, [gamedayId, gameday?.status]);

  if (gameday === null) return <div className="loading">Loading...</div>;

  const activeRegs = gameday.registrations;
  const confirmed = activeRegs.filter((r) => r.status === "CONFIRMED");
  const waitlisted = activeRegs.filter((r) => r.status === "WAITLISTED");
  const myRegistration = activeRegs.find((r) => r.player.id === player?.id);
  const registeredPlayerIds = activeRegs.map((r) => r.player.id);

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

  function shareLink() {
    setError(null);
    if (!shareToken) {
      setError("Still preparing the share link - try again in a moment.");
      return;
    }
    const url = `${window.location.origin}/join/${shareToken}`;
    // No `await` before this call - clipboard access must be the direct,
    // synchronous result of the click for Safari/iOS to allow it.
    navigator.clipboard.writeText(url).then(
      () => {
        setShareStatus("copied");
        setTimeout(() => setShareStatus("idle"), 1500);
        showToast("Link copied to clipboard");
      },
      () => {
        window.prompt("Copy this link:", url);
      }
    );
  }

  async function handleDelete() {
    if (!window.confirm("Delete this matchday? This cannot be undone.")) return;
    setError(null);
    setBusy(true);
    try {
      await deleteGameday(gamedayId);
      navigate("/gamedays");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not delete matchday");
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm("Cancel this matchday? Everyone currently signed up will be notified.")) return;
    doAction(() => cancelGameday(gamedayId));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{formatDateTime(gameday.date)}</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {gameday.status === "OPEN" && (
            <button className="icon-btn" aria-label="Copy sign-up link" title={shareStatus === "copied" ? "Copied!" : "Copy sign-up link"} onClick={shareLink}>
              <ShareIcon />
            </button>
          )}
          {user?.isAdmin && (gameday.status === "OPEN" || gameday.status === "CLOSED") && (
            <button className="icon-btn icon-btn-danger" aria-label="Cancel matchday" title="Cancel matchday" disabled={busy} onClick={handleCancel}>
              <CancelIcon />
            </button>
          )}
          {user?.isAdmin && (
            <button className="icon-btn icon-btn-danger" aria-label="Delete matchday" title="Delete matchday" disabled={busy} onClick={handleDelete}>
              <TrashIcon />
            </button>
          )}
          <span className={`badge ${statusClass[gameday.status] || ""}`}>{statusLabel[gameday.status] || gameday.status}</span>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {gameday.status !== "COMPLETED" && (
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
      )}

      {gameday.status === "OPEN" && (
        <div className="card">
          <div className="card-title">Sign up</div>
          {!myRegistration ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => doAction(() => registerForGameday(gamedayId))}>
              I'm in
            </button>
          ) : (
            <div className={`status-pill ${myRegistration.status === "WAITLISTED" ? "status-pill-waitlisted" : ""}`}>
              {myRegistration.status === "CONFIRMED" ? "✓ You're in" : "⏳ You're waitlisted"}
            </div>
          )}

          <div className="divider" />
          <GuestSignup
            guests={guests}
            registeredPlayerIds={registeredPlayerIds}
            busy={busy}
            onAddAndRegister={async (name) => {
              setError(null);
              setBusy(true);
              try {
                const { guest } = await createGuest(name);
                setGuests((g) => (g?.some((x) => x.id === guest.id) ? g : [...(g || []), guest]));
                await registerForGameday(gamedayId, guest.id);
                load();
              } catch (err) {
                setError(err instanceof ApiClientError ? err.message : "Could not add guest");
              } finally {
                setBusy(false);
              }
            }}
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
                      <Link to={`/players/${s.player.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        {s.player.name}
                      </Link>
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
                      <Link to={`/players/${s.player.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        {s.player.name}
                      </Link>
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
  guests,
  registeredPlayerIds,
  busy,
  onAddAndRegister,
}: {
  guests: Player[] | null;
  registeredPlayerIds: number[];
  busy: boolean;
  onAddAndRegister: (name: string) => void;
}) {
  const [name, setName] = useState("");

  // Only suggest guests not already signed up for this gameday - typing a
  // name that already exists (this list or not) reuses that guest rather
  // than creating a duplicate; the backend resolves that match by name.
  const available = (guests || []).filter((g) => !registeredPlayerIds.includes(g.id));

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAddAndRegister(trimmed);
    setName("");
  }

  return (
    <div>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Bring a guest
      </div>
      <div className="form-row" style={{ alignItems: "center" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <input
            id="guest-name"
            aria-label="Guest name"
            list="guest-options"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Type a name or pick an existing guest..."
          />
          <datalist id="guest-options">
            {available.map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
        </div>
        <button className="btn" disabled={busy || !name.trim()} onClick={submit}>
          Add guest
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
  // Kept as free-form text while typing (not a live-parsed number) so an
  // empty result starts blank instead of "0", and clearing the field to
  // enter a new score doesn't immediately snap back to "0" mid-edit.
  const [teamAScore, setTeamAScore] = useState(gameday.result ? String(gameday.result.teamAScore) : "");
  const [teamBScore, setTeamBScore] = useState(gameday.result ? String(gameday.result.teamBScore) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The result form only makes sense once the game has actually kicked off -
  // entering it earlier would also flip the gameday to COMPLETED early.
  const gameHasHappened = new Date(gameday.date).getTime() <= Date.now();

  useEffect(() => {
    const initial: Record<number, Team | ""> = {};
    for (const r of activeRegs) initial[r.player.id] = "";
    for (const ta of gameday.teamAssignments) initial[ta.player.id] = ta.team;
    setAssignments(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameday.id, gameday.teamAssignments.length]);

  /** Digits only while typing; blank/invalid resolves to 0 only once, at save time. */
  function sanitizeScoreInput(raw: string): string {
    return raw.replace(/[^0-9]/g, "");
  }

  function parseScore(raw: string): number {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

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
      await setResult(gamedayId, parseScore(teamAScore), parseScore(teamBScore));
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

      {activeRegs.length === 0 ? (
        <div className="empty-state">Nobody yet.</div>
      ) : (
        <>
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

          <div style={{ marginTop: 16, textAlign: "center" }}>
            <button className="btn" disabled={busy} onClick={saveTeams}>
              {busy ? "Saving..." : "Save teams"}
            </button>
          </div>
        </>
      )}

      {gameHasHappened && (
        <>
          <div className="divider" />

          <div className="card-title">Result</div>
          <div className="score-entry">
            <div className="field">
              <label>Team A</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="score-input"
                value={teamAScore}
                onChange={(e) => setTeamAScore(sanitizeScoreInput(e.target.value))}
              />
            </div>
            <span className="dash">:</span>
            <div className="field">
              <label>Team B</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="score-input"
                value={teamBScore}
                onChange={(e) => setTeamBScore(sanitizeScoreInput(e.target.value))}
              />
            </div>
          </div>

          <div style={{ marginTop: 16, textAlign: "center" }}>
            <button className="btn btn-primary" disabled={busy} onClick={saveResult}>
              {busy ? "Saving..." : "Save result"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
