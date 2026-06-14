import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiChevronDown, FiChevronRight, FiFile, FiSearch, FiX } from "react-icons/fi";

const SEARCH_RESULT_LIMIT = 500;

const buildMatches = (files, query, caseSensitive) => {
  if (!Array.isArray(files)) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];

  const groups = [];
  let total = 0;

  for (const file of files) {
    if (total >= SEARCH_RESULT_LIMIT) break;
    const content = typeof file.content === "string" ? file.content : "";
    const lines = content.split("\n");
    const matches = [];
    let offset = 0;

    lines.forEach((line, lineIndex) => {
      if (total >= SEARCH_RESULT_LIMIT) return;
      const haystack = caseSensitive ? line : line.toLowerCase();
      let from = 0;

      while (from <= haystack.length && total < SEARCH_RESULT_LIMIT) {
        const column = haystack.indexOf(needle, from);
        if (column === -1) break;
        matches.push({
          key: `${file.id}-${lineIndex}-${column}`,
          fileId: file.id,
          fileName: file.name,
          line: lineIndex + 1,
          column: column + 1,
          from: offset + column,
          to: offset + column + query.length,
          before: line.slice(0, column),
          match: line.slice(column, column + query.length),
          after: line.slice(column + query.length),
        });
        total += 1;
        from = column + Math.max(query.length, 1);
      }
      offset += line.length + 1;
    });

    if (matches.length) groups.push({ file, matches });
  }

  return groups;
};

export default function ProjectSearch({ open, files, onClose, onSelect }) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState({});
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const activeResultRef = useRef(null);

  const groups = useMemo(
    () => buildMatches(files, query.trim(), caseSensitive),
    [caseSensitive, files, query]
  );
  const results = useMemo(() => groups.flatMap((group) => group.matches), [groups]);
  const visibleResults = useMemo(
    () => groups.flatMap((group) => (collapsedFiles[group.file.id] ? [] : group.matches)),
    [collapsedFiles, groups]
  );
  const totalMatches = results.length;
  const reachedLimit = totalMatches === SEARCH_RESULT_LIMIT;

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    setCollapsedFiles({});
    requestAnimationFrame(() => inputRef.current?.select());
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, caseSensitive, collapsedFiles]);

  useEffect(() => {
    activeResultRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" && visibleResults.length) {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % visibleResults.length);
        return;
      }
      if (event.key === "ArrowUp" && visibleResults.length) {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + visibleResults.length) % visibleResults.length);
        return;
      }
      if (event.key === "Enter" && visibleResults[activeIndex]) {
        event.preventDefault();
        onSelect(visibleResults[activeIndex]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, onClose, onSelect, open, visibleResults]);

  let resultIndex = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="project-search"
          role="dialog"
          aria-modal="false"
          aria-label="Search project"
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 18 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <div className="project-search-head">
            <div>
              <div className="project-search-kicker">Project search</div>
              <h2>Find in every file</h2>
            </div>
            <button className="project-search-close" type="button" onClick={onClose} aria-label="Close search">
              <FiX size={17} />
            </button>
          </div>

          <div className="project-search-input-wrap">
            <FiSearch size={16} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search code, names, strings..."
              aria-label="Search project files"
            />
            <button
              className={`project-search-case ${caseSensitive ? "active" : ""}`}
              type="button"
              onClick={() => setCaseSensitive((value) => !value)}
              aria-pressed={caseSensitive}
              title="Match case"
            >
              Aa
            </button>
          </div>

          <div className="project-search-summary" aria-live="polite">
            {query.trim()
              ? `${totalMatches}${reachedLimit ? "+" : ""} match${totalMatches === 1 ? "" : "es"} in ${groups.length} file${groups.length === 1 ? "" : "s"}`
              : `${files.length} project file${files.length === 1 ? "" : "s"} ready to search`}
            <span>↑↓ navigate · Enter open</span>
          </div>

          <div className="project-search-results">
            {!query.trim() && (
              <div className="project-search-empty">
                <FiSearch size={20} />
                <strong>Search the whole project</strong>
                <span>Results include file paths, line numbers, and the surrounding code.</span>
              </div>
            )}
            {query.trim() && groups.length === 0 && (
              <div className="project-search-empty">
                <strong>No matches</strong>
                <span>Try a shorter term or change case matching.</span>
              </div>
            )}
            {groups.map((group) => {
              const collapsed = Boolean(collapsedFiles[group.file.id]);
              return (
                <section className="project-search-group" key={group.file.id}>
                  <button
                    className="project-search-file"
                    type="button"
                    onClick={() =>
                      setCollapsedFiles((current) => ({
                        ...current,
                        [group.file.id]: !current[group.file.id],
                      }))
                    }
                  >
                    {collapsed ? <FiChevronRight size={14} /> : <FiChevronDown size={14} />}
                    <FiFile size={14} />
                    <span>{group.file.name}</span>
                    <b>{group.matches.length}</b>
                  </button>
                  {!collapsed &&
                    group.matches.map((result) => {
                      resultIndex += 1;
                      const index = resultIndex;
                      const active = index === activeIndex;
                      return (
                        <button
                          ref={active ? activeResultRef : null}
                          className={`project-search-result ${active ? "active" : ""}`}
                          type="button"
                          key={result.key}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => onSelect(result)}
                        >
                          <span className="project-search-line">{result.line}</span>
                          <code>
                            {result.before}
                            <mark>{result.match}</mark>
                            {result.after}
                          </code>
                        </button>
                      );
                    })}
                </section>
              );
            })}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
