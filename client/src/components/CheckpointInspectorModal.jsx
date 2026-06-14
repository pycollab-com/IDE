import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiClock, FiRefreshCw, FiX } from "react-icons/fi";
import {
  buildCheckpointDiffRows,
  CHECKPOINT_FILE_STATUS_LABELS,
  CHECKPOINT_FILE_STATUS_TONES,
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

  const files = useMemo(() => inspection?.files || [], [inspection?.files]);

  useEffect(() => {
    if (!open) {
      setSelectedFileNames([]);
      setActiveFileName("");
      return;
    }

    if (!files.length) {
      setSelectedFileNames([]);
      setActiveFileName("");
      return;
    }

    setSelectedFileNames([]);
    const firstChangedFile = files.find((entry) => entry.status !== "unchanged");
    setActiveFileName((current) => {
      if (current && files.some((entry) => entry.file_name === current)) {
        return current;
      }
      return (firstChangedFile || files[0]).file_name;
    });
  }, [open, snapshot?.id, files]);

  const activeFile = useMemo(
    () => files.find((entry) => entry.file_name === activeFileName) || files[0] || null,
    [activeFileName, files]
  );

  const diffRows = useMemo(() => {
    if (!activeFile) return [];
    return buildCheckpointDiffRows(activeFile.snapshot_content, activeFile.current_content, { contextLines: 3 });
  }, [activeFile]);

  const changedFiles = useMemo(
    () => files.filter((entry) => entry.status !== "unchanged"),
    [files]
  );

  const selectedFiles = useMemo(
    () => files.filter((entry) => selectedFileNames.includes(entry.file_name)),
    [files, selectedFileNames]
  );

  const selectedHasAddedFiles = selectedFiles.some((entry) => entry.status === "added");

  const toggleSelectedFile = (fileName) => {
    setSelectedFileNames((current) =>
      current.includes(fileName)
        ? current.filter((entry) => entry !== fileName)
        : [...current, fileName]
    );
  };

  const selectChangedFiles = () => {
    setSelectedFileNames(changedFiles.map((entry) => entry.file_name));
  };

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
    onRestoreSelected?.(fileNames, {
      allowAddedFileDeletions: includesAddedFiles,
    });
  };

  const handleRestoreActiveFile = () => {
    if (!activeFile) return;
    handleRestoreSelection([activeFile.file_name], [activeFile]);
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
            className="panel modal-card checkpoint-inspector-modal"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="checkpoint-inspector-header">
              <div>
                <div className="panel-title">Checkpoint Inspector</div>
                <div className="checkpoint-inspector-title">{snapshot?.name || "Checkpoint"}</div>
              </div>
              <div className="checkpoint-inspector-header-actions">
                <button
                  className="btn btn-ghost checkpoint-inspector-refresh"
                  onClick={onRefresh}
                  disabled={loading || restoreBusy}
                  title="Refresh checkpoint comparison"
                >
                  <FiRefreshCw size={14} />
                  Refresh
                </button>
                <button
                  className="btn-ghost modal-close"
                  onClick={() => onClose?.()}
                  disabled={restoreBusy}
                  title="Close"
                >
                  <FiX size={18} />
                </button>
              </div>
            </div>

            <div className="checkpoint-inspector-meta">
              <span className="checkpoint-inspector-chip">{snapshot?.created_by_name || "Unknown author"}</span>
              <span className="checkpoint-inspector-chip">
                <FiClock size={12} />
                {formatSnapshotTime(snapshot?.created_at)}
              </span>
              <span className="checkpoint-inspector-chip">{inspection?.changed_file_count || 0} changed</span>
              <span className="checkpoint-inspector-chip">{files.length} total files</span>
              {!canEdit && <span className="checkpoint-inspector-chip muted">View only</span>}
            </div>

            {loadError && <div className="checkpoint-inspector-banner error">{loadError}</div>}
            {!loadError && !canEdit && (
              <div className="checkpoint-inspector-banner">
                You can inspect this checkpoint, but only collaborators with edit access can restore files.
              </div>
            )}

            <div className="checkpoint-inspector-layout">
              <div className="checkpoint-inspector-sidebar">
                <div className="checkpoint-inspector-sidebar-header">
                  <span className="es-section-label">Files</span>
                  <div className="checkpoint-inspector-sidebar-actions">
                    {canEdit && (
                      <>
                        <button
                          className="es-task-filter"
                          onClick={selectChangedFiles}
                          disabled={!changedFiles.length || restoreBusy || loading}
                        >
                          Select changed
                        </button>
                        <button
                          className="es-task-filter"
                          onClick={() => setSelectedFileNames([])}
                          disabled={!selectedFileNames.length || restoreBusy}
                        >
                          Clear
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="checkpoint-inspector-file-list">
                  {!loading &&
                    files.map((entry) => {
                      const isActive = activeFile?.file_name === entry.file_name;
                      const isSelected = selectedFileNames.includes(entry.file_name);
                      const tone = CHECKPOINT_FILE_STATUS_TONES[entry.status] || "unchanged";
                      return (
                        <div
                          key={entry.file_name}
                          className={`checkpoint-inspector-file ${isActive ? "active" : ""}`}
                        >
                          {canEdit && (
                            <label className="checkpoint-inspector-checkbox">
                              <input
                                type="checkbox"
                                aria-label={`Select ${entry.file_name}`}
                                checked={isSelected}
                                onChange={() => toggleSelectedFile(entry.file_name)}
                                disabled={restoreBusy}
                              />
                            </label>
                          )}
                          <button
                            className="checkpoint-inspector-file-button"
                            onClick={() => setActiveFileName(entry.file_name)}
                          >
                            <span className="checkpoint-inspector-file-name">{entry.file_name}</span>
                            <span className={`checkpoint-inspector-status tone-${tone}`}>
                              {CHECKPOINT_FILE_STATUS_LABELS[entry.status] || entry.status}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  {!loading && files.length === 0 && (
                    <div className="checkpoint-inspector-empty">This checkpoint has no files to inspect.</div>
                  )}
                  {loading && <div className="checkpoint-inspector-empty">Loading checkpoint comparison...</div>}
                </div>
              </div>

              <div className="checkpoint-inspector-diff">
                {activeFile ? (
                  <>
                    <div className="checkpoint-inspector-diff-header">
                      <div>
                        <div className="checkpoint-inspector-diff-path">{activeFile.file_name}</div>
                        <div className="checkpoint-inspector-diff-subtitle">
                          {CHECKPOINT_FILE_STATUS_LABELS[activeFile.status] || activeFile.status}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          className="btn btn-secondary checkpoint-inspector-inline-restore"
                          onClick={handleRestoreActiveFile}
                          disabled={restoreBusy}
                        >
                          {restoreBusy ? "Restoring..." : "Restore this file"}
                        </button>
                      )}
                    </div>

                    <div className="checkpoint-inspector-diff-legend">
                      Comparing checkpoint content on the left against the current project state on the right.
                    </div>

                    <div className="checkpoint-inspector-diff-rows">
                      {diffRows.length === 0 && (
                        <div className="checkpoint-inspector-empty">No content differences in this file.</div>
                      )}
                      {diffRows.map((row, index) => {
                        if (row.type === "collapsed") {
                          return (
                            <div key={`collapsed-${index}`} className="checkpoint-inspector-diff-row collapsed">
                              <span className="checkpoint-inspector-diff-collapse">
                                {row.count} unchanged lines hidden
                              </span>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={`${row.type}-${row.oldNumber || "n"}-${row.newNumber || "n"}-${index}`}
                            className={`checkpoint-inspector-diff-row type-${row.type}`}
                          >
                            <span className="checkpoint-inspector-line-number">{row.oldNumber || ""}</span>
                            <span className="checkpoint-inspector-line-number">{row.newNumber || ""}</span>
                            <span className="checkpoint-inspector-line-marker">
                              {row.type === "add" ? "+" : row.type === "remove" ? "-" : " "}
                            </span>
                            <code className="checkpoint-inspector-line-text">{row.text}</code>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="checkpoint-inspector-empty">Select a file to preview its diff.</div>
                )}
              </div>
            </div>

            <div className="checkpoint-inspector-footer">
              <div className="checkpoint-inspector-footer-copy">
                {selectedFileNames.length > 0
                  ? `${selectedFileNames.length} file${selectedFileNames.length === 1 ? "" : "s"} selected`
                  : "Select one or more files to restore only those files."}
                {selectedHasAddedFiles && (
                  <span className="checkpoint-inspector-footer-warning">
                    Selected added files will be deleted from the current project.
                  </span>
                )}
              </div>
              {canEdit && (
                <div className="checkpoint-inspector-footer-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleRestoreSelection(selectedFileNames, selectedFiles)}
                    disabled={!selectedFileNames.length || restoreBusy}
                  >
                    {restoreBusy ? "Restoring..." : "Restore selected files"}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleRestoreFull}
                    disabled={loading || restoreBusy}
                  >
                    {restoreBusy ? "Restoring..." : "Restore full checkpoint"}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
