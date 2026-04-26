import { useState, useEffect } from "react";
import api from "../api";
import { resolveProfileId, toProfilePath } from "../utils/profileLinks";
import { parseSocialLink } from "../utils/socialLinks";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { FiUserPlus, FiUserCheck, FiGrid, FiFolder, FiCalendar, FiArrowRight, FiX, FiUser, FiMessageCircle, FiZap, FiLink, FiMail } from "react-icons/fi";
// Brand icons sourced from Font Awesome Free via react-icons/fa6.
import {
    FaBehance,
    FaBitbucket,
    FaCodepen,
    FaDev,
    FaDiscord,
    FaDribbble,
    FaFacebook,
    FaGithub,
    FaGitlab,
    FaInstagram,
    FaLinkedin,
    FaMastodon,
    FaMedium,
    FaPinterest,
    FaRedditAlien,
    FaSnapchat,
    FaStackOverflow,
    FaSteam,
    FaTelegram,
    FaThreads,
    FaTiktok,
    FaTumblr,
    FaTwitch,
    FaVk,
    FaWhatsapp,
    FaXTwitter,
    FaYoutube,
} from "react-icons/fa6";
import { SiBuymeacoffee } from "react-icons/si";
import { motion, AnimatePresence } from "framer-motion";
import VerifiedBadge from "../components/VerifiedBadge";
import { toProjectPath } from "../projects/projectPaths";
import { resolveHostedAssetUrl } from "../utils/hostedAssets";

const SOCIAL_ICON_MAP = {
    github: FaGithub,
    gitlab: FaGitlab,
    bitbucket: FaBitbucket,
    linkedin: FaLinkedin,
    x: FaXTwitter,
    youtube: FaYoutube,
    instagram: FaInstagram,
    twitch: FaTwitch,
    tiktok: FaTiktok,
    facebook: FaFacebook,
    discord: FaDiscord,
    reddit: FaRedditAlien,
    threads: FaThreads,
    telegram: FaTelegram,
    snapchat: FaSnapchat,
    mastodon: FaMastodon,
    medium: FaMedium,
    devto: FaDev,
    behance: FaBehance,
    dribbble: FaDribbble,
    codepen: FaCodepen,
    "stack-overflow": FaStackOverflow,
    steam: FaSteam,
    pinterest: FaPinterest,
    tumblr: FaTumblr,
    vk: FaVk,
    whatsapp: FaWhatsapp,
    buymeacoffee: SiBuymeacoffee,
    mailto: FiMail,
};

const resolvePlatformIconKey = (link) => {
    if (link.platformId && SOCIAL_ICON_MAP[link.platformId]) return link.platformId;
    if (typeof link.href !== "string") return null;
    const href = link.href.toLowerCase();
    if (href.startsWith("mailto:")) return "mailto";
    if (href.includes("buymeacoffee.com")) return "buymeacoffee";
    return null;
};

function FaviconWithFallback({ link }) {
    const sources = Array.isArray(link?.faviconUrls) ? link.faviconUrls.filter(Boolean) : [];
    const [sourceIndex, setSourceIndex] = useState(0);
    if (sources.length === 0 || sourceIndex >= sources.length) {
        return <FiLink size={14} />;
    }
    return (
        <img
            className="profile-link-favicon"
            src={sources[sourceIndex]}
            alt=""
            loading="lazy"
            aria-hidden="true"
            onError={() => setSourceIndex((prev) => prev + 1)}
        />
    );
}

