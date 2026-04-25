import { getPersistentState, patchPersistentState } from "./persistentState";

export function loadStoredUser() {
  return getPersistentState().user || null;
}

export function storeUser(user) {
  const nextUser = user && typeof user === "object" ? user : null;
  patchPersistentState({ user: nextUser });
  return nextUser;
}

export function clearStoredUser() {
  patchPersistentState({ user: null });
}
