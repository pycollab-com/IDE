import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import {
    FiTrash2, FiCode, FiUser, FiUsers, FiFolder, FiChevronDown, FiChevronUp,
    FiEdit2, FiX, FiCheck, FiUserCheck, FiUserPlus, FiPlusCircle, FiShield,
    FiSlash, FiActivity, FiMessageSquare, FiFileText, FiRefreshCw, FiSearch,
    FiGlobe, FiBox, FiTrendingUp, FiCopy, FiAlertCircle, FiBarChart2,
    FiLock, FiDownload, FiEye, FiClock,
} from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import VerifiedBadge from "../components/VerifiedBadge";
import { toProjectPath } from "../projects/projectPaths";


const formatDate = (isoString) => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
        + " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

const formatNumber = (value) => (value ?? 0).toLocaleString();

const extractErrorDetail = (error, fallback) => (
    error?.response?.data?.detail
    || error?.response?.data?.message
    || error?.message
    || fallback
);

function StatCard({ icon, label, value, foot, accent }) {
    return (
        <div className="admin-stat-card">
            <div className="admin-stat-top">
                <span className={`admin-stat-label ${accent ? `accent-${accent}` : ""}`}>
                    <span className="admin-stat-ic">{icon}</span>{label}
                </span>
                {foot != null && <span className="admin-stat-foot">{foot}</span>}
            </div>
            <div className="admin-stat-value">{formatNumber(value)}</div>
        </div>
    );
}

function AdminModal({ title, onClose, children, wide }) {
    return (
        <div className="modal-overlay" onMouseDown={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 8 }}
                transition={{ duration: 0.16 }}
                className={`panel modal-card admin-modal ${wide ? "wide" : ""}`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="admin-modal-head">
                    <h2>{title}</h2>
                    <button className="btn-ghost" onClick={onClose} title="Close"><FiX size={20} /></button>
                </div>
                {children}
            </motion.div>
        </div>
    );
}

