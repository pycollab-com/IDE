import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import {
  FiCheck,
  FiChevronDown,
  FiChevronLeft,
  FiCode,
  FiCopy,
  FiEdit2,
  FiFile,
  FiFolder,
  FiHardDrive,
  FiMoon,
  FiMoreVertical,
  FiPlay,
  FiPlus,
  FiRefreshCw,
  FiSearch,
  FiSquare,
  FiSun,
  FiTerminal,
  FiTrash2,
  FiX,
  FiZap,
} from "react-icons/fi";
import api from "../api";
import CommandPalette from "../components/CommandPalette";
import PybricksBlocksEditor from "../pybricks-blocks/ui/PybricksBlocksEditor";
import { PROJECT_TYPE_PYBRICKS } from "../projects/projectTypes";
import PybricksRunner from "../runtime/pybricksRunner";
import PyodideRunner from "../runtime/pyodideRunner";
import { revealPath } from "../utils/desktopBridge";

const MAX_PROMPT_LENGTH = 120;

function inferPendingPrompt(text) {
  const normalized = String(text || "").replace(/\r/g, "");
  if (normalized.endsWith("\n")) {
    return null;
  }
  const trailingLine = normalized.slice(normalized.lastIndexOf("\n") + 1).trim();
  if (!trailingLine || trailingLine.length > MAX_PROMPT_LENGTH) {
    return null;
  }
  return trailingLine;
}

