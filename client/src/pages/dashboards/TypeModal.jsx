import { AnimatePresence, motion } from "framer-motion";
import { FiCode, FiX, FiZap } from "react-icons/fi";
import { useState } from "react";

function ProjectTypePicker({ onSelect, creating, PROJECT_TYPE_NORMAL, PROJECT_TYPE_PYBRICKS }) {
  const [hovered, setHovered] = useState(null);
  const items = [
    {
      type: PROJECT_TYPE_NORMAL,
      icon: <FiCode size={36} />,
      label: "Normal",
      desc: "Browser Python runtime",
      cls: "",
    },
    {
      type: PROJECT_TYPE_PYBRICKS,
      icon: <FiZap size={36} />,
      label: "PyBricks",
      desc: "Compile & hub download",
      cls: "pb",
    },
  ];

  return (
    <div className="tm-v4-split">
      {items.map((item) => (
        <motion.button
          key={item.type}
          className={`tm-v4-half ${item.cls}`}
          onClick={() => onSelect(item.type)}
          disabled={creating}
          onHoverStart={() => setHovered(item.type)}
          onHoverEnd={() => setHovered(null)}
          animate={{ flex: hovered === item.type ? 1.4 : hovered ? 0.6 : 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
        >
          <div className="tm-v4-icon">{item.icon}</div>
          <div className="tm-v4-label">{item.label}</div>
          <div className="tm-v4-desc">{item.desc}</div>
        </motion.button>
      ))}
    </div>
  );
}

export default function TypeModal({
  open,
  name,
  creating,
  onClose,
  onSelect,
  PROJECT_TYPE_NORMAL,
  PROJECT_TYPE_PYBRICKS,
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !creating && onClose()}
        >
          <motion.div
            className="panel modal-card project-type-modal-card tm-variant-4"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="project-type-modal-header">
              <div>
                <div className="panel-title">Choose Project Type</div>
                <div className="muted project-type-modal-subtitle">
                  Create &ldquo;{name.trim()}&rdquo; as a normal or PyBricks project.
                </div>
              </div>
              <button className="btn-ghost modal-close" onClick={onClose} disabled={creating} title="Close">
                <FiX size={18} />
              </button>
            </div>
            <ProjectTypePicker
              onSelect={onSelect}
              creating={creating}
              PROJECT_TYPE_NORMAL={PROJECT_TYPE_NORMAL}
              PROJECT_TYPE_PYBRICKS={PROJECT_TYPE_PYBRICKS}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
