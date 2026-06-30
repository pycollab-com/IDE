import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import CodeMirror, { ExternalChange } from "@uiw/react-codemirror";
import { completionStatus } from "@codemirror/autocomplete";
import { python } from "@codemirror/lang-python";
import { codeFolding, foldEffect, foldable, foldedRanges, indentUnit, unfoldEffect } from "@codemirror/language";
import { insertNewlineAndIndent, indentWithTab } from "@codemirror/commands";
import { EditorView, Decoration, GutterMarker, WidgetType, gutter, keymap } from "@codemirror/view";
import { ChangeSet, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { io } from "socket.io-client";
import api, { API_BASE } from "../api";
import { getToken } from "../auth";
import { freezeSerializable } from "../session";
import PyodideRunner from "../runtime/pyodideRunner";
import PybricksRunner from "../runtime/pybricksRunner";
import { createPybricksLiveControlSource } from "../runtime/pybricksLiveControl";
import PybricksBlocksEditor from "../pybricks-blocks/ui/PybricksBlocksEditor";
import { motion, AnimatePresence } from "framer-motion";
import { FiFile, FiFilePlus, FiFolder, FiFolderPlus, FiUsers, FiShare2, FiLogOut, FiPlay, FiTerminal, FiChevronLeft, FiChevronDown, FiChevronRight, FiEdit2, FiTrash2, FiCopy, FiCheck, FiAlertCircle, FiSearch, FiMenu, FiHome, FiEye, FiEyeOff, FiX, FiSquare, FiMessageSquare, FiSend, FiCode, FiPlus, FiActivity, FiClock, FiZap, FiPhoneCall, FiPhoneOff, FiMic, FiMicOff, FiVolume2, FiRefreshCw, FiWifi, FiWifiOff, FiDownload, FiMoreVertical } from "react-icons/fi";
import CommandPalette from "../components/CommandPalette";
import ProjectSearch from "../components/ProjectSearch";
import CheckpointInspectorModal from "../components/CheckpointInspectorModal";
import { Skeleton } from "../components/Skeleton";
import { skeletonDebugEnabled } from "../utils/skeletonDebug";
import PybricksLiveControl from "../components/PybricksLiveControl";
import HubInfoPanel from "../components/HubInfoPanel";
import { getPrimaryReading } from "../runtime/pybricksReadings";
import { usePythonIntelligence } from "../python-intelligence/usePythonIntelligence";
import { PROJECT_TYPE_PYBRICKS, isPybricksProject as projectUsesPybricks } from "../projects/projectTypes";

const PYTHON_INDENT = "    ";

const lineIndent = (text) => text.match(/^[ \t]*/)?.[0].replace(/\t/g, PYTHON_INDENT) || "";

const codeBeforeComment = (text) => text.replace(/\s+#.*$/, "").trimEnd();

const shouldOpenPythonBlock = (text) => codeBeforeComment(text).endsWith(":");

const autocompleteIsOpen = (view) => completionStatus(view.state) !== null;

const insertPythonNewlineAndIndent = (view) => {
  if (autocompleteIsOpen(view)) return false;

  const selection = view.state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) {
    return insertNewlineAndIndent(view);
  }

  const cursor = selection.main.head;
  const line = view.state.doc.lineAt(cursor);
  const beforeCursor = line.text.slice(0, cursor - line.from);
  const currentIndent = lineIndent(beforeCursor);
  const isBlankIndentedLine = line.text.trim() === "" && currentIndent.length > 0;
  const indent = isBlankIndentedLine
    ? currentIndent.slice(0, Math.max(0, currentIndent.length - PYTHON_INDENT.length))
    : currentIndent + (shouldOpenPythonBlock(beforeCursor) ? PYTHON_INDENT : "");

  view.dispatch({
    changes: {
      from: cursor,
      to: cursor,
      insert: `\n${indent}`,
    },
    selection: { anchor: cursor + 1 + indent.length },
    userEvent: "input",
  });
  return true;
};

const escapePythonIndent = (view) => {
  if (autocompleteIsOpen(view)) return false;

  const selection = view.state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return false;

  const cursor = selection.main.head;
  const line = view.state.doc.lineAt(cursor);
  const currentIndent = lineIndent(line.text);
  if (!currentIndent) return false;

  const cursorOffset = cursor - line.from;
  const removeTo = line.from + Math.min(currentIndent.length, cursorOffset);
  const removeFrom = Math.max(line.from, removeTo - PYTHON_INDENT.length);
  if (removeFrom === removeTo) return false;

  view.dispatch({
    changes: { from: removeFrom, to: removeTo },
    selection: { anchor: cursor - (removeTo - removeFrom) },
    userEvent: "delete.dedent",
  });
  return true;
};


// Subsequence fuzzy match for the Cmd/Ctrl+K file switcher.
// Returns a score (higher is better) or -1 when the query is not a subsequence.
const fuzzyFileScore = (text, query) => {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let cursor = 0;
  let score = 0;
  let prevMatch = -2;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return -1;
    score += found === prevMatch + 1 ? 4 : 1; // reward consecutive matches
    if (found === 0 || /[\/_\-. ]/.test(haystack[found - 1])) score += 6; // reward word boundaries
    prevMatch = found;
    cursor = found + 1;
  }
  return score - haystack.length * 0.01; // gently prefer shorter names
};

// StateEffect + StateField to paint remote cursors/selections
const setRemoteCursors = StateEffect.define();
const remoteCursorField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setRemoteCursors)) {
        const decorations = [];
        (e.value || []).forEach((cur) => {
          if (typeof cur.from === "number" && typeof cur.to === "number") {
            if (cur.from !== cur.to) {
              decorations.push(
                Decoration.mark({ attributes: { style: `background: ${cur.color}4D;` } }).range(cur.from, cur.to),
              );
            }
            decorations.push(
              Decoration.widget({ widget: new RemoteCursorWidget(cur.color, cur.label) }).range(cur.to),
            );
          }
        });
        value = Decoration.set(decorations, true);
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class RemoteCursorWidget extends WidgetType {
  constructor(color, label) {
    super();
    this.color = color;
    this.label = label;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.style.position = "relative";
    const caret = document.createElement("span");
    caret.style.borderLeft = `2px solid ${this.color}`;
    caret.style.marginLeft = "-1px";
    caret.style.height = "1.2em";
    caret.style.display = "inline-block";
    caret.style.verticalAlign = "text-top";
    const bubble = document.createElement("span");
    bubble.textContent = this.label || "";
    bubble.style.position = "absolute";
    bubble.style.top = "-1.8em";
    bubble.style.left = "-2px";
    bubble.style.background = this.color;
    bubble.style.color = "#f7f7f2";
    bubble.style.padding = "4px 8px";
    bubble.style.borderRadius = "12px";
    bubble.style.fontSize = "11px";
    bubble.style.fontWeight = "600";
    bubble.style.whiteSpace = "nowrap";
    bubble.style.boxShadow = "0 2px 6px rgba(18, 17, 19, 0.2)";
    wrap.appendChild(caret);
    wrap.appendChild(bubble);
    return wrap;
  }
}

const getFoldedRangeAtLine = (state, line) => {
  let folded = null;
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    if (!folded || folded.from > from) folded = { from, to };
  });
  return folded;
};

class CodeFoldingRibbonMarker extends GutterMarker {
  constructor(lines, folded) {
    super();
    this.lines = lines;
    this.folded = folded;
  }

  eq(other) {
    return other.lines === this.lines && other.folded === this.folded;
  }

  toDOM() {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `cm-code-fold-ribbon${this.folded ? " is-folded" : ""}`;
    marker.style.setProperty("--fold-ribbon-lines", String(this.lines));
    marker.setAttribute("aria-label", this.folded ? "Expand folded code" : "Collapse code block");
    marker.title = this.folded ? "Expand" : "Collapse";

    const rail = document.createElement("span");
    rail.className = "cm-code-fold-ribbon-rail";
    marker.appendChild(rail);
    return marker;
  }
}

const codeFoldingRibbon = gutter({
  class: "cm-code-fold-ribbon-gutter",
  lineMarker(view, line) {
    const foldedRange = getFoldedRangeAtLine(view.state, line);
    const range = foldable(view.state, line.from, line.to);
    if (!foldedRange && !range) return null;

    const endLine = view.state.doc.lineAt((foldedRange || range).to);
    const lineCount = Math.max(2, endLine.number - line.number + 1);
    return new CodeFoldingRibbonMarker(lineCount, Boolean(foldedRange));
  },
  domEventHandlers: {
    mousedown(view, line, event) {
      if (!(event.target instanceof Element) || !event.target.closest(".cm-code-fold-ribbon")) return false;
      event.preventDefault();
      const foldedRange = getFoldedRangeAtLine(view.state, line);
      const range = foldedRange || foldable(view.state, line.from, line.to);
      if (!range) return true;
      view.dispatch({
        effects: foldedRange ? unfoldEffect.of(foldedRange) : foldEffect.of(range),
        selection: { anchor: line.from },
        scrollIntoView: false,
      });
      view.focus();
      return true;
    },
  },
});

const makeOpId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

const applyChangeSetToString = (text, changeset) => {
  if (!Array.isArray(changeset)) return null;
  let pos = 0;
  const out = [];
  for (const part of changeset) {
    if (typeof part === "number") {
      if (part < 0 || pos + part > text.length) return null;
      out.push(text.slice(pos, pos + part));
      pos += part;
      continue;
    }
    if (Array.isArray(part)) {
      const del = part[0];
      if (typeof del !== "number" || del < 0 || pos + del > text.length) return null;
      pos += del;
      if (part.length > 1) {
        const lines = part.slice(1);
        if (!lines.every((l) => typeof l === "string")) return null;
        out.push(lines.join("\n"));
      }
      continue;
    }
    return null;
  }
  if (pos !== text.length) return null;
  return out.join("");
};

const EMPTY_PROJECT_PERMISSIONS = Object.freeze({
  is_owner: false,
  is_collaborator: false,
  can_view: false,
  can_edit: false,
  can_manage: false,
  can_share: false,
  can_toggle_visibility: false,
});

const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const MAX_PROMPT_LENGTH = 120;
const ACTIVITY_MAX_ITEMS = 60;
const ACTIVITY_AGG_WINDOW_MS = 3500;
const VOICE_LEVEL_THRESHOLD = 0.028;
const VOICE_SIGNAL_THROTTLE_MS = 220;
const RUN_HISTORY_LIMIT = 12;
const RUN_HISTORY_OUTPUT_CHAR_LIMIT = 24000;
const VOICE_RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const describeRunOutcome = (returnCode) => {
  if (returnCode === 0) {
    return { tone: "success", label: "Success" };
  }
  if (returnCode === 130) {
    return { tone: "interrupted", label: "Interrupted" };
  }
  if (returnCode === -1) {
    return { tone: "timeout", label: "Timed out" };
  }
  return { tone: "failed", label: "Failed" };
};

const formatRunDuration = (ms) => {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (safeMs >= 1000) {
    return `${(safeMs / 1000).toFixed(safeMs >= 10000 ? 1 : 2)}s`;
  }
  return `${Math.round(safeMs)}ms`;
};

const formatRunClockTime = (timestamp) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const checkpointArchiveFileName = (projectName, snapshotName) => {
  const safeProjectName = (projectName || "project")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const safeSnapshotName = (snapshotName || "checkpoint")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeProjectName || "project"}-${safeSnapshotName || "checkpoint"}.zip`;
};

const projectBundleFileName = (projectName) => {
  const safeProjectName = (projectName || "project")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeProjectName || "project"}.zip`;
};

const downloadBlob = (blob, fileName) => {
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 0);
};

const inferPendingPrompt = (text) => {
  const normalized = text.replace(/\r/g, "");
  if (normalized.endsWith("\n")) {
    return null;
  }

  const lastNewline = normalized.lastIndexOf("\n");
  const trailingLine = normalized.slice(lastNewline + 1).replace(ANSI_ESCAPE_REGEX, "");
  const prompt = trailingLine.trim();

  if (!prompt) {
    return null;
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return null;
  }

  return prompt;
};

const normalizeTerminalText = (value, fallback = "") => {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, nested) => {
      if (typeof nested === "object" && nested !== null) {
        if (seen.has(nested)) return "[Circular]";
        seen.add(nested);
      }
      return nested;
    });
  } catch {
    return String(value);
  }
};

const createEmptyPybricksHubState = () => ({
  connected: false,
  status: "disconnected",
  transport: null,
  transportLabel: "",
  deviceName: "",
  hubType: "",
  firmwareVersion: "",
  protocolVersion: "",
  maxWriteSize: 0,
  maxUserProgramSize: 0,
  featureFlags: 0,
  numOfSlots: 0,
  selectedSlot: 0,
  hubRunning: false,
  batteryState: "unknown",
  batteryVoltage: null,
  batteryPercent: null,
  ports: [],
  motion: null,
  buttons: [],
  telemetryAvailable: false,
  telemetryError: "",
  statusFlags: 0,
  warnings: [],
});

const formatPortReading = (port) => getPrimaryReading(port);

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const EDITOR_SIDEBAR_WIDTH_STORAGE_KEY = "pycollab.editor.sidebarWidth";
const EDITOR_TERMINAL_HEIGHT_STORAGE_KEY = "pycollab.editor.terminalHeight";
const DEFAULT_EDITOR_SIDEBAR_WIDTH = 300;
const MIN_EDITOR_SIDEBAR_WIDTH = 260;
const MAX_EDITOR_SIDEBAR_WIDTH = 460;
const DEFAULT_TERMINAL_HEIGHT = 340;
const MIN_TERMINAL_HEIGHT = 220;
const MAX_TERMINAL_HEIGHT = 520;
const TREE_ROOT = "";

const readStoredEditorDimension = (key, fallback, min, max) => {
  if (typeof window === "undefined") return fallback;
  const parsed = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(parsed)) return fallback;
  return clampNumber(parsed, min, max);
};

const normalizeTreePath = (path) =>
  String(path || "")
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");

const treeParentPath = (path) => {
  const normalized = normalizeTreePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? TREE_ROOT : normalized.slice(0, index);
};

const treeBaseName = (path) => {
  const normalized = normalizeTreePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
};

const compareTreeEntries = (left, right) => {
  const leftOrder = Number.isFinite(Number(left.sortOrder)) ? Number(left.sortOrder) : 0;
  const rightOrder = Number.isFinite(Number(right.sortOrder)) ? Number(right.sortOrder) : 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const rank = { blocks: 0, folder: 1, file: 2 };
  const leftRank = rank[left.kind] ?? 99;
  const rightRank = rank[right.kind] ?? 99;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
};

const createFolderNode = ({ id = null, path, sortOrder = 0, explicit = false }) => ({
  kind: "folder",
  id,
  key: id ? `folder-${id}` : `folder-implicit-${path}`,
  path,
  parentPath: treeParentPath(path),
  name: treeBaseName(path),
  sortOrder,
  explicit,
  children: [],
});

const buildEditorTree = ({ files, folders, blockDocuments, query }) => {
  const folderByPath = new Map();
  const entriesByParent = new Map();
  const root = { kind: "root", path: TREE_ROOT, children: [] };

  const addChild = (parentPath, node) => {
    const key = parentPath || TREE_ROOT;
    const siblings = entriesByParent.get(key) || [];
    if (!siblings.some((entry) => entry.key === node.key)) {
      siblings.push(node);
      entriesByParent.set(key, siblings);
    }
  };

  const ensureFolder = (path, explicitFolder = null) => {
    const normalized = normalizeTreePath(path);
    if (!normalized) return root;
    const existing = folderByPath.get(normalized);
    if (existing) {
      if (explicitFolder) {
        existing.id = explicitFolder.id;
        existing.key = `folder-${explicitFolder.id}`;
        existing.sortOrder = explicitFolder.sort_order ?? explicitFolder.sortOrder ?? existing.sortOrder;
        existing.explicit = true;
      }
      return existing;
    }

    const parentPath = treeParentPath(normalized);
    const parentNode = ensureFolder(parentPath);
    const node = createFolderNode({
      id: explicitFolder?.id ?? null,
      path: normalized,
      sortOrder: explicitFolder?.sort_order ?? explicitFolder?.sortOrder ?? 0,
      explicit: Boolean(explicitFolder),
    });
    folderByPath.set(normalized, node);
    parentNode.children.push(node);
    addChild(parentPath, node);
    return node;
  };

  (folders || []).forEach((folder) => ensureFolder(folder.path, folder));

  (blockDocuments || []).forEach((document, index) => {
    const node = {
      kind: "blocks",
      id: document.id,
      key: `blocks-${document.id}`,
      name: document.name,
      generatedEntryModule: document.generated_entry_module || "main.py",
      sortOrder: -100000 + index,
      parentPath: TREE_ROOT,
    };
    root.children.push(node);
  });

  (files || []).forEach((file) => {
    const filePath = normalizeTreePath(file.name);
    const parentPath = treeParentPath(filePath);
    const parentNode = ensureFolder(parentPath);
    const node = {
      kind: "file",
      id: file.id,
      key: `file-${file.id}`,
      name: treeBaseName(filePath),
      path: filePath,
      fullName: file.name,
      parentPath,
      sortOrder: file.sort_order ?? file.sortOrder ?? 0,
    };
    parentNode.children.push(node);
    addChild(parentPath, node);
  });

  const sortNode = (node) => {
    node.children?.sort(compareTreeEntries);
    node.children?.forEach(sortNode);
  };
  sortNode(root);
  entriesByParent.forEach((siblings) => siblings.sort(compareTreeEntries));

  const normalizedQuery = String(query || "").trim().toLowerCase();
  const filterNode = (node) => {
    if (!normalizedQuery) return node;
    if (node.kind === "file" || node.kind === "blocks") {
      return String(node.fullName || node.name || "").toLowerCase().includes(normalizedQuery) ? node : null;
    }
    if (node.kind === "folder") {
      const nextChildren = (node.children || []).map(filterNode).filter(Boolean);
      const selfMatches = node.path.toLowerCase().includes(normalizedQuery);
      if (!selfMatches && nextChildren.length === 0) return null;
      return { ...node, children: nextChildren };
    }
    return {
      ...node,
      children: (node.children || []).map(filterNode).filter(Boolean),
    };
  };

  return {
    root: filterNode(root),
    entriesByParent,
  };
};

const upsertById = (items, nextItem) => {
  if (!nextItem || typeof nextItem.id !== "number") return items;
  const index = items.findIndex((item) => item.id === nextItem.id);
  if (index === -1) return [...items, nextItem];
  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
};

