import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthStatus, login, signUp } from "../api/client.js";
import { useFetch } from "../hooks/useFetch.js";

/**
 * Email + password against the local backend's auth routes. In dev mode the
 * backend mints its own tokens; with TUJ_SUPABASE_* set it proxies GoTrue.
 * Signing in is optional - the journal works fully offline - but sync only
 * runs while a session exists.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const load = useCallback(() => getAuthStatus(), []);
  const { data: status } = useFetch(load, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"login" | "signup" | null>(null);

  const submit = async (kind: "login" | "signup", e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(kind);
    try {
      const res = await (kind === "login" ? login(email, password) : signUp(email, password));
      if (res.signedIn) navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="auth-page">
      <h1 className="auth-page__title">Sign in to sync</h1>
      <p className="auth-page__lede">
        Your journal lives on this device and works fully offline. Signing in
        links this archive to your account so it mirrors to the cloud and your
        other devices. {status?.mode === "dev" && "(dev mode: any email works.)"}
      </p>
      {status?.signedIn && (
        <p className="auth-page__notice">
          Already signed in as {status.email}.
        </p>
      )}
      <form className="auth-form" onSubmit={(e) => submit("login", e)}>
        <label className="auth-form__label">
          Email
          <input
            className="auth-form__input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="auth-form__label">
          Password
          <input
            className="auth-form__input"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="auth-form__error">{error}</p>}
        <div className="auth-form__actions">
          <button className="btn btn--primary" type="submit" disabled={busy !== null}>
            {busy === "login" ? "Signing in…" : "Sign in"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy !== null}
            onClick={(e) => submit("signup", e)}
          >
            {busy === "signup" ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
    </div>
  );
}
