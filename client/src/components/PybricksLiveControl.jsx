import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FiArrowDown,
  FiArrowLeft,
  FiArrowRight,
  FiArrowUp,
  FiChevronDown,
  FiChevronUp,
  FiMove,
  FiPlay,
  FiRefreshCw,
  FiSquare,
  FiX,
} from "react-icons/fi";
import { getHubPortNames } from "../runtime/pybricksHubMonitor";
import {
  DEFAULT_LIVE_CONTROL_CONFIG,
  LIVE_CONTROL_HOLD_HEARTBEAT_MS,
  getActiveLiveControlCommand,
  getDefaultLiveControlCode,
  getLiveControlCommandForKey,
  normalizeLiveControlConfig,
} from "../runtime/pybricksLiveControl";

const KEY_LABELS = [
  ["w", "W / ↑", "Forward"],
  ["a", "A / ←", "Turn left"],
  ["s", "S / ↓", "Backward"],
  ["d", "D / →", "Turn right"],
];
const CODE_LABELS = [...KEY_LABELS, ["stop", "STOP", "Key release / stop"]];

const DRIVE_KEYS = [
  { command: "w", label: "Forward", kbd: "W", Icon: FiArrowUp },
  { command: "a", label: "Left", kbd: "A", Icon: FiArrowLeft },
  { command: "s", label: "Back", kbd: "S", Icon: FiArrowDown },
  { command: "d", label: "Right", kbd: "D", Icon: FiArrowRight },
];
const COMMAND_META = {
  w: { label: "Forward", Icon: FiArrowUp },
  a: { label: "Left", Icon: FiArrowLeft },
  s: { label: "Back", Icon: FiArrowDown },
  d: { label: "Right", Icon: FiArrowRight },
  x: { label: "Idle", Icon: FiMove },
};

function loadConfig(storageKey) {
  if (typeof window === "undefined") return normalizeLiveControlConfig(DEFAULT_LIVE_CONTROL_CONFIG);
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    return normalizeLiveControlConfig(stored || DEFAULT_LIVE_CONTROL_CONFIG);
  } catch {
    return normalizeLiveControlConfig(DEFAULT_LIVE_CONTROL_CONFIG);
  }
}

