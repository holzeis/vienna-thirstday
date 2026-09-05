import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { getPlayerProfile, updateMe, uploadAvatar } from "../api/endpoints";
import type { AwardCategory, AwardTier, PlayerProfile as PlayerProfileType } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiClientError } from "../api/client";
import { formatMonthYear } from "../utils/format";

const AWARD_LABELS: Record<AwardCategory, string> = {
  gamesPlayed: "Games Played",
  wins: "Wins",
  draws: "Draws",
  losses: "Losses",
  points: "Points",
  goals: "Goals",
  isAdmin: "Admin",
  ranking: "Season Ranking",
  mostGames: "Most Games",
  mostGoals: "Most Goals",
  longestWinStreak: "Win Streak",
  longestLossStreak: "Loss Streak",
};

const AWARD_ICONS: Record<AwardCategory, string> = {
  gamesPlayed: "🏃",
  wins: "🏆",
  draws: "🤝",
  losses: "💔",
  points: "⭐",
  goals: "⚽",
  isAdmin: "👑",
  ranking: "🏆",
  mostGames: "🏃",
  mostGoals: "⚽",
  longestWinStreak: "🔥",
  longestLossStreak: "🥶",
};

const TIER_MEDALS: Record<AwardTier, string> = {
  gold: "🥇",
  silver: "🥈",
  bronze: "🥉",
  wood: "🪵",
};

export function PlayerProfile() {
  const { id } = useParams();
  const playerId = parseInt(id!, 10);
  const { user: myUser, player: me } = useAuth();

  const [profile, setProfile] = useState<PlayerProfileType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    getPlayerProfile(playerId)
      .then((res) => setProfile(res))
      .catch(() => setProfile(null));
  }

  useEffect(() => {
    setProfile(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  if (profile === null) return <div className="loading">Loading...</div>;

  const isOwnProfile = me?.id === playerId;
  const { veteran, undefeated, unlucky } = profile.currentForm;
  const hasFormBadge = veteran || undefeated || unlucky;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadAvatar(playerId, file);
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not upload image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="profile-header">
          {profile.player.avatarDataUri ? (
            <img className="player-avatar" src={profile.player.avatarDataUri} alt="" />
          ) : (
            <div className="player-avatar-placeholder">{profile.player.name.charAt(0).toUpperCase()}</div>
          )}
          <div>
            <h2>
              {profile.player.name} {profile.player.isGuest && <span className="badge badge-guest">Guest</span>}
            </h2>
            <p>Joined {formatMonthYear(profile.player.joinedAt)}</p>
            {isOwnProfile && (
              <div style={{ marginTop: 8 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  disabled={uploading}
                  hidden
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "Uploading..." : profile.player.avatarDataUri ? "📷 Change photo" : "📷 Add photo"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="card-title">Awards</div>
        <div className="achievement-grid">
          {profile.awards.map((a, i) => (
            <div key={`${a.category}-${a.season ?? "life"}-${i}`} className={`achievement-tile achievement-tier-${a.tier}`}>
              <div className="achievement-icon">
                {AWARD_ICONS[a.category]}
                <span className="achievement-medal">{TIER_MEDALS[a.tier]}</span>
              </div>
              <div className="label">
                {AWARD_LABELS[a.category]}
                {a.kind === "season" ? ` · ${a.season}` : ""}
              </div>
              <span className={`badge badge-tier-${a.tier}`}>{a.tier}</span>
              <div className="value">{a.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Current Form</div>
        {hasFormBadge && (
          <div className="form-badge-grid">
            {veteran && (
              <div className="form-badge form-badge-veteran">
                <div className="icon">🎖️</div>
                <div className="label">Veteran</div>
              </div>
            )}
            {undefeated && (
              <div className="form-badge form-badge-undefeated">
                <div className="icon">🛡️</div>
                <div className="label">Undefeated</div>
              </div>
            )}
            {unlucky && (
              <div className="form-badge form-badge-unlucky">
                <div className="icon">🌧️</div>
                <div className="label">Unlucky</div>
              </div>
            )}
          </div>
        )}
        <ul className="subtle-list">
          <li>
            <span>🫂 Partner in Crime</span>
            <span>
              {profile.teammates.mostPlayedWith ? (
                <>
                  <Link to={`/players/${profile.teammates.mostPlayedWith.playerId}`}>
                    {profile.teammates.mostPlayedWith.name}
                  </Link>
                  {` — ${profile.teammates.mostPlayedWith.sharedGames} of last 5 together`}
                </>
              ) : (
                "—"
              )}
            </span>
          </li>
          <li>
            <span>🍀 Lucky Charm</span>
            <span>
              {profile.teammates.favorite ? (
                <>
                  <Link to={`/players/${profile.teammates.favorite.playerId}`}>{profile.teammates.favorite.name}</Link>
                  {` — ${profile.teammates.favorite.sharedWins} wins in last 5`}
                </>
              ) : (
                "—"
              )}
            </span>
          </li>
          <li>
            <span>💀 Jinx</span>
            <span>
              {profile.teammates.unfavorite ? (
                <>
                  <Link to={`/players/${profile.teammates.unfavorite.playerId}`}>{profile.teammates.unfavorite.name}</Link>
                  {` — ${profile.teammates.unfavorite.sharedLosses} losses in last 5`}
                </>
              ) : (
                "—"
              )}
            </span>
          </li>
        </ul>
      </div>

      {isOwnProfile && myUser && (
        <AccountSettings
          name={profile.player.name}
          email={myUser.email}
          onSaved={() => {
            load();
          }}
        />
      )}
    </div>
  );
}

function AccountSettings({ name, email, onSaved }: { name: string; email: string; onSaved: () => void }) {
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [nameInput, setNameInput] = useState(name);
  const [emailInput, setEmailInput] = useState(email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const payload: { name?: string; email?: string; currentPassword?: string; newPassword?: string } = {};
      if (nameInput.trim() && nameInput.trim() !== name) payload.name = nameInput.trim();
      if (emailInput.trim() && emailInput.trim() !== email) payload.email = emailInput.trim();
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      await updateMe(payload);
      await refresh();
      onSaved();
      setCurrentPassword("");
      setNewPassword("");
      setSuccess("Saved.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: open ? 14 : 0 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Account Settings
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : "Edit"}
        </button>
      </div>
      {open && (
        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <div className="form-row">
            <div className="field">
              <label htmlFor="settings-name">Name</label>
              <input id="settings-name" value={nameInput} onChange={(e) => setNameInput(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="settings-email">Email</label>
              <input
                id="settings-email"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="divider" />
          <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "0 0 12px" }}>
            Leave password fields blank to keep your current password.
          </p>
          <div className="form-row">
            <div className="field">
              <label htmlFor="settings-current-password">Current password</label>
              <input
                id="settings-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="field">
              <label htmlFor="settings-new-password">New password</label>
              <input
                id="settings-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </form>
      )}
    </div>
  );
}
