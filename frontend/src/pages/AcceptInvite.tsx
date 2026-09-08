import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { acceptInvite, getInvite } from "../api/endpoints";
import { setAuthToken } from "../api/client";
import { ApiClientError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../components/Layout";
import { Spinner } from "../components/LoadingScreen";

type LoadState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "ready"; guest: { id: number; name: string } | null };

/**
 * There's no self-service registration - this page is the only way to
 * create an account. It only renders the onboarding form once the token in
 * the URL has been confirmed valid (not used, not expired, not revoked);
 * otherwise it explains why and points back at the login page.
 */
export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ status: "invalid", message: "This invite link is missing its token." });
      return;
    }
    getInvite(token)
      .then((res) => {
        setState({ status: "ready", guest: res.guest });
        if (res.guest) setName(res.guest.name);
      })
      .catch((err) => {
        const message = err instanceof ApiClientError ? err.message : "This invite link isn't valid.";
        setState({ status: "invalid", message });
      });
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await acceptInvite(token, { name, password, email: email.trim() || undefined, avatar: avatar ?? undefined });
      setAuthToken(res.token);
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't complete onboarding");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="auth-brand">
          <BrandMark />
          <span>Vienna Thirstday</span>
        </div>

        {state.status === "loading" && <Spinner />}

        {state.status === "invalid" && (
          <>
            <h1>Invite not available</h1>
            <div className="alert alert-error">{state.message}</div>
            <div className="auth-switch">Already have an account? Head to the login page.</div>
          </>
        )}

        {state.status === "ready" && (
          <>
            <h1>You're invited</h1>
            <p className="sub">
              {state.guest
                ? "Confirm or change your name, then set a password to finish setting up your account."
                : "Pick a name, then set a password to finish setting up your account."}
            </p>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                {avatar ? (
                  <img className="player-avatar" src={URL.createObjectURL(avatar)} alt="" />
                ) : (
                  <div className="player-avatar-placeholder">{(name || "?").charAt(0).toUpperCase()}</div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setAvatar(e.target.files?.[0] ?? null)}
                  hidden
                />
                <button type="button" className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
                  {avatar ? "📷 Change photo" : "📷 Add photo (optional)"}
                </button>
              </div>

              <div className="field">
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  required
                  placeholder={state.guest ? undefined : "Your name"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="email">Email (optional)</label>
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <p className="field-hint">Used only by the game organizers to contact you about games. Your email address is not publicly displayed.</p>
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
                {submitting ? "Setting up your account..." : "Join Vienna Thirstday"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
