import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import CodeMirror, { ExternalChange } from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { ChangeSet, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { io } from "socket.io-client";
import api, { API_BASE, HOSTED_WEB_BASE } from "../api";
import { getToken } from "../auth";
import PyodideRunner from "../runtime/pyodideRunner";
import PybricksRunner from "../runtime/pybricksRunner";
import PybricksBlocksEditor from "../pybricks-blocks/ui/PybricksBlocksEditor";
import { motion, AnimatePresence } from "framer-motion";
import { FiFile, FiFilePlus, FiUsers, FiShare2, FiLogOut, FiPlay, FiTerminal, FiChevronLeft, FiChevronDown, FiEdit2, FiTrash2, FiCopy, FiCheck, FiAlertCircle, FiSun, FiMoon, FiSidebar, FiSearch, FiMenu, FiHome, FiEye, FiEyeOff, FiX, FiSquare, FiMessageSquare, FiSend, FiCode, FiPlus, FiActivity, FiClock, FiZap, FiPhoneCall, FiPhoneOff, FiMic, FiMicOff, FiVolume2, FiRefreshCw, FiWifi, FiWifiOff, FiDownload, FiMoreVertical } from "react-icons/fi";
import VerifiedBadge from "../components/VerifiedBadge";
import CommandPalette from "../components/CommandPalette";
import { PROJECT_TYPE_PYBRICKS, isPybricksProject as projectUsesPybricks } from "../projects/projectTypes";
import { copyText } from "../utils/clipboard";
import { resolveHostedAssetUrl } from "../utils/hostedAssets";


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
        const builder = new RangeSetBuilder();
        (e.value || []).forEach((cur) => {
          if (typeof cur.from === "number" && typeof cur.to === "number") {
            if (cur.from !== cur.to) {
              builder.add(cur.from, cur.to, Decoration.mark({ attributes: { style: `background: ${cur.color}4D;` } }));
            }
            builder.add(cur.to, cur.to, Decoration.widget({ widget: new RemoteCursorWidget(cur.color, cur.label) }));
          }
        });
        value = builder.finish();
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
  const [files, setFiles] = useState([]);
  const [blockDocuments, setBlockDocuments] = useState([]);
  const [currentFileId, setCurrentFileId] = useState(null);
  const currentFileIdRef = useRef(null);
  const [currentBlockDocumentId, setCurrentBlockDocumentId] = useState(null);
  const [activeEditorKind, setActiveEditorKind] = useState("file");
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
  const [openSnapshotMenuId, setOpenSnapshotMenuId] = useState(null);
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
  const [stdinLine, setStdinLine] = useState("");
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [pybricksHubState, setPybricksHubState] = useState({
    connected: false,
    status: "disconnected",
    transport: null,
    transportLabel: "",
    deviceName: "",
    maxWriteSize: 0,
    maxUserProgramSize: 0,
    numOfSlots: 0,
    selectedSlot: 0,
    hubRunning: false,
  });
  const [pybricksConnectModalOpen, setPybricksConnectModalOpen] = useState(false);
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [inputPrompt, setInputPrompt] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? !window.matchMedia("(max-width: 768px)").matches : true
  );
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);
  const [runHistory, setRunHistory] = useState([]);
  const [activeRunReplayId, setActiveRunReplayId] = useState(null);
  const [fileSearch, setFileSearch] = useState("");
  const [createFileMenuOpen, setCreateFileMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const editorViewRef = useRef(null);
  const socketRef = useRef(null);
  const runnerRef = useRef(null);
  const collabRef = useRef({});
  const filesRef = useRef([]);
  const blockDocumentsRef = useRef([]);
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
  const terminalBodyRef = useRef(null);
  const stdinInputRef = useRef(null);
  const runningRef = useRef(false);
  const outputRef = useRef("");
  const runMetaRef = useRef({ runId: null, startedAt: 0, fileName: "", capture: null });
  const runtimeEverReadyRef = useRef(false);
  const mirroredCursorRef = useRef({ fileId: null, from: -1, to: -1 });
  const sharePinCardRef = useRef(null);
  const createFileMenuRef = useRef(null);
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
    runningRef.current = running;
  }, [running]);

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
    if (!st) return;

    if (st.pending && !st.inFlight) sendPendingOp(fileId);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!st.pending && !st.buffer && !st.inFlight) return;
      await new Promise((r) => setTimeout(r, 25));
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
  const pybricksConnectionBusy = pybricksHubState.status === "connecting";
  const pybricksRuntimeOnline = isPybricksProject ? pybricksHubState.connected : runtimeReady;

  const [ghostMode, setGhostMode] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const isViewerMode = !canEdit;

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
    try {
      const res = shareToken
        ? await api.post(`/projects/access/${shareToken}`)
        : await api.get(`/projects/${id}`);
      const resolvedProjectId = res.data.id;
      const projectIsPybricks = projectUsesPybricks(res.data);
      setProject(res.data);
      setFiles(res.data.files || []);
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

      // Permission Check
      const isOwner = res.data.owner_id === user?.id;
      const isCollab = res.data.collaborators?.some(c => c.user_id === user?.id);
      const isAdmin = user?.is_admin;

      setCanEdit(isOwner || isCollab || isAdmin);
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

      if (!(isOwner || isCollab || isAdmin)) {
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
    setCurrentBlockDocumentId(null);
    setActiveEditorKind("file");
    setShowGeneratedBlockCode(false);
    setGeneratedBlockCode("");
    generatedBlockCodeRef.current = "";
    setPybricksHubState({
      connected: false,
      status: "disconnected",
      transport: null,
      transportLabel: "",
      deviceName: "",
      maxWriteSize: 0,
      maxUserProgramSize: 0,
      numOfSlots: 0,
      selectedSlot: 0,
      hubRunning: false,
    });
    setPybricksConnectModalOpen(false);
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
      const incoming = data?.files || [];
      const incomingBlockDocuments = Array.isArray(data?.blockDocuments) ? data.blockDocuments : [];
      const incomingTasks = Array.isArray(data?.tasks) ? data.tasks : [];
      const incomingVoice = Array.isArray(data?.voiceParticipants) ? data.voiceParticipants : [];
      setFiles(incoming);
      setBlockDocuments(incomingBlockDocuments);
      setTasks(incomingTasks);
      setVoiceParticipants(
        incomingVoice
          .filter((participant) => participant?.sid)
          .slice()
          .sort((a, b) => (a.user_name || "").localeCompare(b.user_name || ""))
      );
      incoming.forEach((f) => {
        const st = getCollabState(f.id);
        if (!st) return;
        st.rev = typeof f.rev === "number" ? f.rev : 0;
        st.pending = null;
        st.buffer = null;
        st.inFlight = false;
        st.opId = null;
      });
      if (!currentFileIdRef.current && incoming.length) {
        setCurrentFileId(incoming[0].id);
      }
      if (!currentBlockDocumentId && incomingBlockDocuments.length) {
        setCurrentBlockDocumentId(incomingBlockDocuments[0].id);
      }
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
    };

    const handleSnapshotRestored = (data) => {
      const snapshot = data?.snapshot;
      if (!snapshot || typeof snapshot.id !== "number") return;
      pushActivity({
        kind: "checkpoint",
        text: `${data?.restoredByName || "A teammate"} restored checkpoint: ${snapshot.name}`,
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

    socket.on("project_state", handleProjectState);
    socket.on("file_op", applyIncomingOp);
    socket.on("op_ack", handleAck);
    socket.on("op_reject", handleReject);
    socket.on("file_ops", handleFileOps);
    socket.on("file_sync", handleFileSync);
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
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.off("project_state", handleProjectState);
      socket.off("file_op", applyIncomingOp);
      socket.off("op_ack", handleAck);
      socket.off("op_reject", handleReject);
      socket.off("file_ops", handleFileOps);
      socket.off("file_sync", handleFileSync);
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

  const handleReconnect = () => {
    if (!socketRef.current) return;
    socketRef.current.disconnect();
    socketRef.current.connect();
    lastPongRef.current = Date.now();
  };

  useEffect(() => {
    if (!project?.project_type) {
      return undefined;
    }

    let active = true;
    setRuntimeReady(false);
    runtimeEverReadyRef.current = false;
    setPybricksHubState({
      connected: false,
      status: "disconnected",
      transport: null,
      transportLabel: "",
      deviceName: "",
      maxWriteSize: 0,
      maxUserProgramSize: 0,
      numOfSlots: 0,
      selectedSlot: 0,
      hubRunning: false,
    });

    const runner = project.project_type === PROJECT_TYPE_PYBRICKS ? new PybricksRunner({
      onConnectionChange: (state) => {
        if (!active) return;
        setPybricksHubState(state);
      },
      onReady: () => {
        if (!active) return;
        setRuntimeReady(true);
        runtimeEverReadyRef.current = true;
      },
      onStatus: ({ state }) => {
        if (!active) return;
        const nextRunning = state === "running";
        setRunning(nextRunning);
        runningRef.current = nextRunning;
        if (!nextRunning) {
          setAwaitingInput(false);
          setInputPrompt("");
        }
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
        const nextRunning = state === "running";
        setRunning(nextRunning);
        runningRef.current = nextRunning;
        if (!nextRunning) {
          setAwaitingInput(false);
          setInputPrompt("");
        }
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
    if (!isPybricksProject) {
      createFile("text");
      return;
    }
    setSidebarOpen(true);
    setCreateFileMenuOpen((prev) => !prev);
  };

  const createFile = async (kind) => {
    if (!canEdit) return;
    if (!projectApiId) return;
    if (kind !== "text" && kind !== "blocks") return;
    if (kind === "blocks" && !isPybricksProject) return;
    setCreateFileMenuOpen(false);
    const namePrompt = kind === "blocks" ? "Block file name" : "Text file name (e.g. utils.py)";
    const name = prompt(namePrompt);
    if (!name) return;

    if (kind === "blocks") {
      const res = await api.post(`/projects/${projectApiId}/block-documents`, { name });
      setBlockDocuments((prev) => [...prev, res.data]);
      setActiveEditorKind("blocks");
      setCurrentBlockDocumentId(res.data.id);
      if (!running) {
        setTerminalOpen(false);
      }
      return;
    }

    const res = await api.post(`/projects/${projectApiId}/files`, { name, content: `# ${name}\n` });
    setFiles((prev) => [...prev, res.data]);
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
    const name = prompt("New name", file.name);
    if (!name || name === file.name) return;
    const res = await api.patch(`/projects/${projectApiId}/files/${file.id}`, { name });
    setFiles((prev) => prev.map((f) => (f.id === file.id ? res.data : f)));
  };

  const renameBlockDocument = async (document) => {
    if (!canEdit) return;
    if (!projectApiId) return;
    const name = prompt("New block file name", document.name);
    if (!name || name === document.name) return;
    const res = await api.patch(`/projects/${projectApiId}/block-documents/${document.id}`, { name });
    setBlockDocuments((prev) => prev.map((entry) => (entry.id === document.id ? res.data : entry)));
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

  const runCode = async () => {
    if (!currentFile && !isBlockEditorActive) return;
    if (isPybricksProject && !canEdit) return;
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
      let runtimeFiles = files;
      let entryFileId = currentFile?.id;
      let entryFileName = currentFile?.name;
      let entryFileContent;
      let runFileName = currentFile?.name || "unknown.py";

      if (isBlockEditorActive && currentBlockDocument) {
        entryFileId = currentBlockDocument.id * -1;
        entryFileName = currentBlockDocument.generated_entry_module || "main.py";
        entryFileContent = generatedBlockCodeRef.current || generatedBlockCode || "";
        runtimeFiles = files.filter((file) => file.name !== entryFileName);
        runFileName = `${currentBlockDocument.name} / ${entryFileName}`;
      } else {
        await flushEdits(currentFile.id);
        const editorSnapshot = editorViewRef.current?.state.doc.toString();
        runtimeFiles =
          typeof editorSnapshot === "string"
            ? files.map((f) => (f.id === currentFile.id ? { ...f, content: editorSnapshot } : f))
            : files;
      }

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
        fileName: runFileName,
        capture: "",
      };
      await runner.run({
        entryFileId,
        entryFileName,
        entryFileContent,
        files: runtimeFiles,
      });
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
      setRunning(false);
      runningRef.current = false;
      runMetaRef.current = { runId: null, startedAt: 0, fileName: "", capture: null };
    }
  };

  const stopCode = () => {
    const runner = runnerRef.current;
    if (!runner) return;
    runner.stop().catch((err) => {
      const stopError = normalizeTerminalText(err?.message, "Failed to stop run.");
      appendCompilerOutput(`[compiler] ${stopError}\n`);
    });
  };

  const connectPybricksHub = async (transport) => {
    const runner = runnerRef.current;
    if (!runner || !isPybricksProject) return;
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
    if (!runner || !isPybricksProject) return;
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
    if (!running) return;
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
    await copyText(sharePin);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyShareLink = async () => {
    if (!sharePin) return;
    const shareUrl = `${HOSTED_WEB_BASE}/share/${sharePin}`;
    await copyText(shareUrl);
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
      for (const file of files) {
        await flushEdits(file.id);
      }
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

  const restoreSnapshot = async (snapshot) => {
    if (!canEdit || !snapshot?.id) return;
    if (!projectApiId) return;
    if (!confirm(`Restore checkpoint "${snapshot.name}"? This will overwrite matching files.`)) return;
    setRestoringSnapshotId(snapshot.id);
    try {
      for (const file of files) {
        await flushEdits(file.id);
      }
      await api.post(`/projects/${projectApiId}/snapshots/${snapshot.id}/restore`);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to restore checkpoint.");
    } finally {
      setRestoringSnapshotId(null);
    }
  };

  const removeSnapshot = async (snapshotId) => {
    if (!canEdit || !snapshotId) return;
    if (!projectApiId) return;
    if (!confirm("Delete this checkpoint?")) return;
    try {
      await api.delete(`/projects/${projectApiId}/snapshots/${snapshotId}`);
      setSnapshots((prev) => prev.filter((entry) => entry.id !== snapshotId));
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
      const downloadUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = checkpointArchiveFileName(project?.name, snapshot.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 0);
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
      const isToggleSidebar = hasPrimaryModifier && event.shiftKey && key === "s";
      const isRunShortcut = (hasPrimaryModifier && key === "enter") || event.key === "F5";
      const isStopShortcut = event.key === "F6";

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

  // --- Session Chat (ephemeral) ---
  const sendSessionChatMessage = () => {
    const msg = sessionChatInput.trim();
    if (!msg || !socketRef.current?.connected || !socketProjectId) return;
    socketRef.current.emit("session_chat", { projectId: socketProjectId, message: msg });
    setSessionChatInput("");
  };

  const extensions = useMemo(() => [python(), EditorView.lineWrapping, remoteCursorField], []);

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
  const filteredEditorEntries = useMemo(() => {
    const query = fileSearch.trim().toLowerCase();
    return [
      ...visibleBlockDocuments.map((document) => ({
        kind: "blocks",
        id: document.id,
        key: `blocks-${document.id}`,
        name: document.name,
        generatedEntryModule: document.generated_entry_module || "main.py",
      })),
      ...files.map((file) => ({
        kind: "file",
        id: file.id,
        key: `file-${file.id}`,
        name: file.name,
      })),
    ].filter((entry) => !query || entry.name.toLowerCase().includes(query));
  }, [fileSearch, files, visibleBlockDocuments]);
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
    entry.kind === "blocks" ? isBlockFileActive(entry.id) : isTextFileActive(entry.id);
  const stdinPlaceholder =
    !running
      ? "Run code first"
      : awaitingInput && inputPrompt
      ? inputPrompt
      : "Type input and press Enter";
  const recentActivity = activityFeed.slice(0, 24);
  const voiceParticipantCount = voiceParticipants.length;
  const voiceByUserId = useMemo(() => {
    const map = new Map();
    voiceParticipants.forEach((participant) => {
      if (typeof participant?.user_id === "number" && !map.has(participant.user_id)) {
        map.set(participant.user_id, participant);
      }
    });
    return map;
  }, [voiceParticipants]);
  const commandPaletteItems = useMemo(() => {
    const query = commandPaletteQuery.trim().toLowerCase();
    const compact = (value, max = 44) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
    const matches = (value = "") => !query || value.toLowerCase().includes(query);

    const commandItems = [
      {
        key: "cmd-run",
        title: "Run current file",
        subtitle: currentFile?.name ? `Execute ${currentFile.name}` : "Execute active file in browser runtime",
        badge: "Action",
        icon: <FiPlay size={14} />,
        onSelect: () => runCode(),
      },
      {
        key: "cmd-stop",
        title: "Stop current run",
        subtitle: "Interrupt active execution",
        badge: running ? "Running" : "Idle",
        icon: <FiSquare size={14} />,
        onSelect: () => stopCode(),
      },
      {
        key: "cmd-terminal",
        title: terminalOpen ? "Hide terminal" : "Show terminal",
        subtitle: "Toggle terminal panel visibility",
        badge: "View",
        icon: <FiTerminal size={14} />,
        onSelect: () => setTerminalOpen((prev) => !prev),
      },
      {
        key: "cmd-run-history",
        title: runHistoryOpen ? "Hide run timeline" : "Show run timeline",
        subtitle: "Toggle recent run replay panel",
        badge: runHistory.length ? `${runHistory.length} runs` : "No runs",
        icon: <FiActivity size={14} />,
        onSelect: () => {
          setTerminalOpen(true);
          setRunHistoryOpen((prev) => !prev);
        },
      },
      {
        key: "cmd-clear-terminal",
        title: "Clear terminal output",
        subtitle: "Reset current terminal panel text",
        badge: "Action",
        icon: <FiTrash2 size={14} />,
        onSelect: () => clearTerminal(),
      },
      {
        key: "cmd-dashboard",
        title: "Back to dashboard",
        subtitle: "Return to project list",
        badge: "Navigate",
        icon: <FiHome size={14} />,
        onSelect: () => navigate("/"),
      },
      ...(canEdit
        ? [
            {
              key: "cmd-new-file",
              title: "Create new file",
              subtitle: isPybricksProject ? "Choose text or block, then name it" : "Create a new text file",
              badge: "Edit",
              icon: <FiFilePlus size={14} />,
              onSelect: () => openCreateFileMenu(),
            },
            {
              key: "cmd-checkpoint",
              title: "Create checkpoint",
              subtitle: "Save a new restore point",
              badge: "Edit",
              icon: <FiCopy size={14} />,
              onSelect: () => createSnapshot(),
            },
          ]
        : []),
    ]
      .filter((item) => matches(`${item.title} ${item.subtitle} ${item.badge || ""}`))
      .slice(0, 10);

    const fileItems = filteredEditorEntries
      .filter((entry) => matches(entry.name))
      .slice(0, 14)
      .map((entry) => ({
        key: entry.key,
        title: `Open ${entry.kind === "blocks" ? "block file" : "file"}: ${entry.name}`,
        subtitle:
          entry.kind === "blocks"
            ? isBlockFileActive(entry.id)
              ? "Currently open"
              : "Switch block workspace"
            : isTextFileActive(entry.id)
              ? "Currently open"
              : "Switch editor focus",
        badge: entry.kind === "blocks" ? "Blocks" : "File",
        icon: entry.kind === "blocks" ? <FiZap size={14} /> : <FiFile size={14} />,
        onSelect: () =>
          entry.kind === "blocks" ? selectBlockDocument(entry.id) : selectFile(entry.id),
      }));

    const taskItems = canEdit
      ? sortedTasks
          .filter((task) => matches(task.content))
          .slice(0, 8)
          .map((task) => ({
            key: `task-${task.id}`,
            title: task.is_done ? `Re-open task: ${compact(task.content)}` : `Complete task: ${compact(task.content)}`,
            subtitle: task.assigned_to_name ? `Assigned to ${task.assigned_to_name}` : "No assignee",
            badge: task.is_done ? "Done" : "Open",
            icon: <FiCheck size={14} />,
            onSelect: () => toggleTask(task),
          }))
      : [];

    const snapshotItems = canEdit
      ? sortedSnapshots
          .filter((snapshot) => matches(snapshot.name || "checkpoint"))
          .slice(0, 6)
          .map((snapshot) => ({
            key: `snapshot-${snapshot.id}`,
            title: `Restore checkpoint: ${compact(snapshot.name || "Untitled")}`,
            subtitle: "Restore files from this checkpoint",
            badge: "Checkpoint",
            icon: <FiRefreshCw size={14} />,
            onSelect: () => restoreSnapshot(snapshot),
          }))
      : [];

    return [...commandItems, ...fileItems, ...taskItems, ...snapshotItems];
  }, [
    commandPaletteQuery,
    currentFile?.name,
    running,
    terminalOpen,
    runHistoryOpen,
    runHistory.length,
    canEdit,
    files,
    currentFileId,
    activeEditorKind,
    isPybricksProject,
    sortedTasks,
    sortedSnapshots,
    runCode,
    stopCode,
    clearTerminal,
    navigate,
    createFile,
    openCreateFileMenu,
    createSnapshot,
    currentBlockDocumentId,
    selectFile,
    selectBlockDocument,
    toggleTask,
    restoreSnapshot,
    filteredEditorEntries,
    isBlockEditorActive,
  ]);

  const formatActivityTime = (ts) =>
    new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const activityIcon = (kind) => {
    if (kind === "edit") return <FiCode size={12} />;
    if (kind === "task") return <FiCheck size={12} />;
    if (kind === "checkpoint") return <FiCopy size={12} />;
    if (kind === "presence") return <FiUsers size={12} />;
    return <FiActivity size={12} />;
  };

  const jumpToActivity = (activity) => {
    if (!activity?.fileId) return;
    selectFile(activity.fileId);
  };

  return (
    <div className="editor-shell">
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
            initial={{ x: -260, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -260, opacity: 0 }}
            transition={{ duration: 0.25, ease: "circOut" }}
          >
            <div className="es-header">
              <button className="es-back-btn" onClick={() => navigate("/")} title="Return to Dashboard">
                <FiChevronLeft size={16} />
              </button>
              <div className="es-project-name">{project?.name}</div>
              <div className="es-header-actions">
                {user?.is_admin && (
                  <button
                    className={`es-icon-btn ${ghostMode ? "active" : ""}`}
                    onClick={() => setGhostMode(!ghostMode)}
                    title={ghostMode ? "Ghost Mode ON" : "Ghost Mode OFF"}
                  >
                    {ghostMode ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                  </button>
                )}
                <button className="es-icon-btn" onClick={() => setSidebarOpen(false)} title="Collapse Sidebar">
                  <FiSidebar size={14} />
                </button>
              </div>
            </div>

            {canEdit && project?.owner_id === user?.id && (
              <div className="es-description">
                <p
                  className="es-description-text"
                  onClick={() => {
                    const newDesc = prompt("Enter project description:", project?.description || "");
                    if (newDesc !== null) {
                      api.patch(`/projects/${projectApiId}`, { name: project?.name, description: newDesc }).then(res => setProject(res.data)).catch(console.error);
                    }
                  }}
                >
                  {project?.description || <span className="es-description-empty">Add a description...</span>}
                </p>
              </div>
            )}

            <div className="es-section es-files-section">
              <div className="es-section-header">
                <span className="es-section-label">Files</span>
                {canEdit && (
                  <div className="es-create-file-menu-wrap" ref={createFileMenuRef}>
                    <button className={`es-icon-btn${createFileMenuOpen ? " active" : ""}`} onClick={openCreateFileMenu} title="New File">
                      <FiPlus size={14} />
                    </button>
                    {createFileMenuOpen && (
                      <div className="es-create-file-menu" role="menu" aria-label="Create file">
                        <button className="es-create-file-option" onClick={() => createFile("text")}>
                          <FiFile size={13} />
                          <span>Text File</span>
                        </button>
                        {isPybricksProject && (
                          <button className="es-create-file-option" onClick={() => createFile("blocks")}>
                            <FiZap size={13} />
                            <span>Block File</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="es-search-wrap">
                <FiSearch className="es-search-icon" size={13} />
                <input
                  className="es-search-input"
                  placeholder="Search files..."
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                />
              </div>
              <div className="es-file-list">
                <AnimatePresence initial={false}>
                  {filteredEditorEntries.map((entry) => {
                    const isActive = isEditorEntryActive(entry);
                    return (
                    <div key={entry.key} style={{ position: "relative" }}>
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
                        className={`es-file-item ${isActive ? "active" : ""}`}
                        onClick={() =>
                          entry.kind === "blocks" ? selectBlockDocument(entry.id) : selectFile(entry.id)
                        }
                        whileHover={{ x: 2 }}
                      >
                        <span className="es-file-name">
                          {entry.kind === "blocks" ? (
                            <FiZap size={13} className="es-file-icon-py" />
                          ) : (
                            <FiFile size={13} className={entry.name.endsWith(".py") ? "es-file-icon-py" : "es-file-icon"} />
                          )}
                          {entry.name}
                        </span>
                        <div className="es-file-actions">
                          {canEdit && (
                            <>
                              <button
                                className="es-file-action"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (entry.kind === "blocks") {
                                    const document = blockDocuments.find((item) => item.id === entry.id);
                                    if (document) renameBlockDocument(document);
                                    return;
                                  }
                                  const file = files.find((item) => item.id === entry.id);
                                  if (file) renameFile(file);
                                }}
                              >
                                <FiEdit2 size={11} />
                              </button>
                              <button
                                className="es-file-action danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (entry.kind === "blocks") {
                                    deleteBlockDocument(entry.id);
                                    return;
                                  }
                                  deleteFile(entry.id);
                                }}
                              >
                                <FiTrash2 size={11} />
                              </button>
                            </>
                          )}
                        </div>
                      </motion.div>
                    </div>
                  )})}
                  {filteredEditorEntries.length === 0 && <div className="es-empty">No matching files.</div>}
                </AnimatePresence>
              </div>
            </div>

            <div className="es-section">
              <div className="es-section-header">
                <span className="es-section-label">Live Tasks</span>
                <div className="es-task-head-actions">
                  <button
                    className={`es-task-filter ${showOnlyMyTasks ? "active" : ""}`}
                    onClick={() => setShowOnlyMyTasks((prev) => !prev)}
                  >
                    {showOnlyMyTasks ? `Mine (${myTaskCount})` : "All"}
                  </button>
                  <span className="es-badge">{openTaskCount}</span>
                </div>
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
                  <button className="es-task-add" onClick={addTask} disabled={savingTask || !taskDraft.trim()}>
                    <FiPlus size={13} />
                  </button>
                </div>
              )}
              <div className="es-task-list">
                {visibleTasks.map((task) => (
                  <div key={task.id} className={`es-task-item ${task.is_done ? "done" : ""}`}>
                    <button className="es-task-toggle" onClick={() => toggleTask(task)} disabled={!canEdit}>
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
                          className={`es-task-assign ${task.assigned_to_user_id === user?.id ? "active" : ""}`}
                          onClick={() => toggleTaskOwnership(task)}
                          title={task.assigned_to_user_id === user?.id ? "Release task" : "Take task"}
                        >
                          {task.assigned_to_user_id === user?.id ? "Release" : "Take"}
                        </button>
                        <button className="es-task-delete" onClick={() => removeTask(task.id)} title="Delete task">
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
            </div>

            <div className="es-section">
              <div className="es-section-header">
                <span className="es-section-label">Checkpoints</span>
                <span className="es-badge">{sortedSnapshots.length}</span>
              </div>
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
                    <div className="es-snapshot-main">
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
                    </div>
                    <div className="es-snapshot-actions">
                      <button
                        className="es-snapshot-menu-trigger"
                        onClick={() =>
                          setOpenSnapshotMenuId((prev) => (prev === snapshot.id ? null : snapshot.id))
                        }
                        aria-label={`Checkpoint actions for ${snapshot.name}`}
                        aria-expanded={openSnapshotMenuId === snapshot.id}
                        title="Checkpoint actions"
                      >
                        <FiMoreVertical size={14} />
                      </button>
                      {openSnapshotMenuId === snapshot.id && (
                        <div className="es-snapshot-menu" role="menu">
                          <button
                            className="es-snapshot-menu-item"
                            onClick={() => exportSnapshot(snapshot)}
                            disabled={!projectApiId || exportingSnapshotId === snapshot.id}
                          >
                            {exportingSnapshotId === snapshot.id ? "Exporting..." : "Export"}
                          </button>
                          {canEdit && (
                            <>
                              <button
                                className="es-snapshot-menu-item"
                                onClick={() => restoreSnapshot(snapshot)}
                                disabled={restoringSnapshotId === snapshot.id}
                              >
                                {restoringSnapshotId === snapshot.id ? "Restoring..." : "Restore"}
                              </button>
                              <button
                                className="es-snapshot-menu-item danger"
                                onClick={() => removeSnapshot(snapshot.id)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sortedSnapshots.length === 0 && <div className="es-empty">No checkpoints yet.</div>}
              </div>
            </div>

            <div className="es-section">
              <div className="es-section-header">
                <span className="es-section-label">Team</span>
                <span className="es-badge">{presence.length}</span>
              </div>
              <div className="es-team-list">
                <AnimatePresence>
                  {(presence || []).map((p) => {
                    const voiceState = voiceByUserId.get(p.user_id);
                    const voiceMutedState = voiceState ? !!voiceState.muted : false;
                    const voiceSpeakingState = voiceState ? !!voiceState.speaking && !voiceMutedState : false;
                    return (
                      <motion.div
                        key={p.user_id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        className="es-team-item"
                      >
                        {p.avatar ? (
                          <img src={resolveHostedAssetUrl(p.avatar)} className="es-team-avatar" alt={p.name} />
                        ) : (
                          <span className="es-team-avatar-fallback" style={{ background: p.color }}>
                            {p.name[0]}
                          </span>
                        )}
                        <div className="es-team-main">
                          <span className="es-team-name">
                            {p.name} {p.is_admin && <VerifiedBadge size={11} />} {p.user_id === user.id && <span className="muted">(You)</span>}
                          </span>
                          <span className="es-team-location">
                            {Number.isInteger(p.block_presence?.documentId)
                              ? `In ${blockDocumentNameById.get(p.block_presence.documentId) || "a block file"}`
                              : typeof p.cursor?.fileId === "number"
                              ? `In ${fileNameById.get(p.cursor.fileId) || "an untitled file"}`
                              : "Idle"}
                          </span>
                        </div>
                        {voiceState && (
                          <span className={`es-team-voice ${voiceSpeakingState ? "speaking" : ""}`}>
                            {voiceMutedState ? <FiMicOff size={11} /> : <FiVolume2 size={11} />}
                            {voiceMutedState ? "Muted" : voiceSpeakingState ? "Speaking" : "In call"}
                          </span>
                        )}
                        {p.user_id !== user.id && (
                          <button
                            className={`es-follow-btn ${followTargetId === p.user_id ? "active" : ""}`}
                            onClick={() => {
                              mirroredCursorRef.current = { fileId: null, from: -1, to: -1 };
                              if (followTargetId === p.user_id) {
                                setFollowTargetId(null);
                                return;
                              }
                              setFollowTargetId(p.user_id);
                              setFollowFlash(`Quantum sync locked on ${p.name}.`);
                            }}
                          >
                            {followTargetId === p.user_id ? "Synced" : "Beam In"}
                          </button>
                        )}
                        <span className="es-online-dot" />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {presence.length === 0 && <div className="es-empty">Only you here.</div>}
              </div>
              {followFlash && <div className="es-follow-flash">{followFlash}</div>}
            </div>

            <div className="es-section">
              <div className="es-section-header">
                <span className="es-section-label">Live Activity</span>
                <div className="es-task-head-actions">
                  <button
                    className="es-task-filter"
                    onClick={() => setActivityFeed([])}
                    disabled={recentActivity.length === 0}
                  >
                    Clear
                  </button>
                  <span className="es-badge">{recentActivity.length}</span>
                </div>
              </div>
              <div className="es-activity-list">
                {recentActivity.map((entry) => {
                  const clickable = typeof entry.fileId === "number";
                  return (
                    <button
                      key={entry.id}
                      className={`es-activity-item ${clickable ? "clickable" : ""}`}
                      onClick={() => clickable && jumpToActivity(entry)}
                      disabled={!clickable}
                      title={clickable ? `Jump to ${resolveFileName(entry.fileId)}` : entry.text}
                    >
                      <span className={`es-activity-icon kind-${entry.kind}`}>{activityIcon(entry.kind)}</span>
                      <span className="es-activity-main">
                        <span className="es-activity-text">{entry.text}</span>
                        <span className="es-activity-meta">
                          <FiClock size={10} /> {formatActivityTime(entry.ts)}
                          {entry.count > 1 ? ` · ${entry.count}x` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {recentActivity.length === 0 && <div className="es-empty">No activity yet. Waiting for teammates...</div>}
              </div>
            </div>

            <div className="es-footer">
              {canEdit && project?.owner_id === user?.id && (
                <button
                  className="es-visibility-btn"
                  onClick={() => {
                    const newVisibility = project?.is_public ? "Private" : "Public";
                    if (confirm(`Change visibility to ${newVisibility}?`)) {
                      api.patch(`/projects/${projectApiId}/visibility`).then(res => setProject(res.data)).catch(console.error);
                    }
                  }}
                >
                  {project?.is_public ? <><FiEye size={13} /> Public</> : <><FiEyeOff size={13} /> Private</>}
                </button>
              )}
              <div className="es-footer-row">
                <button className="es-icon-btn" onClick={toggleTheme} title="Toggle Theme">
                  {theme === "dark" ? <FiSun size={15} /> : <FiMoon size={15} />}
                </button>
                <button className="es-share-btn" onClick={generateSharePin}>
                  <FiShare2 size={13} /> Share
                </button>
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
                        <button className="es-icon-btn" onClick={copyShareCode} title="Copy share code">
                          {copiedCode ? <FiCheck size={14} color="var(--success)" /> : <FiCopy size={14} />}
                        </button>
                        <button className="es-pin-link-toggle" onClick={() => setShowShareLink((prev) => !prev)}>
                          {showShareLink ? "Hide Link" : "Show Link"}
                        </button>
                      </div>
                    </div>
                    {showShareLink && (
                      <div className="es-pin-row es-pin-link-row">
                        <div className="es-pin-meta">
                          <span className="es-pin-label">Share Link</span>
                          <span className="es-pin-url">{HOSTED_WEB_BASE}/share/{sharePin}</span>
                        </div>
                        <button className="es-icon-btn" onClick={copyShareLink} title="Copy share link">
                          {copiedLink ? <FiCheck size={14} color="var(--success)" /> : <FiCopy size={14} />}
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {!isViewerMode && !isMobileViewport && sidebarOpen && <div className="panel-resizer vertical editor-divider" />}

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
                    {filteredEditorEntries.map((entry) => (
                      <button
                        key={`viewer-${entry.key}`}
                        className={`viewer-file-tab ${isEditorEntryActive(entry) ? "active" : ""}`}
                        onClick={() =>
                          entry.kind === "blocks" ? selectBlockDocument(entry.id) : selectFile(entry.id)
                        }
                        role="tab"
                        aria-selected={isEditorEntryActive(entry)}
                      >
                        {entry.kind === "blocks" ? <FiZap size={12} /> : <FiFile size={12} />}
                        <span>{entry.name}</span>
                      </button>
                    ))}
                    {filteredEditorEntries.length === 0 && <span className="viewer-file-empty">No matching files.</span>}
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
                      {isBlockEditorActive ? currentBlockDocument?.name || "Blocks" : currentFile?.name || "No file selected"}
                      <span className={`editor-file-badge ${isViewerMode ? "viewer" : "editor"}`}>
                        {isViewerMode ? "Viewer" : "Editable"}
                      </span>
                    </div>
                    <div className="editor-file-path muted">
                      {isBlockEditorActive
                        ? `/workspace/${currentBlockDocument?.generated_entry_module || "main.py"}`
                        : `/root/${currentFile?.name}`}
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
                    <span className={`chip ${pybricksHubState.connected ? "chip-success" : "chip-muted"}`}>
                      {pybricksHubState.connected ? `${pybricksHubState.transportLabel} Hub` : "Hub Offline"}
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
                  className={`icon-btn${commandPaletteOpen ? " active" : ""}`}
                  onClick={() => {
                    setCommandPaletteQuery("");
                    setCommandPaletteOpen(true);
                  }}
                  title="Open command center"
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
                {isPybricksProject && (
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
                  disabled={(!currentFile && !isBlockEditorActive) || running || !runtimeReady || (isPybricksProject && (!canEdit || !pybricksHubState.connected))}
                  onClick={runCode}
                >
                  {running ? <div className="spinner" style={{ width: 16, height: 16, border: "2px solid currentColor", borderTopColor: "transparent" }} /> : <FiPlay fill="currentColor" />}
                  {running ? "Running..." : isPybricksProject ? "Download & Run" : "Run Code"}
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
              {isBlockEditorActive ? (
                <PybricksBlocksEditor
                  blockDocument={currentBlockDocument}
                  socket={socket}
                  socketProjectId={socketProjectId}
                  canEdit={canEdit}
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
                <CodeMirror
                  height="100%"
                  value={currentFile?.content || ""}
                  extensions={extensions}
                  theme={editorTheme}
                  readOnly={!canEdit}
                  onCreateEditor={(view) => (editorViewRef.current = view)}
                  onUpdate={onUpdate}
                  basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true }}
                />
              )}
            </div>
          </div>

          <div className="panel-resizer horizontal editor-divider" />

          <div className={`panel terminal-pane ${terminalOpen ? "" : "collapsed"}`}>
            <div className="panel-header terminal-header">
              <div className="terminal-title">
                <FiTerminal size={16} />
                <strong>Terminal Output</strong>
                <span className={`terminal-connection ${pybricksRuntimeOnline || runtimeReady ? "online" : "offline"}`}>
                  {isPybricksProject
                    ? pybricksHubState.connected
                      ? `${pybricksHubState.deviceName || "Hub"} Ready`
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
                disabled={!running}
              />
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="editor-statusbar">
          <div className="editor-statusbar-left">
            <span className={`editor-statusbar-indicator ${wsConnected ? "connected" : "disconnected"}`}>
              {wsConnected ? <FiWifi size={12} /> : <FiWifiOff size={12} />}
              {wsConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="editor-statusbar-right">
            {!wsConnected && (
              <button className="editor-statusbar-reconnect" onClick={handleReconnect}>
                <FiRefreshCw size={12} /> Reconnect
              </button>
            )}
            {currentFile?.name && <span className="editor-statusbar-file">{currentFile.name}</span>}
          </div>
        </div>
      </main>

      {/* Session Chat Panel (ephemeral – no data saved) */}
      <AnimatePresence>
        {sessionChatOpen && (
          <motion.aside
            className="ai-panel session-chat-panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 360, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
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

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        title="Editor Command Center"
        placeholder="Run commands, open files, toggle tasks..."
        query={commandPaletteQuery}
        onQueryChange={setCommandPaletteQuery}
        items={commandPaletteItems}
        emptyText="No matching command. Try file names, tasks, or actions."
        footerHint="Editor commands • Cmd/Ctrl+K"
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
