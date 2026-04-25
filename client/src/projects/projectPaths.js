export const getProjectRouteId = (project) => project?.public_id || String(project?.id || "");

export const toProjectPath = (project) => `/projects/${getProjectRouteId(project)}`;
