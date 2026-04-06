export const PROJECT_TYPE_NORMAL = "normal";
export const PROJECT_TYPE_PYBRICKS = "pybricks";

export const isPybricksProject = (project) => project?.project_type === PROJECT_TYPE_PYBRICKS;
