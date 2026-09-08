import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { getPlayerProfile, updateMe, uploadAvatar } from "../api/endpoints";
import type { AwardCategory, AwardTier, PlayerProfile as PlayerProfileType } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiClientError } from "../api/client";
import { formatMonthYear } from "../utils/format";
import { disablePushNotifications, enablePushNotifications, getExistingPushSubscription, isPushSupported } from "../push";
import { isIOS, isStandalonePwa } from "../platform";
import { Spinner } from "../components/LoadingScreen";

const AWARD_LABELS: Record<AwardCategory, string> = {
  gamesPlayed: "Games Played",
  wins: "Wins",
  draws: "Draws",
  losses: "Losses",
  points: "Points",
  goals: "Goals",
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

  if (profile === null) return <Spinner />;

  const isOwnProfile = me?.id === playerId;
  const { veteran, undefeated, unlucky, ghost } = profile.currentForm;
  const { mostPlayedWith, favorite, unfavorite, dreamTeam } = profile.teammates;
  const { nemesis, favoriteVictim, onFireStreak, isNewcomer } = profile;
  const hasLockerRoomContent =
    veteran ||
    undefeated ||
    unlucky ||
    ghost ||
    !!mostPlayedWith ||
    !!favorite ||
    !!unfavorite ||
    !!dreamTeam ||
    !!nemesis ||
    !!favoriteVictim ||
    !!onFireStreak ||
    isNewcomer;

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
            <h2 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>{profile.player.name}</span>
              {profile.player.isGuest && <span className="badge badge-guest">Guest</span>}
              {profile.player.isAdmin && <span className="badge badge-admin">Admin</span>}
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
        <div className="card-title">Locker Room</div>
        {hasLockerRoomContent ? (
          <div className="achievement-grid">
            {isNewcomer && (
              <div className="achievement-tile form-tier-newcomer">
                <div className="achievement-icon">🌱</div>
                <div className="label">Newcomer</div>
                <div className="value">First season in the squad</div>
              </div>
            )}
            {!!onFireStreak && (
              <div className="achievement-tile form-tier-onfire">
                <div className="achievement-icon">🔥</div>
                <div className="label">On Fire</div>
                <div className="value">{onFireStreak} wins in a row</div>
              </div>
            )}
            {veteran && (
              <div className="achievement-tile form-tier-veteran">
                <div className="achievement-icon">🎖️</div>
                <div className="label">Veteran</div>
                <div className="value">Played all of the last 5</div>
              </div>
            )}
            {ghost && (
              <div className="achievement-tile form-tier-ghost">
                <div className="achievement-icon">👻</div>
                <div className="label">Ghost</div>
                <div className="value">Missed the last 5</div>
              </div>
            )}
            {undefeated && (
              <div className="achievement-tile form-tier-undefeated">
                <div className="achievement-icon">🛡️</div>
                <div className="label">Undefeated</div>
                <div className="value">Unbeaten in the last 5</div>
              </div>
            )}
            {unlucky && (
              <div className="achievement-tile form-tier-unlucky">
                <div className="achievement-icon">🌧️</div>
                <div className="label">Unlucky</div>
                <div className="value">Lost the last 5</div>
              </div>
            )}
            {mostPlayedWith && (
              <TeammateTile teammate={mostPlayedWith} emoji="🫂" label="Partner in Crime" stat={`${mostPlayedWith.sharedGames} of last 5 together`} />
            )}
            {favorite && (
              <TeammateTile teammate={favorite} emoji="🍀" label="Lucky Charm" stat={`${favorite.sharedWins} wins in last 5`} />
            )}
            {unfavorite && (
              <TeammateTile teammate={unfavorite} emoji="💀" label="Jinx" stat={`${unfavorite.sharedLosses} losses in last 5`} />
            )}
            {dreamTeam && (
              <TeammateTile
                teammate={dreamTeam}
                emoji="💫"
                label="Dream Team"
                stat={`${Math.round((dreamTeam.sharedWins / dreamTeam.sharedGames) * 100)}% win rate this season`}
              />
            )}
            {nemesis && (
              <TeammateTile teammate={nemesis} emoji="😈" label="Nemesis" stat={`${nemesis.lossesAgainst} losses to them in last 5`} />
            )}
            {favoriteVictim && (
              <TeammateTile
                teammate={favoriteVictim}
                emoji="🎯"
                label="Favorite Victim"
                stat={`${favoriteVictim.winsAgainst} wins over them in last 5`}
              />
            )}
          </div>
        ) : (
          <div className="empty-state">Form and teammate chemistry will show up here after a few more games.</div>
        )}
      </div>

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

      {isOwnProfile && myUser && (
        <AccountSettings
          name={profile.player.name}
          email={myUser.email}
          onSaved={() => {
            load();
          }}
        />
      )}

      {isOwnProfile && <PushNotificationsCard />}
    </div>
  );
}

