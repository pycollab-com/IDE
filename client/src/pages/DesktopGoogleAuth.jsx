import { useCallback, useEffect, useMemo, useState } from "react";
import { FiAlertCircle, FiArrowRight, FiLoader } from "react-icons/fi";
import api from "../api";
import { GOOGLE_CLIENT_ID } from "../googleConfig";
import {
  clearDesktopGoogleFlow,
  completeDesktopAuth,
  getDesktopGoogleFlow,
  startDesktopGoogleRedirect,
} from "../utils/desktopAuthBridge";

function decodeJwtPayload(token) {
  const [, payload] = String(token || "").split(".");
  if (!payload) {
    throw new Error("Google did not return a valid ID token.");
  }

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(window.atob(padded));
}

function normalizeMode(mode) {
  return mode === "register" ? "register" : "login";
}

export default function DesktopGoogleAuthPage() {
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [completingSignup, setCompletingSignup] = useState(false);
  const [signupState, setSignupState] = useState(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [completed, setCompleted] = useState(false);

  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const hashParams = useMemo(
    () => new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash),
    []
  );
  const flow = useMemo(() => getDesktopGoogleFlow(), []);
  const mode = normalizeMode(searchParams.get("mode") || flow?.mode);

  const finishDesktopAuth = useCallback(async (payload) => {
    if (!flow?.callbackUrl || !flow?.state) {
      throw new Error("Desktop callback is missing.");
    }

    await completeDesktopAuth(
      { callbackUrl: flow.callbackUrl, state: flow.state },
      { status: "authenticated", payload }
    );
    clearDesktopGoogleFlow();
    setCompleted(true);
    window.setTimeout(() => {
      window.close();
    }, 600);
  }, [flow]);

  useEffect(() => {
    const returnedToken = hashParams.get("id_token");
    const returnedError = hashParams.get("error");
    if (returnedToken || returnedError) {
      return;
    }

    const callbackUrl = searchParams.get("desktopCallback");
    const state = searchParams.get("desktopState");
    if (!callbackUrl || !state) {
      return;
    }

    try {
      startDesktopGoogleRedirect(mode, { callbackUrl, state });
    } catch (err) {
      setError(err.message || "Google sign-in could not be started.");
    }
  }, [hashParams, mode, searchParams]);

  useEffect(() => {
    const returnedToken = hashParams.get("id_token");
    const returnedState = hashParams.get("state");
    const returnedError = hashParams.get("error");
    const callbackUrl = searchParams.get("desktopCallback");
    const desktopState = searchParams.get("desktopState");

    if (!flow) {
      if (!returnedToken && !returnedError && callbackUrl && desktopState) {
        return;
      }
      setError("Desktop Google sign-in session is missing. Return to PyCollab IDE and try again.");
      return;
    }

    if (returnedError) {
      setError(hashParams.get("error_description") || "Google sign-in was cancelled.");
      clearDesktopGoogleFlow();
      return;
    }

    if (!returnedToken) {
      setError("Google did not return a sign-in token. Return to PyCollab IDE and try again.");
      clearDesktopGoogleFlow();
      return;
    }

    if (returnedState !== flow.oauthState) {
      setError("Desktop Google sign-in state did not match. Return to PyCollab IDE and try again.");
      clearDesktopGoogleFlow();
      return;
    }

    let tokenPayload;
    try {
      tokenPayload = decodeJwtPayload(returnedToken);
    } catch (err) {
      setError(err.message || "Google sign-in returned an unreadable token.");
      clearDesktopGoogleFlow();
      return;
    }

    if (tokenPayload.nonce !== flow.nonce) {
      setError("Desktop Google sign-in nonce did not match. Return to PyCollab IDE and try again.");
      clearDesktopGoogleFlow();
      return;
    }

    const audience = tokenPayload.aud;
    const hasExpectedAudience = Array.isArray(audience)
      ? audience.includes(GOOGLE_CLIENT_ID)
      : audience === GOOGLE_CLIENT_ID;

    if (!hasExpectedAudience) {
      setError("Google sign-in returned a token for the wrong client.");
      clearDesktopGoogleFlow();
      return;
    }

    setProcessing(true);
    api
      .post("/auth/google/start", { id_token: returnedToken })
      .then(async (result) => {
        const response = result.data;
        if (response?.status === "authenticated") {
          await finishDesktopAuth(response);
          return;
        }

        if (response?.status === "needs_profile") {
          setSignupState(response);
          setUsername(response.suggested_username || "");
          setDisplayName(response.suggested_display_name || "");
          window.history.replaceState({}, document.title, window.location.pathname);
          return;
        }

        throw new Error("Unexpected Google auth response.");
      })
      .catch((err) => {
        setError(err.response?.data?.detail || err.message || "Google sign-in failed.");
        clearDesktopGoogleFlow();
      })
      .finally(() => {
        setProcessing(false);
      });
  }, [finishDesktopAuth, flow, hashParams, searchParams]);

  const completeSignup = async (event) => {
    event.preventDefault();
    if (!signupState?.signup_token) {
      setError("Google sign-up could not be resumed. Return to PyCollab IDE and try again.");
      return;
    }

    setError("");
    setCompletingSignup(true);
    try {
      const res = await api.post("/auth/google/complete-signup", {
        signup_token: signupState.signup_token,
        username,
        display_name: displayName || username,
      });
      await finishDesktopAuth(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Google sign-up failed.");
    } finally {
      setCompletingSignup(false);
    }
  };

  return (
    <main className="desktop-google-auth-page">
      <section className="desktop-google-auth-card">
        <div className="desktop-google-auth-kicker">PyCollab IDE</div>
        <h1>
          {completed
            ? "Signed in"
            : signupState
              ? "Finish your account"
              : mode === "register"
                ? "Create account with Google"
                : "Sign in with Google"}
        </h1>
        <p>
          {completed
            ? "Return to the desktop app to continue."
            : signupState
              ? "Choose your username and display name to finish desktop sign-in."
              : "Redirecting to Google and finishing desktop sign-in in your browser."}
        </p>

        {processing ? (
          <div className="desktop-google-auth-status">
            <FiLoader size={16} className="desktop-google-auth-spinner" />
            <span>Verifying your Google account…</span>
          </div>
        ) : null}

        {error ? (
          <div className="desktop-google-auth-error">
            <FiAlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        {!completed && signupState ? (
          <form className="desktop-google-auth-form" onSubmit={completeSignup}>
            <label>
              <span>Display name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" />
            </label>
            <label>
              <span>Username</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="yourusername" required />
            </label>
            <button type="submit" disabled={completingSignup}>
              {completingSignup ? "Finishing…" : <>Finish sign-up <FiArrowRight size={14} /></>}
            </button>
          </form>
        ) : null}
      </section>

      <style>{`
        .desktop-google-auth-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 32px;
          background:
            radial-gradient(circle at top left, rgba(137,152,120,0.24), transparent 35%),
            radial-gradient(circle at bottom right, rgba(127,142,109,0.16), transparent 30%),
            #121113;
          color: #f7f7f2;
        }
        .desktop-google-auth-card {
          width: min(100%, 460px);
          padding: 32px;
          border-radius: 24px;
          background: rgba(18,17,19,0.86);
          border: 1px solid rgba(247,247,242,0.14);
          box-shadow: 0 24px 64px rgba(0,0,0,0.35);
        }
        .desktop-google-auth-kicker {
          display: inline-flex;
          margin-bottom: 12px;
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 0.72rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #899878;
          border: 1px solid rgba(137,152,120,0.35);
          background: rgba(137,152,120,0.12);
        }
        .desktop-google-auth-card h1 {
          margin: 0;
          font-size: clamp(2rem, 4vw, 2.5rem);
          letter-spacing: -0.05em;
        }
        .desktop-google-auth-card p {
          margin: 12px 0 0;
          color: rgba(247,247,242,0.68);
          line-height: 1.6;
        }
        .desktop-google-auth-status,
        .desktop-google-auth-error {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 18px;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(247,247,242,0.12);
          background: rgba(247,247,242,0.06);
        }
        .desktop-google-auth-error {
          color: #f87171;
          border-color: rgba(239,68,68,0.22);
          background: rgba(239,68,68,0.12);
        }
        .desktop-google-auth-spinner {
          animation: desktop-google-auth-spin 0.9s linear infinite;
        }
        .desktop-google-auth-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-top: 24px;
        }
        .desktop-google-auth-form label {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .desktop-google-auth-form span {
          font-size: 0.78rem;
          color: rgba(247,247,242,0.72);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .desktop-google-auth-form input {
          height: 46px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1px solid rgba(247,247,242,0.16);
          background: rgba(247,247,242,0.06);
          color: #f7f7f2;
        }
        .desktop-google-auth-form button {
          width: 100%;
          height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border-radius: 14px;
          border: 1px solid rgba(247,247,242,0.14);
          background: rgba(247,247,242,0.08);
          color: #f7f7f2;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
        }
        @keyframes desktop-google-auth-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
}
