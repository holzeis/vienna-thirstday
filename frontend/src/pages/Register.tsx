import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "../api/endpoints";
import { ApiClientError } from "../api/client";
import { BrandMark } from "../components/Layout";

export function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, name);
      navigate("/login", {
        state: { message: "Registration received. An admin needs to approve your account before you can log in." },
      });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="auth-brand">
          <BrandMark />
          <span>Vienna Thursday</span>
        </div>
        <h1>Join the group</h1>
        <p className="sub">Create an account. An admin will approve it before you can sign up for gamedays.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Creating account..." : "Create account"}
          </button>
        </form>

        <div className="auth-switch">
          Already registered? <Link to="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
}
