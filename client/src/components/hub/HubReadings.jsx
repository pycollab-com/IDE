import { useEffect, useMemo, useState } from "react";
import { FiSliders, FiSettings } from "react-icons/fi";
import {
  getKindMetrics,
  getPrimaryReading,
  getAvailableSecondary,
  getVisibleSecondary,
  isSecondaryEnabled,
  toggleSecondary,
  getPortSwatch,
  loadReadingPrefs,
  saveReadingPrefs,
} from "../../runtime/pybricksReadings";
import MotorControls from "./MotorControls";

const KIND_GROUP_LABELS = {
  motor: "Motors",
  color: "Color sensors",
  distance: "Distance sensors",
  force: "Force sensors",
  motion: "Motion (IMU)",
};

const prettyButton = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/(^|\s)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());

function PortCard({ port, prefs, onAction }) {
  const [open, setOpen] = useState(false);
  const empty = port.kind === "empty";
  const swatch = getPortSwatch(port);
  const secondary = getVisibleSecondary(port, prefs);
  const primaryMetric = getKindMetrics(port.kind).find((metric) => metric.primary);
  const isMotor = port.kind === "motor";

  return (
    <div className={`hub-port ${empty ? "empty" : ""}`}>
      <div className="hub-port-main">
        <span className="hub-port-letter">{port.port}</span>
        <div className="hub-port-body">
          <span className="hub-port-device">{port.device || "Empty"}</span>
          {secondary.length > 0 && (
            <div className="hub-port-chips">
              {secondary.map((metric) => (
                <span className="hub-port-chip" key={metric.key}>
                  <em>{metric.label}</em> {metric.value}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="hub-port-primary">
          {swatch && <span className="hub-port-swatch" style={{ background: swatch }} />}
          <span className="hub-port-primary-value">{getPrimaryReading(port)}</span>
          {primaryMetric && !empty ? <em>{primaryMetric.label}</em> : null}
        </span>
        {isMotor && onAction && (
          <button
            type="button"
            className={`hub-port-drive ${open ? "active" : ""}`}
            onClick={() => setOpen((value) => !value)}
            title="Drive this motor"
          >
            <FiSettings size={13} />
          </button>
        )}
      </div>
      {isMotor && onAction && open && <MotorControls port={port} onAction={onAction} />}
    </div>
  );
}

export default function HubReadings({ hub, onAction }) {
  const [prefs, setPrefs] = useState(loadReadingPrefs);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  useEffect(() => saveReadingPrefs(prefs), [prefs]);

  const telemetryAvailable = Boolean(hub?.telemetryAvailable);
  const ports = Array.isArray(hub?.ports) ? hub.ports : [];
  const motion = hub?.motion || null;
  const buttons = Array.isArray(hub?.buttons) ? hub.buttons : [];
  const motionPort = motion ? { kind: "motion", port: "IMU", device: "Motion (IMU)", ...motion } : null;

  // Everything reporting a secondary reading feeds the customize groups: the
  // motion pseudo-port plus every populated port.
  const readingItems = useMemo(() => {
    const items = motionPort ? [motionPort] : [];
    for (const port of ports) if (port?.kind && port.kind !== "empty") items.push(port);
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ports, motion]);

  const customizeGroups = useMemo(() => {
    const byKind = new Map();
    for (const item of readingItems) {
      const secondary = getAvailableSecondary(item);
      if (!secondary.length) continue;
      const metrics = byKind.get(item.kind) || new Map();
      for (const metric of secondary) metrics.set(metric.key, metric.label);
      byKind.set(item.kind, metrics);
    }
    return [...byKind.entries()].map(([kind, metrics]) => ({
      kind,
      metrics: [...metrics.entries()].map(([key, label]) => ({ key, label })),
    }));
  }, [readingItems]);

  if (!telemetryAvailable) {
    return (
      <div className={`hub-panel-status ${hub?.telemetryError ? "error" : ""}`}>
        {hub?.telemetryError
          ? hub.telemetryError
          : hub?.hubRunning
            ? "Live readings resume when the program stops."
            : "Reading connected ports…"}
      </div>
    );
  }

  return (
    <div className="hub-readings">
      {customizeGroups.length > 0 && (
        <div className="hub-readings-bar">
          <button
            type="button"
            className={`hub-customize-btn ${customizeOpen ? "active" : ""}`}
            onClick={() => setCustomizeOpen((open) => !open)}
          >
            <FiSliders size={13} /> Customize readings
          </button>
        </div>
      )}

      {customizeOpen && customizeGroups.length > 0 && (
        <div className="hub-panel-customize">
          <label className="hub-customize-everything">
            <input
              type="checkbox"
              checked={Boolean(prefs.showEverything)}
              onChange={(event) => setPrefs((prev) => ({ ...prev, showEverything: event.target.checked }))}
            />
            Show everything
          </label>
          {customizeGroups.map((group) => (
            <div className="hub-customize-group" key={group.kind}>
              <span className="hub-customize-group-title">{KIND_GROUP_LABELS[group.kind] || group.kind}</span>
              <div className="hub-customize-options">
                {group.metrics.map((metric) => (
                  <label className="hub-customize-option" key={metric.key}>
                    <input
                      type="checkbox"
                      checked={isSecondaryEnabled(prefs, group.kind, metric.key)}
                      disabled={prefs.showEverything}
                      onChange={() => setPrefs((prev) => toggleSecondary(prev, group.kind, metric.key))}
                    />
                    {metric.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(motionPort || buttons.length > 0) && (
        <div className="hub-sensors-card">
          {motionPort && (
            <>
              <div className="hub-sensors-head">
                <span className="hub-sensors-title">
                  Motion · <strong>{getPrimaryReading(motionPort)}</strong> up
                </span>
                {onAction && (
                  <button type="button" className="hub-mini-btn" onClick={() => onAction("heading reset")}>
                    Reset heading
                  </button>
                )}
              </div>
              <div className="hub-sensors-metrics">
                {getVisibleSecondary(motionPort, prefs).map((metric) => (
                  <span className="hub-sensors-metric" key={metric.key}>
                    <em>{metric.label}</em> {metric.value}
                  </span>
                ))}
              </div>
            </>
          )}
          {buttons.length > 0 && (
            <div className="hub-buttons-row">
              <span className="hub-sensors-label">Pressed</span>
              {buttons.map((button) => (
                <span className="hub-button-chip" key={button}>
                  {prettyButton(button)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="hub-panel-ports">
        {ports.map((port) => (
          <PortCard key={port.port} port={port} prefs={prefs} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}
