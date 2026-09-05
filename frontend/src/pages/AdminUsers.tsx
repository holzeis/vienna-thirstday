import { useEffect, useState } from "react";
import {
  adminApproveUser,
  adminDeleteUser,
  adminListGuestPlayers,
  adminListMerges,
  adminListUsers,
  adminRejectUser,
  adminSetRoles,
  adminUndoMerge,
} from "../api/endpoints";
import type { Player, PlayerMerge, User } from "../api/types";
import { ApiClientError } from "../api/client";
import { formatDateTime } from "../utils/format";

type UserWithPlayer = User & { player: Player | null };
type GuestOption = Player & { gamesPlayed: number };

export function AdminUsers() {
  const [users, setUsers] = useState<UserWithPlayer[] | null>(null);
  const [guests, setGuests] = useState<GuestOption[] | null>(null);
  const [merges, setMerges] = useState<PlayerMerge[] | null>(null);
  const [mergeChoice, setMergeChoice] = useState<Record<number, string>>({});
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyMergeId, setBusyMergeId] = useState<number | null>(null);

  function load() {
    adminListUsers()
      .then((res) => setUsers(res.users))
      .catch(() => setUsers([]));
    adminListGuestPlayers()
      .then((res) => setGuests(res.guests))
      .catch(() => setGuests([]));
    adminListMerges()
      .then((res) => setMerges(res.merges))
      .catch(() => setMerges([]));
  }

  useEffect(load, []);

  async function withBusy(id: number, fn: () => Promise<unknown>) {
    setError(null);
    setBusyId(id);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  function approve(u: UserWithPlayer) {
    const choice = mergeChoice[u.id];
    const guestId = choice ? parseInt(choice, 10) : undefined;
    withBusy(u.id, () => adminApproveUser(u.id, guestId));
  }

  function deleteUser(u: UserWithPlayer) {
    if (!window.confirm(`Delete the account for ${u.player?.name || u.email}? This cannot be undone.`)) return;
    withBusy(u.id, () => adminDeleteUser(u.id));
  }

  async function undoMerge(m: PlayerMerge) {
    if (!window.confirm(`Undo merging "${m.guestPlayerName}" into ${m.targetPlayer.name}? This recreates ${m.guestPlayerName} as a separate guest.`))
      return;
    setError(null);
    setBusyMergeId(m.id);
    try {
      await adminUndoMerge(m.id);
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not undo merge");
    } finally {
      setBusyMergeId(null);
    }
  }

  if (users === null) return <div className="loading">Loading...</div>;

  const pending = users.filter((u) => u.status === "PENDING");
  const others = users.filter((u) => u.status !== "PENDING");

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Admin: users</h2>
          <p>Approve new sign-ups and manage roles.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="card-title">Pending approval ({pending.length})</div>
        {pending.length === 0 && <div className="empty-state">Nothing pending.</div>}
        {pending.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Merge with existing player</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.player?.name || u.email}
                    <div style={{ color: "var(--text-faint)", fontSize: 12 }}>{u.email}</div>
                  </td>
                  <td>
                    <select
                      className="select"
                      value={mergeChoice[u.id] || ""}
                      disabled={busyId === u.id || !guests || guests.length === 0}
                      onChange={(e) => setMergeChoice((prev) => ({ ...prev, [u.id]: e.target.value }))}
                    >
                      <option value="">— new player, no history —</option>
                      {guests?.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.gamesPlayed} {g.gamesPlayed === 1 ? "game" : "games"})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button className="btn btn-sm btn-primary" disabled={busyId === u.id} onClick={() => approve(u)}>
                        Approve
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busyId === u.id}
                        onClick={() => withBusy(u.id, () => adminRejectUser(u.id))}
                      >
                        Reject
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {guests && guests.length > 0 && (
          <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 10 }}>
            "Merge with existing player" picks up an unclaimed guest/imported player's full history (points, goal
            difference, past gamedays) and attaches it to this new account. Use it when you recognize the new
            sign-up as someone who already has history from before the app existed.
          </p>
        )}
      </div>

      <div className="card users-table-wrap">
        <div className="card-title">All users</div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Admin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {others.map((u) => (
              <tr key={u.id}>
                <td>{u.player?.name || "—"}</td>
                <td>{u.email}</td>
                <td>
                  <span
                    className={`badge ${
                      u.status === "APPROVED" ? "badge-confirmed" : u.status === "REJECTED" ? "badge-cancelled" : "badge-waitlisted"
                    }`}
                  >
                    {u.status}
                  </span>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={u.isAdmin}
                    disabled={busyId === u.id}
                    onChange={(e) => withBusy(u.id, () => adminSetRoles(u.id, { isAdmin: e.target.checked }))}
                  />
                </td>
                <td>
                  <button className="btn btn-sm btn-danger" disabled={busyId === u.id} onClick={() => deleteUser(u)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="users-list-wrap">
        <div className="card-title" style={{ marginBottom: 10 }}>
          All users
        </div>
        {others.map((u) => (
          <div className="card user-card" key={u.id}>
            <div className="user-card-row">
              <div>
                <div className="user-card-name">{u.player?.name || "—"}</div>
                <span
                  className={`badge ${
                    u.status === "APPROVED" ? "badge-confirmed" : u.status === "REJECTED" ? "badge-cancelled" : "badge-waitlisted"
                  }`}
                >
                  {u.status}
                </span>
              </div>
              <div className="user-card-actions">
                <label className="admin-toggle">
                  <input
                    type="checkbox"
                    checked={u.isAdmin}
                    disabled={busyId === u.id}
                    onChange={(e) => withBusy(u.id, () => adminSetRoles(u.id, { isAdmin: e.target.checked }))}
                  />
                  Admin
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="More options"
                  onClick={() => setExpandedUserId((id) => (id === u.id ? null : u.id))}
                >
                  ☰
                </button>
              </div>
            </div>
            {expandedUserId === u.id && (
              <div className="user-card-details">
                <div className="user-card-email">{u.email}</div>
                <button className="btn btn-sm btn-danger" disabled={busyId === u.id} onClick={() => deleteUser(u)}>
                  Delete user
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {merges && merges.length > 0 && (
        <div className="card">
          <div className="card-title">Recent guest merges</div>
          <ul className="subtle-list">
            {merges.map((m) => (
              <li key={m.id}>
                <span>
                  <strong>{m.guestPlayerName}</strong> merged into <strong>{m.targetPlayer.name}</strong>
                  <div style={{ color: "var(--text-faint)", fontSize: 12 }}>
                    {formatDateTime(m.createdAt)} by {m.mergedBy.email}
                    {m.undoneAt && " · undone"}
                  </div>
                </span>
                {!m.undoneAt && (
                  <button className="btn btn-sm" disabled={busyMergeId === m.id} onClick={() => undoMerge(m)}>
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
