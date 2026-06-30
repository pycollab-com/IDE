import axios from "axios";
import { getToken } from "./auth";

const normalizeBase = (value) => String(value || "").replace(/\/+$/, "");

const resolveDefaultApiBase = () => {
  if (typeof window === "undefined") {
    return "";
  }
  const { protocol, hostname, port } = window.location;
  const numericPort = Number(port);
  const isVitePort =
    numericPort === 4173 || (Number.isInteger(numericPort) && numericPort >= 5173 && numericPort <= 5199);
  if (isVitePort) {
    const host = hostname.includes(":") ? `[${hostname}]` : hostname;
    return `${protocol}//${host}:8000`;
  }
  return window.location.origin;
};

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
const IS_DESKTOP_RUNTIME = typeof window !== "undefined" && typeof window.pycollabDesktop !== "undefined";
const HOSTED_WEB_BASE = normalizeBase(
  import.meta.env.VITE_HOSTED_WEB_BASE ||
    import.meta.env.VITE_HOSTED_API_BASE ||
    import.meta.env.VITE_API_BASE ||
    "https://pycollab.com",
);
const HOSTED_API_BASE = normalizeBase(
  import.meta.env.VITE_HOSTED_API_BASE || import.meta.env.VITE_API_BASE || resolveDefaultApiBase(),
);
const DESKTOP_HOSTED_PROXY_BASE =
  IS_DESKTOP_RUNTIME && LOCAL_API_BASE ? `${LOCAL_API_BASE}/ide/hosted-proxy` : HOSTED_API_BASE;

const API_BASE = HOSTED_API_BASE;

const localApi = axios.create({
  baseURL: LOCAL_API_BASE,
});

const hostedApi = axios.create({
  baseURL: DESKTOP_HOSTED_PROXY_BASE,
});

const isBannedDetail = (detail) =>
  typeof detail === "string" && detail.toLowerCase().includes("your account has been banned");

hostedApi.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

hostedApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isBannedDetail(error?.response?.data?.detail) && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pycollab:account-banned", { detail: error.response.data.detail }));
    }
    return Promise.reject(error);
  },
);

export { API_BASE, HOSTED_API_BASE, HOSTED_WEB_BASE, LOCAL_API_BASE, hostedApi, localApi };
export default hostedApi;
