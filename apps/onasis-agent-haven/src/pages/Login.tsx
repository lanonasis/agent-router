import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import "./Login.css";

const Login = () => {
  const { login, loading, error, clearError, signupUrl, isLoggedIn, isInitializing } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // A restored session (token or gateway cookie) skips the form.
  if (!isInitializing && isLoggedIn) {
    return <Navigate to="/agents" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (!email.trim() || !password) return;

    try {
      await login(email.trim(), password);
    } catch {
      // The context stores the message; it is rendered below.
    }
  };

  return (
    <div className="login-page">
      <div className="terminal">
        {/* Terminal header */}
        <div className="terminal-header">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
          <span className="title">auth.lanonasis.com</span>
        </div>

        <div className="terminal-content">
          {/* Command line */}
          <div>
            <span className="prompt">$</span> <span className="command">lanonasis auth</span>
          </div>

          <br />

          {/* Status */}
          <div className="output success">✓ Authentication Gateway Active</div>
          <div className="output">Sign in to the Lanonasis agent console</div>

          {/* Section title */}
          <div className="section-title">🔐 Authentication Required</div>

          {/* Auth form */}
          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">
                EMAIL:
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                placeholder="user@domain.com"
                autoComplete="email"
                required
              />
            </div>

            {/* Password */}
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">
                PASSWORD:
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            {/* Submit */}
            <button type="submit" className={`btn${loading ? " loading" : ""}`} disabled={loading}>
              <span id="submit-text">{loading ? "AUTHENTICATING…" : "AUTHENTICATE"}</span>
            </button>

            {/* Message */}
            <div
              className={`output${error ? " error" : ""}`}
              style={{ marginTop: 15, marginLeft: 0, minHeight: 20 }}
              role="status"
              aria-live="polite"
            >
              {error ? `✗ ${error}` : loading ? "→ Authenticating…" : ""}
            </div>
          </form>

          {/* Account creation is handled by the gateway's hosted page, which
              sets the session cookie and returns here. There is no
              /v1/auth/signup JSON endpoint. */}
          <div className="output" style={{ marginTop: 8 }}>
            No account? <a href={signupUrl}>Create one</a>
          </div>

          <br />

          {/* Resources */}
          <div className="section-title">📚 Resources:</div>
          <div className="output">
            • Documentation: <a href="https://docs.lanonasis.com">docs.lanonasis.com</a>
          </div>
          <div className="output">
            • Repository:{" "}
            <a href="https://github.com/lanonasis/onasis-agent-haven">github.com/lanonasis/onasis-agent-haven</a>
          </div>

          <br />

          {/* Blinking cursor */}
          <div>
            <span className="prompt">$</span> <span className="blink">_</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
