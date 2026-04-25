import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { motion, AnimatePresence } from "framer-motion";
import { FiUser, FiLock, FiAlertCircle, FiSun, FiMoon, FiArrowRight, FiArrowLeft } from "react-icons/fi";
import { GoogleLogin } from "@react-oauth/google";
import { GOOGLE_CLIENT_ID, IS_DESKTOP_APP } from "../googleConfig";
import {
  clearGoogleSignupPayload,
  getGoogleSignupPayload,
  setGoogleSignupPayload,
  startGoogleAuth,
} from "../utils/googleAuth";
import { startDesktopHostedAuth } from "../utils/desktopHostedAuth";

function GoogleGlyph() {
  return (
    <svg className="ap-google-glyph" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.2 0 6 1.1 8.2 3.2l6.1-6.1C34.5 3.1 29.7 1 24 1 14.6 1 6.6 6.6 2.8 14.7l7.1 5.5C11.7 13.8 17.3 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.7-.1-2.9-.5-4.2H24v8h12.9c-.3 2-.8 3.4-2 4.6l6.9 5.4c4-3.7 4.7-9.2 4.7-13.8z" />
      <path fill="#FBBC05" d="M10 27.8c-.5-1.6-.8-3.3-.8-5s.3-3.4.8-5L2.8 12.3C1 15.8 0 19.8 0 22.8s1 7 2.8 10.5l7.2-5.5z" />
      <path fill="#34A853" d="M24 47c6.5 0 11.9-2.1 15.9-5.7L33 35.9c-2 1.4-4.6 2.3-9 2.3-6.7 0-12.3-4.3-14.2-10.2l-7.1 5.5C6.6 41.4 14.6 47 24 47z" />
    </svg>
  );
}

