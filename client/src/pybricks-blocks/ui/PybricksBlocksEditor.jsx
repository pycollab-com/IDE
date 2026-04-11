import { useEffect, useMemo, useRef, useState } from "react";
import "./PybricksBlocksEditor.css";

const HOST_SOURCE = "pycollab-pybricks-host";
const PARENT_SOURCE = "pycollab-pybricks-parent";
const HOST_URL = "/pybricks-blocks-host.html";

const makeOpId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

export default function PybricksBlocksEditor({
  blockDocument,
  socket,
  socketProjectId,
  canEdit,
  presence,
  currentUserId,
  followPresence,
  onWorkspaceJsonChange,
  onGeneratedCodeChange,
  onToggleGeneratedCodeRequest,
  showGeneratedCode = false,
}) {
  const iframeRef = useRef(null);
  const hostReadyRef = useRef(false);
  const currentWorkspaceJsonRef = useRef(blockDocument?.workspace_json || "");
  const currentDocumentIdRef = useRef(blockDocument?.id || null);
  const collabRef = useRef({ rev: 0, pending: null, buffer: null, inFlight: false, opId: null });
  const [generatedCode, setGeneratedCode] = useState("");

  const remoteBlockPresence = useMemo(
    () =>
      (presence || [])
        .map((person) => ({ ...person, block_presence: person?.block_presence || null }))
        .filter(
          (person) =>
            person.user_id !== currentUserId &&
            person.block_presence &&
            person.block_presence.documentId === blockDocument?.id,
        ),
    [blockDocument?.id, currentUserId, presence],
  );

  const postToHost = (type, payload = {}) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: PARENT_SOURCE, type, payload },
      window.location.origin,
    );
  };

  useEffect(() => {
    currentDocumentIdRef.current = blockDocument?.id || null;
    currentWorkspaceJsonRef.current = blockDocument?.workspace_json || "";
    collabRef.current.rev = typeof blockDocument?.rev === "number" ? blockDocument.rev : 0;
    collabRef.current.pending = null;
    collabRef.current.buffer = null;
    collabRef.current.inFlight = false;
    collabRef.current.opId = null;
  }, [blockDocument?.id, blockDocument?.rev]);

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message || message.source !== HOST_SOURCE) return;

      if (message.type === "ready") {
        hostReadyRef.current = true;
        if (blockDocument?.id) {
          postToHost("pybricks:init", {
            documentId: blockDocument.id,
            workspaceJson: blockDocument.workspace_json,
            readOnly: !canEdit,
          });
        }
        return;
      }

      const payload = message.payload || {};
      if (payload.documentId !== currentDocumentIdRef.current) return;

      if (message.type === "workspace-update") {
        const workspaceJson = typeof payload.workspaceJson === "string" ? payload.workspaceJson : "";
        currentWorkspaceJsonRef.current = workspaceJson;
        onWorkspaceJsonChange?.(payload.documentId, workspaceJson);
        const nextCode = payload.generatedCode || "";
        setGeneratedCode(nextCode);
        onGeneratedCodeChange?.(nextCode);

        if (payload.source !== "local" || !canEdit || !socket?.connected || !socketProjectId) {
          return;
        }

        const st = collabRef.current;
        const nextPending = { event: {}, workspaceJson };
        if (st.pending) {
          st.buffer = nextPending;
          return;
        }
        st.pending = nextPending;
        st.opId = makeOpId();
        st.inFlight = false;
        socket.emit("blocks_op", {
          projectId: socketProjectId,
          documentId: payload.documentId,
          baseRev: st.rev,
          opId: st.opId,
          event: {},
          workspaceJson,
        });
        st.inFlight = true;
        return;
      }

      if (message.type === "local-presence") {
        if (!socket?.connected || !socketProjectId) return;
        socket.emit("blocks_presence", {
          projectId: socketProjectId,
          presence: payload.presence
            ? {
                ...payload.presence,
                documentId: payload.documentId,
              }
            : null,
        });
        return;
      }

      if (message.type === "toggle-code") {
        onToggleGeneratedCodeRequest?.();
        return;
      }

      if (message.type === "help" && payload.docsPath) {
        const docsTarget = payload.docsPath.startsWith("http")
          ? payload.docsPath
          : `https://beta.pybricks.com/static/docs/v2.20.0/${payload.docsPath}`;
        window.open(docsTarget, "_blank", "noopener,noreferrer");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    blockDocument?.id,
    blockDocument?.workspace_json,
    canEdit,
    onGeneratedCodeChange,
    onToggleGeneratedCodeRequest,
    onWorkspaceJsonChange,
    socket,
    socketProjectId,
  ]);

  useEffect(() => {
    if (!hostReadyRef.current || !blockDocument?.id) return;
    postToHost("pybricks:init", {
      documentId: blockDocument.id,
      workspaceJson: blockDocument.workspace_json,
      readOnly: !canEdit,
    });
  }, [blockDocument?.id, canEdit]);

  useEffect(() => {
    if (!hostReadyRef.current || !blockDocument?.id) return;
    const nextWorkspaceJson = blockDocument.workspace_json || "";
    if (currentWorkspaceJsonRef.current === nextWorkspaceJson) return;
    currentWorkspaceJsonRef.current = nextWorkspaceJson;
    postToHost("pybricks:apply-snapshot", {
      documentId: blockDocument.id,
      workspaceJson: nextWorkspaceJson,
      source: "remote",
    });
  }, [blockDocument?.id, blockDocument?.workspace_json]);

  useEffect(() => {
    if (!hostReadyRef.current || !blockDocument?.id) return;
    postToHost("pybricks:remote-presence", {
      documentId: blockDocument.id,
      presence: remoteBlockPresence,
    });
  }, [blockDocument?.id, remoteBlockPresence]);

  useEffect(() => {
    if (!hostReadyRef.current || !blockDocument?.id) return;
    postToHost("pybricks:follow-presence", {
      documentId: blockDocument.id,
      presence:
        followPresence && followPresence.documentId === blockDocument.id
          ? followPresence
          : null,
    });
  }, [blockDocument?.id, followPresence]);

  useEffect(() => {
    if (!blockDocument?.id) return undefined;

    const sendPending = () => {
      const st = collabRef.current;
      if (!st.pending || st.inFlight || !socket?.connected || !socketProjectId) return;
      if (!st.opId) st.opId = makeOpId();
      socket.emit("blocks_op", {
        projectId: socketProjectId,
        documentId: blockDocument.id,
        baseRev: st.rev,
        opId: st.opId,
        event: st.pending.event,
        workspaceJson: st.pending.workspaceJson,
      });
      st.inFlight = true;
    };

    const requestSync = (fromRev = collabRef.current.rev) => {
      if (!socket?.connected || !socketProjectId) return;
      socket.emit("blocks_sync_request", {
        projectId: socketProjectId,
        documentId: blockDocument.id,
        fromRev,
      });
    };

    const applySnapshot = (workspaceJson, rev) => {
      currentWorkspaceJsonRef.current = workspaceJson;
      onWorkspaceJsonChange?.(blockDocument.id, workspaceJson);
      postToHost("pybricks:apply-snapshot", {
        documentId: blockDocument.id,
        workspaceJson,
        source: "remote",
      });
      collabRef.current.rev = typeof rev === "number" ? rev : collabRef.current.rev;
      collabRef.current.pending = null;
      collabRef.current.buffer = null;
      collabRef.current.inFlight = false;
      collabRef.current.opId = null;
    };

    const handleAck = (data) => {
      if (data?.documentId !== blockDocument.id || data?.opId !== collabRef.current.opId) return;
      collabRef.current.rev = typeof data.rev === "number" ? data.rev : collabRef.current.rev;
      collabRef.current.pending = null;
      collabRef.current.inFlight = false;
      collabRef.current.opId = null;
      if (collabRef.current.buffer) {
        collabRef.current.pending = collabRef.current.buffer;
        collabRef.current.buffer = null;
        collabRef.current.opId = makeOpId();
        sendPending();
      }
    };

    const handleReject = (data) => {
      if (data?.documentId !== blockDocument.id || data?.opId !== collabRef.current.opId) return;
      collabRef.current.inFlight = false;
      requestSync(collabRef.current.rev);
    };

    const handleSnapshot = (data) => {
      if (data?.documentId !== blockDocument.id || typeof data?.workspaceJson !== "string") return;
      applySnapshot(data.workspaceJson, data.rev);
    };

    const handleIncomingOp = (data) => {
      if (data?.documentId !== blockDocument.id || typeof data?.rev !== "number") return;
      if (data.rev !== collabRef.current.rev + 1) {
        requestSync(collabRef.current.rev);
        return;
      }
      if (typeof data.workspaceJson === "string") {
        applySnapshot(data.workspaceJson, data.rev);
      } else {
        collabRef.current.rev = data.rev;
      }
    };

    const handleIncomingOps = (data) => {
      if (data?.documentId !== blockDocument.id || !Array.isArray(data?.ops)) return;
      data.ops.forEach(handleIncomingOp);
    };

    const handleConnect = () => requestSync(collabRef.current.rev);

    socket?.on("blocks_op_ack", handleAck);
    socket?.on("blocks_op_reject", handleReject);
    socket?.on("blocks_snapshot", handleSnapshot);
    socket?.on("blocks_op", handleIncomingOp);
    socket?.on("blocks_ops", handleIncomingOps);
    socket?.on("connect", handleConnect);

    return () => {
      socket?.off("blocks_op_ack", handleAck);
      socket?.off("blocks_op_reject", handleReject);
      socket?.off("blocks_snapshot", handleSnapshot);
      socket?.off("blocks_op", handleIncomingOp);
      socket?.off("blocks_ops", handleIncomingOps);
      socket?.off("connect", handleConnect);
    };
  }, [blockDocument?.id, canEdit, onWorkspaceJsonChange, socket, socketProjectId]);

  useEffect(() => {
    const handleResize = () => {
      if (!hostReadyRef.current || !blockDocument?.id) return;
      postToHost("pybricks:resize", { documentId: blockDocument.id });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [blockDocument?.id]);

  return (
    <div className={`pybricks-blocks-shell ${showGeneratedCode ? "with-preview" : ""}`}>
      <div className="pybricks-blocks-stage">
        <iframe
          ref={iframeRef}
          className="pybricks-blocks-canvas"
          src={HOST_URL}
          title="Pybricks blocks editor"
        />
      </div>
      {showGeneratedCode && (
        <aside className="pybricks-generated-preview">
          <div className="pybricks-generated-preview-header">Generated main.py</div>
          <pre>{generatedCode}</pre>
        </aside>
      )}
    </div>
  );
}
