import { useEffect, useState } from "react";
import {
  adminCreateInvite,
  adminDeleteUser,
  adminListGuestPlayers,
  adminListInvites,
  adminListMerges,
  adminListUsers,
  adminRevokeInvite,
  adminSetRoles,
  adminUndoMerge,
  createGuest,
} from "../api/endpoints";
import type { Invite, Player, PlayerMerge, User } from "../api/types";
import { ApiClientError } from "../api/client";
import { formatDateTime } from "../utils/format";

type UserWithPlayer = User & { player: Player | null };
type GuestOption = Player & { gamesPlayed: number };

const INVITE_STATUS_LABEL: Record<Invite["status"], string> = {
  pending: "Invited",
  used: "Accepted",
  expired: "Expired",
  revoked: "Revoked",
};

const INVITE_STATUS_BADGE: Record<Invite["status"], string> = {
  pending: "badge-waitlisted",
  used: "badge-confirmed",
  expired: "badge-cancelled",
  revoked: "badge-cancelled",
};

export function AdminUsers() {
  const [users, setUsers] = useState<UserWithPlayer[] | null>(null);
  const [guests, setGuests] = useState<GuestOption[] | null>(null);
  const [merges, setMerges] = useState<PlayerMerge[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyMergeId, setBusyMergeId] = useState<number | null>(null);

  const [inviteGuestName, setInviteGuestName] = useState("");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState(7);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [busyInviteId, setBusyInviteId] = useState<number | null>(null);
  const [justCreatedLink, setJustCreatedLink] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

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
    adminListInvites()
      .then((res) => setInvites(res.invites))
      .catch(() => setInvites([]));
  }

  useEffect(load, []);

  function inviteLink(token: string) {
    return `${window.location.origin}/invite/${token}`;
  }

  async function copyLink(token: string) {
    const link = inviteLink(token);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt("Copy this invite link:", link);
      return;
    }
    setCopiedToken(token);
    setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 1500);
  }

  async function createInvite() {
    const name = inviteGuestName.trim();
    if (!name) return;
    setError(null);
    setJustCreatedLink(null);
    setCreatingInvite(true);
    try {
      const { guest } = await createGuest(name);
      const res = await adminCreateInvite({ guestPlayerId: guest.id, expiresInDays: inviteExpiresInDays });
      setJustCreatedLink(inviteLink(res.invite.token));
      setInviteGuestName("");
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create invite");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function revokeInvite(invite: Invite) {
    if (!window.confirm("Revoke this invite? The link will stop working immediately.")) return;
    setError(null);
    setBusyInviteId(invite.id);
    try {
      await adminRevokeInvite(invite.id);
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not revoke invite");
    } finally {
      setBusyInviteId(null);
    }
  }

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

  function deleteUser(u: UserWithPlayer) {
    if (!window.confirm(`Delete the account for ${u.player?.name || "this user"}? This cannot be undone.`)) return;
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Admin: users</h2>
          <p>Invite players and manage roles.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="card-title">Invite a player</div>
        <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: -4, marginBottom: 12 }}>
          Every invite starts from a guest - pick an existing one to onboard them with their history attached, or
          type a new name to create one first. There's no self-service sign-up; send the resulting link however
          you'd reach this person.
        </p>
        <div className="form-row">
          <div className="field">
            <label htmlFor="invite-guest">Player</label>
            <input
              id="invite-guest"
              list="admin-guest-options"
              placeholder="Type or pick an existing guest..."
              value={inviteGuestName}
              disabled={creatingInvite}
              onChange={(e) => setInviteGuestName(e.target.value)}
            />
            <datalist id="admin-guest-options">
              {guests?.map((g) => (
                <option key={g.id} value={g.name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="invite-expires">Expires in (days)</label>
            <input
              id="invite-expires"
              type="number"
              inputMode="numeric"
              min={1}
              max={90}
              value={inviteExpiresInDays}
              disabled={creatingInvite}
              onChange={(e) => setInviteExpiresInDays(Math.min(90, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            />
          </div>
        </div>
        <button className="btn btn-primary btn-sm" disabled={creatingInvite || !inviteGuestName.trim()} onClick={createInvite}>
          {creatingInvite ? "Creating..." : "Create invite link"}
        </button>

        {justCreatedLink && (
          <div className="alert alert-success" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ wordBreak: "break-all" }}>{justCreatedLink}</span>
            <button className="btn btn-sm" onClick={() => copyLink(justCreatedLink.split("/invite/")[1])}>
              {copiedToken === justCreatedLink.split("/invite/")[1] ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>

      {invites && invites.length > 0 && (
        <div className="card">
          <div className="card-title">Invites</div>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Status</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    {inv.guestPlayer.name}
                    {inv.usedBy?.email && <div style={{ color: "var(--text-faint)", fontSize: 12 }}>accepted, {inv.usedBy.email}</div>}
                  </td>
                  <td>
                    <span className={`badge ${INVITE_STATUS_BADGE[inv.status]}`}>{INVITE_STATUS_LABEL[inv.status]}</span>
                  </td>
                  <td>{formatDateTime(inv.expiresAt)}</td>
                  <td>
                    <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      {inv.status === "pending" && (
                        <>
                          <button className="btn btn-sm" onClick={() => copyLink(inv.token)}>
                            {copiedToken === inv.token ? "Copied" : "Copy link"}
                          </button>
                          <button className="btn btn-sm btn-danger" disabled={busyInviteId === inv.id} onClick={() => revokeInvite(inv)}>
                            Revoke
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card users-table-wrap">
        <div className="card-title">All users</div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Admin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.player?.name || "—"}
                  {u.email && <div style={{ color: "var(--text-faint)", fontSize: 12 }}>{u.email}</div>}
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
        {users.map((u) => (
          <div className="card user-card" key={u.id}>
            <div className="user-card-row">
              <div>
                <div className="user-card-name">{u.player?.name || "—"}</div>
                {u.email && <div style={{ color: "var(--text-faint)", fontSize: 12 }}>{u.email}</div>}
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
                    {formatDateTime(m.createdAt)} by {m.mergedBy.email || "an admin"}
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
