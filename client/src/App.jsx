import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import api from "./api";
import { clearToken, setToken } from "./auth";
import Dashboard from "./pages/Dashboard";
import EditorPage from "./pages/Editor";
import Landing from "./pages/Landing";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import AdminPage from "./pages/Admin";
import SettingsPage from "./pages/Settings";
import ProfilePage from "./pages/Profile";
import ExplorePage from "./pages/Explore";
import MessagesPage from "./pages/Messages";
import NotFound4 from "./pages/NotFound4";
import ShareJoin from "./pages/ShareJoin";
import Layout from "./components/Layout";
import { AnimatePresence } from "framer-motion";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { bbedit } from "@uiw/codemirror-theme-bbedit";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/welcome" replace />;
  return children;
};

const SupportRedirect = () => {
  useEffect(() => {
    window.location.replace("/support/index.html");
  }, []);

  return null;
};

const DocsRedirect = () => {
  useEffect(() => {
    window.location.replace("/docs/index.html");
  }, []);

  return null;
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
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const navigate = useNavigate();
  const location = useLocation();

  const setUserPersisted = (u, token) => {
    if (token) setToken(token);
    if (u) localStorage.setItem("user", JSON.stringify(u));
    setUser(u);
  };

  const fetchMe = async () => {
    try {
      const res = await api.get("/users/me");
      setUserPersisted(res.data);
      return res.data;
    } catch {
      clearToken();
      setUser(null);
      navigate("/welcome");
      throw new Error("Failed to fetch current user");
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  useEffect(() => {
    const cached = localStorage.getItem("user");
    if (cached) {
      try {
        setUser(JSON.parse(cached));
      } catch {
        localStorage.removeItem("user");
      }
    }
    const token = localStorage.getItem("token");
    if (token) {
      fetchMe()
        .catch(() => {})
        .finally(() => setReady(true));
    } else {
      setReady(true);
      // navigate("/welcome");
    }
  }, []);

  const handleAuth = async (payload) => {
    setUserPersisted(payload.user, payload.access_token);
    try {
      await fetchMe();
    } catch {
      // fetchMe handles logout/navigation on failure
      return;
    }
    const params = new URLSearchParams(location.search);
    const redirect = params.get("redirect");
    const safeRedirect = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
    navigate(safeRedirect);
  };

  useEffect(() => {
    const handleRevert = () => {
      const adminToken = localStorage.getItem("admin_token_backup");
      if (adminToken) {
        setToken(adminToken);
        localStorage.removeItem("admin_token_backup");
        localStorage.removeItem("impersonator_token");
        fetchMe().catch(() => {});
      } else {
        logout();
      }
    };
    window.addEventListener('revertImpersonation', handleRevert);
    return () => window.removeEventListener('revertImpersonation', handleRevert);
  }, []);

  const logout = () => {
    clearToken();
    localStorage.removeItem("user");
    localStorage.removeItem("admin_token_backup");
    localStorage.removeItem("impersonator_token");
    setUser(null);
    navigate("/welcome");
  };

  if (!ready) return null;

  const editorTheme = theme === "dark" ? dracula : bbedit;

  return (
    <>
      <div className="animated-bg" />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route
            path="/welcome"
            element={<Landing theme={theme} toggleTheme={toggleTheme} />}
          />
          <Route
            path="/login"
            element={<LoginPage onAuth={handleAuth} theme={theme} toggleTheme={toggleTheme} />}
          />
          <Route
            path="/register"
            element={<RegisterPage onAuth={handleAuth} theme={theme} toggleTheme={toggleTheme} />}
          />
          <Route
            path="/users/:userId"
            element={<ProfileRoute user={user} onLogout={logout} theme={theme} toggleTheme={toggleTheme} />}
          />
          <Route path="/support/*" element={<SupportRedirect />} />
          <Route path="/docs/*" element={<DocsRedirect />} />

          {/* Main Layout Routes */}
          <Route element={
            <ProtectedRoute user={user}>
              <Layout user={user} onLogout={logout} theme={theme} toggleTheme={toggleTheme} />
            </ProtectedRoute>
          }>
            <Route path="/" element={<Dashboard user={user} />} />
            <Route path="/projects-view" element={<Dashboard user={user} />} />
            <Route path="/admin" element={<AdminPage user={user} theme={theme} toggleTheme={toggleTheme} />} />
            <Route path="/settings" element={<SettingsPage user={user} onLogout={logout} theme={theme} />} />
            <Route path="/messages" element={<MessagesPage user={user} />} />
            <Route path="/messages/:conversationId" element={<MessagesPage user={user} />} />
            <Route path="/explore" element={<ExplorePage />} />
          </Route>

          {/* Editor likely needs full screen, so kept outside or maybe inside if we want nav? 
              Usually editors need max space. Let's keep it separate or just minimal. 
              Prompt says: "Persistent tab bar for Dashboard, Projects, Settings, and Search."
              Doesn't explicitly say Editor. I'll keep Editor separate for immersive experience.
          */}
          <Route
            path="/projects/:id"
            element={
              <ProtectedRoute user={user}>
                <EditorPage
                  user={user}
                  onLogout={logout}
                  theme={theme}
                  toggleTheme={toggleTheme}
                  editorTheme={editorTheme}
                />
              </ProtectedRoute>
            }
          />

          <Route
            path="/share/:code"
            element={<ShareJoin user={user} />}
          />

          <Route path="*" element={<NotFound4 />} />
        </Routes>
      </AnimatePresence>
    </>
  );
}
