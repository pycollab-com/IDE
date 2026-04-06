import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || (typeof window !== "undefined" ? window.location.origin : "");

const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export { API_BASE };
export default api;
