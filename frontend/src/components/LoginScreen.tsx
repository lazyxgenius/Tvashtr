import { useState } from "react";

import { ApiError, type AuthUser, login, register } from "../lib/api";

/**
 * The login / register screen (M-accounts Slice A). The whole app sits behind this; on success it
 * calls back with the authenticated identity. Email + password with a Log in / Register toggle and
 * inline errors for 401 (bad credentials), 409 (email taken), and 422 (validation). Plain button
 * onClick handlers (no raw <form> submit — avoids a full-page reload). Reuses the DS .tv-* vocabulary.
 */
export function LoginScreen({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const user =
        mode === "login" ? await login(email, password) : await register(email, password);
      onAuthed(user);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401) setError("Incorrect email or password.");
      else if (status === 409) setError("That email already has an account — try logging in.");
      else if (status === 422)
        setError("Enter a valid email and a password of at least 8 characters.");
      else setError("Something went wrong. Is the backend running?");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="tv-auth">
      <div className="tv-auth__card tv-card">
        <div className="tv-auth__brand">
          <img src="/mark-coral.png" alt="" style={{ width: 28, height: 28 }} />
          <span className="tv-auth__title">Tvashtr</span>
        </div>
        <p className="tv-auth__lede">
          {mode === "login" ? "Log in to your canvas." : "Create your account."}
        </p>

        <div className="tv-seg" role="group" aria-label="Log in or register">
          <button
            type="button"
            aria-pressed={mode === "login"}
            className={`tv-seg__btn${mode === "login" ? " tv-seg__btn--active" : ""}`}
            onClick={() => switchMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            className={`tv-seg__btn${mode === "register" ? " tv-seg__btn--active" : ""}`}
            onClick={() => switchMode("register")}
          >
            Register
          </button>
        </div>

        <label className="tv-field">
          <span className="tv-field__label">Email</span>
          <input
            className="tv-launch__input"
            type="email"
            autoComplete="email"
            value={email}
            aria-label="Email"
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="tv-field">
          <span className="tv-field__label">Password</span>
          <input
            className="tv-launch__input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            aria-label="Password"
            placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>

        {error && (
          <div className="tv-auth__error" role="alert">
            {error}
          </div>
        )}

        <button
          type="button"
          className="tv-btn tv-auth__submit"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </div>
    </div>
  );
}
