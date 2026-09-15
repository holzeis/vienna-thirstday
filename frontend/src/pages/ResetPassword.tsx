import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getPasswordResetStatus, resetPassword } from "../api/endpoints";
import { setAuthToken } from "../api/client";
import { ApiClientError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../components/Layout";
import { Spinner } from "../components/LoadingScreen";

type LoadState = { status: "loading" } | { status: "invalid"; message: string } | { status: "ready" };

/**
 * Reached from an admin-generated "Reset password" link (see AdminUsers.tsx)
 * for a user who forgot theirs. Only renders the new-password form once the
 * token in the URL has been confirmed valid (not used, not expired);
 * otherwise it explains why and points back at the login page.
 */
export function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ status: "invalid", message: "This reset link is missing its token." });
      return;
    }
    getPasswordResetStatus(token)
      .then(() => setState({ status: "ready" }))
      .catch((err) => {
        const message = err instanceof ApiClientError ? err.message : "This reset link isn't valid.";
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
      const res = await resetPassword(token, password);
      setAuthToken(res.token);
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't reset password");
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
            <h1>Reset link not available</h1>
            <div className="alert alert-error">{state.message}</div>
            <div className="auth-switch">Ask an admin for a new link, or head to the login page.</div>
          </>
        )}

        {state.status === "ready" && (
          <>
            <h1>Set a new password</h1>
            <p className="sub">Choose a new password for your account.</p>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="password">New password</label>
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
                {submitting ? "Setting new password..." : "Set new password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
