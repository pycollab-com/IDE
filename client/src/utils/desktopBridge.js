const bridge = typeof window !== "undefined" ? window.pycollabDesktop || null : null;

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
