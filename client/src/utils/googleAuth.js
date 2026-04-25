import api from "../api";

const GOOGLE_SIGNUP_STORAGE_KEY = "googleSignupPayload";

const clearGoogleSignupPayload = () => {
  sessionStorage.removeItem(GOOGLE_SIGNUP_STORAGE_KEY);
};

const getGoogleSignupPayload = () => {
  const raw = sessionStorage.getItem(GOOGLE_SIGNUP_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    clearGoogleSignupPayload();
    return null;
  }
};

const setGoogleSignupPayload = (payload) => {
  sessionStorage.setItem(GOOGLE_SIGNUP_STORAGE_KEY, JSON.stringify(payload));
};

const startGoogleAuth = async (idToken) => {
  const res = await api.post("/auth/google/start", { id_token: idToken });
  return res.data;
};

const verifyEmailWithGoogle = async (idToken) => {
  const res = await api.post("/users/me/email/verify/google", { id_token: idToken });
  return res.data;
};

export {
  clearGoogleSignupPayload,
  getGoogleSignupPayload,
  setGoogleSignupPayload,
  startGoogleAuth,
  verifyEmailWithGoogle,
};