export default function AdminPage({ user }) {
    const [users, setUsers] = useState([]);
    const [projects, setProjects] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");

    const [expandedUserId, setExpandedUserId] = useState(null);
    const [editingUser, setEditingUser] = useState(null);
    const [userSearch, setUserSearch] = useState("");
    const [userSort, setUserSort] = useState("id-desc");
    const [userFilter, setUserFilter] = useState("all");

    const [projectSearch, setProjectSearch] = useState("");
    const [projectSort, setProjectSort] = useState("id-desc");
    const [projectFilter, setProjectFilter] = useState("all");

    const [forceProjectUser, setForceProjectUser] = useState(null);
    const [forceFollowUser, setForceFollowUser] = useState(null);
    const [inspectProject, setInspectProject] = useState(null);

    const [toasts, setToasts] = useState([]);
    const searchRef = useRef(null);
    const navigate = useNavigate();

    const pushToast = useCallback((message, type = "info") => {
        const id = Date.now() + Math.random();
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
    }, []);

    const dismissToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    useEffect(() => {
        const handleSearchShortcut = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener("keydown", handleSearchShortcut);
        return () => window.removeEventListener("keydown", handleSearchShortcut);
    }, []);

    const loadData = useCallback(async ({ silent } = {}) => {
        if (silent) setRefreshing(true);
        try {
            const [uRes, pRes, sRes] = await Promise.all([
                api.get("/admin/api/users"),
                api.get("/admin/api/projects"),
                api.get("/admin/api/stats"),
            ]);
            setUsers(uRes.data);
            setProjects(pRes.data);
            setStats(sRes.data);
        } catch (e) {
            if (e?.response?.status === 401 || e?.response?.status === 403) {
                navigate("/");
                return;
            }
            pushToast(extractErrorDetail(e, "Failed to load admin data"), "error");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [navigate, pushToast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const deleteUser = async (targetUser) => {
        if (!confirm(`Delete ${targetUser.display_name} (@${targetUser.username})? This permanently removes their account and all their projects.`)) return;
        try {
            await api.delete(`/admin/api/users/${targetUser.id}`);
            pushToast(`Deleted @${targetUser.username}`, "success");
            await loadData({ silent: true });
        } catch (e) {
            pushToast(extractErrorDetail(e, "Failed to delete user"), "error");
        }
    };

    const deleteProject = async (project) => {
        if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
        try {
            await api.delete(`/admin/api/projects/${project.id}`);
            pushToast(`Deleted project "${project.name}"`, "success");
            await loadData({ silent: true });
        } catch (e) {
            pushToast(extractErrorDetail(e, "Failed to delete project"), "error");
        }
    };

    const setBanState = async (targetUser, nextBanned) => {
        const action = nextBanned ? "ban" : "unban";
        const promptText = nextBanned
            ? `Ban @${targetUser.username}? This locks the account, hides the profile, and makes their projects inaccessible without deleting data.`
            : `Unban @${targetUser.username}?`;
        if (!confirm(promptText)) return;
        try {
            const res = await api.post(`/admin/api/users/${targetUser.id}/${action}`);
            setUsers((prev) => prev.map((entry) => (entry.id === targetUser.id ? res.data : entry)));
            pushToast(nextBanned ? `Banned @${targetUser.username}` : `Unbanned @${targetUser.username}`, "success");
            await loadData({ silent: true });
        } catch (e) {
            pushToast(extractErrorDetail(e, `Failed to ${action} user`), "error");
        }
    };

    const setAdminState = async (targetUser, nextAdmin) => {
        const verb = nextAdmin ? "Grant admin to" : "Revoke admin from";
        if (!confirm(`${verb} @${targetUser.username}?${nextAdmin ? " They will gain full access to this dashboard." : ""}`)) return;
        try {
            const res = await api.patch(`/admin/api/users/${targetUser.id}`, { is_admin: nextAdmin });
            setUsers((prev) => prev.map((entry) => (entry.id === targetUser.id ? res.data : entry)));
            pushToast(nextAdmin ? `@${targetUser.username} is now an admin` : `Revoked admin from @${targetUser.username}`, "success");
            await loadData({ silent: true });
        } catch (e) {
            pushToast(extractErrorDetail(e, "Failed to update admin status"), "error");
        }
    };

    const toggleProjectVisibility = async (project) => {
        try {
            const res = await api.patch(`/projects/${project.id}/visibility`);
            setProjects((prev) => prev.map((p) => (p.id === project.id ? res.data : p)));
            if (inspectProject?.id === project.id) setInspectProject(res.data);
            pushToast(res.data.is_public ? `"${res.data.name}" is now public` : `"${res.data.name}" is now private`, "success");
            await loadData({ silent: true });
        } catch (e) {
            pushToast(extractErrorDetail(e, "Failed to change visibility"), "error");
        }
    };

    const exportCsv = (rows, columns, filename) => {
        const escape = (value) => {
            const text = value == null ? "" : String(value);
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const header = columns.map((c) => escape(c.label)).join(",");
        const body = rows.map((row) => columns.map((c) => escape(c.value(row))).join(",")).join("\n");
        const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        pushToast(`Exported ${rows.length} rows`, "success");
    };

    const exportUsers = () => exportCsv(filteredAndSortedUsers, [
        { label: "id", value: (u) => u.id },
        { label: "username", value: (u) => u.username },
        { label: "display_name", value: (u) => u.display_name },
        { label: "role", value: (u) => (u.is_admin ? "admin" : "member") },
        { label: "banned", value: (u) => (u.is_banned ? "yes" : "no") },
        { label: "projects", value: (u) => projectCountByOwner.get(u.id) || 0 },
        { label: "created_at", value: (u) => u.created_at },
    ], `pycollab-users-${new Date().toISOString().slice(0, 10)}.csv`);

    const exportProjects = () => exportCsv(filteredAndSortedProjects, [
        { label: "id", value: (p) => p.id },
        { label: "public_id", value: (p) => p.public_id },
        { label: "name", value: (p) => p.name },
        { label: "owner", value: (p) => p.owner_name },
        { label: "owner_id", value: (p) => p.owner_id },
        { label: "type", value: (p) => p.project_type },
        { label: "files", value: (p) => p.files?.length || 0 },
        { label: "public", value: (p) => (p.is_public ? "yes" : "no") },
    ], `pycollab-projects-${new Date().toISOString().slice(0, 10)}.csv`);

    const submitForceFollow = async (followerId, followedId) => {
        try {
            const res = await api.post("/admin/api/force/follow", null, { params: { follower_id: followerId, followed_id: followedId } });
            pushToast(res.data?.status === "already following" ? "Already following" : "Follow forced", "success");
            setForceFollowUser(null);
            await loadData({ silent: true });
        } catch (e) {
            pushToast(extractErrorDetail(e, "Failed to force follow"), "error");
        }
    };

    const submitForceProject = async (userId, payload) => {
        try {
            const res = await api.post("/admin/api/force/project", payload, { params: { user_id: userId } });
            setProjects((prev) => [...prev, res.data]);
            pushToast(`Created project "${res.data.name}" (#${res.data.id})`, "success");
            setForceProjectUser(null);
            await loadData({ silent: true });
        } catch (e) {
            pushToast(extractErrorDetail(e, "Failed to create project"), "error");
        }
    };

    const impersonateUser = async (userToImpersonate) => {
        if (!confirm(`Impersonate @${userToImpersonate.username}? You'll be logged in as them until you stop impersonating.`)) return;
        try {
            const res = await api.post(`/admin/api/impersonate/${userToImpersonate.id}`);
            if (!localStorage.getItem("admin_token_backup")) {
                localStorage.setItem("admin_token_backup", localStorage.getItem("token"));
            }
            localStorage.setItem("impersonator_token", "1");
            localStorage.setItem("token", res.data.access_token);
            window.location.href = "/";
        } catch (e) {
            pushToast(extractErrorDetail(e, "Failed to impersonate user"), "error");
        }
    };

    const copyToClipboard = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            pushToast(`Copied ${label}`, "success");
        } catch {
            pushToast("Copy failed", "error");
        }
    };

    const saveUser = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                username: editingUser.username,
                display_name: editingUser.display_name,
                is_banned: Boolean(editingUser.is_banned),
                is_admin: Boolean(editingUser.is_admin),
            };
            if (editingUser.password) payload.password = editingUser.password;
            const res = await api.patch(`/admin/api/users/${editingUser.id}`, payload);
            setUsers(users.map((u) => (u.id === editingUser.id ? res.data : u)));
            setEditingUser(null);
            pushToast(`Updated @${res.data.username}`, "success");
        } catch (err) {
            pushToast(extractErrorDetail(err, "Failed to update user"), "error");
        }
    };

    const projectCountByOwner = useMemo(() => {
        const counts = new Map();
        projects.forEach((p) => counts.set(p.owner_id, (counts.get(p.owner_id) || 0) + 1));
        return counts;
    }, [projects]);

    const recentSignups = useMemo(
        () => [...users].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 6),
        [users],
    );

    const recentProjects = useMemo(() => [...projects].sort((a, b) => b.id - a.id).slice(0, 6), [projects]);

    const filteredAndSortedUsers = useMemo(() => {
        const searchTerm = userSearch.trim().toLowerCase();
        const filtered = users.filter((u) => {
            if (userFilter === "admins" && !u.is_admin) return false;
            if (userFilter === "banned" && !u.is_banned) return false;
            if (userFilter === "members" && (u.is_admin || u.is_banned)) return false;
            if (!searchTerm) return true;
            return (
                u.display_name?.toLowerCase().includes(searchTerm)
                || u.username?.toLowerCase().includes(searchTerm)
                || String(u.id).includes(searchTerm)
                || (u.is_admin ? "admin" : "user").includes(searchTerm)
            );
        });
        const sorted = [...filtered];
        sorted.sort((a, b) => {
            switch (userSort) {
                case "id-asc": return a.id - b.id;
                case "id-desc": return b.id - a.id;
                case "name-asc": return (a.display_name || "").localeCompare(b.display_name || "");
                case "name-desc": return (b.display_name || "").localeCompare(a.display_name || "");
                case "created-asc": return new Date(a.created_at || 0) - new Date(b.created_at || 0);
                case "created-desc": return new Date(b.created_at || 0) - new Date(a.created_at || 0);
                default: return 0;
            }
        });
        return sorted;
    }, [users, userSearch, userSort, userFilter]);

    const filteredAndSortedProjects = useMemo(() => {
        const searchTerm = projectSearch.trim().toLowerCase();
        const filtered = projects.filter((p) => {
            if (projectFilter === "public" && !p.is_public) return false;
            if (projectFilter === "private" && p.is_public) return false;
            if (projectFilter === "pybricks" && p.project_type !== "pybricks") return false;
            if (!searchTerm) return true;
            return (
                p.name?.toLowerCase().includes(searchTerm)
                || p.owner_name?.toLowerCase().includes(searchTerm)
                || String(p.id).includes(searchTerm)
                || p.public_id?.toLowerCase().includes(searchTerm)
            );
        });
        const sorted = [...filtered];
        sorted.sort((a, b) => {
            switch (projectSort) {
                case "id-asc": return a.id - b.id;
                case "id-desc": return b.id - a.id;
                case "name-asc": return (a.name || "").localeCompare(b.name || "");
                case "name-desc": return (b.name || "").localeCompare(a.name || "");
                case "files-desc": return (b.files?.length || 0) - (a.files?.length || 0);
                default: return 0;
            }
        });
        return sorted;
    }, [projects, projectSearch, projectSort, projectFilter]);

    const tabs = [
        { id: "overview", label: "Overview", icon: <FiBarChart2 /> },
        { id: "users", label: "Users", icon: <FiUsers />, count: users.length },
        { id: "projects", label: "Projects", icon: <FiFolder />, count: projects.length },
    ];

    return (
        <div className="container page-shell admin-page">
            <header className="page-header admin-header">
                <div>
                    <h1 className="page-title">Admin Dashboard</h1>
                    <p className="page-subtitle">Manage users, projects, and workspace activity.</p>
                </div>
                <button
                    className="btn-secondary admin-refresh"
                    onClick={() => loadData({ silent: true })}
                    disabled={refreshing}
                    title="Refresh data"
                >
                    <FiRefreshCw className={refreshing ? "spin" : ""} /> Refresh
                </button>
            </header>

            <div className="tabs admin-tabs">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        className={`tab ${activeTab === t.id ? "active" : ""}`}
                        onClick={() => setActiveTab(t.id)}
                    >
                        {t.icon}
                        <span>{t.label}</span>
                        {t.count != null && <span className="tab-count">{t.count}</span>}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="panel admin-empty"><FiActivity className="spin" /> Loading admin data…</div>
            ) : (
                <>
                    {activeTab === "overview" && (
                        <div className="admin-overview">
                            <h3 className="admin-section-label"><FiUsers /> Users</h3>
                            <div className="admin-stat-grid">
                                <StatCard icon={<FiUsers />} label="Total users" value={stats?.total_users}
                                    foot={stats?.new_users_7d ? `+${stats.new_users_7d} this week` : "No new signups (7d)"} accent="primary" />
                                <StatCard icon={<FiActivity />} label="Online now" value={stats?.online_users} accent="green" />
                                <StatCard icon={<FiShield />} label="Admins" value={stats?.admins} />
                                <StatCard icon={<FiSlash />} label="Banned" value={stats?.banned_users}
                                    foot={stats?.banned_users ? "review needed" : "all clear"} accent={stats?.banned_users ? "danger" : null} />
                            </div>

                            <h3 className="admin-section-label"><FiFolder /> Projects</h3>
                            <div className="admin-stat-grid">
                                <StatCard icon={<FiFolder />} label="Total projects" value={stats?.total_projects}
                                    foot={stats?.new_projects_7d ? `+${stats.new_projects_7d} this week` : "No new projects (7d)"} accent="primary" />
                                <StatCard icon={<FiGlobe />} label="Public" value={stats?.public_projects} />
                                <StatCard icon={<FiBox />} label="Pybricks" value={stats?.pybricks_projects} />
                                <StatCard icon={<FiFileText />} label="Total files" value={stats?.total_files} />
                            </div>

                            <h3 className="admin-section-label"><FiTrendingUp /> Engagement</h3>
                            <div className="admin-stat-grid">
                                <StatCard icon={<FiMessageSquare />} label="Messages" value={stats?.total_messages} />
                                <StatCard icon={<FiMessageSquare />} label="Conversations" value={stats?.total_conversations} />
                                <StatCard icon={<FiUserPlus />} label="Follows" value={stats?.total_follows} />
                            </div>

                            <div className="admin-overview-cols">
                                <div className="panel admin-feed">
                                    <div className="admin-feed-head"><FiClock /> Recent signups</div>
                                    {recentSignups.length === 0 && <div className="muted admin-feed-empty">No users yet.</div>}
                                    {recentSignups.map((u) => (
                                        <button key={u.id} className="admin-feed-row" onClick={() => { setActiveTab("users"); setUserSearch(u.username); }}>
                                            <div className="admin-avatar sm">{(u.display_name || u.username || "?").charAt(0).toUpperCase()}</div>
                                            <div className="admin-feed-main">
                                                <div className="admin-feed-name">
                                                    {u.display_name}
                                                    {u.is_admin && <span className="chip chip-success">Admin</span>}
                                                    {u.is_banned && <span className="chip chip-danger">Banned</span>}
                                                </div>
                                                <div className="muted admin-feed-sub">@{u.username}</div>
                                            </div>
                                            <div className="admin-feed-date">{formatDate(u.created_at)}</div>
                                        </button>
                                    ))}
                                </div>
                                <div className="panel admin-feed">
                                    <div className="admin-feed-head"><FiFolder /> Newest projects</div>
                                    {recentProjects.length === 0 && <div className="muted admin-feed-empty">No projects yet.</div>}
                                    {recentProjects.map((p) => (
                                        <button key={p.id} className="admin-feed-row" onClick={() => setInspectProject(p)}>
                                            <div className="admin-feed-main">
                                                <div className="admin-feed-name">{p.name}</div>
                                                <div className="muted admin-feed-sub">by {p.owner_name || "—"} · {p.files?.length || 0} files</div>
                                            </div>
                                            {p.is_public
                                                ? <span className="chip chip-success">Public</span>
                                                : <span className="chip chip-muted">Private</span>}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === "users" && (
                        <div className="panel admin-panel">
                            <div className="admin-controls">
                                <div className="admin-search">
                                    <FiSearch />
                                    <input
                                        ref={searchRef}
                                        className="input"
                                        placeholder="Search users by name, username, ID, or role  (⌘/Ctrl + K)"
                                        value={userSearch}
                                        onChange={(e) => setUserSearch(e.target.value)}
                                    />
                                </div>
                                <select className="input admin-sort" value={userSort} onChange={(e) => setUserSort(e.target.value)}>
                                    <option value="id-desc">Newest ID first</option>
                                    <option value="id-asc">Oldest ID first</option>
                                    <option value="name-asc">Name (A → Z)</option>
                                    <option value="name-desc">Name (Z → A)</option>
                                    <option value="created-desc">Created (Newest)</option>
                                    <option value="created-asc">Created (Oldest)</option>
                                </select>
                                <button className="btn-secondary admin-export" onClick={exportUsers} disabled={!filteredAndSortedUsers.length} title="Export to CSV">
                                    <FiDownload /> Export
                                </button>
                            </div>
                            <div className="admin-filter-row">
                                {[
                                    { id: "all", label: "All", n: users.length },
                                    { id: "members", label: "Members", n: users.filter((u) => !u.is_admin && !u.is_banned).length },
                                    { id: "admins", label: "Admins", n: users.filter((u) => u.is_admin).length },
                                    { id: "banned", label: "Banned", n: users.filter((u) => u.is_banned).length },
                                ].map((f) => (
                                    <button key={f.id} className={`admin-chip ${userFilter === f.id ? "active" : ""}`} onClick={() => setUserFilter(f.id)}>
                                        {f.label} <span className="admin-chip-count">{f.n}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="admin-table-wrap">
                                <table className="data-table admin-table">
                                    <thead>
                                        <tr>
                                            <th></th>
                                            <th>ID</th>
                                            <th>User</th>
                                            <th>Projects</th>
                                            <th>Joined</th>
                                            <th>Role</th>
                                            <th className="admin-actions-col">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredAndSortedUsers.map((u) => (
                                            <Fragment key={u.id}>
                                                <tr
                                                    className={`admin-row ${expandedUserId === u.id ? "expanded" : ""}`}
                                                    onClick={() => setExpandedUserId(expandedUserId === u.id ? null : u.id)}
                                                >
                                                    <td className="admin-chevron">
                                                        {expandedUserId === u.id ? <FiChevronUp /> : <FiChevronDown />}
                                                    </td>
                                                    <td className="muted">#{u.id}</td>
                                                    <td>
                                                        <div className="admin-user-cell">
                                                            <div className="admin-avatar">{(u.display_name || u.username || "?").charAt(0).toUpperCase()}</div>
                                                            <div>
                                                                <div className="admin-user-name">
                                                                    {u.display_name}
                                                                    {u.is_admin && <VerifiedBadge size={14} />}
                                                                </div>
                                                                <div className="muted admin-user-handle">@{u.username}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="muted">{projectCountByOwner.get(u.id) || 0}</td>
                                                    <td className="admin-date">{formatDate(u.created_at)}</td>
                                                    <td>
                                                        <div className="admin-badges">
                                                            {u.is_admin
                                                                ? <span className="chip chip-success">Admin</span>
                                                                : <span className="chip chip-muted">Member</span>}
                                                            {u.is_banned && <span className="chip chip-danger">Banned</span>}
                                                        </div>
                                                    </td>
                                                    <td onClick={(e) => e.stopPropagation()}>
                                                        <div className="admin-actions">
                                                            <button className="admin-icon-btn primary" onClick={() => impersonateUser(u)}
                                                                title="Impersonate user" disabled={u.is_admin || u.is_banned}>
                                                                <FiUserCheck />
                                                            </button>
                                                            <button className={`admin-icon-btn ${u.is_banned ? "primary" : "danger"}`}
                                                                onClick={() => setBanState(u, !u.is_banned)} disabled={u.is_admin}
                                                                title={u.is_banned ? "Unban user" : "Ban user"}>
                                                                {u.is_banned ? <FiCheck /> : <FiSlash />}
                                                            </button>
                                                            <button className={`admin-icon-btn ${u.is_admin ? "primary" : ""}`}
                                                                onClick={() => setAdminState(u, !u.is_admin)}
                                                                disabled={u.id === user?.id || u.username === "adam"}
                                                                title={u.is_admin ? "Revoke admin" : "Grant admin"}>
                                                                <FiShield />
                                                            </button>
                                                            <button className="admin-icon-btn" onClick={() => setEditingUser({ ...u, password: "" })} title="Edit user">
                                                                <FiEdit2 />
                                                            </button>
                                                            <button className="admin-icon-btn danger" onClick={() => deleteUser(u)}
                                                                disabled={u.username === "adam"} title="Delete user">
                                                                <FiTrash2 />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {expandedUserId === u.id && (
                                                    <tr className="admin-expand-row">
                                                        <td colSpan={7}>
                                                            <div className="admin-expand">
                                                                <div className="admin-expand-actions">
                                                                    <button className="btn-secondary" onClick={() => setForceProjectUser(u)}>
                                                                        <FiPlusCircle /> Create project
                                                                    </button>
                                                                    <button className="btn-secondary" onClick={() => setForceFollowUser(u)}>
                                                                        <FiUserPlus /> Force follow
                                                                    </button>
                                                                    <button className="btn-secondary" onClick={() => copyToClipboard(String(u.id), `user ID #${u.id}`)}>
                                                                        <FiCopy /> Copy ID
                                                                    </button>
                                                                    {!u.is_admin && (
                                                                        <button className={u.is_banned ? "btn-secondary" : "btn-danger"} onClick={() => setBanState(u, !u.is_banned)}>
                                                                            {u.is_banned ? <FiCheck /> : <FiSlash />} {u.is_banned ? "Unban account" : "Ban account"}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <h4 className="admin-expand-title"><FiFolder /> Projects by {u.display_name}</h4>
                                                                <div className="admin-project-grid">
                                                                    {projects.filter((p) => p.owner_id === u.id).map((p) => (
                                                                        <div key={p.id} className="admin-project-card">
                                                                            <div className="admin-project-card-name">{p.name}</div>
                                                                            <div className="admin-project-card-meta">
                                                                                {p.is_public ? "Public" : "Private"} · {p.files?.length || 0} files
                                                                            </div>
                                                                            <div className="admin-project-card-actions">
                                                                                <button className="admin-pill" onClick={() => navigate(toProjectPath(p))}>
                                                                                    <FiCode /> Open
                                                                                </button>
                                                                                <button className="admin-pill danger" onClick={() => deleteProject(p)}>
                                                                                    <FiTrash2 />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                    {projects.filter((p) => p.owner_id === u.id).length === 0 && (
                                                                        <div className="muted">No projects found.</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        ))}
                                        {filteredAndSortedUsers.length === 0 && (
                                            <tr>
                                                <td colSpan={7} className="admin-empty-cell">No users match your filters.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === "projects" && (
                        <div className="panel admin-panel">
                            <div className="admin-controls">
                                <div className="admin-search">
                                    <FiSearch />
                                    <input
                                        ref={searchRef}
                                        className="input"
                                        placeholder="Search projects by name, owner, ID, or public ID  (⌘/Ctrl + K)"
                                        value={projectSearch}
                                        onChange={(e) => setProjectSearch(e.target.value)}
                                    />
                                </div>
                                <select className="input admin-sort" value={projectSort} onChange={(e) => setProjectSort(e.target.value)}>
                                    <option value="id-desc">Newest ID first</option>
                                    <option value="id-asc">Oldest ID first</option>
                                    <option value="name-asc">Name (A → Z)</option>
                                    <option value="name-desc">Name (Z → A)</option>
                                    <option value="files-desc">Most files</option>
                                </select>
                                <button className="btn-secondary admin-export" onClick={exportProjects} disabled={!filteredAndSortedProjects.length} title="Export to CSV">
                                    <FiDownload /> Export
                                </button>
                            </div>
                            <div className="admin-filter-row">
                                {[
                                    { id: "all", label: "All", n: projects.length },
                                    { id: "public", label: "Public", n: projects.filter((p) => p.is_public).length },
                                    { id: "private", label: "Private", n: projects.filter((p) => !p.is_public).length },
                                    { id: "pybricks", label: "Pybricks", n: projects.filter((p) => p.project_type === "pybricks").length },
                                ].map((f) => (
                                    <button key={f.id} className={`admin-chip ${projectFilter === f.id ? "active" : ""}`} onClick={() => setProjectFilter(f.id)}>
                                        {f.label} <span className="admin-chip-count">{f.n}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="admin-table-wrap">
                                <table className="data-table admin-table">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Project</th>
                                            <th>Owner</th>
                                            <th>Type</th>
                                            <th>Files</th>
                                            <th>Visibility</th>
                                            <th className="admin-actions-col">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredAndSortedProjects.map((p) => (
                                            <tr key={p.id} className="admin-row" onClick={() => setInspectProject(p)} style={{ cursor: "pointer" }}>
                                                <td className="muted">#{p.id}</td>
                                                <td><button className="admin-link-name" onClick={(e) => { e.stopPropagation(); setInspectProject(p); }}>{p.name}</button></td>
                                                <td>
                                                    <span className="admin-owner">{p.owner_name || "—"}</span>
                                                    <span className="muted admin-owner-id"> #{p.owner_id}</span>
                                                </td>
                                                <td>
                                                    {p.project_type === "pybricks"
                                                        ? <span className="chip chip-muted">Pybricks</span>
                                                        : <span className="muted">Python</span>}
                                                </td>
                                                <td className="muted">{p.files?.length || 0}</td>
                                                <td>
                                                    {p.is_public
                                                        ? <span className="chip chip-success">Public</span>
                                                        : <span className="chip chip-muted">Private</span>}
                                                </td>
                                                <td onClick={(e) => e.stopPropagation()}>
                                                    <div className="admin-actions">
                                                        <button className="admin-icon-btn" onClick={() => setInspectProject(p)} title="Inspect project">
                                                            <FiEye />
                                                        </button>
                                                        <button className={`admin-icon-btn ${p.is_public ? "primary" : ""}`} onClick={() => toggleProjectVisibility(p)}
                                                            title={p.is_public ? "Make private" : "Make public"}>
                                                            {p.is_public ? <FiGlobe /> : <FiLock />}
                                                        </button>
                                                        <button className="admin-icon-btn" onClick={() => copyToClipboard(p.public_id, "public ID")} title="Copy public ID">
                                                            <FiCopy />
                                                        </button>
                                                        <button className="admin-icon-btn primary" onClick={() => navigate(toProjectPath(p))} title="Open in editor">
                                                            <FiCode />
                                                        </button>
                                                        <button className="admin-icon-btn danger" onClick={() => deleteProject(p)} title="Delete project">
                                                            <FiTrash2 />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {filteredAndSortedProjects.length === 0 && (
                                            <tr>
                                                <td colSpan={7} className="admin-empty-cell">No projects match your filters.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Edit User Modal */}
            <AnimatePresence>
                {editingUser && (
                    <AdminModal title="Edit user" onClose={() => setEditingUser(null)}>
                        <form onSubmit={saveUser} className="admin-form">
                            <label className="admin-field">
                                <span>Display name</span>
                                <input className="input" value={editingUser.display_name}
                                    onChange={(e) => setEditingUser({ ...editingUser, display_name: e.target.value })} />
                            </label>
                            <label className="admin-field">
                                <span>Username</span>
                                <input className="input" value={editingUser.username} disabled={editingUser.username === "adam"}
                                    onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })} />
                            </label>
                            <label className="admin-field">
                                <span>New password (optional)</span>
                                <input className="input" type="password" placeholder="Leave blank to keep unchanged"
                                    value={editingUser.password}
                                    onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })} />
                            </label>
                            <label className={`admin-checkbox ${(editingUser.id === user?.id || editingUser.username === "adam") ? "disabled" : ""}`}>
                                <input type="checkbox" checked={Boolean(editingUser.is_admin)}
                                    disabled={editingUser.id === user?.id || editingUser.username === "adam"}
                                    onChange={(e) => setEditingUser({ ...editingUser, is_admin: e.target.checked, is_banned: e.target.checked ? false : editingUser.is_banned })} />
                                <span><FiShield style={{ verticalAlign: "-2px" }} /> Administrator</span>
                            </label>
                            {!editingUser.is_admin && (
                                <label className="admin-checkbox">
                                    <input type="checkbox" checked={Boolean(editingUser.is_banned)}
                                        onChange={(e) => setEditingUser({ ...editingUser, is_banned: e.target.checked })} />
                                    <span>Account is banned</span>
                                </label>
                            )}
                            <div className="admin-modal-foot">
                                <button type="button" className="btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
                                <button type="submit" className="btn"><FiCheck /> Save</button>
                            </div>
                        </form>
                    </AdminModal>
                )}
            </AnimatePresence>

            {/* Force Create Project Modal */}
            <AnimatePresence>
                {forceProjectUser && (
                    <ForceProjectModal user={forceProjectUser} onClose={() => setForceProjectUser(null)} onSubmit={submitForceProject} />
                )}
            </AnimatePresence>

            {/* Force Follow Modal */}
            <AnimatePresence>
                {forceFollowUser && (
                    <ForceFollowModal user={forceFollowUser} users={users} onClose={() => setForceFollowUser(null)} onSubmit={submitForceFollow} />
                )}
            </AnimatePresence>

            {/* Project Inspector Modal */}
            <AnimatePresence>
                {inspectProject && (
                    <ProjectInspectorModal
                        project={inspectProject}
                        users={users}
                        onClose={() => setInspectProject(null)}
                        onOpen={() => navigate(toProjectPath(inspectProject))}
                        onToggleVisibility={() => toggleProjectVisibility(inspectProject)}
                        onCopy={() => copyToClipboard(inspectProject.public_id, "public ID")}
                        onDelete={() => { deleteProject(inspectProject); setInspectProject(null); }}
                    />
                )}
            </AnimatePresence>

            {/* Toasts */}
            <div className="admin-toasts">
                <AnimatePresence>
                    {toasts.map((t) => (
                        <motion.div
                            key={t.id}
                            initial={{ opacity: 0, x: 40 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 40 }}
                            className={`admin-toast ${t.type}`}
                            onClick={() => dismissToast(t.id)}
                        >
                            {t.type === "success" ? <FiCheck /> : t.type === "error" ? <FiAlertCircle /> : <FiActivity />}
                            <span>{t.message}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}

function ForceProjectModal({ user, onClose, onSubmit }) {
    const [name, setName] = useState("");
    const [type, setType] = useState("normal");
    const [isPublic, setIsPublic] = useState(false);

    const submit = (e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit(user.id, { name: trimmed, project_type: type, is_public: isPublic });
    };

    return (
        <AdminModal title={`Create project for @${user.username}`} onClose={onClose}>
            <form onSubmit={submit} className="admin-form">
                <label className="admin-field">
                    <span>Project name</span>
                    <input className="input" autoFocus value={name} placeholder="My new project"
                        onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="admin-field">
                    <span>Type</span>
                    <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                        <option value="normal">Python</option>
                        <option value="pybricks">Pybricks</option>
                    </select>
                </label>
                <label className="admin-checkbox">
                    <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                    <span>Make public</span>
                </label>
                <div className="admin-modal-foot">
                    <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn" disabled={!name.trim()}><FiPlusCircle /> Create</button>
                </div>
            </form>
        </AdminModal>
    );
}

function ProjectInspectorModal({ project, users, onClose, onOpen, onToggleVisibility, onCopy, onDelete }) {
    const userById = useMemo(() => {
        const map = new Map();
        users.forEach((u) => map.set(u.id, u));
        return map;
    }, [users]);

    const owner = userById.get(project.owner_id);
    const files = project.files || [];
    const collaborators = (project.collaborators || []).filter((c) => c.user_id !== project.owner_id);

    return (
        <AdminModal title="Project details" onClose={onClose} wide>
            <div className="admin-inspect">
                <div className="admin-inspect-title">
                    <span className="admin-inspect-name">{project.name}</span>
                    {project.is_public
                        ? <span className="chip chip-success">Public</span>
                        : <span className="chip chip-muted">Private</span>}
                    {project.project_type === "pybricks" && <span className="chip chip-muted">Pybricks</span>}
                </div>

                <div className="admin-inspect-grid">
                    <div className="admin-inspect-field"><span>Project ID</span><b>#{project.id}</b></div>
                    <div className="admin-inspect-field"><span>Public ID</span><b className="admin-inspect-mono">{project.public_id}</b></div>
                    <div className="admin-inspect-field"><span>Owner</span><b>{owner ? `${owner.display_name} (@${owner.username})` : `#${project.owner_id}`}</b></div>
                    <div className="admin-inspect-field"><span>Files</span><b>{files.length}</b></div>
                </div>

                {project.description && <div className="admin-inspect-desc">{project.description}</div>}

                <div className="admin-inspect-section">
                    <div className="admin-inspect-label">Collaborators ({collaborators.length})</div>
                    {collaborators.length === 0 && <div className="muted admin-inspect-muted">No collaborators.</div>}
                    {collaborators.map((c) => {
                        const cu = userById.get(c.user_id);
                        return (
                            <div key={c.user_id} className="admin-inspect-row">
                                <span>{cu ? `${cu.display_name} (@${cu.username})` : `#${c.user_id}`}</span>
                                <span className="chip chip-muted">{c.role}</span>
                            </div>
                        );
                    })}
                </div>

                <div className="admin-inspect-section">
                    <div className="admin-inspect-label">Files ({files.length})</div>
                    <div className="admin-inspect-files">
                        {files.length === 0 && <div className="muted admin-inspect-muted">No files.</div>}
                        {files.map((f) => (
                            <div key={f.id} className="admin-inspect-row">
                                <span className="admin-inspect-mono">{f.name}</span>
                                <span className="muted">{(f.content?.length || 0).toLocaleString()} chars</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="admin-modal-foot admin-inspect-foot">
                    <button className="btn-secondary" onClick={onCopy}><FiCopy /> Copy ID</button>
                    <button className="btn-secondary" onClick={onToggleVisibility}>
                        {project.is_public ? <FiLock /> : <FiGlobe />} {project.is_public ? "Make private" : "Make public"}
                    </button>
                    <button className="btn-danger" onClick={onDelete}><FiTrash2 /> Delete</button>
                    <button className="btn" onClick={onOpen}><FiCode /> Open</button>
                </div>
            </div>
        </AdminModal>
    );
}

function ForceFollowModal({ user, users, onClose, onSubmit }) {
    const [targetId, setTargetId] = useState("");
    const candidates = useMemo(
        () => users.filter((u) => u.id !== user.id).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")),
        [users, user.id],
    );

    const submit = (e) => {
        e.preventDefault();
        const id = Number(targetId);
        if (!Number.isInteger(id) || id <= 0) return;
        onSubmit(user.id, id);
    };

    return (
        <AdminModal title={`Make @${user.username} follow…`} onClose={onClose}>
            <form onSubmit={submit} className="admin-form">
                <label className="admin-field">
                    <span>Target user</span>
                    <select className="input" autoFocus value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                        <option value="">Select a user…</option>
                        {candidates.map((c) => (
                            <option key={c.id} value={c.id}>{c.display_name} (@{c.username}) · #{c.id}</option>
                        ))}
                    </select>
                </label>
                <div className="admin-modal-foot">
                    <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn" disabled={!targetId}><FiUserPlus /> Force follow</button>
                </div>
            </form>
        </AdminModal>
    );
}
