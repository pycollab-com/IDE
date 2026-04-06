import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiSearch } from "react-icons/fi";

export default function CommandPalette({
  open,
  onClose,
  title = "Quick Search",
  placeholder = "Type to search...",
  query = "",
  onQueryChange,
  items = [],
  emptyText = "No matching results.",
  footerHint = "Use arrow keys and Enter to select",
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, query, items.length]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeys = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(items.length - 1, 0)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === "Enter" && items.length > 0) {
        event.preventDefault();
        items[activeIndex]?.onSelect?.();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [open, items, activeIndex, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="commandk-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="commandk-modal"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <div className="commandk-searchbar">
              <FiSearch size={16} />
              <input
                className="commandk-input"
                value={query}
                onChange={(event) => onQueryChange?.(event.target.value)}
                placeholder={placeholder}
                autoFocus
              />
              <span className="commandk-esc">Esc</span>
            </div>
            <div className="commandk-results" role="listbox" aria-label={title}>
              {items.length === 0 && <div className="commandk-empty">{emptyText}</div>}
              {items.map((item, index) => (
                <button
                  key={item.key}
                  className={`commandk-item ${index === activeIndex ? "active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    item.onSelect?.();
                    onClose();
                  }}
                  type="button"
                >
                  <div className="commandk-item-main">
                    {item.icon && <span className="commandk-item-icon">{item.icon}</span>}
                    <div className="commandk-item-text">
                      <div className="commandk-item-title">{item.title}</div>
                      {item.subtitle && <div className="commandk-item-subtitle">{item.subtitle}</div>}
                    </div>
                  </div>
                  {item.badge && <span className="chip chip-muted">{item.badge}</span>}
                </button>
              ))}
            </div>
            <div className="commandk-footer">{footerHint}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
