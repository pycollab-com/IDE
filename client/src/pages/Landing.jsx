import { Suspense, lazy, useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiMoon,
  FiSun,
  FiArrowRight,
  FiGithub,
  FiInstagram,
  FiLinkedin,
  FiLock,
  FiCheck,
} from "react-icons/fi";

const LandingVoxelScene = lazy(() => import("../components/LandingVoxelScene"));

function shouldShowLandingVoxel() {
  if (typeof window === "undefined") return false;
  return window.innerWidth >= 900;
}

function Atmosphere() {
  return (
    <>
      <div className="landing-backdrop" aria-hidden="true">
        <div className="glow glow-1" />
        <div className="glow glow-2" />
        <div className="glow glow-3" />
        <div className="backdrop-grid" />
      </div>
      <div className="landing-noise" aria-hidden="true" />
      <div className="landing-spotlight" aria-hidden="true" />
    </>
  );
}

function PyCollabPresenceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.2 14.2C7.8 13.3 9.5 13.3 11.1 14.2M4.6 17.2C6.8 15.7 10.5 15.7 12.7 17.2M14.2 16.6C15.6 15.6 17.8 15.6 19.2 16.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8.6" cy="9.3" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="16.7" cy="10.1" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12.2 9.6L14.4 10.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PyCollabRuntimeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.4" y="4.4" width="17.2" height="12.8" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.5 9.2L10.1 11.1L7.5 13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8 13H16.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.8 18.8H14.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15.8 6.9L14.9 8.7L16.9 8.6L15.5 11.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PyCollabAccessIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.8L18.6 6.4V11.8C18.6 15.4 16.2 18.5 12 20.1C7.8 18.5 5.4 15.4 5.4 11.8V6.4L12 3.8Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="9.2" y="10.8" width="5.6" height="4.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.4 10.8V9.7C10.4 8.8 11.1 8.1 12 8.1C12.9 8.1 13.6 8.8 13.6 9.7V10.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="13" r="0.7" fill="currentColor" />
    </svg>
  );
}

const CODE_SCRIPT = [
  { text: "def ", user: "David", delay: 50 },
  { text: "collaborate", user: "David", delay: 50 },
  { text: "():\n", user: "David", delay: 50 },
  { text: "    message = ", user: "David", delay: 50 },
  { text: "\"", user: "David", delay: 20 },
  { text: "Hello, PyCollab!", user: "David", delay: 50 },
  { text: "\"", user: "David", delay: 20 },
  { text: "\n    print(message)", user: "Robert", delay: 40 },
  { text: "\n    # Real-time execution", user: "David", delay: 30 },
  { text: "\n    collaborate()", user: "Robert", delay: 50 },
];

const PLATFORM_FEATURES = [
  {
    icon: PyCollabPresenceIcon,
    title: "Presence that feels human",
    desc: "Cursors, selections, and who-is-typing context stay perfectly in sync while you code.",
    chip: "Live room",
    metric: "Sub-second sync",
    meta: "Zero-refresh collaboration",
    tone: "primary",
    featured: true,
  },
  {
    icon: PyCollabRuntimeIcon,
    title: "Run without leaving flow",
    desc: "Execute Python instantly and stream output + input in the same shared workspace.",
    chip: "Runtime",
    metric: "Instant execution",
    meta: "Shared stdout + stdin",
    tone: "secondary",
    featured: false,
  },
  {
    icon: PyCollabAccessIcon,
    title: "Security built in",
    desc: "Private rooms and role-aware access controls keep sensitive work isolated by default.",
    chip: "Access",
    metric: "Controlled by design",
    meta: "Invite-only collaboration",
    tone: "accent",
    featured: false,
  },
];

const TESTIMONIALS_TOP = [
  { quote: "\"PyCollab changed the way I collaborated with my friends.\"", user: "Student project team", role: "University sprint", tone: "primary" },
  { quote: "\"This saved me from github.\"", user: "Bootcamp cohort", role: "Beginner-friendly workflow", tone: "secondary" },
  { quote: "\"We pair-programmed our assignment without screensharing once.\"", user: "Algorithms study group", role: "Faster review sessions", tone: "accent" },
  { quote: "\"The shared terminal made debugging feel like multiplayer mode.\"", user: "Hacknight team", role: "Instant runtime feedback", tone: "primary" },
  { quote: "\"Invite code + live cursors removed all our setup friction.\"", user: "Python meetup pod", role: "Zero-install collab", tone: "secondary" },
];

const TESTIMONIALS_BOTTOM = [
  { quote: "\"Our hackathon team went from idea to demo in one night.\"", user: "Weekend builders", role: "Rapid prototyping", tone: "accent" },
  { quote: "\"I teach Python workshops, and this kept everyone in sync instantly.\"", user: "Workshop instructor", role: "Live teaching rooms", tone: "primary" },
  { quote: "\"Live cursors and live output are exactly what group coding needed.\"", user: "Data club mentors", role: "Collaborative debugging", tone: "secondary" },
  { quote: "\"I finally stopped copy-pasting snippets in group chats.\"", user: "Student founder", role: "Single source of truth", tone: "accent" },
  { quote: "\"We review code faster because everyone sees the same runtime state.\"", user: "Peer code review pod", role: "Shared execution context", tone: "primary" },
];

