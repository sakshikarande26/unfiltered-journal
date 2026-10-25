import { useCallback } from "react";
import { Link, Outlet, ScrollRestoration, useNavigate } from "react-router-dom";
import { getAuthStatus, logout } from "./api/client.js";
import { useFetch } from "./hooks/useFetch.js";
import { SyncBadge } from "./components/SyncBadge.js";

export function Root() {
  const navigate = useNavigate();
  const load = useCallback(() => getAuthStatus().catch(() => null), []);
  const { data: auth } = useFetch(load, []);

  return (
    <>
      <header className="site-nav">
        <Link className="site-nav__brand" to="/">Unfiltered</Link>
        <nav className="site-nav__links">
          <Link to="/compose">This week</Link>
          <Link to="/year">Year</Link>
        </nav>
        <div className="site-nav__right">
          <SyncBadge />
          {auth?.signedIn ? (
            <button
              className="site-nav__auth"
              title={`Signed in as ${auth.email} — sign out`}
              onClick={async () => {
                try {
                  await logout();
                } finally {
                  navigate(0);
                }
              }}
            >
              {auth.email} · sign out
            </button>
          ) : (
            <Link className="site-nav__auth" to="/login">sign in</Link>
          )}
        </div>
      </header>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
