import axios from "axios";

const resolveDefaultApiBase = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.origin;
};

const API_BASE = import.meta.env.VITE_API_BASE || resolveDefaultApiBase();

const api = axios.create({
  baseURL: API_BASE,
});

export { API_BASE };
export default api;
