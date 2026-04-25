import { useState, useEffect } from "react";
import api from "../api";
import { FiUser, FiTrash2, FiUpload, FiCheck, FiX, FiShield, FiPlus, FiKey } from "react-icons/fi";
import { motion } from "framer-motion";
import { startRegistration } from "@simplewebauthn/browser";
import { GoogleLogin } from "@react-oauth/google";
import { GOOGLE_CLIENT_ID, IS_DESKTOP_APP } from "../googleConfig";
import { verifyEmailWithGoogle } from "../utils/googleAuth";
import { MAX_PROFILE_LINKS, isValidProfileLink, normalizeProfileLinks } from "../utils/socialLinks";
import { resolveHostedAssetUrl } from "../utils/hostedAssets";
import { loadStoredUser, storeUser } from "../session";

export default function Settings({ user: currentUser, onLogout }) {
  const [activeTab, setActiveTab] = useState("profile");
  const [formData, setFormData] = useState({
    display_name: "",
    username: "",
    email: "",
    description: "",
    links: [],
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [pfpPreview, setPfpPreview] = useState(null);
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [baselineUser, setBaselineUser] = useState(currentUser || null);
  const googleEnabled = Boolean(GOOGLE_CLIENT_ID) && !IS_DESKTOP_APP;
  const isFounderEditor = (currentUser?.username || "").toLowerCase() === "adam";

  const hydrateProfileForm = (user) => {
    if (!user) return;
    setBaselineUser(user);
    setFormData({
      display_name: user.display_name || "",
      username: user.username || "",
      email: user.email || "",
      description: user.description || "",
      links: Array.isArray(user.links) ? user.links : [],
      password: "",
    });
    if (user.profile_picture_path) {
      setPfpPreview(resolveHostedAssetUrl(user.profile_picture_path));
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    let sourceUser = currentUser;
    const cachedUser = loadStoredUser();
    if (cachedUser?.id === currentUser.id) {
      sourceUser = { ...currentUser, ...cachedUser };
    }
    hydrateProfileForm(sourceUser);
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) fetchPasskeys();
  }, [currentUser]);

  const fetchPasskeys = async () => {
    try {
      const res = await api.get("/auth/passkey/credentials");
      setPasskeys(res.data);
    } catch {
      // Ignore if passkey endpoints not available
    }
  };

  const registerPasskey = async () => {
    setPasskeyLoading(true);
    setMessage(null);
    setError(null);
    try {
      const optionsRes = await api.post("/auth/passkey/register/options");
      const attestation = await startRegistration({ optionsJSON: optionsRes.data });
      await api.post("/auth/passkey/register/complete", attestation);
      setMessage("Passkey registered successfully");
      fetchPasskeys();
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setError("Passkey registration was cancelled");
      } else {
        setError(err.response?.data?.detail || err.message || "Failed to register passkey");
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const deletePasskey = async (id) => {
    try {
      await api.delete(`/auth/passkey/credentials/${id}`);
      setMessage("Passkey removed");
      fetchPasskeys();
    } catch {
      setError("Failed to remove passkey");
    }
  };

  const addLinkField = () => {
    setFormData((prev) => ({ ...prev, links: [...prev.links, ""] }));
  };

  const updateLinkField = (index, value) => {
    setFormData((prev) => ({
      ...prev,
      links: prev.links.map((item, i) => (i === index ? value : item)),
    }));
  };

  const removeLinkField = (index) => {
    setFormData((prev) => ({
      ...prev,
      links: prev.links.filter((_, i) => i !== index),
    }));
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    // Validate username format if changing
    if (formData.username !== (baselineUser?.username || "")) {
      if (!/^[a-zA-Z0-9]+$/.test(formData.username)) {
        setError("Username can only contain letters (a-z) and/or numbers (0-9)");
        setLoading(false);
        return;
      }
    }

    try {
      const trimmedDescription = formData.description.trim();
      const invalidLink = formData.links.find((link) => link.trim() && !isValidProfileLink(link));
      if (invalidLink) {
        setError(`Invalid link: ${invalidLink}`);
        setLoading(false);
        return;
      }

      const normalizedLinks = normalizeProfileLinks(formData.links);
      if (normalizedLinks.length > MAX_PROFILE_LINKS) {
        setError(`You can add up to ${MAX_PROFILE_LINKS} links.`);
        setLoading(false);
        return;
      }

      const baselineLinks = normalizeProfileLinks(Array.isArray(baselineUser?.links) ? baselineUser.links : []);
      const linksChanged = normalizedLinks.join("|") !== baselineLinks.join("|");

      const payload = {};
      if (formData.display_name !== (baselineUser?.display_name || "")) payload.display_name = formData.display_name;
      if (trimmedDescription !== ((baselineUser?.description || "").trim())) payload.description = trimmedDescription;
      if (linksChanged) payload.links = normalizedLinks;
      if (formData.username !== (baselineUser?.username || "")) payload.username = formData.username;
      // Password only sent if non-empty
      if (formData.password) payload.password = formData.password;

      // Only send if there are changes
      if (Object.keys(payload).length > 0) {
        const res = await api.patch("/users/me", payload);
        storeUser(res.data);
        setBaselineUser(res.data);
        setFormData({
          display_name: res.data.display_name || "",
          username: res.data.username || "",
          email: res.data.email || "",
          description: res.data.description || "",
          links: Array.isArray(res.data.links) ? res.data.links : [],
          password: "",
        });
        setMessage("Profile updated successfully");
      } else {
        setMessage("No changes to save");
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleEmailVerify = async (response) => {
    setError(null);
    setMessage(null);
    const idToken = response?.credential;
    if (!idToken) {
      setError("Google sign-in did not return an ID token");
      return;
    }
    setGoogleLoading(true);
    try {
      const updated = await verifyEmailWithGoogle(idToken);
      storeUser(updated);
      setBaselineUser(updated);
      setFormData((prev) => ({ ...prev, email: updated.email || "" }));
      setMessage("Email verified with Google");
    } catch (err) {
      setError(err.response?.data?.detail || "Google email verification failed");
    } finally {
      setGoogleLoading(false);
    }
  };

  const clearVerifiedEmail = async () => {
    try {
      setLoading(true);
      setError(null);
      setMessage(null);
      const res = await api.patch("/users/me", { email: "" });
      storeUser(res.data);
      setBaselineUser(res.data);
      setFormData((prev) => ({ ...prev, email: "" }));
      setMessage("Email removed");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to remove email");
    } finally {
      setLoading(false);
    }
  };

  const handlePfpUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const form = new FormData();
    form.append("file", file);

    try {
      setLoading(true);
      const res = await api.put("/users/me/picture", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      storeUser(res.data);
      setPfpPreview(resolveHostedAssetUrl(res.data.profile_picture_path));
      setMessage("Profile picture updated");
    } catch (err) {
      setError("Failed to upload picture");
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async () => {
    if (!confirm("Are you sure? This will delete all your projects and cannot be undone.")) return;
    try {
      await api.delete("/users/me");
      onLogout();
    } catch (err) {
      setError("Failed to delete account");
    }
  };

  return (
    <div className="container page-shell settings-page">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="panel settings-card">
        <div className="panel-header settings-header">
          <div>
            <div className="panel-title">Settings</div>
            <div className="panel-subtitle">Manage your profile and account security.</div>
          </div>
          <div className="tabs">
            <button
              onClick={() => setActiveTab("profile")}
              className={`tab ${activeTab === "profile" ? "active" : ""}`}
            >
              <FiUser /> Profile
            </button>
            <button
              onClick={() => setActiveTab("account")}
              className={`tab ${activeTab === "account" ? "active" : ""}`}
            >
              <FiShield /> Account
            </button>
          </div>
        </div>

        <div className="panel-body settings-content">
          {message && <div className="alert alert-success"><FiCheck /> {message}</div>}
          {error && <div className="alert alert-error"><FiX /> {error}</div>}

          {activeTab === "profile" && (
            <div className="settings-profile">
              <div className="settings-avatar">
                <div className="settings-avatar-frame">
                  {pfpPreview ? (
                    <img src={pfpPreview} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div className="settings-avatar-fallback">
                      {formData.display_name?.[0]?.toUpperCase() || "U"}
                    </div>
                  )}
                </div>
                <label className="btn-secondary settings-upload">
                  <FiUpload style={{ marginRight: 8 }} /> Change Picture
                  <input type="file" hidden accept="image/*" onChange={handlePfpUpload} />
                </label>
              </div>

              <form onSubmit={handleUpdate} className="settings-form">
                <div>
                  <label className="settings-label">Display Name</label>
                  <input className="input" value={formData.display_name} onChange={e => setFormData({ ...formData, display_name: e.target.value })} placeholder="Your Name" />
                </div>
                <div>
                  <label className="settings-label">Description</label>
                  <textarea
                    className="input settings-textarea"
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Tell us about yourself..."
                  />
                </div>
                {isFounderEditor && (
                  <>
                    <div>
                      <label className="settings-label">Links</label>
                      <div className="settings-links">
                        {formData.links.length === 0 && (
                          <p className="muted settings-links-empty">No links added yet.</p>
                        )}
                        {formData.links.map((link, index) => (
                          <div key={`profile-link-${index}`} className="settings-link-row">
                            <input
                              className="input"
                              value={link}
                              onChange={(e) => updateLinkField(index, e.target.value)}
                              placeholder="https://github.com/username"
                            />
                            <button
                              type="button"
                              className="btn-ghost settings-link-remove"
                              onClick={() => removeLinkField(index)}
                              aria-label="Remove link"
                            >
                              <FiTrash2 size={14} />
                            </button>
                          </div>
                        ))}
                        <button type="button" className="btn-secondary settings-link-add" onClick={addLinkField}>
                          <FiPlus style={{ marginRight: 6 }} /> Add link
                        </button>
                      </div>
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn" disabled={loading}>
                    {loading ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === "account" && (
            <div className="settings-account">
              <form onSubmit={handleUpdate} className="settings-form settings-form-compact">
                <div>
                  <label className="settings-label">Username</label>
                  <input className="input" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                </div>
                <div>
                  <label className="settings-label">Verified Email (Google)</label>
                  <input className="input" type="email" value={formData.email} readOnly placeholder="No verified email yet" />
                  <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                    {baselineUser?.email_verified ? "Verified via Google OAuth." : "Verify with Google to add an email to your account."}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  {googleEnabled ? (
                    <div style={{ opacity: googleLoading ? 0.7 : 1 }}>
                      <GoogleLogin
                        onSuccess={handleGoogleEmailVerify}
                        onError={() => setError("Google email verification failed")}
                        text="continue_with"
                      />
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 13 }}>
                      Google OAuth is not configured.
                    </div>
                  )}
                  {formData.email && (
                    <button type="button" className="btn-ghost" onClick={clearVerifiedEmail} disabled={loading || googleLoading}>
                      Remove email
                    </button>
                  )}
                </div>
                <div>
                  <label className="settings-label">New Password</label>
                  <input className="input" type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} placeholder="Leave blank to keep unchanged" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn" disabled={loading}>
                    Update Account
                  </button>
                </div>
              </form>

              <div className="passkey-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <h4 style={{ margin: 0 }}><FiKey style={{ marginRight: 8, verticalAlign: 'middle' }} />Passkeys</h4>
                  <button onClick={registerPasskey} className="btn-secondary" disabled={passkeyLoading} style={{ fontSize: 13, padding: '6px 14px' }}>
                    {passkeyLoading ? "Registering..." : <><FiPlus style={{ marginRight: 6 }} /> Add Passkey</>}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 14, marginBottom: 'var(--space-3)' }}>
                  Sign in with your fingerprint, face, or security key instead of a password.
                </p>
                {passkeys.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>No passkeys registered yet.</p>
                ) : (
                  <div className="passkey-list">
                    {passkeys.map((pk) => (
                      <div key={pk.id} className="passkey-item">
                        <div>
                          <FiShield style={{ marginRight: 8, verticalAlign: 'middle' }} />
                          <strong>{pk.device_name}</strong>
                          <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
                            Added {new Date(pk.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <button onClick={() => deletePasskey(pk.id)} className="btn-ghost" style={{ color: 'var(--danger)', padding: '4px 8px' }}>
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="danger-zone">
                <h4 style={{ color: 'var(--danger)', marginTop: 0 }}>Danger Zone</h4>
                <p className="muted" style={{ fontSize: 14 }}>Once you delete your account, there is no going back. Please be certain.</p>
                <button onClick={deleteAccount} className="btn btn-danger-outline">
                  <FiTrash2 style={{ marginRight: 8 }} /> Delete Account
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
