// Single source of truth for what each connected Pybricks device can report and
// how to display it. The UI reads from this registry so adding a new reading is
// a one-line change here instead of edits scattered through the panel.

const fin = Number.isFinite;
const titleCase = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/(^|[\s_])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());

// Each metric: key, label, primary (the headline reading for the device), and a
// format that returns a display string or null when the value is unavailable.
// Returning null lets both the port card and the customize list hide readings a
// given sensor does not actually expose right now.
const KIND_METRICS = {
  motor: [
    { key: "angle", label: "Angle", primary: true, format: (p) => (fin(p.angle) ? `${Math.round(p.angle)}°` : null) },
    { key: "speed", label: "Speed", format: (p) => (fin(p.speed) ? `${Math.round(p.speed)}°/s` : null) },
  ],
  color: [
    {
      key: "color",
      label: "Color",
      primary: true,
      format: (p) => (p.color && p.color !== "NONE" ? titleCase(p.color) : p.color === "NONE" ? "No color" : null),
    },
    { key: "hsv_h", label: "Hue", format: (p) => (fin(p.hsv?.[0]) ? `${p.hsv[0]}°` : null) },
    { key: "hsv_s", label: "Saturation", format: (p) => (fin(p.hsv?.[1]) ? `${p.hsv[1]}%` : null) },
    { key: "hsv_v", label: "Value", format: (p) => (fin(p.hsv?.[2]) ? `${p.hsv[2]}%` : null) },
    { key: "reflection", label: "Reflection", format: (p) => (fin(p.reflection) ? `${p.reflection}%` : null) },
    { key: "ambient", label: "Ambient", format: (p) => (fin(p.ambient) ? `${p.ambient}%` : null) },
    { key: "distance", label: "Proximity", format: (p) => (fin(p.distance) ? `${Math.round(p.distance)}` : null) },
  ],
  distance: [
    { key: "distance", label: "Distance", primary: true, format: (p) => (fin(p.distance) ? `${Math.round(p.distance)} mm` : null) },
  ],
  force: [
    { key: "force", label: "Force", primary: true, format: (p) => (fin(p.force) ? `${p.force.toFixed(1)} N` : null) },
    { key: "pressed", label: "Pressed", format: (p) => (p.pressed === true ? "Yes" : p.pressed === false ? "No" : null) },
  ],
  // Hub-level IMU readings, fed through as a pseudo-port so the customize and
  // visibility machinery is shared with the port sensors.
  motion: [
    { key: "up", label: "Up side", primary: true, format: (p) => (p.up ? titleCase(p.up) : null) },
    { key: "tilt", label: "Tilt", format: (p) => (fin(p.tilt?.[0]) ? `${p.tilt[0]}° / ${p.tilt[1]}°` : null) },
    { key: "heading", label: "Heading", format: (p) => (fin(p.heading) ? `${p.heading}°` : null) },
    { key: "stationary", label: "Still", format: (p) => (p.stationary === true ? "Yes" : p.stationary === false ? "No" : null) },
    { key: "accel", label: "Accel", format: (p) => (fin(p.acceleration?.[0]) ? p.acceleration.join(", ") : null) },
    { key: "gyro", label: "Gyro", format: (p) => (fin(p.angularVelocity?.[0]) ? p.angularVelocity.join(", ") : null) },
  ],
};

// Secondary readings shown by default — the "important stuff" that is on without
// the user touching anything. Everything else is opt-in via Customize readings.
const DEFAULT_SECONDARY = {
  motor: ["speed"],
  color: ["reflection"],
  force: ["pressed"],
  motion: ["tilt", "heading", "stationary"],
};

export function getKindMetrics(kind) {
  return KIND_METRICS[kind] || [];
}

export function getPrimaryReading(port) {
  if (!port || port.kind === "empty") return "Empty";
  const metric = getKindMetrics(port.kind).find((m) => m.primary);
  const value = metric?.format(port);
  if (value != null) return value;
  if (Array.isArray(port.value)) return port.value.join(", ");
  return port.device || "Connected";
}

