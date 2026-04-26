import { HOSTED_WEB_BASE, localApi } from "../api";
import { openExternalUrl } from "./desktopBridge";

function normalizeMode(mode) {
  return mode === "register" ? "register" : "login";
}

async function waitForDesktopAuthResult(sessionId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5 * 60 * 1000) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const pollRes = await localApi.get(`/ide/auth/google/desktop/${sessionId}`);
    if (pollRes.data?.status !== "completed") {
      continue;
    }

    const result = pollRes.data?.result || {};
    if (result.status === "authenticated" && result.payload) {
      return result.payload;
    }

    throw new Error(result.error || "Desktop Google sign-in failed.");
  }

  throw new Error("Desktop Google sign-in timed out.");
}

export async function startDesktopHostedAuth(mode = "login") {
  const authMode = normalizeMode(mode);
  const startRes = await localApi.post("/ide/auth/google/desktop/start");
  const { session_id: sessionId, state, callback_url: callbackUrl } = startRes.data;

  const authUrl = new URL("/app/desktop-google-auth", HOSTED_WEB_BASE);
  authUrl.searchParams.set("desktopCallback", callbackUrl);
  authUrl.searchParams.set("desktopState", state);
  authUrl.searchParams.set("mode", authMode);

  await openExternalUrl(authUrl.toString());
  return waitForDesktopAuthResult(sessionId);
}
