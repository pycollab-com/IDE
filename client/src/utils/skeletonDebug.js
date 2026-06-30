const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export const skeletonDebugEnabled = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get("skeletons") || params.get("debugSkeletons");
  if (queryValue != null) return TRUE_VALUES.has(queryValue.toLowerCase());
  return TRUE_VALUES.has((localStorage.getItem("pycollab:show-skeletons") || "").toLowerCase());
};