// Metrics this specific port is reporting right now, excluding the primary.
// Used to build both the port card chips and the customize checkboxes so the UI
// only ever offers readings the attached sensor genuinely produces.
export function getAvailableSecondary(port) {
  if (!port || port.kind === "empty") return [];
  return getKindMetrics(port.kind)
    .filter((m) => !m.primary)
    .map((m) => ({ key: m.key, label: m.label, value: m.format(port) }))
    .filter((m) => m.value != null);
}

export function getVisibleSecondary(port, prefs) {
  const available = getAvailableSecondary(port);
  if (prefs?.showEverything) return available;
  const enabled = prefs?.byKind?.[port.kind] ?? DEFAULT_SECONDARY[port.kind] ?? [];
  return available.filter((m) => enabled.includes(m.key));
}

export function isSecondaryEnabled(prefs, kind, key) {
  if (prefs?.showEverything) return true;
  const enabled = prefs?.byKind?.[kind] ?? DEFAULT_SECONDARY[kind] ?? [];
  return enabled.includes(key);
}

export function toggleSecondary(prefs, kind, key) {
  const base = prefs?.byKind?.[kind] ?? DEFAULT_SECONDARY[kind] ?? [];
  const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
  return { ...prefs, byKind: { ...prefs?.byKind, [kind]: next } };
}

// A CSS color for the swatch. Live HSV is the most faithful; fall back to the
// reported color name so a swatch still renders before HSV settles.
const COLOR_NAMES = {
  RED: "#e3000b", ORANGE: "#f07d00", YELLOW: "#ffd500", GREEN: "#00a651",
  BLUE: "#0066b3", MAGENTA: "#cc0066", VIOLET: "#7b2d8e", CYAN: "#00b3b3",
  WHITE: "#f5f5f5", BLACK: "#1a1a1a", BROWN: "#7a4a1e", GRAY: "#9a9a9a",
};

function hsvToCss(h, s, v) {
  const sat = Math.min(1, Math.max(0, s / 100));
  const val = Math.min(1, Math.max(0, v / 100));
  const c = val * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = val - c;
  const seg = Math.floor((h % 360) / 60);
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg] || [0, 0, 0];
  const to255 = (n) => Math.round((n + m) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

export function getPortSwatch(port) {
  if (!port || port.kind !== "color") return null;
  const [h, s, v] = port.hsv || [];
  if (fin(h) && fin(s) && fin(v) && v > 0) return hsvToCss(h, s, v);
  if (port.color && port.color !== "NONE") return COLOR_NAMES[port.color] || null;
  return null;
}

const PREFS_STORAGE_KEY = "pycollab.hubReadings.v1";

export function loadReadingPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { showEverything: Boolean(parsed?.showEverything), byKind: parsed?.byKind || {} };
  } catch {
    return { showEverything: false, byKind: {} };
  }
}

export function saveReadingPrefs(prefs) {
  try {
    globalThis.localStorage?.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; a storage failure must never break readings.
  }
}

const NICKNAME_STORAGE_KEY = "pycollab.hubNicknames.v1";

function hubNicknameKey(hub) {
  return String(hub?.deviceName || hub?.hubType || "hub").trim().toLowerCase();
}

export function loadHubNickname(hub) {
  try {
    const raw = globalThis.localStorage?.getItem(NICKNAME_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map[hubNicknameKey(hub)] || "";
  } catch {
    return "";
  }
}

export function saveHubNickname(hub, nickname) {
  try {
    const raw = globalThis.localStorage?.getItem(NICKNAME_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const trimmed = String(nickname || "").trim();
    if (trimmed) map[hubNicknameKey(hub)] = trimmed;
    else delete map[hubNicknameKey(hub)];
    globalThis.localStorage?.setItem(NICKNAME_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Same rationale as preferences: never let storage break the UI.
  }
}
