import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { FiHome, FiCode } from "react-icons/fi";
import { useState, useEffect } from "react";

export default function NotFound4() {
  const [cursorVisible, setCursorVisible] = useState(true);

  // Cursor blink
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible(v => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ 
      minHeight: "100vh",
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr",
      position: "relative",
      zIndex: 1
    }}>
      {/* Gradient bridge between sides */}
      <div style={{
        position: "absolute",
        top: 0,
        left: "58%",
        width: "20%",
        height: "100%",
        background: "linear-gradient(90deg, transparent 0%, rgba(137, 152, 120, 0.03) 50%, transparent 100%)",
        pointerEvents: "none",
        zIndex: 1
      }} />

      {/* Left side - Accent panel */}
      <motion.div
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        style={{
          background: "linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)",
          padding: "clamp(var(--space-6), 8vw, var(--space-7))",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          color: "#121113",
          position: "relative",
          overflow: "hidden",
          zIndex: 2
        }}
      >
        {/* Decorative elements */}
        <div style={{
          position: "absolute",
          top: -50,
          right: -50,
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: "rgba(18, 17, 19, 0.08)",
          pointerEvents: "none"
        }} />
        <div style={{
          position: "absolute",
          bottom: -30,
          left: -30,
          width: 150,
          height: 150,
          borderRadius: "var(--radius)",
          background: "rgba(247, 247, 242, 0.12)",
          pointerEvents: "none",
          transform: "rotate(12deg)"
        }} />

        {/* Faint code bleeding in from right */}
        <div style={{
          position: "absolute",
          right: -10,
          top: "30%",
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          opacity: 0.08,
          userSelect: "none",
          pointerEvents: "none"
        }}>
          return home()
        </div>

        <div style={{ position: "relative", zIndex: 1, maxWidth: 580 }}>
          {/* 404 */}
          <div 
            style={{ 
              fontSize: "clamp(6rem, 12vw, 9.5rem)", 
              fontWeight: 800,
              lineHeight: 0.9,
              letterSpacing: "-0.05em",
              marginBottom: "var(--space-6)"
            }}
          >
            404
          </div>

          {/* Hero joke with controlled line breaks */}
          <h1 style={{ 
            fontSize: "clamp(1.85rem, 4.2vw, 2.75rem)", 
            fontWeight: 700,
            lineHeight: 1.2,
            marginBottom: "var(--space-5)"
          }}>
            Did you forget a semicolon somewhere…?<br />
            Oh wait — this is Python.
          </h1>

          {/* Explanation */}
          <p style={{ 
            fontSize: "1.1rem", 
            lineHeight: 1.7,
            opacity: 0.85,
            marginBottom: "var(--space-6)"
          }}>
            This page doesn't exist. Let's get you back home.
          </p>

          {/* CTA */}
          <div>
            <Link 
              to="/" 
              className="btn"
              style={{ 
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--space-2)",
                padding: "var(--space-4) var(--space-7)",
                fontSize: "1.05rem",
                fontWeight: 600,
                borderRadius: "var(--radius)",
                background: "#121113",
                color: "#f7f7f2",
                border: "1px solid rgba(18, 17, 19, 0.3)",
                textDecoration: "none",
                transition: "all 0.2s ease",
                boxShadow: "0 4px 12px rgba(18, 17, 19, 0.25)",
                minWidth: "200px"
              }}
            >
              <FiHome size={20} /> Go Home
            </Link>
          </div>
        </div>
      </motion.div>

      {/* Right side - Decorative code motif */}
      <motion.div
        initial={{ x: 100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        style={{
          padding: "var(--space-7)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "var(--bg-color)",
          position: "relative",
          overflow: "hidden",
          zIndex: 2
        }}
      >
        {/* Glow behind code */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "80%",
          height: "60%",
          background: "radial-gradient(circle, rgba(137, 152, 120, 0.08) 0%, transparent 70%)",
          filter: "blur(40px)",
          pointerEvents: "none"
        }} />

        {/* Code snippet - more visible */}
        <div style={{
          width: "100%",
          maxWidth: 420,
          fontFamily: "var(--font-mono)",
          fontSize: "1rem",
          lineHeight: 1.9,
          color: "var(--text-color)",
          opacity: 0.65,
          userSelect: "none",
          position: "relative",
          zIndex: 1
        }}>
          <div style={{ marginBottom: "var(--space-3)" }}>
            <span style={{ color: "var(--primary)", fontWeight: 600 }}>class</span> PageNotFound:
          </div>
          <div style={{ paddingLeft: "var(--space-5)", marginBottom: "var(--space-3)" }}>
            <span style={{ color: "var(--primary)", fontWeight: 600 }}>def</span> __init__(self):
          </div>
          <div style={{ paddingLeft: "calc(var(--space-5) * 2)", marginBottom: "var(--space-3)" }}>
            self.status = <span style={{ color: "var(--accent)", fontWeight: 600 }}>404</span>
          </div>
          <div style={{ paddingLeft: "calc(var(--space-5) * 2)", marginBottom: "var(--space-3)" }}>
            self.message = <span style={{ color: "var(--accent)", fontWeight: 600 }}>"..."</span>
          </div>
          <div style={{ paddingLeft: "var(--space-5)", marginBottom: "var(--space-5)" }}>
            <span style={{ color: "var(--primary)", fontWeight: 600 }}>def</span> redirect():
          </div>
          <div style={{ paddingLeft: "calc(var(--space-5) * 2)" }}>
            <span style={{ color: "var(--primary)", fontWeight: 600 }}>return</span> home()
            <span style={{ 
              opacity: cursorVisible ? 1 : 0,
              marginLeft: 2,
              borderLeft: "2px solid var(--primary)"
            }}>
              &nbsp;
            </span>
          </div>
        </div>

        {/* Floating icon */}
        <motion.div
          animate={{
            y: [0, -8, 0],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          style={{
            position: "absolute",
            bottom: "var(--space-7)",
            right: "var(--space-7)",
            width: 72,
            height: 72,
            borderRadius: "var(--radius)",
            background: "rgba(137, 152, 120, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--primary)",
            opacity: 0.7,
            boxShadow: "0 4px 16px rgba(137, 152, 120, 0.15)"
          }}
        >
          <FiCode size={32} />
        </motion.div>
      </motion.div>

      {/* Mobile fallback - stack vertically on small screens */}
      <style>{`
        @media (max-width: 900px) {
          .not-found-4 {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
      <div className="not-found-4" style={{ display: "none" }} />
    </div>
  );
}
