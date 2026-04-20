import { useEffect, useRef, useState } from "react";
import "./PybricksBlocksEditor.css";

const HOST_SOURCE = "pycollab-pybricks-host";
const PARENT_SOURCE = "pycollab-pybricks-parent";
const HOST_URL = "/pybricks-blocks-host.html";

export default function PybricksBlocksEditor({
  blockDocument,
  canEdit,
  onWorkspaceJsonChange,
  onGeneratedCodeChange,
  onToggleGeneratedCodeRequest,
  showGeneratedCode = false,
}) {
  const iframeRef = useRef(null);
  const hostReadyRef = useRef(false);
  const currentWorkspaceJsonRef = useRef(blockDocument?.workspace_json || "");
  const currentDocumentIdRef = useRef(blockDocument?.id || null);
  const [generatedCode, setGeneratedCode] = useState("");

  const postToHost = (type, payload = {}) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: PARENT_SOURCE, type, payload },
      window.location.origin,
    );
  };

  useEffect(() => {
    currentDocumentIdRef.current = blockDocument?.id || null;
    currentWorkspaceJsonRef.current = blockDocument?.workspace_json || "";
  }, [blockDocument?.id, blockDocument?.workspace_json]);

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
        return;
      }

      if (message.type === "toggle-code") {
        onToggleGeneratedCodeRequest?.();
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
  ]);

  useEffect(() => {
    if (!hostReadyRef.current || !blockDocument?.id) return;
    postToHost("pybricks:init", {
      documentId: blockDocument.id,
      workspaceJson: blockDocument.workspace_json,
      readOnly: !canEdit,
    });
  }, [blockDocument?.id, blockDocument?.workspace_json, canEdit]);

  useEffect(() => {
    if (!hostReadyRef.current || !blockDocument?.id) return;
    const nextWorkspaceJson = blockDocument.workspace_json || "";
    if (currentWorkspaceJsonRef.current === nextWorkspaceJson) return;
    currentWorkspaceJsonRef.current = nextWorkspaceJson;
    postToHost("pybricks:apply-snapshot", {
      documentId: blockDocument.id,
      workspaceJson: nextWorkspaceJson,
      source: "external",
    });
  }, [blockDocument?.id, blockDocument?.workspace_json]);

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