function CodePreview() {
  return (
    <div className="ap-code" aria-hidden="true">
      <div className="ap-code-bar">
        <div className="ap-code-dots"><span /><span /><span /></div>
        <span className="ap-code-name">workspace.py</span>
        <span className="ap-code-live">● Live</span>
      </div>
      <div className="ap-code-body">
        <div className="ap-code-line">
          <span className="ap-ck">class</span>{" "}Team:
        </div>
        <div className="ap-code-line">
          {"  "}<span className="ap-ck">def</span> __init__(self, name):
          <span className="ap-cur ap-cur-a"><span>You</span></span>
        </div>
        <div className="ap-code-line">
          {"    "}self.name = name
        </div>
        <div className="ap-code-line">
          {"  "}<span className="ap-cc"># Invite teammates instantly</span>
          <span className="ap-cur ap-cur-b"><span>Teammate</span></span>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage({ onAuth, theme, toggleTheme }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [googleSignup, setGoogleSignup] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleButtonRef = useRef(null);
  const [googleButtonWidth, setGoogleButtonWidth] = useState(0);
  const googleEnabled = Boolean(GOOGLE_CLIENT_ID);
  const isGoogleCompletion = Boolean(googleSignup?.signup_token);

  useEffect(() => {
    const payload = getGoogleSignupPayload();
    if (!payload?.signup_token) return;
    setGoogleSignup(payload);
    if (payload.suggested_username) setUsername(payload.suggested_username);
    if (payload.suggested_display_name) setDisplayName(payload.suggested_display_name);
  }, []);

  useEffect(() => {
    if (!googleEnabled || IS_DESKTOP_APP || !googleButtonRef.current) return;
    const host = googleButtonRef.current;
    const updateWidth = () => {
      const width = Math.floor(host.getBoundingClientRect().width);
      setGoogleButtonWidth(width > 0 ? width : 0);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(host);
    return () => observer.disconnect();
  }, [googleEnabled]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    if (!/^[a-zA-Z0-9]+$/.test(username)) {
      setError("Username can only contain letters (a-z) and/or numbers (0-9)");
      return;
    }

    setLoading(true);
    try {
      if (isGoogleCompletion) {
        const res = await api.post("/auth/google/complete-signup", {
          signup_token: googleSignup.signup_token,
          username,
          display_name: displayName || username,
        });
        clearGoogleSignupPayload();
        setGoogleSignup(null);
        setTimeout(() => onAuth(res.data), 500);
        return;
      }

      const res = await api.post("/auth/register", { username, password, display_name: displayName || username });
      setTimeout(() => onAuth(res.data), 500);
    } catch (err) {
      const detail = err.response?.data?.detail || "Registration failed";
      setError(detail);
      if (isGoogleCompletion && /signup token/i.test(detail)) {
        clearGoogleSignupPayload();
        setGoogleSignup(null);
      }
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (response) => {
    setError("");
    const idToken = response?.credential;
    if (!idToken) {
      setError("Google sign-in did not return an ID token");
      return;
    }
    setGoogleLoading(true);
    try {
      const result = await startGoogleAuth(idToken);
      if (result.status === "authenticated") {
        setTimeout(() => onAuth(result), 500);
        return;
      }
      if (result.status === "needs_profile") {
        setGoogleSignupPayload(result);
        setGoogleSignup(result);
        setUsername(result.suggested_username || "");
        setDisplayName(result.suggested_display_name || "");
        return;
      }
      setError("Unexpected Google auth response");
    } catch (err) {
      setError(err.response?.data?.detail || "Google sign-up failed");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDesktopGoogleRegister = async () => {
    setError("");
    setGoogleLoading(true);
    try {
      const payload = await startDesktopHostedAuth("register");
      await onAuth(payload);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Google sign-up failed");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="ap">
      <div className="ap-left">
        <div className="ap-left-top">
          <Link to="/login" className="ap-back"><FiArrowLeft size={14} /> Back to login</Link>
        </div>

        <div className="ap-brand">
          <div className="ap-logo">PyCollab</div>
          <p className="ap-tagline">Set up your workspace<br />in minutes.</p>
        </div>

        <ul className="ap-features">
          <li><span className="ap-dot" /><span>Invite teammates instantly</span></li>
          <li><span className="ap-dot" /><span>Shared code, shared context</span></li>
          <li><span className="ap-dot" /><span>Built for calm, focused sessions</span></li>
        </ul>

        <CodePreview />

        <p className="ap-footnote">No credit card · No setup · Free forever</p>
      </div>

      {/* Right: form area */}
      <div className="ap-right">
        <button className="ap-theme" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <FiMoon size={18} /> : <FiSun size={18} />}
        </button>

        <div className="ap-right-inner">
          <motion.div
            className="ap-card"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
          <div className="ap-head">
            <div className="ap-kicker">
              {isGoogleCompletion ? "Complete Google sign-up" : "Create your workspace"}
            </div>
            <h1 className="ap-title">
              {isGoogleCompletion ? "Almost there" : "Create account"}
            </h1>
            <p className="ap-sub">
              {isGoogleCompletion
                ? "Choose your username and display name."
                : "Join the collaboration today."}
            </p>
          </div>

          <form onSubmit={submit} className="ap-form">
            <div className="ap-field">
              <label className="ap-label" htmlFor="r-display">Display Name</label>
              <div className="input-wrap">
                <FiUser className="input-icon" />
                <input
                  id="r-display"
                  className="input ap-input"
                  placeholder="Your Name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>

            <div className="ap-field">
              <label className="ap-label" htmlFor="r-user">
                Username <span className="ap-required">*</span>
              </label>
              <div className="input-wrap">
                <FiUser className="input-icon" />
                <input
                  id="r-user"
                  className="input ap-input"
                  placeholder="your_username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>

            {!isGoogleCompletion && (
              <div className="ap-field">
                <label className="ap-label" htmlFor="r-pass">
                  Password <span className="ap-required">*</span>
                </label>
                <div className="input-wrap">
                  <FiLock className="input-icon" />
                  <input
                    id="r-pass"
                    className="input ap-input"
                    placeholder="Choose a strong password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            <AnimatePresence>
              {error && (
                <motion.div
                  className="ap-error"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                >
                  <FiAlertCircle size={15} /> {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              className="ap-btn-primary"
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Creating account…"
                : <>{isGoogleCompletion ? "Complete Sign Up" : "Create Account"} <FiArrowRight size={16} /></>}
            </motion.button>
          </form>

          {!isGoogleCompletion && IS_DESKTOP_APP && (
            <>
              <div className="ap-sep"><span>or</span></div>
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className="ap-btn-social"
                onClick={handleDesktopGoogleRegister}
                disabled={googleLoading}
                type="button"
              >
                {googleLoading ? "Waiting for browser…" : <><GoogleGlyph /> Create account with Google</>}
              </motion.button>
            </>
          )}

          {!isGoogleCompletion && !IS_DESKTOP_APP && googleEnabled && (
            <>
              <div className="ap-sep"><span>or</span></div>
              <div className="ap-google-wrap" style={{ opacity: googleLoading ? 0.7 : 1 }}>
                <motion.button
                  whileHover={{ y: -1 }}
                  className="ap-btn-social google-auth-visual"
                  disabled={googleLoading}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  {googleLoading ? "Connecting…" : <><GoogleGlyph /> Continue with Google</>}
                </motion.button>
                <div className="google-auth-overlay" style={{ pointerEvents: googleLoading ? "none" : "auto" }}>
                  <div ref={googleButtonRef}>
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => setError("Google sign-up failed")}
                      text="signup_with"
                      width={googleButtonWidth > 0 ? googleButtonWidth : undefined}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <p className="ap-switch">
            Already have an account?{" "}
            <Link to="/login" className="ap-link">
              Log in <FiArrowRight size={13} />
            </Link>
          </p>
          </motion.div>
        </div>
      </div>

      <style>{`
        .ap {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 100vh;
          position: relative;
        }
        .ap-left {
          position: relative;
          display: flex; flex-direction: column;
          padding: 44px 52px; gap: 36px;
          overflow: hidden;
          background: linear-gradient(160deg, #293122 0%, #313c28 50%, #39462e 100%);
          color: #fff;
        }
        .ap-left::before {
          content: ""; position: absolute;
          width: 560px; height: 560px; border-radius: 50%;
          background: radial-gradient(circle, rgba(156,170,136,0.28), transparent 65%);
          top: -200px; right: -200px; pointer-events: none;
        }
        .ap-left::after {
          content: ""; position: absolute;
          width: 420px; height: 420px; border-radius: 50%;
          background: radial-gradient(circle, rgba(127,142,109,0.22), transparent 65%);
          bottom: -120px; left: -120px; pointer-events: none;
        }
        .ap-left-top { display: flex; align-items: center; }
        .ap-back {
          display: inline-flex; align-items: center; gap: 7px;
          color: rgba(255,255,255,0.55); font-size: 0.85rem; text-decoration: none;
          transition: color 0.18s ease; position: relative; z-index: 1;
        }
        .ap-back:hover { color: rgba(255,255,255,0.9); }
        .ap-brand { display: flex; flex-direction: column; gap: 10px; position: relative; z-index: 1; }
        .ap-logo {
          font-size: clamp(2rem, 3.5vw, 2.8rem);
          font-weight: 800; letter-spacing: -0.045em; color: #fff; line-height: 1;
        }
        .ap-tagline {
          margin: 0; font-size: 1.05rem;
          color: rgba(255,255,255,0.62); line-height: 1.55;
        }
        .ap-features {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-direction: column; gap: 14px;
          position: relative; z-index: 1;
        }
        .ap-features li {
          display: flex; align-items: center; gap: 12px;
          font-size: 0.95rem; color: rgba(255,255,255,0.75);
        }
        .ap-dot {
          flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%;
          background: rgba(255,255,255,0.6);
          box-shadow: 0 0 0 4px rgba(255,255,255,0.12);
        }
        .ap-code {
          border-radius: 14px; border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.25); overflow: hidden;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          position: relative; z-index: 1;
        }
        .ap-code-bar {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.08);
          background: rgba(0,0,0,0.15);
        }
        .ap-code-dots { display: flex; gap: 6px; }
        .ap-code-dots span { width: 9px; height: 9px; border-radius: 50%; background: rgba(255,255,255,0.18); }
        .ap-code-name { flex: 1; text-align: center; font-size: 0.76rem; color: rgba(255,255,255,0.42); }
        .ap-code-live { font-size: 0.68rem; color: rgba(156,170,136,0.85); }
        .ap-code-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
        .ap-code-line {
          font-size: 0.82rem; line-height: 1.75; color: rgba(255,255,255,0.72);
          display: flex; align-items: center;
        }
        .ap-ck { color: rgb(156,170,136); font-weight: 600; }
        .ap-cs { color: rgba(196,212,168,0.9); }
        .ap-cc { color: rgba(255,255,255,0.35); font-style: italic; }
        .ap-cur {
          display: inline-flex; align-items: center;
          position: relative; margin-left: 4px;
        }
        .ap-cur::before {
          content: ""; display: inline-block;
          width: 2px; height: 15px; border-radius: 1px; vertical-align: middle;
        }
        .ap-cur span {
          position: absolute; bottom: 20px; left: -4px;
          padding: 2px 7px; border-radius: 5px;
          font-size: 0.6rem; font-weight: 700; color: #fff;
          white-space: nowrap; pointer-events: none;
        }
        .ap-cur-a::before { background: rgb(156,170,136); }
        .ap-cur-a span { background: rgb(156,170,136); }
        .ap-cur-b::before { background: rgb(127,142,109); }
        .ap-cur-b span { background: rgb(127,142,109); }
        .ap-footnote {
          margin: auto 0 0; font-size: 0.78rem;
          color: rgba(255,255,255,0.32); letter-spacing: 0.04em;
          position: relative; z-index: 1;
        }
        .ap-right {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          padding: 40px 32px; background: var(--bg-color); overflow: hidden;
        }
        .ap-right-inner {
          position: relative;
          z-index: 2;
          width: 100%;
          max-width: 420px;
        }
        .ap-right::before {
          content: ""; position: absolute;
          top: -180px; right: -180px; width: 500px; height: 500px; border-radius: 50%;
          background: radial-gradient(circle, rgba(137,152,120,0.16), transparent 65%);
          pointer-events: none;
        }
        .ap-theme {
          position: absolute; top: 20px; right: 20px; z-index: 5;
          width: 40px; height: 40px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 12px;
          border: 1px solid rgba(247,247,242,0.13);
          background: rgba(18,17,19,0.55);
          color: var(--text-color); cursor: pointer; transition: background 0.2s ease;
        }
        [data-theme="light"] .ap-theme {
          border-color: rgba(18,17,19,0.12); background: rgba(255,255,255,0.82);
        }
        .ap-theme:hover { background: rgba(137,152,120,0.22); }
        .ap-card {
          position: relative; z-index: 2;
          width: 100%; max-width: 420px; padding: 40px;
          border-radius: 20px;
          background: rgba(18,17,19,0.78);
          border: 1px solid rgba(247,247,242,0.13);
          box-shadow: 0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(137,152,120,0.09);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        }
        [data-theme="light"] .ap-card {
          background: rgba(255,255,255,0.95);
          border-color: rgba(18,17,19,0.09);
          box-shadow: 0 16px 48px rgba(18,17,19,0.13), 0 0 0 1px rgba(137,152,120,0.11);
        }
        .ap-head { display: flex; flex-direction: column; gap: 6px; margin-bottom: 28px; }
        .ap-kicker {
          display: inline-flex; align-items: center;
          padding: 5px 13px; border-radius: 999px;
          font-size: 0.68rem; letter-spacing: 0.13em; text-transform: uppercase;
          font-family: ui-monospace, monospace;
          background: rgba(137,152,120,0.2); color: rgb(137,152,120);
          border: 1px solid rgba(137,152,120,0.38); width: fit-content;
        }
        [data-theme="light"] .ap-kicker {
          background: rgba(137,152,120,0.14); color: rgb(74,88,58);
          border-color: rgba(137,152,120,0.32);
        }
        .ap-title {
          margin: 0; padding: 0;
          font-size: clamp(1.9rem, 3vw, 2.3rem);
          font-weight: 800; letter-spacing: -0.04em; line-height: 1.06;
          color: var(--text-color);
        }
        .ap-sub {
          margin: 0; font-size: 0.94rem;
          color: rgba(247,247,242,0.52); line-height: 1.5;
        }
        [data-theme="light"] .ap-sub { color: rgba(18,17,19,0.55); }
        .ap-form { display: flex; flex-direction: column; gap: 16px; }
        .ap-field { display: flex; flex-direction: column; gap: 6px; }
        .ap-label {
          font-size: 0.75rem; font-weight: 600;
          letter-spacing: 0.07em; text-transform: uppercase;
          color: rgba(247,247,242,0.55);
        }
        [data-theme="light"] .ap-label { color: rgba(18,17,19,0.6); }
        .ap-required { color: rgb(137,152,120); }
        .ap-input {
          background: rgba(247,247,242,0.07) !important;
          border-color: rgba(247,247,242,0.13) !important;
          color: var(--text-color) !important;
          height: 46px !important;
          border-radius: 12px !important;
        }
        [data-theme="light"] .ap-input {
          background: rgba(18,17,19,0.04) !important;
          border-color: rgba(18,17,19,0.12) !important;
        }
        .ap-input::placeholder { color: rgba(247,247,242,0.3) !important; }
        [data-theme="light"] .ap-input::placeholder { color: rgba(18,17,19,0.32) !important; }
        .ap-input:focus {
          border-color: rgba(137,152,120,0.6) !important;
          box-shadow: 0 0 0 3px rgba(137,152,120,0.18) !important;
          background: rgba(247,247,242,0.09) !important;
        }
        [data-theme="light"] .ap-input:focus { background: rgba(255,255,255,0.9) !important; }
        .ap-error {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px; border-radius: 10px;
          background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.24);
          color: #f87171; font-size: 0.88rem;
        }
        [data-theme="light"] .ap-error { color: #dc2626; }
        .ap-btn-primary {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 14px 20px; margin-top: 4px;
          border-radius: 12px;
          background: linear-gradient(135deg, rgb(156,170,136), rgb(137,152,120), rgb(127,142,109));
          color: #fff; font-weight: 700; font-size: 1rem; border: none; cursor: pointer;
          box-shadow: 0 4px 24px rgba(137,152,120,0.42);
          transition: box-shadow 0.22s ease, transform 0.18s ease;
        }
        .ap-btn-primary:hover { box-shadow: 0 6px 32px rgba(137,152,120,0.6); }
        .ap-btn-primary:disabled { opacity: 0.65; cursor: not-allowed; box-shadow: none; }
        .ap-sep {
          display: flex; align-items: center; gap: 12px;
          margin: 16px 0;
          color: rgba(247,247,242,0.3); font-size: 0.78rem;
          letter-spacing: 0.1em; text-transform: uppercase;
        }
        [data-theme="light"] .ap-sep { color: rgba(18,17,19,0.35); }
        .ap-sep::before, .ap-sep::after {
          content: ""; flex: 1; height: 1px; background: rgba(247,247,242,0.11);
        }
        [data-theme="light"] .ap-sep::before,
        [data-theme="light"] .ap-sep::after { background: rgba(18,17,19,0.1); }
        .ap-btn-social {
          display: inline-flex; align-items: center; justify-content: center; gap: 10px;
          width: 100%; padding: 12px 20px; margin-bottom: 10px;
          border-radius: 12px;
          border: 1px solid rgba(247,247,242,0.13);
          background: rgba(247,247,242,0.05);
          color: var(--text-color); font-weight: 600; font-size: 0.93rem; cursor: pointer;
          transition: background 0.18s ease, border-color 0.18s ease;
        }
        [data-theme="light"] .ap-btn-social {
          border-color: rgba(18,17,19,0.12); background: rgba(18,17,19,0.03);
        }
        .ap-btn-social:hover {
          background: rgba(137,152,120,0.13); border-color: rgba(137,152,120,0.35);
        }
        .ap-btn-social:disabled { opacity: 0.65; cursor: not-allowed; }
        .ap-google-glyph { width: 18px; height: 18px; flex-shrink: 0; }
        .ap-google-wrap { position: relative; width: 100%; }
        .google-auth-visual { pointer-events: none; }
        .google-auth-overlay {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center; opacity: 0;
        }
        .ap-switch {
          margin: 22px 0 0; text-align: center;
          font-size: 0.88rem; color: rgba(247,247,242,0.45);
        }
        [data-theme="light"] .ap-switch { color: rgba(18,17,19,0.52); }
        .ap-link {
          color: rgb(137,152,120); font-weight: 600; text-decoration: none;
          display: inline-flex; align-items: center; gap: 4px;
          transition: color 0.18s ease;
        }
        .ap-link:hover { color: rgb(156,170,136); }
        @media (max-width: 900px) {
          .ap { grid-template-columns: 1fr; }
          .ap-left { display: none; }
          .ap-right { min-height: 100vh; }
        }
        @media (max-width: 480px) {
          .ap-card { padding: 28px 20px; border-radius: 16px; }
          .ap-right { padding: 24px 16px; }
        }
      `}</style>
    </div>
  );
}
