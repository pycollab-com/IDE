const GOOGLE_CLIENT_ID_FALLBACK =
  "673654005602-gecd1ltp10rttmh177k0onqignmcofag.apps.googleusercontent.com";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID_FALLBACK;

export { GOOGLE_CLIENT_ID };
