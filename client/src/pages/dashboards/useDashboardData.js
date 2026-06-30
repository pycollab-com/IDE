import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api";
import { PROJECT_TYPE_NORMAL, PROJECT_TYPE_PYBRICKS } from "../../projects/projectTypes";
import { toProjectPath } from "../../projects/projectPaths";

export default function useDashboardData() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [renamingName, setRenamingName] = useState("");
  const [rowActionLoading, setRowActionLoading] = useState(false);
  const [createTypeModalOpen, setCreateTypeModalOpen] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/projects");
      setProjects(res.data);
    } catch {
      setError("Failed to load projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createProject = (e) => {
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
    if (!confirm(`Delete project "${projectName}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/projects/${id}`);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setError("Failed to delete project.");
    }
  };

  const toggleVisibility = async (e, project) => {
    e.stopPropagation();
    try {
      const res = await api.patch(`/projects/${project.id}/visibility`);
      setProjects((prev) => prev.map((p) => (p.id === project.id ? res.data : p)));
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
      setProjects((prev) => prev.map((p) => (p.id === project.id ? res.data : p)));
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

  const openProject = (project) => navigate(toProjectPath(project));

  const stats = useMemo(() => ({
    total: projects.length,
    public: projects.filter((p) => p.is_public).length,
    private: projects.filter((p) => !p.is_public).length,
    pybricks: projects.filter((p) => p.project_type === PROJECT_TYPE_PYBRICKS).length,
  }), [projects]);

  return {
    projects, name, setName, pin, setPin, error, setError, loading,
    creating, createProject, createProjectOfType, joinProject,
    deleteProject, toggleVisibility, openProject,
    renamingProjectId, renamingName, setRenamingName,
    startRename, cancelRename, submitRename, rowActionLoading,
    duplicateProject, createTypeModalOpen, setCreateTypeModalOpen,
    stats, navigate, PROJECT_TYPE_NORMAL, PROJECT_TYPE_PYBRICKS,
  };
}
