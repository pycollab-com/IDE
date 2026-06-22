import { FiRotateCcw, FiRotateCw, FiCrosshair, FiSquare } from "react-icons/fi";

// Inline drive controls for a single motor port. Uses non-blocking hub commands
// (run is continuous, run_angle rides wait=False) so telemetry keeps streaming.
export default function MotorControls({ port, onAction }) {
  const send = (verb, ...args) =>
    onAction(`motor ${port.port} ${[verb, ...args].join(" ")}`.trim());

  return (
    <div className="motor-controls">
      <button type="button" className="motor-btn" onClick={() => send("run", -300)} title="Run counter-clockwise">
        Run ◀
      </button>
      <button type="button" className="motor-btn" onClick={() => send("run", 300)} title="Run clockwise">
        Run ▶
      </button>
      <button type="button" className="motor-btn" onClick={() => send("angle", 400, -90)} title="Turn −90°">
        <FiRotateCcw size={12} />
      </button>
      <button type="button" className="motor-btn" onClick={() => send("angle", 400, 90)} title="Turn +90°">
        <FiRotateCw size={12} />
      </button>
      <button type="button" className="motor-btn" onClick={() => send("zero")} title="Reset angle to 0">
        <FiCrosshair size={12} />
      </button>
      <button type="button" className="motor-btn stop" onClick={() => send("stop")} title="Stop">
        <FiSquare size={12} />
      </button>
    </div>
  );
}
