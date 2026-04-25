import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import { FiTrash2, FiCode, FiUser, FiFolder, FiChevronDown, FiChevronUp, FiEdit2, FiX, FiCheck, FiUserCheck } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import VerifiedBadge from "../components/VerifiedBadge";
import { getAdminTokenBackup, getToken, setAdminTokenBackup, setImpersonatorFlag, setToken } from "../auth";
import { toProjectPath } from "../projects/projectPaths";


const formatDate = (isoString) => {
    if (!isoString) return "-";
    return new Date(isoString).toLocaleDateString() + " " + new Date(isoString).toLocaleTimeString();
};

export default function AdminPage({ user }) {
    const [users, setUsers] = useState([]);
    const [projects, setProjects] = useState([]);
    const [activeTab, setActiveTab] = useState("users");
    const [expandedUserId, setExpandedUserId] = useState(null);
    const [editingUser, setEditingUser] = useState(null);
    const [userSearch, setUserSearch] = useState("");
    const [userSort, setUserSort] = useState("id-desc");
    const userSearchRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        const handleSearchShortcut = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                userSearchRef.current?.focus();
            }
        };

        window.addEventListener("keydown", handleSearchShortcut);
        return () => window.removeEventListener("keydown", handleSearchShortcut);
    }, []);

    const extractErrorDetail = (error, fallback) => (
        error?.response?.data?.detail
        || error?.response?.data?.message
        || error?.message
        || fallback
    );

    const loadData = useCallback(async () => {
        try {
            const uRes = await api.get("/admin/api/users");
            setUsers(uRes.data);
            const pRes = await api.get("/admin/api/projects");
            setProjects(pRes.data);
        } catch (e) {
            alert(extractErrorDetail(e, "Failed to load admin data"));
        }
    }, []);

    useEffect(() => {
        if (user && !user.is_admin) {
            navigate("/");
            return;
        }
        if (user?.is_admin) {
            loadData();
        }
    }, [user, navigate, loadData]);

    const deleteUser = async (id) => {
        if (!confirm("Delete user? This will delete all their projects.")) return;
        try {
            await api.delete(`/admin/api/users/${id}`);
            await loadData();
        } catch (e) {
            alert(extractErrorDetail(e, "Failed to delete user"));
        }
    };

    const deleteProject = async (id) => {
        if (!confirm("Delete project?")) return;
        try {
            await api.delete(`/admin/api/projects/${id}`);
            await loadData();
        } catch (e) {
            alert(extractErrorDetail(e, "Failed to delete project"));
        }
    };

    const forceFollow = async (followerId) => {
        const targetIdRaw = prompt(`Enter User ID for User #${followerId} to follow:`);
        if (!targetIdRaw) return;
        const targetId = Number(targetIdRaw);
        if (!Number.isInteger(targetId) || targetId <= 0) {
            alert("Please enter a valid numeric user ID.");
            return;
        }
        try {
            await api.post("/admin/api/force/follow", null, { params: { follower_id: followerId, followed_id: targetId } });
            alert("Follow forced successfully");
        } catch (e) {
            alert(extractErrorDetail(e, "Failed to force follow"));
        }
    };

    const forceCreateProject = async (userId) => {
        const nameRaw = prompt("Project Name:");
        if (!nameRaw) return;
        const name = nameRaw.trim();
        if (!name) {
            alert("Project name cannot be empty.");
            return;
        }
        try {
            const res = await api.post("/admin/api/force/project", { name }, { params: { user_id: userId } });
            setProjects((prev) => [...prev, res.data]);
            alert(`Project created: #${res.data.id}`);
        } catch (e) {
            alert(extractErrorDetail(e, "Failed to force-create project"));
        }
    };

    const impersonateUser = async (userToImpersonate) => {
        if (!confirm(`Are you sure you want to impersonate ${userToImpersonate.username}?`)) return;
        try {
            const res = await api.post(`/admin/api/impersonate/${userToImpersonate.id}`);
            // Store current token as admin backup once, so nested impersonation can't overwrite it.
            if (!getAdminTokenBackup()) {
                setAdminTokenBackup(getToken());
            }
            setImpersonatorFlag(true);
            setToken(res.data.access_token);
            // Redirect to dashboard as the user
            window.location.href = "/";
        } catch (e) {
            alert(extractErrorDetail(e, "Failed to impersonate user"));
        }
    };

    const saveUser = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                username: editingUser.username,
                display_name: editingUser.display_name,
            };
            if (editingUser.password) {
                payload.password = editingUser.password;
            }
            const res = await api.patch(`/admin/api/users/${editingUser.id}`, payload);
            setUsers(users.map(u => u.id === editingUser.id ? res.data : u));
            setEditingUser(null);
        } catch (err) {
            alert(extractErrorDetail(err, "Failed to update user"));
        }
    };

    const filteredAndSortedUsers = useMemo(() => {
        const searchTerm = userSearch.trim().toLowerCase();

        const filteredUsers = users.filter((u) => {
            if (!searchTerm) return true;

            return (
                u.display_name?.toLowerCase().includes(searchTerm)
                || u.username?.toLowerCase().includes(searchTerm)
                || String(u.id).includes(searchTerm)
                || (u.is_admin ? "admin" : "user").includes(searchTerm)
            );
        });

        const sortedUsers = [...filteredUsers];
        sortedUsers.sort((a, b) => {
            switch (userSort) {
                case "id-asc":
                    return a.id - b.id;
                case "id-desc":
                    return b.id - a.id;
                case "name-asc":
                    return (a.display_name || "").localeCompare(b.display_name || "");
                case "name-desc":
                    return (b.display_name || "").localeCompare(a.display_name || "");
                case "created-asc":
                    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
                case "created-desc":
                    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
                default:
                    return 0;
            }
        });

        return sortedUsers;
    }, [users, userSearch, userSort]);

    return (
        <div className="container page-shell admin-page">
            <header className="page-header">
                <h1 className="page-title">Admin Dashboard</h1>
                <p className="page-subtitle">Manage users, projects, and workspace activity.</p>
            </header>

            <div className="tabs admin-tabs">
                <button
                    className={`tab ${activeTab === 'users' ? 'active' : ''}`}
                    onClick={() => setActiveTab('users')}
                >
                    <FiUser style={{ marginRight: 8 }} /> Users
                </button>
                <button
                    className={`tab ${activeTab === 'projects' ? 'active' : ''}`}
                    onClick={() => setActiveTab('projects')}
                >
                    <FiFolder style={{ marginRight: 8 }} /> Projects
                </button>
            </div>

            {activeTab === 'users' && (
                <div className="panel" style={{ overflowX: 'auto' }}>
                    <div className="admin-users-controls">
                        <input
                            ref={userSearchRef}
                            className="input"
                            placeholder="Search users by name, username, ID, or role (⌘/Ctrl + K)"
                            value={userSearch}
                            onChange={(e) => setUserSearch(e.target.value)}
                        />
                        <select
                            className="input"
                            value={userSort}
                            onChange={(e) => setUserSort(e.target.value)}
                        >
                            <option value="id-desc">User ID (Descending)</option>
                            <option value="id-asc">User ID (Ascending)</option>
                            <option value="name-asc">Name (A → Z)</option>
                            <option value="name-desc">Name (Z → A)</option>
                            <option value="created-desc">Created Date (Newest)</option>
                            <option value="created-asc">Created Date (Oldest)</option>
                        </select>
                    </div>
                    <table className="data-table" style={{ minWidth: 800 }}>
                        <thead>
                            <tr>
                                <th></th>
                                <th>ID</th>
                                <th>User</th>
                                <th>Created At</th>
                                {/* Password column removed */}
                                <th>Role</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAndSortedUsers.map(u => (
                                <Fragment key={u.id}>
                                    <tr
                                        style={{ cursor: 'pointer', background: expandedUserId === u.id ? 'var(--panel-soft)' : 'transparent' }}
                                        onClick={() => setExpandedUserId(expandedUserId === u.id ? null : u.id)}
                                    >
                                        <td style={{ color: 'var(--text-muted)' }}>
                                            {expandedUserId === u.id ? <FiChevronUp /> : <FiChevronDown />}
                                        </td>
                                        <td className="muted">#{u.id}</td>
                                        <td>
                                            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                                                {u.display_name}
                                                {u.is_admin && <VerifiedBadge size={14} />}
                                            </div>
                                            <div className="muted" style={{ fontSize: 13 }}>@{u.username}</div>
                                        </td>

                                        <td style={{ fontSize: 13 }}>{formatDate(u.created_at)}</td>
                                        {/* Password cell removed */}
                                        <td>
                                            {u.is_admin ? (
                                                <span className="chip chip-success">Admin</span>
                                            ) : (
                                                <span className="chip chip-muted">User</span>
                                            )}
                                        </td>
                                        <td onClick={e => e.stopPropagation()}>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button
                                                    className="btn-ghost"
                                                    style={{ color: 'var(--primary)', padding: 8, borderRadius: '50%' }}
                                                    onClick={() => impersonateUser(u)}
                                                    title="Impersonate User"
                                                    disabled={u.is_admin}
                                                >
                                                    <FiUserCheck />
                                                </button>
                                                <button
                                                    className="btn-ghost"
                                                    style={{ color: 'var(--text-color)', padding: 8, borderRadius: '50%' }}
                                                    onClick={() => setEditingUser({ ...u, password: "" })}
                                                    title="Edit User"
                                                >
                                                    <FiEdit2 />
                                                </button>
                                                <button
                                                    className="btn-ghost"
                                                    style={{ color: 'var(--danger)', padding: 8, borderRadius: '50%' }}
                                                    onClick={() => deleteUser(u.id)}
                                                    disabled={u.username === 'adam'}
                                                    title="Delete User"
                                                >
                                                    <FiTrash2 />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedUserId === u.id && (
                                        <tr style={{ background: 'var(--panel-soft)' }}>
                                            <td colSpan={7} style={{ padding: "var(--space-5) var(--space-6)" }}>
                                                <div style={{ marginBottom: "var(--space-4)", display: 'flex', gap: "var(--space-3)", flexWrap: 'wrap' }}>
                                                    <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => forceCreateProject(u.id)}>
                                                        <FiCheck style={{ marginRight: 8 }} /> Force Create Project
                                                    </button>
                                                    <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => forceFollow(u.id)}>
                                                        <FiUser style={{ marginRight: 8 }} /> Force Follow...
                                                    </button>
                                                </div>
                                                <h4 style={{ margin: "0 0 var(--space-4)", display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <FiFolder /> Projects by {u.display_name}
                                                </h4>
                                                <div style={{ display: 'grid', gap: "var(--space-3)", gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                                                    {projects.filter(p => p.owner_id === u.id).map(p => (
                                                        <div key={p.id} className="panel project-summary-card" style={{ padding: "var(--space-3)" }}>
                                                            <div style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>{p.name}</div>
                                                            <div style={{ display: 'flex', gap: "var(--space-2)" }}>
                                                                <button className="btn-ghost project-inline-action" onClick={() => navigate(toProjectPath(p))}>
                                                                    <FiCode style={{ marginRight: 4 }} /> Code
                                                                </button>
                                                                <button className="btn-ghost project-inline-action danger" onClick={() => deleteProject(p.id)}>
                                                                    <FiTrash2 />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {projects.filter(p => p.owner_id === u.id).length === 0 && (
                                                        <div className="muted">No projects found.</div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            ))}
                            {filteredAndSortedUsers.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="muted" style={{ textAlign: "center", padding: "var(--space-5)" }}>
                                        No users match your current search.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === 'projects' && (
                <div className="panel" style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ minWidth: 600 }}>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Project Name</th>
                                <th>Owner ID</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {projects.map(p => (
                                <tr key={p.id}>
                                    <td className="muted">#{p.id}</td>
                                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                                    <td>{p.owner_id}</td>
                                    <td style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            className="btn-ghost"
                                            onClick={() => navigate(toProjectPath(p))}
                                            title="Open in Editor"
                                            style={{ padding: 8, borderRadius: '50%' }}
                                        >
                                            <FiCode />
                                        </button>
                                        <button
                                            className="btn-ghost"
                                            style={{ color: 'var(--danger)', padding: 8, borderRadius: '50%' }}
                                            onClick={() => deleteProject(p.id)}
                                            title="Delete Project"
                                        >
                                            <FiTrash2 />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Edit User Modal */}
            <AnimatePresence>
                {editingUser && (
                    <div className="modal-overlay">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="panel modal-card"
                            style={{ width: 400, padding: "var(--space-6)" }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: "var(--space-5)" }}>
                                <h2 style={{ margin: 0 }}>Edit User</h2>
                                <button className="btn-ghost" onClick={() => setEditingUser(null)}><FiX size={20} /></button>
                            </div>
                            <form onSubmit={saveUser} style={{ display: 'flex', flexDirection: 'column', gap: "var(--space-4)" }}>
                                <div>
                                    <label className="muted" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>Display Name</label>
                                    <input className="input" value={editingUser.display_name} onChange={e => setEditingUser({ ...editingUser, display_name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="muted" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>Username</label>
                                    <input className="input" value={editingUser.username} onChange={e => setEditingUser({ ...editingUser, username: e.target.value })} disabled={editingUser.username === 'adam'} />
                                </div>
                                <div>
                                    <label className="muted" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>New Password (optional)</label>
                                    <input className="input" type="password" placeholder="Leave blank to keep unchanged" value={editingUser.password} onChange={e => setEditingUser({ ...editingUser, password: e.target.value })} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: "var(--space-4)", gap: "var(--space-2)" }}>
                                    <button type="button" className="btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
                                    <button type="submit" className="btn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FiCheck /> Save</button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
