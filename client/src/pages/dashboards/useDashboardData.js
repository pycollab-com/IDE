import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { localApi } from "../../api";
import { getPersistentState, patchPersistentState } from "../../persistentState";
import { getProjectRouteId, toProjectPath } from "../../projects/projectPaths";
import {
  PROJECT_TYPE_NORMAL,
  PROJECT_TYPE_PYBRICKS,
  isOfflineCopyProject,
} from "../../projects/projectTypes";

const OFFLINE_NOTICE =
  "You're offline. Hosted projects stay visible from the last sync in read-only mode. Local offline copies remain editable.";

function readCachedProjects() {
  const cachedProjects = getPersistentState().hostedProjectsCache;
  return Array.isArray(cachedProjects) ? cachedProjects : [];
}

function writeCachedProjects(projects) {
  patchPersistentState({
    hostedProjectsCache: Array.isArray(projects) ? projects : [],
  });
}

async function cacheHostedProjectSnapshot(project) {
  const cacheId = getProjectRouteId(project);
  if (!cacheId) return;
  try {
    const res = await api.get(`/projects/${cacheId}`);
    await localApi.post(`/ide/hosted-cache/${encodeURIComponent(cacheId)}`, {
      project: res.data,
    });
  } catch {
    // Dashboard caching is opportunistic. Hosted routes still work online.
  }
}

async function loadOfflineCopies() {
  try {
    const res = await localApi.get("/projects");
    const projects = Array.isArray(res.data) ? res.data : [];
    return projects.filter((project) => isOfflineCopyProject(project));
  } catch {
    return [];
  }
}

