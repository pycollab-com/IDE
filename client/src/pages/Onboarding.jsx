import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  FiArrowRight,
  FiArrowLeft,
  FiUsers,
  FiPlay,
  FiZap,
  FiHome,
  FiLink,
  FiSearch,
  FiSettings,
  FiMoon,
  FiSun,
  FiCheck,
} from "react-icons/fi";
import api from "../api";
import { toProjectPath } from "../projects/projectPaths";
import { PROJECT_TYPE_NORMAL } from "../projects/projectTypes";

const EASE = [0.16, 1, 0.3, 1];

/* ------------------------------------------------------------------ */
/* Typewriter — drives the welcome + terminal "live typing" feel       */
/* ------------------------------------------------------------------ */
function useTypewriter(lines, { charDelay = 42, lineDelay = 520, loopDelay = 2400, reduced } = {}) {
  const [state, setState] = useState({ li: 0, ci: 0, done: [] });

  useEffect(() => {
    if (reduced) return undefined;
    const { li, ci, done } = state;
    if (li >= lines.length) {
      const t = setTimeout(() => setState({ li: 0, ci: 0, done: [] }), loopDelay);
      return () => clearTimeout(t);
    }
    const full = lines[li];
    if (ci < full.length) {
      const t = setTimeout(() => setState((s) => ({ ...s, ci: s.ci + 1 })), charDelay);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setState({ li: li + 1, ci: 0, done: [...done, full] }), lineDelay);
    return () => clearTimeout(t);
  }, [state, lines, charDelay, lineDelay, loopDelay, reduced]);

  if (reduced) return { done: lines, current: "", typing: false };
  const current = state.li < lines.length ? lines[state.li].slice(0, state.ci) : "";
  return { done: state.done, current, typing: state.li < lines.length };
}

/* ------------------------------------------------------------------ */
/* Animated demos                                                      */
/* ------------------------------------------------------------------ */
const WELCOME_LINES = ["from pycollab import Project", "team = Project.share()   # 6-char code", "team.run()               # 🚀 live, together"];

