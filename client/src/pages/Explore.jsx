import { useState, useEffect, useMemo } from "react";
import api from "../api";
import { FiSearch, FiUser, FiCode, FiArrowRight } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import VerifiedBadge from "../components/VerifiedBadge";
import CommandPalette from "../components/CommandPalette";
import { toProfilePath } from "../utils/profileLinks";
import { toProjectPath } from "../projects/projectPaths";
import { resolveHostedAssetUrl } from "../utils/hostedAssets";


export default function Explore() {
    const [searchTerm, setSearchTerm] = useState("");
    const [users, setUsers] = useState([]);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [quickOpen, setQuickOpen] = useState(false);
    const navigate = useNavigate();

    const quickItems = useMemo(() => {
        const userItems = users.slice(0, 8).map((user) => ({
            key: `user-${user.id}`,
            title: user.display_name,
            subtitle: `@${user.username}`,
            badge: "User",
            icon: <FiUser size={16} />,
            onSelect: () => {
                const path = toProfilePath(user);
                if (path) navigate(path);
            },
        }));
        const projectItems = projects.slice(0, 20).map((project) => ({
            key: `project-${project.id}`,
            title: project.name,
            subtitle: project.description || `By ${project.owner_name || `User #${project.owner_id}`}`,
            badge: "Project",
            icon: <FiCode size={16} />,
            onSelect: () => navigate(toProjectPath(project)),
        }));
        return [...userItems, ...projectItems].slice(0, 24);
    }, [users, projects, navigate]);

    useEffect(() => {
        if (!searchTerm) {
            setUsers([]);
            loadAllProjects();
        } else {
            const timer = setTimeout(() => {
                searchAll(searchTerm);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [searchTerm]);

    useEffect(() => {
        const handleQuickSearchShortcut = (event) => {
            const isQuickSearch = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k";
            if (!isQuickSearch) return;
            if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) return;
            event.preventDefault();
            setQuickOpen(true);
        };

        window.addEventListener("keydown", handleQuickSearchShortcut);
        return () => window.removeEventListener("keydown", handleQuickSearchShortcut);
    }, []);

    const loadAllProjects = async () => {
        setLoading(true);
        try {
            const res = await api.get("/projects/explore/all");
            setProjects(res.data);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const searchAll = async (q) => {
        setLoading(true);
        try {
            const [uRes, pRes] = await Promise.all([
                api.get(`/users/search?q=${encodeURIComponent(q)}`),
                api.get(`/projects/search?q=${encodeURIComponent(q)}`)
            ]);
            setUsers(uRes.data);
            setProjects(pRes.data);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    return (
        <div className="container page-shell explore-page">
            <div className="page-header explore-header">
                <h1 className="page-title">Explore</h1>
                <p className="page-subtitle">Discover projects and collaborators across the workspace.</p>
            </div>

            <div className="explore-grid">
                <div className="panel explore-panel">
                    <div className="panel-header">
                        <div className="panel-title">Search</div>
                        {loading && <span className="chip chip-muted">Loading</span>}
                    </div>
                    <div className="panel-body">
                        <div className="input-wrap">
                            <FiSearch className="input-icon" />
                            <input
                                className="input search-input"
                                placeholder="Search users and projects..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="explore-hint">
                            Use keywords to filter by username, project name, or description.
                        </div>
                    </div>
                </div>

                <div className="panel explore-results">
                    <div className="panel-header">
                        <div className="panel-title">{searchTerm ? "Results" : "Trending"}</div>
                        <div className="chip chip-muted">{projects.length} projects</div>
                    </div>
                    <div className="panel-body">
                        {users.length > 0 && (
                            <div className="explore-section">
                                <div className="section-title muted">Users</div>
                                <div className="results-grid">
                                    {users.map(u => (
                                        <motion.div
                                            key={u.id}
                                            className="panel user-card"
                                            onClick={() => {
                                                const path = toProfilePath(u);
                                                if (path) navigate(path);
                                            }}
                                            whileHover={{ scale: 1.02 }}
                                        >
                                            <div className="user-avatar-lg">
                                                {u.profile_picture_path ? (
                                                    <img src={resolveHostedAssetUrl(u.profile_picture_path)} alt={u.display_name} />
                                                ) : (
                                                    <div className="user-avatar-fallback">
                                                        <FiUser />
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ overflow: 'hidden' }}>
                                                <div className="user-name">
                                                    {u.display_name}
                                                    {u.is_admin && <VerifiedBadge size={14} />}
                                                </div>
                                                <div className="muted" style={{ fontSize: 13 }}>@{u.username}</div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="explore-section">
                            <div className="section-title muted">{searchTerm ? "Projects" : "Trending Projects"}</div>
                            <div className="results-grid">
                                {projects.map((p, i) => (
                                    <motion.div
                                        key={p.id}
                                        className="panel project-card"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.05 }}
                                    >
                                        <div>
                                            <div className="project-row-main">
                                                <div className="project-name">{p.name}</div>
                                                <FiCode className="muted" size={18} />
                                            </div>
                                            <div className="muted project-subtitle">
                                                {p.description || "No description provided."}
                                            </div>
                                            <div className="muted" style={{ fontSize: 13 }}>
                                                By {p.owner_name || `User #${p.owner_id}`}
                                            </div>
                                        </div>
                                        <div style={{ marginTop: "var(--space-4)" }}>
                                            <button className="btn-secondary w-full" onClick={() => navigate(toProjectPath(p))}>
                                                View Code <FiArrowRight />
                                            </button>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <CommandPalette
                open={quickOpen}
                onClose={() => setQuickOpen(false)}
                title="Search Workspace"
                placeholder="Search users and projects..."
                query={searchTerm}
                onQueryChange={setSearchTerm}
                items={quickItems}
                emptyText={searchTerm ? "No users or projects found." : "Start typing to search."}
                footerHint="Workspace search • Cmd/Ctrl+K"
            />
        </div>
    );
}
