import test from "node:test";
import assert from "node:assert/strict";
import {
  ICON_NAMES,
  iconBitmap,
  digitBitmap,
  cellsToDrawString,
  isBlankCells,
  textColumns,
  scrollFrames,
} from "./hubDisplayGlyphs.js";

test("cellsToDrawString encodes 25 pixels as brightness 9/0", () => {
  const cells = Array(25).fill(false);
  cells[0] = true;
  cells[24] = true;
  const drawn = cellsToDrawString(cells);
  assert.equal(drawn.length, 25);
  assert.equal(drawn[0], "9");
  assert.equal(drawn[24], "9");
  assert.equal(drawn[1], "0");
});

test("iconBitmap returns a lit 25-pixel grid for known icons, null otherwise", () => {
  for (const name of ICON_NAMES) {
    const cells = iconBitmap(name);
    assert.equal(cells.length, 25, `${name} should be 25 cells`);
    assert.ok(cells.some(Boolean), `${name} should light some pixels`);
  }
  assert.equal(iconBitmap("NOT_AN_ICON"), null);
});

test("digitBitmap centres a 3-wide glyph with blank margins", () => {
  const two = digitBitmap("2");
  assert.equal(two.length, 25);
  assert.ok(two.some(Boolean));
  // Columns 0 and 4 are the one-pixel margins and stay dark.
  for (let r = 0; r < 5; r++) {
    assert.equal(two[r * 5 + 0], false, "left margin lit");
    assert.equal(two[r * 5 + 4], false, "right margin lit");
  }
});

test("isBlankCells detects an empty grid", () => {
  assert.equal(isBlankCells(Array(25).fill(false)), true);
  const one = Array(25).fill(false);
  one[12] = true;
  assert.equal(isBlankCells(one), false);
});

test("textColumns inserts one blank column between glyphs", () => {
  const a = textColumns("A");
  const b = textColumns("B");
  const ab = textColumns("AB");
  assert.equal(ab.length, a.length + 1 + b.length);
});

test("scrollFrames pads, encodes in range, and stays in sync with the wire format", () => {
  const { frames, encoded } = scrollFrames("HI");
  const cols = textColumns("HI");

  // The encoding is one printable char per column, decodable as value 0-31.
  assert.equal(encoded.length, cols.length);
  for (let i = 0; i < encoded.length; i++) {
    const value = encoded.charCodeAt(i) - 48;
    assert.ok(value >= 0 && value <= 31, "column value out of range");
    assert.equal(value, cols[i] & 31);
  }

  // Five blank columns of lead-in, so the first frame is dark and frames cover
  // the whole padded sequence (cols + 2x5 padding, minus the 5-wide window + 1).
  assert.equal(frames.length, cols.length + 10 - 4);
  assert.equal(frames[0].length, 25);
  assert.ok(isBlankCells(frames[0]), "marquee should scroll in from blank");
});
