import { getPersistentState, patchPersistentState } from "./persistentState";

const isObjectLike = (value) => value !== null && typeof value === "object";

const deepFreeze = (value, seen = new WeakSet()) => {
  if (!isObjectLike(value) || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry, seen));
  } else {
    Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  }
  return Object.freeze(value);
};

export function freezeSerializable(value) {
  if (value == null) return value;
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

export function loadStoredUser() {
  return freezeSerializable(getPersistentState().user || null);
}

export function storeUser(user) {
  const nextUser = user && typeof user === "object" ? freezeSerializable(user) : null;
  patchPersistentState({ user: nextUser });
  return nextUser;
}

export function clearStoredUser() {
  patchPersistentState({ user: null });
}