function mergeProjectCollections(hostedProjects, offlineCopies) {
  const merged = [];
  const seen = new Set();

  for (const project of [...hostedProjects, ...offlineCopies]) {
    const key = isOfflineCopyProject(project)
      ? `local:${project.id}`
      : `hosted:${getProjectRouteId(project)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(project);
  }

  return merged;
}

export default function useDashboardData({ hostedOnline = true } = {}) {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [renamingName, setRenamingName] = useState("");
  const [rowActionLoading, setRowActionLoading] = useState(false);
  const [createTypeModalOpen, setCreateTypeModalOpen] = useState(false);
  const [importingProject, setImportingProject] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    if (!hostedOnline) {
      const cachedProjects = readCachedProjects();
      const offlineCopies = await loadOfflineCopies();
      setProjects(mergeProjectCollections(cachedProjects, offlineCopies));
      setNotice(OFFLINE_NOTICE);
      setError("");
      return;
    }

    try {
      const [hostedRes, offlineCopies] = await Promise.all([api.get("/projects"), loadOfflineCopies()]);
      const nextHostedProjects = Array.isArray(hostedRes.data) ? hostedRes.data : [];
      setProjects(mergeProjectCollections(nextHostedProjects, offlineCopies));
      writeCachedProjects(nextHostedProjects);
      setNotice("");
      setError("");
      Promise.allSettled(nextHostedProjects.map(cacheHostedProjectSnapshot));
    } catch {
      const cachedProjects = readCachedProjects();
      const offlineCopies = await loadOfflineCopies();
      if (cachedProjects.length > 0 || offlineCopies.length > 0) {
        setProjects(mergeProjectCollections(cachedProjects, offlineCopies));
        setNotice(OFFLINE_NOTICE);
        setError("");
        return;
      }
      setProjects([]);
      setNotice("");
      setError("Failed to load projects.");
    }
  };

  useEffect(() => {
    load();
  }, [hostedOnline]);

  const requireHostedConnection = () => {
    if (hostedOnline) {
      return false;
    }
    setNotice(OFFLINE_NOTICE);
    return true;
  };

  const createProject = (e) => {
    e.preventDefault();
    if (!name.trim() || creating || requireHostedConnection()) return;
    setCreateTypeModalOpen(true);
  };

  const createProjectOfType = async (projectType) => {
    if (!name.trim() || creating || requireHostedConnection()) return;
    setCreating(true);
    try {
      const res = await api.post("/projects", { name, project_type: projectType });
      const createdProject = res.data;
      setProjects((prev) => {
        const next = [createdProject, ...prev];
        writeCachedProjects(next.filter((project) => !isOfflineCopyProject(project)));
        return next;
      });
      setName("");
      setCreateTypeModalOpen(false);
      navigate(toProjectPath(createdProject));
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Unable to create project");
    } finally {
      setCreating(false);
    }
  };

  const joinProject = async () => {
    if (requireHostedConnection()) return;
    const normalizedPin = pin.trim().toLowerCase();
    if (!/^[a-z0-9]{6}$/.test(normalizedPin)) {
      setError("Share code must be exactly 6 lowercase letters or numbers.");
      return;
    }
    try {
      const res = await api.post(`/projects/access/${normalizedPin}`);
      const joinedProject = res.data;
      setProjects((prev) => {
        const seen = new Set();
        const next = [joinedProject, ...prev].filter((project) => {
          const routeId = isOfflineCopyProject(project) ? `local:${project.id}` : getProjectRouteId(project);
          if (seen.has(routeId)) return false;
          seen.add(routeId);
          return true;
        });
        writeCachedProjects(next.filter((project) => !isOfflineCopyProject(project)));
        return next;
      });
      navigate(`${toProjectPath(joinedProject)}?share=${normalizedPin}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not join project");
    }
  };

  const deleteProject = async (project) => {
    if (!project) return;
    if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    try {
      if (isOfflineCopyProject(project)) {
        await localApi.delete(`/projects/${project.id}`);
      } else {
        if (requireHostedConnection()) return;
        await api.delete(`/projects/${project.id}`);
      }
      setProjects((prev) => {
        const next = prev.filter((entry) =>
          isOfflineCopyProject(project)
            ? !(isOfflineCopyProject(entry) && entry.id === project.id)
            : getProjectRouteId(entry) !== getProjectRouteId(project)
        );
        writeCachedProjects(next.filter((entry) => !isOfflineCopyProject(entry)));
        return next;
      });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Failed to delete project.");
    }
  };

  const toggleVisibility = async (e, project) => {
    e.stopPropagation();
    if (requireHostedConnection()) return;
    try {
      const res = await api.patch(`/projects/${project.id}/visibility`);
      const updatedProject = res.data;
      setProjects((prev) => {
        const next = prev.map((entry) =>
          getProjectRouteId(entry) === getProjectRouteId(project) ? updatedProject : entry
        );
        writeCachedProjects(next.filter((entry) => !isOfflineCopyProject(entry)));
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  };

  const startRename = (project) => {
    if (!isOfflineCopyProject(project) && requireHostedConnection()) return;
    setRenamingProjectId(project.id);
    setRenamingName(project.name || "");
  };

  const cancelRename = () => {
    setRenamingProjectId(null);
    setRenamingName("");
  };

  const submitRename = async (e, project) => {
    e.preventDefault();
    if (!isOfflineCopyProject(project) && requireHostedConnection()) return;
    const nextName = renamingName.trim();
    if (!nextName || rowActionLoading) return;
    setRowActionLoading(true);
    try {
      const res = isOfflineCopyProject(project)
        ? await localApi.patch(`/projects/${project.id}`, { name: nextName })
        : await api.patch(`/projects/${project.id}`, {
            name: nextName,
            description: project.description || "",
            is_public: project.is_public,
          });
      const updatedProject = res.data;
      setProjects((prev) => {
        const next = prev.map((entry) =>
          isOfflineCopyProject(project)
            ? isOfflineCopyProject(entry) && entry.id === project.id
              ? updatedProject
              : entry
            : getProjectRouteId(entry) === getProjectRouteId(project)
              ? updatedProject
              : entry
        );
        writeCachedProjects(next.filter((entry) => !isOfflineCopyProject(entry)));
        return next;
      });
      cancelRename();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Failed to rename project.");
    } finally {
      setRowActionLoading(false);
    }
  };

  const duplicateProject = async (project) => {
    if (rowActionLoading || isOfflineCopyProject(project) || requireHostedConnection()) return;
    setRowActionLoading(true);
    try {
      const res = await api.post(`/projects/${project.id}/duplicate`);
      const duplicatedProject = res.data;
      setProjects((prev) => {
        const next = [duplicatedProject, ...prev];
        writeCachedProjects(next.filter((entry) => !isOfflineCopyProject(entry)));
        return next;
      });
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to duplicate project.");
    } finally {
      setRowActionLoading(false);
    }
  };

  const importProject = async (file) => {
    if (!file || importingProject || requireHostedConnection()) return;
    setImportingProject(true);
    setError("");
    const formData = new FormData();
    formData.append("archive", file);
    try {
      const res = await api.post("/projects/import", formData);
      const importedProject = res.data;
      setProjects((prev) => {
        const next = [importedProject, ...prev];
        writeCachedProjects(next.filter((entry) => !isOfflineCopyProject(entry)));
        return next;
      });
      navigate(toProjectPath(importedProject));
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to import project.");
    } finally {
      setImportingProject(false);
    }
  };

  const openProject = (project) => {
    if (isOfflineCopyProject(project)) {
      navigate(`/local/projects/${project.id}`);
      return;
    }
    const projectRouteId = getProjectRouteId(project);
    if (!projectRouteId) return;
    if (!hostedOnline) {
      navigate(`/cached/projects/${projectRouteId}`);
      return;
    }
    navigate(toProjectPath(project));
  };

  const stats = useMemo(
    () => ({
      total: projects.length,
      public: projects.filter((project) => project.is_public).length,
      private: projects.filter((project) => !project.is_public).length,
      pybricks: projects.filter((project) => project.project_type === PROJECT_TYPE_PYBRICKS).length,
    }),
    [projects]
  );

  return {
    projects,
    name,
    setName,
    pin,
    setPin,
    error,
    setError,
    notice,
    setNotice,
    creating,
    createProject,
    createProjectOfType,
    joinProject,
    deleteProject,
    toggleVisibility,
    openProject,
    renamingProjectId,
    renamingName,
    setRenamingName,
    startRename,
    cancelRename,
    submitRename,
    rowActionLoading,
    duplicateProject,
    isOfflineCopyProject,
    createTypeModalOpen,
    setCreateTypeModalOpen,
    importingProject,
    importProject,
    stats,
    navigate,
    PROJECT_TYPE_NORMAL,
    PROJECT_TYPE_PYBRICKS,
  };
}
