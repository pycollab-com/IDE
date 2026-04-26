import { getPersistentState, patchPersistentState } from "./persistentState";

const setToken = (token) => {
  const nextToken = typeof token === "string" && token.trim() ? token.trim() : null;
  patchPersistentState({ token: nextToken });
  return nextToken;
};

const clearToken = () => {
  patchPersistentState({ token: null });
};

const getToken = () => getPersistentState().token;

const hasToken = () => Boolean(getToken());

const setAdminTokenBackup = (token) => {
  const nextToken = typeof token === "string" && token.trim() ? token.trim() : null;
  patchPersistentState({ adminTokenBackup: nextToken });
  return nextToken;
};

const getAdminTokenBackup = () => getPersistentState().adminTokenBackup;

const clearAdminTokenBackup = () => {
  patchPersistentState({ adminTokenBackup: null });
};

const setImpersonatorFlag = (value) => {
  patchPersistentState({ impersonatorToken: Boolean(value) });
};

const isImpersonating = () => Boolean(getPersistentState().impersonatorToken);

const clearImpersonationState = () => {
  patchPersistentState({
    adminTokenBackup: null,
    impersonatorToken: false,
  });
};

export {
  clearAdminTokenBackup,
  clearImpersonationState,
  clearToken,
  getAdminTokenBackup,
  getToken,
  hasToken,
  isImpersonating,
  setAdminTokenBackup,
  setImpersonatorFlag,
  setToken,
};
