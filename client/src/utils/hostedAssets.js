import { API_BASE, LOCAL_API_BASE } from "../api";

const isAbsoluteUrl = (value) => /^https?:\/\//i.test(String(value || ""));
const isDataLikeUrl = (value) => /^(data:|blob:)/i.test(String(value || ""));

export function resolveHostedAssetUrl(pathOrUrl) {
  const value = String(pathOrUrl || "").trim();
  if (!value) {
    return null;
  }

  const absoluteUrl = isAbsoluteUrl(value) || isDataLikeUrl(value) ? value : `${API_BASE}${value}`;
  if (isDataLikeUrl(absoluteUrl)) {
    return absoluteUrl;
  }

  const isDesktop = typeof window !== "undefined" && typeof window.pycollabDesktop !== "undefined";
  if (!isDesktop) {
    return absoluteUrl;
  }

  const proxyBase = LOCAL_API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  const proxyUrl = new URL("/ide/asset-proxy", proxyBase);
  proxyUrl.searchParams.set("asset_url", absoluteUrl);
  return proxyUrl.toString();
}
