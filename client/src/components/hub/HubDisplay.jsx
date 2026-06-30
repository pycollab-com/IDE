import { useEffect, useRef, useState } from "react";
import { FiSend, FiX, FiPlay, FiSquare } from "react-icons/fi";
import {
  ICON_NAMES,
  iconBitmap,
  digitBitmap,
  cellsToDrawString,
  isBlankCells,
  scrollFrames,
} from "../../runtime/hubDisplayGlyphs";

const EMPTY_GRID = Array(25).fill(false);

// Scroll speed is a 1 (slow) – 10 (fast) dial mapped to a per-column delay in ms.
// The same delay drives the on-screen preview and rides along to the hub so the
// two stay in step. Persisted so the choice survives reopening the panel.
const SPEED_STORAGE_KEY = "pycollab.hubDisplay.scrollSpeed.v1";
const SPEED_MIN = 1;
const SPEED_MAX = 10;
const DEFAULT_SPEED = 7;
const speedToDelay = (speed) => 170 - speed * 15; // 10 -> 20ms, 1 -> 155ms

function loadSpeed() {
  try {
    const value = Number(globalThis.localStorage?.getItem(SPEED_STORAGE_KEY));
    return value >= SPEED_MIN && value <= SPEED_MAX ? value : DEFAULT_SPEED;
  } catch {
    return DEFAULT_SPEED;
  }
}

function saveSpeed(speed) {
  try {
    globalThis.localStorage?.setItem(SPEED_STORAGE_KEY, String(speed));
  } catch {
    // Persisting the preference is a convenience; ignore storage failures.
  }
}

