const CONTEXT_ROW = "context";
const ADD_ROW = "add";
const REMOVE_ROW = "remove";
const COLLAPSED_ROW = "collapsed";
const MAX_MATRIX_CELLS = 250000;
const MAX_TOKEN_CELLS = 40000;
// Below this fraction of shared characters we treat a remove/add pair as an
// unrelated rewrite and skip word highlighting, which keeps the diff readable.
const MIN_WORD_DIFF_SIMILARITY = 0.25;

const normalizeText = (value) => (typeof value === "string" ? value : "");

const splitLines = (value) => {
  const normalized = normalizeText(value).replace(/\r\n?/g, "\n");
  return normalized === "" ? [] : normalized.split("\n");
};

const exceedsMatrixLimit = (beforeLines, afterLines) => beforeLines.length * afterLines.length > MAX_MATRIX_CELLS;

const buildLcsTable = (before, after, limit) => {
  if (before.length * after.length > limit) {
    return null;
  }

  const rowCount = before.length + 1;
  const columnCount = after.length + 1;
  const table = Array.from({ length: rowCount }, () => Array(columnCount).fill(0));

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      if (before[beforeIndex] === after[afterIndex]) {
        table[beforeIndex][afterIndex] = table[beforeIndex + 1][afterIndex + 1] + 1;
      } else {
        table[beforeIndex][afterIndex] = Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
      }
    }
  }

  return table;
};

const buildHeuristicRows = (beforeLines, afterLines) => {
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let beforeSuffixIndex = beforeLines.length - 1;
  let afterSuffixIndex = afterLines.length - 1;
  while (
    beforeSuffixIndex >= prefixLength &&
    afterSuffixIndex >= prefixLength &&
    beforeLines[beforeSuffixIndex] === afterLines[afterSuffixIndex]
  ) {
    beforeSuffixIndex -= 1;
    afterSuffixIndex -= 1;
  }

  const rows = [];

  for (let index = 0; index < prefixLength; index += 1) {
    rows.push({
      type: CONTEXT_ROW,
      oldNumber: index + 1,
      newNumber: index + 1,
      text: beforeLines[index],
    });
  }

  for (let index = prefixLength; index <= beforeSuffixIndex; index += 1) {
    rows.push({
      type: REMOVE_ROW,
      oldNumber: index + 1,
      newNumber: null,
      text: beforeLines[index],
    });
  }

  for (let index = prefixLength; index <= afterSuffixIndex; index += 1) {
    rows.push({
      type: ADD_ROW,
      oldNumber: null,
      newNumber: index + 1,
      text: afterLines[index],
    });
  }

  const suffixLength = beforeLines.length - (beforeSuffixIndex + 1);
  for (let offset = 0; offset < suffixLength; offset += 1) {
    const oldIndex = beforeSuffixIndex + 1 + offset;
    const newIndex = afterSuffixIndex + 1 + offset;
    rows.push({
      type: CONTEXT_ROW,
      oldNumber: oldIndex + 1,
      newNumber: newIndex + 1,
      text: beforeLines[oldIndex],
    });
  }

  return rows;
};

const buildLineRows = (beforeLines, afterLines) => {
  const lcsTable = buildLcsTable(beforeLines, afterLines, MAX_MATRIX_CELLS);
  if (!lcsTable) {
    return buildHeuristicRows(beforeLines, afterLines);
  }

  const rows = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex];
    const afterLine = afterLines[afterIndex];

    if (beforeIndex < beforeLines.length && afterIndex < afterLines.length && beforeLine === afterLine) {
      rows.push({ type: CONTEXT_ROW, oldNumber: beforeIndex + 1, newNumber: afterIndex + 1, text: beforeLine });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const nextBeforeScore = beforeIndex < beforeLines.length ? lcsTable[beforeIndex + 1][afterIndex] : -1;
    const nextAfterScore = afterIndex < afterLines.length ? lcsTable[beforeIndex][afterIndex + 1] : -1;

    if (afterIndex < afterLines.length && (beforeIndex === beforeLines.length || nextAfterScore > nextBeforeScore)) {
      rows.push({ type: ADD_ROW, oldNumber: null, newNumber: afterIndex + 1, text: afterLine });
      afterIndex += 1;
      continue;
    }

    rows.push({ type: REMOVE_ROW, oldNumber: beforeIndex + 1, newNumber: null, text: beforeLine });
    beforeIndex += 1;
  }

  return rows;
};

// ── Word-level (intra-line) diff ──────────────────────────────────────────
// Splits into words, whitespace runs, and individual symbols so a single
// changed identifier or operator lights up instead of the whole line.
const tokenize = (text) => text.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g) || [];

const coalesceSegments = (segments) => {
  const merged = [];
  segments.forEach((segment) => {
    const last = merged[merged.length - 1];
    if (last && last.changed === segment.changed) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  });
  return merged;
};

