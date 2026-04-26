import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiArrowRight,
  FiDownload,
  FiFolder,
  FiHardDrive,
  FiMoon,
  FiPlus,
  FiRefreshCw,
  FiSun,
  FiTrash2,
  FiZap,
} from "react-icons/fi";
import { localApi } from "../api";
import TypeModal from "./dashboards/TypeModal";
import { checkAppUpdate, chooseCreateLocation, chooseImportSource, openAppUpdate } from "../utils/desktopBridge";

function formatReleaseDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function WelcomePage({ theme, toggleTheme, desktopContext }) {
  const navigate = useNavigate();
  const [recents, setRecents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [creating, setCreating] = useState(false);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [updateState, setUpdateState] = useState({
    loading: false,
    checked: false,
    error: "",
    result: null,
  });

  const loadRecents = async () => {
    setLoading(true);
    try {
      const res = await localApi.get("/ide/recents");
      setRecents(Array.isArray(res.data) ? res.data : []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load recent projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecents();
  }, []);

  const loadUpdate = async () => {
    if (!desktopContext?.isDesktop) {
      return;
    }

    setUpdateState((prev) => ({
      ...prev,
      loading: true,
      error: "",
    }));

    try {
      const result = await checkAppUpdate();
      setUpdateState({
        loading: false,
        checked: true,
        error: result?.ok ? "" : result?.error || "Could not check for updates.",
        result: result?.ok ? result : null,
      });
    } catch (err) {
      setUpdateState({
        loading: false,
        checked: true,
        error: err?.message || "Could not check for updates.",
        result: null,
      });
    }
  };

  useEffect(() => {
    loadUpdate();
  }, [desktopContext?.isDesktop, desktopContext?.version]);

  const openProject = (project) => navigate(`/local/projects/${project.id}`);

  const handleOpenProject = async () => {
    const sourcePath = await chooseImportSource();
    if (!sourcePath) return;
    const normalizedPath = sourcePath.toLowerCase();
    try {
      const res = normalizedPath.endsWith(".zip") || normalizedPath.endsWith(".py")
        ? await localApi.post("/ide/projects/import", { source_path: sourcePath })
        : await localApi.post("/ide/projects/open-folder", { folder_path: sourcePath });
      navigate(`/local/projects/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not open project.");
    }
  };

  const handlePickLocation = async () => {
    const selectedPath = await chooseCreateLocation();
    if (selectedPath) {
      setCreateLocation(selectedPath);
    }
  };

  const handleStartCreate = async () => {
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    if (!createLocation) {
      const selectedPath = await chooseCreateLocation();
      if (!selectedPath) return;
      setCreateLocation(selectedPath);
    }
    setTypeModalOpen(true);
  };

  const handleCreate = async (projectType) => {
    if (!name.trim() || !createLocation) return;
    setCreating(true);
    try {
      const res = await localApi.post("/ide/projects/create", {
        name: name.trim(),
        project_type: projectType,
        location_path: createLocation,
      });
      navigate(`/local/projects/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create project.");
    } finally {
      setCreating(false);
      setTypeModalOpen(false);
    }
  };

  const handleRemoveRecent = async (project) => {
    if (!window.confirm(`Remove "${project.name}" from recent projects?`)) return;
    try {
      await localApi.delete(`/ide/recents/${project.id}`);
      setRecents((prev) => prev.filter((entry) => entry.id !== project.id));
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not remove recent project.");
    }
  };

  const updateInfo = updateState.result;
  const releaseDate = formatReleaseDate(updateInfo?.published_at);
  const updateTargetUrl = updateInfo?.download_url || updateInfo?.release_url || "";
  const showUpdatePanel = Boolean(updateState.error || updateInfo?.update_available);

  return (
    <main className="ide-home-page">
      <header className="ide-home-header">
        <div>
          <h1>Projects</h1>
          <p>Open an existing project or create a new Normal or PyBricks project on disk.</p>
        </div>
        <button className="btn-ghost nav-icon-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? <FiSun size={18} /> : <FiMoon size={18} />}
        </button>
      </header>

      {error && <div className="alert alert-error ide-home-alert">{error}</div>}

      {showUpdatePanel && (
        <section className="panel ide-home-update">
          <div className="ide-home-update-head">
            <div>
              <div className="panel-title">App update</div>
              <div className="muted">
                Current version {desktopContext?.version || "dev"}
                {updateInfo?.latest_version ? ` · Latest release ${updateInfo.latest_version}` : ""}
                {releaseDate ? ` · Published ${releaseDate}` : ""}
              </div>
            </div>
            <div className="ide-home-update-actions">
              {updateInfo?.update_available ? <span className="chip chip-success">Update available</span> : null}
              <button className="btn-secondary" type="button" onClick={loadUpdate} disabled={updateState.loading}>
                <FiRefreshCw size={14} />
                {updateState.loading ? "Checking..." : "Check again"}
              </button>
              {updateState.checked && (
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => openAppUpdate(updateTargetUrl || "https://github.com/pycollab-com/IDE/releases")}
                >
                  <FiDownload size={14} />
                  {updateInfo?.update_available ? "Download update" : "View releases"}
                </button>
              )}
            </div>
          </div>
          {updateState.error ? (
            <div className="ide-home-update-note ide-home-update-note-error">{updateState.error}</div>
          ) : (
            <div className="ide-home-update-note">
              A newer GitHub release is available. Download the {updateInfo.asset_name || "latest build"}, replace the app in
              Applications, and relaunch.
            </div>
          )}
        </section>
      )}

      <section className="ide-home-actions">
        <motion.article className="panel ide-home-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="ide-home-card-head">
            <div>
              <div className="panel-title">New project</div>
              <div className="muted">Create a local project with the same Normal or PyBricks split used in PyCollab.</div>
            </div>
            <FiPlus size={18} />
          </div>
          <div className="ide-home-card-body">
            <label className="ide-form-field">
              <span>Name</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Competition Bot"
              />
            </label>
            <label className="ide-form-field">
              <span>Location</span>
              <div className="ide-inline-field">
                <input className="input" value={createLocation} readOnly placeholder="Choose a folder for new projects" />
                <button className="btn-secondary" type="button" onClick={handlePickLocation}>
                  <FiHardDrive size={14} />
                  Choose
                </button>
              </div>
            </label>
            <button className="btn btn-primary ide-primary-action" type="button" onClick={handleStartCreate} disabled={creating}>
              <FiArrowRight size={14} />
              {creating ? "Creating..." : "Continue"}
            </button>
          </div>
        </motion.article>

        <motion.article
          className="panel ide-home-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="ide-home-card-head">
            <div>
              <div className="panel-title">Open project</div>
              <div className="muted">Open a local folder in place, or bring in a `.zip` or `.py` file.</div>
            </div>
            <FiFolder size={18} />
          </div>
          <div className="ide-home-card-body">
            <button className="btn btn-primary ide-primary-action" type="button" onClick={handleOpenProject}>
              <FiFolder size={14} />
              Open project
            </button>
          </div>
        </motion.article>
      </section>

      <section className="panel ide-home-recents">
        <div className="ide-home-recents-head">
          <div>
            <div className="panel-title">Recent projects</div>
            <div className="muted">Reopen local folders quickly, or remove entries you no longer want in the list.</div>
          </div>
          <span className="chip chip-muted">{loading ? "…" : recents.length}</span>
        </div>

        <div className="ide-home-recents-list">
          {loading && <div className="ide-empty-state">Loading recent projects…</div>}
          {!loading && recents.length === 0 && (
            <div className="ide-empty-state">No local projects yet. Create one or open a folder to get started.</div>
          )}
          {!loading &&
            recents.map((project) => (
              <div key={project.id} className="ide-home-recent-row">
                <button type="button" className="ide-home-recent-main" onClick={() => openProject(project)}>
                  <div className="ide-home-recent-icon">
                    {project.project_type === "pybricks" ? <FiZap size={16} /> : <FiFolder size={16} />}
                  </div>
                  <div className="ide-home-recent-copy">
                    <div className="ide-home-recent-title-row">
                      <span className="ide-home-recent-name">{project.name}</span>
                      <span className="chip chip-muted">{project.project_type_label}</span>
                    </div>
                    <div className="ide-home-recent-meta">{project.root_path}</div>
                  </div>
                </button>
                <div className="ide-home-recent-actions">
                  <button className="btn-secondary" type="button" onClick={() => openProject(project)}>
                    Open
                  </button>
                  <button className="btn-ghost danger" type="button" onClick={() => handleRemoveRecent(project)}>
                    <FiTrash2 size={14} />
                    Remove
                  </button>
                </div>
              </div>
            ))}
        </div>
      </section>

      <TypeModal
        open={typeModalOpen}
        name={name}
        creating={creating}
        onClose={() => !creating && setTypeModalOpen(false)}
        onSelect={handleCreate}
        PROJECT_TYPE_NORMAL="normal"
        PROJECT_TYPE_PYBRICKS="pybricks"
      />
    </main>
  );
}
