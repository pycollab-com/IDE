import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { FiChevronLeft, FiCopy, FiMoon, FiSun, FiWifi } from "react-icons/fi";
import { localApi } from "../api";

export default function CachedProjectPage({ theme, toggleTheme, hostedOnline = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cache, setCache] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [error, setError] = useState("");
  const [copying, setCopying] = useState(false);

  const files = useMemo(() => cache?.project?.files || [], [cache]);
  const selectedFile = files.find((file) => file.name === selectedFileName) || files[0] || null;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!id) return;
      try {
        const res = await localApi.get(`/ide/hosted-cache/${encodeURIComponent(id)}`);
        if (cancelled) return;
        setCache(res.data);
        setSelectedFileName(res.data?.project?.files?.[0]?.name || "");
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.detail || "No cached copy is available for this hosted project.");
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const createLocalCopy = async () => {
    if (!id || copying) return;
    setCopying(true);
    try {
      const res = await localApi.post(`/ide/hosted-cache/${encodeURIComponent(id)}/copy`, {
        name: `${cache?.project?.name || "Hosted Project"} Offline Copy`,
      });
      navigate(`/local/projects/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create a local copy.");
    } finally {
      setCopying(false);
    }
  };

  return (
    <main className="cached-project-page">
      <header className="cached-project-header">
        <div>
          <div className="cached-project-header-main">
            <button className="btn-ghost cached-project-back" type="button" onClick={() => navigate("/")}>
              <FiChevronLeft size={14} />
              Back to dashboard
            </button>
            <div className="muted">Read-only cached hosted project</div>
          </div>
          <h1>{cache?.project?.name || "Cached Project"}</h1>
          <p>
            {cache?.cached_at
              ? `Last cached ${new Date(cache.cached_at).toLocaleString()}.`
              : "This snapshot is stored locally."}{" "}
            Create a local copy if you need to edit offline.
          </p>
        </div>
        <div className="cached-project-actions">
          <button className="btn-ghost nav-icon-btn" onClick={toggleTheme} title="Toggle theme">
            {theme === "dark" ? <FiSun size={18} /> : <FiMoon size={18} />}
          </button>
          <button className="btn" type="button" onClick={createLocalCopy} disabled={!cache || copying}>
            <FiCopy size={15} />
            {copying ? "Creating..." : "Create local copy"}
          </button>
        </div>
      </header>

      {error && <div className="alert alert-error cached-project-alert">{error}</div>}
      {hostedOnline ? (
        <div className="alert alert-success cached-project-live-alert">
          <span>The hosted project is available again. Open the live version to resume collaboration.</span>
          <button className="btn-secondary" type="button" onClick={() => navigate(`/projects/${id}`)}>
            <FiWifi size={14} />
            Open live project
          </button>
        </div>
      ) : null}

      {cache && (
        <section className="cached-project-shell">
          <aside className="cached-project-files">
            <div className="panel-title">Files</div>
            {files.length === 0 ? (
              <p className="muted">No cached files.</p>
            ) : (
              files.map((file) => (
                <button
                  key={file.name}
                  type="button"
                  className={`cached-project-file ${selectedFile?.name === file.name ? "active" : ""}`}
                  onClick={() => setSelectedFileName(file.name)}
                >
                  {file.name}
                </button>
              ))
            )}
          </aside>

          <div className="cached-project-editor">
            <div className="cached-project-editor-bar">
              <strong>{selectedFile?.name || "No file selected"}</strong>
              <span>Read-only</span>
            </div>
            <CodeMirror
              value={selectedFile?.content || ""}
              height="100%"
              extensions={[python()]}
              editable={false}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          </div>
        </section>
      )}
    </main>
  );
}