function checkpointArchiveFileName(projectName, snapshotName) {
  const safeProjectName = (projectName || "project").trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  const safeSnapshotName = (snapshotName || "checkpoint").trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${safeProjectName || "project"}-${safeSnapshotName || "checkpoint"}.zip`;
}

function formatSnapshotDate(value) {
  if (!value) return "Unknown time";
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function normalizePythonFileName(value, fallback = "helpers.py") {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop() || "";
  if (!fileName.includes(".")) {
    return `${normalized}.py`;
  }
  return normalized;
}

export default function LocalEditorPage({ theme, toggleTheme, editorTheme }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [files, setFiles] = useState([]);
  const [blockDocuments, setBlockDocuments] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [currentFileId, setCurrentFileId] = useState(null);
  const [currentBlockDocumentId, setCurrentBlockDocumentId] = useState(null);
  const [activeEditorKind, setActiveEditorKind] = useState("file");
  const [generatedBlockCode, setGeneratedBlockCode] = useState("");
  const [showGeneratedBlockCode, setShowGeneratedBlockCode] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [stdinLine, setStdinLine] = useState("");
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [inputPrompt, setInputPrompt] = useState("");
  const [error, setError] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [snapshotDraft, setSnapshotDraft] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [createFileMenuOpen, setCreateFileMenuOpen] = useState(false);
  const [openSnapshotMenuId, setOpenSnapshotMenuId] = useState(null);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [pybricksConnectModalOpen, setPybricksConnectModalOpen] = useState(false);
  const [pybricksHubState, setPybricksHubState] = useState({
    connected: false,
    status: "disconnected",
    transportLabel: "",
    deviceName: "",
    hubRunning: false,
  });
  const [pybricksConnectionBusy, setPybricksConnectionBusy] = useState(false);

  const runnerRef = useRef(null);
  const outputRef = useRef("");
  const terminalBodyRef = useRef(null);
  const createFileMenuRef = useRef(null);
  const fileSaveTimersRef = useRef(new Map());
  const blockSaveTimersRef = useRef(new Map());

  const isPybricksProject = project?.project_type === PROJECT_TYPE_PYBRICKS;
  const currentFile = files.find((file) => file.id === currentFileId) || null;
  const currentBlockDocument = blockDocuments.find((entry) => entry.id === currentBlockDocumentId) || null;
  const isBlockEditorActive = isPybricksProject && activeEditorKind === "blocks" && !!currentBlockDocument;
  const projectTypeLabel = isPybricksProject ? "PyBricks Project" : "Normal Project";
  const stdinPlaceholder = awaitingInput ? inputPrompt || "Program waiting for input…" : running ? "Type stdin and press Enter" : "Run code first";

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((left, right) => {
        if (left.is_done !== right.is_done) return left.is_done ? 1 : -1;
        return String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || ""));
      }),
    [tasks]
  );

  const sortedSnapshots = useMemo(
    () => [...snapshots].sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || ""))),
    [snapshots]
  );

  const filteredEditorEntries = useMemo(() => {
    const query = fileSearch.trim().toLowerCase();
    const entries = [
      ...files.map((file) => ({ key: `file-${file.id}`, kind: "file", id: file.id, name: file.name })),
      ...blockDocuments.map((document) => ({ key: `blocks-${document.id}`, kind: "blocks", id: document.id, name: document.name })),
    ];
    if (!query) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(query));
  }, [blockDocuments, fileSearch, files]);

  const appendOutput = (nextChunk) => {
    const normalized = String(nextChunk || "");
    outputRef.current += normalized;
    setOutput(outputRef.current);
    const prompt = inferPendingPrompt(outputRef.current);
    setAwaitingInput(Boolean(prompt));
    setInputPrompt(prompt || "");
  };

  const clearTerminal = () => {
    outputRef.current = "";
    setOutput("");
    setAwaitingInput(false);
    setInputPrompt("");
  };

  const selectFile = (fileId) => {
    setCurrentFileId(fileId);
    setActiveEditorKind("file");
    setShowGeneratedBlockCode(false);
  };

  const selectBlockDocument = (documentId) => {
    setCurrentBlockDocumentId(documentId);
    setActiveEditorKind("blocks");
  };

  const isEditorEntryActive = (entry) =>
    entry.kind === "blocks"
      ? activeEditorKind === "blocks" && currentBlockDocumentId === entry.id
      : activeEditorKind === "file" && currentFileId === entry.id;

  const loadProject = async () => {
    try {
      const [projectRes, tasksRes, snapshotsRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/tasks`),
        api.get(`/projects/${id}/snapshots`),
      ]);
      const nextProject = projectRes.data;
      const nextFiles = nextProject.files || [];
      const nextBlockDocuments = nextProject.block_documents || [];

      setProject(nextProject);
      setFiles(nextFiles);
      setBlockDocuments(nextBlockDocuments);
      setTasks(tasksRes.data || []);
      setSnapshots(snapshotsRes.data || []);
      setCurrentFileId((current) => (nextFiles.some((file) => file.id === current) ? current : nextFiles[0]?.id || null));
      setCurrentBlockDocumentId((current) =>
        nextBlockDocuments.some((document) => document.id === current) ? current : nextBlockDocuments[0]?.id || null
      );
      setActiveEditorKind(nextFiles.length > 0 ? "file" : nextBlockDocuments.length > 0 ? "blocks" : "file");
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not load project.");
    }
  };

  useEffect(() => {
    loadProject();
  }, [id]);

  useEffect(() => {
    if (!currentFileId && files.length > 0) {
      setCurrentFileId(files[0].id);
    }
  }, [files, currentFileId]);

  useEffect(() => {
    if (!currentBlockDocumentId && blockDocuments.length > 0) {
      setCurrentBlockDocumentId(blockDocuments[0].id);
    }
  }, [blockDocuments, currentBlockDocumentId]);

  useEffect(() => {
    let active = true;
    setRuntimeReady(false);
    setRunning(false);
    setAwaitingInput(false);
    setInputPrompt("");

    if (!project?.project_type) {
      return undefined;
    }

    const runner =
      project.project_type === PROJECT_TYPE_PYBRICKS
        ? new PybricksRunner({
            onConnectionChange: (state) => {
              if (active) setPybricksHubState(state);
            },
            onReady: () => active && setRuntimeReady(true),
            onStatus: ({ state }) => active && setRunning(state === "running"),
            onStdout: (chunk) => active && appendOutput(chunk),
            onStderr: (chunk) => active && appendOutput(chunk),
            onRunResult: () => active && setAwaitingInput(false),
            onError: (message) => active && setError(String(message || "Runtime failed.")),
          })
        : new PyodideRunner({
            onReady: () => active && setRuntimeReady(true),
            onStatus: ({ state }) => active && setRunning(state === "running"),
            onStdout: (chunk) => active && appendOutput(chunk),
            onStderr: (chunk) => active && appendOutput(chunk),
            onRunResult: () => active && setAwaitingInput(false),
            onError: (message) => active && setError(String(message || "Runtime failed.")),
          });

    runnerRef.current = runner;
    runner.init().catch(() => {});

    return () => {
      active = false;
      runner.dispose();
      if (runnerRef.current === runner) {
        runnerRef.current = null;
      }
    };
  }, [project?.project_type]);

  useEffect(() => {
    const handler = (event) => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isShortcut) return;
      event.preventDefault();
      setCommandOpen((prev) => !prev);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!terminalBodyRef.current) return;
    terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
  }, [output]);

  useEffect(() => {
    if (!createFileMenuOpen && openSnapshotMenuId == null) return undefined;

    const handleClick = (event) => {
      if (createFileMenuRef.current?.contains(event.target)) return;
      setCreateFileMenuOpen(false);
      setOpenSnapshotMenuId(null);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [createFileMenuOpen, openSnapshotMenuId]);

  const queueFileSave = (fileId, content) => {
    const timers = fileSaveTimersRef.current;
    if (timers.has(fileId)) {
      window.clearTimeout(timers.get(fileId));
    }
    const timeoutId = window.setTimeout(async () => {
      try {
        await api.patch(`/projects/${id}/files/${fileId}`, { content });
      } catch (err) {
        setError(err.response?.data?.detail || "Failed to save file.");
      } finally {
        timers.delete(fileId);
      }
    }, 250);
    timers.set(fileId, timeoutId);
  };

  const queueBlockSave = (documentId, workspaceJson) => {
    const timers = blockSaveTimersRef.current;
    if (timers.has(documentId)) {
      window.clearTimeout(timers.get(documentId));
    }
    const timeoutId = window.setTimeout(async () => {
      try {
        await api.patch(`/projects/${id}/block-documents/${documentId}`, { workspace_json: workspaceJson });
      } catch (err) {
        setError(err.response?.data?.detail || "Failed to save block document.");
      } finally {
        timers.delete(documentId);
      }
    }, 300);
    timers.set(documentId, timeoutId);
  };

  const handleEditorChange = (value) => {
    if (!currentFile) return;
    setFiles((prev) => prev.map((file) => (file.id === currentFile.id ? { ...file, content: value } : file)));
    queueFileSave(currentFile.id, value);
  };

  const handleBlockWorkspaceChange = (documentId, workspaceJson) => {
    setBlockDocuments((prev) =>
      prev.map((document) => (document.id === documentId ? { ...document, workspace_json: workspaceJson } : document))
    );
    queueBlockSave(documentId, workspaceJson);
  };

  const handleGeneratedBlockCodeChange = (code) => {
    setGeneratedBlockCode(code || "");
  };

  const runCode = async () => {
    if (!runnerRef.current) return;
    try {
      setError("");
      clearTerminal();
      if (isPybricksProject) {
        if (!pybricksHubState.connected) {
          setError("Connect a PyBricks hub before running.");
          return;
        }
        if (isBlockEditorActive && currentBlockDocument) {
          await runnerRef.current.run({
            files,
            entryFileName: currentBlockDocument.generated_entry_module || "main.py",
            entryFileContent: generatedBlockCode || "",
          });
          return;
        }
      }
      await runnerRef.current.run({ files, entryFileId: currentFileId });
    } catch (err) {
      setError(err.message || "Run failed.");
    }
  };

  const stopCode = async () => {
    if (!runnerRef.current) return;
    try {
      await runnerRef.current.stop();
    } catch (err) {
      setError(err.message || "Stop failed.");
    }
  };

  const submitInputLine = () => {
    if (!runnerRef.current || !running) return;
    const line = `${stdinLine}\n`;
    const accepted = runnerRef.current.sendStdin(line);
    if (!accepted) return;
    appendOutput(line);
    setStdinLine("");
    setAwaitingInput(false);
    setInputPrompt("");
  };

  const handleRevealProject = async () => {
    if (!project?.root_path) return;
    await revealPath(project.root_path);
  };

  const connectPybricksHub = async (transport) => {
    if (!runnerRef.current || !isPybricksProject) return;
    setPybricksConnectionBusy(true);
    try {
      if (transport === "usb") {
        await runnerRef.current.connectUsb();
      } else {
        await runnerRef.current.connectBluetooth();
      }
      setPybricksConnectModalOpen(false);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to connect hub.");
    } finally {
      setPybricksConnectionBusy(false);
    }
  };

  const disconnectPybricksHub = async () => {
    if (!runnerRef.current || !isPybricksProject) return;
    setPybricksConnectionBusy(true);
    try {
      await runnerRef.current.disconnect();
    } catch (err) {
      setError(err.message || "Failed to disconnect hub.");
    } finally {
      setPybricksConnectionBusy(false);
    }
  };

  const createFile = async (kind = "text") => {
    setCreateFileMenuOpen(false);
    if (kind === "blocks") {
      const name = window.prompt("New block document name", "Blocks");
      if (!name) return;
      try {
        const res = await api.post(`/projects/${id}/block-documents`, { name });
        setBlockDocuments((prev) => [...prev, res.data]);
        setCurrentBlockDocumentId(res.data.id);
        setActiveEditorKind("blocks");
        setError("");
      } catch (err) {
        setError(err.response?.data?.detail || "Could not create block document.");
      }
      return;
    }

    const rawName = window.prompt("New Python file name", "helpers.py");
    const name = normalizePythonFileName(rawName);
    if (!name) return;
    try {
      const res = await api.post(`/projects/${id}/files`, { name, content: "" });
      setFiles((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setCurrentFileId(res.data.id);
      setActiveEditorKind("file");
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create file.");
    }
  };

  const renameFile = async (file) => {
    const nextName = normalizePythonFileName(window.prompt("Rename Python file", file.name));
    if (!nextName || nextName === file.name) return;
    try {
      const res = await api.patch(`/projects/${id}/files/${file.id}`, { name: nextName });
      setFiles((prev) => prev.map((entry) => (entry.id === file.id ? res.data : entry)).sort((a, b) => a.name.localeCompare(b.name)));
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not rename file.");
    }
  };

  const removeFile = async (file) => {
    if (!window.confirm(`Delete ${file.name}?`)) return;
    try {
      await api.delete(`/projects/${id}/files/${file.id}`);
      setFiles((prev) => prev.filter((entry) => entry.id !== file.id));
      if (currentFileId === file.id) {
        const nextFile = files.find((entry) => entry.id !== file.id);
        setCurrentFileId(nextFile?.id || null);
      }
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not delete file.");
    }
  };

  const renameBlockDocument = async (document) => {
    const nextName = window.prompt("Rename block document", document.name);
    if (!nextName || nextName === document.name) return;
    try {
      const res = await api.patch(`/projects/${id}/block-documents/${document.id}`, { name: nextName });
      setBlockDocuments((prev) => prev.map((entry) => (entry.id === document.id ? res.data : entry)));
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not rename block document.");
    }
  };

  const removeBlockDocument = async (document) => {
    if (!window.confirm(`Delete ${document.name}?`)) return;
    try {
      await api.delete(`/projects/${id}/block-documents/${document.id}`);
      const nextDocuments = blockDocuments.filter((entry) => entry.id !== document.id);
      setBlockDocuments(nextDocuments);
      if (currentBlockDocumentId === document.id) {
        setCurrentBlockDocumentId(nextDocuments[0]?.id || null);
        if (!files.length && nextDocuments.length > 0) {
          setActiveEditorKind("blocks");
        }
      }
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not delete block document.");
    }
  };

  const addTask = async () => {
    if (!taskDraft.trim()) return;
    try {
      const res = await api.post(`/projects/${id}/tasks`, { content: taskDraft.trim() });
      setTasks((prev) => [res.data, ...prev]);
      setTaskDraft("");
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create task.");
    }
  };

  const toggleTask = async (task) => {
    try {
      const res = await api.patch(`/projects/${id}/tasks/${task.id}`, { is_done: !task.is_done });
      setTasks((prev) => prev.map((entry) => (entry.id === task.id ? res.data : entry)));
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not update task.");
    }
  };

  const toggleTaskOwnership = async (task) => {
    try {
      const res = await api.patch(`/projects/${id}/tasks/${task.id}`, {
        assigned_to_user_id: task.assigned_to_name ? null : 1,
      });
      setTasks((prev) => prev.map((entry) => (entry.id === task.id ? res.data : entry)));
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not update task.");
    }
  };

  const removeTask = async (task) => {
    if (!window.confirm(`Delete task "${task.content}"?`)) return;
    try {
      await api.delete(`/projects/${id}/tasks/${task.id}`);
      setTasks((prev) => prev.filter((entry) => entry.id !== task.id));
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not delete task.");
    }
  };

  const addSnapshot = async () => {
    try {
      const res = await api.post(`/projects/${id}/snapshots`, { name: snapshotDraft.trim() || undefined });
      setSnapshots((prev) => [res.data, ...prev]);
      setSnapshotDraft("");
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create checkpoint.");
    }
  };

  const restoreSnapshot = async (snapshot) => {
    if (!window.confirm(`Restore checkpoint "${snapshot.name}"?`)) return;
    try {
      await api.post(`/projects/${id}/snapshots/${snapshot.id}/restore`);
      setOpenSnapshotMenuId(null);
      await loadProject();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not restore checkpoint.");
    }
  };

  const exportSnapshot = async (snapshot) => {
    try {
      const res = await api.get(`/projects/${id}/snapshots/${snapshot.id}/export`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = checkpointArchiveFileName(project?.name, snapshot.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
      setOpenSnapshotMenuId(null);
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not export checkpoint.");
    }
  };

  const deleteSnapshot = async (snapshot) => {
    if (!window.confirm(`Delete checkpoint "${snapshot.name}"?`)) return;
    try {
      await api.delete(`/projects/${id}/snapshots/${snapshot.id}`);
      setSnapshots((prev) => prev.filter((entry) => entry.id !== snapshot.id));
      setOpenSnapshotMenuId(null);
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not delete checkpoint.");
    }
  };

  const commandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    const matches = (value) => !query || value.toLowerCase().includes(query);
    const items = [
      {
        key: "reveal-folder",
        title: "Reveal project folder",
        subtitle: project?.root_path || "",
        icon: <FiFolder size={14} />,
        onSelect: handleRevealProject,
      },
      {
        key: "new-file",
        title: "Create Python file",
        subtitle: "Add a new `.py` file to this project",
        icon: <FiPlus size={14} />,
        onSelect: () => createFile("text"),
      },
      ...(isPybricksProject
        ? [
            {
              key: "new-block-document",
              title: "Create block document",
              subtitle: "Add a new PyBricks block workspace",
              icon: <FiZap size={14} />,
              onSelect: () => createFile("blocks"),
            },
          ]
        : []),
      {
        key: "create-checkpoint",
        title: "Create checkpoint",
        subtitle: "Snapshot the current local project state",
        icon: <FiCopy size={14} />,
        onSelect: addSnapshot,
      },
    ];

    filteredEditorEntries.forEach((entry) => {
      if (!matches(entry.name)) return;
      items.push({
        key: entry.key,
        title: entry.name,
        subtitle: entry.kind === "blocks" ? "Open block document" : "Open Python file",
        icon: entry.kind === "blocks" ? <FiZap size={14} /> : <FiFile size={14} />,
        onSelect: () => (entry.kind === "blocks" ? selectBlockDocument(entry.id) : selectFile(entry.id)),
      });
    });

    sortedTasks.forEach((task) => {
      if (!matches(task.content)) return;
      items.push({
        key: `task-${task.id}`,
        title: task.content,
        subtitle: task.is_done ? "Mark task as open" : "Mark task as done",
        icon: <FiCheck size={14} />,
        badge: task.is_done ? "Done" : "Open",
        onSelect: () => toggleTask(task),
      });
    });

    sortedSnapshots.forEach((snapshot) => {
      if (!matches(snapshot.name || "checkpoint")) return;
      items.push({
        key: `snapshot-${snapshot.id}`,
        title: snapshot.name,
        subtitle: "Restore checkpoint",
        icon: <FiRefreshCw size={14} />,
        onSelect: () => restoreSnapshot(snapshot),
      });
    });

    return items;
  }, [
    addSnapshot,
    commandQuery,
    filteredEditorEntries,
    handleRevealProject,
    isPybricksProject,
    project?.root_path,
    sortedSnapshots,
    sortedTasks,
  ]);

  return (
    <div className="editor-shell local-editor-shell">
      <aside className="editor-sidebar local-editor-sidebar">
        <div className="es-header">
          <button className="es-back-btn" onClick={() => navigate("/")} title="Return to projects">
            <FiChevronLeft size={16} />
          </button>
          <div className="es-project-name">{project?.name || "Loading project…"}</div>
          <div className="es-header-actions">
            <button className="es-icon-btn" onClick={handleRevealProject} title="Reveal project folder" disabled={!project?.root_path}>
              <FiFolder size={14} />
            </button>
          </div>
        </div>

        <div className="es-description">
          <p className="es-description-text local-editor-description">
            {project?.root_path || "Reading project folder…"}
          </p>
        </div>

        <div className="es-section es-files-section">
          <div className="es-section-header">
            <span className="es-section-label">Files</span>
            <div className="es-create-file-menu-wrap" ref={createFileMenuRef}>
              <button
                className={`es-icon-btn${createFileMenuOpen ? " active" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setCreateFileMenuOpen((prev) => !prev);
                }}
                title="New file"
              >
                <FiPlus size={14} />
              </button>
              {createFileMenuOpen && (
                <div className="es-create-file-menu" role="menu" aria-label="Create file">
                  <button className="es-create-file-option" onClick={() => createFile("text")}>
                    <FiFile size={13} />
                    <span>Python file</span>
                  </button>
                  {isPybricksProject && (
                    <button className="es-create-file-option" onClick={() => createFile("blocks")}>
                      <FiZap size={13} />
                      <span>Block file</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="es-search-wrap">
            <FiSearch className="es-search-icon" size={13} />
            <input
              className="es-search-input"
              placeholder="Search files..."
              value={fileSearch}
              onChange={(event) => setFileSearch(event.target.value)}
            />
          </div>

          <div className="es-file-list">
            {filteredEditorEntries.map((entry) => {
              const isActive = isEditorEntryActive(entry);
              return (
                <div key={entry.key} className="local-editor-entry-row">
                  {isActive && <div className="es-file-active-bg" />}
                  <div
                    className={`es-file-item ${isActive ? "active" : ""}`}
                    onClick={() => (entry.kind === "blocks" ? selectBlockDocument(entry.id) : selectFile(entry.id))}
                  >
                    <span className="es-file-name">
                      {entry.kind === "blocks" ? (
                        <FiZap size={13} className="es-file-icon-py" />
                      ) : (
                        <FiFile size={13} className="es-file-icon-py" />
                      )}
                      {entry.name}
                    </span>
                    <div className="es-file-actions">
                      <button
                        className="es-file-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (entry.kind === "blocks") {
                            const document = blockDocuments.find((item) => item.id === entry.id);
                            if (document) renameBlockDocument(document);
                            return;
                          }
                          const file = files.find((item) => item.id === entry.id);
                          if (file) renameFile(file);
                        }}
                        title="Rename"
                      >
                        <FiEdit2 size={11} />
                      </button>
                      <button
                        className="es-file-action danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (entry.kind === "blocks") {
                            const document = blockDocuments.find((item) => item.id === entry.id);
                            if (document) removeBlockDocument(document);
                            return;
                          }
                          const file = files.find((item) => item.id === entry.id);
                          if (file) removeFile(file);
                        }}
                        title="Delete"
                      >
                        <FiTrash2 size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredEditorEntries.length === 0 && <div className="es-empty">No matching files.</div>}
          </div>
        </div>

        <div className="es-section">
          <div className="es-section-header">
            <span className="es-section-label">Live tasks</span>
            <span className="es-badge">{sortedTasks.filter((task) => !task.is_done).length}</span>
          </div>
          <div className="es-task-compose">
            <input
              className="es-task-input"
              type="text"
              value={taskDraft}
              maxLength={240}
              placeholder="Add a task..."
              onChange={(event) => setTaskDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTask();
                }
              }}
            />
            <button className="es-task-add" onClick={addTask} disabled={!taskDraft.trim()}>
              <FiPlus size={13} />
            </button>
          </div>
          <div className="es-task-list">
            {sortedTasks.map((task) => (
              <div key={task.id} className={`es-task-item ${task.is_done ? "done" : ""}`}>
                <button className="es-task-toggle" onClick={() => toggleTask(task)} title={task.is_done ? "Re-open task" : "Complete task"}>
                  {task.is_done ? <FiCheck size={12} /> : <FiSquare size={12} />}
                </button>
                <div className="es-task-main">
                  <span className="es-task-content">{task.content}</span>
                  <span className="es-task-meta">
                    {task.is_done ? "Done locally" : "Open locally"}
                    {task.assigned_to_name ? " · Assigned to you" : " · Unassigned"}
                  </span>
                </div>
                <div className="es-task-row-actions">
                  <button
                    className={`es-task-assign ${task.assigned_to_name ? "active" : ""}`}
                    onClick={() => toggleTaskOwnership(task)}
                    title={task.assigned_to_name ? "Release task" : "Take task"}
                  >
                    {task.assigned_to_name ? "Release" : "Take"}
                  </button>
                  <button className="es-task-delete" onClick={() => removeTask(task)} title="Delete task">
                    <FiTrash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {sortedTasks.length === 0 && <div className="es-empty">No tasks yet. Add the first one.</div>}
          </div>
        </div>

        <div className="es-section">
          <div className="es-section-header">
            <span className="es-section-label">Checkpoints</span>
            <span className="es-badge">{sortedSnapshots.length}</span>
          </div>
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
                  addSnapshot();
                }
              }}
            />
            <button className="es-snapshot-add" onClick={addSnapshot} title="Create checkpoint">
              Save
            </button>
          </div>
          <div className="es-snapshot-list">
            {sortedSnapshots.map((snapshot) => (
              <div key={snapshot.id} className="es-snapshot-item">
                <div className="es-snapshot-main">
                  <span className="es-snapshot-name">{snapshot.name}</span>
                  <span className="es-snapshot-meta">
                    Local · {snapshot.file_count || 0} files · {formatSnapshotDate(snapshot.created_at)}
                  </span>
                </div>
                <div className="es-snapshot-actions">
                  <button
                    className="es-snapshot-menu-trigger"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenSnapshotMenuId((prev) => (prev === snapshot.id ? null : snapshot.id));
                    }}
                    aria-label={`Checkpoint actions for ${snapshot.name}`}
                    aria-expanded={openSnapshotMenuId === snapshot.id}
                    title="Checkpoint actions"
                  >
                    <FiMoreVertical size={14} />
                  </button>
                  {openSnapshotMenuId === snapshot.id && (
                    <div className="es-snapshot-menu" role="menu">
                      <button className="es-snapshot-menu-item" onClick={() => exportSnapshot(snapshot)}>
                        Export
                      </button>
                      <button className="es-snapshot-menu-item" onClick={() => restoreSnapshot(snapshot)}>
                        Restore
                      </button>
                      <button className="es-snapshot-menu-item danger" onClick={() => deleteSnapshot(snapshot)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sortedSnapshots.length === 0 && <div className="es-empty">No checkpoints yet.</div>}
          </div>
        </div>

        <div className="es-footer local-editor-footer">
          <div className="local-editor-footer-status">
            <span className="chip chip-muted">{projectTypeLabel}</span>
            <span className={`chip ${runtimeReady ? "chip-accent" : "chip-muted"}`}>
              {isPybricksProject ? (runtimeReady ? "Compiler Ready" : "Compiler Loading") : runtimeReady ? "Runtime Ready" : "Runtime Loading"}
            </span>
          </div>
          <div className="es-footer-row">
            <button className="es-icon-btn" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? <FiSun size={15} /> : <FiMoon size={15} />}
            </button>
            <button className="es-share-btn local-editor-reveal-btn" onClick={handleRevealProject} disabled={!project?.root_path}>
              <FiHardDrive size={13} /> Open folder
            </button>
          </div>
        </div>
      </aside>

      <main className="editor-workspace">
        <header className="editor-topbar">
          <div className="editor-topbar-left">
            <div className="editor-file">
              <div className="editor-file-icon">
                {isBlockEditorActive ? <FiZap size={18} className="file-icon" /> : <FiFile size={18} className="file-icon" />}
              </div>
              <div className="editor-file-meta">
                <div className="editor-file-name">
                  {isBlockEditorActive ? currentBlockDocument?.name || "Blocks" : currentFile?.name || "No file selected"}
                  <span className="editor-file-badge editor">Editable</span>
                </div>
                <div className="editor-file-path muted">
                  {isBlockEditorActive
                    ? `/workspace/${currentBlockDocument?.generated_entry_module || "main.py"}`
                    : currentFile
                      ? `/root/${currentFile.name}`
                      : "No Python file selected"}
                </div>
              </div>
            </div>

            <div className="editor-status">
              <span className="chip chip-muted">{projectTypeLabel}</span>
              {isPybricksProject ? (
                <span className={`chip ${pybricksHubState.connected ? "chip-success" : "chip-muted"}`}>
                  {pybricksHubState.connected ? `${pybricksHubState.transportLabel || "Hub"} Connected` : "Hub Offline"}
                </span>
              ) : (
                <span className={`chip ${runtimeReady ? "chip-success" : "chip-muted"}`}>
                  {runtimeReady ? "Runtime Ready" : "Runtime Loading"}
                </span>
              )}
            </div>
          </div>

          <div className="editor-topbar-actions">
            <button
              className={`icon-btn${terminalOpen ? " active" : ""}`}
              onClick={() => setTerminalOpen((prev) => !prev)}
              title={terminalOpen ? "Hide terminal" : "Show terminal"}
            >
              <FiTerminal size={16} />
            </button>
            <button
              className={`icon-btn${commandOpen ? " active" : ""}`}
              onClick={() => {
                setCommandQuery("");
                setCommandOpen(true);
              }}
              title="Open command palette"
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
                <FiZap size={14} />
                {pybricksConnectionBusy
                  ? "Connecting..."
                  : pybricksHubState.connected
                    ? `${pybricksHubState.transportLabel || "Hub"} Connected`
                    : "Connect Hub"}
              </button>
            )}
            <button
              className="btn btn-primary editor-run-btn"
              disabled={(!currentFile && !isBlockEditorActive) || running || !runtimeReady || (isPybricksProject && !pybricksHubState.connected)}
              onClick={runCode}
            >
              <FiPlay fill="currentColor" />
              {running ? "Running..." : isPybricksProject ? "Download & Run" : "Run Code"}
            </button>
            <button className="btn btn-ghost editor-stop-btn" disabled={!running} onClick={stopCode}>
              <FiSquare size={14} /> Stop
            </button>
          </div>

          {pybricksConnectModalOpen && isPybricksProject && (
            <div className="modal-overlay" onClick={() => !pybricksConnectionBusy && setPybricksConnectModalOpen(false)}>
              <div className="panel modal-card pybricks-connect-modal" onClick={(event) => event.stopPropagation()}>
                <div className="project-type-modal-header">
                  <div>
                    <div className="panel-title">Connect PyBricks hub</div>
                    <div className="muted project-type-modal-subtitle">Choose the hub connection transport for this local project.</div>
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
                      <FiZap size={18} />
                    </span>
                    <span className="project-type-option-title">Bluetooth</span>
                    <span className="project-type-option-copy">Use the PyBricks BLE transport, matching the normal in-browser workflow.</span>
                  </button>

                  <button className="project-type-option" onClick={() => connectPybricksHub("usb")} disabled={pybricksConnectionBusy}>
                    <span className="project-type-option-icon">
                      <FiHardDrive size={18} />
                    </span>
                    <span className="project-type-option-title">Wired</span>
                    <span className="project-type-option-copy">Use the PyBricks USB interface for a direct wired connection.</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </header>

        {error && <div className="alert alert-error local-editor-top-alert">{error}</div>}

        <div className={`editor-workspace-body ${terminalOpen ? "" : "terminal-collapsed"}`}>
          <div className="panel editor-pane">
            <div className="editor-pane-scroll">
              {isBlockEditorActive ? (
                <PybricksBlocksEditor
                  blockDocument={currentBlockDocument}
                  canEdit
                  onWorkspaceJsonChange={handleBlockWorkspaceChange}
                  onGeneratedCodeChange={handleGeneratedBlockCodeChange}
                  onToggleGeneratedCodeRequest={() => setShowGeneratedBlockCode((prev) => !prev)}
                  showGeneratedCode={showGeneratedBlockCode}
                />
              ) : currentFile ? (
                <CodeMirror
                  height="100%"
                  value={currentFile.content || ""}
                  extensions={[python()]}
                  theme={editorTheme}
                  onChange={handleEditorChange}
                  basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true }}
                />
              ) : (
                <div className="editor-mobile-unavailable">
                  <FiFile size={24} />
                  <strong>No Python file selected</strong>
                  <p>Create a `.py` file or pick one from the sidebar.</p>
                </div>
              )}
            </div>
          </div>

          <div className="panel-resizer horizontal editor-divider" />

          <div className={`panel terminal-pane ${terminalOpen ? "" : "collapsed"}`}>
            <div className="panel-header terminal-header">
              <div className="terminal-title">
                <FiTerminal size={16} />
                <strong>Terminal Output</strong>
                <span className={`terminal-connection ${runtimeReady ? "online" : "offline"}`}>
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
              </div>
              <div className="terminal-actions">
                <button className="icon-btn" onClick={() => setTerminalOpen(false)} title="Hide terminal">
                  <FiChevronDown />
                </button>
                <button className="icon-btn" onClick={clearTerminal} title="Clear terminal">
                  <FiTrash2 />
                </button>
              </div>
            </div>

            <div className="terminal-body" ref={terminalBodyRef}>
              {output ? (
                <pre className="terminal-output">{output}</pre>
              ) : (
                <div className="terminal-empty">
                  <FiTerminal size={20} />
                  <span>Ready to execute.</span>
                </div>
              )}
            </div>

            <div className="terminal-input-row">
              <input
                className={`input terminal-input ${awaitingInput ? "terminal-input-awaiting" : ""}`}
                value={stdinLine}
                placeholder={stdinPlaceholder}
                disabled={!running}
                onChange={(event) => setStdinLine(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitInputLine();
                  }
                }}
              />
            </div>
          </div>
        </div>
      </main>

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        title="PyCollab IDE Command Palette"
        placeholder="Search files, tasks, and checkpoints…"
        query={commandQuery}
        onQueryChange={setCommandQuery}
        items={commandItems}
        emptyText="No matching local actions."
      />
    </div>
  );
}