function TestimonialRow({ items, direction = "left" }) {
  const loopedItems = [...items, ...items];
  return (
    <div className="testimonials-marquee">
      <div className={`testimonials-track ${direction === "right" ? "reverse" : ""}`}>
        {loopedItems.map((item, index) => (
          <button
            key={`${item.quote}-${index}`}
            type="button"
            className="testimonial-card"
            data-tone={item.tone}
            aria-label={`${item.user} testimonial`}
          >
            <span className="quote-mark">"</span>
            <p className="testimonial-quote">{item.quote}</p>
            <div className="testimonial-meta">
              <span className="testimonial-user">{item.user}</span>
              <span className="testimonial-role">{item.role}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc, chip, metric, meta, delay = 0, tone = "primary", featured = false }) {
  return (
    <motion.article
      className={`feature-card${featured ? " feature-card--featured" : ""}`}
      data-tone={tone}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ delay, duration: 0.45, ease: "easeOut" }}
      whileHover={{ y: -3 }}
    >
      <div className="feature-head">
        <span className="feature-icon"><Icon /></span>
        <span className="feature-chip">{chip}</span>
      </div>
      <div className="feature-copy">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      {featured ? (
        <div className="feature-visual feature-visual--presence" aria-hidden="true">
          <div className="presence-orbit">
            <div className="presence-person presence-person--primary">
              <span className="presence-avatar">D</span>
              <div className="presence-details">
                <strong>David</strong>
                <span>Typing in `main.py`</span>
              </div>
            </div>
            <div className="presence-person presence-person--secondary">
              <span className="presence-avatar">R</span>
              <div className="presence-details">
                <strong>Robert</strong>
                <span>Reviewing output</span>
              </div>
            </div>
            <div className="presence-thread">
              <span className="presence-thread-line" />
              <span className="presence-thread-dot presence-thread-dot--primary" />
              <span className="presence-thread-dot presence-thread-dot--secondary" />
            </div>
          </div>
          <div className="presence-pulse-grid">
            <div className="presence-pulse presence-pulse--active" />
            <div className="presence-pulse" />
            <div className="presence-pulse" />
            <div className="presence-pulse presence-pulse--active" />
          </div>
        </div>
      ) : null}
      <div className="feature-meta">
        <strong>{metric}</strong>
        <span>{meta}</span>
      </div>
    </motion.article>
  );
}

function CodeDemo() {
  const containerRef = useRef(null);
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);
  const [text, setText] = useState("");
  const [cursorDavid, setCursorDavid] = useState({ active: true });
  const [cursorRobert, setCursorRobert] = useState({ active: false });
  const [step, setStep] = useState(0);

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    setRotateX(((y - centerY) / centerY) * -3);
    setRotateY(((x - centerX) / centerX) * 3);
  };

  const handleMouseLeave = () => { setRotateX(0); setRotateY(0); };

  useEffect(() => {
    let timeout;
    if (step < CODE_SCRIPT.length) {
      const { text: chunk, user, delay } = CODE_SCRIPT[step];
      setCursorDavid({ active: user === "David" });
      setCursorRobert({ active: user === "Robert" });
      let charIndex = 0;
      const typeChar = () => {
        if (charIndex < chunk.length) {
          const char = chunk[charIndex];
          setText((prev) => prev + char);
          charIndex++;
          timeout = setTimeout(typeChar, delay);
        } else {
          setStep((s) => s + 1);
        }
      };
      typeChar();
    } else {
      timeout = setTimeout(() => { setText(""); setStep(0); }, 3000);
    }
    return () => clearTimeout(timeout);
  }, [step]);

  const highlightCode = (code) => {
    if (!code) return null;
    return code.split(/(\n)/).map((line, i) => {
      const parts = line.split(/(\bdef\b|\bprint\b|".*?"|#.*|\bcollaborate\b)/).filter((p) => p !== "");
      return (
        <div key={i} className="code-line">
          {parts.map((part, j) => {
            if (part === "def" || part === "print") return <span key={j} className="keyword">{part}</span>;
            if (part.startsWith('"')) return <span key={j} className="string">{part}</span>;
            if (part.startsWith("#")) return <span key={j} className="comment">{part}</span>;
            if (part.trim() === "collaborate") return <span key={j} className="function">{part}</span>;
            return <span key={j}>{part}</span>;
          })}
        </div>
      );
    });
  };

  return (
    <div
      ref={containerRef}
      className="code-demo"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)` }}
    >
      <div className="code-output">
        {highlightCode(text)}
        <span className="cursor-caret cursor-david" style={{ display: cursorDavid.active ? "inline" : "none" }}>
          <span className="cursor-label">David</span>
        </span>
        <span className="cursor-caret cursor-robert" style={{ display: cursorRobert.active ? "inline" : "none" }}>
          <span className="cursor-label">Robert</span>
        </span>
      </div>
    </div>
  );
}

export default function Landing({ theme, toggleTheme }) {
  const navigate = useNavigate();
  const platformRef = useRef(null);
  const ctaRef = useRef(null);
  const [showLandingVoxel, setShowLandingVoxel] = useState(() => shouldShowLandingVoxel());

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) navigate("/", { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 768px)").matches) return undefined;
    const handleMouseMove = (e) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      document.documentElement.style.setProperty("--mouse-x", `${x}%`);
      document.documentElement.style.setProperty("--mouse-y", `${y}%`);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia("(max-width: 899px)");
    const syncLandingVoxel = () => setShowLandingVoxel(!mediaQuery.matches);

    syncLandingVoxel();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncLandingVoxel);
      return () => mediaQuery.removeEventListener("change", syncLandingVoxel);
    }

    mediaQuery.addListener(syncLandingVoxel);
    return () => mediaQuery.removeListener(syncLandingVoxel);
  }, []);

  return (
    <div className={`landing-page${showLandingVoxel ? " landing-page--voxelized" : ""}`}>
      <Atmosphere />
      {showLandingVoxel ? (
        <Suspense fallback={null}>
          <LandingVoxelScene platformRef={platformRef} ctaRef={ctaRef} theme={theme} />
        </Suspense>
      ) : null}

      <nav className="landing-nav">
        <div className="nav-inner">
          <div className="logo text-gradient">PyCollab</div>
          <div className="nav-links">
            <a href="#platform" className="nav-link">Platform</a>
            <a href="#workflow" className="nav-link">Workflow</a>
            <a href="#security" className="nav-link">Security</a>
          </div>
          <div className="nav-actions">
            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <FiMoon /> : <FiSun />}
            </button>
            <Link to="/login" className="btn-ghost">Log in</Link>
            <a href="/support" className="btn-ghost">Support</a>
            <Link to="/register" className="btn-primary">Start free</Link>
          </div>
        </div>
      </nav>

      <motion.header
        className="hero"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
      >
        <div className="hero-ring hero-ring-1" aria-hidden="true" />
        <div className="hero-ring hero-ring-2" aria-hidden="true" />

        <div className="hero-copy">
          <motion.h1
            className="hero-title"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7 }}
          >
            Your Python team,
            <br />
            <span className="text-gradient">in perfect sync.</span>
          </motion.h1>

          <motion.p
            className="hero-subtitle"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32, duration: 0.65 }}
          >
            Real-time editing, instant execution, and shared context — all in one live Python studio.
          </motion.p>

          <motion.div
            className="hero-actions"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.44, duration: 0.6 }}
          >
            <Link to="/register" className="btn-hero">
              Start for free <FiArrowRight />
            </Link>
            <a href="#platform" className="btn-ghost-hero">
              See how it works
            </a>
          </motion.div>

          <motion.p
            className="hero-trust"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
          >
            No credit card. No setup. Just code together.
          </motion.p>
        </div>

        <motion.div
          className="hero-demo"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.75, ease: "easeOut" }}
        >
          <div className="demo-shell">
            <div className="demo-topbar">
              <div className="dot-group">
                <span className="dot dot-r" /><span className="dot dot-y" /><span className="dot dot-g" />
              </div>
              <span className="demo-topbar-title">Main.py</span>
              <span className="live-badge">
                <span className="status-dot" /> Live
              </span>
            </div>
            <div className="demo-body">
              <CodeDemo />
            </div>
            <div className="demo-chips">
              <span className="chip">Multiplayer cursors</span>
              <span className="chip">Shared run logs</span>
              <span className="chip">Session timeline</span>
            </div>
          </div>
        </motion.div>
      </motion.header>

      <div className="stats-strip" aria-label="Key platform capabilities">
        <div className="stats-inner">
          {[
            { metric: "Real-time", label: "Presence sync" },
            { metric: "Instant", label: "Python execution" },
            { metric: "Private", label: "Room access" },
            { metric: "Free", label: "Forever, for everyone" },
          ].map(({ metric, label }) => (
            <div className="stat-item" key={metric}>
              <strong>{metric}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="testimonials-section" id="testimonials" aria-labelledby="testimonials-heading">
        <div className="testimonials-shell">
          <div className="testimonials-head">
            <span className="section-kicker">Community feedback</span>
            <h2 id="testimonials-heading">What teams say about PyCollab</h2>
            <p>Live collaboration stories from students, clubs, and hackathon teams.</p>
          </div>
          <div className="testimonials-stack">
            <TestimonialRow items={TESTIMONIALS_TOP} direction="left" />
            <TestimonialRow items={TESTIMONIALS_BOTTOM} direction="right" />
          </div>
        </div>
      </section>

      <section className="platform-section" id="platform" ref={platformRef}>
        <div className="platform-shell">
          <div className="platform-head">
            <div>
              <span className="section-kicker">Features</span>
              <h2>Everything your Python team needs</h2>
              <p>Code together, run instantly, and keep decisions anchored to the work.</p>
            </div>
            <div className="platform-head-actions">
              <Link to="/register" className="btn-primary">Launch a workspace</Link>
              <a href="#workflow" className="btn-ghost">See workflow</a>
            </div>
          </div>

          <div className="platform-bento">
            <FeatureCard
              key={PLATFORM_FEATURES[0].title}
              {...PLATFORM_FEATURES[0]}
              delay={0.06}
            />
            <div className="bento-col">
              {PLATFORM_FEATURES.slice(1).map((f, i) => (
                <FeatureCard key={f.title} {...f} delay={0.12 + i * 0.08} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="workflow-shell">
          <div className="workflow-head">
            <span className="section-kicker">How it works</span>
            <h2>From idea to live output in three steps</h2>
            <p>Bring engineering, data, and product into the same space. PyCollab keeps context close so decisions happen while you build.</p>
          </div>

          <div className="workflow-steps">
            {[
              { num: "01", title: "Spin up a live room", desc: "Create a workspace with instant runtime and invite collaborators with a single link." },
              { num: "02", title: "Build together", desc: "Co-edit, run, and review with a perfectly shared view of code, output, and presence." },
              { num: "03", title: "Ship the outcome", desc: "Save snapshots, export results, and share next steps — all from inside the session." },
            ].map(({ num, title, desc }) => (
              <div className="workflow-step" key={num}>
                <div className="step-num-bg" aria-hidden="true">{num}</div>
                <div className="step-badge">{num}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>

          <div className="workflow-visual">
            <div className="wv-card wv-main">
              <div className="wv-header">
                <span className="wv-chip">Live room</span>
                <h3>Session timeline</h3>
              </div>
              {[
                { label: "Edits synced", value: "Real-time" },
                { label: "Output stream", value: "Instant" },
                { label: "Review status", value: "Resolved" },
              ].map(({ label, value }) => (
                <div className="wv-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="wv-card wv-sub">
              <div className="wv-header">
                <span className="wv-chip">Shared notes</span>
                <h3>Decisions captured</h3>
              </div>
              <div className="wv-notes">
                <div className="wv-note-item">
                  <span className="wv-note-avatar">D</span>
                  <div>
                    <div className="wv-note-meta">David · just now</div>
                    <div className="wv-note-body">Changed retry logic — limit to 3 attempts max.</div>
                  </div>
                </div>
                <div className="wv-note-item">
                  <span className="wv-note-avatar wv-note-avatar-b">R</span>
                  <div>
                    <div className="wv-note-meta">Robert · 2m ago</div>
                    <div className="wv-note-body">Confirmed: use exponential backoff here.</div>
                  </div>
                </div>
              </div>
              <p className="wv-sub-desc">Keep context attached to every code change with shared notes and comments.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="security-section" id="security">
        <div className="security-shell">
          <div className="security-left">
            <span className="section-kicker section-kicker--light">
              <FiLock size={12} /> Security-first
            </span>
            <h2>Private rooms,<br />controlled access</h2>
            <p>
              PyCollab is built for modern Python teams that need to move fast while staying secure.
              Set access levels, rotate links, and keep sensitive work private.
            </p>
            <div className="security-actions">
              <Link to="/register" className="btn-primary">Create a secure room</Link>
              <a href="/support" className="btn-ghost-light">Talk to us</a>
            </div>
          </div>
          <div className="security-right">
            {[
              { title: "Granular roles", desc: "Control who can edit, run, or view each workspace independently." },
              { title: "Session lockdown", desc: "Freeze rooms instantly and resume when the team is ready." },
              { title: "Audit-ready", desc: "Track changes, comments, and output with a full, timestamped timeline." },
            ].map(({ title, desc }) => (
              <div className="security-item" key={title}>
                <span className="security-check"><FiCheck /></span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-section" id="cta" ref={ctaRef}>
        <div className="cta-glow-l" aria-hidden="true" />
        <div className="cta-glow-r" aria-hidden="true" />
        <div className="cta-inner">
          <span className="cta-badge">Always free</span>
          <h2>Bring your team into a shared live studio.</h2>
          <p>PyCollab is completely free. Spin up a workspace and invite your team in seconds.</p>
          <div className="cta-actions">
            <Link to="/register" className="btn-cta-primary">
              Create free account <FiArrowRight />
            </Link>
            <a href="#platform" className="btn-cta-ghost">
              Explore platform
            </a>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-inner">
          <div className="footer-brand-col">
            <div className="footer-logo text-gradient">PyCollab</div>
            <p>A shared live Python studio for modern teams. Free forever.</p>
            <div className="footer-social" aria-label="PyCollab social links">
              <a href="https://github.com/pycollab-com" target="_blank" rel="noreferrer" aria-label="PyCollab on GitHub" className="footer-social-link"><FiGithub /></a>
              <a href="https://www.linkedin.com/company/pycollab" target="_blank" rel="noreferrer" aria-label="PyCollab on LinkedIn" className="footer-social-link"><FiLinkedin /></a>
              <a href="https://www.instagram.com/pycollab" target="_blank" rel="noreferrer" aria-label="PyCollab on Instagram" className="footer-social-link"><FiInstagram /></a>
            </div>
          </div>
          <div className="footer-links-col">
            <span className="footer-col-head">Product</span>
            <a href="#platform">Platform</a>
            <a href="#workflow">Workflow</a>
            <a href="#security">Security</a>
            <a href="#testimonials">Community</a>
          </div>
          <div className="footer-links-col">
            <span className="footer-col-head">Company</span>
            <a href="/docs">Docs</a>
            <a href="/support">Support</a>
          </div>
          <div className="footer-links-col">
            <span className="footer-col-head">Account</span>
            <Link to="/login">Log in</Link>
            <Link to="/register">Start free</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>&copy; {new Date().getFullYear()} PyCollab. All rights reserved.</span>
        </div>
      </footer>

      <style>{`
        .landing-page {
          --lp-max: min(1200px, calc(100% - 64px));
          --lp-card: rgba(18,17,19,0.78);
          --lp-border: rgba(247,247,242,0.13);
          --lp-text-soft: rgba(247,247,242,0.65);
          --lp-mono: 'Space Mono', var(--font-mono);
          --p-rgb: 137,152,120;
          --s-rgb: 127,142,109;
          --a-rgb: 156,170,136;
          min-height: 100vh;
          color: var(--text-color);
          position: relative;
          overflow-x: hidden;
        }
        .landing-page--voxelized {
          --lp-card: rgba(18,17,19,0.68);
          isolation: isolate;
        }
        [data-theme="light"] .landing-page {
          --lp-card: rgba(255,255,255,0.94);
          --lp-border: rgba(18,17,19,0.1);
          --lp-text-soft: rgba(18,17,19,0.72);
        }
        [data-theme="light"] .landing-page--voxelized {
          --lp-card: rgba(255,255,255,0.84);
        }
        .text-gradient {
          background: linear-gradient(120deg, var(--accent), var(--primary), var(--secondary));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 13px;
          border-radius: 999px;
          font-size: 0.7rem;
          letter-spacing: 0.13em;
          text-transform: uppercase;
          font-family: var(--font-mono);
          background: rgba(var(--p-rgb),0.18);
          color: var(--primary);
          border: 1px solid rgba(var(--p-rgb),0.4);
        }
        .section-kicker--light {
          background: rgba(255,255,255,0.18);
          color: #fff;
          border-color: rgba(255,255,255,0.35);
        }

        /* backdrop */
        .landing-backdrop {
          position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background:
            radial-gradient(circle at 18% 12%, rgba(137,152,120,0.2), transparent 50%),
            radial-gradient(circle at 82% 4%,  rgba(156,170,136,0.17), transparent 52%),
            radial-gradient(circle at 50% 88%, rgba(127,142,109,0.2),  transparent 58%),
            linear-gradient(180deg, rgba(18,17,19,0.95) 0%, rgba(18,17,19,0.85) 55%, rgba(18,17,19,0.97) 100%);
        }
        [data-theme="light"] .landing-backdrop {
          background:
            radial-gradient(circle at 18% 12%, rgba(137,152,120,0.15), transparent 50%),
            radial-gradient(circle at 82% 4%,  rgba(156,170,136,0.12), transparent 52%),
            radial-gradient(circle at 50% 88%, rgba(127,142,109,0.12), transparent 58%),
            linear-gradient(180deg,rgba(247,247,242,0.99) 0%,rgba(247,247,242,0.93) 55%,rgba(247,247,242,1) 100%);
        }
        .glow { position:absolute; border-radius:999px; filter:blur(80px); opacity:0.5; animation:floatGlow 18s ease-in-out infinite; }
        .glow-1 { width:420px; height:420px; background:rgba(137,152,120,0.35); top:-120px; left:-80px; }
        .glow-2 { width:360px; height:360px; background:rgba(127,142,109,0.35); bottom:10%; right:-120px; animation-delay:-6s; }
        .glow-3 { width:300px; height:300px; background:rgba(156,170,136,0.35); top:30%; right:15%; animation-delay:-10s; }
        @keyframes floatGlow {
          0%,100% { transform:translate3d(0,0,0); }
          50%      { transform:translate3d(40px,-20px,0); }
        }
        .backdrop-grid {
          position:absolute; inset:0;
          background-image:
            linear-gradient(transparent 95%, rgba(247,247,242,0.04) 100%),
            linear-gradient(90deg, transparent 95%, rgba(247,247,242,0.04) 100%);
          background-size:80px 80px;
          opacity:0.28;
        }
        [data-theme="light"] .backdrop-grid {
          background-image:
            linear-gradient(transparent 95%, rgba(18,17,19,0.06) 100%),
            linear-gradient(90deg, transparent 95%, rgba(18,17,19,0.06) 100%);
        }
        .landing-noise {
          position:fixed; inset:0; z-index:1; pointer-events:none; opacity:0.07;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E");
        }
        [data-theme="light"] .landing-noise { opacity:0.035; }
        .landing-spotlight {
          position:fixed; inset:0; z-index:2; pointer-events:none;
          background: radial-gradient(320px circle at var(--mouse-x,50%) var(--mouse-y,50%), rgba(137,152,120,0.16) 0%, transparent 70%);
          transition: background 0.3s ease;
        }

        /* nav */
        .landing-nav {
          position:sticky; top:0; z-index:10;
          backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px);
          background:rgba(18,17,19,0.65);
          border-bottom:1px solid var(--lp-border);
        }
        [data-theme="light"] .landing-nav {
          background:rgba(247,247,242,0.88);
          box-shadow:0 2px 12px rgba(18,17,19,0.07);
        }
        .landing-page--voxelized .landing-nav,
        .landing-page--voxelized .demo-shell,
        .landing-page--voxelized .testimonial-card,
        .landing-page--voxelized .feature-card,
        .landing-page--voxelized .workflow-step,
        .landing-page--voxelized .wv-card,
        .landing-page--voxelized .security-right {
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }
        .nav-inner {
          max-width:var(--lp-max); margin:0 auto; padding:14px 32px;
          display:flex; align-items:center; gap:20px;
        }
        .logo { font-weight:700; font-size:1.35rem; letter-spacing:-0.03em; margin-right:auto; }
        .nav-links { display:flex; align-items:center; gap:4px; }
        .nav-link {
          padding:7px 14px; border-radius:999px; font-size:0.9rem;
          color:var(--lp-text-soft); transition:background 0.18s ease,color 0.18s ease;
        }
        .nav-link:hover { background:rgba(var(--p-rgb),0.14); color:var(--text-color); }
        .nav-actions { display:flex; align-items:center; gap:8px; }
        .theme-toggle {
          width:38px; height:38px; display:inline-flex; align-items:center; justify-content:center;
          border-radius:999px; border:1px solid var(--lp-border); background:transparent;
          color:var(--text-color); cursor:pointer; transition:background 0.18s ease;
        }
        .theme-toggle:hover { background:rgba(var(--p-rgb),0.14); }

        /* hero */
        .hero {
          position:relative; z-index:3;
          padding:52px 32px 0;
          display:flex; flex-direction:column; align-items:center; text-align:center;
          overflow:hidden;
        }
        .hero-ring {
          position:absolute; border-radius:50%;
          border:1px solid rgba(var(--p-rgb),0.18);
          pointer-events:none;
        }
        .hero-ring-1 { width:700px; height:700px; top:-320px; left:50%; transform:translateX(-50%); box-shadow:0 0 120px rgba(var(--p-rgb),0.1); }
        .hero-ring-2 { width:1050px; height:1050px; top:-480px; left:50%; transform:translateX(-50%); border-color:rgba(var(--p-rgb),0.07); }
        .hero-copy {
          position:relative; z-index:4; max-width:800px;
          display:flex; flex-direction:column; align-items:center; gap:20px;
        }
        .hero-badge {
          display:inline-flex; align-items:center; gap:8px;
          padding:7px 16px; border-radius:999px;
          background:rgba(var(--p-rgb),0.2); border:1px solid rgba(var(--p-rgb),0.45);
          font-size:0.88rem; font-weight:600;
        }
        .badge-pulse {
          width:8px; height:8px; border-radius:50%; background:var(--primary);
          animation:statusPulse 2s ease-in-out infinite; flex:0 0 auto;
        }
        .hero-title {
          font-size:clamp(3.2rem, 6vw, 5.2rem);
          line-height:1.04; letter-spacing:-0.03em; margin:0;
        }
        .hero-subtitle {
          margin:0; font-size:clamp(1.05rem,1.6vw,1.22rem);
          color:var(--lp-text-soft); max-width:580px; line-height:1.65;
        }
        .hero-actions {
          display:flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:center;
        }
        .btn-hero {
          display:inline-flex; align-items:center; gap:8px; padding:14px 28px;
          border-radius:999px;
          background:linear-gradient(135deg, var(--accent), var(--primary), var(--secondary));
          color:#fff; font-weight:700; font-size:1rem; border:none; cursor:pointer;
          box-shadow:0 4px 24px rgba(var(--p-rgb),0.45);
          transition:box-shadow 0.22s ease,transform 0.18s ease; text-decoration:none;
        }
        .btn-hero:hover { box-shadow:0 6px 32px rgba(var(--p-rgb),0.62); transform:translateY(-2px); }
        .btn-ghost-hero {
          display:inline-flex; align-items:center; gap:6px; padding:12px 24px;
          border-radius:999px; border:1px solid var(--lp-border); background:transparent;
          color:var(--text-color); font-weight:600; font-size:0.98rem; cursor:pointer;
          transition:background 0.2s ease,border-color 0.2s ease; text-decoration:none;
        }
        .btn-ghost-hero:hover { background:rgba(var(--p-rgb),0.12); border-color:rgba(var(--p-rgb),0.4); }
        .hero-trust { margin:0; font-size:0.84rem; color:var(--lp-text-soft); }

        /* demo */
        .hero-demo { position:relative; z-index:4; width:100%; max-width:900px; margin-top:52px; }
        .demo-shell {
          background:var(--lp-card); border:1px solid var(--lp-border); border-radius:20px;
          overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,0.42),0 0 0 1px rgba(var(--p-rgb),0.1);
        }
        [data-theme="light"] .demo-shell {
          box-shadow:0 16px 40px rgba(18,17,19,0.14),0 0 0 1px rgba(var(--p-rgb),0.12);
        }
        .demo-topbar {
          display:flex; align-items:center; gap:10px; padding:12px 18px;
          border-bottom:1px solid var(--lp-border); background:rgba(var(--p-rgb),0.08);
        }
        .dot-group { display:flex; gap:6px; }
        .dot { width:10px; height:10px; border-radius:50%; }
        .dot-r { background:rgba(137,152,120,0.75); }
        .dot-y { background:rgba(156,170,136,0.75); }
        .dot-g { background:rgba(127,142,109,0.75); }
        .demo-topbar-title {
          flex:1; text-align:center; font-size:0.8rem; font-weight:600;
          color:var(--lp-text-soft); letter-spacing:0.02em;
        }
        .live-badge {
          display:inline-flex; align-items:center; gap:6px; padding:4px 10px;
          border-radius:999px; background:rgba(var(--p-rgb),0.2); border:1px solid rgba(var(--p-rgb),0.4);
          font-size:0.72rem; font-weight:600;
        }
        .status-dot {
          width:7px; height:7px; border-radius:50%; background:var(--primary);
          animation:statusPulse 2s ease-in-out infinite; flex:0 0 auto;
        }
        @keyframes statusPulse {
          0%,100% { transform:scale(1); opacity:1; }
          50%      { transform:scale(1.15); opacity:0.7; }
        }
        .demo-body { padding:0; }
        .demo-chips {
          display:flex; gap:8px; flex-wrap:wrap; padding:12px 18px;
          border-top:1px solid var(--lp-border); background:rgba(var(--p-rgb),0.05);
        }
        .chip {
          padding:5px 12px; border-radius:999px; border:1px solid var(--lp-border);
          background:rgba(var(--p-rgb),0.1); font-size:0.77rem; color:var(--lp-text-soft);
        }
        /* code demo */
        .code-demo {
          width:100%; min-height:284px; padding:20px;
          background:rgba(12,12,14,0.82); font-family:var(--font-mono);
        }
        [data-theme="light"] .code-demo { background:rgba(247,247,242,0.95); }
        .code-output {
          color:var(--text-color); font-size:0.88rem; line-height:1.72; min-height:244px; overflow:hidden;
        }
        .code-line { display:block; white-space:pre-wrap; }
        .keyword  { color:var(--primary); font-weight:600; }
        .string { color:var(--accent); }
        .comment { color:var(--lp-text-soft); }
        .function  { color:var(--secondary); font-weight:600; }
        .cursor-caret {
          display:inline-block; width:2px; height:18px;
          background:currentColor; vertical-align:middle;
          animation:cursorBlink 1s step-end infinite;
          position:relative;
        }
        .cursor-label {
          position:absolute; top:-22px; left:-6px;
          padding:3px 7px; border-radius:999px;
          font-size:0.62rem; font-weight:700; color:#fff; white-space:nowrap;
        }
        .cursor-david { color:var(--primary); }
        .cursor-david .cursor-label { background:var(--primary); }
        .cursor-robert { color:var(--secondary); }
        .cursor-robert .cursor-label { background:var(--secondary); }
        @keyframes cursorBlink {
          0%,100% { opacity:1; }
          50%      { opacity:0; }
        }

        /* stats strip */
        .stats-strip {
          position:relative; z-index:3; margin-top:72px;
          border-top:1px solid var(--lp-border); border-bottom:1px solid var(--lp-border);
          background:rgba(var(--p-rgb),0.06);
        }
        [data-theme="light"] .stats-strip { background:rgba(var(--p-rgb),0.08); }
        .stats-inner {
          max-width:var(--lp-max); margin:0 auto;
          display:grid; grid-template-columns:repeat(4,1fr);
          padding:36px 32px; gap:24px;
        }
        .stat-item { display:flex; flex-direction:column; align-items:center; gap:4px; text-align:center; }
        .stat-item strong {
          font-size:1.8rem; font-weight:700; letter-spacing:-0.02em; line-height:1.1;
          background:linear-gradient(120deg, var(--accent), var(--primary));
          -webkit-background-clip:text; background-clip:text; color:transparent;
        }
        .stat-item span { font-size:0.82rem; color:var(--lp-text-soft); }

        /* testimonials */
        .testimonials-section { padding:80px 32px; position:relative; z-index:3; border-top:1px solid var(--lp-border); }
        .testimonials-shell { max-width:var(--lp-max); margin:0 auto; display:grid; gap:44px; }
        .testimonials-head {
          text-align:center; display:flex; flex-direction:column; align-items:center; gap:12px;
        }
        .testimonials-head h2 {
          margin:0; font-size:clamp(1.8rem,3vw,2.5rem); line-height:1.15; letter-spacing:-0.02em;
        }
        .testimonials-head p { margin:0; color:var(--lp-text-soft); max-width:50ch; }
        .testimonials-stack { display:grid; gap:12px; }
        .testimonials-marquee {
          position:relative; overflow:hidden; padding:4px 0;
          -webkit-mask-image:linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%);
          mask-image:linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%);
        }
        .testimonials-track {
          display:flex; align-items:stretch; gap:12px;
          width:max-content; animation:marqueeLeft 40s linear infinite; will-change:transform;
        }
        .testimonials-track.reverse { animation-name:marqueeRight; animation-duration:44s; }
        .testimonials-track:hover { animation-play-state:paused; }
        .testimonial-card {
          --t-rgb: 137,152,120;
          flex:0 0 auto; width:clamp(280px,30vw,400px); min-height:170px;
          padding:24px 24px 20px; border-radius:18px;
          border-left:3px solid rgba(var(--t-rgb),0.8);
          border-top:1px solid var(--lp-border); border-right:1px solid var(--lp-border); border-bottom:1px solid var(--lp-border);
          background:var(--lp-card); color:var(--text-color);
          text-align:left; display:flex; flex-direction:column; gap:12px;
          position:relative; box-shadow:0 6px 20px rgba(0,0,0,0.18);
          transition:transform 0.25s ease,box-shadow 0.25s ease; cursor:default;
        }
        .testimonial-card[data-tone="primary"]   { --t-rgb: 137,152,120; }
        .testimonial-card[data-tone="secondary"] { --t-rgb: 127,142,109; }
        .testimonial-card[data-tone="accent"]    { --t-rgb: 156,170,136; }
        .testimonial-card:hover { transform:translateY(-3px); box-shadow:0 10px 28px rgba(0,0,0,0.22); }
        .quote-mark {
          position:absolute; top:14px; right:18px;
          font-size:3.5rem; line-height:1; color:rgba(var(--t-rgb),0.25);
          font-family:Georgia,serif; pointer-events:none; user-select:none;
        }
        .testimonial-quote { margin:0; font-size:0.97rem; line-height:1.58; position:relative; z-index:1; }
        .testimonial-meta { margin-top:auto; display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .testimonial-user {
          font-family:var(--font-mono); font-size:0.72rem; letter-spacing:0.1em;
          text-transform:uppercase; color:rgba(var(--t-rgb),1);
        }
        .testimonial-role {
          font-size:0.72rem; padding:4px 10px; border-radius:999px;
          border:1px solid rgba(var(--t-rgb),0.4); background:rgba(var(--t-rgb),0.14); white-space:nowrap;
        }
        @keyframes marqueeLeft  { from { transform:translateX(0); }   to { transform:translateX(-50%); } }
        @keyframes marqueeRight { from { transform:translateX(-50%); } to { transform:translateX(0); } }

        /* platform */
        .platform-section { padding:80px 32px; position:relative; z-index:3; border-top:1px solid var(--lp-border); }
        .platform-shell { max-width:var(--lp-max); margin:0 auto; display:grid; gap:48px; }
        .platform-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:20px; }
        .platform-head h2 {
          margin:10px 0 8px; font-size:clamp(1.8rem,2.8vw,2.5rem); line-height:1.12; letter-spacing:-0.02em; max-width:28ch;
        }
        .platform-head p { margin:0; color:var(--lp-text-soft); max-width:44ch; }
        .platform-head-actions { display:flex; gap:8px; align-items:center; flex-shrink:0; }
        .platform-bento { display:grid; grid-template-columns:minmax(0, 1.14fr) minmax(0, 0.86fr); gap:16px; align-items:stretch; }
        .bento-col { display:flex; flex-direction:column; gap:16px; }
        .feature-card {
          --f-rgb: 137,152,120;
          padding:28px; border-radius:20px; border:1px solid var(--lp-border);
          background:radial-gradient(130% 110% at 96% 0%, rgba(var(--f-rgb),0.18), transparent 50%), var(--lp-card);
          display:flex; flex-direction:column; gap:16px;
          position:relative; overflow:hidden; box-shadow:0 8px 24px rgba(0,0,0,0.18);
          transition:box-shadow 0.25s ease,transform 0.25s ease;
        }
        .feature-card[data-tone="primary"]   { --f-rgb: 137,152,120; }
        .feature-card[data-tone="secondary"] { --f-rgb: 127,142,109; }
        .feature-card[data-tone="accent"]    { --f-rgb: 156,170,136; }
        .feature-card--featured { min-height:100%; }
        .feature-card--featured::before {
          content:""; position:absolute; top:0; left:0; right:0; height:3px;
          background:linear-gradient(90deg, var(--secondary), var(--primary), var(--accent));
        }
        [data-theme="light"] .feature-card {
          background:radial-gradient(130% 110% at 96% 0%, rgba(var(--f-rgb),0.14), transparent 50%), rgba(255,255,255,0.96);
          box-shadow:0 6px 18px rgba(18,17,19,0.08);
        }
        .feature-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .feature-icon {
          width:46px; height:46px; border-radius:13px; display:inline-flex;
          align-items:center; justify-content:center;
          background:rgba(var(--f-rgb),0.22); color:var(--primary); border:1px solid rgba(var(--f-rgb),0.45); flex:0 0 auto;
        }
        .feature-icon svg { width:22px; height:22px; }
        .feature-chip {
          padding:5px 12px; border-radius:999px; border:1px solid rgba(var(--f-rgb),0.42);
          background:rgba(var(--f-rgb),0.14); font-family:var(--font-mono);
          font-size:0.64rem; letter-spacing:0.13em; text-transform:uppercase;
        }
        .feature-copy { display:grid; gap:8px; }
        .feature-copy h3 { margin:0; font-size:1.22rem; line-height:1.2; }
        .feature-card--featured .feature-copy h3 { font-size:1.55rem; }
        .feature-copy p { margin:0; color:var(--lp-text-soft); font-size:0.94rem; line-height:1.55; }
        .feature-visual {
          position:relative;
          border:1px solid rgba(var(--f-rgb),0.24);
          background:linear-gradient(180deg, rgba(var(--f-rgb),0.12) 0%, rgba(12,12,14,0.08) 100%);
          border-radius:18px;
          overflow:hidden;
        }
        .feature-visual--presence {
          min-height:144px;
          margin-top:2px;
          padding:18px;
          display:grid;
          gap:16px;
        }
        [data-theme="light"] .feature-visual {
          background:linear-gradient(180deg, rgba(var(--f-rgb),0.1) 0%, rgba(255,255,255,0.84) 100%);
        }
        .presence-orbit {
          position:relative;
          min-height:84px;
        }
        .presence-person {
          position:absolute;
          display:flex;
          align-items:center;
          gap:12px;
          min-width:190px;
          padding:12px 14px;
          border-radius:16px;
          border:1px solid rgba(var(--f-rgb),0.28);
          background:rgba(12,12,14,0.48);
          backdrop-filter:blur(12px);
          box-shadow:0 10px 24px rgba(0,0,0,0.16);
        }
        [data-theme="light"] .presence-person {
          background:rgba(255,255,255,0.88);
        }
        .presence-person--primary {
          top:0;
          left:0;
        }
        .presence-person--secondary {
          right:0;
          bottom:0;
        }
        .presence-avatar {
          width:34px;
          height:34px;
          border-radius:12px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          background:rgba(var(--f-rgb),0.22);
          border:1px solid rgba(var(--f-rgb),0.38);
          color:var(--text-color);
          font-size:0.8rem;
          font-weight:700;
          flex:0 0 auto;
        }
        .presence-details {
          display:grid;
          gap:3px;
        }
        .presence-details strong {
          font-size:0.88rem;
          line-height:1.1;
        }
        .presence-details span {
          color:var(--lp-text-soft);
          font-size:0.76rem;
          line-height:1.3;
        }
        .presence-thread {
          position:absolute;
          inset:22px 74px 22px 74px;
          pointer-events:none;
        }
        .presence-thread-line {
          position:absolute;
          inset:0;
          border-radius:999px;
          border:1px dashed rgba(var(--f-rgb),0.26);
        }
        .presence-thread-dot {
          position:absolute;
          width:10px;
          height:10px;
          border-radius:50%;
          background:rgba(var(--f-rgb),0.5);
          box-shadow:0 0 0 6px rgba(var(--f-rgb),0.1);
        }
        .presence-thread-dot--primary {
          top:20px;
          left:28%;
          background:rgba(var(--p-rgb),0.95);
        }
        .presence-thread-dot--secondary {
          right:22%;
          bottom:16px;
          background:rgba(var(--s-rgb),0.95);
        }
        .presence-pulse-grid {
          display:grid;
          grid-template-columns:repeat(4, minmax(0, 1fr));
          gap:10px;
        }
        .presence-pulse {
          height:7px;
          border-radius:999px;
          background:rgba(var(--f-rgb),0.14);
          overflow:hidden;
          position:relative;
        }
        .presence-pulse::after {
          content:"";
          position:absolute;
          inset:0;
          transform:scaleX(0.38);
          transform-origin:left center;
          border-radius:inherit;
          background:linear-gradient(90deg, rgba(var(--f-rgb),0.2), rgba(var(--f-rgb),0.58));
        }
        .presence-pulse--active::after {
          transform:scaleX(0.82);
        }
        .feature-meta {
          margin-top:auto; padding-top:14px; border-top:1px solid var(--lp-border);
          display:flex; align-items:baseline; justify-content:space-between; gap:8px;
        }
        .feature-meta strong { font-size:1rem; }
        .feature-meta span { color:var(--lp-text-soft); font-size:0.85rem; }

        /* workflow */
        .workflow-section { padding:80px 32px; position:relative; z-index:3; border-top:1px solid var(--lp-border); }
        .workflow-shell { max-width:var(--lp-max); margin:0 auto; display:grid; gap:56px; }
        .workflow-head { text-align:center; display:flex; flex-direction:column; align-items:center; gap:14px; }
        .workflow-head h2 { margin:0; font-size:clamp(1.8rem,3vw,2.6rem); letter-spacing:-0.025em; line-height:1.12; }
        .workflow-head p { margin:0; color:var(--lp-text-soft); max-width:56ch; }
        .workflow-steps { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px; }
        .workflow-step {
          position:relative; padding:32px 28px 28px; border-radius:20px;
          border:1px solid var(--lp-border); background:var(--lp-card);
          overflow:hidden; box-shadow:0 6px 20px rgba(0,0,0,0.14);
        }
        .step-num-bg {
          position:absolute; top:-10px; right:-10px;
          font-size:8rem; font-weight:900; letter-spacing:-0.05em; line-height:1;
          color:rgba(var(--p-rgb),0.07); pointer-events:none; user-select:none;
        }
        [data-theme="light"] .step-num-bg { color:rgba(var(--p-rgb),0.1); }
        .step-badge {
          display:inline-flex; align-items:center; justify-content:center;
          width:36px; height:36px; border-radius:10px;
          background:linear-gradient(135deg, var(--primary), var(--secondary));
          color:#fff; font-weight:700; font-size:0.78rem; letter-spacing:0.04em;
          margin-bottom:16px; box-shadow:0 3px 10px rgba(var(--p-rgb),0.5);
        }
        .workflow-step h3 { margin:0 0 10px; font-size:1.2rem; position:relative; z-index:1; }
        .workflow-step p  { margin:0; color:var(--lp-text-soft); font-size:0.94rem; line-height:1.58; position:relative; z-index:1; }
        .workflow-visual { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .wv-card { padding:24px; border-radius:16px; background:var(--lp-card); border:1px solid var(--lp-border); display:flex; flex-direction:column; gap:14px; box-shadow:0 6px 18px rgba(0,0,0,0.14); }
        .wv-header { display:flex; align-items:center; gap:10px; }
        .wv-header h3 { margin:0; font-size:1.05rem; }
        .wv-chip { padding:4px 10px; border-radius:999px; background:rgba(var(--p-rgb),0.2); font-size:0.74rem; font-weight:600; }
        .wv-row { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--lp-border); font-size:0.9rem; color:var(--lp-text-soft); }
        .wv-row:last-child { border-bottom:none; padding-bottom:0; }
        .wv-row strong { color:var(--text-color); }
        .wv-sub p { margin:0; color:var(--lp-text-soft); font-size:0.92rem; line-height:1.58; }
        .wv-sub-desc { margin:0; color:var(--lp-text-soft); font-size:0.88rem; line-height:1.58; padding-top:4px; border-top:1px solid var(--lp-border); }
        .wv-notes { display:flex; flex-direction:column; gap:12px; }
        .wv-note-item { display:flex; align-items:flex-start; gap:10px; }
        .wv-note-avatar {
          flex:0 0 auto; width:28px; height:28px; border-radius:50%;
          background:rgba(var(--p-rgb),0.72); color:#fff;
          display:flex; align-items:center; justify-content:center;
          font-size:0.72rem; font-weight:700;
        }
        .wv-note-avatar-b { background:rgba(var(--s-rgb),0.72); }
        .wv-note-meta { font-size:0.72rem; color:var(--lp-text-soft); margin-bottom:3px; }
        .wv-note-body { font-size:0.84rem; line-height:1.48; }

        /* security */
        .security-section { position:relative; z-index:3; overflow:hidden; }
        .security-shell { display:grid; grid-template-columns:1fr 1fr; min-height:480px; }
        .security-left {
          background:linear-gradient(135deg, rgba(var(--s-rgb),0.92) 0%, rgba(var(--p-rgb),0.85) 60%, rgba(var(--a-rgb),0.75) 100%);
          padding:72px 64px; display:flex; flex-direction:column; gap:20px; justify-content:center;
        }
        .security-left h2 {
          margin:0; font-size:clamp(2rem,3vw,2.8rem); line-height:1.1; letter-spacing:-0.025em; color:#fff;
        }
        .security-left p { margin:0; color:rgba(255,255,255,0.78); max-width:42ch; line-height:1.65; }
        .security-actions { display:flex; gap:12px; flex-wrap:wrap; margin-top:4px; }
        .btn-ghost-light {
          display:inline-flex; align-items:center; gap:6px; padding:11px 22px;
          border-radius:999px; border:1px solid rgba(255,255,255,0.45); background:transparent;
          color:#fff; font-weight:600; font-size:0.92rem; cursor:pointer;
          transition:background 0.2s ease; text-decoration:none;
        }
        .btn-ghost-light:hover { background:rgba(255,255,255,0.15); }
        .security-right {
          background:var(--lp-card); border-left:1px solid var(--lp-border);
          padding:72px 64px; display:flex; flex-direction:column; gap:36px; justify-content:center;
        }
        [data-theme="light"] .security-right { background:rgba(247,247,242,0.96); }
        .security-item { display:flex; align-items:flex-start; gap:16px; }
        .security-check {
          flex:0 0 auto; width:32px; height:32px; border-radius:8px;
          background:linear-gradient(135deg, var(--primary), var(--secondary));
          display:inline-flex; align-items:center; justify-content:center;
          color:#fff; font-size:1rem; box-shadow:0 3px 10px rgba(var(--p-rgb),0.45); margin-top:2px;
        }
        .security-item h3 { margin:0 0 6px; font-size:1.08rem; }
        .security-item p  { margin:0; color:var(--lp-text-soft); font-size:0.92rem; line-height:1.55; }

        /* cta */
        .cta-section {
          position:relative; z-index:3; padding:100px 32px; text-align:center; overflow:hidden;
          background:linear-gradient(160deg, rgba(var(--s-rgb),0.28) 0%, rgba(var(--p-rgb),0.18) 40%, rgba(var(--a-rgb),0.22) 100%);
          border-top:1px solid rgba(var(--p-rgb),0.25); border-bottom:1px solid rgba(var(--p-rgb),0.25);
        }
        .landing-page--voxelized .cta-section {
          background:linear-gradient(160deg, rgba(var(--s-rgb),0.22) 0%, rgba(var(--p-rgb),0.12) 40%, rgba(var(--a-rgb),0.18) 100%);
        }
        [data-theme="light"] .cta-section {
          background:linear-gradient(160deg, rgba(var(--s-rgb),0.22) 0%, rgba(var(--p-rgb),0.14) 40%, rgba(var(--a-rgb),0.18) 100%);
        }
        [data-theme="light"] .landing-page--voxelized .cta-section {
          background:linear-gradient(160deg, rgba(var(--s-rgb),0.16) 0%, rgba(var(--p-rgb),0.1) 40%, rgba(var(--a-rgb),0.14) 100%);
        }
        .cta-glow-l, .cta-glow-r { position:absolute; border-radius:50%; filter:blur(100px); pointer-events:none; }
        .cta-glow-l { width:500px; height:400px; background:rgba(var(--p-rgb),0.3); top:-100px; left:-100px; }
        .cta-glow-r { width:400px; height:350px; background:rgba(var(--a-rgb),0.25); bottom:-80px; right:-80px; }
        .cta-inner {
          position:relative; z-index:2; max-width:680px; margin:0 auto;
          display:flex; flex-direction:column; align-items:center; gap:20px;
        }
        .cta-badge {
          display:inline-flex; align-items:center; padding:6px 16px; border-radius:999px;
          background:rgba(var(--p-rgb),0.22); border:1px solid rgba(var(--p-rgb),0.48);
          color:var(--primary); font-size:0.72rem; letter-spacing:0.14em; text-transform:uppercase;
          font-family:var(--font-mono); font-weight:600;
        }
        .cta-inner h2 { margin:0; font-size:clamp(2rem,4vw,3.2rem); line-height:1.12; letter-spacing:-0.025em; max-width:18ch; }
        .cta-inner p  { margin:0; color:var(--lp-text-soft); font-size:1.05rem; max-width:44ch; line-height:1.65; }
        .cta-actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; justify-content:center; margin-top:8px; }
        .btn-cta-primary {
          display:inline-flex; align-items:center; gap:8px; padding:14px 32px; border-radius:999px;
          background:linear-gradient(135deg, var(--accent), var(--primary), var(--secondary));
          color:#fff; font-weight:700; font-size:1rem; border:none; cursor:pointer;
          box-shadow:0 4px 28px rgba(var(--p-rgb),0.5);
          transition:box-shadow 0.22s ease,transform 0.18s ease; text-decoration:none;
        }
        .btn-cta-primary:hover { box-shadow:0 6px 36px rgba(var(--p-rgb),0.65); transform:translateY(-2px); }
        .btn-cta-ghost {
          display:inline-flex; align-items:center; gap:6px; padding:13px 26px; border-radius:999px;
          border:1px solid var(--lp-border); background:transparent; color:var(--text-color);
          font-weight:600; font-size:0.98rem; cursor:pointer; transition:background 0.2s ease; text-decoration:none;
        }
        .btn-cta-ghost:hover { background:rgba(var(--p-rgb),0.12); }

        /* footer */
        .landing-footer { position:relative; z-index:3; border-top:1px solid var(--lp-border); padding:64px 32px 0; }
        .footer-inner {
          max-width:var(--lp-max); margin:0 auto;
          display:grid; grid-template-columns:1.6fr 1fr 1fr 1fr; gap:40px;
          padding-bottom:48px; border-bottom:1px solid var(--lp-border);
        }
        .footer-logo { font-weight:700; font-size:1.3rem; letter-spacing:-0.03em; margin-bottom:10px; }
        .footer-brand-col p { margin:0 0 18px; color:var(--lp-text-soft); font-size:0.88rem; line-height:1.6; max-width:28ch; }
        .footer-social { display:flex; gap:10px; }
        .footer-social-link {
          width:36px; height:36px; border-radius:10px; border:1px solid var(--lp-border);
          background:rgba(var(--p-rgb),0.08); display:inline-flex; align-items:center; justify-content:center;
          font-size:1.1rem; color:var(--lp-text-soft); transition:color 0.2s ease,background 0.2s ease,transform 0.18s ease;
        }
        .footer-social-link:hover { color:var(--primary); background:rgba(var(--p-rgb),0.2); transform:translateY(-2px); }
        .footer-links-col { display:flex; flex-direction:column; gap:10px; }
        .footer-col-head {
          font-weight:700; font-size:0.8rem; letter-spacing:0.12em; text-transform:uppercase;
          color:var(--lp-text-soft); margin-bottom:4px; font-family:var(--font-mono);
        }
        .footer-links-col a { color:var(--lp-text-soft); font-size:0.9rem; transition:color 0.18s ease; }
        .footer-links-col a:hover { color:var(--primary); }
        .footer-bottom {
          max-width:var(--lp-max); margin:0 auto; padding:20px 0;
          display:flex; align-items:center; justify-content:center;
          color:var(--lp-text-soft); font-size:0.82rem;
        }

        /* responsive */
        @media (max-width:1100px) {
          .hero-demo { max-width:720px; }
          .security-left, .security-right { padding:56px 40px; }
          .footer-inner { grid-template-columns:1fr 1fr; gap:32px; }
        }
        @media (max-width:900px) {
          .platform-bento { grid-template-columns:1fr; }
          .bento-col { flex-direction:row; flex-wrap:wrap; }
          .bento-col .feature-card { flex:1 1 280px; }
          .presence-person { position:relative; min-width:0; }
          .presence-person--secondary { right:auto; bottom:auto; }
          .presence-thread { inset:12px 0; }
          .workflow-steps { grid-template-columns:1fr; }
          .security-shell { grid-template-columns:1fr; }
          .security-left { padding:56px 32px; }
          .security-right { padding:48px 32px; border-left:none; border-top:1px solid var(--lp-border); }
          .workflow-visual { grid-template-columns:1fr; }
        }
        @media (max-width:768px) {
          .landing-page { --lp-max:calc(100% - 32px); }
          .landing-spotlight { display:none; }
          .nav-inner { padding:10px 16px; }
          .nav-links { display:none; }
          .nav-actions { gap:6px; margin-left:auto; }
          .logo { font-size:1.18rem; }
          .theme-toggle { width:36px; height:36px; }
          .hero { padding:60px 20px 0; }
          .hero-title { font-size:clamp(2.6rem,10vw,3.4rem); }
          .hero-demo { margin-top:40px; max-width:100%; }
          .stats-inner { grid-template-columns:repeat(2,1fr); padding:24px 20px; gap:16px; }
          .testimonials-section { padding:60px 20px; }
          .testimonial-card { width:min(80vw,340px); }
          .platform-section, .workflow-section { padding:60px 20px; }
          .security-left, .security-right { padding:48px 24px; }
          .cta-section { padding:80px 20px; }
          .cta-inner h2 { font-size:1.9rem; }
          .landing-footer { padding:48px 20px 0; }
          .footer-inner { grid-template-columns:1fr 1fr; gap:28px; }
          .footer-brand-col { grid-column:1/-1; }
        }
        @media (max-width:480px) {
          .hero { padding:48px 16px 0; }
          .hero-title { font-size:clamp(2.1rem,12vw,2.8rem); }
          .stats-inner { grid-template-columns:1fr 1fr; padding:20px 16px; }
          .stat-item strong { font-size:1.45rem; }
          .feature-visual--presence { padding:16px; }
          .presence-orbit { display:grid; gap:10px; }
          .presence-thread { display:none; }
          .presence-pulse-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
          .platform-section, .workflow-section, .cta-section { padding:52px 16px; }
          .security-left { padding:40px 20px; }
          .security-right { padding:36px 20px; }
          .footer-inner { grid-template-columns:1fr; gap:24px; }
          .cta-inner h2 { font-size:1.68rem; }
          .cta-actions { flex-direction:column; align-items:stretch; }
          .btn-cta-primary, .btn-cta-ghost { justify-content:center; }
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-page * { animation:none !important; transition:none !important; }
        }
      `}</style>
    </div>
  );
}
