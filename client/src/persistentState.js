import {
  clearPersistentState as clearDesktopPersistentState,
  loadPersistentState as loadDesktopPersistentState,
  savePersistentState as saveDesktopPersistentState,
} from "./utils/desktopBridge";

const DEFAULT_STATE = Object.freeze({
  token: null,
  user: null,
  theme: "dark",
  adminTokenBackup: null,
  impersonatorToken: false,
  hostedProjectsCache: [],
});

let memoryState = { ...DEFAULT_STATE };
let hydrated = false;
let writeQueue = Promise.resolve();

const sanitizeString = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

const sanitizeState = (value) => {
  const next = value && typeof value === "object" ? value : {};
  return {
    token: sanitizeString(next.token),
    user: next.user && typeof next.user === "object" ? next.user : null,
    theme: next.theme === "light" ? "light" : "dark",
    adminTokenBackup: sanitizeString(next.adminTokenBackup),
    impersonatorToken: Boolean(next.impersonatorToken),
    hostedProjectsCache: Array.isArray(next.hostedProjectsCache) ? next.hostedProjectsCache : [],
  };
};

const queueWrite = (writer) => {
  writeQueue = writeQueue
    .catch(() => {})
    .then(writer)
    .catch(() => {});
  return writeQueue;
};

const persistMemoryState = () => {
  const snapshot = { ...memoryState };
  return queueWrite(async () => {
    const result = await saveDesktopPersistentState(snapshot);
    if (result?.ok === false) {
      throw new Error(result.error || "Failed to persist IDE state.");
    }
  });
};

export async function initializePersistentState() {
  if (hydrated) {
    return memoryState;
  }

  try {
    memoryState = sanitizeState(await loadDesktopPersistentState());
  } catch {
    memoryState = { ...DEFAULT_STATE };
  }

  hydrated = true;
  return memoryState;
}

export function getPersistentState() {
  return memoryState;
}

export function patchPersistentState(partial) {
  memoryState = sanitizeState({
    ...memoryState,
    ...(partial && typeof partial === "object" ? partial : {}),
  });
  hydrated = true;
  void persistMemoryState();
  return memoryState;
}

export function clearPersistentSession() {
  return patchPersistentState({
    token: null,
    user: null,
    adminTokenBackup: null,
    impersonatorToken: false,
    hostedProjectsCache: [],
  });
}

export function resetPersistentState() {
  memoryState = { ...DEFAULT_STATE };
  hydrated = true;
  void queueWrite(async () => {
    const result = await clearDesktopPersistentState();
    if (result?.ok === false) {
      throw new Error(result.error || "Failed to clear IDE state.");
    }
  });
  return memoryState;
}

export function getStoredTheme() {
  return memoryState.theme || "dark";
}

export function setStoredTheme(theme) {
  patchPersistentState({ theme });
  return theme;
}
