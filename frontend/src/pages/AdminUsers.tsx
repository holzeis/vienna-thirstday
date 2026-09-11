import { useEffect, useState } from "react";
import {
  adminCreateInvite,
  adminDeleteInvite,
  adminDeleteUser,
  adminListGuestPlayers,
  adminListInvites,
  adminListMerges,
  adminListUsers,
  adminMergeIntoPlayer,
  adminRevokeInvite,
  adminSetRoles,
  adminUndoMerge,
} from "../api/endpoints";
import type { Invite, Player, PlayerMerge, User } from "../api/types";
import { ApiClientError } from "../api/client";
import { formatDateTime } from "../utils/format";
import { Spinner } from "../components/LoadingScreen";
import { useToast } from "../toast/ToastContext";
import { usePolling } from "../hooks/usePolling";

type UserWithPlayer = User & { player: Player | null };
type GuestOption = Player & { gamesPlayed: number; seasons: number[] };

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
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserWithPlayer[] | null>(null);
  const [guests, setGuests] = useState<GuestOption[] | null>(null);
  const [merges, setMerges] = useState<PlayerMerge[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [expandedInviteId, setExpandedInviteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyMergeId, setBusyMergeId] = useState<number | null>(null);

  const [inviteGuestId, setInviteGuestId] = useState<number | "">("");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState(7);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [busyInviteId, setBusyInviteId] = useState<number | null>(null);
  const [justCreatedLink, setJustCreatedLink] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [mergeGuestId, setMergeGuestId] = useState<number | "">("");
  const [mergeTargetPlayerId, setMergeTargetPlayerId] = useState<number | "">("");
  const [mergeSeason, setMergeSeason] = useState<number | "all">("all");
  const [merging, setMerging] = useState(false);

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
  // A guest can be promoted (merged, or via a guest-linked invite created
  // from this very page) without this page's own action triggering the
  // refresh - e.g. another admin, or a second tab. Keep the guest/player
  // pickers from going stale without a manual reload.
  usePolling(load, 15000);

  function inviteLink(token: string) {
    return `${window.location.origin}/invite/${token}`;
  }

  function copyLink(token: string) {
    const link = inviteLink(token);
    navigator.clipboard.writeText(link).then(
      () => {
        setCopiedToken(token);
        setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 1500);
        showToast("Link copied to clipboard");
      },
      () => {
        window.prompt("Copy this invite link:", link);
      }
    );
  }

  async function createInvite() {
    setError(null);
    setJustCreatedLink(null);
    setCreatingInvite(true);
    try {
      // Leaving the player unselected makes this an open invite: reusable,
      // no guest, each acceptance a brand-new player with no history.
      const res = await adminCreateInvite({ guestPlayerId: inviteGuestId || undefined, expiresInDays: inviteExpiresInDays });
      setJustCreatedLink(inviteLink(res.invite.token));
      setInviteGuestId("");
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

  async function deleteInvite(invite: Invite) {
    if (!window.confirm(`Remove this ${INVITE_STATUS_LABEL[invite.status].toLowerCase()} invite? This can't be undone.`)) return;
    setError(null);
    setBusyInviteId(invite.id);
    try {
      await adminDeleteInvite(invite.id);
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not remove invite");
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

  async function performMerge() {
    const guest = guests?.find((g) => g.id === mergeGuestId);
    if (!mergeTargetPlayerId || !guest) return;
    const targetName = users?.find((u) => u.player?.id === mergeTargetPlayerId)?.player?.name || "this account";
    const season = mergeSeason === "all" ? undefined : mergeSeason;
    const confirmMessage =
      season === undefined
        ? `Attach ${guest.name}'s ${guest.gamesPlayed} game(s) to ${targetName}? ${guest.name} is removed as a separate guest (reversible from "Recent guest merges" below).`
        : `Attach only ${guest.name}'s ${season} season to ${targetName}? ${guest.name} stays around for any other seasons (reversible from "Recent guest merges" below).`;
    if (!window.confirm(confirmMessage)) return;
    setError(null);
    setMerging(true);
    try {
      await adminMergeIntoPlayer(mergeTargetPlayerId, guest.id, season);
      setMergeGuestId("");
      setMergeTargetPlayerId("");
      setMergeSeason("all");
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not merge guest into account");
    } finally {
      setMerging(false);
    }
  }

  async function undoMerge(m: PlayerMerge) {
    const seasonNote = m.season !== null ? ` ${m.season} season` : "";
    if (
      !window.confirm(
        `Undo merging "${m.guestPlayerName}"'s${seasonNote} history out of ${m.targetPlayer.name}? This moves it back onto ${m.guestPlayerName} as a separate guest.`
      )
    )
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

  if (users === null) return <Spinner />;

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
          Pick an existing guest to onboard them with their history attached (single-use), or leave it unselected
          for an open invite - reusable by multiple people, each onboarding as a brand-new player with no history.
          Attach a guest's history to any resulting account afterward from "Merge guest history into an account"
          below. There's no self-service sign-up; send the resulting link however you'd reach whoever should use it.
        </p>
        <div className="form-row">
          <div className="field">
            <label htmlFor="invite-guest">Player</label>
            <select
              id="invite-guest"
              value={inviteGuestId}
              disabled={creatingInvite}
              onChange={(e) => setInviteGuestId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">No guest - open invite</option>
              {guests?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
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
        <button className="btn btn-primary btn-sm" disabled={creatingInvite} onClick={createInvite}>
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
        <div className="card invites-table-wrap">
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
                    {inv.guestPlayer ? inv.guestPlayer.name : "Open invite"}
                    {inv.redemptions.length > 0 && (
                      <div style={{ color: "var(--text-faint)", fontSize: 12 }}>
                        Joined: {inv.redemptions.map((r) => r.playerName).join(", ")}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${INVITE_STATUS_BADGE[inv.status]}`}>{INVITE_STATUS_LABEL[inv.status]}</span>
                  </td>
                  <td>{formatDateTime(inv.expiresAt)}</td>
                  <td>
                    <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      {inv.status === "pending" ? (
                        <>
                          <button className="btn btn-sm" onClick={() => copyLink(inv.token)}>
                            {copiedToken === inv.token ? "Copied" : "Copy link"}
                          </button>
                          <button className="btn btn-sm btn-danger" disabled={busyInviteId === inv.id} onClick={() => revokeInvite(inv)}>
                            Revoke
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-sm btn-danger" disabled={busyInviteId === inv.id} onClick={() => deleteInvite(inv)}>
                          Remove
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invites && invites.length > 0 && (
        <div className="invites-list-wrap">
          <div className="card-title" style={{ marginBottom: 10 }}>
            Invites
          </div>
          {invites.map((inv) => (
            <div className="card user-card" key={inv.id}>
              <div className="user-card-row">
                <div>
                  <div className="user-card-name">{inv.guestPlayer ? inv.guestPlayer.name : "Open invite"}</div>
                  {inv.redemptions.length > 0 && (
                    <div style={{ color: "var(--text-faint)", fontSize: 12 }}>Joined: {inv.redemptions.map((r) => r.playerName).join(", ")}</div>
                  )}
                </div>
                <div className="user-card-actions">
                  <span className={`badge ${INVITE_STATUS_BADGE[inv.status]}`}>{INVITE_STATUS_LABEL[inv.status]}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="More options"
                    onClick={() => setExpandedInviteId((id) => (id === inv.id ? null : inv.id))}
                  >
                    ☰
                  </button>
                </div>
              </div>
              {expandedInviteId === inv.id && (
                <div className="user-card-details">
                  <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Expires {formatDateTime(inv.expiresAt)}</div>
                  {inv.status === "pending" ? (
                    <>
                      <button className="btn btn-sm" onClick={() => copyLink(inv.token)}>
                        {copiedToken === inv.token ? "Copied" : "Copy link"}
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={busyInviteId === inv.id} onClick={() => revokeInvite(inv)}>
                        Revoke
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-sm btn-danger" disabled={busyInviteId === inv.id} onClick={() => deleteInvite(inv)}>
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
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

      {guests && guests.length > 0 && (
        <div className="card">
          <div className="card-title">Merge guest history into an account</div>
          <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: -4, marginBottom: 12 }}>
            For a guest that's really the same person as an existing account - e.g. re-imported under a
            name they've since changed - moves the guest's registrations, team assignments, and stats
            onto the account. "All" removes the guest entirely; a specific season only attaches that
            year and leaves the guest around for the rest. Reversible below.
          </p>
          <div className="form-row">
            <div className="field">
              <label htmlFor="merge-guest">Guest</label>
              <select
                id="merge-guest"
                value={mergeGuestId}
                disabled={merging}
                onChange={(e) => {
                  setMergeGuestId(e.target.value ? Number(e.target.value) : "");
                  setMergeSeason("all");
                }}
              >
                <option value="">Select a guest...</option>
                {guests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="merge-target">Player</label>
              <select
                id="merge-target"
                value={mergeTargetPlayerId}
                disabled={merging}
                onChange={(e) => setMergeTargetPlayerId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Select a player...</option>
                {users
                  .filter((u) => u.player)
                  .map((u) => (
                    <option key={u.player!.id} value={u.player!.id}>
                      {u.player!.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="merge-season">Season</label>
              <select
                id="merge-season"
                value={mergeSeason}
                disabled={merging || !mergeGuestId}
                onChange={(e) => setMergeSeason(e.target.value === "all" ? "all" : Number(e.target.value))}
              >
                <option value="all">All</option>
                {guests
                  .find((g) => g.id === mergeGuestId)
                  ?.seasons.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={merging || !mergeGuestId || !mergeTargetPlayerId}
            onClick={performMerge}
          >
            {merging ? "Merging..." : "Merge"}
          </button>
        </div>
      )}

      {merges && merges.length > 0 && (
        <div className="card">
          <div className="card-title">Recent guest merges</div>
          <ul className="subtle-list">
            {merges.map((m) => (
              <li key={m.id}>
                <span>
                  <strong>{m.guestPlayerName}</strong> merged into <strong>{m.targetPlayer.name}</strong>
                  {m.season !== null && <span className="badge" style={{ marginLeft: 6 }}>{m.season} only</span>}
                  <div style={{ color: "var(--text-faint)", fontSize: 12 }}>
                    {formatDateTime(m.createdAt)} by {m.mergedBy?.name || "an admin"}
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
