import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { bbedit } from "@uiw/codemirror-theme-bbedit";
import { dracula } from "@uiw/codemirror-theme-dracula";
import api from "./api";
import { getToken, hasToken, setToken } from "./auth";
import { clearPersistentSession, getStoredTheme, initializePersistentState, setStoredTheme } from "./persistentState";
import { loadStoredUser, storeUser } from "./session";
import useServiceStatus from "./hooks/useServiceStatus";
import OfflineBanner from "./components/OfflineBanner";
import Layout from "./components/Layout";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import HostedEditorPage from "./pages/HostedEditor";
import LocalEditorPage from "./pages/LocalEditor";
import SettingsPage from "./pages/Settings";
import ProfilePage from "./pages/Profile";
import ExplorePage from "./pages/Explore";
import MessagesPage from "./pages/Messages";
import AdminPage from "./pages/Admin";
import ShareJoin from "./pages/ShareJoin";
import CachedProjectPage from "./pages/CachedProject";
import { getDesktopContext } from "./utils/desktopBridge";

const ProtectedRoute = ({ authenticated, children }) => {
  if (!authenticated) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute = ({ authenticated, children }) => {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let cancelled = false;

    if (!authenticated) {
      setStatus("unauthorized");
      return undefined;
    }

    api
      .get("/users/me")
      .then((res) => {
        if (cancelled) return;
        setStatus(res.data?.is_admin ? "authorized" : "forbidden");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("unauthorized");
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!authenticated || status === "unauthorized") return <Navigate to="/login" replace />;
  if (status === "forbidden") return <Navigate to="/" replace />;
  if (status !== "authorized") return null;
  return children;
};

const ProfileRoute = ({ user, onLogout, theme, toggleTheme }) => {
  if (!user) {
    return <ProfilePage user={user} />;
  }

  return (
    <Layout user={user} onLogout={onLogout} theme={theme} toggleTheme={toggleTheme}>
      <ProfilePage user={user} />
    </Layout>
  );
};

export default function App() {
  const [theme, setTheme] = useState(getStoredTheme());
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [authenticated, setAuthenticated] = useState(hasToken());
  const [desktopContext, setDesktopContext] = useState({
    isDesktop: false,
    platform: "web",
    version: "dev",
  });
  const serviceStatus = useServiceStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthRoute = location.pathname === "/login" || location.pathname === "/register";
  const hasCompletedHostedCheck = Boolean(serviceStatus.checkedAt);
  const hostedOffline = hasCompletedHostedCheck && serviceStatus.hostedOnline === false;

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  const editorTheme = theme === "dark" ? dracula : bbedit;

  const setUserPersisted = (nextUser, token) => {
    const nextToken = token ?? getToken();
    if (token) setToken(token);
    setUser(storeUser(nextUser));
    setAuthenticated(Boolean(nextToken));
  };

  const clearSessionState = () => {
    clearPersistentSession();
    setUser(null);
    setAuthenticated(false);
  };

  const invalidateSession = () => {
    clearSessionState();
    navigate("/login");
  };

  const fetchMe = async ({ preserveSessionOnNetworkFailure = false } = {}) => {
    try {
      const res = await api.get("/users/me");
      setUserPersisted(res.data);
      return res.data;
    } catch (error) {
      const statusCode = error?.response?.status;
      if (statusCode === 401 || statusCode === 403) {
        invalidateSession();
        throw new Error("Failed to fetch current user");
      }

      if (preserveSessionOnNetworkFailure) {
        const cachedUser = loadStoredUser();
        if (cachedUser) {
          setUser(cachedUser);
          return cachedUser;
        }
      }

      throw error;
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    if (storageLoaded) {
      setStoredTheme(theme);
    }
  }, [theme, storageLoaded]);

  useEffect(() => {
    let cancelled = false;

    initializePersistentState()
      .then((state) => {
        if (cancelled) return;
        setTheme(state.theme || "dark");
        setUser(state.user || null);
        setAuthenticated(Boolean(state.token));
      })
      .finally(() => {
        if (!cancelled) {
          setStorageLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    getDesktopContext().then(setDesktopContext).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.dataset.desktop = desktopContext.isDesktop ? "true" : "false";
    document.documentElement.dataset.desktopPlatform = desktopContext.platform || "web";
  }, [desktopContext]);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }

    setUser(loadStoredUser());
    if (!authenticated) {
      setReady(true);
      return;
    }

    if (!hasCompletedHostedCheck) {
      return;
    }

    if (!serviceStatus.hostedOnline) {
      setReady(true);
      return;
    }

    fetchMe({ preserveSessionOnNetworkFailure: true })
        .catch(() => {})
        .finally(() => setReady(true));
  }, [authenticated, hasCompletedHostedCheck, serviceStatus.hostedOnline, storageLoaded]);

  useEffect(() => {
    if (!hostedOffline || !authenticated) {
      return;
    }

    const path = location.pathname;
    const allowedOffline =
      path === "/" ||
      path === "/projects-view" ||
      path.startsWith("/projects/") ||
      path.startsWith("/cached/projects/") ||
      path.startsWith("/local/projects/");

    if (!allowedOffline) {
      navigate("/", { replace: true });
    }
  }, [authenticated, hostedOffline, location.pathname, navigate]);

  const handleAuth = async (payload) => {
    setUserPersisted(payload.user, payload.access_token);
    try {
      await fetchMe({ preserveSessionOnNetworkFailure: true });
    } catch {
      navigate("/");
      return;
    }
    const params = new URLSearchParams(location.search);
    const redirect = params.get("redirect");
    const safeRedirect = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
    navigate(safeRedirect);
  };

  const logout = () => {
    clearSessionState();
    navigate("/login");
  };

  if (!ready) return null;

  return (
    <>
      <div className="animated-bg" />
      {isAuthRoute ? null : (
        <OfflineBanner hostedOnline={serviceStatus.hostedOnline} localOnline={serviceStatus.localOnline} />
      )}
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/welcome" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage onAuth={handleAuth} theme={theme} toggleTheme={toggleTheme} />} />
          <Route path="/register" element={<RegisterPage onAuth={handleAuth} theme={theme} toggleTheme={toggleTheme} />} />
          <Route path="/local" element={<Navigate to="/" replace />} />
          <Route
            path="/local/projects/:id"
            element={
              <LocalEditorPage
                theme={theme}
                toggleTheme={toggleTheme}
                editorTheme={editorTheme}
                desktopContext={desktopContext}
              />
            }
          />
          <Route
            path="/cached/projects/:id"
            element={<CachedProjectPage theme={theme} toggleTheme={toggleTheme} hostedOnline={Boolean(serviceStatus.hostedOnline)} />}
          />
          <Route
            path="/users/:userId"
            element={<ProfileRoute user={user} onLogout={logout} theme={theme} toggleTheme={toggleTheme} />}
          />

          <Route
            element={
              <ProtectedRoute authenticated={authenticated}>
                <Layout
                  user={user}
                  onLogout={logout}
                  theme={theme}
                  toggleTheme={toggleTheme}
                  navigationLocked={hostedOffline}
                />
              </ProtectedRoute>
            }
          >
            <Route
              path="/"
              element={<Dashboard user={user} hostedOnline={Boolean(serviceStatus.hostedOnline)} desktopContext={desktopContext} />}
            />
            <Route
              path="/projects-view"
              element={<Dashboard user={user} hostedOnline={Boolean(serviceStatus.hostedOnline)} desktopContext={desktopContext} />}
            />
            <Route
            path="/admin"
            element={
                <AdminRoute authenticated={authenticated}>
                  <AdminPage user={user} theme={theme} toggleTheme={toggleTheme} />
                </AdminRoute>
              }
            />
            <Route path="/settings" element={<SettingsPage user={user} onLogout={logout} theme={theme} />} />
            <Route path="/messages" element={<MessagesPage user={user} />} />
            <Route path="/messages/:conversationId" element={<MessagesPage user={user} />} />
            <Route path="/explore" element={<ExplorePage />} />
          </Route>

          <Route
            path="/projects/:id"
            element={
              <ProtectedRoute authenticated={authenticated}>
                {serviceStatus.hostedOnline ? (
                  <HostedEditorPage
                    user={user}
                    onLogout={logout}
                    theme={theme}
                    toggleTheme={toggleTheme}
                    editorTheme={editorTheme}
                  />
                ) : (
                  <CachedProjectPage theme={theme} toggleTheme={toggleTheme} hostedOnline={false} />
                )}
              </ProtectedRoute>
            }
          />

          <Route path="/share/:code" element={<ShareJoin user={user} />} />
          <Route path="*" element={<Navigate to={authenticated ? "/" : "/login"} replace />} />
        </Routes>
      </AnimatePresence>
    </>
  );
}