const formatJoinedDate = (createdAt) => {
    if (!createdAt) return "Joined recently";
    const tryParse = (value) => {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const direct = tryParse(createdAt);
    if (direct) {
        return `Joined ${direct.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}`;
    }
    if (typeof createdAt === "string") {
        const normalized = tryParse(createdAt.replace(" ", "T"));
        if (normalized) {
            return `Joined ${normalized.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}`;
        }
    }
    return "Joined recently";
};

export default function Profile({ user: currentUser }) {
    const { userId } = useParams();
    const [resolvedUserId, setResolvedUserId] = useState(null);
    const [profileUser, setProfileUser] = useState(null);
    const [projects, setProjects] = useState([]);
    const [isFollowing, setIsFollowing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ followers: 0, following: 0 });
    const [modalType, setModalType] = useState(null); // 'followers' or 'following'
    const [modalUsers, setModalUsers] = useState([]);
    const [modalLoading, setModalLoading] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    const isGuestView = !currentUser;
    const isMe = currentUser && profileUser && currentUser.id === profileUser.id;

    useEffect(() => {
        loadProfile();
    }, [userId]);

    const loadProfile = async () => {
        try {
            setLoading(true);
            const targetUserId = await resolveProfileId(userId, api);
            if (!targetUserId) {
                setProfileUser(null);
                setProjects([]);
                setStats({ followers: 0, following: 0 });
                setResolvedUserId(null);
                return;
            }
            setResolvedUserId(targetUserId);
            const uRes = await api.get(`/users/${targetUserId}`);
            setProfileUser(uRes.data);
            setIsFollowing(Boolean(uRes.data?.is_following));
            const pRes = await api.get(`/users/${targetUserId}/projects`);
            setProjects(pRes.data);
            const statsRes = await api.get(`/users/${targetUserId}/stats`);
            setStats(statsRes.data);
        } catch (e) {
            setProfileUser(null);
            setProjects([]);
            setStats({ followers: 0, following: 0 });
            setResolvedUserId(null);
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const openModal = async (type) => {
        if (!resolvedUserId || isGuestView) return;
        setModalType(type);
        setModalLoading(true);
        try {
            const res = await api.get(`/users/${resolvedUserId}/${type}`);
            setModalUsers(res.data);
        } catch (e) {
            console.error(e);
            setModalUsers([]);
        }
        setModalLoading(false);
    };

    const closeModal = () => {
        setModalType(null);
        setModalUsers([]);
    };

    const toggleFollow = async () => {
        if (!resolvedUserId || isGuestView) return;
        try {
            if (isFollowing) {
                await api.delete(`/users/${resolvedUserId}/follow`);
                setIsFollowing(false);
                setStats(prev => ({ ...prev, followers: prev.followers - 1 }));
            } else {
                const res = await api.post(`/users/${resolvedUserId}/follow`);
                setIsFollowing(true);
                if (res.data.status !== "already followed") {
                    setStats(prev => ({ ...prev, followers: prev.followers + 1 }));
                }
            }
        } catch (e) {
            console.error(e);
        }
    };

    const startConversation = async () => {
        if (!profileUser || isGuestView) return;
        try {
            const res = await api.post("/messages/conversation/start", {
                target_user_id: profileUser.id,
            });
            navigate(`/messages/${res.data.conversation.id}`);
        } catch (e) {
            console.error(e);
        }
    };

    if (loading) return (
        <div className="flex-center" style={{ minHeight: '80vh' }}>
            <div className="spinner" />
        </div>
    );

    if (!profileUser) return <div className="container page-shell" style={{ textAlign: 'center' }}>User not found</div>;

    const pfpUrl = profileUser.profile_picture_path
        ? resolveHostedAssetUrl(profileUser.profile_picture_path)
        : null;
    const isFounderProfile = (profileUser.username || "").toLowerCase() === "adam";
    const joinedLabel = formatJoinedDate(profileUser.created_at);
    const profileDescription = (profileUser.description || "").trim();
    const profileLinks = (Array.isArray(profileUser.links) ? profileUser.links : [])
        .map((link) => parseSocialLink(link))
        .filter((link) => link.href);

    return (
        <motion.div
            className={`container page-shell profile-page ${isFounderProfile ? "founder-profile" : ""}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
        >

            {isGuestView && (
                <div className="panel profile-guest-cta">
                    <div>
                        <h2>Want to follow @{profileUser?.username} and join the conversation?</h2>
                        <p className="muted">You are viewing a limited public preview. Sign in or create an account to follow users, message them, and open projects.</p>
                    </div>
                    <div className="profile-guest-cta-actions">
                        <Link className="btn" to="/login" state={{ from: location.pathname }}>Log in</Link>
                        <Link className="btn-secondary" to="/register" state={{ from: location.pathname }}>Sign up</Link>
                    </div>
                </div>
            )}

            {/* Followers/Following Modal */}
            <AnimatePresence>
                {modalType && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                        onClick={closeModal}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="panel modal-card profile-modal"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="profile-modal-header">
                                <h3 style={{ margin: 0, textTransform: 'capitalize', fontSize: '1.1rem' }}>{modalType}</h3>
                                <button className="btn-ghost modal-close" onClick={closeModal}><FiX size={20} /></button>
                            </div>
                            <div className="profile-modal-body">
                                {modalLoading ? (
                                    <div className="flex-center" style={{ padding: "var(--space-6)" }}><div className="spinner" /></div>
                                ) : modalUsers.length === 0 ? (
                                    <div className="muted" style={{ textAlign: 'center', padding: "var(--space-6)" }}>No {modalType} yet.</div>
                                ) : (
                                    modalUsers.map(u => (
                                        <motion.div
                                            key={u.id}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="profile-modal-row"
                                            onClick={() => {
                                                closeModal();
                                                const path = toProfilePath(u);
                                                if (path) navigate(path);
                                            }}
                                            whileHover={{ backgroundColor: 'var(--input-bg)' }}
                                        >
                                            <div className="profile-modal-avatar">
                                                {u.profile_picture_path ? (
                                                    <img
                                                        src={resolveHostedAssetUrl(u.profile_picture_path)}
                                                        alt={u.display_name}
                                                    />
                                                ) : (
                                                    <div className="profile-modal-fallback">
                                                        <FiUser />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center' }}>
                                                    {u.display_name}
                                                    {u.is_admin && <VerifiedBadge size={14} />}
                                                </div>
                                                <div className="muted" style={{ fontSize: '0.85rem' }}>@{u.username}</div>
                                            </div>

                                        </motion.div>
                                    ))
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="profile-grid">
                <motion.div
                    className={`panel profile-card ${isFounderProfile ? "founder-profile-card" : ""}`}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                >
                    <div className="profile-avatar-wrap">
                        <div className="profile-avatar">
                            {pfpUrl ? (
                                <img src={pfpUrl} alt={profileUser.display_name} />
                            ) : (
                                <div className="profile-avatar-fallback">
                                    {profileUser.display_name?.[0]?.toUpperCase()}
                                </div>
                            )}
                        </div>
                        {isFollowing && !isMe && (
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="profile-follow-badge"
                            >
                                <FiUserCheck size={16} />
                            </motion.div>
                        )}
                    </div>

                    <div className="profile-info">
                        <div className="profile-info-header">
                            <div>
                                <div className="profile-name-row">
                                    <h1 className="page-title">{profileUser.display_name}</h1>
                                    {profileUser.is_admin && <VerifiedBadge size={28} />}
                                </div>
                                <p className="profile-handle muted">@{profileUser.username}</p>

                                {isFounderProfile && (
                                    <div className={`profile-owner-pill ${isFounderProfile ? "founder-owner-pill" : ""}`}>
                                        <FiZap size={12} /> Founder of PyCollab
                                    </div>
                                )}
                            </div>

                            {isMe ? (
                                <button className="btn-secondary" onClick={() => navigate("/settings")}>Edit Profile</button>
                            ) : isGuestView ? (
                                <div className="profile-actions">
                                    <Link className="btn-secondary" to="/login" state={{ from: location.pathname }}>
                                        <FiMessageCircle /> Message
                                    </Link>
                                    <Link className="btn" to="/register" state={{ from: location.pathname }}>
                                        <FiUserPlus style={{ marginRight: 8 }} /> Follow
                                    </Link>
                                </div>
                            ) : (
                                <div className="profile-actions">
                                    <button className="btn-secondary" onClick={startConversation}>
                                        <FiMessageCircle /> Message
                                    </button>
                                    <button className={isFollowing ? "btn-secondary" : "btn"} onClick={toggleFollow}>
                                        {isFollowing ? 'Following' : <><FiUserPlus style={{ marginRight: 8 }} /> Follow</>}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="profile-description-card">
                            <span className="profile-description-label">Description</span>
                            <p className="profile-description-text">
                                {profileDescription || <span className="muted">No description yet.</span>}
                            </p>
                        </div>
                        {isFounderProfile && profileLinks.length > 0 && (
                            <div className="profile-links">
                                <span className="profile-links-label">Links</span>
                                <div className="profile-links-list">
                                    {profileLinks.map((link, index) => {
                                        const iconKey = resolvePlatformIconKey(link);
                                        const PlatformIcon = iconKey ? SOCIAL_ICON_MAP[iconKey] : null;
                                        const iconOnly = Boolean(PlatformIcon);
                                        const linkLabel = link.platformLabel
                                            ? `${link.platformLabel}${link.handle ? `: ${link.handle}` : ""}`
                                            : link.displayText;
                                        return (
                                            <a
                                                key={`${link.href}-${index}`}
                                                className={`profile-link-chip ${iconOnly ? "profile-link-chip-icon" : "profile-link-chip-text"}`}
                                                href={link.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title={linkLabel}
                                                aria-label={linkLabel}
                                            >
                                                {iconOnly ? (
                                                    <PlatformIcon size={16} />
                                                ) : (
                                                    <>
                                                        <FaviconWithFallback link={link} />
                                                        <span>{link.displayText}</span>
                                                    </>
                                                )}
                                            </a>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>

                <motion.div
                    className={`panel profile-stats ${isFounderProfile ? "founder-profile-stats" : ""}`}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="panel-header">
                        <div className="panel-title">Stats</div>
                    </div>
                    <div className="panel-body profile-stats-body">
                        <div className="stat-item">
                            <FiCalendar /> {joinedLabel}
                        </div>
                        <div className={`stat-item ${isGuestView ? "" : "hover-underline"}`} onClick={() => openModal('followers')}>
                            <strong className="profile-meta-strong">{stats.followers}</strong> Followers
                        </div>
                        <div className={`stat-item ${isGuestView ? "" : "hover-underline"}`} onClick={() => openModal('following')}>
                            <strong className="profile-meta-strong">{stats.following}</strong> Following
                        </div>
                    </div>
                </motion.div>

            </div>

            <div className="panel profile-projects">
                <div className="panel-header">
                    <div className="panel-title">Public Projects</div>
                    <FiGrid />
                </div>
                <div className="panel-body">
                    <motion.div layout className="project-list">
                        {projects.map((p, i) => (
                            <motion.div
                                key={p.id}
                                className={`project-row ${isFounderProfile && i === 0 ? "founder-project-featured" : ""}`}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.05 + 0.2 }}
                            >
                                <div className="project-row-main">
                                    <div className="project-icon">
                                        <FiFolder size={20} />
                                    </div>
                                    <div>
                                        <div className="project-name">{p.name}</div>
                                        <div className="muted project-subtitle">
                                            {p.description || "No description provided."}
                                        </div>
                                    </div>
                                </div>
                                {isGuestView ? (
                                    <Link className="btn-secondary" to="/login" state={{ from: location.pathname }}>
                                        View Code <FiArrowRight />
                                    </Link>
                                ) : (
                                    <button className="btn-secondary" onClick={() => navigate(toProjectPath(p))}>
                                        View Code <FiArrowRight />
                                    </button>
                                )}
                            </motion.div>
                        ))}
                        {projects.length === 0 && (
                            <div className="empty-state">
                                No public projects found.
                            </div>
                        )}
                    </motion.div>
                </div>
            </div>

        </motion.div>
    );
}
