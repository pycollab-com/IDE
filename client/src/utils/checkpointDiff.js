const CONTEXT_ROW = "context";
const ADD_ROW = "add";
const REMOVE_ROW = "remove";
const COLLAPSED_ROW = "collapsed";
const MAX_MATRIX_CELLS = 250000;

const normalizeText = (value) => (typeof value === "string" ? value : "");

const splitLines = (value) => {
  const normalized = normalizeText(value).replace(/\r\n?/g, "\n");
  return normalized === "" ? [] : normalized.split("\n");
};

const exceedsMatrixLimit = (beforeLines, afterLines) => beforeLines.length * afterLines.length > MAX_MATRIX_CELLS;

const buildLcsTable = (beforeLines, afterLines) => {
  if (exceedsMatrixLimit(beforeLines, afterLines)) {
    return null;
  }

  const rowCount = beforeLines.length + 1;
  const columnCount = afterLines.length + 1;
  const table = Array.from({ length: rowCount }, () => Array(columnCount).fill(0));

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
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

  if (exceedsMatrixLimit(beforeLines, afterLines)) {
    return collapseContextRows(buildHeuristicRows(beforeLines, afterLines), contextLines);
  }

  const lcsTable = buildLcsTable(beforeLines, afterLines);
  if (!lcsTable) {
    return collapseContextRows(buildHeuristicRows(beforeLines, afterLines), contextLines);
  }
  const rows = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex];
    const afterLine = afterLines[afterIndex];

    if (
      beforeIndex < beforeLines.length &&
      afterIndex < afterLines.length &&
      beforeLine === afterLine
    ) {
      rows.push({
        type: CONTEXT_ROW,
        oldNumber: beforeIndex + 1,
        newNumber: afterIndex + 1,
        text: beforeLine,
      });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const nextBeforeScore = beforeIndex < beforeLines.length ? lcsTable[beforeIndex + 1][afterIndex] : -1;
    const nextAfterScore = afterIndex < afterLines.length ? lcsTable[beforeIndex][afterIndex + 1] : -1;

    if (afterIndex < afterLines.length && (beforeIndex === beforeLines.length || nextAfterScore > nextBeforeScore)) {
      rows.push({
        type: ADD_ROW,
        oldNumber: null,
        newNumber: afterIndex + 1,
        text: afterLine,
      });
      afterIndex += 1;
      continue;
    }

    rows.push({
      type: REMOVE_ROW,
      oldNumber: beforeIndex + 1,
      newNumber: null,
      text: beforeLine,
    });
    beforeIndex += 1;
  }

  return collapseContextRows(rows, contextLines);
};
