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