export default function PybricksLiveControl({
  projectId,
  hubType,
  connected,
  running,
  active,
  onStart,
  onCommand,
  onStop,
}) {
  const storageKey = `pycollab:pybricks-live-control:${projectId || "draft"}`;
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [activeCommand, setActiveCommand] = useState("x");
  const [config, setConfig] = useState(() => loadConfig(storageKey));
  const pressedKeysRef = useRef(new Set());
  const activeCommandRef = useRef("x");
  const lastCommandRef = useRef("x");
  const stageRef = useRef(null);
  const ports = useMemo(() => getHubPortNames(hubType), [hubType]);

  useEffect(() => {
    setConfig(loadConfig(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (active || ports.length < 2) return;
    setConfig((current) => {
      if (ports.includes(current.leftPort) && ports.includes(current.rightPort)) return current;
      return normalizeLiveControlConfig({
        ...current,
        leftPort: ports[0],
        rightPort: ports[1],
      });
    });
  }, [active, ports]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(config));
  }, [config, storageKey]);

  const sendCommand = (command, force = false) => {
    if (!active || !command || (!force && lastCommandRef.current === command)) return;
    lastCommandRef.current = command;
    onCommand(command);
  };

  const setLiveCommand = (command) => {
    activeCommandRef.current = command;
    setActiveCommand(command);
    sendCommand(command);
  };

  const sendLatestPressedKey = () => {
    setLiveCommand(getActiveLiveControlCommand(pressedKeysRef.current));
  };

  useEffect(() => {
    if (!active) {
      pressedKeysRef.current.clear();
      activeCommandRef.current = "x";
      setActiveCommand("x");
      lastCommandRef.current = "x";
      return undefined;
    }

    // Pull focus onto the controller so WASD is captured immediately, without
    // needing a click — otherwise keys keep going to whatever was focused
    // before (e.g. the code editor) and get ignored by the input guard below.
    stageRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event) => {
      const key = String(event.key || "").toLowerCase();
      if (!getLiveControlCommandForKey(key) || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      pressedKeysRef.current.delete(key);
      pressedKeysRef.current.add(key);
      sendLatestPressedKey();
    };
    const handleKeyUp = (event) => {
      const key = String(event.key || "").toLowerCase();
      if (!getLiveControlCommandForKey(key)) return;
      event.preventDefault();
      pressedKeysRef.current.delete(key);
      sendLatestPressedKey();
    };
    const stopOnBlur = () => {
      pressedKeysRef.current.clear();
      setLiveCommand("x");
    };
    const heartbeatId = window.setInterval(() => {
      if (activeCommandRef.current !== "x") {
        sendCommand(activeCommandRef.current, true);
      }
    }, LIVE_CONTROL_HOLD_HEARTBEAT_MS);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", stopOnBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", stopOnBlur);
      window.clearInterval(heartbeatId);
      pressedKeysRef.current.clear();
      if (lastCommandRef.current !== "x") onCommand("x");
      activeCommandRef.current = "x";
      setActiveCommand("x");
      lastCommandRef.current = "x";
    };
  }, [active, onCommand]);

  const updateConfig = (patch) => {
    setConfig((current) => {
      if (patch.turnMode && patch.turnMode !== current.turnMode) {
        const oldDefaults = getDefaultLiveControlCode(current);
        const nextDefaults = getDefaultLiveControlCode({ ...current, ...patch });
        return normalizeLiveControlConfig({
          ...current,
          ...patch,
          customCode: {
            ...current.customCode,
            a: current.customCode.a === oldDefaults.a ? nextDefaults.a : current.customCode.a,
            d: current.customCode.d === oldDefaults.d ? nextDefaults.d : current.customCode.d,
          },
        });
      }
      return normalizeLiveControlConfig({ ...current, ...patch });
    });
  };

  const updateCustomCode = (key, value) => {
    setConfig((current) => ({
      ...current,
      customCode: { ...current.customCode, [key]: value },
    }));
  };

  const resetKeyCode = (key) => {
    const defaults = getDefaultLiveControlCode(config);
    updateCustomCode(key, defaults[key]);
  };

  const resetAllKeyCode = () => {
    setConfig((current) => ({
      ...current,
      codeVersion: 1,
      customCode: getDefaultLiveControlCode(current),
    }));
  };

  const start = async () => {
    setError("");
    setStarting(true);
    try {
      await onStart(normalizeLiveControlConfig(config));
    } catch (startError) {
      setError(startError?.message || "Live control failed to start.");
    } finally {
      setStarting(false);
    }
  };

  const pointerCommand = (command) => (event) => {
    event.preventDefault();
    if (event.currentTarget.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    lastCommandRef.current = "";
    setLiveCommand(command);
  };

  const pointerStop = (event) => {
    event.preventDefault();
    setLiveCommand("x");
  };

  const activeMeta = COMMAND_META[activeCommand] || COMMAND_META.x;
  const ActiveIcon = activeMeta.Icon;
  const stageState = active ? "live" : connected ? "ready" : "off";
  const stageStateLabel = active ? "Driving" : connected ? "Ready to drive" : "Hub offline";

  return (
    <>
      <button
        type="button"
        className={`btn pybricks-drive-btn ${active ? "active" : "btn-ghost"}`}
        onClick={() => setOpen(true)}
        title="Configure and drive the robot with WASD or arrow keys"
      >
        <FiMove size={14} />
        {active ? "Driving" : "Drive"}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="panel modal-card pybricks-drive-modal"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pybricks-drive-header">
                <div>
                  <div className="pybricks-drive-kicker">Live hub input</div>
                  <div className="panel-title">Drive your robot</div>
                  <div className="muted">Set up the drive motors, start the controller, then hold WASD or the arrow keys to move.</div>
                </div>
                <button className="icon-btn" type="button" onClick={() => setOpen(false)} title="Close live control">
                  <FiX />
                </button>
              </div>

              <div className="pybricks-drive-body">
                <section className="pybricks-drive-stage" data-state={stageState} ref={stageRef} tabIndex={-1}>
                  <div className="pybricks-drive-statusbar">
                    <span className="pybricks-drive-state">
                      <span className="pybricks-drive-dot" />
                      {stageStateLabel}
                    </span>
                    <span className="pybricks-drive-speed-tag">{config.speed}°/s</span>
                  </div>

                  <div className="pybricks-drive-pad" aria-label="Live movement controls">
                    {DRIVE_KEYS.map(({ command, label, kbd, Icon }) => (
                      <button
                        key={command}
                        type="button"
                        className={`pybricks-drive-key key-${command} ${activeCommand === command ? "pressed" : ""}`}
                        onPointerDown={pointerCommand(command)}
                        onPointerUp={pointerStop}
                        onPointerCancel={pointerStop}
                        disabled={!active}
                        aria-label={label}
                      >
                        <Icon className="pybricks-drive-key-arrow" />
                        <kbd>{kbd}</kbd>
                      </button>
                    ))}
                    <div className="pybricks-drive-readout" aria-live="polite">
                      <ActiveIcon className="pybricks-drive-readout-icon" />
                      <span>{activeMeta.label}</span>
                    </div>
                  </div>

                  {error && <div className="pybricks-drive-error">{error}</div>}

                  {active ? (
                    <button type="button" className="btn pybricks-drive-stop" onClick={onStop}>
                      <FiSquare size={14} /> Stop live control
                    </button>
                  ) : (
                    <button type="button" className="btn pybricks-drive-start" onClick={start} disabled={!connected || running || starting}>
                      <FiPlay size={14} fill="currentColor" />
                      {starting ? "Downloading controller…" : running ? "Stop the current program first" : "Start live control"}
                    </button>
                  )}

                  <p className="pybricks-drive-safety">
                    Driving runs locally on the connected hub. Held keys stream every {LIVE_CONTROL_HOLD_HEARTBEAT_MS} ms — release
                    stops the motors, and the board brakes itself if the input stream drops.
                  </p>
                </section>

                <section className="pybricks-drive-setup">
                  <div className="pybricks-drive-section-title">Motors</div>
                  <div className="pybricks-drive-motor-grid">
                    {[
                      ["left", "Left"],
                      ["right", "Right"],
                    ].map(([side, label]) => (
                      <div className="pybricks-drive-motor" key={side}>
                        <label>
                          <span>{label} motor port</span>
                          <select
                            value={config[`${side}Port`]}
                            onChange={(event) => updateConfig({ [`${side}Port`]: event.target.value })}
                            disabled={active}
                          >
                            {ports.map((port) => (
                              <option key={port} value={port} disabled={port === config[side === "left" ? "rightPort" : "leftPort"]}>
                                {port}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="pybricks-drive-check">
                          <input
                            type="checkbox"
                            checked={config[`${side}Reversed`]}
                            onChange={(event) => updateConfig({ [`${side}Reversed`]: event.target.checked })}
                            disabled={active}
                          />
                          Reverse direction
                        </label>
                      </div>
                    ))}
                  </div>

                  <div className="pybricks-drive-field">
                    <span className="pybricks-drive-field-label">
                      Speed <output>{config.speed}°/s</output>
                    </span>
                    <input
                      type="range"
                      min="50"
                      max="1500"
                      step="50"
                      value={config.speed}
                      onChange={(event) => updateConfig({ speed: event.target.value })}
                      disabled={active}
                    />
                  </div>

                  <div className="pybricks-drive-field">
                    <span className="pybricks-drive-field-label">Turning</span>
                    <div className="pybricks-drive-segmented" role="group" aria-label="Turning mode">
                      {[
                        ["spot", "Spot turn"],
                        ["arc", "Arc turn"],
                      ].map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          className={config.turnMode === mode ? "active" : ""}
                          onClick={() => updateConfig({ turnMode: mode })}
                          disabled={active}
                          aria-pressed={config.turnMode === mode}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              </div>

              <section className="pybricks-drive-keycode" data-open={advancedOpen}>
                <button
                  type="button"
                  className="pybricks-drive-keycode-toggle"
                  onClick={() => setAdvancedOpen((value) => !value)}
                  aria-expanded={advancedOpen}
                >
                  <span>
                    <strong>Key code</strong>
                    <small>
                      The Python downloaded to the board for each key. Names: <code>left_motor</code>, <code>right_motor</code>,{" "}
                      <code>speed</code>, <code>inner_speed</code>. Runs repeatedly while the key is held.
                    </small>
                  </span>
                  {advancedOpen ? <FiChevronUp /> : <FiChevronDown />}
                </button>

                {advancedOpen && (
                  <div className="pybricks-drive-keycode-body">
                    <div className="pybricks-drive-keycode-bar">
                      {active ? (
                        <span className="pybricks-drive-code-note">Stop live control to edit the downloaded code.</span>
                      ) : (
                        <span>Edit any handler, or reset to the generated defaults.</span>
                      )}
                      <button type="button" onClick={resetAllKeyCode} disabled={active}>
                        <FiRefreshCw size={12} /> Reset all
                      </button>
                    </div>
                    <div className="pybricks-drive-code-grid">
                      {CODE_LABELS.map(([key, shortcutLabel, label]) => (
                        <label key={key}>
                          <span className="pybricks-drive-code-label">
                            <span><kbd>{shortcutLabel}</kbd> {label}</span>
                            <button type="button" onClick={() => resetKeyCode(key)} disabled={active}>Reset</button>
                          </span>
                          <textarea
                            value={config.customCode[key]}
                            onChange={(event) => updateCustomCode(key, event.target.value)}
                            disabled={active}
                            spellCheck="false"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
