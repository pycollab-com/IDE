import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { FiHome, FiAlertTriangle } from "react-icons/fi";

export default function NotFound() {
  return (
    <div className="flex-center page-shell not-found">
      <div className="panel not-found-card">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        style={{ color: "var(--danger)", marginBottom: "var(--space-4)" }}
      >
        <FiAlertTriangle size={64} />
      </motion.div>
      
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="page-title"
        style={{ fontSize: "3.5rem", margin: 0, lineHeight: 1 }}
      >
        404
      </motion.h1>
      
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="muted"
        style={{ fontSize: "1.1rem", margin: "var(--space-4) 0 var(--space-6)", maxWidth: 400 }}
      >
        Did you forget a semicolon somewhere… oh wait, this is Python.
      </motion.p>
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        <Link to="/" className="btn" style={{ textDecoration: 'none' }}>
          <FiHome style={{ marginRight: 8 }} /> Return Home
        </Link>
      </motion.div>
      </div>
    </div>
  );
}
