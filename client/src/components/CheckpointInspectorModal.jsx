import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FiChevronDown,
  FiChevronUp,
  FiClock,
  FiColumns,
  FiCornerUpLeft,
  FiList,
  FiRefreshCw,
  FiSearch,
  FiX,
} from "react-icons/fi";
import {
  buildCheckpointDiffRows,
  CHECKPOINT_FILE_STATUS_LABELS,
  CHECKPOINT_FILE_STATUS_TONES,
  summarizeDiffRows,
  toSplitRows,
} from "../utils/checkpointDiff";

const formatSnapshotTime = (value) => {
  if (!value) return "Unknown time";
  try {
    return new Date(value).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const STATUS_GLYPH = { modified: "±", added: "+", deleted: "−", unchanged: "•" };

const Stat = ({ additions, removals }) => {
  if (!additions && !removals) return <span className="ci-stat-none">no line changes</span>;
  return (
    <span className="ci-stat">
      {additions > 0 && <span className="ci-stat-add">+{additions}</span>}
      {removals > 0 && <span className="ci-stat-remove">−{removals}</span>}
    </span>
  );
};

// Renders one line of code, highlighting the exact words that changed.
const LineText = ({ text, segments, emphasis }) => {
  if (!segments) {
    return <code className="ci-code">{text === "" ? " " : text}</code>;
  }
  return (
    <code className="ci-code">
      {segments.map((segment, index) =>
        segment.changed ? (
          <mark key={index} className={`ci-word ci-word-${emphasis}`}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </code>
  );
};

export default function CheckpointInspectorModal({
  open,
  snapshot,
  inspection,
  loading,
  loadError,
  canEdit,
  restoreBusy,
  onClose,
  onRefresh,
  onRestoreFull,
  onRestoreSelected,
}) {
  const [activeFileName, setActiveFileName] = useState("");
  const [selectedFileNames, setSelectedFileNames] = useState([]);
  const [viewMode, setViewMode] = useState("unified");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [expandedCollapses, setExpandedCollapses] = useState(() => new Set());
  const diffScrollRef = useRef(null);

  const files = useMemo(() => inspection?.files || [], [inspection?.files]);

  // Per-file +/- line counts, plus a project-wide total for the summary bar.
  const statsByFile = useMemo(() => {
    const map = new Map();
    files.forEach((entry) => {
      if (entry.status === "unchanged") {
        map.set(entry.file_name, { additions: 0, removals: 0 });
        return;
      }
      const rows = buildCheckpointDiffRows(entry.snapshot_content, entry.current_content, { intraLine: false });
      map.set(entry.file_name, summarizeDiffRows(rows));
    });
    return map;
  }, [files]);

  const totals = useMemo(() => {
    let additions = 0;
    let removals = 0;
    statsByFile.forEach((value) => {
      additions += value.additions;
      removals += value.removals;
    });
    return { additions, removals };
  }, [statsByFile]);

  const changedFiles = useMemo(() => files.filter((entry) => entry.status !== "unchanged"), [files]);
  const unchangedCount = files.length - changedFiles.length;

  const visibleFiles = useMemo(() => {
    const base = showUnchanged ? files : changedFiles;
    const query = fileQuery.trim().toLowerCase();
    if (!query) return base;
    return base.filter((entry) => entry.file_name.toLowerCase().includes(query));
  }, [files, changedFiles, showUnchanged, fileQuery]);

  useEffect(() => {
    if (!open || !files.length) {
      setSelectedFileNames([]);
      setActiveFileName("");
      return;
    }
    setSelectedFileNames([]);
    const firstChangedFile = files.find((entry) => entry.status !== "unchanged");
    setActiveFileName((current) => {
      if (current && files.some((entry) => entry.file_name === current)) return current;
      return (firstChangedFile || files[0]).file_name;
    });
  }, [open, snapshot?.id, files]);

  useEffect(() => {
    setExpandedCollapses(new Set());
    if (diffScrollRef.current) diffScrollRef.current.scrollTop = 0;
  }, [activeFileName, viewMode]);

  const activeFile = useMemo(
    () => files.find((entry) => entry.file_name === activeFileName) || files[0] || null,
    [activeFileName, files]
  );

  const diffRows = useMemo(() => {
    if (!activeFile) return [];
    return buildCheckpointDiffRows(activeFile.snapshot_content, activeFile.current_content, { contextLines: 3 });
  }, [activeFile]);

  const splitRows = useMemo(() => toSplitRows(diffRows), [diffRows]);
  const activeStats = activeFile ? statsByFile.get(activeFile.file_name) || { additions: 0, removals: 0 } : null;
  const changeCount = (activeStats?.additions || 0) + (activeStats?.removals || 0);

  const selectedFiles = useMemo(
    () => files.filter((entry) => selectedFileNames.includes(entry.file_name)),
    [files, selectedFileNames]
  );
  const selectedHasAddedFiles = selectedFiles.some((entry) => entry.status === "added");

  const toggleSelectedFile = (fileName) => {
    setSelectedFileNames((current) =>
      current.includes(fileName) ? current.filter((entry) => entry !== fileName) : [...current, fileName]
    );
  };

  const toggleCollapse = (key) => {
    setExpandedCollapses((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Scroll the diff so the next/previous changed block lands near the top.
  const jumpToChange = useCallback((direction) => {
    const container = diffScrollRef.current;
    if (!container) return;
    const blocks = Array.from(container.querySelectorAll("[data-change-block='true']"));
    if (!blocks.length) return;
    const current = container.scrollTop;
    const tops = blocks.map((node) => node.offsetTop);
    let target;
    if (direction > 0) {
      target = tops.find((top) => top > current + 4);
      if (target == null) target = tops[0];
    } else {
      const before = tops.filter((top) => top < current - 4);
      target = before.length ? before[before.length - 1] : tops[tops.length - 1];
    }
    container.scrollTo({ top: Math.max(0, target - 12), behavior: "smooth" });
  }, []);

  const handleRestoreFull = () => {
    if (!snapshot || restoreBusy) return;
    const confirmed = window.confirm(
      `Restoring this checkpoint will replace the current project files with the checkpoint version. Current changes may be lost unless another checkpoint is created first.\n\nA safety checkpoint will be created automatically before restore.\n\nRestore "${snapshot.name}" now?`
    );
    if (!confirmed) return;
    onRestoreFull?.();
  };

  const handleRestoreSelection = (fileNames, entries) => {
    if (!fileNames.length || restoreBusy) return;
    const includesAddedFiles = entries.some((entry) => entry.status === "added");
    if (includesAddedFiles) {
      const confirmedDeletion = window.confirm(
        "One or more selected files were added after this checkpoint. Restoring them will delete those files from the current project. Continue?"
      );
      if (!confirmedDeletion) return;
    }
    onRestoreSelected?.(fileNames, { allowAddedFileDeletions: includesAddedFiles });
  };

  const handleRestoreActiveFile = () => {
    if (!activeFile) return;
    handleRestoreSelection([activeFile.file_name], [activeFile]);
  };

  const renderUnifiedRow = (row, key) => {
    const emphasis = row.type === "add" ? "add" : "remove";
    return (
      <div key={key} className={`ci-row ci-row-${row.type}`} data-change-block={row.type !== "context" || undefined}>
        <span className="ci-gutter">{row.oldNumber || ""}</span>
        <span className="ci-gutter">{row.newNumber || ""}</span>
        <span className="ci-marker">{row.type === "add" ? "+" : row.type === "remove" ? "−" : ""}</span>
        <LineText text={row.text} segments={row.segments} emphasis={emphasis} />
      </div>
    );
  };

  const renderSplitSide = (side, kind) => {
    const filled = side != null;
    return (
      <>
        <span className="ci-gutter">{filled ? side.number || "" : ""}</span>
        <span className={`ci-split-cell ${filled ? "" : "ci-split-empty"}`}>
          {filled ? <LineText text={side.text} segments={side.segments} emphasis={kind} /> : null}
        </span>
      </>
    );
  };

  const renderSplitRow = (row, key) => {
    if (row.type === "context") {
      return (
        <div key={key} className="ci-srow ci-srow-context">
          {renderSplitSide(row.left, "context")}
          {renderSplitSide(row.right, "context")}
        </div>
      );
    }
    return (
      <div key={key} className="ci-srow ci-srow-change" data-change-block="true">
        <div className={`ci-split-pane ${row.left ? "ci-pane-remove" : "ci-pane-blank"}`}>
          {renderSplitSide(row.left, "remove")}
        </div>
        <div className={`ci-split-pane ${row.right ? "ci-pane-add" : "ci-pane-blank"}`}>
          {renderSplitSide(row.right, "add")}
        </div>
      </div>
    );
  };

  const renderCollapse = (row, key) => {
    const isExpanded = expandedCollapses.has(key);
    if (isExpanded) {
      const isSplit = viewMode === "split";
      return (
        <div key={key}>
          <button type="button" className="ci-collapse ci-collapse-open" onClick={() => toggleCollapse(key)}>
            <FiChevronUp size={13} />
            Hide {row.count} unchanged {row.count === 1 ? "line" : "lines"}
          </button>
          {row.rows.map((hidden, hiddenIndex) =>
            isSplit
              ? renderSplitRow(
                  {
                    type: "context",
                    left: { number: hidden.oldNumber, text: hidden.text },
                    right: { number: hidden.newNumber, text: hidden.text },
                  },
                  `${key}-h-${hiddenIndex}`
                )
              : renderUnifiedRow(hidden, `${key}-h-${hiddenIndex}`)
          )}
        </div>
      );
    }
    return (
      <button key={key} type="button" className="ci-collapse" onClick={() => toggleCollapse(key)}>
        <FiChevronDown size={13} />
        Show {row.count} unchanged {row.count === 1 ? "line" : "lines"}
      </button>
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !restoreBusy && onClose?.()}
        >
          <motion.div
            className="ci-modal"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16 }}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="ci-header">
              <div className="ci-header-main">
                <div className="ci-eyebrow">Checkpoint diff</div>
                <h2 className="ci-title">{snapshot?.name || "Checkpoint"}</h2>
                <div className="ci-meta">
                  <span className="ci-meta-item">{snapshot?.created_by_name || "Unknown author"}</span>
                  <span className="ci-meta-dot" />
                  <span className="ci-meta-item">
                    <FiClock size={12} />
                    {formatSnapshotTime(snapshot?.created_at)}
                  </span>
                  <span className="ci-meta-dot" />
                  <span className="ci-meta-item">
                    <span className="ci-stat-add">+{totals.additions}</span>
                    <span className="ci-stat-remove">−{totals.removals}</span>
                    across {changedFiles.length} {changedFiles.length === 1 ? "file" : "files"}
                  </span>
                  {!canEdit && <span className="ci-badge-view">View only</span>}
                </div>
              </div>
              <div className="ci-header-actions">
                <button className="btn btn-ghost ci-refresh" onClick={onRefresh} disabled={loading || restoreBusy}>
                  <FiRefreshCw size={14} className={loading ? "ci-spin" : ""} />
                  Refresh
                </button>
                <button className="btn-ghost modal-close" onClick={() => onClose?.()} disabled={restoreBusy} title="Close">
                  <FiX size={18} />
                </button>
              </div>
            </header>

            {loadError && <div className="ci-banner error">{loadError}</div>}
            {!loadError && !canEdit && (
              <div className="ci-banner">
                You can inspect this checkpoint, but only collaborators with edit access can restore files.
              </div>
            )}

            <div className="ci-body">
              <aside className="ci-sidebar">
                <div className="ci-sidebar-search">
                  <FiSearch size={14} />
                  <input
                    type="text"
                    value={fileQuery}
                    onChange={(event) => setFileQuery(event.target.value)}
                    placeholder="Filter files"
                    aria-label="Filter files"
                  />
                </div>

                <div className="ci-sidebar-toolbar">
                  <span className="ci-sidebar-count">
                    {changedFiles.length} changed
                    {unchangedCount > 0 && (
                      <button
                        type="button"
                        className={`ci-link ${showUnchanged ? "active" : ""}`}
                        onClick={() => setShowUnchanged((value) => !value)}
                      >
                        {showUnchanged ? "Hide" : "Show"} {unchangedCount} unchanged
                      </button>
                    )}
                  </span>
                  {canEdit && (
                    <div className="ci-sidebar-select">
                      <button
                        type="button"
                        className="ci-link"
                        onClick={() => setSelectedFileNames(changedFiles.map((entry) => entry.file_name))}
                        disabled={!changedFiles.length || restoreBusy || loading}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="ci-link"
                        onClick={() => setSelectedFileNames([])}
                        disabled={!selectedFileNames.length || restoreBusy}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                <div className="ci-file-list">
                  {loading && <div className="ci-empty">Loading checkpoint comparison…</div>}
                  {!loading && visibleFiles.length === 0 && (
                    <div className="ci-empty">
                      {files.length === 0 ? "This checkpoint has no files to inspect." : "No files match this filter."}
                    </div>
                  )}
                  {!loading &&
                    visibleFiles.map((entry) => {
                      const isActive = activeFile?.file_name === entry.file_name;
                      const isSelected = selectedFileNames.includes(entry.file_name);
                      const tone = CHECKPOINT_FILE_STATUS_TONES[entry.status] || "unchanged";
                      const stats = statsByFile.get(entry.file_name) || { additions: 0, removals: 0 };
                      return (
                        <div key={entry.file_name} className={`ci-file ${isActive ? "active" : ""}`}>
                          {canEdit && (
                            <input
                              type="checkbox"
                              className="ci-file-check"
                              aria-label={`Select ${entry.file_name}`}
                              checked={isSelected}
                              onChange={() => toggleSelectedFile(entry.file_name)}
                              disabled={restoreBusy}
                            />
                          )}
                          <button
                            type="button"
                            className="ci-file-button"
                            onClick={() => setActiveFileName(entry.file_name)}
                            title={`${entry.file_name} — ${CHECKPOINT_FILE_STATUS_LABELS[entry.status] || entry.status}`}
                          >
                            <span className={`ci-file-glyph tone-${tone}`}>{STATUS_GLYPH[entry.status] || "•"}</span>
                            <span className="ci-file-name">{entry.file_name}</span>
                            <Stat additions={stats.additions} removals={stats.removals} />
                          </button>
                        </div>
                      );
                    })}
                </div>
              </aside>

              <section className="ci-diff">
                {activeFile ? (
                  <>
                    <div className="ci-diff-toolbar">
                      <div className="ci-diff-file">
                        <span className={`ci-file-glyph tone-${CHECKPOINT_FILE_STATUS_TONES[activeFile.status] || "unchanged"}`}>
                          {STATUS_GLYPH[activeFile.status] || "•"}
                        </span>
                        <div className="ci-diff-file-text">
                          <div className="ci-diff-path">{activeFile.file_name}</div>
                          <div className="ci-diff-sub">
                            {CHECKPOINT_FILE_STATUS_LABELS[activeFile.status] || activeFile.status}
                            {activeStats && (activeStats.additions > 0 || activeStats.removals > 0) && (
                              <>
                                {" · "}
                                <Stat additions={activeStats.additions} removals={activeStats.removals} />
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="ci-diff-controls">
                        {changeCount > 0 && (
                          <div className="ci-nav">
                            <button type="button" title="Previous change" onClick={() => jumpToChange(-1)}>
                              <FiChevronUp size={15} />
                            </button>
                            <button type="button" title="Next change" onClick={() => jumpToChange(1)}>
                              <FiChevronDown size={15} />
                            </button>
                          </div>
                        )}
                        <div className="ci-toggle" role="group" aria-label="Diff view mode">
                          <button
                            type="button"
                            className={viewMode === "unified" ? "active" : ""}
                            onClick={() => setViewMode("unified")}
                            title="Unified view"
                          >
                            <FiList size={14} /> Unified
                          </button>
                          <button
                            type="button"
                            className={viewMode === "split" ? "active" : ""}
                            onClick={() => setViewMode("split")}
                            title="Side-by-side view"
                          >
                            <FiColumns size={14} /> Split
                          </button>
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn-secondary ci-restore-file"
                            onClick={handleRestoreActiveFile}
                            disabled={restoreBusy}
                          >
                            <FiCornerUpLeft size={14} />
                            {restoreBusy ? "Restoring…" : "Restore file"}
                          </button>
                        )}
                      </div>
                    </div>

                    {viewMode === "split" && (
                      <div className="ci-split-head">
                        <span>Checkpoint</span>
                        <span>Current</span>
                      </div>
                    )}

                    <div className={`ci-diff-scroll ${viewMode === "split" ? "is-split" : ""}`} ref={diffScrollRef}>
                      {diffRows.length === 0 ? (
                        <div className="ci-empty">No content differences in this file.</div>
                      ) : viewMode === "split" ? (
                        splitRows.map((row, index) =>
                          row.type === "collapsed"
                            ? renderCollapse(row, `${activeFileName}|c|${index}`)
                            : renderSplitRow(row, `s-${index}`)
                        )
                      ) : (
                        diffRows.map((row, index) =>
                          row.type === "collapsed"
                            ? renderCollapse(row, `${activeFileName}|c|${index}`)
                            : renderUnifiedRow(row, `u-${index}`)
                        )
                      )}
                    </div>
                  </>
                ) : (
                  <div className="ci-empty">Select a file to preview its diff.</div>
                )}
              </section>
            </div>

            <footer className="ci-footer">
              <div className="ci-footer-copy">
                {selectedFileNames.length > 0
                  ? `${selectedFileNames.length} file${selectedFileNames.length === 1 ? "" : "s"} selected for restore`
                  : "Tick files in the list to restore only those, or restore the whole checkpoint."}
                {selectedHasAddedFiles && (
                  <span className="ci-footer-warning">Selected files added after this checkpoint will be deleted.</span>
                )}
              </div>
              {canEdit && (
                <div className="ci-footer-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleRestoreSelection(selectedFileNames, selectedFiles)}
                    disabled={!selectedFileNames.length || restoreBusy}
                  >
                    {restoreBusy ? "Restoring…" : "Restore selected"}
                  </button>
                  <button className="btn btn-primary" onClick={handleRestoreFull} disabled={loading || restoreBusy}>
                    {restoreBusy ? "Restoring…" : "Restore full checkpoint"}
                  </button>
                </div>
              )}
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
