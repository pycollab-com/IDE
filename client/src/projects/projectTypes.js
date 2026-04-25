export const PROJECT_TYPE_NORMAL = "normal";
export const PROJECT_TYPE_PYBRICKS = "pybricks";
export const LOCAL_PROJECT_KIND_OFFLINE_COPY = "offline-copy";

export const isPybricksProject = (project) => project?.project_type === PROJECT_TYPE_PYBRICKS;
export const isOfflineCopyProject = (project) =>
  project?.local_project_kind === LOCAL_PROJECT_KIND_OFFLINE_COPY || project?.origin?.kind === "hosted-cache";
