import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { motion, AnimatePresence } from "framer-motion";
import { FiFolder, FiArrowRight, FiAlertCircle, FiTrash2, FiCode, FiCopy, FiEdit2, FiX, FiZap } from "react-icons/fi";
import VerifiedBadge from "../components/VerifiedBadge";
import CommandPalette from "../components/CommandPalette";
import { PROJECT_TYPE_NORMAL, PROJECT_TYPE_PYBRICKS } from "../projects/projectTypes";
import { toProjectPath } from "../projects/projectPaths";

export default function Dashboard({ user, onLogout, theme, toggleTheme }) {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [renamingName, setRenamingName] = useState("");
  const [rowActionLoading, setRowActionLoading] = useState(false);
  const [createTypeModalOpen, setCreateTypeModalOpen] = useState(false);
  const navigate = useNavigate();

  const quickItems = useMemo(() => {
    const query = quickQuery.trim().toLowerCase();
    return projects
      .filter((project) => {
        if (!query) return true;
        const name = project.name?.toLowerCase() || "";
        const description = project.description?.toLowerCase() || "";
        return name.includes(query) || description.includes(query);
      })
      .slice(0, 20)
      .map((project) => ({
        key: `project-${project.id}`,
        title: project.name,
        subtitle: project.description || "Open project workspace",
        badge: project.is_public ? "Public" : "Private",
        icon: <FiCode size={16} />,
        onSelect: () => navigate(toProjectPath(project)),
      }));
  }, [projects, quickQuery, navigate]);

  const load = async () => {
    try {
      const res = await api.get("/projects");
      setProjects(res.data);
    } catch (err) {
      setError("Failed to load projects.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const handleQuickSearchShortcut = (event) => {
      const isQuickSearch = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k";
      if (!isQuickSearch) return;
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) return;
      event.preventDefault();
      setQuickOpen(true);
    };

    window.addEventListener("keydown", handleQuickSearchShortcut);
    return () => window.removeEventListener("keydown", handleQuickSearchShortcut);
  }, []);

  const createProject = async (e) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreateTypeModalOpen(true);
  };

  const createProjectOfType = async (projectType) => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await api.post("/projects", { name, project_type: projectType });
      setName("");
      setCreateTypeModalOpen(false);
      navigate(toProjectPath(res.data));
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to create project");
    } finally {
      setCreating(false);
    }
  };

  const joinProject = async () => {
    const normalizedPin = pin.trim().toLowerCase();
    if (!/^[a-z0-9]{6}$/.test(normalizedPin)) {
      setError("Share code must be exactly 6 lowercase letters or numbers.");
      return;
    }
    try {
      const res = await api.post(`/projects/access/${normalizedPin}`);
      navigate(`${toProjectPath(res.data)}?share=${normalizedPin}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not join project");
    }
  };

  const deleteProject = async (id, projectName) => {
    const ok = confirm(`Delete project "${projectName}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.delete(`/projects/${id}`);
      setProjects((prev) => prev.filter((proj) => proj.id !== id));
    } catch {
      setError("Failed to delete project.");
    }
  };

  const toggleVisibility = async (e, project) => {
    e.stopPropagation();
    try {
      const res = await api.patch(`/projects/${project.id}/visibility`);
      setProjects(prev => prev.map(p => p.id === project.id ? res.data : p));
    } catch (err) {
      console.error(err);
    }
  };


  const startRename = (project) => {
    setRenamingProjectId(project.id);
    setRenamingName(project.name || "");
  };

  const cancelRename = () => {
    setRenamingProjectId(null);
    setRenamingName("");
  };

  const submitRename = async (e, project) => {
    e.preventDefault();
    const nextName = renamingName.trim();
    if (!nextName || rowActionLoading) return;
    setRowActionLoading(true);
    try {
      const res = await api.patch(`/projects/${project.id}`, {
        name: nextName,
        description: project.description || "",
        is_public: project.is_public,
      });
      setProjects((prev) => prev.map((proj) => (proj.id === project.id ? res.data : proj)));
      cancelRename();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to rename project.");
    } finally {
      setRowActionLoading(false);
    }
  };

  const duplicateProject = async (project) => {
    if (rowActionLoading) return;
    setRowActionLoading(true);
    try {
      const res = await api.post(`/projects/${project.id}/duplicate`);
      setProjects((prev) => [res.data, ...prev]);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to duplicate project.");
    } finally {
      setRowActionLoading(false);
    }
  };

  return (
    <motion.div
      className="container page-shell dashboard-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <header className="page-header dashboard-header">
        <motion.h1
          className="page-title"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          Dashboard
        </motion.h1>
        <motion.p
          className="page-subtitle subtitle-inline"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          style={{ maxWidth: 600 }}
        >
          Welcome back, <span className="text-strong" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{user?.display_name} {user?.is_admin && <VerifiedBadge size={16} />}</span>.
          Ready to build something amazing?
        </motion.p>
        <div className="chip chip-muted">{projects.length} projects</div>
      </header>

      <div className="dashboard-grid">
        <div className="dashboard-actions">
          <motion.div className="panel" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
            <div className="panel-header">
              <div className="panel-title">New Project</div>
              <div className="chip chip-muted">Create</div>
            </div>
            <div className="panel-body">
              <form onSubmit={createProject} className="form-stack">
                <input
                  className="input"
                  placeholder="Project name..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn" type="submit" disabled={creating}>
                  {creating ? "Creating..." : "Create Project"} <FiArrowRight />
                </motion.button>
              </form>
            </div>
          </motion.div>

          <motion.div className="panel" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
            <div className="panel-header">
              <div className="panel-title">Join with Code</div>
              <div className="chip chip-muted">Session</div>
            </div>
            <div className="panel-body">
              <div className="form-stack">
                <input
                  className="input"
                  placeholder="Enter 6-character code"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6))}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  style={{ textAlign: "center", letterSpacing: 3, fontWeight: 600, fontSize: "1rem" }}
                />
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-secondary" type="button" onClick={joinProject}>
                  Join Session
                </motion.button>
              </div>
            </div>
          </motion.div>

          {error && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="alert alert-error">
              <FiAlertCircle size={20} /> <span style={{ fontWeight: 500 }}>{error}</span>
            </motion.div>
          )}
        </div>

        <div className="panel dashboard-projects">
          <div className="panel-header">
            <div className="panel-title">Projects</div>
            <div className="chip chip-muted">{projects.length} total</div>
          </div>
          <div className="panel-body">
            <div className="dashboard-project-list">
              <AnimatePresence>
                {projects.map((p, i) => {
                  const isRenaming = renamingProjectId === p.id;
                  return (
                    <motion.div
                      key={p.id}
                      className={`project-row${isRenaming ? " is-renaming" : ""}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <div className="project-row-main">
                        <div className="project-icon">
                          {p.project_type === PROJECT_TYPE_PYBRICKS ? <FiZap size={20} /> : <FiCode size={20} />}
                        </div>
                        <div className="project-row-content">
                          {isRenaming ? (
                            <form className="project-rename-form" onSubmit={(e) => submitRename(e, p)}>
                              <input
                                className="input project-rename-input"
                                value={renamingName}
                                onChange={(e) => setRenamingName(e.target.value)}
                                aria-label={`Rename ${p.name}`}
                                autoFocus
                              />
                              <button type="submit" className="btn-ghost" disabled={rowActionLoading}>
                                Save
                              </button>
                              <button type="button" className="btn-ghost" onClick={cancelRename} disabled={rowActionLoading}>
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <>
                              <div className="project-name">{p.name}</div>
                              <div className="muted project-subtitle">
                                {p.project_type === PROJECT_TYPE_PYBRICKS ? "PyBricks project" : "Last edited recently"}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="project-row-actions">
                        <button
                          className="btn-ghost project-visibility"
                          onClick={(e) => toggleVisibility(e, p)}
                          title={p.is_public ? "Make Private" : "Make Public"}
                        >
                          {p.is_public ? "Public" : "Private"}
                        </button>
                        <button className="btn-ghost" onClick={() => startRename(p)} title="Rename Project">
                          <FiEdit2 size={16} />
                        </button>
                        <button className="btn-ghost" onClick={() => duplicateProject(p)} title="Duplicate Project" disabled={rowActionLoading}>
                          <FiCopy size={16} />
                        </button>
                        <button
                          className={`btn ${p.project_type === PROJECT_TYPE_PYBRICKS ? "dashboard-open-btn-pybricks" : ""}`}
                          onClick={() => navigate(toProjectPath(p))}
                        >
                          Open
                        </button>
                        <button className="btn-ghost danger" onClick={() => deleteProject(p.id, p.name)} title="Delete Project">
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {projects.length === 0 && (
                <div className="empty-state">
                  <FiFolder size={48} />
                  <div>No projects yet</div>
                  <span>Create your first project to get started.</span>
                </div>
              )}
              </div>
          </div>
        </div>
      </div>

      <CommandPalette
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Project Quick Search"
        placeholder="Search projects..."
        query={quickQuery}
        onQueryChange={setQuickQuery}
        items={quickItems}
        emptyText={projects.length ? "No projects match this search." : "No projects yet."}
        footerHint="Project search • Cmd/Ctrl+K"
      />

      <AnimatePresence>
        {createTypeModalOpen && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !creating && setCreateTypeModalOpen(false)}
          >
            <motion.div
              className="panel modal-card project-type-modal-card"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="project-type-modal-header">
                <div>
                  <div className="panel-title">Choose Project Type</div>
                  <div className="muted project-type-modal-subtitle">Create "{name.trim()}" as a normal project or a PyBricks project.</div>
                </div>
                <button
                  className="btn-ghost modal-close"
                  onClick={() => setCreateTypeModalOpen(false)}
                  disabled={creating}
                  title="Close"
                >
                  <FiX size={18} />
                </button>
              </div>

              <div className="project-type-option-grid">
                <button
                  className="project-type-option"
                  onClick={() => createProjectOfType(PROJECT_TYPE_NORMAL)}
                  disabled={creating}
                >
                  <span className="project-type-option-icon">
                    <FiCode size={18} />
                  </span>
                  <span className="project-type-option-title">Normal Project</span>
                  <span className="project-type-option-copy">Browser Python runtime with the existing PyCollab flow.</span>
                </button>

                <button
                  className="project-type-option project-type-option-pybricks"
                  onClick={() => createProjectOfType(PROJECT_TYPE_PYBRICKS)}
                  disabled={creating}
                >
                  <span className="project-type-option-icon">
                    <FiZap size={18} />
                  </span>
                  <span className="project-type-option-title">PyBricks Project</span>
                  <span className="project-type-option-copy">Realtime editing plus PyBricks compile and hub download support.</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
