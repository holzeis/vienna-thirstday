import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-text">
            <h1>Vienna Thursday</h1>
            <span>Donnerstags Kicken</span>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/gamedays">Gamedays</NavLink>
          <NavLink to="/standings">Standings</NavLink>
          {user?.isAdmin && <NavLink to="/admin/users">Admin</NavLink>}
        </nav>
        <div className="topbar-right">
          {user && (
            <div className="user-chip">
              <span>{user.email}</span>
              {user.isAdmin && <span className="badge badge-admin">Admin</span>}
              {user.isPlayer && <span className="badge badge-player">Player</span>}
            </div>
          )}
          <button className="btn btn-sm" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