const diffTokens = (beforeText, afterText) => {
  const beforeTokens = tokenize(beforeText);
  const afterTokens = tokenize(afterText);
  const table = buildLcsTable(beforeTokens, afterTokens, MAX_TOKEN_CELLS);
  if (!table) return null;

  const before = [];
  const after = [];
  let sharedLength = 0;
  let i = 0;
  let j = 0;

  while (i < beforeTokens.length || j < afterTokens.length) {
    if (i < beforeTokens.length && j < afterTokens.length && beforeTokens[i] === afterTokens[j]) {
      before.push({ text: beforeTokens[i], changed: false });
      after.push({ text: afterTokens[j], changed: false });
      sharedLength += beforeTokens[i].length;
      i += 1;
      j += 1;
      continue;
    }

    const nextBeforeScore = i < beforeTokens.length ? table[i + 1][j] : -1;
    const nextAfterScore = j < afterTokens.length ? table[i][j + 1] : -1;

    if (j < afterTokens.length && (i === beforeTokens.length || nextAfterScore > nextBeforeScore)) {
      after.push({ text: afterTokens[j], changed: true });
      j += 1;
    } else {
      before.push({ text: beforeTokens[i], changed: true });
      i += 1;
    }
  }

  const longest = Math.max(beforeText.length, afterText.length, 1);
  if (sharedLength / longest < MIN_WORD_DIFF_SIMILARITY) {
    return null;
  }

  return { before: coalesceSegments(before), after: coalesceSegments(after) };
};

// Pair each removed line with the added line that replaced it and attach the
// word-level segments to both, so modified lines show exactly what changed.
const annotateWordDiffs = (rows) => {
  let index = 0;
  while (index < rows.length) {
    if (rows[index].type !== REMOVE_ROW) {
      index += 1;
      continue;
    }

    let removeEnd = index;
    while (removeEnd < rows.length && rows[removeEnd].type === REMOVE_ROW) removeEnd += 1;
    let addEnd = removeEnd;
    while (addEnd < rows.length && rows[addEnd].type === ADD_ROW) addEnd += 1;

    const removes = rows.slice(index, removeEnd);
    const adds = rows.slice(removeEnd, addEnd);
    const pairCount = Math.min(removes.length, adds.length);

    for (let pair = 0; pair < pairCount; pair += 1) {
      const segments = diffTokens(removes[pair].text, adds[pair].text);
      if (segments) {
        removes[pair].segments = segments.before;
        adds[pair].segments = segments.after;
      }
    }

    index = addEnd > index ? addEnd : index + 1;
  }
  return rows;
};

const collapseContextRows = (rows, contextLines) => {
  const collapsed = [];
  let run = [];

  const flushRun = () => {
    if (!run.length) return;

    if (run.length <= contextLines * 2 + 1) {
      collapsed.push(...run);
    } else {
      collapsed.push(...run.slice(0, contextLines));
      collapsed.push({
        type: COLLAPSED_ROW,
        count: run.length - contextLines * 2,
        rows: run.slice(contextLines, run.length - contextLines),
      });
      collapsed.push(...run.slice(-contextLines));
    }

    run = [];
  };

  rows.forEach((row) => {
    if (row.type === CONTEXT_ROW) {
      run.push(row);
      return;
    }
    flushRun();
    collapsed.push(row);
  });

  flushRun();
  return collapsed;
};

export const CHECKPOINT_FILE_STATUS_LABELS = {
  modified: "Modified",
  added: "Added since checkpoint",
  deleted: "Deleted since checkpoint",
  unchanged: "Unchanged",
};

export const CHECKPOINT_FILE_STATUS_TONES = {
  modified: "modified",
  added: "added",
  deleted: "deleted",
  unchanged: "unchanged",
};

export const buildCheckpointDiffRows = (snapshotContent, currentContent, options = {}) => {
  const contextLines = Number.isInteger(options.contextLines) ? Math.max(1, options.contextLines) : 3;
  const beforeLines = splitLines(snapshotContent);
  const afterLines = splitLines(currentContent);

  if (!beforeLines.length && !afterLines.length) {
    return [];
  }

  const rows = buildLineRows(beforeLines, afterLines);
  if (options.intraLine !== false) {
    annotateWordDiffs(rows);
  }
  return collapseContextRows(rows, contextLines);
};

// Counts only changed lines; collapsed rows hold context, so they never count.
export const summarizeDiffRows = (rows) => {
  let additions = 0;
  let removals = 0;
  rows.forEach((row) => {
    if (row.type === ADD_ROW) additions += 1;
    else if (row.type === REMOVE_ROW) removals += 1;
  });
  return { additions, removals };
};

const toSplitSide = (row) =>
  row ? { number: row.type === ADD_ROW ? row.newNumber : row.oldNumber, text: row.text, segments: row.segments } : null;

// Reshapes the unified rows into aligned left (checkpoint) / right (current)
// pairs for the side-by-side view.
export const toSplitRows = (rows) => {
  const split = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];

    if (row.type === COLLAPSED_ROW) {
      split.push(row);
      index += 1;
      continue;
    }

    if (row.type === CONTEXT_ROW) {
      split.push({
        type: CONTEXT_ROW,
        left: { number: row.oldNumber, text: row.text },
        right: { number: row.newNumber, text: row.text },
      });
      index += 1;
      continue;
    }

    const removes = [];
    while (index < rows.length && rows[index].type === REMOVE_ROW) {
      removes.push(rows[index]);
      index += 1;
    }
    const adds = [];
    while (index < rows.length && rows[index].type === ADD_ROW) {
      adds.push(rows[index]);
      index += 1;
    }

    const pairs = Math.max(removes.length, adds.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      split.push({ type: "change", left: toSplitSide(removes[pair]), right: toSplitSide(adds[pair]) });
    }
  }

  return split;
};
