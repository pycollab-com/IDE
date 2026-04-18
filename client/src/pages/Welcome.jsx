import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiArrowRight,
  FiFolder,
  FiHardDrive,
  FiMoon,
  FiPlus,
  FiSun,
  FiTrash2,
  FiZap,
} from "react-icons/fi";
import api from "../api";
import TypeModal from "./dashboards/TypeModal";
import { chooseCreateLocation, chooseFolder } from "../utils/desktopBridge";

export default function WelcomePage({ theme, toggleTheme }) {
  const navigate = useNavigate();
  const [recents, setRecents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [creating, setCreating] = useState(false);
  const [typeModalOpen, setTypeModalOpen] = useState(false);

  const loadRecents = async () => {
    setLoading(true);
    try {
      const res = await api.get("/ide/recents");
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

  const openProject = (project) => navigate(`/projects/${project.id}`);

  const handleOpenFolder = async () => {
    const folderPath = await chooseFolder();
    if (!folderPath) return;
    try {
      const res = await api.post("/ide/projects/open-folder", { folder_path: folderPath });
      navigate(`/projects/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not open folder.");
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
      const res = await api.post("/ide/projects/create", {
        name: name.trim(),
        project_type: projectType,
        location_path: createLocation,
      });
      navigate(`/projects/${res.data.id}`);
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
      await api.delete(`/ide/recents/${project.id}`);
      setRecents((prev) => prev.filter((entry) => entry.id !== project.id));
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not remove recent project.");
    }
  };

  return (
    <main className="ide-home-page">
      <header className="ide-home-header">
        <div>
          <h1>Projects</h1>
          <p>Open a local folder or create a new Normal or PyBricks project on disk.</p>
        </div>
        <button className="btn-ghost nav-icon-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? <FiSun size={18} /> : <FiMoon size={18} />}
        </button>
      </header>

      {error && <div className="alert alert-error ide-home-alert">{error}</div>}

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
              <div className="panel-title">Open folder</div>
              <div className="muted">Open an existing local codebase in place.</div>
            </div>
            <FiFolder size={18} />
          </div>
          <div className="ide-home-card-body">
            <button className="btn btn-primary ide-primary-action" type="button" onClick={handleOpenFolder}>
              <FiFolder size={14} />
              Open local folder
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
