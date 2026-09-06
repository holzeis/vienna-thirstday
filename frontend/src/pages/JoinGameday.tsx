import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { getPublicGameday, registerForGameday, registerGuestViaShareLink } from "../api/endpoints";
import type { GamedayPublicSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../components/Layout";
import { ApiClientError } from "../api/client";
import { formatDateTime } from "../utils/format";

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
  const [guestResult, setGuestResult] = useState<"CONFIRMED" | "WAITLISTED" | null>(null);

  useEffect(() => {
    if (!token) return;
    getPublicGameday(token)
      .then((res) => setGameday(res.gameday))
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "This link isn't valid"));
  }, [token]);

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
      await registerForGameday(gameday.id);
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
      setGuestResult(res.status);
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

        {guestResult ? (
          <div className="alert alert-success">
            {guestResult === "CONFIRMED"
              ? "You're confirmed! See you on the pitch."
              : "You're on the waitlist - we'll let you know if a spot opens up."}
          </div>
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
