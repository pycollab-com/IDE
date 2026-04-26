import { useEffect, useState } from "react";
import { FiDownload, FiRefreshCw } from "react-icons/fi";
import { checkAppUpdate, openAppUpdate } from "../utils/desktopBridge";

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

export default function DesktopWorkspacePanel({ desktopContext }) {
  const [updateState, setUpdateState] = useState({
    loading: false,
    checked: false,
    error: "",
    result: null,
  });

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

  const updateInfo = updateState.result;
  const updateAvailable = Boolean(updateInfo?.update_available);
  const releaseDate = formatReleaseDate(updateInfo?.published_at);
  const updateTargetUrl = updateInfo?.download_url || updateInfo?.release_url || "";
  const showUpdatePanel = Boolean(updateState.error || updateAvailable);

  if (!showUpdatePanel) {
    return null;
  }

  return (
    <section className="ide-dashboard-stack" aria-label="App update">
      <div className="ide-dashboard-panel ide-dashboard-panel-update glass-panel">
        <div className="ide-dashboard-panel-head">
          <div>
            <div className="panel-title">App update</div>
            <p className="ide-dashboard-panel-copy">
              Current version {desktopContext?.version || "dev"}
              {updateInfo?.latest_version ? ` · Latest release ${updateInfo.latest_version}` : ""}
              {releaseDate ? ` · Published ${releaseDate}` : ""}
            </p>
          </div>
          <div className="ide-dashboard-inline-actions">
            {updateAvailable ? <span className="chip chip-success">Update available</span> : null}
            <button className="btn-secondary" type="button" onClick={loadUpdate} disabled={updateState.loading}>
              <FiRefreshCw size={14} />
              {updateState.loading ? "Checking..." : "Check again"}
            </button>
            {updateState.checked ? (
              <button className="btn-secondary" type="button" onClick={() => openAppUpdate(updateTargetUrl)}>
                <FiDownload size={14} />
                {updateAvailable ? "Download update" : "View releases"}
              </button>
            ) : null}
          </div>
        </div>
        {updateState.error ? <p className="ide-dashboard-panel-copy ide-dashboard-error-copy">{updateState.error}</p> : null}
      </div>
    </section>
  );
}
