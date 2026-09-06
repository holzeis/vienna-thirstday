import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { APP_VERSION } from "../appVersion";

type ThemeName = "dark" | "light";

function readInitialTheme(): ThemeName {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("vt-theme", theme);
    } catch {
      /* localStorage unavailable, theme just won't persist */
    }
  }, [theme]);

  const isLight = theme === "light";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(isLight ? "dark" : "light")}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      {isLight ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      )}
    </button>
  );
}

export function BrandMark() {
  return (
    <div className="brand-mark">
      <img className="mark-light" src="/brand/logo-compact-day.png" alt="" aria-hidden="true" />
      <img className="mark-dark" src="/brand/logo-compact-night.png" alt="" aria-hidden="true" />
    </div>
  );
}

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 11.5 12 4l8 7.5" />
    <path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" />
  </svg>
);

const GamedaysIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const StandingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="12" width="4" height="8" rx="1" />
    <rect x="10" y="8" width="4" height="12" rx="1" />
    <rect x="16" y="4" width="4" height="16" rx="1" />
  </svg>
);

const AdminIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </svg>
);

const TrophyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
    <path d="M8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4" />
    <path d="M12 13v3M9 20h6M10 16h4v4h-4v-4Z" />
  </svg>
);

export function Layout() {
  const { user, player, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <h1>Vienna Thirstday</h1>
            <span>Donnerstags Kicken</span>
            <span className="app-version">v{APP_VERSION}</span>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/gamedays">Matchdays</NavLink>
          <NavLink to="/standings">Leaderboard</NavLink>
          <NavLink to="/hall-of-fame">Hall of Fame</NavLink>
          {user?.isAdmin && <NavLink to="/admin/users">Admin</NavLink>}
        </nav>
        <div className="topbar-right">
          {player && (
            <Link to={`/players/${player.id}`} className="theme-toggle" aria-label="My profile" title="My profile">
              <UserIcon />
            </Link>
          )}
          <ThemeToggle />
          <button className="theme-toggle" onClick={logout} aria-label="Log out" title="Log out">
            <LogoutIcon />
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <nav className="tabbar">
        <NavLink to="/" end aria-label="Home">
          <span className="tab-icon">
            <HomeIcon />
          </span>
        </NavLink>
        <NavLink to="/gamedays" aria-label="Matchdays">
          <span className="tab-icon">
            <GamedaysIcon />
          </span>
        </NavLink>
        <NavLink to="/standings" aria-label="Leaderboard">
          <span className="tab-icon">
            <StandingsIcon />
          </span>
        </NavLink>
        <NavLink to="/hall-of-fame" aria-label="Hall of Fame">
          <span className="tab-icon">
            <TrophyIcon />
          </span>
        </NavLink>
        {user?.isAdmin && (
          <NavLink to="/admin/users" aria-label="Admin">
            <span className="tab-icon">
              <AdminIcon />
            </span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}
