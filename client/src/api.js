import axios from "axios";
import { getToken } from "./auth";

const normalizeBase = (value) => String(value || "").replace(/\/+$/, "");

const resolveLocalApiBase = () => {
  if (typeof window === "undefined") {
    return "";
  }
  const queryValue = new URLSearchParams(window.location.search).get("localApiBase");
  if (queryValue) {
    return queryValue;
  }
  return window.location.origin;
};

const LOCAL_API_BASE = normalizeBase(import.meta.env.VITE_LOCAL_API_BASE || resolveLocalApiBase());
const HOSTED_WEB_BASE = normalizeBase(
  import.meta.env.VITE_HOSTED_WEB_BASE ||
    import.meta.env.VITE_HOSTED_API_BASE ||
    import.meta.env.VITE_API_BASE ||
    "https://pycollab.com"
);
const HOSTED_API_BASE = normalizeBase(
  import.meta.env.VITE_HOSTED_API_BASE ||
    import.meta.env.VITE_API_BASE ||
    HOSTED_WEB_BASE
);

const API_BASE = HOSTED_API_BASE;

const localApi = axios.create({
  baseURL: LOCAL_API_BASE,
});

const hostedApi = axios.create({
  baseURL: HOSTED_API_BASE,
});

hostedApi.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export { API_BASE, HOSTED_API_BASE, HOSTED_WEB_BASE, LOCAL_API_BASE, hostedApi, localApi };
export default hostedApi;
