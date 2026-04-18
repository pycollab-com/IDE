import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { bbedit } from "@uiw/codemirror-theme-bbedit";
import { dracula } from "@uiw/codemirror-theme-dracula";
import WelcomePage from "./pages/Welcome";
import LocalEditorPage from "./pages/LocalEditor";
import { getDesktopContext } from "./utils/desktopBridge";

export default function App() {
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [desktopContext, setDesktopContext] = useState({
    isDesktop: false,
    platform: "web",
    version: "dev",
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    getDesktopContext().then(setDesktopContext).catch(() => {});
  }, []);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  const editorTheme = theme === "dark" ? dracula : bbedit;

  return (
    <>
      <div className="animated-bg" />
      <AnimatePresence mode="wait">
        <Routes>
          <Route
            path="/"
            element={
              <WelcomePage
                theme={theme}
                toggleTheme={toggleTheme}
                desktopContext={desktopContext}
              />
            }
          />
          <Route
            path="/projects/:id"
            element={
              <LocalEditorPage
                theme={theme}
                toggleTheme={toggleTheme}
                editorTheme={editorTheme}
                desktopContext={desktopContext}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </>
  );
}
