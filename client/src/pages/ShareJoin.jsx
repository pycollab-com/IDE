import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";
import { motion } from "framer-motion";
import { toProjectPath } from "../projects/projectPaths";

export default function ShareJoin({ user }) {
  const { code } = useParams();
  const normalizedCode = (code || "").trim().toLowerCase();
  const isValidCode = /^[0-9a-z]{6}$/.test(normalizedCode);
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/share/${normalizedCode}`)}`, { replace: true });
      return;
    }

    let cancelled = false;
    const join = async () => {
      if (!isValidCode) {
        if (!cancelled) {
          setError("Share code must be 6 lowercase letters or numbers.");
        }
        return;
      }
      try {
        const res = await api.post(`/projects/access/${normalizedCode}`);
        if (!cancelled) {
          navigate(toProjectPath(res.data), { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.detail || "Invalid or expired session code.");
        }
      }
    };
    join();
    return () => { cancelled = true; };
  }, [user, normalizedCode, isValidCode, navigate]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      {error ? (
        <>
          <h2 style={{ color: "var(--danger, #e74c3c)" }}>Unable to Join</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            Go to Dashboard
          </button>
        </>
      ) : (
        <>
          <h2>Joining session…</h2>
          <p>Connecting you to the project.</p>
        </>
      )}
    </motion.div>
  );
}
