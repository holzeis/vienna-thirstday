import { useEffect, useState } from "react";
import { adminApproveUser, adminListUsers, adminRejectUser, adminSetRoles } from "../api/endpoints";
import type { Player, User } from "../api/types";
import { ApiClientError } from "../api/client";

type UserWithPlayer = User & { player: Player | null };

export function AdminUsers() {
  const [users, setUsers] = useState<UserWithPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function load() {
    adminListUsers()
      .then((res) => setUsers(res.users))
      .catch(() => setUsers([]));
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
          <ul className="subtle-list">
            {pending.map((u) => (
              <li key={u.id}>
                <span>
                  {u.player?.name || u.email} <span style={{ color: "var(--text-faint)" }}>({u.email})</span>
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-sm btn-primary" disabled={busyId === u.id} onClick={() => withBusy(u.id, () => adminApproveUser(u.id))}>
                    Approve
                  </button>
                  <button className="btn btn-sm btn-danger" disabled={busyId === u.id} onClick={() => withBusy(u.id, () => adminRejectUser(u.id))}>
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-title">All users</div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Admin</th>
              <th>Player</th>
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
                  <input
                    type="checkbox"
                    checked={u.isPlayer}
                    disabled={busyId === u.id}
                    onChange={(e) => withBusy(u.id, () => adminSetRoles(u.id, { isPlayer: e.target.checked }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
