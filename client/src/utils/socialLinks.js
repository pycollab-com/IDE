const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;
const MAILTO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_PROFILE_LINKS = 20;

const KNOWN_PLATFORMS = [
  { id: "mailto", label: "Email", protocol: "mailto:" },
  { id: "github", label: "GitHub", domains: ["github.com"] },
  { id: "gitlab", label: "GitLab", domains: ["gitlab.com"] },
  { id: "bitbucket", label: "Bitbucket", domains: ["bitbucket.org"] },
  { id: "linkedin", label: "LinkedIn", domains: ["linkedin.com"] },
  { id: "x", label: "X", domains: ["x.com", "twitter.com"] },
  { id: "youtube", label: "YouTube", domains: ["youtube.com", "youtu.be"] },
  { id: "instagram", label: "Instagram", domains: ["instagram.com"] },
  { id: "twitch", label: "Twitch", domains: ["twitch.tv"] },
  { id: "tiktok", label: "TikTok", domains: ["tiktok.com"] },
  { id: "facebook", label: "Facebook", domains: ["facebook.com", "fb.com"] },
  { id: "discord", label: "Discord", domains: ["discord.com", "discord.gg"] },
  { id: "reddit", label: "Reddit", domains: ["reddit.com"] },
  { id: "threads", label: "Threads", domains: ["threads.net"] },
  { id: "telegram", label: "Telegram", domains: ["t.me", "telegram.me", "telegram.org"] },
  { id: "snapchat", label: "Snapchat", domains: ["snapchat.com"] },
  { id: "mastodon", label: "Mastodon", domains: ["mastodon.social"] },
  { id: "medium", label: "Medium", domains: ["medium.com"] },
  { id: "devto", label: "DEV", domains: ["dev.to"] },
  { id: "behance", label: "Behance", domains: ["behance.net"] },
  { id: "dribbble", label: "Dribbble", domains: ["dribbble.com"] },
  { id: "codepen", label: "CodePen", domains: ["codepen.io"] },
  { id: "stack-overflow", label: "Stack Overflow", domains: ["stackoverflow.com", "stackexchange.com"] },
  { id: "steam", label: "Steam", domains: ["steamcommunity.com"] },
  { id: "pinterest", label: "Pinterest", domains: ["pinterest.com"] },
  { id: "tumblr", label: "Tumblr", domains: ["tumblr.com"] },
  { id: "vk", label: "VK", domains: ["vk.com"] },
  { id: "whatsapp", label: "WhatsApp", domains: ["whatsapp.com", "wa.me"] },
  { id: "buymeacoffee", label: "Buy Me a Coffee", domains: ["buymeacoffee.com"] },
];

const normalizeHost = (host) => host.toLowerCase().replace(/^www\./, "");

const parseInputUrl = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = URL_SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);

    if (url.protocol === "mailto:") {
      const email = url.pathname.trim().toLowerCase();
      if (!MAILTO_RE.test(email)) return null;
      return new URL(`mailto:${email}`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;

    return url;
  } catch {
    return null;
  }
};

const toCanonicalUrl = (url) => {
  if (url.protocol === "mailto:") {
    return `mailto:${url.pathname.trim().toLowerCase()}`;
  }

  const normalized = new URL(url.toString());
  normalized.hostname = normalizeHost(normalized.hostname);

  if (normalized.pathname === "/") {
    normalized.pathname = "";
  } else {
    normalized.pathname = normalized.pathname.replace(/\/+$/, "");
  }

  return normalized.toString();
};

const formatUrlForDisplay = (url) => {
  if (url.protocol === "mailto:") return `mailto:${url.pathname.trim().toLowerCase()}`;
  const host = normalizeHost(url.hostname);
  const normalizedPath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${host}${normalizedPath}${url.search}${url.hash}`;
};

const matchPlatform = (url) => {
  if (url.protocol === "mailto:") {
    return KNOWN_PLATFORMS.find((platform) => platform.protocol === "mailto:") || null;
  }

  const hostname = normalizeHost(url.hostname);
  return KNOWN_PLATFORMS.find((platform) =>
    Array.isArray(platform.domains) &&
    platform.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  ) || null;
};

const linkHandle = (url) => {
  if (url.protocol === "mailto:") {
    return url.pathname.trim().toLowerCase();
  }

  return url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
};

const faviconCandidatesForHost = (host) => {
  if (!host) return [];
  const candidates = [
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
    `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${host}`)}&sz=64`,
    `https://${host}/favicon.ico`,
  ];
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate || seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
};

export const normalizeProfileLink = (value) => {
  if (typeof value !== "string") return null;
  const url = parseInputUrl(value);
  if (!url) return null;
  return toCanonicalUrl(url);
};

export const isValidProfileLink = (value) => Boolean(normalizeProfileLink(value));

export const normalizeProfileLinks = (values = []) => {
  const normalized = [];
  const seen = new Set();

  for (const rawValue of values) {
    const link = normalizeProfileLink(rawValue);
    if (!link) continue;

    const key = link.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(link);

    if (normalized.length >= MAX_PROFILE_LINKS) break;
  }

  return normalized;
};

export const parseSocialLink = (value) => {
  if (typeof value !== "string") {
    return {
      href: "",
      displayText: "",
      isKnownPlatform: false,
      platformId: null,
      platformLabel: null,
      handle: "",
      host: "",
      faviconUrl: null,
      faviconUrls: [],
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      href: "",
      displayText: "",
      isKnownPlatform: false,
      platformId: null,
      platformLabel: null,
      handle: "",
      host: "",
      faviconUrl: null,
      faviconUrls: [],
    };
  }

  const url = parseInputUrl(trimmed);
  if (!url) {
    return {
      href: trimmed,
      displayText: trimmed,
      isKnownPlatform: false,
      platformId: null,
      platformLabel: null,
      handle: "",
      host: "",
      faviconUrl: null,
      faviconUrls: [],
    };
  }

  const platform = matchPlatform(url);
  const canonicalHref = toCanonicalUrl(url);
  const handle = linkHandle(url);
  const host = url.protocol === "mailto:" ? "" : normalizeHost(url.hostname);
  const faviconUrls = platform ? [] : faviconCandidatesForHost(host);

  return {
    href: canonicalHref,
    displayText: platform ? handle || platform.label : formatUrlForDisplay(url),
    isKnownPlatform: Boolean(platform),
    platformId: platform?.id || null,
    platformLabel: platform?.label || null,
    handle,
    host,
    faviconUrl: faviconUrls[0] || null,
    faviconUrls,
  };
};
