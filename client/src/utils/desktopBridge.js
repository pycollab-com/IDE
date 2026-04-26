const bridge = typeof window !== "undefined" ? window.pycollabDesktop || null : null;
const FALLBACK_STATE_KEY = "pycollab.ide.persistentState";

async function callBridge(method, fallback) {
  if (bridge && typeof bridge[method] === "function") {
    return bridge[method]();
  }
  return fallback();
}

export async function chooseFolder() {
  return callBridge("chooseFolder", async () => null);
}

export async function chooseCreateLocation() {
  return callBridge("chooseCreateLocation", async () => null);
}

export async function chooseImportSource() {
  return callBridge("chooseImportSource", async () => null);
}

export async function revealPath(path) {
  if (bridge && typeof bridge.revealPath === "function") {
    return bridge.revealPath(path);
  }
  return { ok: false };
}

export async function getDesktopContext() {
  return callBridge("getDesktopContext", async () => ({
    isDesktop: false,
    platform: "web",
    version: "dev",
  }));
}

export async function loadPersistentState() {
  return callBridge("getPersistentState", async () => {
    if (typeof localStorage === "undefined") {
      return {};
    }

    try {
      const raw = localStorage.getItem(FALLBACK_STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      localStorage.removeItem(FALLBACK_STATE_KEY);
      return {};
    }
  });
}

export async function savePersistentState(state) {
  if (bridge && typeof bridge.setPersistentState === "function") {
    return bridge.setPersistentState(state || {});
  }

  if (typeof localStorage === "undefined") {
    return { ok: false, error: "Persistent storage is unavailable." };
  }

  localStorage.setItem(FALLBACK_STATE_KEY, JSON.stringify(state || {}));
  return { ok: true, state: state || {} };
}

export async function clearPersistentState() {
  if (bridge && typeof bridge.clearPersistentState === "function") {
    return bridge.clearPersistentState();
  }

  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(FALLBACK_STATE_KEY);
  }
  return { ok: true };
}

export async function checkAppUpdate() {
  return callBridge("checkAppUpdate", async () => ({
    ok: false,
    error: "Desktop updates are only available in the packaged app.",
    current_version: "dev",
  }));
}

export async function openAppUpdate(targetUrl) {
  if (bridge && typeof bridge.openAppUpdate === "function") {
    return bridge.openAppUpdate(targetUrl);
  }
  if (targetUrl) {
    window.open(targetUrl, "_blank", "noopener,noreferrer");
    return { ok: true };
  }
  return { ok: false };
}

export async function openExternalUrl(targetUrl) {
  if (bridge && typeof bridge.openExternalUrl === "function") {
    return bridge.openExternalUrl(targetUrl);
  }
  if (targetUrl) {
    window.open(targetUrl, "_blank", "noopener,noreferrer");
    return { ok: true };
  }
  return { ok: false };
}

export async function copyText(text) {
  if (bridge && typeof bridge.copyText === "function") {
    return bridge.copyText(String(text ?? ""));
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(String(text ?? ""));
    return { ok: true };
  }

  if (typeof document !== "undefined") {
    const input = document.createElement("textarea");
    input.value = String(text ?? "");
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, input.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return { ok };
  }

  return { ok: false };
}

export async function openBluetoothSettings() {
  if (bridge && typeof bridge.openBluetoothSettings === "function") {
    return bridge.openBluetoothSettings();
  }
  return { ok: false };
}

export function onDevicePicker(callback) {
  if (bridge && typeof bridge.onDevicePicker === "function") {
    return bridge.onDevicePicker(callback);
  }
  return () => {};
}

export async function resolveDevicePicker(requestId, deviceId) {
  if (bridge && typeof bridge.resolveDevicePicker === "function") {
    return bridge.resolveDevicePicker({ requestId, deviceId });
  }
  return { ok: false };
}

export async function cancelDevicePicker(requestId) {
  if (bridge && typeof bridge.cancelDevicePicker === "function") {
    return bridge.cancelDevicePicker(requestId);
  }
  return { ok: false };
}