export default function EditorPage({ user, onLogout, theme, toggleTheme, editorTheme }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const shareTokenParam = searchParams.get("share");
  const shareToken = shareTokenParam ? shareTokenParam.trim().toLowerCase() : null;
  const navigate = useNavigate();

  // Force full page reload when cross-origin isolation headers are missing.
  // This happens when the user navigated here via SPA from a page that was
  // served without COOP/COEP (e.g. /login, /welcome).  A real page load for
  // /projects/:id will return the correct headers so crossOriginIsolated
  // becomes true and SharedArrayBuffer / Pyodide can work.
  useEffect(() => {
    if (typeof window !== "undefined" && !window.crossOriginIsolated) {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("_coi")) {
        url.searchParams.set("_coi", "1");
        window.location.replace(url.toString());
      }
    }
  }, []);

  const [project, setProject] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [blockDocuments, setBlockDocuments] = useState([]);
  const [currentFileId, setCurrentFileId] = useState(null);
  const currentFileIdRef = useRef(null);
  const [currentBlockDocumentId, setCurrentBlockDocumentId] = useState(null);
  const currentBlockDocumentIdRef = useRef(null);
  const [activeEditorKind, setActiveEditorKind] = useState("file");
  const activeEditorKindRef = useRef("file");
  const [showGeneratedBlockCode, setShowGeneratedBlockCode] = useState(false);
  const [generatedBlockCode, setGeneratedBlockCode] = useState("");
  const generatedBlockCodeRef = useRef("");
  const [output, setOutput] = useState("");
  const [presence, setPresence] = useState([]);
  const presenceRef = useRef([]);
  const [sharePin, setSharePin] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showShareLink, setShowShareLink] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [showOnlyMyTasks, setShowOnlyMyTasks] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotDraft, setSnapshotDraft] = useState("");
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState(null);
  const [exportingSnapshotId, setExportingSnapshotId] = useState(null);
  const [exportingProjectBundle, setExportingProjectBundle] = useState(false);
  const [openSnapshotMenuId, setOpenSnapshotMenuId] = useState(null);
  const [checkpointInspectorSnapshot, setCheckpointInspectorSnapshot] = useState(null);
  const [checkpointInspection, setCheckpointInspection] = useState(null);
  const [loadingCheckpointInspection, setLoadingCheckpointInspection] = useState(false);
  const [checkpointInspectionError, setCheckpointInspectionError] = useState("");
  const [followTargetId, setFollowTargetId] = useState(null);
  const [followFlash, setFollowFlash] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceJoining, setVoiceJoining] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceParticipants, setVoiceParticipants] = useState([]);
  const [voiceError, setVoiceError] = useState("");
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [activityFeed, setActivityFeed] = useState([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [liveControlActive, setLiveControlActive] = useState(false);
  const [stdinLine, setStdinLine] = useState("");
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [pybricksHubState, setPybricksHubState] = useState(createEmptyPybricksHubState);
  const [remoteHubSession, setRemoteHubSession] = useState(null);
  const [remoteHubPendingRequests, setRemoteHubPendingRequests] = useState([]);
  const [remoteHubNotice, setRemoteHubNotice] = useState("");
  const [pybricksConnectModalOpen, setPybricksConnectModalOpen] = useState(false);
  const [hubInfoOpen, setHubInfoOpen] = useState(false);
  const hubInfoTriggerRef = useRef(null);
  const [hubInfoPopoverStyle, setHubInfoPopoverStyle] = useState(null);
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [inputPrompt, setInputPrompt] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? !window.matchMedia("(max-width: 768px)").matches : true
  );
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredEditorDimension(
      EDITOR_SIDEBAR_WIDTH_STORAGE_KEY,
      DEFAULT_EDITOR_SIDEBAR_WIDTH,
      MIN_EDITOR_SIDEBAR_WIDTH,
      MAX_EDITOR_SIDEBAR_WIDTH
    )
  );
  const [terminalHeight, setTerminalHeight] = useState(() =>
    readStoredEditorDimension(
      EDITOR_TERMINAL_HEIGHT_STORAGE_KEY,
      DEFAULT_TERMINAL_HEIGHT,
      MIN_TERMINAL_HEIGHT,
      MAX_TERMINAL_HEIGHT
    )
  );
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);
  const [runHistory, setRunHistory] = useState([]);
  const [activeRunReplayId, setActiveRunReplayId] = useState(null);
  const [fileSearch, setFileSearch] = useState("");
  const [createFileMenuOpen, setCreateFileMenuOpen] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [draggingTreeEntry, setDraggingTreeEntry] = useState(null);
  const [treeDropTarget, setTreeDropTarget] = useState(null);
  const [activeSidebarScreen, setActiveSidebarScreen] = useState("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const pendingSearchSelectionRef = useRef(null);
  const editorViewRef = useRef(null);
  const socketRef = useRef(null);
  const runnerRef = useRef(null);
  const collabRef = useRef({});
  const filesRef = useRef([]);
  const foldersRef = useRef([]);
  const blockDocumentsRef = useRef([]);
  const draggingTreeEntryRef = useRef(null);
  const projectApiIdRef = useRef(null);
  const activityBootstrappedRef = useRef(false);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const remoteAudioRef = useRef(new Map());
  const speakingSampleRef = useRef({ speaking: false, lastEmitTs: 0 });
  const monitorRafRef = useRef(null);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const voiceEnabledRef = useRef(false);
  const voicePanelOpenRef = useRef(false);
  const voiceMutedRef = useRef(false);
  const latestInspectRequestIdRef = useRef(0);
  const terminalBodyRef = useRef(null);
  const stdinInputRef = useRef(null);
  const runningRef = useRef(false);
  const liveControlActiveRef = useRef(false);
  const outputRef = useRef("");
  const runMetaRef = useRef({ runId: null, startedAt: 0, fileName: "", capture: null });
  const runtimeEverReadyRef = useRef(false);
  const pybricksHubStateRef = useRef(createEmptyPybricksHubState());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EDITOR_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EDITOR_TERMINAL_HEIGHT_STORAGE_KEY, String(Math.round(terminalHeight)));
  }, [terminalHeight]);
  const remoteHubSessionRef = useRef(null);
  const mirroredCursorRef = useRef({ fileId: null, from: -1, to: -1 });
  const sharePinCardRef = useRef(null);
  const createFileMenuRef = useRef(null);
  const fileSearchInputRef = useRef(null);
  const scrollSharePinIntoView = () => {
    requestAnimationFrame(() => {
      sharePinCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  // WebSocket ping status
  const [wsConnected, setWsConnected] = useState(true);
  const lastPongRef = useRef(Date.now());
  const pingIntervalRef = useRef(null);

  // Session Chat state (ephemeral, not saved)
  const [sessionChatOpen, setSessionChatOpen] = useState(false);
  const [sessionChatMessages, setSessionChatMessages] = useState([]);
  const [sessionChatInput, setSessionChatInput] = useState("");
  const sessionChatBodyRef = useRef(null);

  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const onViewportChange = (event) => setIsMobileViewport(event.matches);

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", onViewportChange);

    return () => mediaQuery.removeEventListener("change", onViewportChange);
  }, []);

  useEffect(() => {
    if (isMobileViewport) {
      setSidebarOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!sharePin) return;
    scrollSharePinIntoView();
  }, [sharePin]);

  useEffect(() => {
    if (!sharePin || !showShareLink) return;
    scrollSharePinIntoView();
  }, [sharePin, showShareLink]);

  // Auto-scroll the session chat panel when new messages arrive
  useEffect(() => {
    if (sessionChatBodyRef.current) {
      sessionChatBodyRef.current.scrollTo({ top: sessionChatBodyRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [sessionChatMessages]);

  useEffect(() => {
    currentFileIdRef.current = currentFileId;
  }, [currentFileId]);

  useEffect(() => {
    currentBlockDocumentIdRef.current = currentBlockDocumentId;
  }, [currentBlockDocumentId]);

  useEffect(() => {
    activeEditorKindRef.current = activeEditorKind;
  }, [activeEditorKind]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    liveControlActiveRef.current = liveControlActive;
  }, [liveControlActive]);

  useEffect(() => {
    pybricksHubStateRef.current = pybricksHubState;
  }, [pybricksHubState]);

  useEffect(() => {
    remoteHubSessionRef.current = remoteHubSession;
  }, [remoteHubSession]);

  useEffect(() => {
    if (!remoteHubNotice) return undefined;
    const timer = window.setTimeout(() => setRemoteHubNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [remoteHubNotice]);

  useEffect(() => {
    outputRef.current = output;
  }, [output]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    voicePanelOpenRef.current = voicePanelOpen;
  }, [voicePanelOpen]);

  useEffect(() => {
    voiceMutedRef.current = voiceMuted;
  }, [voiceMuted]);

  useEffect(() => {
    syncLocalTrackState({ muted: voiceMuted });
  }, [voiceMuted]);

  useEffect(() => {
    if (!voiceEnabled) {
      setVoicePanelOpen(false);
    }
  }, [voiceEnabled]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    blockDocumentsRef.current = blockDocuments;
  }, [blockDocuments]);

  useEffect(() => {
    if (!createFileMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (createFileMenuRef.current?.contains(event.target)) return;
      setCreateFileMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [createFileMenuOpen]);

  const resolveUserName = (userId) => {
    if (userId === user?.id) return "You";
    const person = (presenceRef.current || []).find((entry) => entry.user_id === userId);
    return person?.name || `User ${userId}`;
  };

  const resolveFileName = (fileId) => {
    const file = (filesRef.current || []).find((entry) => entry.id === fileId);
    return file?.name || `file #${fileId}`;
  };

  const parseChangeMagnitude = (changeSet) => {
    if (!Array.isArray(changeSet)) return { inserted: 0, deleted: 0 };
    let inserted = 0;
    let deleted = 0;
    for (const part of changeSet) {
      if (Array.isArray(part)) {
        const deleteCount = typeof part[0] === "number" ? part[0] : 0;
        deleted += Math.max(0, deleteCount);
        if (part.length > 1) {
          inserted += part
            .slice(1)
            .filter((line) => typeof line === "string")
            .join("\n").length;
        }
      }
    }
    return { inserted, deleted };
  };

  const pushActivity = ({ kind, text, fileId = null, userId = null, countable = false }) => {
    const now = Date.now();
    setActivityFeed((prev) => {
      if (countable && prev.length) {
        const head = prev[0];
        const canMerge =
          head.kind === kind &&
          head.fileId === fileId &&
          head.userId === userId &&
          now - head.ts < ACTIVITY_AGG_WINDOW_MS;
        if (canMerge) {
          const merged = { ...head, ts: now, count: (head.count || 1) + 1, text };
          return [merged, ...prev.slice(1)].slice(0, ACTIVITY_MAX_ITEMS);
        }
      }
      const next = {
        id: `${now}-${Math.random().toString(16).slice(2)}`,
        ts: now,
        kind,
        text,
        fileId,
        userId,
        count: 1,
      };
      return [next, ...prev].slice(0, ACTIVITY_MAX_ITEMS);
    });
  };

  const upsertVoiceParticipant = (participant) => {
    if (!participant?.sid) return;
    setVoiceParticipants((prev) => {
      const idx = prev.findIndex((entry) => entry.sid === participant.sid);
      if (idx === -1) return [...prev, participant].sort((a, b) => (a.user_name || "").localeCompare(b.user_name || ""));
      const next = [...prev];
      next[idx] = { ...next[idx], ...participant };
      return next.sort((a, b) => (a.user_name || "").localeCompare(b.user_name || ""));
    });
  };

  const removeVoiceParticipant = (sid) => {
    if (!sid) return;
    const connection = peerConnectionsRef.current.get(sid);
    if (connection) {
      try {
        connection.onicecandidate = null;
        connection.ontrack = null;
        connection.onconnectionstatechange = null;
        connection.close();
      } catch {
        // ignore close races
      }
      peerConnectionsRef.current.delete(sid);
    }
    const remoteAudio = remoteAudioRef.current.get(sid);
    if (remoteAudio) {
      try {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
      } catch {
        // ignore audio cleanup races
      }
      remoteAudioRef.current.delete(sid);
    }
    setVoiceParticipants((prev) => prev.filter((entry) => entry.sid !== sid));
  };

  const emitVoiceState = (override = {}) => {
    const socket = socketRef.current;
    if (!socket?.connected || !voiceEnabledRef.current || !socketProjectId) return;
    const muted = typeof override.muted === "boolean" ? override.muted : voiceMutedRef.current;
    const speaking = typeof override.speaking === "boolean" ? override.speaking : speakingSampleRef.current.speaking;
    socket.emit("voice_state", { projectId: socketProjectId, muted, speaking });
  };

  const stopSpeakingMonitor = () => {
    if (monitorRafRef.current) {
      cancelAnimationFrame(monitorRafRef.current);
      monitorRafRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    speakingSampleRef.current = { speaking: false, lastEmitTs: 0 };
  };

  const startSpeakingMonitor = (stream) => {
    stopSpeakingMonitor();
    if (!stream) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
      audioContextRef.current = ctx;
      const sample = new Uint8Array(analyser.fftSize);

      const loop = () => {
        if (!analyserRef.current || !voiceEnabledRef.current) return;
        analyser.getByteTimeDomainData(sample);
        let total = 0;
        for (let i = 0; i < sample.length; i += 1) {
          const centered = (sample[i] - 128) / 128;
          total += centered * centered;
        }
        const rms = Math.sqrt(total / sample.length);
        const speakingNow =
          !voiceMutedRef.current &&
          rms > VOICE_LEVEL_THRESHOLD;
        const state = speakingSampleRef.current;
        const now = performance.now();
        if (speakingNow !== state.speaking && now - state.lastEmitTs > VOICE_SIGNAL_THROTTLE_MS) {
          state.speaking = speakingNow;
          state.lastEmitTs = now;
          emitVoiceState({ speaking: speakingNow });
        }
        monitorRafRef.current = requestAnimationFrame(loop);
      };
      monitorRafRef.current = requestAnimationFrame(loop);
    } catch {
      // speaking indicators are best-effort
    }
  };

  const clearVoiceConnections = () => {
    peerConnectionsRef.current.forEach((connection) => {
      try {
        connection.onicecandidate = null;
        connection.ontrack = null;
        connection.onconnectionstatechange = null;
        connection.close();
      } catch {
        // ignore close races
      }
    });
    peerConnectionsRef.current.clear();
    remoteAudioRef.current.forEach((audio) => {
      try {
        audio.pause();
        audio.srcObject = null;
      } catch {
        // ignore
      }
    });
    remoteAudioRef.current.clear();
  };

  const stopLocalVoiceStream = () => {
    stopSpeakingMonitor();
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;
  };

  const syncLocalTrackState = (next = {}) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const muted = typeof next.muted === "boolean" ? next.muted : voiceMutedRef.current;
    const enabled = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  };

  const ensurePeerConnection = async (targetSid, shouldOffer = false) => {
    if (!socketProjectId) return null;
    if (!targetSid || targetSid === socketRef.current?.id) return null;
    if (peerConnectionsRef.current.has(targetSid)) return peerConnectionsRef.current.get(targetSid);

    const local = localStreamRef.current;
    if (!local) return null;

    const connection = new RTCPeerConnection(VOICE_RTC_CONFIG);
    peerConnectionsRef.current.set(targetSid, connection);

    local.getTracks().forEach((track) => {
      connection.addTrack(track, local);
    });

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      socketRef.current?.emit("voice_ice", {
        projectId: socketProjectId,
        toSid: targetSid,
        candidate: event.candidate.toJSON(),
      });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      let audioEl = remoteAudioRef.current.get(targetSid);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        remoteAudioRef.current.set(targetSid, audioEl);
      }
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {});
    };

    connection.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(connection.connectionState)) {
        peerConnectionsRef.current.delete(targetSid);
      }
    };

    if (shouldOffer) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socketRef.current?.emit("voice_offer", {
        projectId: socketProjectId,
        toSid: targetSid,
        sdp: offer,
      });
    }

    return connection;
  };

  const leaveVoiceCall = () => {
    if (socketProjectId) {
      socketRef.current?.emit("voice_leave", { projectId: socketProjectId });
    }
    clearVoiceConnections();
    stopLocalVoiceStream();
    voiceEnabledRef.current = false;
    voicePanelOpenRef.current = false;
    setVoiceEnabled(false);
    setVoiceJoining(false);
    setVoicePanelOpen(false);
    setVoiceError("");
  };

  const joinVoiceCall = async () => {
    if (voiceEnabledRef.current || voiceJoining) return;
    if (!socketProjectId) {
      setVoiceError("Project connection is still loading.");
      return;
    }
    if (!socketRef.current?.connected) {
      setVoiceError("Realtime connection is offline. Reconnect and try again.");
      return;
    }
    if (typeof RTCPeerConnection !== "function") {
      setVoiceError("This browser does not support WebRTC voice calls.");
      return;
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone access is not available in this browser.");
      return;
    }
    setVoiceJoining(true);
    setVoiceError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;
      syncLocalTrackState({
        muted: voiceMutedRef.current,
      });
      voiceEnabledRef.current = true;
      voicePanelOpenRef.current = true;
      startSpeakingMonitor(stream);
      setVoiceEnabled(true);
      setVoicePanelOpen(true);
      socketRef.current?.emit("voice_join", { projectId: socketProjectId });
      emitVoiceState({ muted: voiceMutedRef.current, speaking: false });
    } catch (err) {
      setVoiceError(err?.message || "Unable to access microphone.");
      stopLocalVoiceStream();
      voiceEnabledRef.current = false;
      voicePanelOpenRef.current = false;
      setVoiceEnabled(false);
    } finally {
      setVoiceJoining(false);
    }
  };

  const toggleVoiceMute = () => {
    if (!voiceEnabledRef.current) return;
    const nextMuted = !voiceMutedRef.current;
    setVoiceMuted(nextMuted);
    syncLocalTrackState({ muted: nextMuted });
    emitVoiceState({ muted: nextMuted, speaking: false });
  };

  const getCollabState = (fileId) => {
    if (!fileId) return null;
    if (!collabRef.current[fileId]) {
      collabRef.current[fileId] = { rev: 0, pending: null, buffer: null, inFlight: false, opId: null };
    }
    return collabRef.current[fileId];
  };

  const applyRemoteContent = (content) => {
    const view = editorViewRef.current;
    if (!view) return;
    const nextContent = typeof content === "string" ? content : "";
    const current = view.state.doc.toString();
    if (current === nextContent) return;
    let start = 0;
    const minLen = Math.min(current.length, nextContent.length);
    while (start < minLen && current[start] === nextContent[start]) {
      start += 1;
    }
    let end = 0;
    while (
      end < minLen - start &&
      current[current.length - 1 - end] === nextContent[nextContent.length - 1 - end]
    ) {
      end += 1;
    }
    const from = start;
    const to = current.length - end;
    const insert = nextContent.slice(start, nextContent.length - end);
    view.dispatch({
      changes: { from, to, insert },
      annotations: [ExternalChange.of(true)],
    });
  };

  const applyRemoteCursors = (cursors) => {
    const view = editorViewRef.current;
    if (!view) return;
    const docLen = view.state.doc.length;
    const normalized = (cursors || [])
      .map((cur) => {
        if (typeof cur?.from !== "number" || typeof cur?.to !== "number") return null;
        const clamp = (pos) => Math.max(0, Math.min(pos, docLen));
        return { ...cur, from: clamp(cur.from), to: clamp(cur.to) };
      })
      .filter(Boolean);
    view.dispatch({ effects: setRemoteCursors.of(normalized) });
  };

  const visibleRemoteCursors = (people, activeFileId) =>
    (people || [])
      .filter((p) => {
        if (p.user_id === user?.id) return false;
        if (!p.cursor) return false;
        if (typeof p.cursor.fileId !== "number") return false;
        return p.cursor.fileId === activeFileId;
      })
      .map((p) => ({
        from: p.cursor.from,
        to: p.cursor.to,
        color: p.color,
        label: p.name,
      }));

  const emitCursorPresence = (fileIdOverride = currentFileIdRef.current) => {
    if (!socketRef.current?.connected || !socketProjectId) return;
    if (typeof fileIdOverride !== "number") return;
    const selection = editorViewRef.current?.state.selection.main;
    const from = selection?.from ?? 0;
    const to = selection?.to ?? from;
    socketRef.current.emit("cursor", {
      projectId: socketProjectId,
      cursor: { from, to, fileId: fileIdOverride },
    });
  };

  const applyRemoteChangeSet = (changeSet) => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      changes: changeSet,
      annotations: [ExternalChange.of(true)],
    });
  };

  const sendPendingOp = (fileId) => {
    const st = getCollabState(fileId);
    if (!st || !st.pending || st.inFlight) return;
    if (!socketRef.current?.connected || !socketProjectId) return;

    st.inFlight = true;
    if (!st.opId) st.opId = makeOpId();

    const cursor = editorViewRef.current?.state.selection.main;
    socketRef.current.emit("file_op", {
      projectId: socketProjectId,
      fileId,
      baseRev: st.rev,
      opId: st.opId,
      changeset: st.pending.toJSON(),
      cursor: cursor ? { from: cursor.from, to: cursor.to, fileId } : null,
    });
  };

  const applyIncomingOp = (data) => {
    const fileId = data?.fileId;
    const newRev = data?.rev;
    const changesetJson = data?.changeset;
    if (!fileId || typeof newRev !== "number" || !Array.isArray(changesetJson)) return;

    const st = getCollabState(fileId);
    if (!st) return;
    if (newRev !== st.rev + 1) {
      // We missed ops or reconnected—request a catch-up batch from our last known revision.
      socketRef.current?.emit("sync_file", { projectId: socketProjectId, fileId, fromRev: st.rev });
      return;
    }

    let remote;
    try {
      remote = ChangeSet.fromJSON(changesetJson);
    } catch {
      socketRef.current?.emit("sync_file", { projectId: socketProjectId, fileId });
      return;
    }

    let toApply = remote;
    if (st.pending) {
      const pending = st.pending;
      const remoteAfterPending = remote.map(pending);
      st.pending = pending.map(remote, true);
      toApply = remoteAfterPending;

      if (st.buffer) {
        const buffer = st.buffer;
        const remoteAfterBuffer = remoteAfterPending.map(buffer);
        st.buffer = buffer.map(remoteAfterPending, true);
        toApply = remoteAfterBuffer;
      }
    }

    st.rev = newRev;
    if (typeof data?.userId === "number" && data.userId !== user?.id) {
      const actorName = resolveUserName(data.userId);
      const fileName = resolveFileName(fileId);
      const magnitude = parseChangeMagnitude(changesetJson);
      const deltaLabel =
        magnitude.inserted || magnitude.deleted
          ? ` (+${magnitude.inserted}/-${magnitude.deleted} chars)`
          : "";
      pushActivity({
        kind: "edit",
        text: `${actorName} edited ${fileName}${deltaLabel}`,
        fileId,
        userId: data.userId,
        countable: true,
      });
    }

    if (editorViewRef.current && fileId === currentFileIdRef.current) {
      applyRemoteChangeSet(toApply);

      if (data?.cursor && typeof data?.userId === "number") {
        const incomingCursor = {
          from: data.cursor.from,
          to: data.cursor.to,
          fileId: typeof data.cursor.fileId === "number" ? data.cursor.fileId : fileId,
        };
        const nextPresence = (presenceRef.current || []).map((p) =>
          p.user_id === data.userId ? { ...p, cursor: incomingCursor } : p
        );
        presenceRef.current = nextPresence;
        setPresence(nextPresence);
        const remote = visibleRemoteCursors(nextPresence, currentFileIdRef.current);
        applyRemoteCursors(remote);
      }
      return;
    }

    // File not currently open: keep its stored content in sync for when it is opened.
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== fileId) return f;
        const next = applyChangeSetToString(f.content || "", toApply.toJSON());
        return next == null ? f : { ...f, content: next };
      })
    );
  };

  const flushEdits = async (fileId, timeoutMs = 2000) => {
    const st = getCollabState(fileId);
    if (!st) return { ok: true };

    if (st.pending && !st.inFlight) sendPendingOp(fileId);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!st.pending && !st.buffer && !st.inFlight) return { ok: true };
      await new Promise((r) => setTimeout(r, 25));
    }

    return { ok: false, reason: "timeout" };
  };

  const flushAllEdits = async () => {
    const failures = [];

    for (const file of files) {
      try {
        const result = await flushEdits(file.id);
        if (result?.ok === false) {
          failures.push({
            fileName: file.name || "Untitled file",
            reason: result.reason || "unknown error",
          });
        }
      } catch (error) {
        failures.push({
          fileName: file.name || "Untitled file",
          reason: error instanceof Error && error.message ? error.message : "unknown error",
        });
      }
    }

    if (failures.length > 0) {
      const details = failures.map(({ fileName, reason }) => `${fileName} (${reason})`).join(", ");
      throw new Error(`Failed to flush pending edits before continuing: ${details}`);
    }
  };

  const isPybricksProject = projectUsesPybricks(project);
  const visibleBlockDocuments = isPybricksProject ? blockDocuments : [];
  const currentFile = files.find((f) => f.id === currentFileId);
  const currentBlockDocument = visibleBlockDocuments.find((doc) => doc.id === currentBlockDocumentId) || null;
  const hasBlockDocuments = visibleBlockDocuments.length > 0;
  const isBlockEditorActive = isPybricksProject && hasBlockDocuments && activeEditorKind === "blocks" && !!currentBlockDocument;
  const projectApiId = project?.id ?? null;
  const socketProjectId = projectApiId != null ? String(projectApiId) : null;
  const remoteHubHost = remoteHubSession?.host || null;
  const remoteHubGuest = (remoteHubSession?.guests || []).find((entry) => entry.userId === user?.id) || null;
  const remoteHubPendingUserIds = Array.isArray(remoteHubSession?.pendingUserIds)
    ? remoteHubSession.pendingUserIds
    : [];
  const isRemoteHubHost = Boolean(remoteHubHost && remoteHubHost.userId === user?.id);
  const hasRemoteHubGuestAccess = Boolean(remoteHubGuest);
  const remoteHubRequestPending = Boolean(user?.id && remoteHubPendingUserIds.includes(user.id));
  const remoteHubTakenByOther = Boolean(remoteHubHost && remoteHubHost.userId !== user?.id);
  const isRemoteHubGuestMode = Boolean(isPybricksProject && remoteHubTakenByOther && hasRemoteHubGuestAccess);
  const canConnectLocalPybricksHub = Boolean(isPybricksProject && (!remoteHubHost || isRemoteHubHost));
  const pybricksConnectionBusy = pybricksHubState.status === "connecting";
  const pybricksRuntimeOnline = isPybricksProject
    ? isRemoteHubGuestMode
      ? Boolean(remoteHubHost)
      : pybricksHubState.connected
    : runtimeReady;
  const visibleHubInfo = isRemoteHubGuestMode ? remoteHubHost : pybricksHubState;
  const visibleHubConnected = isRemoteHubGuestMode ? Boolean(remoteHubHost) : pybricksHubState.connected;
  const visibleHubPorts = Array.isArray(visibleHubInfo?.ports) ? visibleHubInfo.ports : [];
  const visibleTelemetryAvailable = Boolean(visibleHubInfo?.telemetryAvailable);
  const visibleActivePorts = visibleTelemetryAvailable
    ? visibleHubPorts.filter((port) => port?.kind && port.kind !== "empty")
    : [];
  const visibleHubTitle = visibleTelemetryAvailable
    ? [
        Number.isFinite(visibleHubInfo?.batteryPercent)
          ? `${visibleHubInfo.batteryPercent}% battery (estimated from voltage)`
          : "",
        Number.isFinite(visibleHubInfo?.batteryVoltage)
          ? `${(visibleHubInfo.batteryVoltage / 1000).toFixed(2)} V`
          : "",
        ...visibleActivePorts.map((port) => `${port.port}: ${port.device || "Device"} ${formatPortReading(port)}`),
      ]
        .filter(Boolean)
        .join(" · ")
    : visibleHubInfo?.telemetryError
      ? visibleHubInfo.telemetryError
      : visibleHubInfo?.hubRunning
        ? "Live hub readings pause while your program is running"
        : "Reading connected ports";

  useEffect(() => {
    if (!visibleHubConnected) setHubInfoOpen(false);
  }, [visibleHubConnected]);

  // The popover is fixed-positioned so it escapes the editor's overflow:hidden
  // clipping; anchor it under the trigger's right edge from the live rect.
  useLayoutEffect(() => {
    if (!hubInfoOpen) {
      setHubInfoPopoverStyle(null);
      return undefined;
    }
    const reposition = () => {
      const trigger = hubInfoTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setHubInfoPopoverStyle({
        top: rect.bottom + 8,
        right: Math.max(12, window.innerWidth - rect.right),
      });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [hubInfoOpen]);

  const [ghostMode, setGhostMode] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const isViewerMode = !canEdit;
  const projectPermissions = project?.permissions || EMPTY_PROJECT_PERMISSIONS;
  const editorDisconnected = !wsConnected;
  const editorCanEdit = canEdit && !editorDisconnected;

  useEffect(() => {
    projectApiIdRef.current = projectApiId;
  }, [projectApiId]);

  useEffect(() => {
    if (!project || !isViewerMode) return;
    if (voiceEnabledRef.current) {
      leaveVoiceCall();
    }
    setSidebarOpen(false);
    setTerminalOpen(true);
  }, [isViewerMode, project]);

  const socket = useMemo(() => {
    if (!socketProjectId) return null;
    const query = { projectId: socketProjectId, token: getToken(), shareToken: shareToken || undefined };
    if (ghostMode) query.ghost = "true";

    const s = io(API_BASE, {
      path: "/socket.io",
      autoConnect: false,
      query,
      transports: ["websocket"],
      forceNew: true,
      multiplex: false,
    });
    socketRef.current = s;
    return s;
  }, [socketProjectId, shareToken, ghostMode]);

  const loadProject = async () => {
    setProjectLoading(true);
    try {
      const res = shareToken
        ? await api.post(`/projects/access/${shareToken}`)
        : await api.get(`/projects/${id}`);
      const projectPayload = freezeSerializable(res.data);
      const resolvedProjectId = res.data.id;
      const projectIsPybricks = projectUsesPybricks(projectPayload);
      setProject(projectPayload);
      setFiles(res.data.files || []);
      setFolders(res.data.folders || []);
      const incomingBlockDocuments = projectIsPybricks ? res.data.block_documents || [] : [];
      setBlockDocuments(incomingBlockDocuments);
      if (!currentFileId && res.data.files?.length) {
        setCurrentFileId(res.data.files[0].id);
      }
      if (!currentBlockDocumentId && incomingBlockDocuments.length) {
        setCurrentBlockDocumentId(incomingBlockDocuments[0].id);
      } else if (!projectIsPybricks || incomingBlockDocuments.length === 0) {
        setCurrentBlockDocumentId(null);
      }
      const initialEditorKind =
        res.data.files?.length ? "file" : projectIsPybricks && incomingBlockDocuments.length ? "blocks" : "file";
      setActiveEditorKind(initialEditorKind);
      setTerminalOpen(initialEditorKind !== "blocks");

      const permissions = projectPayload.permissions || EMPTY_PROJECT_PERMISSIONS;
      setCanEdit(Boolean(permissions.can_edit));
      try {
        const tasksRes = await api.get(`/projects/${resolvedProjectId}/tasks`);
        setTasks(tasksRes.data || []);
      } catch {
        setTasks([]);
      }
      try {
        const snapshotsRes = await api.get(`/projects/${resolvedProjectId}/snapshots`);
        setSnapshots(snapshotsRes.data || []);
      } catch {
        setSnapshots([]);
      }

      if (!permissions.can_edit) {
        // Read Only Mode - Do not connect socket if we don't want them to be seen? 
        // Actually viewers can be seen, but they are read-only.
        // Unless they are just browsing public project anonymously?
        // The socket connects with token. If they are logged in, they appear in presence.
      }

    } catch (err) {
      setError(err.response?.data?.detail || "Project unavailable");
      if (err.response?.status === 403 || err.response?.status === 404) {
        navigate("/");
      }
    } finally {
      setProjectLoading(false);
    }
  };

  const applyProjectTreeState = (data) => {
    const incomingFiles = Array.isArray(data?.files) ? data.files : [];
    const incomingFolders = Array.isArray(data?.folders) ? data.folders : [];
    const incomingBlockDocuments = Array.isArray(data?.blockDocuments) ? data.blockDocuments : [];

    setFiles(incomingFiles);
    setFolders(incomingFolders);
    setBlockDocuments(incomingBlockDocuments);

    incomingFiles.forEach((file) => {
      const st = getCollabState(file.id);
      if (!st) return;
      st.rev = typeof file.rev === "number" ? file.rev : st.rev || 0;
      st.pending = null;
      st.buffer = null;
      st.inFlight = false;
      st.opId = null;
    });

    const activeFileStillExists =
      typeof currentFileIdRef.current === "number" &&
      incomingFiles.some((file) => file.id === currentFileIdRef.current);
    const activeBlockStillExists =
      typeof currentBlockDocumentIdRef.current === "number" &&
      incomingBlockDocuments.some((document) => document.id === currentBlockDocumentIdRef.current);

    if (!activeFileStillExists && activeEditorKindRef.current === "file") {
      if (incomingFiles[0]?.id) {
        setCurrentFileId(incomingFiles[0].id);
        setActiveEditorKind("file");
      } else if (isPybricksProject && incomingBlockDocuments[0]?.id) {
        setCurrentFileId(null);
        setCurrentBlockDocumentId(incomingBlockDocuments[0].id);
        setActiveEditorKind("blocks");
      } else {
        setCurrentFileId(null);
      }
    }

    if (!activeBlockStillExists) {
      setCurrentBlockDocumentId(incomingBlockDocuments[0]?.id || null);
      if (activeEditorKindRef.current === "blocks" && !incomingBlockDocuments[0]?.id) {
        setActiveEditorKind(incomingFiles[0]?.id ? "file" : "file");
        setCurrentFileId(incomingFiles[0]?.id || null);
      }
    }
  };

  useEffect(() => {
    voiceEnabledRef.current = false;
    voicePanelOpenRef.current = false;
    setProject(null);
    setFollowTargetId(null);
    setFollowFlash("");
    setRunHistory([]);
    setRunHistoryOpen(false);
    setActiveRunReplayId(null);
    setCreateFileMenuOpen(false);
    runMetaRef.current = { runId: null, startedAt: 0, fileName: "", capture: null };
    setActivityFeed([]);
    setVoiceParticipants([]);
    setVoiceError("");
    setVoicePanelOpen(false);
    setVoiceEnabled(false);
    setVoiceJoining(false);
    setVoiceMuted(false);
    setBlockDocuments([]);
    setFolders([]);
    setExpandedFolders({});
    setDraggingTreeEntry(null);
    setTreeDropTarget(null);
    setCurrentBlockDocumentId(null);
    setActiveEditorKind("file");
    setShowGeneratedBlockCode(false);
    setGeneratedBlockCode("");
    generatedBlockCodeRef.current = "";
    setRemoteHubSession(null);
    setRemoteHubPendingRequests([]);
    setRemoteHubNotice("");
    setPybricksHubState(createEmptyPybricksHubState());
    setPybricksConnectModalOpen(false);
    setCheckpointInspectorSnapshot(null);
    setCheckpointInspection(null);
    setCheckpointInspectionError("");
    setLoadingCheckpointInspection(false);
    activityBootstrappedRef.current = false;
    mirroredCursorRef.current = { fileId: null, from: -1, to: -1 };
    loadProject();
    return () => {
      const activeProjectId = projectApiIdRef.current;
      if (voiceEnabledRef.current && activeProjectId != null) {
        socketRef.current?.emit("voice_leave", { projectId: String(activeProjectId) });
      }
      clearVoiceConnections();
      stopLocalVoiceStream();
      socketRef.current?.disconnect();
    };
  }, [id]);

  useEffect(() => {
    if (!socket) return;
    socket.connect();
    const handleProjectState = (data) => {
      const incomingTasks = Array.isArray(data?.tasks) ? data.tasks : [];
      const incomingVoice = Array.isArray(data?.voiceParticipants) ? data.voiceParticipants : [];
      setRemoteHubSession(data?.remoteHubSession || null);
      setRemoteHubPendingRequests(
        Array.isArray(data?.remoteHubPendingRequests) ? data.remoteHubPendingRequests : []
      );
      applyProjectTreeState(data);
      setTasks(incomingTasks);
      setVoiceParticipants(
        incomingVoice
          .filter((participant) => participant?.sid)
          .slice()
          .sort((a, b) => (a.user_name || "").localeCompare(b.user_name || ""))
      );
    };

    const handleProjectTreeUpdated = (data) => {
      applyProjectTreeState(data);
    };

    const handleAck = (data) => {
      const fileId = data?.fileId;
      const opId = data?.opId;
      const rev = data?.rev;
      if (!fileId || typeof rev !== "number" || !opId) return;
      const st = getCollabState(fileId);
      if (!st || st.opId !== opId) return;

      st.rev = rev;
      st.pending = null;
      st.opId = null;
      st.inFlight = false;

      if (st.buffer) {
        st.pending = st.buffer;
        st.buffer = null;
        st.opId = makeOpId();
        sendPendingOp(fileId);
      }
    };

    const handleReject = (data) => {
      const fileId = data?.fileId;
      const opId = data?.opId;
      if (!fileId || !opId) return;
      const st = getCollabState(fileId);
      if (!st || st.opId !== opId) return;
      st.inFlight = false;

      const ops = data?.ops;
      if (Array.isArray(ops) && ops.length) {
        ops.forEach((op) => applyIncomingOp({ ...op, fileId }));
      } else {
        socketRef.current?.emit("sync_file", { projectId: socketProjectId, fileId, fromRev: st.rev });
      }
      sendPendingOp(fileId);
    };

    const handleFileOps = (data) => {
      const fileId = data?.fileId;
      const ops = data?.ops;
      if (!fileId || !Array.isArray(ops)) return;
      ops.forEach((op) => applyIncomingOp({ ...op, fileId }));
    };

    const handleFileSync = (data) => {
      const fileId = data?.fileId;
      const content = typeof data?.content === "string" ? data.content : "";
      const rev = typeof data?.rev === "number" ? data.rev : 0;
      if (!fileId) return;

      const st = getCollabState(fileId);
      if (st) {
        st.rev = rev;
        st.pending = null;
        st.buffer = null;
        st.inFlight = false;
        st.opId = null;
      }

      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, content } : f)));

      if (editorViewRef.current && fileId === currentFileIdRef.current) {
        editorViewRef.current.dispatch({
          changes: { from: 0, to: editorViewRef.current.state.doc.length, insert: content },
          annotations: [ExternalChange.of(true)],
        });
      }
    };

    const handlePresence = (data) => {
      const normalizedUsers = (data?.users || []).map((entry) => {
        const blockPresence =
          entry?.block_presence && typeof entry.block_presence === "object"
            ? entry.block_presence
            : null;
        if (!entry?.cursor || typeof entry.cursor !== "object") {
          return { ...entry, cursor: null, block_presence: blockPresence };
        }
        const from = Number.isInteger(entry.cursor.from) ? entry.cursor.from : 0;
        const to = Number.isInteger(entry.cursor.to) ? entry.cursor.to : from;
        const fileId = Number.isInteger(entry.cursor.fileId) ? entry.cursor.fileId : null;
        return { ...entry, cursor: { from, to, fileId }, block_presence: blockPresence };
      });
      const previousUsers = presenceRef.current || [];
      if (activityBootstrappedRef.current) {
        const prevMap = new Map(previousUsers.map((entry) => [entry.user_id, entry]));
        const nextMap = new Map(normalizedUsers.map((entry) => [entry.user_id, entry]));

        normalizedUsers.forEach((entry) => {
          if (entry.user_id === user?.id) return;
          if (!prevMap.has(entry.user_id)) {
            pushActivity({
              kind: "presence",
              text: `${entry.name} joined the workspace`,
              userId: entry.user_id,
            });
          }
        });
        previousUsers.forEach((entry) => {
          if (entry.user_id === user?.id) return;
          if (!nextMap.has(entry.user_id)) {
            pushActivity({
              kind: "presence",
              text: `${entry.name} left the workspace`,
              userId: entry.user_id,
            });
          }
        });
      } else {
        activityBootstrappedRef.current = true;
      }
      presenceRef.current = normalizedUsers;
      setPresence(normalizedUsers);
    };

    const handleTaskCreated = (data) => {
      const task = data?.task;
      if (!task || typeof task.id !== "number") return;
      const creator = task.created_by_name || resolveUserName(task.created_by_user_id);
      pushActivity({
        kind: "task",
        text: `${creator} added task: ${task.content}`,
        userId: task.created_by_user_id,
      });
      setTasks((prev) => {
        const withoutExisting = prev.filter((item) => item.id !== task.id);
        return [task, ...withoutExisting];
      });
    };

    const handleTaskUpdated = (data) => {
      const task = data?.task;
      if (!task || typeof task.id !== "number") return;
      const actor = task.completed_by_name || task.assigned_to_name || resolveUserName(task.created_by_user_id);
      const statusText = task.is_done ? `completed task: ${task.content}` : `updated task: ${task.content}`;
      pushActivity({
        kind: "task",
        text: `${actor} ${statusText}`,
        userId: task.completed_by_user_id || task.assigned_to_user_id || task.created_by_user_id,
      });
      setTasks((prev) => {
        const exists = prev.some((item) => item.id === task.id);
        if (!exists) return [task, ...prev];
        return prev.map((item) => (item.id === task.id ? task : item));
      });
    };

    const handleTaskDeleted = (data) => {
      const taskId = data?.taskId;
      if (typeof taskId !== "number") return;
      pushActivity({
        kind: "task",
        text: "A task was removed from the board",
      });
      setTasks((prev) => prev.filter((item) => item.id !== taskId));
    };

    const handleSnapshotCreated = (data) => {
      const snapshot = data?.snapshot;
      if (!snapshot || typeof snapshot.id !== "number") return;
      pushActivity({
        kind: "checkpoint",
        text: `${snapshot.created_by_name || "A teammate"} created checkpoint: ${snapshot.name}`,
        userId: snapshot.created_by_user_id,
      });
      setSnapshots((prev) => {
        const withoutExisting = prev.filter((item) => item.id !== snapshot.id);
        return [snapshot, ...withoutExisting];
      });
    };

    const handleSnapshotDeleted = (data) => {
      const snapshotId = data?.snapshotId;
      if (typeof snapshotId !== "number") return;
      pushActivity({
        kind: "checkpoint",
        text: "A checkpoint was deleted",
      });
      setSnapshots((prev) => prev.filter((item) => item.id !== snapshotId));
      setCheckpointInspectorSnapshot((prev) => (prev?.id === snapshotId ? null : prev));
      setCheckpointInspection((prev) => (prev?.snapshot?.id === snapshotId ? null : prev));
    };

    const handleSnapshotRestored = (data) => {
      const snapshot = data?.snapshot;
      if (!snapshot || typeof snapshot.id !== "number") return;
      const restoredByName = data?.restoredByName || "A teammate";
      const updatedFiles = typeof data?.updatedFiles === "number" ? data.updatedFiles : null;
      const restoredFileLabel =
        updatedFiles == null ? "files" : `${updatedFiles} file${updatedFiles === 1 ? "" : "s"}`;
      pushActivity({
        kind: "checkpoint",
        text:
          data?.restoreScope === "partial"
            ? `${restoredByName} restored ${restoredFileLabel} from checkpoint: ${snapshot.name}`
            : `${restoredByName} restored checkpoint: ${snapshot.name}${updatedFiles == null ? "" : ` (${restoredFileLabel})`}`,
        userId: data?.restoredByUserId,
      });
      setSnapshots((prev) => {
        const withoutExisting = prev.filter((item) => item.id !== snapshot.id);
        return [snapshot, ...withoutExisting];
      });
    };

    const shouldCreateOfferTo = (targetSid) => {
      const mySid = socketRef.current?.id;
      if (!mySid || !targetSid) return false;
      return mySid > targetSid;
    };

    const handleVoiceState = (data) => {
      const participants = Array.isArray(data?.participants) ? data.participants : [];
      const mySid = socketRef.current?.id;
      const participantIds = new Set(participants.map((participant) => participant?.sid).filter(Boolean));

      setVoiceParticipants(
        participants
          .filter((participant) => participant?.sid)
          .slice()
          .sort((a, b) => (a.user_name || "").localeCompare(b.user_name || ""))
      );

      if (!voiceEnabledRef.current || !mySid) return;

      participants.forEach((participant) => {
        const targetSid = participant?.sid;
        if (!targetSid || targetSid === mySid) return;
        ensurePeerConnection(targetSid, shouldCreateOfferTo(targetSid)).catch(() => {
          setVoiceError("Voice link sync failed. Leaving and rejoining usually fixes it.");
        });
      });

      peerConnectionsRef.current.forEach((_, sid) => {
        if (!participantIds.has(sid)) {
          removeVoiceParticipant(sid);
        }
      });
    };

    const handleVoiceParticipantJoined = (data) => {
      const participant = data?.participant;
      if (!participant?.sid) return;
      upsertVoiceParticipant(participant);
      if (!voiceEnabledRef.current || participant.sid === socketRef.current?.id) return;
      ensurePeerConnection(participant.sid, shouldCreateOfferTo(participant.sid)).catch(() => {
        setVoiceError("Failed to establish voice link.");
      });
    };

    const handleVoiceParticipantLeft = (data) => {
      if (!data?.sid) return;
      removeVoiceParticipant(data.sid);
    };

    const handleVoiceParticipantState = (data) => {
      if (!data?.sid) return;
      upsertVoiceParticipant({
        sid: data.sid,
        user_id: data.userId,
        user_name: data.userName,
        muted: typeof data.muted === "boolean" ? data.muted : undefined,
        speaking: typeof data.speaking === "boolean" ? data.speaking : undefined,
      });
    };

    const handleVoiceOffer = async (data) => {
      const fromSid = data?.fromSid;
      const sdp = data?.sdp;
      if (!fromSid || !sdp || !voiceEnabledRef.current) return;
      try {
        const connection = await ensurePeerConnection(fromSid, false);
        if (!connection) return;
        await connection.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socketRef.current?.emit("voice_answer", {
          projectId: socketProjectId,
          toSid: fromSid,
          sdp: answer,
        });
      } catch {
        setVoiceError("Failed to handle incoming voice offer.");
      }
    };

    const handleVoiceAnswer = async (data) => {
      const fromSid = data?.fromSid;
      const sdp = data?.sdp;
      if (!fromSid || !sdp || !voiceEnabledRef.current) return;
      const connection = peerConnectionsRef.current.get(fromSid);
      if (!connection) return;
      try {
        await connection.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch {
        setVoiceError("Failed to finalize voice connection.");
      }
    };

    const handleVoiceIce = async (data) => {
      const fromSid = data?.fromSid;
      const candidate = data?.candidate;
      if (!fromSid || !candidate || !voiceEnabledRef.current) return;
      const connection = peerConnectionsRef.current.get(fromSid);
      if (!connection) return;
      try {
        await connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ICE packets can race during reconnects; safe to ignore.
      }
    };

    const handleConnect = () => {
      setError((prev) => (prev === "Realtime connection failed." ? "" : prev));
      setVoiceError("");
      emitCursorPresence();
      if (project?.project_type === PROJECT_TYPE_PYBRICKS && pybricksHubStateRef.current?.connected) {
        publishRemoteHubHostState(pybricksHubStateRef.current);
      }
      if (voiceEnabledRef.current && localStreamRef.current) {
        clearVoiceConnections();
        socketRef.current?.emit("voice_join", { projectId: socketProjectId });
        emitVoiceState({ muted: voiceMutedRef.current, speaking: false });
      }
    };
    const handleConnectError = () => {
      setError("Realtime connection failed.");
      if (voiceEnabledRef.current) {
        setVoiceError("Voice call paused while realtime reconnects.");
      }
    };

    const handleSessionChat = (data) => {
      if (!data?.message || !data?.userName) return;
      setSessionChatMessages((prev) => [
        ...prev,
        {
          userId: data.userId,
          userName: data.userName,
          message: data.message,
          timestamp: data.timestamp || new Date().toISOString(),
          isOwn: data.userId === user?.id,
        },
      ]);
    };

    const handleRemoteHubState = (data) => {
      const previousSession = remoteHubSessionRef.current;
      const nextSession = data?.session || null;
      const previouslyApprovedGuest = Boolean(
        previousSession?.host?.userId !== user?.id &&
          (previousSession?.guests || []).some((entry) => entry.userId === user?.id)
      );
      setRemoteHubSession(nextSession);
      if (!nextSession) {
        setRemoteHubPendingRequests([]);
        if (previouslyApprovedGuest) {
          setRunState("stopped");
          setRemoteHubNotice("The remote hub session ended.");
        }
      }
    };

    const handleRemoteHubPendingRequests = (data) => {
      setRemoteHubPendingRequests(Array.isArray(data?.requests) ? data.requests : []);
    };

    const handleRemoteHubRequestResolved = (data) => {
      if (data?.approved) {
        setRemoteHubNotice(`Remote hub access granted by ${data?.hostUserName || "your host"}.`);
        return;
      }
      setRemoteHubNotice(`Remote hub access request declined by ${data?.hostUserName || "your host"}.`);
    };

    const handleRemoteHubAccessRevoked = (data) => {
      setRemoteHubPendingRequests([]);
      setRemoteHubNotice(`${data?.hostUserName || "The host"} removed your remote hub access.`);
      setRunState("stopped");
    };

    const handleRemoteHubHostConflict = (data) => {
      setError(data?.message || "Another collaborator is already hosting the project hub.");
    };

    const handleRemoteHubError = (data) => {
      const message = normalizeTerminalText(data?.message, "Remote hub request failed.");
      appendCompilerOutput(`[remote hub] ${message}\n`);
    };

    const handleRemoteHubExecuteRun = async (data) => {
      if (!isPybricksProject) return;
      const runner = runnerRef.current;
      const runRequest = data?.runRequest;
      if (!runner || !runRequest) return;

      const requestedByUserName = data?.requestedByUserName || "A collaborator";
      relayRemoteHubRunStarted({
        fileName: runRequest.fileName || runMetaRef.current?.fileName || "unknown.py",
        requestedByUserId: data?.requestedByUserId,
        requestedByUserName,
      });

      setOutput("");
      outputRef.current = "";
      setAwaitingInput(false);
      setInputPrompt("");
      setStdinLine("");
      setActiveRunReplayId(null);
      const startedAt = Date.now();
      runMetaRef.current = {
        runId: null,
        startedAt,
        fileName: runRequest.fileName || "unknown.py",
        capture: "",
      };
      appendCompilerOutput(`[remote hub] ${requestedByUserName} started a remote run.\n`);

      try {
        await runner.run(runRequest);
        runMetaRef.current = {
          ...runMetaRef.current,
          runId: runner.currentRunId || null,
        };
        setRunning(true);
        runningRef.current = true;
      } catch (err) {
        const runError =
          normalizeTerminalText(err?.message, "") ||
          normalizeTerminalText(err?.response?.data?.detail, "") ||
          "Run failed";
        appendCompilerOutput(`${runError}\n`);
        relayRemoteHubRuntimeEvent("stderr", { data: `${runError}\n` });
        relayRemoteHubRuntimeEvent("run_result", { runId: null, returnCode: 1 });
        setRunState("stopped");
        finalizeRunHistoryEntry({ runId: null, returnCode: 1 });
      }
    };

    const handleRemoteHubExecuteStop = () => {
      const runner = runnerRef.current;
      if (!runner) return;
      runner.stop().catch((err) => {
        const stopError = normalizeTerminalText(err?.message, "Failed to stop run.");
        appendCompilerOutput(`[compiler] ${stopError}\n`);
        relayRemoteHubRuntimeEvent("stderr", { data: `[compiler] ${stopError}\n` });
      });
    };

    const handleRemoteHubRunStarted = (data) => {
      const currentSession = remoteHubSessionRef.current;
      const amApprovedGuest = Boolean(
        currentSession?.host?.userId !== user?.id &&
          (currentSession?.guests || []).some((entry) => entry.userId === user?.id)
      );
      if (!amApprovedGuest) return;
      setOutput("");
      outputRef.current = "";
      setAwaitingInput(false);
      setInputPrompt("");
      setStdinLine("");
      setActiveRunReplayId(null);
      const startedAt = Date.now();
      runMetaRef.current = {
        runId: null,
        startedAt,
        fileName: data?.fileName || "unknown.py",
        capture: "",
      };
      appendCompilerOutput(
        `[remote hub] ${data?.requestedByUserName || "A collaborator"} started ${data?.fileName || "a run"} on ${data?.hostUserName || "the host"}'s hub.\n`,
      );
      setTerminalOpen(true);
    };

    const handleRemoteHubRuntimeEvent = (data) => {
      const currentSession = remoteHubSessionRef.current;
      const amApprovedGuest = Boolean(
        currentSession?.host?.userId !== user?.id &&
          (currentSession?.guests || []).some((entry) => entry.userId === user?.id)
      );
      if (!amApprovedGuest) return;
      if (data?.kind === "stdout" || data?.kind === "stderr") {
        appendCompilerOutput(normalizeTerminalText(data?.data, ""));
        return;
      }
      if (data?.kind === "status") {
        setRunState(data?.state);
        return;
      }
      if (data?.kind === "run_result") {
        finalizeRunHistoryEntry({ runId: data?.runId || null, returnCode: data?.returnCode });
      }
    };

    socket.on("project_state", handleProjectState);
    socket.on("file_op", applyIncomingOp);
    socket.on("op_ack", handleAck);
    socket.on("op_reject", handleReject);
    socket.on("file_ops", handleFileOps);
    socket.on("file_sync", handleFileSync);
    socket.on("project_tree_updated", handleProjectTreeUpdated);
    socket.on("presence", handlePresence);
    socket.on("task_created", handleTaskCreated);
    socket.on("task_updated", handleTaskUpdated);
    socket.on("task_deleted", handleTaskDeleted);
    socket.on("snapshot_created", handleSnapshotCreated);
    socket.on("snapshot_deleted", handleSnapshotDeleted);
    socket.on("snapshot_restored", handleSnapshotRestored);
    socket.on("voice_state", handleVoiceState);
    socket.on("voice_participant_joined", handleVoiceParticipantJoined);
    socket.on("voice_participant_left", handleVoiceParticipantLeft);
    socket.on("voice_participant_state", handleVoiceParticipantState);
    socket.on("voice_offer", handleVoiceOffer);
    socket.on("voice_answer", handleVoiceAnswer);
    socket.on("voice_ice", handleVoiceIce);
    socket.on("session_chat", handleSessionChat);
    socket.on("remote_hub_state", handleRemoteHubState);
    socket.on("remote_hub_pending_requests", handleRemoteHubPendingRequests);
    socket.on("remote_hub_request_resolved", handleRemoteHubRequestResolved);
    socket.on("remote_hub_access_revoked", handleRemoteHubAccessRevoked);
    socket.on("remote_hub_host_conflict", handleRemoteHubHostConflict);
    socket.on("remote_hub_error", handleRemoteHubError);
    socket.on("remote_hub_execute_run", handleRemoteHubExecuteRun);
    socket.on("remote_hub_execute_stop", handleRemoteHubExecuteStop);
    socket.on("remote_hub_run_started", handleRemoteHubRunStarted);
    socket.on("remote_hub_runtime_event", handleRemoteHubRuntimeEvent);
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.off("project_state", handleProjectState);
      socket.off("file_op", applyIncomingOp);
      socket.off("op_ack", handleAck);
      socket.off("op_reject", handleReject);
      socket.off("file_ops", handleFileOps);
      socket.off("file_sync", handleFileSync);
      socket.off("project_tree_updated", handleProjectTreeUpdated);
      socket.off("presence", handlePresence);
      socket.off("task_created", handleTaskCreated);
      socket.off("task_updated", handleTaskUpdated);
      socket.off("task_deleted", handleTaskDeleted);
      socket.off("snapshot_created", handleSnapshotCreated);
      socket.off("snapshot_deleted", handleSnapshotDeleted);
      socket.off("snapshot_restored", handleSnapshotRestored);
      socket.off("voice_state", handleVoiceState);
      socket.off("voice_participant_joined", handleVoiceParticipantJoined);
      socket.off("voice_participant_left", handleVoiceParticipantLeft);
      socket.off("voice_participant_state", handleVoiceParticipantState);
      socket.off("voice_offer", handleVoiceOffer);
      socket.off("voice_answer", handleVoiceAnswer);
      socket.off("voice_ice", handleVoiceIce);
      socket.off("session_chat", handleSessionChat);
      socket.off("remote_hub_state", handleRemoteHubState);
      socket.off("remote_hub_pending_requests", handleRemoteHubPendingRequests);
      socket.off("remote_hub_request_resolved", handleRemoteHubRequestResolved);
      socket.off("remote_hub_access_revoked", handleRemoteHubAccessRevoked);
      socket.off("remote_hub_host_conflict", handleRemoteHubHostConflict);
      socket.off("remote_hub_error", handleRemoteHubError);
      socket.off("remote_hub_execute_run", handleRemoteHubExecuteRun);
      socket.off("remote_hub_execute_stop", handleRemoteHubExecuteStop);
      socket.off("remote_hub_run_started", handleRemoteHubRunStarted);
      socket.off("remote_hub_runtime_event", handleRemoteHubRuntimeEvent);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.disconnect();
    };
  }, [socket, socketProjectId]);

  // WebSocket ping/pong heartbeat
  useEffect(() => {
    if (!socket) return;

    const handlePong = () => {
      lastPongRef.current = Date.now();
      setWsConnected(true);
    };

    socket.on("pong", handlePong);

    pingIntervalRef.current = setInterval(() => {
      if (socket.connected) {
        socket.emit("ping");
        if (Date.now() - lastPongRef.current > 3000) {
          setWsConnected(false);
        }
      } else {
        setWsConnected(false);
      }
    }, 1000);

    return () => {
      socket.off("pong", handlePong);
      clearInterval(pingIntervalRef.current);
    };
  }, [socket]);

  const handleRefreshEditor = () => {
    window.location.reload();
  };

  const finalizeRunHistoryEntry = ({ runId, returnCode }) => {
    const finishedAt = Date.now();
    const runCode = Number(returnCode);
    const normalizedReturnCode = Number.isFinite(runCode) ? runCode : 1;
    const meta = runMetaRef.current || {};
    const startedAt =
      Number.isFinite(meta.startedAt) && meta.startedAt > 0 && finishedAt >= meta.startedAt
        ? meta.startedAt
        : finishedAt;
    const durationMs = finishedAt - startedAt;
    const rawOutput =
      typeof meta.capture === "string"
        ? meta.capture
        : outputRef.current || "";
    const output =
      rawOutput.length > RUN_HISTORY_OUTPUT_CHAR_LIMIT
        ? rawOutput.slice(-RUN_HISTORY_OUTPUT_CHAR_LIMIT)
        : rawOutput;
    const outputWasTrimmed = output.length !== rawOutput.length;
    const outputLineCount = output ? output.split(/\r?\n/).length : 0;
    const outcome = describeRunOutcome(normalizedReturnCode);
    const historyEntry = {
      id: runId || `${finishedAt}-${Math.random().toString(36).slice(2, 8)}`,
      runId: runId || null,
      fileName: meta.fileName || "unknown.py",
      returnCode: normalizedReturnCode,
      statusTone: outcome.tone,
      statusLabel: outcome.label,
      durationMs,
      finishedAt,
      output,
      outputChars: rawOutput.length,
      outputLineCount,
      outputWasTrimmed,
    };
    setRunHistory((prev) => [historyEntry, ...prev].slice(0, RUN_HISTORY_LIMIT));
    setActiveRunReplayId(null);
    runMetaRef.current = { runId: null, startedAt: 0, fileName: "", capture: null };
    if (liveControlActiveRef.current) {
      liveControlActiveRef.current = false;
      setLiveControlActive(false);
    }
  };

  const setRunState = (state) => {
    const nextRunning = state === "running";
    setRunning(nextRunning);
    runningRef.current = nextRunning;
    if (!nextRunning) {
      setAwaitingInput(false);
      setInputPrompt("");
      if (liveControlActiveRef.current) {
        liveControlActiveRef.current = false;
        setLiveControlActive(false);
      }
    }
  };

  const publishRemoteHubHostState = (nextState) => {
    if (!isPybricksProject || !socketRef.current) return;
    const activeProjectId = projectApiIdRef.current;
    const activeSocketProjectId = activeProjectId != null ? String(activeProjectId) : null;
    if (!activeSocketProjectId) return;
    const currentSession = remoteHubSessionRef.current;
    const amHosting = currentSession?.host?.userId === user?.id;
    if (!nextState?.connected && !amHosting) {
      return;
    }
    socketRef.current.emit("remote_hub_host_state", {
      projectId: activeSocketProjectId,
      connected: Boolean(nextState?.connected),
      deviceName: nextState?.deviceName || "",
      hubType: nextState?.hubType || "",
      firmwareVersion: nextState?.firmwareVersion || "",
      protocolVersion: nextState?.protocolVersion || "",
      transport: nextState?.transport || "",
      transportLabel: nextState?.transportLabel || "",
      hubRunning: Boolean(nextState?.hubRunning),
      batteryState: nextState?.batteryState || "unknown",
      batteryVoltage: Number.isFinite(nextState?.batteryVoltage) ? nextState.batteryVoltage : null,
      batteryPercent: Number.isFinite(nextState?.batteryPercent) ? nextState.batteryPercent : null,
      ports: Array.isArray(nextState?.ports) ? nextState.ports : [],
      motion: nextState?.motion || null,
      buttons: Array.isArray(nextState?.buttons) ? nextState.buttons : [],
      telemetryAvailable: Boolean(nextState?.telemetryAvailable),
      telemetryError: nextState?.telemetryError || "",
      maxUserProgramSize: Number(nextState?.maxUserProgramSize) || 0,
      numOfSlots: Number(nextState?.numOfSlots) || 0,
      selectedSlot: Number(nextState?.selectedSlot) || 0,
      warnings: Array.isArray(nextState?.warnings) ? nextState.warnings : [],
    });
  };

  const relayRemoteHubRunStarted = ({ fileName, requestedByUserId, requestedByUserName }) => {
    if (!isPybricksProject || !socketRef.current) return;
    const activeProjectId = projectApiIdRef.current;
    const activeSocketProjectId = activeProjectId != null ? String(activeProjectId) : null;
    const currentSession = remoteHubSessionRef.current;
    if (!activeSocketProjectId || currentSession?.host?.userId !== user?.id || !currentSession?.guests?.length) return;
    socketRef.current.emit("remote_hub_run_started", {
      projectId: activeSocketProjectId,
      fileName,
      requestedByUserId,
      requestedByUserName,
    });
  };

  const relayRemoteHubRuntimeEvent = (kind, payload = {}) => {
    if (!isPybricksProject || !socketRef.current) return;
    const activeProjectId = projectApiIdRef.current;
    const activeSocketProjectId = activeProjectId != null ? String(activeProjectId) : null;
    const currentSession = remoteHubSessionRef.current;
    if (!activeSocketProjectId || currentSession?.host?.userId !== user?.id || !currentSession?.guests?.length) return;
    socketRef.current.emit("remote_hub_runtime_event", {
      projectId: activeSocketProjectId,
      kind,
      ...payload,
    });
  };

  useEffect(() => {
    if (!project?.project_type) {
      return undefined;
    }

    let active = true;
    setRuntimeReady(false);
    runtimeEverReadyRef.current = false;
    setPybricksHubState(createEmptyPybricksHubState());

    const runner = project.project_type === PROJECT_TYPE_PYBRICKS ? new PybricksRunner({
      onConnectionChange: (state) => {
        if (!active) return;
        setPybricksHubState(state);
        if (!state.connected && liveControlActiveRef.current) {
          liveControlActiveRef.current = false;
          setLiveControlActive(false);
        }
        publishRemoteHubHostState(state);
      },
      onReady: () => {
        if (!active) return;
        setRuntimeReady(true);
        runtimeEverReadyRef.current = true;
      },
      onStatus: ({ state }) => {
        if (!active) return;
        setRunState(state);
        relayRemoteHubRuntimeEvent("status", { state });
      },
      onStdout: (data) => {
        if (!active) return;
        const text = normalizeTerminalText(data, "");
        appendCompilerOutput(text);
        relayRemoteHubRuntimeEvent("stdout", { data: text });
      },
      onStderr: (data) => {
        if (!active) return;
        const text = normalizeTerminalText(data, "");
        appendCompilerOutput(text);
        relayRemoteHubRuntimeEvent("stderr", { data: text });
      },
      onRunResult: ({ runId, returnCode }) => {
        if (!active) return;
        finalizeRunHistoryEntry({ runId, returnCode });
        relayRemoteHubRuntimeEvent("run_result", { runId, returnCode });
      },
      onError: (message) => {
        if (!active) return;
        const errorText = normalizeTerminalText(message, "Runtime failed.");
        if (!runtimeEverReadyRef.current) {
          setRuntimeReady(false);
        }
        setError(errorText);
        appendCompilerOutput(`[compiler] ${errorText}\n`);
      },
    }) : new PyodideRunner({
      onReady: () => {
        if (!active) return;
        setRuntimeReady(true);
        runtimeEverReadyRef.current = true;
      },
      onStatus: ({ state }) => {
        if (!active) return;
        setRunState(state);
      },
      onStdout: (data) => {
        if (!active) return;
        appendCompilerOutput(normalizeTerminalText(data, ""));
      },
      onStderr: (data) => {
        if (!active) return;
        appendCompilerOutput(normalizeTerminalText(data, ""));
      },
      onRunResult: ({ runId, returnCode }) => {
        if (!active) return;
        finalizeRunHistoryEntry({ runId, returnCode });
      },
      onError: (message) => {
        if (!active) return;
        const errorText = normalizeTerminalText(message, "Runtime failed.");
        if (!runtimeEverReadyRef.current) {
          setRuntimeReady(false);
        }
        setError(errorText);
        appendCompilerOutput(`[compiler] ${errorText}\n`);
      },
    });

    runnerRef.current = runner;
    runner.init().catch(() => {
      // Error is handled via onError callback.
    });

    return () => {
      active = false;
      runner.dispose();
      if (runnerRef.current === runner) {
        runnerRef.current = null;
      }
      setRuntimeReady(false);
      runtimeEverReadyRef.current = false;
      setRunning(false);
      runningRef.current = false;
      setLiveControlActive(false);
      liveControlActiveRef.current = false;
      setAwaitingInput(false);
      setInputPrompt("");
    };
  }, [project?.project_type]);

  useEffect(() => {
    if (!terminalBodyRef.current) {
      return;
    }
    terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
  }, [output]);

  useEffect(() => {
    if (awaitingInput && running) {
      stdinInputRef.current?.focus();
    }
  }, [awaitingInput, running]);

  useEffect(() => {
    if (isBlockEditorActive) {
      editorViewRef.current = null;
    }
  }, [isBlockEditorActive]);

  useEffect(() => {
    if (editorViewRef.current) {
      const remote = visibleRemoteCursors(presence, currentFileIdRef.current);
      applyRemoteCursors(remote);
    }
  }, [presence, user, currentFileId]);

  useEffect(() => {
    if (typeof currentFileId !== "number") return;
    const timer = window.setTimeout(() => emitCursorPresence(currentFileId), 0);
    return () => window.clearTimeout(timer);
  }, [currentFileId, socket]);

  useEffect(() => {
    if (!followTargetId) return;
    const followed = (presence || []).find((person) => person.user_id === followTargetId);
    if (!followed) {
      setFollowTargetId(null);
      setFollowFlash("Quantum sync ended because your teammate left.");
      mirroredCursorRef.current = { fileId: null, from: -1, to: -1 };
      return;
    }

    const followedBlockPresence =
      followed?.block_presence && typeof followed.block_presence === "object"
        ? followed.block_presence
        : null;
    const followedBlockDocumentId = Number.isInteger(followedBlockPresence?.documentId)
      ? followedBlockPresence.documentId
      : null;

    if (followedBlockDocumentId) {
      mirroredCursorRef.current = { fileId: null, from: -1, to: -1 };
      if (!isBlockEditorActive || currentBlockDocumentId !== followedBlockDocumentId) {
        selectBlockDocument(followedBlockDocumentId, { closeTerminal: false, preserveFollow: true });
      }
      return;
    }

    if (typeof followed.cursor?.fileId === "number" && followed.cursor.fileId !== currentFileIdRef.current) {
      setCurrentFileId(followed.cursor.fileId);
      setActiveEditorKind("file");
      return;
    }

    if (!editorViewRef.current || !followed.cursor) return;
    if (followed.cursor.fileId !== currentFileIdRef.current) return;
    const view = editorViewRef.current;
    const docLen = view.state.doc.length;
    const clamp = (value) => Math.max(0, Math.min(value, docLen));
    const from = clamp(followed.cursor.from ?? 0);
    const to = clamp(followed.cursor.to ?? from);
    const previous = mirroredCursorRef.current;
    if (previous.fileId === followed.cursor.fileId && previous.from === from && previous.to === to) return;

    mirroredCursorRef.current = { fileId: followed.cursor.fileId, from, to };
    view.dispatch({
      selection: { anchor: from, head: to },
      scrollIntoView: true,
      annotations: [ExternalChange.of(true)],
    });
  }, [currentBlockDocumentId, currentFileId, followTargetId, isBlockEditorActive, presence]);

  useEffect(() => {
    if (!followFlash) return;
    const timer = window.setTimeout(() => setFollowFlash(""), 2800);
    return () => window.clearTimeout(timer);
  }, [followFlash]);

  const onUpdate = (vu) => {
    if (vu.docChanged) {
      const isExternal = vu.transactions.some((tr) => tr.annotation(ExternalChange) === true);
      if (!isExternal && currentFile && canEdit) {
        const st = getCollabState(currentFile.id);
        if (st) {
          if (st.pending) {
            st.buffer = st.buffer ? st.buffer.compose(vu.changes) : vu.changes;
          } else {
            st.pending = vu.changes;
            st.opId = makeOpId();
            st.inFlight = false;
            sendPendingOp(currentFile.id);
          }
        }
      }

      editorViewRef.current?.dispatch({ effects: setRemoteCursors.of([]) });
      return;
    }

    if (vu.selectionSet && currentFile && canEdit) {
      emitCursorPresence(currentFile.id);
    }
  };

  const openCreateFileMenu = () => {
    if (!canEdit) return;
    setSidebarOpen(true);
    setCreateFileMenuOpen((prev) => !prev);
  };

  const createFile = async (kind, parentPath = TREE_ROOT) => {
    if (!canEdit) return;
    if (!projectApiId) return;
    if (kind !== "text" && kind !== "blocks" && kind !== "folder") return;
    if (kind === "blocks" && !isPybricksProject) return;
    setCreateFileMenuOpen(false);
    const namePrompt =
      kind === "blocks" ? "Block file name" : kind === "folder" ? "Folder name" : "Text file name (e.g. utils.py)";
    const name = prompt(namePrompt);
    if (!name) return;

    try {
      if (kind === "folder") {
        const res = await api.post(`/projects/${projectApiId}/folders`, { name, parent_path: parentPath || "" });
        setFolders((prev) => upsertById(prev, res.data));
        setExpandedFolders((prev) => ({ ...prev, [parentPath || TREE_ROOT]: true, [res.data.path]: true }));
        if (isMobileViewport) {
          setSidebarOpen(false);
        }
        return;
      }

      if (kind === "blocks") {
        const res = await api.post(`/projects/${projectApiId}/block-documents`, { name });
        setBlockDocuments((prev) => upsertById(prev, res.data));
        setActiveEditorKind("blocks");
        setCurrentBlockDocumentId(res.data.id);
        if (!running) {
          setTerminalOpen(false);
        }
        if (isMobileViewport) {
          setSidebarOpen(false);
        }
        return;
      }

      const res = await api.post(`/projects/${projectApiId}/files`, {
        name,
        folder_path: parentPath || "",
        content: `# ${name}\n`,
      });
      setFiles((prev) => upsertById(prev, res.data));
      const st = getCollabState(res.data.id);
      if (st) {
        st.rev = 0;
        st.pending = null;
        st.buffer = null;
        st.inFlight = false;
        st.opId = null;
      }
      setCurrentFileId(res.data.id);
      setActiveEditorKind("file");
      if (isMobileViewport) {
        setSidebarOpen(false);
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create that item.");
    }
  };

  const deleteFile = async (fileId) => {
    if (!canEdit) return;
    if (!projectApiId) return;
    if (!confirm("Delete this file?")) return;
    await api.delete(`/projects/${projectApiId}/files/${fileId}`);
    setFiles((prev) => {
      const filtered = prev.filter((f) => f.id !== fileId);
      if (currentFileId === fileId) {
        if (filtered[0]?.id) {
          setCurrentFileId(filtered[0].id);
          setActiveEditorKind("file");
        } else if (isPybricksProject && blockDocumentsRef.current.length) {
          setCurrentFileId(null);
          setCurrentBlockDocumentId(blockDocumentsRef.current[0].id);
          setActiveEditorKind("blocks");
        } else {
          setCurrentFileId(null);
        }
      }
      return filtered;
    });
  };

  const renameFile = async (file) => {
    if (!canEdit) return;
    if (!projectApiId) return;
    const currentName = treeBaseName(file.name);
    const name = prompt("New name", currentName);
    if (!name || name === currentName) return;
    try {
      const res = await api.patch(`/projects/${projectApiId}/files/${file.id}`, {
        name,
        folder_path: treeParentPath(file.name),
      });
      setFiles((prev) => upsertById(prev, res.data));
    } catch (err) {
      setError(err.response?.data?.detail || "Could not rename that file.");
    }
  };

  const renameFolder = async (folder) => {
    if (!canEdit) return;
    if (!projectApiId || !folder?.id) return;
    const currentName = treeBaseName(folder.path);
    const name = prompt("New folder name", currentName);
    if (!name || name === currentName) return;
    try {
      const res = await api.patch(`/projects/${projectApiId}/folders/${folder.id}`, {
        name,
        parent_path: treeParentPath(folder.path),
      });
      setFolders((prev) => upsertById(prev, res.data));
    } catch (err) {
      setError(err.response?.data?.detail || "Could not rename that folder.");
    }
  };

  const deleteFolder = async (folder) => {
    if (!canEdit) return;
    if (!projectApiId || !folder?.id) return;
    if (!confirm(`Delete folder "${treeBaseName(folder.path)}" and everything inside it?`)) return;
    await api.delete(`/projects/${projectApiId}/folders/${folder.id}`);
    const prefix = `${folder.path}/`;
    setFolders((prev) => prev.filter((entry) => entry.id !== folder.id && !entry.path.startsWith(prefix)));
    setFiles((prev) => {
      const filtered = prev.filter((file) => !normalizeTreePath(file.name).startsWith(prefix));
      if (currentFileId && !filtered.some((file) => file.id === currentFileId)) {
        setCurrentFileId(filtered[0]?.id || null);
        if (filtered[0]?.id) setActiveEditorKind("file");
      }
      return filtered;
    });
  };

  const renameBlockDocument = async (document) => {
    if (!canEdit) return;
    if (!projectApiId) return;
    const name = prompt("New block file name", document.name);
    if (!name || name === document.name) return;
    try {
      const res = await api.patch(`/projects/${projectApiId}/block-documents/${document.id}`, { name });
      setBlockDocuments((prev) => upsertById(prev, res.data));
    } catch (err) {
      setError(err.response?.data?.detail || "Could not rename that block file.");
    }
  };

  const deleteBlockDocument = async (documentId) => {
    if (!canEdit) return;
    if (!projectApiId) return;
    if (!confirm("Delete this block file?")) return;
    await api.delete(`/projects/${projectApiId}/block-documents/${documentId}`);
    setBlockDocuments((prev) => {
      const filtered = prev.filter((entry) => entry.id !== documentId);
      if (currentBlockDocumentId === documentId) {
        const nextBlockDocumentId = filtered[0]?.id || null;
        if (nextBlockDocumentId) {
          setCurrentBlockDocumentId(nextBlockDocumentId);
          setActiveEditorKind("blocks");
        } else if (filesRef.current.length) {
          setActiveEditorKind("file");
          setCurrentFileId(filesRef.current[0].id);
        } else {
          setCurrentBlockDocumentId(null);
          setActiveEditorKind("file");
        }
      }
      return filtered;
    });
  };

  const toggleFolderExpanded = (path) => {
    const normalized = normalizeTreePath(path);
    setExpandedFolders((prev) => ({ ...prev, [normalized]: !(prev[normalized] ?? true) }));
  };

  const isFolderExpanded = (path) => expandedFolders[normalizeTreePath(path)] ?? true;

  const handleTreeDragStart = (event, entry) => {
    if (!canEdit) return;
    if (entry.kind !== "file" && entry.kind !== "folder") return;
    if (entry.kind === "folder" && !entry.id) return;
    const payload = {
      kind: entry.kind,
      id: entry.id,
      path: entry.path || entry.fullName || entry.name,
      parentPath: entry.parentPath || TREE_ROOT,
    };
    draggingTreeEntryRef.current = payload;
    setDraggingTreeEntry(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
  };

  const resolveTreeDropTarget = (event, entry) => {
    const activeDrag = draggingTreeEntryRef.current || draggingTreeEntry;
    if (!activeDrag) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;

    if (entry.kind === "folder") {
      if (ratio < 0.25) {
        return { mode: "before", parentPath: entry.parentPath || TREE_ROOT, targetKind: "folder", targetId: entry.id };
      }
      if (ratio > 0.75) {
        return { mode: "after", parentPath: entry.parentPath || TREE_ROOT, targetKind: "folder", targetId: entry.id };
      }
      return { mode: "inside", parentPath: entry.path, targetKind: "folder", targetId: entry.id };
    }

    if (entry.kind === "file") {
      return {
        mode: ratio < 0.5 ? "before" : "after",
        parentPath: entry.parentPath || TREE_ROOT,
        targetKind: "file",
        targetId: entry.id,
      };
    }

    return null;
  };

  const isInvalidFolderDrop = (targetParentPath) => {
    const activeDrag = draggingTreeEntryRef.current || draggingTreeEntry;
    if (!activeDrag || activeDrag.kind !== "folder") return false;
    const draggedPath = normalizeTreePath(activeDrag.path);
    const targetPath = normalizeTreePath(targetParentPath);
    return targetPath === draggedPath || targetPath.startsWith(`${draggedPath}/`);
  };

  const handleTreeDragOver = (event, entry) => {
    const activeDrag = draggingTreeEntryRef.current || draggingTreeEntry;
    if (!activeDrag) return;
    const target = resolveTreeDropTarget(event, entry);
    if (!target || isInvalidFolderDrop(target.parentPath)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setTreeDropTarget(target);
  };

  const handleTreeRootDragOver = (event) => {
    const activeDrag = draggingTreeEntryRef.current || draggingTreeEntry;
    if (!activeDrag || isInvalidFolderDrop(TREE_ROOT)) return;
    const item = event.target.closest?.(".es-file-tree-row");
    if (item) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setTreeDropTarget({ mode: "inside", parentPath: TREE_ROOT, targetKind: "root", targetId: null });
  };

  const sameTreeItem = (entry, item) => entry?.kind === item?.kind && entry?.id === item?.id;

  const handleTreeDrop = async (event) => {
    event.preventDefault();
    const activeDrag = draggingTreeEntryRef.current || draggingTreeEntry;
    if (!canEdit || !projectApiId || !activeDrag || !treeDropTarget) {
      draggingTreeEntryRef.current = null;
      setDraggingTreeEntry(null);
      setTreeDropTarget(null);
      return;
    }

    const targetParentPath = normalizeTreePath(treeDropTarget.parentPath);
    if (isInvalidFolderDrop(targetParentPath)) {
      draggingTreeEntryRef.current = null;
      setDraggingTreeEntry(null);
      setTreeDropTarget(null);
      return;
    }
    if (
      treeDropTarget.mode !== "inside" &&
      treeDropTarget.targetKind === activeDrag.kind &&
      treeDropTarget.targetId === activeDrag.id
    ) {
      draggingTreeEntryRef.current = null;
      setDraggingTreeEntry(null);
      setTreeDropTarget(null);
      return;
    }

    const currentSiblings = (treeEntriesByParent.get(targetParentPath || TREE_ROOT) || [])
      .filter((entry) => (entry.kind === "file" || (entry.kind === "folder" && entry.id)))
      .map((entry) => ({ kind: entry.kind, id: entry.id }));
    const draggedItem = { kind: activeDrag.kind, id: activeDrag.id };
    const nextSiblings = currentSiblings.filter((entry) => !sameTreeItem(entry, draggedItem));

    if (treeDropTarget.mode === "inside") {
      nextSiblings.push(draggedItem);
    } else {
      const targetIndex = nextSiblings.findIndex(
        (entry) => entry.kind === treeDropTarget.targetKind && entry.id === treeDropTarget.targetId
      );
      const insertIndex =
        targetIndex === -1 ? nextSiblings.length : treeDropTarget.mode === "before" ? targetIndex : targetIndex + 1;
      nextSiblings.splice(insertIndex, 0, draggedItem);
    }

    try {
      const res = await api.patch(`/projects/${projectApiId}/tree/move`, {
        kind: activeDrag.kind,
        id: activeDrag.id,
        target_parent_path: targetParentPath,
        ordered_siblings: nextSiblings,
      });
      applyProjectTreeState(res.data);
      if (activeDrag.kind === "folder") {
        setExpandedFolders((prev) => ({ ...prev, [targetParentPath || TREE_ROOT]: true }));
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Could not move that item.");
    } finally {
      draggingTreeEntryRef.current = null;
      setDraggingTreeEntry(null);
      setTreeDropTarget(null);
    }
  };

  const handleTreeDragEnd = () => {
    draggingTreeEntryRef.current = null;
    setDraggingTreeEntry(null);
    setTreeDropTarget(null);
  };

  const selectFile = (fileId) => {
    if (!fileId) return;
    if (activeEditorKind === "file" && fileId === currentFileIdRef.current) return;
    setCreateFileMenuOpen(false);
    setActiveEditorKind("file");
    if (followTargetId) {
      setFollowTargetId(null);
      setFollowFlash("Quantum sync paused after your manual file switch.");
    }
    const view = editorViewRef.current;
    const prevFileId = currentFileIdRef.current;
    if (view && prevFileId) {
      const snapshot = view.state.doc.toString();
      setFiles((prev) => prev.map((f) => (f.id === prevFileId ? { ...f, content: snapshot } : f)));
    }
    mirroredCursorRef.current = { fileId: null, from: -1, to: -1 };
    setCurrentFileId(fileId);
  };

  const selectBlockDocument = (documentId, options = {}) => {
    if (!documentId || !isPybricksProject) return;
    const { closeTerminal = true, preserveFollow = false } = options;
    if (followTargetId && !preserveFollow) {
      setFollowTargetId(null);
      setFollowFlash("Quantum sync paused after your manual file switch.");
    }
    setCreateFileMenuOpen(false);
    setActiveEditorKind("blocks");
    setCurrentBlockDocumentId(documentId);
    if (closeTerminal && !running) {
      setTerminalOpen(false);
    }
  };

  const handleBlockWorkspaceChange = (documentId, workspaceJson) => {
    setBlockDocuments((prev) =>
      prev.map((document) => (document.id === documentId ? { ...document, workspace_json: workspaceJson } : document)),
    );
  };

  const handleGeneratedBlockCodeChange = (code) => {
    setGeneratedBlockCode(code || "");
    generatedBlockCodeRef.current = code || "";
  };

  const appendCompilerOutput = (chunk) => {
    const text = normalizeTerminalText(chunk, "");
    if (!text) return;
    setOutput((prev) => {
      const next = prev + text;
      outputRef.current = next;
      if (typeof runMetaRef.current?.capture === "string") {
        runMetaRef.current.capture += text;
      }
      const prompt = runningRef.current ? inferPendingPrompt(next) : null;
      if (prompt) {
        setAwaitingInput(true);
        setInputPrompt(prompt);
      } else if (runningRef.current) {
        setAwaitingInput(false);
        setInputPrompt("");
      }
      return next;
    });
  };

  const beginRunCapture = (fileName) => {
    setOutput("");
    outputRef.current = "";
    setAwaitingInput(false);
    setInputPrompt("");
    setStdinLine("");
    setActiveRunReplayId(null);
    runMetaRef.current = {
      runId: null,
      startedAt: Date.now(),
      fileName: fileName || "unknown.py",
      capture: "",
    };
  };

  const buildRunRequest = async () => {
    if (!currentFile && !isBlockEditorActive) return null;

    let runtimeFiles = files;
    let entryFileId = currentFile?.id;
    let entryFileName = currentFile?.name;
    let entryFileContent;
    let fileName = currentFile?.name || "unknown.py";

    if (isBlockEditorActive && currentBlockDocument) {
      entryFileId = currentBlockDocument.id * -1;
      entryFileName = currentBlockDocument.generated_entry_module || "main.py";
      entryFileContent = generatedBlockCodeRef.current || generatedBlockCode || "";
      runtimeFiles = files.filter((file) => file.name !== entryFileName);
      fileName = `${currentBlockDocument.name} / ${entryFileName}`;
    } else if (currentFile) {
      await flushEdits(currentFile.id);
      const editorSnapshot = editorViewRef.current?.state.doc.toString();
      runtimeFiles =
        typeof editorSnapshot === "string"
          ? files.map((file) => (file.id === currentFile.id ? { ...file, content: editorSnapshot } : file))
          : files;
    }

    return {
      entryFileId,
      entryFileName,
      entryFileContent,
      files: runtimeFiles,
      fileName,
    };
  };

  const runCode = async () => {
    if (!currentFile && !isBlockEditorActive) return;
    if (isPybricksProject && !canEdit) return;
    setTerminalOpen(true);

    if (isRemoteHubGuestMode) {
      if (!socketRef.current || !socketProjectId) return;
      try {
        const runRequest = await buildRunRequest();
        if (!runRequest) return;
        setOutput("");
        outputRef.current = "";
        setAwaitingInput(false);
        setInputPrompt("");
        setStdinLine("");
        setActiveRunReplayId(null);
        appendCompilerOutput(
          `[remote hub] Sent run request to ${remoteHubHost?.userName || "the host"}.\n`
        );
        socketRef.current.emit("remote_hub_run_request", {
          projectId: socketProjectId,
          runRequest,
        });
      } catch (err) {
        const runError =
          normalizeTerminalText(err?.message, "") ||
          normalizeTerminalText(err?.response?.data?.detail, "") ||
          "Run failed";
        appendCompilerOutput(`[remote hub] ${runError}\n`);
      }
      return;
    }

    const runner = runnerRef.current;
    if (!runner || !runtimeReady) {
      appendCompilerOutput(
        isPybricksProject
          ? "\n[compiler] PyBricks compiler is not ready.\n"
          : "\n[compiler] Browser runtime is not ready.\n",
      );
      return;
    }

    try {
      const runRequest = await buildRunRequest();
      if (!runRequest) return;
      beginRunCapture(runRequest.fileName);
      if (isPybricksProject) {
        relayRemoteHubRunStarted({
          fileName: runRequest.fileName,
          requestedByUserId: user?.id,
          requestedByUserName: user?.display_name || user?.username || "Host",
        });
      }
      await runner.run(runRequest);
      runMetaRef.current = {
        ...runMetaRef.current,
        runId: runner.currentRunId || null,
      };
      setRunning(true);
      runningRef.current = true;
    } catch (err) {
      const runError =
        normalizeTerminalText(err?.message, "") ||
        normalizeTerminalText(err?.response?.data?.detail, "") ||
        "Run failed";
      appendCompilerOutput(`${runError}\n`);
      if (isPybricksProject) {
        relayRemoteHubRuntimeEvent("stderr", { data: `${runError}\n` });
        relayRemoteHubRuntimeEvent("run_result", { runId: null, returnCode: 1 });
      }
      setRunning(false);
      runningRef.current = false;
      runMetaRef.current = { runId: null, startedAt: 0, fileName: "", capture: null };
    }
  };

  const stopCode = () => {
    if (isRemoteHubGuestMode) {
      if (!socketRef.current || !socketProjectId) return;
      socketRef.current.emit("remote_hub_stop_request", { projectId: socketProjectId });
      appendCompilerOutput("[remote hub] Stop request sent to the host.\n");
      return;
    }
    const runner = runnerRef.current;
    if (!runner) return;
    runner.stop().catch((err) => {
      const stopError = normalizeTerminalText(err?.message, "Failed to stop run.");
      appendCompilerOutput(`[compiler] ${stopError}\n`);
    });
  };

  const startLiveControl = async (config) => {
    const runner = runnerRef.current;
    if (!runner || !runtimeReady || !pybricksHubStateRef.current.connected) {
      throw new Error("Connect a PyBricks hub before starting live control.");
    }
    if (runningRef.current) {
      throw new Error("Stop the current program before starting live control.");
    }

    const source = createPybricksLiveControlSource(config);
    beginRunCapture("WASD live control");
    liveControlActiveRef.current = true;
    setTerminalOpen(true);
    appendCompilerOutput("[drive] Building live WASD controller...\n");

    try {
      await runner.run({
        files: [],
        entryFileId: -1,
        entryFileName: "__pycollab_drive__.py",
        entryFileContent: source,
      });
      runMetaRef.current = {
        ...runMetaRef.current,
        runId: runner.currentRunId || null,
      };
      setRunning(true);
      runningRef.current = true;
      setLiveControlActive(true);
    } catch (error) {
      liveControlActiveRef.current = false;
      setLiveControlActive(false);
      setRunning(false);
      runningRef.current = false;
      runMetaRef.current = { runId: null, startedAt: 0, fileName: "", capture: null };
      throw error;
    }
  };

  const sendLiveControlCommand = useCallback((command) => {
    if (!liveControlActiveRef.current) return false;
    return runnerRef.current?.sendStdin(command) || false;
  }, []);

  const sendHubAction = useCallback((command) => runnerRef.current?.sendHubAction(command) || false, []);

  const stopLiveControl = useCallback(async () => {
    const runner = runnerRef.current;
    if (!runner || !liveControlActiveRef.current) return;
    try {
      await runner.sendStdinAsync("x");
    } catch {
      // The transport may already be gone; still ask the runner to stop.
    }
    try {
      await runner.stop();
    } catch (err) {
      const stopError = normalizeTerminalText(err?.message, "Failed to stop live control.");
      appendCompilerOutput(`[drive] ${stopError}\n`);
    }
  }, []);

  const connectPybricksHub = async (transport) => {
    const runner = runnerRef.current;
    if (!runner || !isPybricksProject || !canConnectLocalPybricksHub) return;
    try {
      if (transport === "usb") {
        await runner.connectUsb();
      } else {
        await runner.connectBluetooth();
      }
      setPybricksConnectModalOpen(false);
    } catch (err) {
      const connectError =
        normalizeTerminalText(err?.message, "") ||
        normalizeTerminalText(err?.response?.data?.detail, "") ||
        "Failed to connect to hub.";
      setError(connectError);
      appendCompilerOutput(`[pybricks] ${connectError}\n`);
    }
  };

  const disconnectPybricksHub = async () => {
    const runner = runnerRef.current;
    if (!runner || !isPybricksProject || !canConnectLocalPybricksHub) return;
    try {
      await runner.disconnect();
    } catch (err) {
      const disconnectError = normalizeTerminalText(err?.message, "Failed to disconnect hub.");
      appendCompilerOutput(`[pybricks] ${disconnectError}\n`);
    }
  };

  const clearTerminal = () => {
    setOutput("");
    outputRef.current = "";
    setAwaitingInput(false);
    setInputPrompt("");
    setStdinLine("");
    setActiveRunReplayId(null);
  };

  const replayRunOutput = (run) => {
    if (!run) return;
    if (runningRef.current || running) return;
    setOutput(run.output || "");
    outputRef.current = run.output || "";
    setAwaitingInput(false);
    setInputPrompt("");
    setStdinLine("");
    setActiveRunReplayId(run.id);
    setTerminalOpen(true);
  };

  const clearRunHistory = () => {
    setRunHistory([]);
    setActiveRunReplayId(null);
  };

  const submitInputLine = () => {
    if (!running || isRemoteHubGuestMode) return;
    const runner = runnerRef.current;
    if (!runner) return;
    const line = stdinLine;
    if (runner.sendStdin(`${line}\n`)) {
      appendCompilerOutput(`${line}\n`);
      setStdinLine("");
      setAwaitingInput(false);
      setInputPrompt("");
    } else {
      appendCompilerOutput("\n[compiler] Failed to write stdin.\n");
    }
  };

  const requestRemoteHubAccess = () => {
    if (
      !socketRef.current ||
      !socketProjectId ||
      !remoteHubTakenByOther ||
      remoteHubRequestPending ||
      hasRemoteHubGuestAccess
    ) {
      return;
    }
    socketRef.current.emit("remote_hub_request_access", { projectId: socketProjectId });
    setRemoteHubNotice(`Requested access to ${remoteHubHost?.userName || "the host"}'s hub.`);
  };

  const respondToRemoteHubRequest = (guestUserId, approved) => {
    if (!socketRef.current || !socketProjectId || !isRemoteHubHost) return;
    socketRef.current.emit("remote_hub_respond_request", {
      projectId: socketProjectId,
      guestUserId,
      approved,
    });
  };

  const revokeRemoteHubAccess = (guestUserId) => {
    if (!socketRef.current || !socketProjectId || !isRemoteHubHost) return;
    socketRef.current.emit("remote_hub_revoke_access", {
      projectId: socketProjectId,
      guestUserId,
    });
  };

  const generateSharePin = async () => {
    if (!projectApiId) return;
    const res = await api.post(`/projects/${projectApiId}/share`);
    setSharePin(res.data.token);
    scrollSharePinIntoView();
    setCopiedCode(false);
    setCopiedLink(false);
    setShowShareLink(false);
  };

  const copyShareCode = async () => {
    if (!sharePin) return;
    await navigator.clipboard.writeText(sharePin);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyShareLink = async () => {
    if (!sharePin) return;
    const shareUrl = `${window.location.origin}/share/${sharePin}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const addTask = async () => {
    if (!canEdit) return;
    if (!projectApiId) return;
    const content = taskDraft.trim();
    if (!content) return;
    setSavingTask(true);
    try {
      await api.post(`/projects/${projectApiId}/tasks`, { content });
      setTaskDraft("");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create task.");
    } finally {
      setSavingTask(false);
    }
  };

  const updateTask = async (task, patch) => {
    if (!canEdit || !task?.id) return;
    if (!projectApiId) return;
    try {
      await api.patch(`/projects/${projectApiId}/tasks/${task.id}`, patch);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to update task.");
    }
  };

  const toggleTask = (task) => {
    if (!canEdit || !task?.id) return;
    updateTask(task, { is_done: !task.is_done });
  };

  const toggleTaskOwnership = (task) => {
    if (!canEdit || !task?.id) return;
    const nextAssignee = task.assigned_to_user_id === user?.id ? null : user?.id;
    updateTask(task, { assigned_to_user_id: nextAssignee });
  };

  const removeTask = async (taskId) => {
    if (!canEdit) return;
    if (!projectApiId) return;
    if (!taskId) return;
    if (!confirm("Delete this task?")) return;
    try {
      await api.delete(`/projects/${projectApiId}/tasks/${taskId}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to delete task.");
    }
  };

  const createSnapshot = async () => {
    if (!canEdit) return;
    if (!projectApiId) return;
    if (creatingSnapshot) return;
    setCreatingSnapshot(true);
    try {
      await flushAllEdits();
      const name = snapshotDraft.trim();
      const res = await api.post(`/projects/${projectApiId}/snapshots`, { name: name || undefined });
      if (res.data) {
        setSnapshots((prev) => {
          const withoutExisting = prev.filter((entry) => entry.id !== res.data.id);
          return [res.data, ...withoutExisting];
        });
      }
      setSnapshotDraft("");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create checkpoint.");
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const closeCheckpointInspector = (force = false) => {
    if (!force && restoringSnapshotId != null) return;
    latestInspectRequestIdRef.current += 1;
    setCheckpointInspectorSnapshot(null);
    setCheckpointInspection(null);
    setCheckpointInspectionError("");
    setLoadingCheckpointInspection(false);
  };

  const inspectSnapshot = async (snapshot) => {
    if (!projectApiId || !snapshot?.id) return;
    const requestId = latestInspectRequestIdRef.current + 1;
    latestInspectRequestIdRef.current = requestId;
    setOpenSnapshotMenuId(null);
    setCheckpointInspectorSnapshot(snapshot);
    setCheckpointInspection(null);
    setCheckpointInspectionError("");
    setLoadingCheckpointInspection(true);
    try {
      await flushAllEdits();
      if (requestId !== latestInspectRequestIdRef.current) return;
      const res = await api.get(`/projects/${projectApiId}/snapshots/${snapshot.id}/inspect`);
      if (requestId !== latestInspectRequestIdRef.current) return;
      setCheckpointInspection(res.data || null);
      if (res.data?.snapshot) {
        setCheckpointInspectorSnapshot(res.data.snapshot);
      }
    } catch (err) {
      if (requestId !== latestInspectRequestIdRef.current) return;
      setCheckpointInspectionError(err.response?.data?.detail || "Failed to inspect checkpoint.");
    } finally {
      if (requestId !== latestInspectRequestIdRef.current) return;
      setLoadingCheckpointInspection(false);
    }
  };

  const restoreSnapshot = async (snapshot, options = {}) => {
    if (!canEdit || !snapshot?.id || restoringSnapshotId === snapshot.id) return;
    if (!projectApiId) return;
    setRestoringSnapshotId(snapshot.id);
    try {
      await flushAllEdits();
      const fileNames = Array.isArray(options.fileNames) ? options.fileNames.filter(Boolean) : [];
      const isPartialRestore = fileNames.length > 0;
      const payload = isPartialRestore
        ? {
            file_names: fileNames,
            allow_added_file_deletions: Boolean(options.allowAddedFileDeletions),
            create_safety_snapshot: false,
          }
        : {
            create_safety_snapshot: true,
            safety_snapshot_name: `Before restoring checkpoint: ${snapshot.name}`,
          };
      await api.post(`/projects/${projectApiId}/snapshots/${snapshot.id}/restore`, payload);
      closeCheckpointInspector(true);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to restore checkpoint.");
    } finally {
      setRestoringSnapshotId(null);
    }
  };

  const restoreSelectedSnapshotFiles = async (snapshot, fileNames, options = {}) => {
    if (!Array.isArray(fileNames) || fileNames.length === 0) return;
    await restoreSnapshot(snapshot, {
      fileNames,
      allowAddedFileDeletions: Boolean(options.allowAddedFileDeletions),
    });
  };

  const refreshCheckpointInspector = async () => {
    if (!checkpointInspectorSnapshot?.id) return;
    await inspectSnapshot(checkpointInspectorSnapshot);
  };

  const removeSnapshot = async (snapshotId) => {
    if (!canEdit || !snapshotId) return;
    if (!projectApiId) return;
    if (!confirm("Delete this checkpoint?")) return;
    setOpenSnapshotMenuId(null);
    try {
      await api.delete(`/projects/${projectApiId}/snapshots/${snapshotId}`);
      setSnapshots((prev) => prev.filter((entry) => entry.id !== snapshotId));
      if (checkpointInspectorSnapshot?.id === snapshotId) {
        closeCheckpointInspector();
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to delete checkpoint.");
    }
  };

  const exportSnapshot = async (snapshot) => {
    if (!projectApiId || !snapshot?.id || exportingSnapshotId === snapshot.id) return;
    setOpenSnapshotMenuId(null);
    setExportingSnapshotId(snapshot.id);
    try {
      const res = await api.get(`/projects/${projectApiId}/snapshots/${snapshot.id}/export`, {
        responseType: "blob",
      });
      downloadBlob(res.data, checkpointArchiveFileName(project?.name, snapshot.name));
    } catch (err) {
      let message = "Failed to export checkpoint.";
      if (err.response?.data instanceof Blob) {
        try {
          const payload = JSON.parse(await err.response.data.text());
          message = payload?.detail || message;
        } catch {
          // Fall back to the generic message when the error body is not JSON.
        }
      } else {
        message = err.response?.data?.detail || message;
      }
      setError(message);
    } finally {
      setExportingSnapshotId(null);
    }
  };

  const exportProjectBundle = async () => {
    if (!projectApiId || exportingProjectBundle) return;
    setExportingProjectBundle(true);
    try {
      const res = await api.get(`/projects/${projectApiId}/export`, {
        responseType: "blob",
      });
      downloadBlob(res.data, projectBundleFileName(project?.name));
    } catch (err) {
      let message = "Failed to export project.";
      if (err.response?.data instanceof Blob) {
        try {
          const payload = JSON.parse(await err.response.data.text());
          message = payload?.detail || message;
        } catch {
          // Fall back to the generic message when the error body is not JSON.
        }
      } else {
        message = err.response?.data?.detail || message;
      }
      setError(message);
    } finally {
      setExportingProjectBundle(false);
    }
  };

  useEffect(() => {
    if (openSnapshotMenuId == null) return;

    const handlePointerDown = (event) => {
      if (event.target instanceof Element && event.target.closest(".es-snapshot-actions")) {
        return;
      }
      setOpenSnapshotMenuId(null);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpenSnapshotMenuId(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openSnapshotMenuId]);

  useEffect(() => {
    const handleShortcuts = (event) => {
      const key = event.key.toLowerCase();
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;
      const isQuickSearch = hasPrimaryModifier && !event.shiftKey && key === "k";
      const isProjectSearch = hasPrimaryModifier && !event.shiftKey && key === "f";
      const isToggleSidebar = hasPrimaryModifier && event.shiftKey && key === "s";
      const isRunShortcut = (hasPrimaryModifier && key === "enter") || event.key === "F5";
      const isStopShortcut = event.key === "F6";

      if (isProjectSearch) {
        event.preventDefault();
        setCommandPaletteOpen(false);
        setProjectSearchOpen(true);
        return;
      }

      if (isQuickSearch) {
        event.preventDefault();
        setCommandPaletteQuery("");
        setCommandPaletteOpen(true);
        return;
      }

      if (isToggleSidebar) {
        event.preventDefault();
        setSidebarOpen((prev) => !prev);
        return;
      }

      if (isRunShortcut) {
        event.preventDefault();
        runCode();
        return;
      }

      if (isStopShortcut) {
        event.preventDefault();
        stopCode();
      }
    };

    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [runCode, stopCode]);

  useEffect(() => {
    const selection = pendingSearchSelectionRef.current;
    if (!selection || selection.fileId !== currentFileId || !editorViewRef.current) return;
    pendingSearchSelectionRef.current = null;
    requestAnimationFrame(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const from = Math.min(selection.from, view.state.doc.length);
      const to = Math.min(selection.to, view.state.doc.length);
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
      view.focus();
    });
  }, [currentFileId]);

  const openProjectSearchResult = (result) => {
    if (!result) return;
    pendingSearchSelectionRef.current = result;
    setActiveEditorKind("file");
    setCurrentFileId(result.fileId);
    if (result.fileId === currentFileIdRef.current && editorViewRef.current) {
      const view = editorViewRef.current;
      pendingSearchSelectionRef.current = null;
      const docLen = view.state.doc.length;
      const safeFrom = Math.max(0, Math.min(result.from, docLen));
      const safeTo = Math.max(0, Math.min(result.to, docLen));
      view.dispatch({
        selection: { anchor: safeFrom, head: safeTo },
        scrollIntoView: true,
      });
      view.focus();
    }
  };

  // --- Session Chat (ephemeral) ---
  const sendSessionChatMessage = () => {
    const msg = sessionChatInput.trim();
    if (!msg || !socketRef.current?.connected || !socketProjectId) return;
    socketRef.current.emit("session_chat", { projectId: socketProjectId, message: msg });
    setSessionChatInput("");
  };

  const { extensions: pythonIntelligenceExtensions } = usePythonIntelligence({
    files,
    currentFile,
    isPybricksProject,
    runtimeApiBase: API_BASE,
  });
  const extensions = useMemo(
    () => [
      indentUnit.of(PYTHON_INDENT),
      EditorState.tabSize.of(PYTHON_INDENT.length),
      python(),
      codeFolding(),
      codeFoldingRibbon,
      keymap.of([indentWithTab]),
      Prec.highest(keymap.of([
        { key: "Enter", run: insertPythonNewlineAndIndent },
        { key: "Escape", run: escapePythonIndent },
      ])),
      ...pythonIntelligenceExtensions,
      EditorView.lineWrapping,
      remoteCursorField,
    ],
    [pythonIntelligenceExtensions]
  );

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.is_done !== b.is_done) return Number(a.is_done) - Number(b.is_done);
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return bTime - aTime;
      }),
    [tasks]
  );
  const visibleTasks = useMemo(() => {
    if (!showOnlyMyTasks || !user?.id) return sortedTasks;
    return sortedTasks.filter((task) => task.assigned_to_user_id === user.id);
  }, [showOnlyMyTasks, sortedTasks, user?.id]);
  const sortedSnapshots = useMemo(
    () =>
      [...snapshots].sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return bTime - aTime;
      }),
    [snapshots]
  );
  const fileNameById = useMemo(() => {
    const mapping = new Map();
    files.forEach((file) => {
      mapping.set(file.id, file.name);
    });
    return mapping;
  }, [files]);
  const blockDocumentNameById = useMemo(() => {
    const mapping = new Map();
    visibleBlockDocuments.forEach((document) => {
      mapping.set(document.id, document.name);
    });
    return mapping;
  }, [visibleBlockDocuments]);
  const editorTree = useMemo(
    () => buildEditorTree({ files, folders, blockDocuments: visibleBlockDocuments, query: fileSearch }),
    [fileSearch, files, folders, visibleBlockDocuments]
  );
  const filteredEditorEntries = editorTree.root?.children || [];
  const treeEntriesByParent = editorTree.entriesByParent;
  const flattenedEditorEntries = useMemo(() => {
    const entries = [];
    const walk = (items) => {
      items.forEach((entry) => {
        if (entry.kind === "folder") {
          walk(entry.children || []);
          return;
        }
        entries.push(entry);
      });
    };
    walk(filteredEditorEntries);
    return entries;
  }, [filteredEditorEntries]);
  const followTarget = useMemo(
    () => (presence || []).find((person) => person.user_id === followTargetId) || null,
    [presence, followTargetId]
  );
  const openTaskCount = tasks.filter((task) => !task.is_done).length;
  const myTaskCount = tasks.filter((task) => task.assigned_to_user_id === user?.id && !task.is_done).length;
  const latestRun = runHistory[0] || null;
  const successfulRunCount = runHistory.filter((item) => item.returnCode === 0).length;
  const latestRunSummary = latestRun
    ? `${latestRun.statusLabel} • ${formatRunDuration(latestRun.durationMs)} • exit ${latestRun.returnCode}`
    : "";
  const isTextFileActive = (fileId) => activeEditorKind === "file" && currentFileId === fileId;
  const isBlockFileActive = (documentId) => isBlockEditorActive && currentBlockDocumentId === documentId;
  const isEditorEntryActive = (entry) =>
    entry.kind === "blocks" ? isBlockFileActive(entry.id) : entry.kind === "file" ? isTextFileActive(entry.id) : false;
  const openEditorEntry = (entry) => {
    if (!entry) return;
    if (entry.kind === "blocks") {
      selectBlockDocument(entry.id);
    } else if (entry.kind === "file") {
      selectFile(entry.id);
    } else {
      return;
    }
    if (isMobileViewport) {
      setActiveSidebarScreen("");
      setCreateFileMenuOpen(false);
      setSidebarOpen(false);
    }
  };
  const stdinPlaceholder =
    isRemoteHubGuestMode
      ? "Remote hub stdin is host-only"
      : !running
      ? "Run code first"
      : awaitingInput && inputPrompt
      ? inputPrompt
      : "Type input and press Enter";
  const recentActivity = activityFeed.slice(0, 24);
  const workspaceActivity = recentActivity;
  const sidebarPresencePreview = (presence || []).slice(0, 3);
  const sidebarPresenceOverflow = Math.max(0, presence.length - sidebarPresencePreview.length);
  const doneTaskCount = Math.max(0, tasks.length - openTaskCount);
  const voiceParticipantCount = voiceParticipants.length;
  const commandPaletteItems = useMemo(() => {
    const query = commandPaletteQuery.trim();
    return flattenedEditorEntries
      .map((entry) => ({ entry, score: fuzzyFileScore(entry.fullName || entry.name, query) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map(({ entry }) => {
        const full = entry.fullName || entry.name;
        const slash = full.lastIndexOf("/");
        const name = slash >= 0 ? full.slice(slash + 1) : full;
        const dir = slash >= 0 ? full.slice(0, slash) : "";
        return {
          key: entry.key,
          title: name,
          subtitle: dir || undefined,
          badge: isEditorEntryActive(entry) ? "Open" : entry.kind === "blocks" ? "Blocks" : undefined,
          icon: entry.kind === "blocks" ? <FiZap size={14} /> : <FiFile size={14} />,
          onSelect: () => openEditorEntry(entry),
        };
      });
  }, [
    commandPaletteQuery,
    flattenedEditorEntries,
    activeEditorKind,
    currentFileId,
    currentBlockDocumentId,
    isBlockEditorActive,
  ]);

  const formatActivityTime = (ts) =>
    new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const jumpToActivity = (activity) => {
    if (!activity?.fileId) return;
    selectFile(activity.fileId);
  };

  const openSidebarScreen = (screen) => {
    setCreateFileMenuOpen(false);
    setActiveSidebarScreen(screen);
  };

  const renderSidebarAvatar = (person, className = "es-presence-avatar") => {
    const name = person?.name || "User";
    if (person?.avatar) {
      return (
        <img
          src={person.avatar.startsWith("http") ? person.avatar : `${API_BASE}${person.avatar}`}
          className={className}
          alt={name}
        />
      );
    }
    return (
      <span className={`${className} fallback`} style={{ background: person?.color || "var(--primary)" }}>
        {name.charAt(0).toUpperCase()}
      </span>
    );
  };

  const renderTaskDetails = () => (
    <>
      <div className="es-task-detail-toolbar">
        <button
          type="button"
          className={`es-task-filter ${showOnlyMyTasks ? "active" : ""}`}
          onClick={() => setShowOnlyMyTasks((prev) => !prev)}
        >
          {showOnlyMyTasks ? `Mine (${myTaskCount})` : "All tasks"}
        </button>
        <span className="es-badge">{openTaskCount} open</span>
      </div>
      {canEdit && (
        <div className="es-task-compose">
          <input
            className="es-task-input"
            type="text"
            value={taskDraft}
            maxLength={240}
            placeholder="Add a collaboration task..."
            onChange={(event) => setTaskDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTask();
              }
            }}
            disabled={savingTask}
          />
          <button type="button" className="es-task-add" onClick={addTask} disabled={savingTask || !taskDraft.trim()}>
            <FiPlus size={13} />
          </button>
        </div>
      )}
      <div className="es-task-list">
        {visibleTasks.map((task) => (
          <div key={task.id} className={`es-task-item ${task.is_done ? "done" : ""}`}>
            <button type="button" className="es-task-toggle" onClick={() => toggleTask(task)} disabled={!canEdit}>
              {task.is_done ? <FiCheck size={12} /> : <FiSquare size={12} />}
            </button>
            <div className="es-task-main">
              <span className="es-task-content">{task.content}</span>
              <span className="es-task-meta">
                {task.is_done ? `Done by ${task.completed_by_name || "team"}` : `Added by ${task.created_by_name || "team"}`}
                {task.assigned_to_name ? ` · Assigned to ${task.assigned_to_name}` : " · Unassigned"}
              </span>
            </div>
            {canEdit && (
              <div className="es-task-row-actions">
                <button
                  type="button"
                  className={`es-task-assign ${task.assigned_to_user_id === user?.id ? "active" : ""}`}
                  onClick={() => toggleTaskOwnership(task)}
                  title={task.assigned_to_user_id === user?.id ? "Release task" : "Take task"}
                >
                  {task.assigned_to_user_id === user?.id ? "Release" : "Take"}
                </button>
                <button type="button" className="es-task-delete" onClick={() => removeTask(task.id)} title="Delete task">
                  <FiTrash2 size={11} />
                </button>
              </div>
            )}
          </div>
        ))}
        {visibleTasks.length === 0 && (
          <div className="es-empty">
            {showOnlyMyTasks ? "No assigned tasks in your focus list." : "No tasks yet. Add the first one."}
          </div>
        )}
      </div>
    </>
  );

  const renderCheckpointDetails = () => (
    <>
      {canEdit && (
        <div className="es-snapshot-compose">
          <input
            className="es-snapshot-input"
            type="text"
            value={snapshotDraft}
            maxLength={120}
            placeholder="Checkpoint name (optional)"
            onChange={(event) => setSnapshotDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                createSnapshot();
              }
            }}
            disabled={creatingSnapshot}
          />
          <button
            type="button"
            className="es-snapshot-add"
            onClick={createSnapshot}
            disabled={creatingSnapshot}
            title="Create checkpoint"
          >
            {creatingSnapshot ? "..." : "Save"}
          </button>
        </div>
      )}
      <div className="es-snapshot-list">
        {sortedSnapshots.map((snapshot) => (
          <div key={snapshot.id} className="es-snapshot-item">
            <button
              type="button"
              className="es-snapshot-main"
              onClick={() => inspectSnapshot(snapshot)}
              title={`Inspect checkpoint ${snapshot.name}`}
            >
              <span className="es-snapshot-name">{snapshot.name}</span>
              <span className="es-snapshot-meta">
                {snapshot.created_by_name || "Team"} · {snapshot.file_count || 0} files ·{" "}
                {snapshot.created_at
                  ? new Date(snapshot.created_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Unknown time"}
              </span>
            </button>
            <div className="es-snapshot-actions">
              <button
                type="button"
                className="es-snapshot-menu-trigger"
                onClick={() => setOpenSnapshotMenuId((prev) => (prev === snapshot.id ? null : snapshot.id))}
                aria-label={`Checkpoint actions for ${snapshot.name}`}
                aria-expanded={openSnapshotMenuId === snapshot.id}
                title="Checkpoint actions"
              >
                <FiMoreVertical size={14} />
              </button>
              {openSnapshotMenuId === snapshot.id && (
                <div className="es-snapshot-menu" role="menu">
                  <button type="button" className="es-snapshot-menu-item" onClick={() => inspectSnapshot(snapshot)}>
                    View changes
                  </button>
                  <button
                    type="button"
                    className="es-snapshot-menu-item"
                    onClick={() => exportSnapshot(snapshot)}
                    disabled={!projectApiId || exportingSnapshotId === snapshot.id}
                  >
                    {exportingSnapshotId === snapshot.id ? "Exporting..." : "Export"}
                  </button>
                  {canEdit && (
                    <button type="button" className="es-snapshot-menu-item danger" onClick={() => removeSnapshot(snapshot.id)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {sortedSnapshots.length === 0 && <div className="es-empty">No checkpoints yet.</div>}
      </div>
    </>
  );

  const formatWorkspaceLocation = (person) => {
    if (Number.isInteger(person?.block_presence?.documentId)) {
      return `editing ${blockDocumentNameById.get(person.block_presence.documentId) || "a block file"}`;
    }
    if (typeof person?.cursor?.fileId === "number") {
      return `editing ${fileNameById.get(person.cursor.fileId) || "an untitled file"}`;
    }
    return "online in workspace";
  };

  const renderWorkspacePanel = () => (
    <div className="es-workspace-card">
      <div className="es-workspace-title">Workspace</div>
      <div className="es-workspace-people">
        {(presence || []).slice(0, 3).map((person) => {
          const isSessionHost = remoteHubHost?.userId === person.user_id;
          const hasGuestAccess = Boolean(
            (remoteHubSession?.guests || []).some((entry) => entry.userId === person.user_id)
          );

          return (
            <div className="es-workspace-row" key={person.user_id}>
              {renderSidebarAvatar(person, "es-workspace-avatar")}
              <span className="es-workspace-main">
                <span className="es-workspace-name">{person.name}</span>
                <span className="es-workspace-meta">{formatWorkspaceLocation(person)}</span>
                {isPybricksProject && isSessionHost && (
                  <span className="es-workspace-hub-status">
                    <FiWifi size={11} />
                    {person.user_id === user?.id
                      ? `Hosting ${remoteHubHost?.deviceName || "LEGO Hub"}`
                      : `Connected to ${remoteHubHost?.deviceName || "LEGO Hub"}`}
                  </span>
                )}
                {isPybricksProject && hasGuestAccess && !isSessionHost && (
                  <span className="es-workspace-hub-status">
                    <FiZap size={11} />
                    Remote hub access
                  </span>
                )}
              </span>
              <span className="es-workspace-actions">
                {isPybricksProject &&
                  isSessionHost &&
                  person.user_id !== user?.id &&
                  !hasRemoteHubGuestAccess &&
                  !remoteHubRequestPending &&
                  !isRemoteHubHost && (
                    <button type="button" className="es-workspace-action" onClick={requestRemoteHubAccess}>
                      Join Hub
                    </button>
                  )}
                {isPybricksProject &&
                  isSessionHost &&
                  person.user_id !== user?.id &&
                  remoteHubRequestPending &&
                  !hasRemoteHubGuestAccess &&
                  !isRemoteHubHost && <span className="es-workspace-action-label">Pending</span>}
                {isPybricksProject && isRemoteHubHost && hasGuestAccess && person.user_id !== user?.id && (
                  <button
                    type="button"
                    className="es-workspace-action danger"
                    onClick={() => revokeRemoteHubAccess(person.user_id)}
                  >
                    Remove
                  </button>
                )}
                <span className="es-workspace-dot" />
              </span>
            </div>
          );
        })}
        {presence.length === 0 && (
          <div className="es-workspace-row">
            {renderSidebarAvatar({ name: user?.display_name || user?.username || "You" }, "es-workspace-avatar")}
            <span className="es-workspace-main">
              <span className="es-workspace-name">{user?.display_name || user?.username || "You"}</span>
              <span className="es-workspace-meta">waiting for collaborators</span>
            </span>
            <span className="es-workspace-dot" />
          </div>
        )}
      </div>
      <div className="es-workspace-divider" />
      <div className="es-workspace-activity">
        {workspaceActivity.map((entry) => {
          const clickable = typeof entry.fileId === "number";
          const activityPerson = entry.userId
            ? (presence || []).find((person) => person.user_id === entry.userId)
            : null;
          return (
            <button
              type="button"
              className={`es-workspace-row activity ${clickable ? "clickable" : ""}`}
              key={entry.id}
              onClick={() => clickable && jumpToActivity(entry)}
              disabled={!clickable}
              title={clickable ? `Jump to ${resolveFileName(entry.fileId)}` : entry.text}
            >
              {renderSidebarAvatar(activityPerson || { name: "bot", color: "rgba(247, 247, 242, 0.2)" }, "es-workspace-avatar")}
              <span className="es-workspace-main">
                <span className="es-workspace-activity-text">{entry.text}</span>
              </span>
              <span className="es-workspace-time">{formatActivityTime(entry.ts)}</span>
              <span className="es-workspace-dot" />
            </button>
          );
        })}
        {workspaceActivity.length === 0 && <div className="es-empty">No activity yet.</div>}
      </div>
    </div>
  );

  const startSidebarResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const maxWidth = Math.min(MAX_EDITOR_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.42));
    document.body.classList.add("resizing-editor-sidebar");

    const handlePointerMove = (moveEvent) => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setSidebarWidth(clampNumber(nextWidth, MIN_EDITOR_SIDEBAR_WIDTH, maxWidth));
    };

    const stopResize = () => {
      document.body.classList.remove("resizing-editor-sidebar");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const startTerminalResize = (event) => {
    if (event.button !== 0 || !terminalOpen) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = terminalHeight;
    const maxHeight = Math.min(MAX_TERMINAL_HEIGHT, Math.floor(window.innerHeight * 0.62));
    document.body.classList.add("resizing-editor-terminal");

    const handlePointerMove = (moveEvent) => {
      const nextHeight = startHeight + startY - moveEvent.clientY;
      setTerminalHeight(clampNumber(nextHeight, MIN_TERMINAL_HEIGHT, maxHeight));
    };

    const stopResize = () => {
      document.body.classList.remove("resizing-editor-terminal");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const terminalPanelHeight = isMobileViewport ? "min(42dvh, 300px)" : `${terminalHeight}px`;
  const runDisabled =
    (!currentFile && !isBlockEditorActive) ||
    running ||
    (
      isPybricksProject
        ? !canEdit ||
          (isRemoteHubGuestMode
            ? !remoteHubHost
            : !pybricksHubState.connected)
        : !runtimeReady
    );
  const runButtonLabel = running
    ? "Running..."
    : isPybricksProject
      ? isRemoteHubGuestMode
        ? "Run on Host Hub"
        : "Download & Run"
      : "Run Code";
  const mobileRunLabel = running ? "Running" : "Run";
  const showSkeletons = skeletonDebugEnabled();
  const editorSkeletonActive = showSkeletons || projectLoading;

  const renderEditorTreeEntry = (entry, depth = 0) => {
    const isActive = isEditorEntryActive(entry);
    const isFolder = entry.kind === "folder";
    const isFile = entry.kind === "file";
    const isBlocks = entry.kind === "blocks";
    const isExpanded = isFolder ? isFolderExpanded(entry.path) : false;
    const canDragEntry = canEdit && (isFile || (isFolder && entry.id));
    const isDragging =
      draggingTreeEntry && draggingTreeEntry.kind === entry.kind && draggingTreeEntry.id === entry.id;
    const isDropTarget =
      treeDropTarget &&
      ((treeDropTarget.mode === "inside" && isFolder && treeDropTarget.targetKind === "folder" && treeDropTarget.targetId === entry.id) ||
        (treeDropTarget.mode !== "inside" && treeDropTarget.targetKind === entry.kind && treeDropTarget.targetId === entry.id));
    const dropClass = isDropTarget ? `drop-${treeDropTarget.mode}` : "";
    const file = isFile ? files.find((item) => item.id === entry.id) : null;
    const document = isBlocks ? blockDocuments.find((item) => item.id === entry.id) : null;
    const folder = isFolder ? folders.find((item) => item.id === entry.id) : null;

    return (
      <div key={entry.key} className="es-file-tree-node">
        <div className="es-file-tree-row-wrap">
          {isActive && (
            <motion.div
              layoutId="activeFileBg"
              className="es-file-active-bg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          )}
          <motion.div
            layout
            className={`es-file-item es-file-tree-row ${isActive ? "active" : ""} ${isFolder ? "folder" : ""} ${isDragging ? "dragging" : ""} ${dropClass}`}
            style={{ "--tree-depth": depth }}
            draggable={canDragEntry}
            onDragStart={(event) => handleTreeDragStart(event, entry)}
            onDragOver={(event) => (isFile || isFolder ? handleTreeDragOver(event, entry) : undefined)}
            onDrop={handleTreeDrop}
            onDragEnd={handleTreeDragEnd}
            onClick={() => {
              if (isFolder) {
                toggleFolderExpanded(entry.path);
                return;
              }
              openEditorEntry(entry);
            }}
            whileHover={{ x: 2 }}
          >
            <span className="es-file-name" title={entry.path || entry.fullName || entry.name}>
              {isFolder && (
                <button
                  type="button"
                  className="es-folder-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFolderExpanded(entry.path);
                  }}
                  aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
                >
                  {isExpanded ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
                </button>
              )}
              {isBlocks ? (
                <FiZap size={13} className="es-file-icon-py" />
              ) : isFolder ? (
                <FiFolder size={14} className="es-folder-icon" />
              ) : (
                <FiFile size={13} className={(entry.fullName || entry.name).endsWith(".py") ? "es-file-icon-py" : "es-file-icon"} />
              )}
              <span className="es-file-label">{entry.name}</span>
            </span>
            <div className="es-file-actions">
              {canEdit && (
                <>
                  {isFolder && entry.id && (
                    <>
                      <button
                        type="button"
                        className="es-file-action"
                        title="New file in folder"
                        onClick={(event) => {
                          event.stopPropagation();
                          createFile("text", entry.path);
                        }}
                      >
                        <FiFilePlus size={11} />
                      </button>
                      <button
                        type="button"
                        className="es-file-action"
                        title="New folder inside"
                        onClick={(event) => {
                          event.stopPropagation();
                          createFile("folder", entry.path);
                        }}
                      >
                        <FiFolderPlus size={11} />
                      </button>
                    </>
                  )}
                  {(isFile || isBlocks || (isFolder && entry.id)) && (
                    <button
                      type="button"
                      className="es-file-action"
                      title="Rename"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isBlocks && document) {
                          renameBlockDocument(document);
                        } else if (isFolder && folder) {
                          renameFolder(folder);
                        } else if (file) {
                          renameFile(file);
                        }
                      }}
                    >
                      <FiEdit2 size={11} />
                    </button>
                  )}
                  {(isFile || isBlocks || (isFolder && entry.id)) && (
                    <button
                      type="button"
                      className="es-file-action danger"
                      title="Delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isBlocks) {
                          deleteBlockDocument(entry.id);
                        } else if (isFolder && folder) {
                          deleteFolder(folder);
                        } else {
                          deleteFile(entry.id);
                        }
                      }}
                    >
                      <FiTrash2 size={11} />
                    </button>
                  )}
                </>
              )}
            </div>
            {isActive && <span className="es-file-live-dot" aria-hidden="true" />}
          </motion.div>
        </div>
        {isFolder && isExpanded && entry.children?.length > 0 && (
          <div className="es-folder-children">{entry.children.map((child) => renderEditorTreeEntry(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div
      className="editor-shell"
      style={{
        "--editor-sidebar-width": `${sidebarWidth}px`,
        "--terminal-height": terminalPanelHeight,
      }}
    >
      <AnimatePresence>
        {!isViewerMode && !isMobileViewport && !sidebarOpen && (
          <motion.aside
            initial={{ x: -40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -40, opacity: 0 }}
            className="editor-rail"
          >
            <button className="icon-btn" onClick={() => setSidebarOpen(true)} title="Open Sidebar">
              <FiMenu size={18} />
            </button>
            <button className="icon-btn" onClick={() => navigate("/")} title="Return to Dashboard">
              <FiHome size={18} />
            </button>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!isViewerMode && sidebarOpen && (
          <motion.aside
            className="editor-sidebar"
            initial={isMobileViewport ? { x: "-100%", opacity: 1 } : { x: -260, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={isMobileViewport ? { x: "-100%", opacity: 1 } : { x: -260, opacity: 0 }}
            transition={{ duration: 0.25, ease: "circOut" }}
          >
            <div className="es-header">
              <button
                type="button"
                className="es-back-btn es-dashboard-back"
                onClick={() => {
                  if (activeSidebarScreen) {
                    setActiveSidebarScreen("");
                  } else {
                    navigate("/");
                  }
                }}
                title={activeSidebarScreen ? "Back to sidebar" : "Back to dashboard"}
                aria-label={activeSidebarScreen ? "Back to sidebar" : "Back to dashboard"}
              >
                <FiChevronLeft size={18} />
              </button>
              <div className="es-project-heading">
                <div className="es-project-name">
                  {editorSkeletonActive ? <Skeleton className="skeleton-editor-title" /> : project?.name || "Untitled project"}
                </div>
                <div className="es-project-presence">
                  <span className={`es-presence-dot ${wsConnected ? "online" : ""}`} />
                  <span>{presence.length} online</span>
                  {sidebarPresencePreview.length > 0 && (
                    <span className="es-presence-stack" aria-label={`${presence.length} online`}>
                      {sidebarPresencePreview.map((person) => (
                        <span className="es-presence-avatar-wrap" key={person.user_id}>
                          {renderSidebarAvatar(person)}
                        </span>
                      ))}
                      {sidebarPresenceOverflow > 0 && <span className="es-presence-overflow">+{sidebarPresenceOverflow}</span>}
                    </span>
                  )}
                </div>
              </div>
              <div className="es-header-actions">
                <button type="button" className="es-icon-btn" onClick={() => setSidebarOpen(false)} title="Collapse Sidebar">
                  <FiMenu size={17} />
                </button>
              </div>
            </div>

            {activeSidebarScreen ? (
              <motion.div
                key={activeSidebarScreen}
                className="es-sidebar-screen"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <div className="es-sidebar-screen-header">
                  <div className="es-sidebar-screen-title-wrap">
                    <span className="es-sidebar-screen-title">
                      {activeSidebarScreen === "tasks" ? `Tasks (${openTaskCount})` : `Checkpoints (${sortedSnapshots.length})`}
                    </span>
                    <span className="es-sidebar-screen-subtitle">
                      {activeSidebarScreen === "tasks"
                        ? openTaskCount === 0
                          ? "No open tasks"
                          : `${openTaskCount} open, ${doneTaskCount} done`
                        : sortedSnapshots.length === 1
                          ? "1 saved checkpoint"
                          : `${sortedSnapshots.length} saved checkpoints`}
                    </span>
                  </div>
                </div>
                <div className="es-sidebar-screen-body">
                  {activeSidebarScreen === "tasks" ? renderTaskDetails() : renderCheckpointDetails()}
                </div>
              </motion.div>
            ) : (
              <>
                {(project?.description || projectPermissions.can_manage) && (
                  <div className="es-description">
                    <p
                      className={`es-description-text ${projectPermissions.can_manage ? "editable" : ""}`}
                      onClick={
                        projectPermissions.can_manage
                          ? () => {
                              const newDesc = prompt("Enter project description:", project?.description || "");
                              if (newDesc !== null) {
                                api
                                  .patch(`/projects/${projectApiId}`, { name: project?.name, description: newDesc })
                                  .then((res) => setProject(freezeSerializable(res.data)))
                                  .catch(console.error);
                              }
                            }
                          : undefined
                      }
                    >
                      {project?.description || <span className="es-description-empty">Add a description...</span>}
                    </p>
                  </div>
                )}

                <div className="es-section es-files-section">
                  <div className="es-file-group-header">
                    <button
                      type="button"
                      className={`es-file-group-toggle ${filesCollapsed ? "collapsed" : ""}`}
                      onClick={() => setFilesCollapsed((prev) => !prev)}
                      aria-expanded={!filesCollapsed}
                      title={filesCollapsed ? "Show files" : "Hide files"}
                    >
                      <FiChevronDown size={15} />
                    </button>
                    <span className="es-file-group-title">Files</span>
                    {canEdit && (
                      <div className="es-create-file-menu-wrap es-file-create-menu-wrap" ref={createFileMenuRef}>
                        <button
                          type="button"
                          className={`es-icon-btn es-file-create-btn${createFileMenuOpen ? " active" : ""}`}
                          onClick={openCreateFileMenu}
                          title="New file"
                        >
                          <FiPlus size={14} />
                        </button>
                        {createFileMenuOpen && (
                          <div className="es-create-file-menu" role="menu" aria-label="Create file">
                            <button type="button" className="es-create-file-option" onClick={() => createFile("text")}>
                              <FiFile size={13} />
                              <span>Text File</span>
                            </button>
                            <button type="button" className="es-create-file-option" onClick={() => createFile("folder")}>
                              <FiFolderPlus size={13} />
                              <span>Folder</span>
                            </button>
                            {isPybricksProject && (
                              <button type="button" className="es-create-file-option" onClick={() => createFile("blocks")}>
                                <FiZap size={13} />
                                <span>Block File</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <AnimatePresence initial={false}>
                    {!filesCollapsed && (
                      <motion.div
                        key="files"
                        className="es-file-collapse-body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                      >
                        <div className="es-file-search-row">
                          <div className="es-search-wrap">
                            <FiSearch className="es-search-icon" size={13} />
                            <input
                              ref={fileSearchInputRef}
                              className="es-search-input"
                              placeholder="Search files..."
                              value={fileSearch}
                              onChange={(e) => setFileSearch(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="es-file-list-shell">
                          <div
                            className={`es-file-list es-file-tree ${treeDropTarget?.targetKind === "root" ? "drop-root" : ""}`}
                            onDragOver={handleTreeRootDragOver}
                            onDrop={handleTreeDrop}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget)) {
                                setTreeDropTarget(null);
                              }
                            }}
                          >
                            {editorSkeletonActive ? (
                              <div className="skeleton-stack skeleton-file-tree">
                                {Array.from({ length: 8 }).map((_, index) => (
                                  <Skeleton key={index} className="skeleton-file-row" />
                                ))}
                              </div>
                            ) : (
                              <>
                                {filteredEditorEntries.map((entry) => renderEditorTreeEntry(entry))}
                                {filteredEditorEntries.length === 0 && <div className="es-empty">No matching files.</div>}
                              </>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {renderWorkspacePanel()}

                <div className="es-summary-stack">
                  <div className="es-summary-card">
                    <button
                      type="button"
                      className="es-summary-card-button"
                      onClick={() => openSidebarScreen("tasks")}
                    >
                      <span className="es-summary-icon tasks">
                        <FiCheck size={18} />
                      </span>
                      <span className="es-summary-main">
                        <span className="es-summary-title">Tasks ({openTaskCount})</span>
                        <span className="es-summary-subtitle">
                          {openTaskCount === 0 ? "No tasks yet" : `${openTaskCount} open, ${doneTaskCount} done`}
                        </span>
                      </span>
                      <FiChevronDown className="es-summary-chevron" size={18} />
                    </button>
                  </div>

                  <div className="es-summary-card">
                    <button
                      type="button"
                      className="es-summary-card-button"
                      onClick={() => openSidebarScreen("checkpoints")}
                    >
                      <span className="es-summary-icon checkpoints">
                        <FiCopy size={17} />
                      </span>
                      <span className="es-summary-main">
                        <span className="es-summary-title">Checkpoints ({sortedSnapshots.length})</span>
                        <span className="es-summary-subtitle">
                          {sortedSnapshots.length === 1 ? "1 checkpoint" : `${sortedSnapshots.length} checkpoints`}
                        </span>
                      </span>
                      <FiChevronDown className="es-summary-chevron" size={18} />
                    </button>
                  </div>
                </div>

                <div className="es-footer">
                  {projectPermissions.can_toggle_visibility && (
                    <button
                      type="button"
                      className="es-visibility-btn"
                      onClick={() => {
                        const newVisibility = project?.is_public ? "Private" : "Public";
                        if (confirm(`Change visibility to ${newVisibility}?`)) {
                          api
                            .patch(`/projects/${projectApiId}/visibility`)
                            .then((res) => setProject(freezeSerializable(res.data)))
                            .catch(console.error);
                        }
                      }}
                    >
                      {project?.is_public ? <><FiEye size={13} /> Public</> : <><FiEyeOff size={13} /> Private</>}
                    </button>
                  )}
                  <div className="es-footer-row">
                    <button type="button" className="es-share-btn" onClick={exportProjectBundle} disabled={!projectApiId || exportingProjectBundle}>
                      <FiDownload size={13} /> {exportingProjectBundle ? "Exporting..." : "Export"}
                    </button>
                    {projectPermissions.can_share && (
                      <button type="button" className="es-share-btn" onClick={generateSharePin}>
                        <FiShare2 size={13} /> Share
                      </button>
                    )}
                  </div>
                  <AnimatePresence>
                    {sharePin && (
                      <motion.div
                        key="share-pin"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="es-pin-card"
                        ref={sharePinCardRef}
                      >
                        <div className="es-pin-row">
                          <div className="es-pin-meta">
                            <span className="es-pin-label">Share Code</span>
                            <span className="es-pin-code">{sharePin}</span>
                          </div>
                          <div className="es-pin-actions">
                            <button type="button" className="es-icon-btn" onClick={copyShareCode} title="Copy share code">
                              {copiedCode ? <FiCheck size={14} color="var(--success)" /> : <FiCopy size={14} />}
                            </button>
                            <button type="button" className="es-pin-link-toggle" onClick={() => setShowShareLink((prev) => !prev)}>
                              {showShareLink ? "Hide Link" : "Show Link"}
                            </button>
                          </div>
                        </div>
                        {showShareLink && (
                          <div className="es-pin-row es-pin-link-row">
                            <div className="es-pin-meta">
                              <span className="es-pin-label">Share Link</span>
                              <span className="es-pin-url">{window.location.origin}/share/{sharePin}</span>
                            </div>
                            <button type="button" className="es-icon-btn" onClick={copyShareLink} title="Copy share link">
                              {copiedLink ? <FiCheck size={14} color="var(--success)" /> : <FiCopy size={14} />}
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {!isViewerMode && !isMobileViewport && sidebarOpen && (
        <div
          className="panel-resizer vertical editor-divider"
          onPointerDown={startSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
        />
      )}

      <main className="editor-workspace">
        <header className={`editor-topbar ${isViewerMode ? "viewer-topbar-mode" : ""}`}>
          <div className="editor-topbar-left">
            {isViewerMode ? (
              <div className="viewer-topbar-shell">
                <button className="icon-btn viewer-back-btn" onClick={() => navigate("/")} title="Return to Dashboard">
                  <FiChevronLeft size={16} />
                </button>
                <div className="viewer-file-switcher">
                  <div className="viewer-file-search">
                    <FiSearch className="viewer-file-search-icon" size={13} />
                    <input
                      className="viewer-file-search-input"
                      placeholder="Search files..."
                      value={fileSearch}
                      onChange={(event) => setFileSearch(event.target.value)}
                    />
                  </div>
                  <div className="viewer-file-tabs" role="tablist" aria-label="Project files">
                    {flattenedEditorEntries.map((entry) => (
                      <button
                        key={`viewer-${entry.key}`}
                        className={`viewer-file-tab ${isEditorEntryActive(entry) ? "active" : ""}`}
                        onClick={() => openEditorEntry(entry)}
                        role="tab"
                        aria-selected={isEditorEntryActive(entry)}
                      >
                        {entry.kind === "blocks" ? <FiZap size={12} /> : <FiFile size={12} />}
                        <span>{entry.fullName || entry.name}</span>
                      </button>
                    ))}
                    {flattenedEditorEntries.length === 0 && <span className="viewer-file-empty">No matching files.</span>}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="editor-file">
                  <div className="editor-file-icon">
                    {isBlockEditorActive ? (
                      <FiZap size={18} className="file-icon" />
                    ) : currentFile?.name?.endsWith(".py") ? (
                      <FiFile size={18} className="file-icon" />
                    ) : (
                      <FiFile size={18} className="muted" />
                    )}
                  </div>
                  <div className="editor-file-meta">
                    <div className="editor-file-name">
                      {editorSkeletonActive ? (
                        <Skeleton className="skeleton-editor-file-name" />
                      ) : (
                        <>
                          {isBlockEditorActive ? currentBlockDocument?.name || "Blocks" : currentFile?.name || "No file selected"}
                          <span className={`editor-file-badge ${isViewerMode ? "viewer" : "editor"}`}>
                            {isViewerMode ? "Viewer" : "Editable"}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="editor-file-path muted">
                      {editorSkeletonActive ? (
                        <Skeleton className="skeleton-editor-file-path" />
                      ) : isBlockEditorActive ? (
                        `/workspace/${currentBlockDocument?.generated_entry_module || "main.py"}`
                      ) : (
                        `/root/${currentFile?.name}`
                      )}
                    </div>
                  </div>
                </div>
                <div className="editor-status">
                  {ghostMode ? (
                    <span className="chip chip-muted">Ghost Mode</span>
                  ) : (
                    <span className={`chip ${canEdit ? "chip-success" : "chip-muted"}`}>
                      {canEdit ? "Live Editing" : "Viewer Mode"}
                    </span>
                  )}
                  {isPybricksProject && (
                    <span
                      className={`chip ${
                        (isRemoteHubGuestMode || pybricksHubState.connected) ? "chip-success" : "chip-muted"
                      }`}
                    >
                      {isRemoteHubGuestMode
                        ? `${remoteHubHost?.userName || "Remote"} Hub`
                        : pybricksHubState.connected
                          ? `${pybricksHubState.transportLabel} Hub`
                          : remoteHubTakenByOther
                            ? `${remoteHubHost?.userName || "Host"} Hosting`
                            : "Hub Offline"}
                    </span>
                  )}
                  {followTarget && (
                    <button
                      className="chip chip-follow"
                      onClick={() => {
                        setFollowTargetId(null);
                        mirroredCursorRef.current = { fileId: null, from: -1, to: -1 };
                        setFollowFlash("Quantum sync disabled.");
                      }}
                      title="Stop quantum sync"
                    >
                      Synced to {followTarget.name}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="editor-topbar-actions">
            {!isViewerMode && (
              <>
                {isMobileViewport && (
                  <button
                    className="icon-btn"
                    onClick={() => setSidebarOpen(true)}
                    title="Open files"
                  >
                    <FiMenu size={16} />
                  </button>
                )}
                <button
                  className={`icon-btn${sessionChatOpen ? " active" : ""}`}
                  onClick={() => setSessionChatOpen((prev) => !prev)}
                  title={sessionChatOpen ? "Hide Session Chat" : "Session Chat"}
                >
                  <FiMessageSquare size={16} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setTerminalOpen((prev) => !prev)}
                  title={terminalOpen ? "Hide Terminal" : "Show Terminal"}
                >
                  <FiTerminal size={16} />
                </button>
                <button
                  className={`icon-btn${projectSearchOpen ? " active" : ""}`}
                  onClick={() => {
                    setCommandPaletteOpen(false);
                    setProjectSearchOpen(true);
                  }}
                  title="Search project (Cmd/Ctrl+F)"
                >
                  <FiSearch size={16} />
                </button>
                {isBlockEditorActive && (
                  <button
                    className={`icon-btn${showGeneratedBlockCode ? " active" : ""}`}
                    onClick={() => setShowGeneratedBlockCode((prev) => !prev)}
                    title={showGeneratedBlockCode ? "Hide generated Python" : "View generated Python"}
                  >
                    <FiCode size={16} />
                  </button>
                )}
                {isPybricksProject && visibleHubConnected && (
                  <div className="hub-info-control">
                    <button
                      ref={hubInfoTriggerRef}
                      type="button"
                      className={`hub-info-trigger ${hubInfoOpen ? "active" : ""}`}
                      onClick={() => setHubInfoOpen((open) => !open)}
                      title={visibleHubTitle || "Hub port readings are starting"}
                      aria-expanded={hubInfoOpen}
                    >
                      <span className="hub-info-battery">
                        {visibleTelemetryAvailable && Number.isFinite(visibleHubInfo?.batteryPercent)
                          ? `${visibleHubInfo.batteryPercent}%`
                          : visibleHubInfo?.telemetryError
                            ? "Readings unavailable"
                          : visibleHubInfo?.hubRunning
                            ? "Readings paused"
                            : "Reading…"}
                      </span>
                      {visibleActivePorts.slice(0, 2).map((port) => (
                        <span className="hub-info-port-summary" key={port.port}>
                          <strong>{port.port}</strong> {formatPortReading(port)}
                        </span>
                      ))}
                      <FiChevronDown size={13} />
                    </button>
                    {hubInfoOpen && (
                      <div className="hub-info-popover" style={hubInfoPopoverStyle || undefined}>
                        <HubInfoPanel
                          hub={visibleHubInfo}
                          isRemoteGuest={isRemoteHubGuestMode}
                          remoteHostName={remoteHubHost?.userName}
                          onAction={!isRemoteHubGuestMode && canEdit ? sendHubAction : undefined}
                        />
                      </div>
                    )}
                  </div>
                )}
                {isPybricksProject && canConnectLocalPybricksHub && canEdit && (
                  <PybricksLiveControl
                    projectId={projectApiId}
                    hubType={pybricksHubState.hubType}
                    connected={pybricksHubState.connected}
                    running={running}
                    active={liveControlActive}
                    onStart={startLiveControl}
                    onCommand={sendLiveControlCommand}
                    onStop={stopLiveControl}
                  />
                )}
                {isPybricksProject && canConnectLocalPybricksHub && (
                  <button
                    className={`btn ${pybricksHubState.connected ? "btn-ghost pybricks-connect-btn-connected" : "btn-primary pybricks-connect-btn"}`}
                    onClick={() => (pybricksHubState.connected ? disconnectPybricksHub() : setPybricksConnectModalOpen(true))}
                    disabled={pybricksConnectionBusy || !runtimeReady}
                    title={pybricksHubState.connected ? "Disconnect hub" : "Connect a PyBricks hub"}
                  >
                    {pybricksHubState.connected ? <FiWifi size={14} /> : <FiWifiOff size={14} />}
                    {pybricksConnectionBusy
                      ? "Connecting..."
                      : pybricksHubState.connected
                        ? `${pybricksHubState.transportLabel} Connected`
                        : "Connect Hub"}
                  </button>
                )}
                {canEdit && voiceEnabled && (
                  <button
                    className={`icon-btn${voicePanelOpen ? " active" : ""}`}
                    onClick={() => setVoicePanelOpen((prev) => !prev)}
                    title={voicePanelOpen ? "Hide call controls" : "Show call controls"}
                  >
                    <FiUsers size={16} />
                    <span className="voice-count-pill">{voiceParticipantCount}</span>
                  </button>
                )}
                {canEdit && (
                  <button
                    className={`btn ${voiceEnabled ? "btn-ghost voice-leave-btn" : "btn-primary voice-join-btn"}`}
                    onClick={() => (voiceEnabled ? leaveVoiceCall() : joinVoiceCall())}
                    disabled={voiceJoining}
                    title={voiceEnabled ? "Leave voice call" : "Join voice call"}
                  >
                    {voiceEnabled ? <FiPhoneOff size={14} /> : <FiPhoneCall size={14} />}
                    {voiceJoining ? "Joining..." : voiceEnabled ? "Leave Call" : "Join Call"}
                  </button>
                )}
              </>
            )}
            {(!isPybricksProject || !isViewerMode) && (
              <>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="btn btn-primary editor-run-btn"
                  disabled={runDisabled}
                  onClick={runCode}
                >
                  {running ? <div className="spinner" style={{ width: 16, height: 16, border: "2px solid currentColor", borderTopColor: "transparent" }} /> : <FiPlay fill="currentColor" />}
                  {runButtonLabel}
                </motion.button>
                <button className="btn btn-ghost editor-stop-btn" disabled={!running} onClick={stopCode}>
                  <FiSquare size={14} /> Stop
                </button>
              </>
            )}
          </div>
          <AnimatePresence>
            {pybricksConnectModalOpen && isPybricksProject && (
              <motion.div
                className="modal-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => !pybricksConnectionBusy && setPybricksConnectModalOpen(false)}
              >
                <motion.div
                  className="panel modal-card pybricks-connect-modal"
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="project-type-modal-header">
                    <div>
                      <div className="panel-title">Connect PyBricks Hub</div>
                      <div className="muted project-type-modal-subtitle">Choose the hub connection transport for this project.</div>
                    </div>
                    <button
                      className="btn-ghost modal-close"
                      onClick={() => setPybricksConnectModalOpen(false)}
                      disabled={pybricksConnectionBusy}
                      title="Close"
                    >
                      <FiX size={18} />
                    </button>
                  </div>

                  <div className="project-type-option-grid pybricks-connect-option-grid">
                    <button
                      className="project-type-option project-type-option-pybricks"
                      onClick={() => connectPybricksHub("bluetooth")}
                      disabled={pybricksConnectionBusy}
                    >
                      <span className="project-type-option-icon">
                        <FiWifi size={18} />
                      </span>
                      <span className="project-type-option-title">Bluetooth</span>
                      <span className="project-type-option-copy">Use the Pybricks BLE profile, matching the browser flow in Pybricks Code.</span>
                    </button>

                    <button
                      className="project-type-option"
                      onClick={() => connectPybricksHub("usb")}
                      disabled={pybricksConnectionBusy}
                    >
                      <span className="project-type-option-icon">
                        <FiZap size={18} />
                      </span>
                      <span className="project-type-option-title">Wired</span>
                      <span className="project-type-option-copy">Use the Pybricks USB interface for a direct wired connection.</span>
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {!isViewerMode && voiceEnabled && voicePanelOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="voice-panel"
              >
                <div className="voice-panel-head">
                  <span className="voice-panel-title">
                    <FiVolume2 size={14} />
                    Voice room ({voiceParticipantCount})
                  </span>
                  <button className="icon-btn voice-panel-close" onClick={() => setVoicePanelOpen(false)} title="Close voice controls">
                    <FiChevronDown size={14} />
                  </button>
                </div>
                <div className="voice-panel-controls">
                  <button className={`voice-control-btn ${voiceMuted ? "active" : ""}`} onClick={toggleVoiceMute}>
                    {voiceMuted ? <FiMicOff size={13} /> : <FiMic size={13} />}
                    {voiceMuted ? "Muted" : "Mic On"}
                  </button>
                </div>
                {voiceError && <div className="voice-panel-error">{voiceError}</div>}
                <div className="voice-participants">
                  {voiceParticipants.map((participant) => {
                    const isSelf = participant.user_id === user?.id;
                    const muted = !!participant.muted;
                    const speaking = !!participant.speaking && !muted;
                    return (
                      <div key={participant.sid} className={`voice-participant ${speaking ? "speaking" : ""}`}>
                        <span className="voice-participant-name">
                          {participant.user_name || `User ${participant.user_id}`}
                          {isSelf ? " (You)" : ""}
                        </span>
                        <span className="voice-participant-state">
                          {muted ? <FiMicOff size={12} /> : <FiMic size={12} />}
                          {muted ? "Muted" : speaking ? "Speaking" : "Listening"}
                        </span>
                      </div>
                    );
                  })}
                  {voiceParticipants.length === 0 && <div className="voice-empty">No one is in voice yet.</div>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!isViewerMode && voiceError && !voiceEnabled && <div className="voice-inline-error">{voiceError}</div>}
          {isPybricksProject && remoteHubNotice && (
            <div className="remote-hub-banner" role="status">
              <FiZap size={14} />
              <span>{remoteHubNotice}</span>
            </div>
          )}
          {isPybricksProject && isRemoteHubHost && remoteHubPendingRequests.length > 0 && (
            <div className="remote-hub-request-stack">
              {remoteHubPendingRequests.map((request) => (
                <div key={request.userId} className="remote-hub-request-card">
                  <div className="remote-hub-request-copy">
                    <strong>{request.userName}</strong> wants to join your hub session.
                  </div>
                  <div className="remote-hub-request-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => respondToRemoteHubRequest(request.userId, true)}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => respondToRemoteHubRequest(request.userId, false)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </header>

        <div className={`editor-workspace-body ${terminalOpen ? "" : "terminal-collapsed"}`}>
          <div className="panel editor-pane">
            <div className="editor-pane-scroll">
              {isViewerMode && (
                <div className="viewer-mode-banner" role="status">
                  <FiEye size={14} />
                  <span>
                    {isPybricksProject
                      ? "Viewer mode: browse files safely. Collaboration controls and hub tools are hidden."
                      : "Viewer mode: browse files and run code safely. Collaboration controls and editing tools are hidden."}
                  </span>
                </div>
              )}
              {editorSkeletonActive ? (
                <div className="editor-code-skeleton editor-code-skeleton-inline" aria-hidden="true">
                  {Array.from({ length: 18 }).map((_, index) => (
                    <Skeleton key={index} className="skeleton-code-line" style={{ "--line-index": index }} />
                  ))}
                </div>
              ) : isBlockEditorActive ? (
                <PybricksBlocksEditor
                  blockDocument={currentBlockDocument}
                  socket={socket}
                  socketProjectId={socketProjectId}
                  canEdit={editorCanEdit}
                  presence={presence}
                  currentUserId={user?.id}
                  followPresence={
                    followTarget?.block_presence?.documentId === currentBlockDocument?.id
                      ? followTarget.block_presence
                      : null
                  }
                  onWorkspaceJsonChange={handleBlockWorkspaceChange}
                  onGeneratedCodeChange={handleGeneratedBlockCodeChange}
                  onToggleGeneratedCodeRequest={() => setShowGeneratedBlockCode((prev) => !prev)}
                  showGeneratedCode={showGeneratedBlockCode}
                />
              ) : (
                // Remount per file to keep undo history and other editor state isolated between files.
                <CodeMirror
                  key={currentFile?.id ?? "no-file"}
                  height="100%"
                  value={currentFile?.content || ""}
                  extensions={extensions}
                  theme={editorTheme}
                  readOnly={!editorCanEdit}
                  onCreateEditor={(view) => (editorViewRef.current = view)}
                  onUpdate={onUpdate}
                  basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: false }}
                />
              )}
            </div>
            {editorDisconnected && (
              <div className="editor-disconnect-blocker" role="alertdialog" aria-modal="true" aria-labelledby="editor-disconnect-title">
                <div className="editor-disconnect-panel">
                  <FiWifiOff className="editor-disconnect-icon" aria-hidden="true" />
                  <div className="editor-disconnect-copy">
                    <h2 id="editor-disconnect-title">Editor disconnected</h2>
                    <p>Refresh before editing. Changes made while disconnected will not sync and can be lost.</p>
                  </div>
                  <button className="btn btn-primary editor-disconnect-refresh" onClick={handleRefreshEditor} type="button">
                    <FiRefreshCw size={16} /> Refresh editor
                  </button>
                </div>
              </div>
            )}
            <ProjectSearch
              open={projectSearchOpen}
              files={files}
              currentFileId={activeEditorKind === "file" ? currentFileId : null}
              onClose={() => setProjectSearchOpen(false)}
              onSelect={openProjectSearchResult}
            />
          </div>

          <div
            className="panel-resizer horizontal editor-divider"
            onPointerDown={startTerminalResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize terminal"
            tabIndex={0}
          />

          <div className={`panel terminal-pane ${terminalOpen ? "" : "collapsed"}`}>
            <div className="panel-header terminal-header">
              <div className="terminal-title">
                <FiTerminal size={16} />
                <strong>Terminal Output</strong>
                <span className={`terminal-connection ${pybricksRuntimeOnline || runtimeReady ? "online" : "offline"}`}>
                  {isPybricksProject
                    ? isRemoteHubGuestMode
                      ? `${remoteHubHost?.deviceName || "Remote Hub"} via ${remoteHubHost?.userName || "host"}`
                      : pybricksHubState.connected
                        ? `${pybricksHubState.deviceName || "Hub"} Ready`
                        : remoteHubTakenByOther
                          ? `${remoteHubHost?.userName || "Host"} controls the shared hub`
                          : runtimeReady
                            ? "Compiler Ready"
                            : "Compiler Unavailable"
                    : runtimeReady
                      ? "Runtime Ready"
                      : "Runtime Unavailable"}
                </span>
                {latestRun && (
                  <span className={`terminal-last-run terminal-last-run-${latestRun.statusTone}`} title={latestRunSummary}>
                    <FiClock size={11} />
                    {latestRunSummary}
                  </span>
                )}
              </div>
              <div className="terminal-actions">
                <button
                  className={`icon-btn ${runHistoryOpen ? "active" : ""}`}
                  onClick={() => setRunHistoryOpen((prev) => !prev)}
                  title={runHistoryOpen ? "Hide Run Timeline" : "Show Run Timeline"}
                >
                  <FiActivity />
                </button>
                <button className="icon-btn" onClick={() => setTerminalOpen(false)} title="Hide Terminal">
                  <FiChevronDown />
                </button>
                <button className="icon-btn" onClick={clearTerminal} title="Clear Console"><FiTrash2 /></button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {runHistoryOpen && (
                <motion.div
                  className="run-history-panel"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                >
                  <div className="run-history-toolbar">
                    <div className="run-history-summary">
                      <FiZap size={12} />
                      <span>
                        {runHistory.length
                          ? `${successfulRunCount}/${runHistory.length} successful · newest first`
                          : "No runs captured yet"}
                      </span>
                    </div>
                    <button className="btn btn-ghost run-history-clear-btn" onClick={clearRunHistory} disabled={!runHistory.length}>
                      Clear Timeline
                    </button>
                  </div>

                  {runHistory.length > 0 && (
                    <div className="run-history-list">
                      {runHistory.map((run) => (
                        <button
                          key={run.id}
                          className={`run-history-item ${activeRunReplayId === run.id ? "active" : ""}`}
                          onClick={() => replayRunOutput(run)}
                          title={`Replay output from ${formatRunClockTime(run.finishedAt)}`}
                        >
                          <span className={`run-history-status run-history-status-${run.statusTone}`}>{run.statusLabel}</span>
                          <span className="run-history-file">{run.fileName}</span>
                          <span className="run-history-metrics">
                            <FiClock size={11} />
                            {formatRunDuration(run.durationMs)} · {formatRunClockTime(run.finishedAt)} · exit {run.returnCode}
                            {run.outputChars ? ` · ${run.outputLineCount} lines` : " · no output"}
                          </span>
                          {run.outputWasTrimmed && <span className="run-history-note">Tail snapshot only</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="terminal-body" ref={terminalBodyRef}>
              <AnimatePresence mode="wait">
                {output ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key="output-content"
                    className="terminal-output"
                  >
                    {output}
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    key="empty-state"
                    className="terminal-empty"
                  >
                    <FiTerminal size={48} style={{ opacity: 0.2 }} />
                    <p style={{ margin: 0, fontSize: 14 }}>Ready to execute.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="terminal-input-row">
              <input
                ref={stdinInputRef}
                className={`input terminal-input ${awaitingInput ? "terminal-input-awaiting" : ""}`}
                type="text"
                value={stdinLine}
                placeholder={stdinPlaceholder}
                onChange={(event) => setStdinLine(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitInputLine();
                  }
                }}
                disabled={!running || isRemoteHubGuestMode}
              />
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="editor-statusbar">
          <div className="editor-statusbar-left">
            <span className={`editor-statusbar-indicator ${editorDisconnected ? "disconnected" : "connected"}`}>
              {editorDisconnected ? <FiWifiOff size={12} /> : <FiWifi size={12} />}
              {editorDisconnected ? "Disconnected" : "Connected"}
            </span>
            {editorDisconnected && (
              <span className="editor-statusbar-refresh-prompt" role="alert">
                Refresh now before editing so your changes stay synced.
              </span>
            )}
          </div>
          <div className="editor-statusbar-right">
            {editorDisconnected && (
              <button className="editor-statusbar-reconnect" onClick={handleRefreshEditor} type="button">
                <FiRefreshCw size={12} /> Refresh
              </button>
            )}
            {currentFile?.name && <span className="editor-statusbar-file">{currentFile.name}</span>}
          </div>
        </div>

        {isMobileViewport && (
          <nav className="editor-mobile-bar" aria-label="Editor mobile actions">
            {!isViewerMode && (
              <button
                type="button"
                className={`editor-mobile-tool ${sidebarOpen ? "active" : ""}`}
                onClick={() => {
                  setActiveSidebarScreen("");
                  setCreateFileMenuOpen(false);
                  setSidebarOpen(true);
                }}
                aria-label="Open files and project tools"
              >
                <FiMenu size={17} />
                <span>Files</span>
              </button>
            )}
            {!isViewerMode && (
              <button
                type="button"
                className={`editor-mobile-tool ${sessionChatOpen ? "active" : ""}`}
                onClick={() => setSessionChatOpen((prev) => !prev)}
                aria-label="Toggle session chat"
              >
                <FiMessageSquare size={17} />
                <span>Chat</span>
              </button>
            )}
            <button
              type="button"
              className="editor-mobile-tool editor-mobile-run"
              disabled={runDisabled}
              onClick={runCode}
              aria-label={runButtonLabel}
              title={runButtonLabel}
            >
              {running ? (
                <span className="editor-mobile-spinner" aria-hidden="true" />
              ) : (
                <FiPlay size={18} fill="currentColor" />
              )}
              <span>{mobileRunLabel}</span>
            </button>
            <button
              type="button"
              className="editor-mobile-tool"
              disabled={!running}
              onClick={stopCode}
              aria-label="Stop current run"
            >
              <FiSquare size={16} />
              <span>Stop</span>
            </button>
            <button
              type="button"
              className={`editor-mobile-tool ${terminalOpen ? "active" : ""}`}
              onClick={() => setTerminalOpen((prev) => !prev)}
              aria-label={terminalOpen ? "Hide terminal" : "Show terminal"}
            >
              <FiTerminal size={17} />
              <span>Console</span>
            </button>
            <button
              type="button"
              className="editor-mobile-tool"
              onClick={() => {
                setCommandPaletteQuery("");
                setCommandPaletteOpen(true);
              }}
              aria-label="Open command center"
            >
              <FiSearch size={17} />
              <span>More</span>
            </button>
          </nav>
        )}
      </main>

      {/* Session Chat Panel (ephemeral – no data saved) */}
      <AnimatePresence>
        {sessionChatOpen && (
          <motion.aside
            className="ai-panel session-chat-panel"
            initial={isMobileViewport ? { x: "100%", opacity: 0 } : { width: 0, opacity: 0 }}
            animate={isMobileViewport ? { x: 0, opacity: 1 } : { width: 360, opacity: 1 }}
            exit={isMobileViewport ? { x: "100%", opacity: 0 } : { width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "circOut" }}
          >
            <div className="ai-panel-header session-chat-header">
              <div className="ai-panel-title">
                <FiMessageSquare size={16} />
                <strong>Session Chat</strong>
              </div>
              <div className="ai-header-actions">
                <button className="icon-btn" onClick={() => setSessionChatOpen(false)} title="Close Session Chat">
                  <FiX size={16} />
                </button>
              </div>
            </div>

            <div className="session-chat-notice">
              <FiAlertCircle size={12} />
              <span>Messages are not saved. Chat history is lost when you leave the session.</span>
            </div>

            <div className="ai-panel-body" ref={sessionChatBodyRef}>
              {sessionChatMessages.length === 0 && (
                <div className="ai-empty">
                  <FiMessageSquare size={40} style={{ opacity: 0.2 }} />
                  <p>No messages yet. Say hi to your teammates!</p>
                </div>
              )}
              {sessionChatMessages.map((msg, idx) => (
                <div key={idx} className={`ai-msg session-chat-msg ai-msg-${msg.isOwn ? "user" : "assistant"}`}>
                  <div className="ai-msg-label">{msg.userName}</div>
                  <div className="ai-msg-content">{msg.message}</div>
                </div>
              ))}
            </div>

            <div className="ai-panel-input">
              <input
                className="input ai-input"
                type="text"
                placeholder="Type a message…"
                value={sessionChatInput}
                onChange={(e) => setSessionChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendSessionChatMessage();
                  }
                }}
              />
              <button
                className="icon-btn ai-send-btn"
                onClick={sendSessionChatMessage}
                disabled={!sessionChatInput.trim()}
                title="Send"
              >
                <FiSend size={16} />
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <CheckpointInspectorModal
        open={Boolean(checkpointInspectorSnapshot)}
        snapshot={checkpointInspection?.snapshot || checkpointInspectorSnapshot}
        inspection={checkpointInspection}
        loading={loadingCheckpointInspection}
        loadError={checkpointInspectionError}
        canEdit={canEdit}
        restoreBusy={restoringSnapshotId === checkpointInspectorSnapshot?.id}
        onClose={closeCheckpointInspector}
        onRefresh={refreshCheckpointInspector}
        onRestoreFull={() => restoreSnapshot(checkpointInspection?.snapshot || checkpointInspectorSnapshot)}
        onRestoreSelected={(fileNames, options) =>
          restoreSelectedSnapshotFiles(checkpointInspection?.snapshot || checkpointInspectorSnapshot, fileNames, options)
        }
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        title="Go to File"
        placeholder="Search files..."
        query={commandPaletteQuery}
        onQueryChange={setCommandPaletteQuery}
        items={commandPaletteItems}
        emptyText="No files match your search."
        footerHint="Switch files • Cmd/Ctrl+K"
      />

      {/* Connection Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="toast toast-error"
          >
            <FiAlertCircle size={20} /> {error}
            <button onClick={() => setError("")} className="toast-close"><FiX /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
