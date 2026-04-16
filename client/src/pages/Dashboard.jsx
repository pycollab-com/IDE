import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FiAlertCircle,
  FiCode,
  FiCopy,
  FiEdit2,
  FiFolder,
  FiLink,
  FiMoreHorizontal,
  FiPlus,
  FiTrash2,
  FiZap,
} from "react-icons/fi";
import VerifiedBadge from "../components/VerifiedBadge";
import TypeModal from "./dashboards/TypeModal";
import useDashboardData from "./dashboards/useDashboardData";
import "./dashboards/dashboards.css";

export default function Dashboard({ user }) {
  const d = useDashboardData();
  const [openMenuProjectId, setOpenMenuProjectId] = useState(null);

  useEffect(() => {
    if (openMenuProjectId == null) return undefined;

    const handleClick = () => setOpenMenuProjectId(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openMenuProjectId]);

  const closeMenu = () => setOpenMenuProjectId(null);

  const handleMenuToggle = (event, projectId) => {
    event.stopPropagation();
    setOpenMenuProjectId((current) => (current === projectId ? null : projectId));
  };

  const handleRenameStart = (event, project) => {
    event.stopPropagation();
    closeMenu();
    d.startRename(project);
  };

  const handleDuplicate = async (event, project) => {
    event.stopPropagation();
    closeMenu();
    await d.duplicateProject(project);
  };

  const handleDelete = async (event, project) => {
    event.stopPropagation();
    closeMenu();
    await d.deleteProject(project.id, project.name);
  };

  const greetingName = user?.display_name || "there";

  return (
    <div className="dv dv5">
      <header className="dv5-header">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="dv5-title">Dashboard</h1>
          <p className="dv5-sub">
            <span>Hello {greetingName}</span>
            {user?.is_admin && <VerifiedBadge size={14} />}
            <span>,</span>
          </p>
        </motion.div>

        <div className="dv5-header-actions">
          <form onSubmit={d.createProject} className="dv5-create">
            <input
              className="input"
              placeholder="New project..."
              value={d.name}
              onChange={(event) => d.setName(event.target.value)}
            />
            <button className="btn" type="submit" disabled={d.creating}>
              <FiPlus size={16} />
            </button>
          </form>

          <div className="dv5-join">
            <input
              className="input"
              placeholder="Code"
              value={d.pin}
              onChange={(event) =>
                d.setPin(
                  event.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6),
                )
              }
              maxLength={6}
              style={{ letterSpacing: 3, textAlign: "center", fontWeight: 600, width: 120 }}
            />
            <button className="btn-secondary" type="button" onClick={d.joinProject}>
              <FiLink size={14} />
            </button>
          </div>
        </div>
      </header>

      {d.error && (
        <div className="alert alert-error dv5-alert">
          <FiAlertCircle size={18} /> {d.error}
        </div>
      )}

      <section className="dv5-projects-shell" aria-label="Projects">
        <div className="dv5-gallery">
          <AnimatePresence>
            {d.projects.map((project, index) => {
              const isPybricks = project.project_type === d.PROJECT_TYPE_PYBRICKS;
              const isRenaming = d.renamingProjectId === project.id;
              const isMenuOpen = openMenuProjectId === project.id;

              return (
                <motion.article
                  key={project.id}
                  className={`dv5-card ${isPybricks ? "pybricks" : ""}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={{ delay: index * 0.04 }}
                >
                  <div className="dv5-card-stripe" />

                  <div className="dv5-card-top">
                    <div className="dv5-card-menu" onClick={(event) => event.stopPropagation()}>
                      <button
                        className="btn-ghost dv5-card-menu-trigger"
                        type="button"
                        onClick={(event) => handleMenuToggle(event, project.id)}
                        aria-label={`Project actions for ${project.name}`}
                        aria-expanded={isMenuOpen}
                      >
                        <FiMoreHorizontal size={16} />
                      </button>

                      {isMenuOpen && (
                        <div className="dv5-card-menu-panel">
                          <button type="button" className="dv5-menu-item" onClick={(event) => handleRenameStart(event, project)}>
                            <FiEdit2 size={14} />
                            Rename project
                          </button>
                          <button
                            type="button"
                            className="dv5-menu-item"
                            onClick={(event) => handleDuplicate(event, project)}
                            disabled={d.rowActionLoading}
                          >
                            <FiCopy size={14} />
                            Duplicate
                          </button>
                          <button type="button" className="dv5-menu-item danger" onClick={(event) => handleDelete(event, project)}>
                            <FiTrash2 size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className={`dv5-card-body ${isRenaming ? "is-editing" : ""}`}
                    onClick={isRenaming ? undefined : () => d.openProject(project)}
                    role={isRenaming ? undefined : "button"}
                    tabIndex={isRenaming ? undefined : 0}
                    onKeyDown={
                      isRenaming
                        ? undefined
                        : (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              d.openProject(project);
                            }
                          }
                    }
                  >
                    <div className="dv5-card-icon">
                      {isPybricks ? <FiZap size={28} /> : <FiCode size={28} />}
                    </div>

                    {isRenaming ? (
                      <form className="dv5-rename-form" onSubmit={(event) => d.submitRename(event, project)}>
                        <input
                          className="input dv5-rename-input"
                          value={d.renamingName}
                          onChange={(event) => d.setRenamingName(event.target.value)}
                          aria-label={`Rename ${project.name}`}
                          autoFocus
                        />
                        <div className="dv5-rename-actions">
                          <button type="submit" className="btn" disabled={d.rowActionLoading}>
                            Save
                          </button>
                          <button type="button" className="btn-ghost" onClick={d.cancelRename} disabled={d.rowActionLoading}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <h2 className="dv5-card-name">{project.name}</h2>
                        <button
                          className={`dv5-card-visibility ${project.is_public ? "is-public" : "is-private"}`}
                          onClick={(event) => d.toggleVisibility(event, project)}
                          type="button"
                        >
                          {project.is_public ? "Public" : "Private"}
                        </button>
                      </>
                    )}
                  </div>

                  <button
                    className={`dv5-card-open ${isPybricks ? "is-pybricks" : ""}`}
                    type="button"
                    onClick={() => d.openProject(project)}
                  >
                    Open
                  </button>
                </motion.article>
              );
            })}
          </AnimatePresence>

          {d.projects.length === 0 && (
            <div className="empty-state dv5-empty-state">
              <FiFolder size={48} />
              <div>No projects yet</div>
              <span>Create your first project to get started.</span>
            </div>
          )}
        </div>
      </section>

      <TypeModal
        open={d.createTypeModalOpen}
        name={d.name}
        creating={d.creating}
        onClose={() => d.setCreateTypeModalOpen(false)}
        onSelect={d.createProjectOfType}
        PROJECT_TYPE_NORMAL={d.PROJECT_TYPE_NORMAL}
        PROJECT_TYPE_PYBRICKS={d.PROJECT_TYPE_PYBRICKS}
      />
    </div>
  );
}
