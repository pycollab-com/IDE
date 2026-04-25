import { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { FiHome, FiSettings, FiSearch, FiLogOut, FiMoon, FiUser, FiStopCircle, FiMessageCircle, FiMenu, FiChevronLeft } from "react-icons/fi";
import { motion } from "framer-motion";
import VerifiedBadge from "./VerifiedBadge";
import { toProfilePath } from "../utils/profileLinks";
import { resolveHostedAssetUrl } from "../utils/hostedAssets";
import { isImpersonating } from "../auth";


export default function Layout({ user, onLogout, theme, toggleTheme, children, navigationLocked = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const handleChange = (event) => {
      setIsMobile(event.matches);
      if (event.matches) setSidebarOpen(true);
    };

    setIsMobile(mediaQuery.matches);
    if (mediaQuery.matches) setSidebarOpen(true);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (isMobile) return undefined;
    if (navigationLocked) return undefined;
    const handleShortcut = (event) => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "s";
      if (!isShortcut) return;
      event.preventDefault();
      setSidebarOpen((prev) => !prev);
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isMobile, navigationLocked]);

  useEffect(() => {
    if (navigationLocked) {
      setSidebarOpen(false);
    }
  }, [navigationLocked]);

  const navItems = [
    { label: "Dashboard", path: "/", icon: <FiHome /> },
    { label: "Search", path: "/explore", icon: <FiSearch /> },
    { label: "Messages", path: "/messages", icon: <FiMessageCircle /> },
    { label: "Settings", path: "/settings", icon: <FiSettings /> },
  ];
  const openProfile = () => {
    const path = toProfilePath(user);
    if (path) navigate(path);
  };
  const handleProfileKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      if (event.key === " ") event.preventDefault();
      openProfile();
    }
  };

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"} ${navigationLocked ? "nav-locked" : ""}`}>
      {!navigationLocked ? <aside className={`app-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-head">
          <div className="sidebar-brand" onClick={() => navigate("/")}>
            <span className="text-gradient">PyCollab</span>
          </div>
          {!isMobile && (
            <button
              className="btn-ghost nav-icon-btn"
              type="button"
              aria-label="Collapse sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <FiChevronLeft size={18} />
            </button>
          )}
        </div>

        <div>
          <div className="sidebar-section-label">Workspace</div>
          <nav className="sidebar-nav">
            {navItems.map((item) => {
              const path = item.path === "/projects-view" ? "/" : item.path;
              const isActive = path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
              return (
                <NavLink
                  key={item.label}
                  to={item.path === "/projects-view" ? "/" : item.path}
                  className={`sidebar-link ${isActive ? "active" : ""}`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div
            className="sidebar-profile"
            onClick={openProfile}
            onKeyDown={handleProfileKeyDown}
            role="button"
            tabIndex={0}
            aria-label={`Open profile for ${user?.display_name || user?.username}`}
          >
            <div className="user-avatar">
              {user?.profile_picture_path ? (
                <img src={resolveHostedAssetUrl(user.profile_picture_path)} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <FiUser color="currentColor" />
              )}
            </div>
            <div className="sidebar-profile-meta">
              <div className="sidebar-profile-name">
                {user?.display_name || user?.username}
                {user?.is_admin && <VerifiedBadge size={14} />}
              </div>
              <div className="sidebar-profile-subtitle">@{user?.username}</div>
            </div>
            {user?.is_admin && <span className="chip">Admin</span>}
          </div>

          {(user?.impersonated_at || isImpersonating()) && (
            <motion.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="impersonation-badge"
            >
              Impersonating
              <FiStopCircle size={14} style={{ cursor: "pointer" }} onClick={() => {
                window.dispatchEvent(new CustomEvent("revertImpersonation"));
              }} />
            </motion.div>
          )}

          <div className="sidebar-footer-actions">
            <button onClick={toggleTheme} className="btn-ghost nav-icon-btn">
              {theme === "dark" ? <FiFullSun size={18} /> : <FiMoon size={18} />}
            </button>
            <button onClick={onLogout} className="btn-ghost nav-icon-btn danger" title="Log out">
              <FiLogOut size={18} />
            </button>
          </div>
        </div>
      </aside> : null}

      <div className="app-main">
        {navigationLocked ? (
          <div className="app-lock-actions">
            <button onClick={toggleTheme} className="btn-ghost nav-icon-btn">
              {theme === "dark" ? <FiFullSun size={18} /> : <FiMoon size={18} />}
            </button>
            <button onClick={onLogout} className="btn-ghost nav-icon-btn danger" title="Log out">
              <FiLogOut size={18} />
            </button>
          </div>
        ) : null}

        {!navigationLocked && !isMobile && !sidebarOpen && (
          <button
            type="button"
            className="btn-ghost nav-icon-btn sidebar-reopen"
            aria-label="Open sidebar"
            onClick={() => setSidebarOpen(true)}
          >
            <FiMenu size={18} />
          </button>
        )}

        <div className="app-content">
          {children ?? <Outlet />}
        </div>
      </div>
    </div>
  );
}

// Icon wrapper for theme
function FiFullSun(props) {
  return (
    <svg
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      viewBox="0 0 24 24"
      strokeLinecap="round"
      strokeLinejoin="round"
      height="1em"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </svg>
  );
}
