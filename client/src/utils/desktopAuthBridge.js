import { GOOGLE_CLIENT_ID } from "../googleConfig";

const DESKTOP_GOOGLE_FLOW_KEY = "desktopGoogleFlow";
const GOOGLE_OIDC_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DESKTOP_GOOGLE_REDIRECT_PATH = "/app/desktop-google-auth";

export function getDesktopAuthBridge() {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const callbackUrl = params.get("desktopCallback") || "";
  const state = params.get("desktopState") || "";

  if (!callbackUrl || !state) {
    return null;
  }

  return { callbackUrl, state };
}

export function withDesktopAuthQuery(path, bridge) {
  if (!bridge) {
    return path;
  }

  const url = new URL(path, window.location.origin);
  url.searchParams.set("desktopCallback", bridge.callbackUrl);
  url.searchParams.set("desktopState", bridge.state);
  return `${url.pathname}${url.search}`;
}

function submitDesktopAuthForm(bridge, result) {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = bridge.callbackUrl;
  form.style.display = "none";

  const stateInput = document.createElement("input");
  stateInput.type = "hidden";
  stateInput.name = "state";
  stateInput.value = bridge.state;
  form.appendChild(stateInput);

  const resultInput = document.createElement("input");
  resultInput.type = "hidden";
  resultInput.name = "result";
  resultInput.value = JSON.stringify(result);
  form.appendChild(resultInput);

  document.body.appendChild(form);
  form.submit();
  return true;
}

export async function completeDesktopAuth(bridge, result) {
  if (!bridge) {
    return false;
  }

  try {
    const response = await fetch(bridge.callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: bridge.state,
        result,
      }),
    });

    if (!response.ok) {
      throw new Error("Could not hand sign-in back to the desktop app.");
    }

    return true;
  } catch (error) {
    if (submitDesktopAuthForm(bridge, result)) {
      return true;
    }
    throw error;
  }
}

function createRandomString(length = 32) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeDesktopGoogleMode(mode) {
  return mode === "register" ? "register" : "login";
}

export function clearDesktopGoogleFlow() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(DESKTOP_GOOGLE_FLOW_KEY);
}

export function getDesktopGoogleFlow() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(DESKTOP_GOOGLE_FLOW_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    clearDesktopGoogleFlow();
    return null;
  }
}

export function startDesktopGoogleRedirect(mode, bridge) {
  if (typeof window === "undefined" || !bridge) {
    throw new Error("Desktop Google sign-in is not available.");
  }
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google sign-in is not configured.");
  }

  const oauthState = createRandomString(16);
  const nonce = createRandomString(16);
  const nextMode = normalizeDesktopGoogleMode(mode);

  window.sessionStorage.setItem(
    DESKTOP_GOOGLE_FLOW_KEY,
    JSON.stringify({
      callbackUrl: bridge.callbackUrl,
      state: bridge.state,
      mode: nextMode,
      oauthState,
      nonce,
      createdAt: Date.now(),
    })
  );

  const authUrl = new URL(GOOGLE_OIDC_AUTH_URL);
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", `${window.location.origin}${DESKTOP_GOOGLE_REDIRECT_PATH}`);
  authUrl.searchParams.set("response_type", "id_token");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", oauthState);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("prompt", "select_account");

  window.location.assign(authUrl.toString());
}