function WelcomeVisual({ reduced }) {
  const { done, current, typing } = useTypewriter(WELCOME_LINES, { reduced });
  return (
    <div className="ob-demo ob-welcome" aria-hidden="true">
      <div className="ob-win-bar">
        <span className="ob-dots"><i /><i /><i /></span>
        <span className="ob-win-name">workspace.py</span>
        <span className="ob-live"><span className="ob-live-dot" /> live</span>
      </div>
      <div className="ob-welcome-body">
        {done.map((line, i) => (
          <div key={i} className="ob-welcome-line"><span className="ob-prompt">›</span> {line}</div>
        ))}
        {typing && (
          <div className="ob-welcome-line">
            <span className="ob-prompt">›</span> {current}
            <span className="ob-type-caret" />
          </div>
        )}
      </div>
      <motion.div
        className="ob-welcome-glow"
        animate={reduced ? {} : { opacity: [0.35, 0.75, 0.35] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const TARGET_CODE = "k7m3qp";

function ShareCode({ reduced }) {
  const [code, setCode] = useState(reduced ? TARGET_CODE : "······");
  const [locked, setLocked] = useState(reduced);

  useEffect(() => {
    if (reduced) return undefined;
    let frame = 0;
    const total = 26;
    const id = setInterval(() => {
      frame += 1;
      if (frame >= total) {
        setCode(TARGET_CODE);
        setLocked(true);
        clearInterval(id);
        return;
      }
      const settled = Math.floor((frame / total) * TARGET_CODE.length);
      setCode(TARGET_CODE.split("").map((ch, i) => (i < settled ? ch : CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)])).join(""));
    }, 70);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <div className={`ob-share ${locked ? "locked" : ""}`}>
      <FiLink size={15} />
      <span className="ob-share-label">Share code</span>
      <span className="ob-share-code">{code}</span>
      <AnimatePresence>
        {locked && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ob-share-check">
            <FiCheck size={15} />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function CollabDemo({ reduced }) {
  return (
    <div className="ob-demo ob-collab" aria-hidden="true">
      <div className="ob-win-bar">
        <span className="ob-dots"><i /><i /><i /></span>
        <span className="ob-win-name">main.py</span>
        <span className="ob-presence">
          <span className="ob-ava a">Y</span>
          <span className="ob-ava b">M</span>
          <span className="ob-presence-label">2 online</span>
        </span>
      </div>
      <div className="ob-code">
        <div className="ob-line"><span className="kw">def</span> greet(name):</div>
        <div className="ob-line">
          {"    "}<span className="kw">return</span> <span className="str">f"Hi {"{name}"}!"</span>
          <motion.span
            className="ob-caret a"
            animate={reduced ? {} : { opacity: [0, 1, 1, 0], y: [0, 0, 0, 0], x: [0, 8, 4, 0] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <span>You</span>
          </motion.span>
        </div>
        <div className="ob-line"><span className="cmt"># edits sync instantly</span></div>
        <div className="ob-line">
          greet(<span className="str">"team"</span>)
          <motion.span
            className="ob-caret b"
            animate={reduced ? {} : { opacity: [0, 0, 1, 1, 0], x: [0, 0, -14, 6, 6] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <span>Maya</span>
          </motion.span>
        </div>
      </div>
      <ShareCode reduced={reduced} />
    </div>
  );
}

const TERMINAL_LINES = ["$ python main.py", "What's your name? Ada", "Hi Ada! Welcome to PyCollab 🎉"];
const lineClass = (t) => (t.startsWith("$") ? "prompt" : t.startsWith("Hi ") ? "ok" : "out");

function TerminalDemo({ reduced }) {
  const { done, current, typing } = useTypewriter(TERMINAL_LINES, { charDelay: 38, lineDelay: 620, loopDelay: 2600, reduced });
  return (
    <div className="ob-demo ob-terminal" aria-hidden="true">
      <div className="ob-win-bar">
        <span className="ob-dots"><i /><i /><i /></span>
        <span className="ob-win-name">output</span>
        <span className="ob-live"><span className="ob-live-dot" /> running</span>
      </div>
      <div className="ob-term-body">
        {done.map((t, i) => (
          <div key={i} className={`ob-term-line ${lineClass(t)}`}>{t}</div>
        ))}
        {typing && (
          <div className={`ob-term-line ${lineClass(current || "$")}`}>
            {current}
            <span className="ob-type-caret" />
          </div>
        )}
      </div>
    </div>
  );
}

function HubDemo({ reduced }) {
  const [pct, setPct] = useState(reduced ? 100 : 0);
  useEffect(() => {
    if (reduced) return undefined;
    const id = setInterval(() => setPct((p) => (p >= 100 ? 0 : Math.min(100, p + 4))), 90);
    return () => clearInterval(id);
  }, [reduced]);
  const flashing = pct >= 100;

  return (
    <div className="ob-demo ob-hub-stage" aria-hidden="true">
      <div className="ob-hub-rings">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="ob-ring"
            animate={reduced ? {} : { scale: [0.6, 1.7], opacity: [0.5, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
          />
        ))}
      </div>
      <motion.div
        className="ob-hub"
        animate={reduced ? {} : { y: [0, -10, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      >
        <FiZap size={34} />
        <span className={`ob-hub-led ${flashing ? "done" : ""}`} />
      </motion.div>
      <div className="ob-hub-download">
        <div className="ob-hub-track"><span className="ob-hub-fill" style={{ width: `${pct}%` }} /></div>
        <span className="ob-hub-status">{flashing ? "Downloaded ✓" : `Downloading to hub… ${pct}%`}</span>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: <FiHome size={16} />, title: "Dashboard", text: "Create & open projects" },
  { icon: <FiLink size={16} />, title: "Share code", text: "Invite with 6 characters" },
  { icon: <FiSearch size={16} />, title: "Explore", text: "See what others build" },
  { icon: <FiSettings size={16} />, title: "Settings", text: "Make it yours" },
];

function FinishVisual() {
  return (
    <div className="ob-demo ob-finish" aria-hidden="true">
      {FEATURES.map((f, i) => (
        <motion.div
          key={f.title}
          className="ob-feature"
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.15 + i * 0.1, ease: EASE }}
        >
          <span className="ob-feature-icon">{f.icon}</span>
          <span className="ob-feature-title">{f.title}</span>
          <span className="ob-feature-text">{f.text}</span>
        </motion.div>
      ))}
    </div>
  );
}

function Aurora({ reduced }) {
  return (
    <div className="ob-aurora" aria-hidden="true">
      <span className="ob-orb a" />
      <span className="ob-orb b" />
      <span className="ob-orb c" />
      <span className="ob-grid" />
      {!reduced &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <motion.span
            key={i}
            className="ob-particle"
            style={{ left: `${8 + i * 16}%`, top: `${20 + (i % 3) * 24}%` }}
            animate={{ y: [0, -26, 0], opacity: [0, 0.7, 0] }}
            transition={{ duration: 6 + i, repeat: Infinity, delay: i * 0.9, ease: "easeInOut" }}
          />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Animation variants                                                  */
/* ------------------------------------------------------------------ */
const slide = {
  enter: (dir) => ({ opacity: 0, x: dir > 0 ? 70 : -70 }),
  center: { opacity: 1, x: 0 },
  exit: (dir) => ({ opacity: 0, x: dir > 0 ? -70 : 70 }),
};
const copyStagger = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } } };
const copyItem = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { ease: EASE, duration: 0.55 } } };

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function Onboarding({ user, theme, toggleTheme }) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [[step, dir], setStep] = useState([0, 0]);
  const [busy, setBusy] = useState(false);

  const firstName = useMemo(() => {
    const name = (user?.display_name || "").trim().split(/\s+/)[0];
    return name || user?.username || "there";
  }, [user]);

  const steps = [
    {
      title: <>Hi {firstName} <span className="ob-wave">👋</span></>,
      sub: "Welcome to PyCollab, a live collaborative Python workspace in your browser.",
      visual: <WelcomeVisual reduced={reduced} />,
    },
    {
      title: "Teamwork makes the dreamwork",
      sub: "Code togther, just by sharing a 6 character code.",
      visual: <CollabDemo reduced={reduced} />,
    },
    {
      title: "Run Python, directly from your browser",
      sub: "Your code runs securely directly in your browser with Pyodide, with every module you'll ever need.",
      visual: <TerminalDemo reduced={reduced} />,
    },
    {
      title: "Robots are welcome",
      sub: "Building with LEGO? Spin up a PyBricks project to compile your Python and beam it straight to the hub.",
      visual: <HubDemo reduced={reduced} />,
    },
    {
      kicker: "That's it",
      title: <>You're ready, {firstName}</>,
      sub: "You're now part of the next generation of coding Python.",
      visual: <FinishVisual />,
    },
  ];

  const TOTAL = steps.length;
  const isLast = step === TOTAL - 1;
  const s = steps[step];

  const go = (target) => setStep([Math.max(0, Math.min(TOTAL - 1, target)), target > step ? 1 : -1]);

  const finish = async () => {
    localStorage.removeItem("pycollab:onboardingPending");
    const token = localStorage.getItem("token");
    if (token && !busy) {
      setBusy(true);
      try {
        const res = await api.post("/projects", { name: "My first project", project_type: PROJECT_TYPE_NORMAL });
        navigate(toProjectPath(res.data));
        return;
      } catch {
        // fall through to the dashboard if it couldn't be created
      } finally {
        setBusy(false);
      }
    }
    navigate(token ? "/" : "/welcome");
  };

  const skip = () => {
    localStorage.removeItem("pycollab:onboardingPending");
    navigate(localStorage.getItem("token") ? "/" : "/welcome");
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") skip();
      if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        isLast ? finish() : go(step + 1);
      }
      if (e.key === "ArrowLeft") go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isLast, busy]);

  return (
    <div className="ob">
      <Aurora reduced={reduced} />

      <header className="ob-top">
        <div className="ob-logo">PyCollab</div>
        <div className="ob-top-right">
          <button className="ob-icon-btn" onClick={toggleTheme} aria-label="Toggle theme" type="button">
            {theme === "dark" ? <FiMoon size={16} /> : <FiSun size={16} />}
          </button>
          <button className="ob-skip" onClick={skip} type="button">Skip tour</button>
        </div>
      </header>

      <div className="ob-progress" aria-hidden="true">
        <motion.div className="ob-progress-fill" animate={{ width: `${(step / (TOTAL - 1)) * 100}%` }} transition={{ duration: 0.5, ease: EASE }}>
          <span className="ob-progress-sheen" />
        </motion.div>
      </div>

      <main className="ob-stage">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.section
            key={step}
            className="ob-panel"
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: EASE }}
          >
            <motion.div className="ob-copy" variants={copyStagger} initial="hidden" animate="show">
              {s.kicker && <motion.span className="ob-kicker" variants={copyItem}>{s.kicker}</motion.span>}
              <motion.h1 className="ob-title" variants={copyItem}>{s.title}</motion.h1>
              <motion.p className="ob-sub" variants={copyItem}>{s.sub}</motion.p>
            </motion.div>

            <motion.div
              className="ob-visual"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.6, ease: EASE }}
            >
              {s.visual}
            </motion.div>
          </motion.section>
        </AnimatePresence>
      </main>

      <footer className="ob-foot">
        <button
          className="ob-btn-ghost"
          type="button"
          onClick={() => go(step - 1)}
          disabled={step === 0}
          style={{ visibility: step === 0 ? "hidden" : "visible" }}
        >
          <FiArrowLeft size={15} /> Back
        </button>

        <div className="ob-dots">
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`ob-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
              onClick={() => go(i)}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        <motion.button
          className="ob-btn-primary"
          type="button"
          onClick={() => (isLast ? finish() : go(step + 1))}
          disabled={busy}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
        >
          {isLast
            ? busy ? "Setting up…" : <>Create my first project <FiArrowRight size={16} /></>
            : <>{step === 0 ? "Take the tour" : step === TOTAL - 2 ? "Almost done" : "Next"} <FiArrowRight size={15} /></>}
        </motion.button>
      </footer>

      <OnboardingStyles />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */
function OnboardingStyles() {
  return (
    <style>{`
      .ob {
        position: fixed; inset: 0; z-index: 50;
        display: grid; grid-template-rows: auto auto 1fr auto;
        background: radial-gradient(120% 120% at 80% -10%, #313c28 0%, #20271a 45%, #15140f 100%);
        color: #f7f7f2; overflow: hidden;
      }
      [data-theme="light"] .ob { background: radial-gradient(120% 120% at 80% -10%, #4a5838 0%, #2f3a26 45%, #1c1d16 100%); }

      /* aurora */
      .ob-aurora { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
      .ob-orb { position: absolute; border-radius: 50%; filter: blur(60px); opacity: 0.55; }
      .ob-orb.a { width: 520px; height: 520px; top: -160px; right: -120px; background: radial-gradient(circle, rgba(156,170,136,0.55), transparent 65%); animation: ob-float-a 16s ease-in-out infinite; }
      .ob-orb.b { width: 420px; height: 420px; bottom: -140px; left: -100px; background: radial-gradient(circle, rgba(127,142,109,0.5), transparent 65%); animation: ob-float-b 19s ease-in-out infinite; }
      .ob-orb.c { width: 360px; height: 360px; top: 40%; left: 55%; background: radial-gradient(circle, rgba(47,143,255,0.22), transparent 65%); animation: ob-float-c 22s ease-in-out infinite; }
      .ob-grid { position: absolute; inset: 0; opacity: 0.4;
        background-image: linear-gradient(rgba(247,247,242,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(247,247,242,0.04) 1px, transparent 1px);
        background-size: 46px 46px; mask-image: radial-gradient(circle at 50% 40%, #000 30%, transparent 80%); }
      .ob-particle { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: rgba(156,170,136,0.8); box-shadow: 0 0 10px rgba(156,170,136,0.7); }
      @keyframes ob-float-a { 50% { transform: translate(-40px, 40px); } }
      @keyframes ob-float-b { 50% { transform: translate(40px, -30px); } }
      @keyframes ob-float-c { 50% { transform: translate(-30px, -40px); } }

      /* top bar */
      .ob-top { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 22px 32px; }
      .ob-logo { font-weight: 800; letter-spacing: -0.045em; font-size: 1.25rem; }
      .ob-top-right { display: flex; align-items: center; gap: 12px; }
      .ob-icon-btn { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px;
        border: 1px solid rgba(247,247,242,0.16); background: rgba(247,247,242,0.06); color: #f7f7f2; cursor: pointer; transition: background 0.18s ease; }
      .ob-icon-btn:hover { background: rgba(247,247,242,0.14); }
      .ob-skip { background: none; border: none; color: rgba(247,247,242,0.6); font-size: 0.88rem; cursor: pointer; padding: 8px 10px; border-radius: 8px; transition: color 0.18s ease; }
      .ob-skip:hover { color: #f7f7f2; }

      /* progress */
      .ob-progress { position: relative; z-index: 2; height: 3px; margin: 0 32px; background: rgba(247,247,242,0.1); border-radius: 999px; overflow: hidden; }
      .ob-progress-fill { position: relative; height: 100%; border-radius: 999px; overflow: hidden;
        background: linear-gradient(90deg, #9caa88, #899878, #7f8e6d); box-shadow: 0 0 16px rgba(156,170,136,0.6); }
      .ob-progress-sheen { position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent);
        transform: translateX(-100%); animation: ob-sheen 2.4s ease-in-out infinite; }
      @keyframes ob-sheen { 60%, 100% { transform: translateX(160%); } }

      /* stage */
      .ob-stage { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; padding: 24px 32px; overflow: hidden; }
      .ob-panel { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 56px; width: 100%; max-width: 1040px; }
      .ob-copy { display: flex; flex-direction: column; gap: 16px; }
      .ob-kicker { display: inline-flex; width: fit-content; align-items: center; padding: 5px 13px; border-radius: 999px;
        font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; font-family: ui-monospace, monospace; font-weight: 600;
        background: rgba(156,170,136,0.18); color: #c4d4a8; border: 1px solid rgba(156,170,136,0.34); }
      .ob-title { margin: 0; font-size: clamp(2rem, 4.4vw, 3.1rem); font-weight: 800; letter-spacing: -0.045em; line-height: 1.04; }
      .ob-wave { display: inline-block; animation: ob-wave 2.4s ease-in-out infinite; transform-origin: 70% 70%; }
      @keyframes ob-wave { 0%,60%,100% { transform: rotate(0); } 15% { transform: rotate(16deg); } 30% { transform: rotate(-8deg); } 45% { transform: rotate(12deg); } }
      .ob-sub { margin: 0; max-width: 46ch; font-size: 1.04rem; line-height: 1.6; color: rgba(247,247,242,0.66); }

      /* buttons */
      .ob-btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 22px; border-radius: 12px;
        border: none; cursor: pointer; font-weight: 700; font-size: 0.96rem; color: #fff;
        background: linear-gradient(135deg, #9caa88, #899878, #7f8e6d); box-shadow: 0 6px 26px rgba(137,152,120,0.5); transition: box-shadow 0.2s ease; }
      .ob-btn-primary:hover { box-shadow: 0 8px 34px rgba(137,152,120,0.7); }
      .ob-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }
      .ob-btn-ghost { display: inline-flex; align-items: center; gap: 6px; padding: 11px 16px; border-radius: 12px; cursor: pointer;
        border: 1px solid rgba(247,247,242,0.16); background: rgba(247,247,242,0.05); color: rgba(247,247,242,0.8); font-weight: 600; font-size: 0.92rem;
        transition: background 0.18s ease, color 0.18s ease; }
      .ob-btn-ghost:hover { background: rgba(247,247,242,0.12); color: #f7f7f2; }
      .ob-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

      /* footer */
      .ob-foot { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 20px 32px 30px; gap: 16px; }
      .ob-dots { display: flex; align-items: center; gap: 8px; }
      .ob-dot { width: 8px; height: 8px; border-radius: 999px; padding: 0; border: none; cursor: pointer; background: rgba(247,247,242,0.22); transition: all 0.22s ease; }
      .ob-dot.done { background: rgba(156,170,136,0.7); }
      .ob-dot.active { width: 26px; background: #9caa88; box-shadow: 0 0 12px rgba(156,170,136,0.6); }

      /* demo windows */
      .ob-visual { display: flex; align-items: center; justify-content: center; }
      .ob-demo { position: relative; width: 100%; max-width: 430px; border-radius: 18px; overflow: hidden;
        border: 1px solid rgba(247,247,242,0.13); background: rgba(10,12,8,0.55);
        box-shadow: 0 30px 70px rgba(0,0,0,0.45), 0 0 0 1px rgba(156,170,136,0.08);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .ob-win-bar { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 1px solid rgba(247,247,242,0.08); background: rgba(0,0,0,0.25); }
      .ob-win-bar .ob-dots { display: flex; gap: 6px; }
      .ob-win-bar .ob-dots i { width: 9px; height: 9px; border-radius: 50%; background: rgba(247,247,242,0.18); }
      .ob-win-name { flex: 1; text-align: center; font-size: 0.74rem; color: rgba(247,247,242,0.4); }
      .ob-live { display: inline-flex; align-items: center; gap: 6px; font-size: 0.68rem; color: rgba(156,170,136,0.9); }
      .ob-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #9caa88; box-shadow: 0 0 8px #9caa88; animation: ob-pulse 1.6s ease-in-out infinite; }
      @keyframes ob-pulse { 50% { opacity: 0.35; } }
      .ob-type-caret { display: inline-block; width: 8px; height: 1em; margin-left: 2px; vertical-align: -2px; background: #9caa88; animation: ob-blink 1s steps(1) infinite; }
      @keyframes ob-blink { 50% { opacity: 0; } }

      /* presence avatars */
      .ob-presence { display: inline-flex; align-items: center; gap: 0; }
      .ob-ava { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
        font-size: 0.62rem; font-weight: 800; color: #15140f; border: 2px solid rgba(10,12,8,0.9); }
      .ob-ava.a { background: #9caa88; }
      .ob-ava.b { background: #7f8e6d; color: #f7f7f2; margin-left: -7px; }
      .ob-presence-label { margin-left: 8px; font-size: 0.66rem; color: rgba(156,170,136,0.9); }

      /* code */
      .ob-code { padding: 18px 18px 14px; display: flex; flex-direction: column; gap: 6px; }
      .ob-line { position: relative; font-size: 0.86rem; line-height: 1.7; color: rgba(247,247,242,0.82); white-space: pre; }
      .ob-line .kw { color: #c4d4a8; font-weight: 600; }
      .ob-line .str { color: #a7c0e8; }
      .ob-line .cmt { color: rgba(247,247,242,0.4); font-style: italic; }
      .ob-caret { position: absolute; display: inline-flex; align-items: center; height: 1.2em; border-left: 2px solid; padding-left: 1px; }
      .ob-caret span { position: absolute; bottom: 100%; left: -2px; margin-bottom: 3px; padding: 1px 6px; border-radius: 5px; font-size: 0.58rem; font-weight: 700; color: #15140f; white-space: nowrap; }
      .ob-caret.a { border-color: #9caa88; } .ob-caret.a span { background: #9caa88; }
      .ob-caret.b { border-color: #7f8e6d; } .ob-caret.b span { background: #7f8e6d; color: #f7f7f2; }

      /* share code */
      .ob-share { display: flex; align-items: center; gap: 10px; margin: 0 14px 16px; padding: 10px 14px; border-radius: 12px;
        background: rgba(156,170,136,0.1); border: 1px dashed rgba(156,170,136,0.4); color: rgba(247,247,242,0.7); transition: border-color 0.3s ease, background 0.3s ease; }
      .ob-share.locked { border-style: solid; border-color: rgba(156,170,136,0.7); background: rgba(156,170,136,0.16); }
      .ob-share-label { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.08em; }
      .ob-share-code { margin-left: auto; font-weight: 800; letter-spacing: 0.32em; color: #f7f7f2; }
      .ob-share-check { color: #9caa88; display: inline-flex; }

      /* terminal */
      .ob-term-body { padding: 18px; display: flex; flex-direction: column; gap: 7px; min-height: 150px; }
      .ob-term-line { font-size: 0.86rem; line-height: 1.6; color: rgba(247,247,242,0.82); white-space: pre-wrap; }
      .ob-term-line.prompt { color: rgba(247,247,242,0.5); }
      .ob-term-line.ok { color: #9caa88; }

      /* hub */
      .ob-hub-stage { display: grid; place-items: center; min-height: 290px; background: rgba(10,12,8,0.4); padding-bottom: 22px; }
      .ob-hub-rings { position: absolute; display: grid; place-items: center; top: 42%; }
      .ob-ring { position: absolute; width: 150px; height: 150px; border-radius: 28px; border: 1.5px solid rgba(47,143,255,0.5); }
      .ob-hub { position: relative; width: 116px; height: 116px; border-radius: 26px; display: grid; place-items: center; color: #fff;
        background: linear-gradient(150deg, #2f8fff, #1d6fd6); box-shadow: 0 18px 50px rgba(47,143,255,0.45), inset 0 0 0 1px rgba(255,255,255,0.16); }
      .ob-hub-led { position: absolute; top: 12px; right: 12px; width: 9px; height: 9px; border-radius: 50%; background: rgba(247,247,242,0.4); transition: background 0.2s ease; }
      .ob-hub-led.done { background: #9caa88; box-shadow: 0 0 12px #9caa88; }
      .ob-hub-download { position: absolute; bottom: 22px; left: 28px; right: 28px; display: flex; flex-direction: column; gap: 7px; }
      .ob-hub-track { height: 6px; border-radius: 999px; background: rgba(247,247,242,0.12); overflow: hidden; }
      .ob-hub-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #2f8fff, #5aa7ff); transition: width 0.09s linear; }
      .ob-hub-status { font-size: 0.72rem; color: rgba(247,247,242,0.6); text-align: center; }

      /* welcome */
      .ob-welcome-body { padding: 20px 18px; min-height: 150px; display: flex; flex-direction: column; gap: 8px; justify-content: center; }
      .ob-welcome-line { font-size: 0.9rem; color: rgba(247,247,242,0.85); white-space: pre-wrap; }
      .ob-prompt { color: #9caa88; margin-right: 8px; }
      .ob-welcome-glow { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 30% 60%, rgba(156,170,136,0.2), transparent 60%); }

      /* finish */
      .ob-finish { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px; background: transparent; border: none; box-shadow: none; backdrop-filter: none; }
      .ob-feature { display: flex; flex-direction: column; gap: 6px; padding: 16px; border-radius: 14px; border: 1px solid rgba(247,247,242,0.12); background: rgba(247,247,242,0.05); }
      .ob-feature-icon { width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: rgba(156,170,136,0.2); color: #c4d4a8; }
      .ob-feature-title { font-weight: 700; font-size: 0.92rem; }
      .ob-feature-text { font-size: 0.78rem; color: rgba(247,247,242,0.55); }

      /* responsive */
      @media (max-width: 880px) {
        .ob-panel { grid-template-columns: 1fr; max-width: 520px; }
        .ob-visual { order: -1; }
        .ob-title { font-size: clamp(1.8rem, 7vw, 2.4rem); }
        .ob-sub { max-width: none; }
      }
      @media (max-width: 540px) {
        .ob-top, .ob-foot { padding-left: 18px; padding-right: 18px; }
        .ob-progress { margin: 0 18px; }
        .ob-stage { padding: 16px 18px; }
        .ob-btn-primary { padding: 12px 16px; font-size: 0.9rem; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ob-orb, .ob-wave, .ob-live-dot, .ob-hub-led, .ob-progress-sheen, .ob-type-caret, .ob-particle { animation: none !important; }
      }
    `}</style>
  );
}