export default function HubDisplay({ onAction }) {
  // The grid is a live preview of what will go to the hub — icons and numbers
  // load into it so you can see them before sending. Nothing reaches the hub
  // until you press Send (or Scroll), matching how the SPIKE app previews first.
  const [cells, setCells] = useState(EMPTY_GRID);
  const [digit, setDigit] = useState("");
  const [text, setText] = useState("");
  const [scrolling, setScrolling] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(loadSpeed);
  const scrollRef = useRef(null);
  // The hub keeps scrolling on its own (looping or a long single pass), so we
  // remember when a scroll is live and interrupt it with a one-byte sentinel.
  const hubScrollActiveRef = useRef(false);

  const changeSpeed = (value) => {
    setSpeed(value);
    saveSpeed(value);
  };

  const stopPreview = () => {
    if (scrollRef.current) clearInterval(scrollRef.current);
    scrollRef.current = null;
    setScrolling(false);
  };

  // Any byte breaks the hub-side scroll loop; an empty line is the cheapest one.
  const stopHubScroll = () => {
    if (hubScrollActiveRef.current) {
      onAction("");
      hubScrollActiveRef.current = false;
    }
  };

  // Stop both the local marquee and the hub before issuing a new command.
  const haltScroll = () => {
    stopPreview();
    stopHubScroll();
  };

  // Stop a running marquee (and the hub loop) when the panel/tab closes.
  useEffect(() => haltScroll, []);

  const previewIcon = (name) => {
    haltScroll();
    setDigit("");
    setCells(iconBitmap(name) || EMPTY_GRID);
  };

  const previewDigit = (value) => {
    const clean = value.replace(/[^0-9]/g, "").slice(0, 1);
    setDigit(clean);
    if (clean === "") return;
    haltScroll();
    setCells(digitBitmap(clean) || EMPTY_GRID);
  };

  const toggleCell = (index) => {
    haltScroll();
    setDigit("");
    setCells((prev) => {
      const next = prev.slice();
      next[index] = !next[index];
      return next;
    });
  };

  const sendToHub = () => {
    haltScroll();
    onAction(`display draw ${cellsToDrawString(cells)}`);
  };

  const clearFace = () => {
    haltScroll();
    setDigit("");
    setCells(EMPTY_GRID);
    onAction("display off");
  };

  const scrollText = () => {
    const value = text.trim();
    if (!value) return;
    const { frames, encoded } = scrollFrames(value);
    if (!frames.length) return;
    const delay = speedToDelay(speed);
    const looping = loop;

    haltScroll();
    onAction(`display scroll ${encoded} ${delay} ${looping ? 1 : 0}`);
    hubScrollActiveRef.current = true;
    setScrolling(true);
    let frame = 0;
    scrollRef.current = setInterval(() => {
      if (frame >= frames.length) {
        if (looping) {
          frame = 0;
        } else {
          // The hub ends its single pass on its own; just tidy the preview. Leave
          // hubScrollActiveRef set so the next command still sends the (harmless)
          // stop sentinel, in case the hub is a beat behind the preview.
          stopPreview();
          setCells(EMPTY_GRID);
          return;
        }
      }
      setCells(frames[frame]);
      frame += 1;
    }, delay);
  };

  const handleStop = () => {
    haltScroll();
    setCells(EMPTY_GRID);
  };

  return (
    <div className="hub-display">
      <div className="hub-display-studio">
        <div className="hub-display-grid">
          {cells.map((on, index) => (
            <button
              type="button"
              key={index}
              className={`hub-display-cell ${on ? "on" : ""}`}
              onClick={() => toggleCell(index)}
              aria-label={`Pixel ${index + 1}`}
            />
          ))}
        </div>
        <p className="hub-display-hint">Preview — tap to draw, or load an icon / number, then send.</p>
        <div className="hub-control-row">
          <button type="button" className="hub-action-btn primary" onClick={sendToHub} disabled={isBlankCells(cells)}>
            <FiSend size={12} /> Send to hub
          </button>
          <button type="button" className="hub-action-btn" onClick={clearFace}>
            <FiX size={12} /> Clear
          </button>
        </div>
      </div>

      <section className="hub-control-section">
        <span className="hub-control-title">Icons</span>
        <div className="hub-display-icons">
          {ICON_NAMES.map((icon) => (
            <button type="button" key={icon} className="hub-action-btn" onClick={() => previewIcon(icon)}>
              {icon.toLowerCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="hub-control-section">
        <span className="hub-control-title">Number</span>
        <div className="hub-control-row">
          <input
            type="text"
            inputMode="numeric"
            className="hub-display-number"
            maxLength={1}
            value={digit}
            placeholder="0–9"
            onChange={(event) => previewDigit(event.target.value)}
          />
          <span className="hub-display-hint">Loads into the preview. Multi-digit? Use scrolling text below.</span>
        </div>
      </section>

      <section className="hub-control-section">
        <span className="hub-control-title">Scrolling text</span>
        <div className="hub-control-row">
          <input
            type="text"
            className="hub-display-text"
            maxLength={24}
            value={text}
            placeholder="HELLO"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") scrollText();
            }}
          />
          <label className="hub-control-toggle">
            <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
            Loop
          </label>
          {scrolling ? (
            <button type="button" className="hub-action-btn" onClick={handleStop}>
              <FiSquare size={12} /> Stop
            </button>
          ) : (
            <button type="button" className="hub-action-btn primary" onClick={scrollText} disabled={!text.trim()}>
              <FiPlay size={12} /> Scroll
            </button>
          )}
        </div>
        <div className="hub-control-slider">
          <span className="hub-control-mini-label">Speed</span>
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            value={speed}
            onChange={(event) => changeSpeed(Number(event.target.value))}
            aria-label="Scroll speed"
          />
          <span className="hub-control-value">{speed === SPEED_MAX ? "Fast" : speed === SPEED_MIN ? "Slow" : speed}</span>
        </div>
        <p className="hub-display-hint">
          {loop ? "Loops until you press Stop — on the preview and the hub." : "Scrolls once across the matrix — preview and hub."}
        </p>
      </section>
    </div>
  );
}
