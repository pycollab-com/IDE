import { useState } from "react";
import { FiX, FiVolume2, FiPower } from "react-icons/fi";

const LIGHT_COLORS = [
  { name: "red", css: "#e3000b" },
  { name: "orange", css: "#f07d00" },
  { name: "yellow", css: "#ffd500" },
  { name: "green", css: "#00a651" },
  { name: "cyan", css: "#00b3b3" },
  { name: "blue", css: "#0066b3" },
  { name: "magenta", css: "#cc0066" },
  { name: "white", css: "#f5f5f5" },
];

const TUNES = ["up", "down", "tada"];

// SPIKE Prime / Robot Inventor are the hubs with a speaker.
const SPEAKER_HUBS = new Set(["Prime Hub", "Inventor Hub"]);

export default function HubControls({ hub, onAction }) {
  const [blink, setBlink] = useState(false);
  const [hue, setHue] = useState(180);
  const [volume, setVolume] = useState(70);
  const [frequency, setFrequency] = useState(500);
  const [confirmShutdown, setConfirmShutdown] = useState(false);

  const hasSpeaker = SPEAKER_HUBS.has(hub?.hubType);

  const pickColor = (name) => onAction(blink ? `light blink ${name}` : `light ${name}`);

  const handleShutdown = () => {
    if (confirmShutdown) {
      onAction("shutdown");
      setConfirmShutdown(false);
      return;
    }
    setConfirmShutdown(true);
    setTimeout(() => setConfirmShutdown(false), 3000);
  };

  return (
    <div className="hub-controls">
      <section className="hub-control-section">
        <div className="hub-control-head">
          <span className="hub-control-title">Status light</span>
          <label className="hub-control-toggle">
            <input type="checkbox" checked={blink} onChange={(event) => setBlink(event.target.checked)} />
            Blink
          </label>
        </div>
        <div className="hub-light-dots">
          {LIGHT_COLORS.map((color) => (
            <button
              type="button"
              key={color.name}
              className="hub-light-dot"
              style={{ background: color.css }}
              title={`${blink ? "Blink" : "Light"} ${color.name}`}
              onClick={() => pickColor(color.name)}
            />
          ))}
          <button type="button" className="hub-light-dot off" title="Light off" onClick={() => onAction("light off")}>
            <FiX size={11} />
          </button>
        </div>
        <div className="hub-control-slider">
          <span
            className="hub-light-preview"
            style={{ background: `hsl(${hue}, 90%, 50%)` }}
            title="Custom color preview"
          />
          <input
            type="range"
            min="0"
            max="359"
            value={hue}
            onChange={(event) => setHue(Number(event.target.value))}
            onPointerUp={() => onAction(`light hsv ${hue} 100 100`)}
            onKeyUp={() => onAction(`light hsv ${hue} 100 100`)}
          />
          <span className="hub-control-value">{hue}°</span>
        </div>
      </section>

      {hasSpeaker && (
        <section className="hub-control-section">
          <span className="hub-control-title">Sound</span>
          <div className="hub-control-slider">
            <FiVolume2 size={13} />
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              onPointerUp={() => onAction(`volume ${volume}`)}
              onKeyUp={() => onAction(`volume ${volume}`)}
            />
            <span className="hub-control-value">{volume}%</span>
          </div>
          <div className="hub-control-slider">
            <span className="hub-control-mini-label">Hz</span>
            <input
              type="range"
              min="100"
              max="2000"
              step="20"
              value={frequency}
              onChange={(event) => setFrequency(Number(event.target.value))}
            />
            <span className="hub-control-value">{frequency}</span>
          </div>
          <div className="hub-control-row">
            <button type="button" className="hub-action-btn" onClick={() => onAction(`beep ${frequency} 250`)}>
              Beep
            </button>
            {TUNES.map((tune) => (
              <button type="button" key={tune} className="hub-action-btn" onClick={() => onAction(`tune ${tune}`)}>
                ♪ {tune}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="hub-control-section">
        <span className="hub-control-title">System</span>
        <button
          type="button"
          className={`hub-action-btn danger ${confirmShutdown ? "confirm" : ""}`}
          onClick={handleShutdown}
        >
          <FiPower size={12} /> {confirmShutdown ? "Tap to confirm shutdown" : "Shut down hub"}
        </button>
      </section>
    </div>
  );
}
