import { FiMail, FiShield } from "react-icons/fi";
import { motion } from "framer-motion";

export default function BannedPage({ user }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "clamp(var(--space-5), 6vw, var(--space-8))",
        position: "relative",
        zIndex: 1,
      }}
    >
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="panel"
        style={{
          width: "min(640px, 100%)",
          padding: "clamp(var(--space-6), 5vw, var(--space-8))",
          border: "1px solid color-mix(in srgb, var(--danger) 28%, transparent)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.22)",
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, #4f1111 8%), var(--panel))",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            display: "grid",
            placeItems: "center",
            marginBottom: "var(--space-5)",
            background: "color-mix(in srgb, var(--danger) 18%, transparent)",
            color: "var(--danger)",
          }}
        >
          <FiShield size={24} />
        </div>

        <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Account restricted
        </div>
        <h1 style={{ margin: "var(--space-3) 0", fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1 }}>
          This account has been banned
        </h1>
        <p style={{ margin: 0, color: "var(--text-muted)", lineHeight: 1.7, fontSize: "1.02rem" }}>
          @{user?.username || "user"} no longer has access to PyCollab. If you believe this was applied in error,
          contact support@pycollab.com to appeal.
        </p>

        <div
          style={{
            marginTop: "var(--space-6)",
            padding: "var(--space-4) var(--space-5)",
            borderRadius: "var(--radius)",
            border: "1px solid color-mix(in srgb, var(--text-color) 12%, transparent)",
            background: "color-mix(in srgb, var(--bg-color) 72%, transparent)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
          }}
        >
          <FiMail size={18} />
          <a href="mailto:support@pycollab.com" style={{ color: "inherit", textDecoration: "none", fontWeight: 600 }}>
            support@pycollab.com
          </a>
        </div>
      </motion.section>
    </div>
  );
}
