import { useEffect, useMemo, useState } from "react";
import { FiEdit2, FiCheck, FiX, FiZap, FiAlertCircle } from "react-icons/fi";
import { loadHubNickname, saveHubNickname } from "../runtime/pybricksReadings";
import HubReadings from "./hub/HubReadings";
import HubControls from "./hub/HubControls";
import HubDisplay from "./hub/HubDisplay";

// SPIKE Prime / Robot Inventor carry the 5×5 light matrix.
const MATRIX_HUBS = new Set(["Prime Hub", "Inventor Hub"]);

function batteryTone(percent) {
  if (!Number.isFinite(percent)) return "unknown";
  if (percent <= 15) return "critical";
  if (percent <= 35) return "low";
  return "ok";
}

export default function HubInfoPanel({ hub, isRemoteGuest, remoteHostName, onAction }) {
  const [nickname, setNickname] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [activeTab, setActiveTab] = useState("readings");

  const hubKey = hub?.deviceName || hub?.hubType || "";
  useEffect(() => {
    setNickname(loadHubNickname(hub));
    setEditingName(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubKey]);

  const tabs = useMemo(() => {
    const list = [{ id: "readings", label: "Readings" }];
    if (onAction) {
      list.push({ id: "controls", label: "Controls" });
      if (MATRIX_HUBS.has(hub?.hubType)) list.push({ id: "display", label: "Display" });
    }
    return list;
  }, [onAction, hub?.hubType]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) setActiveTab("readings");
  }, [tabs, activeTab]);

  const commitName = () => {
    const trimmed = draftName.trim();
    saveHubNickname(hub, trimmed);
    setNickname(trimmed);
    setEditingName(false);
  };

  const realName = hub?.deviceName || hub?.hubType || "Pybricks Hub";
  const displayName = nickname || realName;
  const percent = hub?.batteryPercent;
  const voltage = Number.isFinite(hub?.batteryVoltage) ? hub.batteryVoltage / 1000 : null;
  const warnings = Array.isArray(hub?.warnings) ? hub.warnings : [];
  const actionsLive = Boolean(hub?.telemetryAvailable);

  return (
    <div className="hub-panel">
      <div className="hub-panel-head">
        <div className="hub-panel-identity">
          {editingName ? (
            <div className="hub-panel-name-edit">
              <input
                autoFocus
                className="hub-panel-name-input"
                value={draftName}
                maxLength={40}
                placeholder={realName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitName();
                  if (event.key === "Escape") setEditingName(false);
                }}
              />
              <button type="button" className="hub-panel-name-btn" onClick={commitName} title="Save name">
                <FiCheck size={14} />
              </button>
              <button type="button" className="hub-panel-name-btn" onClick={() => setEditingName(false)} title="Cancel">
                <FiX size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="hub-panel-name"
              onClick={() => {
                setDraftName(nickname);
                setEditingName(true);
              }}
              title="Rename this hub (saved on this device)"
            >
              <span className="hub-panel-name-text">{displayName}</span>
              <FiEdit2 size={12} />
            </button>
          )}
          <div className="hub-panel-sub">
            {hub?.hubType || "Hub"}
            {nickname ? ` · ${realName}` : ""}
          </div>
        </div>
      </div>

      <div className="hub-panel-stats">
        <div className={`hub-panel-battery tone-${batteryTone(percent)}`}>
          <div className="hub-panel-battery-track">
            <div
              className="hub-panel-battery-fill"
              style={{ width: `${Number.isFinite(percent) ? Math.max(4, percent) : 0}%` }}
            />
          </div>
          <span className="hub-panel-battery-label">
            {Number.isFinite(percent) ? `${percent}%` : "—"}
            {voltage != null ? <em>{voltage.toFixed(2)} V</em> : null}
          </span>
        </div>
        <div className="hub-panel-chips">
          {hub?.firmwareVersion ? <span className="hub-chip">fw {hub.firmwareVersion}</span> : null}
          {hub?.transportLabel || hub?.transport ? (
            <span className="hub-chip">{hub.transportLabel || hub.transport}</span>
          ) : null}
          <span className={`hub-chip ${hub?.hubRunning ? "running" : "idle"}`}>
            <FiZap size={11} />
            {hub?.hubRunning ? "Running" : "Idle"}
          </span>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="hub-panel-warnings">
          {warnings.map((warning) => (
            <span className="hub-panel-warning" key={warning}>
              <FiAlertCircle size={11} /> {warning}
            </span>
          ))}
        </div>
      )}

      {tabs.length > 1 && (
        <div className="hub-panel-tabs">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={`hub-panel-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "readings" && <HubReadings hub={hub} onAction={actionsLive ? onAction : undefined} />}
      {activeTab !== "readings" && !actionsLive && (
        <div className="hub-panel-status">Controls resume when live readings are active (hub connected and idle).</div>
      )}
      {activeTab === "controls" && actionsLive && <HubControls hub={hub} onAction={onAction} />}
      {activeTab === "display" && actionsLive && <HubDisplay onAction={onAction} />}

      {isRemoteGuest && (
        <div className="hub-panel-remote">Live from {remoteHostName || "the hub host"}</div>
      )}
    </div>
  );
}
