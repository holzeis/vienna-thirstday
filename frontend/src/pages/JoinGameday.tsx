import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { getPublicGameday, registerForGameday, registerGuestViaShareLink } from "../api/endpoints";
import type { GamedayPublicSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../components/Layout";
import { ApiClientError } from "../api/client";
import { formatDateTime } from "../utils/format";
import { useInstallPrompt } from "../hooks/useInstallPrompt";

function storageKey(token: string) {
  return `vt-share-guest-${token}`;
}

function readRememberedPlayerId(token: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(token));
    return raw ? parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

function rememberPlayerId(token: string, playerId: number) {
  try {
    localStorage.setItem(storageKey(token), String(playerId));
  } catch {
    /* localStorage unavailable - they'll just see the sign-up form again next time */
  }
}

function Roster({ gameday }: { gameday: GamedayPublicSummary }) {
  if (gameday.confirmed.length === 0 && gameday.waitlisted.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 16, marginBottom: 16, textAlign: "left" }}>
      <div className="card-title">Who's in</div>
      {gameday.confirmed.length > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 13 }}>
          <strong>Confirmed:</strong> {gameday.confirmed.map((p) => p.name).join(", ")}
        </p>
      )}
      {gameday.waitlisted.length > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
          <strong>Waitlist:</strong> {gameday.waitlisted.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function InstallHint() {
  const { installed, canInstall, showIOSInstructions, install, busy } = useInstallPrompt();
  if (installed) return null;
  if (!canInstall && !showIOSInstructions) return null;

  return (
    <div className="card" style={{ marginTop: 16, textAlign: "left" }}>
      <div className="card-title">Get notified next time</div>
      {canInstall ? (
        <>
          <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 0 }}>Install the app for quicker access and push notifications.</p>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={install}>
            {busy ? "..." : "Install app"}
          </button>
        </>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-dim)", margin: 0 }}>
          Install this app: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </p>
      )}
    </div>
  );
}

export function JoinGameday() {
  const { token } = useParams();
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [gameday, setGameday] = useState<GamedayPublicSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<"login" | "guest">("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (!token) return;
    const rememberedId = readRememberedPlayerId(token) ?? undefined;
    getPublicGameday(token, rememberedId)
      .then((res) => setGameday(res.gameday))
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "This link isn't valid"));
  }

  useEffect(load, [token]);

  // Already signed in - just take them straight to the real page, where the
  // normal "I'm in" flow already exists.
  if (user && gameday) return <Navigate to={`/gamedays/${gameday.id}`} replace />;

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!gameday) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(name, password);
      try {
        await registerForGameday(gameday.id);
      } catch (err) {
        // Already registered is fine - they're still getting to the gameday
        // either way. Anything else, let them sort it out from the real page.
        if (!(err instanceof ApiClientError && err.status === 409)) {
          console.error("Auto-register after login failed:", err);
        }
      }
      navigate(`/gamedays/${gameday.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGuestSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await registerGuestViaShareLink(token, guestName.trim());
      rememberPlayerId(token, res.playerId);
      const refreshed = await getPublicGameday(token, res.playerId);
      setGameday(refreshed.gameday);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not sign up");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="auth-shell">
        <div className="card auth-card">
          <div className="auth-brand">
            <BrandMark />
            <span>Vienna Thirstday</span>
          </div>
          <h1>Link unavailable</h1>
          <p className="sub">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!gameday) return <div className="loading">Loading...</div>;

  const spotsLeft = Math.max(0, gameday.maxPlayers - gameday.confirmedCount);

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="auth-brand">
          <BrandMark />
          <span>Vienna Thirstday</span>
        </div>
        <h1>Matchday sign-up</h1>
        <p className="sub">
          {formatDateTime(gameday.date)} - {gameday.confirmedCount}/{gameday.maxPlayers} confirmed
          {spotsLeft === 0 && gameday.status === "OPEN" ? " (waitlist only)" : ""}
        </p>

        {gameday.status !== "OPEN" && <div className="alert alert-error">This matchday isn't open for sign-ups right now.</div>}

        <Roster gameday={gameday} />

        {gameday.myStatus ? (
          <>
            <div className="alert alert-success">
              {gameday.myStatus === "CONFIRMED"
                ? "You're confirmed! See you on the pitch."
                : "You're on the waitlist - we'll let you know if a spot opens up."}
            </div>
            <InstallHint />
          </>
        ) : (
          gameday.status === "OPEN" && (
            <>
              {error && <div className="alert alert-error">{error}</div>}

              {mode === "login" ? (
                <form onSubmit={handleLogin}>
                  <div className="field">
                    <label htmlFor="join-name">Name</label>
                    <input id="join-name" required value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="join-password">Password</label>
                    <input
                      id="join-password"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
                    {submitting ? "Logging in..." : "Log in and sign up"}
                  </button>
                  <div className="auth-switch">
                    Don't have an account?{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setError(null);
                        setMode("guest");
                      }}
                    >
                      Sign up as a guest
                    </a>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleGuestSubmit}>
                  <div className="field">
                    <label htmlFor="guest-name">Your name</label>
                    <input id="guest-name" required value={guestName} onChange={(e) => setGuestName(e.target.value)} />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
                    {submitting ? "Signing up..." : "Sign up"}
                  </button>
                  <div className="auth-switch">
                    Already have an account?{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setError(null);
                        setMode("login");
                      }}
                    >
                      Log in instead
                    </a>
                  </div>
                </form>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