function PushNotificationsCard() {
  const [checked, setChecked] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = isPushSupported();

  useEffect(() => {
    if (!supported) {
      setChecked(true);
      return;
    }
    getExistingPushSubscription()
      .then((sub) => setEnabled(!!sub))
      .finally(() => setChecked(true));
  }, [supported]);

  async function toggle() {
    setError(null);
    setBusy(true);
    try {
      if (enabled) {
        await disablePushNotifications();
        setEnabled(false);
      } else {
        await enablePushNotifications();
        setEnabled(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!checked) return null;

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>
            Push notifications
          </div>
          <p style={{ color: "var(--text-dim)", fontSize: 12, margin: 0 }}>
            {supported
              ? "Get notified on this device when a new matchday is posted."
              : isIOS() && !isStandalonePwa()
                ? "Install this app to your home screen first (Share → Add to Home Screen) - iPhone only supports notifications for the installed app."
                : "Not supported on this browser/device."}
          </p>
        </div>
        {supported && (
          <button type="button" className={`btn btn-sm ${enabled ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={toggle}>
            {busy ? "..." : enabled ? "Disable" : "Enable"}
          </button>
        )}
      </div>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function TeammateTile({
  teammate,
  emoji,
  label,
  stat,
}: {
  teammate: { playerId: number; name: string; avatarDataUri: string | null };
  emoji: string;
  label: string;
  stat: string;
}) {
  return (
    <div className="achievement-tile">
      <div className="achievement-icon">
        {teammate.avatarDataUri ? (
          <img className="teammate-avatar" src={teammate.avatarDataUri} alt="" />
        ) : (
          <div className="teammate-avatar-placeholder">{teammate.name.charAt(0).toUpperCase()}</div>
        )}
        <span className="achievement-medal">{emoji}</span>
      </div>
      <div className="label">{label}</div>
      <div className="value">
        <Link to={`/players/${teammate.playerId}`}>{teammate.name}</Link>
      </div>
      <div className="value">{stat}</div>
    </div>
  );
}

function AccountSettings({ name, email, onSaved }: { name: string; email: string | null; onSaved: () => void }) {
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [nameInput, setNameInput] = useState(name);
  const [emailInput, setEmailInput] = useState(email ?? "");
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
      if (emailInput.trim() && emailInput.trim() !== (email ?? "")) payload.email = emailInput.trim();
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
              <label htmlFor="settings-email">Email (optional)</label>
              <input
                id="settings-email"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
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
      <div className="divider" style={{ marginTop: open ? 16 : 14, marginBottom: 0 }} />
      <p style={{ margin: "12px 0 0", fontSize: 12 }}>
        <a
          href="https://holzeis.github.io/vienna-thirstday/privacy/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent2)", fontWeight: 600, textDecoration: "none" }}
        >
          Privacy Policy
        </a>
      </p>
    </div>
  );
}
