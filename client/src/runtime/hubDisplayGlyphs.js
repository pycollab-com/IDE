// Pixel art for the hub's 5x5 light matrix: icon bitmaps, a compact 3x5 font,
// and helpers that turn them into either a static "draw" pattern or a scrolling
// marquee. The font lives here (JS) as the single source of truth — the hub-side
// scroller just animates the column values we send, so the on-screen preview and
// the real display stay pixel-identical.

// Each icon is five rows of five characters; '#' is lit.
export const ICON_BITMAPS = {
  HEART: [".#.#.", "#####", "#####", ".###.", "..#.."],
  HAPPY: [".....", ".#.#.", ".....", "#...#", ".###."],
  SAD: [".....", ".#.#.", ".....", ".###.", "#...#"],
  UP: ["..#..", ".###.", "#.#.#", "..#..", "..#.."],
  DOWN: ["..#..", "..#..", "#.#.#", ".###.", "..#.."],
  LEFT: ["..#..", ".#...", "#####", ".#...", "..#.."],
  RIGHT: ["..#..", "...#.", "#####", "...#.", "..#.."],
  TRUE: [".....", "....#", "...#.", "#.#..", ".#..."],
  FALSE: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  SQUARE: ["#####", "#...#", "#...#", "#...#", "#####"],
  CIRCLE: [".###.", "#...#", "#...#", "#...#", ".###."],
  PAUSE: [".#.#.", ".#.#.", ".#.#.", ".#.#.", ".#.#."],
};

export const ICON_NAMES = Object.keys(ICON_BITMAPS);

// Compact 3-wide x 5-tall font. Rows top to bottom, '#' lit.
const FONT = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  A: ["###", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: ["###", "#..", "#..", "#..", "###"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: ["###", "#..", "#.#", "#.#", "###"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["#.#", "###", "###", "###", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["###", "#.#", "###", "#..", "#.."],
  Q: ["###", "#.#", "#.#", "###", "..#"],
  R: ["###", "#.#", "##.", "#.#", "#.#"],
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "!": [".#.", ".#.", ".#.", "...", ".#."],
  "?": ["###", "..#", ".#.", "...", ".#."],
  ".": ["...", "...", "...", "...", ".#."],
  "-": ["...", "...", "###", "...", "..."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  ":": ["...", ".#.", "...", ".#.", "..."],
};

const SCROLL_ENCODE_BASE = 48; // column value 0-31 -> printable ASCII 48-79

// rows ('#'/'.') -> 25-length boolean array, row-major.
function rowsToCells(rows) {
  const cells = new Array(25).fill(false);
  for (let r = 0; r < 5; r++) {
    const row = rows[r] || "";
    for (let c = 0; c < 5; c++) cells[r * 5 + c] = row[c] === "#";
  }
  return cells;
}

export function iconBitmap(name) {
  const rows = ICON_BITMAPS[String(name || "").toUpperCase()];
  return rows ? rowsToCells(rows) : null;
}

// Single digit centred in the 5x5 (3-wide glyph with a one-pixel margin).
export function digitBitmap(digit) {
  const rows = FONT[String(digit)];
  if (!rows || rows[0].length !== 3) return null;
  const cells = new Array(25).fill(false);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) cells[r * 5 + (c + 1)] = rows[r][c] === "#";
  }
  return cells;
}

export function cellsToDrawString(cells) {
  return Array.from({ length: 25 }, (_, i) => (cells[i] ? "9" : "0")).join("");
}

export const isBlankCells = (cells) => !cells.some(Boolean);

// One glyph -> its column values (each 0-31, bit r = row r). Unknown -> blank.
function glyphColumns(ch) {
  if (ch === " ") return [0, 0];
  const rows = FONT[ch] || FONT[ch.toUpperCase()];
  if (!rows) return [0, 0, 0];
  const width = rows[0].length;
  const cols = [];
  for (let c = 0; c < width; c++) {
    let value = 0;
    for (let r = 0; r < 5; r++) if (rows[r][c] === "#") value |= 1 << r;
    cols.push(value);
  }
  return cols;
}

// Full message -> flat column list, one blank column between glyphs.
export function textColumns(text) {
  const chars = String(text || "").split("");
  const cols = [];
  chars.forEach((ch, index) => {
    cols.push(...glyphColumns(ch));
    if (index < chars.length - 1) cols.push(0);
  });
  return cols;
}

// Build the marquee: the local preview frames plus the compact wire encoding the
// hub-side scroller decodes. Both pad with five blank columns so the message
// scrolls in from the right and out to the left identically on screen and hub.
export function scrollFrames(text) {
  const cols = textColumns(text);
  const encoded = cols.map((value) => String.fromCharCode(SCROLL_ENCODE_BASE + (value & 31))).join("");
  const seq = [0, 0, 0, 0, 0, ...cols, 0, 0, 0, 0, 0];
  const frames = [];
  for (let i = 0; i + 5 <= seq.length; i++) {
    const cells = new Array(25).fill(false);
    for (let c = 0; c < 5; c++) {
      const value = seq[i + c];
      for (let r = 0; r < 5; r++) cells[r * 5 + c] = Boolean((value >> r) & 1);
    }
    frames.push(cells);
  }
  return { frames, encoded };
}
