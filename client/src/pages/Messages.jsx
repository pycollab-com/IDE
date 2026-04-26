import { useCallback, useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import { io } from "socket.io-client";
import api, { API_BASE } from "../api";
import { getToken } from "../auth";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FiMessageCircle,
  FiUser,
  FiSend,
  FiMoreVertical,
  FiLock,
  FiCheck,
  FiX,
  FiPlus,
  FiSearch,
  FiArrowDown,
  FiChevronLeft,
} from "react-icons/fi";
import VerifiedBadge from "../components/VerifiedBadge";
import { toProfilePath } from "../utils/profileLinks";
import { motion } from "framer-motion";
import { resolveHostedAssetUrl } from "../utils/hostedAssets";
import { loadStoredUser } from "../session";

const REALTIME_PARTY = import.meta.env.VITE_PARTYKIT_PARTY || "messages";
const REALTIME_HOST = import.meta.env.VITE_PARTYKIT_HOST || (typeof window !== "undefined" ? window.location.host : "");

const previewText = (text = "") => text.trim().replace(/\s+/g, " ").slice(0, 120);

const messageKey = (message) => message?.client_message_id || message?.id;

const toTimestamp = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? 0 : parsed;
};

const mergeMessageLists = (current = [], incoming = []) => {
  const map = new Map();
  current.forEach((message) => {
    if (!message) return;
    map.set(messageKey(message), message);
  });
  incoming.forEach((message) => {
    if (!message) return;
    map.set(messageKey(message), message);
  });
  const merged = Array.from(map.values());
  merged.sort((a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at));
  return merged;
};

const upsertMessage = (current = [], incoming) => mergeMessageLists(current, incoming ? [incoming] : []);

export default function Messages({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { conversationId: routeConversationId } = useParams();
  const currentUser = user || loadStoredUser();
  const [inbox, setInbox] = useState([]);
  const [requests, setRequests] = useState([]);
  const [activeTab, setActiveTab] = useState("inbox");
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [conversationDetail, setConversationDetail] = useState(null);
  const [messageBody, setMessageBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [presenceMap, setPresenceMap] = useState({});
  const [typingMap, setTypingMap] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [newMessageText, setNewMessageText] = useState("");
  const [newMessageError, setNewMessageError] = useState("");
  const [newMessageSending, setNewMessageSending] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [pendingUnreadCount, setPendingUnreadCount] = useState(0);

  const socketRef = useRef(null);
  const realtimeSocketRef = useRef(null);
  const activeConversationRef = useRef(null);
  const currentUserRef = useRef(currentUser);
  const conversationDetailRef = useRef(null);
  const hydratedRoomsRef = useRef(new Set());
  const typingThrottleRef = useRef({ lastSent: 0, timeoutId: null });
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const previousConversationIdRef = useRef(null);
  const previousMessageCountRef = useRef(0);
  const isSendingRef = useRef(false);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    conversationDetailRef.current = conversationDetail;
  }, [conversationDetail]);

  const sendRealtimeMessage = useCallback((payload) => {
    const socket = realtimeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }, []);

  const loadInbox = useCallback(async () => {
    try {
      const res = await api.get("/messages/inbox");
      setError("");
      setInbox(res.data);
      const presenceUpdates = {};
      res.data.forEach((item) => {
        if (item.other_user?.id) {
          presenceUpdates[item.other_user.id] = {
            status: item.online_status,
            last_seen_at: item.last_seen_at,
          };
        }
      });
      setPresenceMap((prev) => ({ ...prev, ...presenceUpdates }));
    } catch (err) {
      console.error(err);
      setError("Failed to load inbox.");
    }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const res = await api.get("/messages/requests");
      setError("");
      setRequests(res.data);
    } catch (err) {
      console.error(err);
      setError("Failed to load requests.");
    }
  }, []);

  const loadConversation = useCallback(async (conversationId) => {
    if (!conversationId) return;
    setLoadingThread(true);
    try {
      const res = await api.get(`/messages/conversation/${conversationId}`);
      setConversationDetail(res.data);
      setMessageBody("");
      setMenuOpen(false);
      loadInbox();
    } catch (err) {
      console.error(err);
      setError("Unable to open conversation.");
      setConversationDetail(null);
    } finally {
      setLoadingThread(false);
    }
  }, [loadInbox]);

  const refreshConversation = useCallback(
    async (conversationId) => {
      if (!conversationId) return;
      try {
        const res = await api.get(`/messages/conversation/${conversationId}`);
        setConversationDetail(res.data);
      } catch (err) {
        console.error(err);
      }
    },
    []
  );

  useEffect(() => {
    loadInbox();
    loadRequests();
  }, [loadInbox, loadRequests]);

  useEffect(() => {
    const conversationId = routeConversationId || location.state?.conversationId;
    if (!conversationId) {
      setActiveConversationId(null);
      setMenuOpen(false);
      return;
    }
    if (conversationId !== activeConversationId) {
      setActiveConversationId(conversationId);
      loadConversation(conversationId);
    }
  }, [routeConversationId, location.state, activeConversationId, loadConversation]);

  useEffect(() => {
    if (!newMessageOpen) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await api.get(`/users/search?q=${encodeURIComponent(searchQuery.trim())}`);
        const filtered = res.data.filter((u) => u.id !== currentUser?.id);
        setSearchResults(filtered);
      } catch (err) {
        console.error(err);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, newMessageOpen, currentUser?.id]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = io(`${API_BASE}/messages`, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
      forceNew: true,
      multiplex: false,
    });
    socketRef.current = socket;

    const heartbeat = setInterval(() => {
      socket.emit("presence:heartbeat");
    }, 25000);
    socket.emit("presence:heartbeat");

    socket.on("presence:update", (payload) => {
      if (!payload?.user_id) return;
      setPresenceMap((prev) => ({
        ...prev,
        [payload.user_id]: {
          status: payload.status,
          last_seen_at: payload.last_seen_at,
        },
      }));
    });

    socket.on("conversation:new", () => {
      loadInbox();
      loadRequests();
    });
    socket.on("conversation:accepted", (payload) => {
      loadInbox();
      loadRequests();
      if (payload?.conversation_id === activeConversationRef.current) {
        refreshConversation(payload.conversation_id);
      }
    });
    socket.on("conversation:removed", (payload) => {
      if (payload?.conversation_id === activeConversationRef.current) {
        setConversationDetail(null);
        setActiveConversationId(null);
        navigate("/messages");
      }
      loadInbox();
      loadRequests();
    });
    socket.on("conversation:blocked", () => {
      if (activeConversationRef.current) {
        setConversationDetail(null);
        setActiveConversationId(null);
        navigate("/messages");
      }
      loadInbox();
      loadRequests();
    });
    socket.on("conversation:unblocked", () => {
      loadInbox();
      loadRequests();
    });

    socket.on("message:new", (payload) => {
      if (!payload?.conversation_id || !payload?.message) return;
      const isIncoming = payload.message.sender_id !== currentUserRef.current?.id;
      const isActive = payload.conversation_id === activeConversationRef.current;
      updateInboxPreview(payload.conversation_id, payload.message.body, payload.message.created_at, { isIncoming, isActive });
      updateRequestPreview(payload.conversation_id, payload.message.body, payload.message.created_at);
      if (payload.conversation_id === activeConversationRef.current) {
        setConversationDetail((prev) => {
          if (!prev) return prev;
          const exists = prev.messages?.some((msg) => msg.id === payload.message.id);
          if (exists) return prev;
          let updatedMessages = prev.messages;
          if (payload.message.client_message_id) {
            const tempIndex = prev.messages.findIndex(
              (msg) => msg.client_message_id === payload.message.client_message_id || msg.id === payload.message.client_message_id
            );
            if (tempIndex !== -1) {
              updatedMessages = prev.messages.slice();
              updatedMessages[tempIndex] = payload.message;
            }
          }
          if (updatedMessages === prev.messages) {
            updatedMessages = [...prev.messages, payload.message];
          }
          return {
            ...prev,
            conversation: {
              ...prev.conversation,
              last_message_preview: previewText(payload.message.body),
              last_message_at: payload.message.created_at,
            },
            messages: updatedMessages,
          };
        });
        if (payload.message.sender_id !== currentUserRef.current?.id) {
          refreshConversation(payload.conversation_id);
        }
      }
    });

    socket.on("typing:start", (payload) => {
      if (!payload?.conversation_id || payload.user_id === currentUserRef.current?.id) return;
      setTypingMap((prev) => ({ ...prev, [payload.conversation_id]: true }));
    });
    socket.on("typing:stop", (payload) => {
      if (!payload?.conversation_id) return;
      setTypingMap((prev) => ({ ...prev, [payload.conversation_id]: false }));
    });

    return () => {
      clearInterval(heartbeat);
      socket.disconnect();
    };
  }, [loadInbox, loadRequests, refreshConversation, navigate]);

  useEffect(() => {
    if (!activeConversationId || !socketRef.current) return;
    socketRef.current.emit("join_conversation", { conversation_id: activeConversationId });
    return () => {
      socketRef.current?.emit("leave_conversation", { conversation_id: activeConversationId });
    };
  }, [activeConversationId]);

  useEffect(() => {
    const conversationId = activeConversationId;
    const detail = conversationDetail;
    if (
      !conversationId ||
      !detail ||
      detail.conversation?.id !== conversationId ||
      detail.block_state === "blocked_by_me"
    ) {
      if (realtimeSocketRef.current) {
        realtimeSocketRef.current.close();
        realtimeSocketRef.current = null;
      }
      return;
    }

    const socket = new PartySocket({
      party: REALTIME_PARTY,
      room: conversationId,
      ...(REALTIME_HOST ? { host: REALTIME_HOST } : {}),
    });
    realtimeSocketRef.current = socket;
    const handleOpen = () => {
      const latestDetail = conversationDetailRef.current;
      if (!latestDetail || latestDetail.conversation?.id !== conversationId) return;
      if (hydratedRoomsRef.current.has(conversationId)) return;
      sendRealtimeMessage({
        type: "hydrate",
        messages: latestDetail.messages || [],
      });
      hydratedRoomsRef.current.add(conversationId);
    };

    const handleMessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        console.error(err);
        return;
      }
      if (!payload || typeof payload !== "object") return;

      if (payload.type === "all") {
        const incoming = Array.isArray(payload.messages) ? payload.messages : [];
        setConversationDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: mergeMessageLists(prev.messages, incoming),
          };
        });
        return;
      }

      if (payload.type === "add" || payload.type === "update") {
        const message = payload.message;
        if (!message) return;
        const messageConversationId = message.conversation_id || conversationId;
        if (messageConversationId !== activeConversationRef.current) return;

        const isIncoming = message.sender_id !== currentUserRef.current?.id;
        const isActive = messageConversationId === activeConversationRef.current;
        updateInboxPreview(messageConversationId, message.body, message.created_at, { isIncoming, isActive });
        updateRequestPreview(messageConversationId, message.body, message.created_at);

        if (isActive) {
          setConversationDetail((prev) => {
            if (!prev) return prev;
            const updatedMessages = upsertMessage(prev.messages, message);
            return {
              ...prev,
              conversation: {
                ...prev.conversation,
                last_message_preview: previewText(message.body),
                last_message_at: message.created_at,
              },
              messages: updatedMessages,
            };
          });
          if (isIncoming) {
            refreshConversation(messageConversationId);
          }
        }
      }
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);

    return () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.close();
      if (realtimeSocketRef.current === socket) {
        realtimeSocketRef.current = null;
      }
    };
  }, [activeConversationId, conversationDetail?.conversation?.id, conversationDetail?.block_state, refreshConversation, sendRealtimeMessage]);

  useEffect(() => {
    const conversationId = activeConversationId;
    const detail = conversationDetail;
    if (
      !conversationId ||
      !detail ||
      detail.conversation?.id !== conversationId ||
      hydratedRoomsRef.current.has(conversationId)
    ) {
      return;
    }
    const socket = realtimeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    sendRealtimeMessage({
      type: "hydrate",
      messages: detail.messages || [],
    });
    hydratedRoomsRef.current.add(conversationId);
  }, [activeConversationId, conversationDetail?.conversation?.id, conversationDetail?.messages?.length, sendRealtimeMessage]);

  useEffect(() => {
    const conversationId = conversationDetail?.conversation?.id;
    if (!conversationId) return;
    if (conversationId !== previousConversationIdRef.current) {
      previousConversationIdRef.current = conversationId;
      previousMessageCountRef.current = conversationDetail.messages.length;
      setPendingUnreadCount(0);
      setIsAtBottom(true);
      isAtBottomRef.current = true;
      requestAnimationFrame(() => {
        scrollToBottom(false);
        requestAnimationFrame(() => handleMessagesScroll());
      });
      return;
    }

    if (conversationDetail.messages.length > previousMessageCountRef.current) {
      const lastMessage = conversationDetail.messages[conversationDetail.messages.length - 1];
      const shouldAutoScroll = isAtBottomRef.current;
      if (shouldAutoScroll) {
        requestAnimationFrame(() => scrollToBottom(true));
      } else if (lastMessage?.sender_id !== currentUser?.id) {
        setPendingUnreadCount((prev) => prev + 1);
      }
      previousMessageCountRef.current = conversationDetail.messages.length;
    }
  }, [conversationDetail, currentUser?.id]);

  const activeOtherUser = conversationDetail?.other_user;
  const presence = activeOtherUser ? presenceMap[activeOtherUser.id] : null;
  const isOnline = presence?.status === "online";
  const presenceKnown = presence?.status === "online" || presence?.status === "offline";

  const isPending = conversationDetail?.conversation?.status === "pending";
  const isRequester = conversationDetail?.conversation?.requester_id === currentUser?.id;
  const canSend = conversationDetail?.can_send;
  const typingActive = activeConversationId ? typingMap[activeConversationId] : false;
  const hasActiveConversation = Boolean(activeConversationId);

  const parseTimestamp = (iso) => {
    if (!iso) return null;
    if (iso.endsWith("Z") || iso.match(/[+-]\d{2}:\d{2}$/)) {
      return new Date(iso);
    }
    return new Date(`${iso}Z`);
  };

  const formatTimestamp = (iso) => {
    const date = parseTimestamp(iso);
    if (!date) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  };

  const resolveAvatar = (path) => {
    if (!path) return null;
    return resolveHostedAssetUrl(path);
  };

  const updateInboxPreview = (conversationId, body, createdAt, options = {}) => {
    const { isIncoming = false, isActive = false } = options;
    setInbox((prev) => {
      const idx = prev.findIndex((item) => item.conversation.id === conversationId);
      if (idx === -1) return prev;
      const item = prev[idx];
      const updated = {
        ...item,
        conversation: {
          ...item.conversation,
          last_message_preview: previewText(body),
          last_message_at: createdAt,
        },
        unread_count: isIncoming
          ? (isActive ? 0 : (item.unread_count || 0) + 1)
          : item.unread_count,
      };
      const next = prev.slice();
      next.splice(idx, 1);
      return [updated, ...next];
    });
  };

  const updateRequestPreview = (conversationId, body, createdAt) => {
    setRequests((prev) => {
      const idx = prev.findIndex((item) => item.conversation.id === conversationId);
      if (idx === -1) return prev;
      const item = prev[idx];
      const updated = {
        ...item,
        preview_message: previewText(body),
        last_message_at: createdAt,
      };
      const next = prev.slice();
      next.splice(idx, 1);
      return [updated, ...next];
    });
  };

  const addConversationToInbox = (detail) => {
    if (!detail?.conversation || !detail?.other_user) return;
    setInbox((prev) => {
      const idx = prev.findIndex((item) => item.conversation.id === detail.conversation.id);
      const next = prev.slice();
      if (idx !== -1) {
        next.splice(idx, 1);
      }
      const presenceInfo = presenceMap[detail.other_user.id];
      const summary = {
        conversation: detail.conversation,
        other_user: detail.other_user,
        unread_count: 0,
        online_status: presenceInfo?.status,
        last_seen_at: presenceInfo?.last_seen_at,
        is_request_sent: detail.conversation.status === "pending" && detail.conversation.requester_id === currentUser?.id,
        block_state: detail.block_state || "none",
      };
      return [summary, ...next];
    });
  };

  const scrollToBottom = (smooth = true) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    setPendingUnreadCount(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const threshold = 120;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = distanceFromBottom < threshold;
    setIsAtBottom(atBottom);
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setPendingUnreadCount(0);
    }
  };

  const handleOpenNewMessage = () => {
    setNewMessageOpen(true);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedUser(null);
    setNewMessageText("");
    setNewMessageError("");
    setNewMessageSending(false);
  };

  const handleCloseNewMessage = () => {
    setNewMessageOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedUser(null);
    setNewMessageText("");
    setNewMessageError("");
    setNewMessageSending(false);
  };

  const handleStartConversation = async () => {
    if (newMessageSending) return;
    if (!selectedUser) {
      setNewMessageError("Select a user to message.");
      return;
    }
    if (!newMessageText.trim()) {
      setNewMessageError("Message cannot be empty.");
      return;
    }
    setNewMessageSending(true);
    setNewMessageError("");
    try {
      const res = await api.post("/messages/conversation/start", {
        target_user_id: selectedUser.id,
        initial_message: newMessageText.trim(),
      });
      handleCloseNewMessage();
      setActiveTab("inbox");
      navigate(`/messages/${res.data.conversation.id}`);
    } catch (err) {
      console.error(err);
      setNewMessageError("Unable to start conversation.");
    } finally {
      setNewMessageSending(false);
    }
  };

  const handleSelectConversation = (conversationId) => {
    setActiveConversationId(conversationId);
    loadConversation(conversationId);
    navigate(`/messages/${conversationId}`);
  };

  const handleBackToList = () => {
    setActiveConversationId(null);
    setMenuOpen(false);
    navigate("/messages");
  };

  const handleSend = async (event) => {
    event.preventDefault();
    if (isSendingRef.current) return;
    if (!messageBody.trim() || !activeConversationId) return;
    const trimmedBody = messageBody.trim();
    const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    setConversationDetail((prev) => {
      if (!prev) return prev;
      const optimisticMessage = {
        id: clientMessageId,
        conversation_id: activeConversationId,
        sender_id: currentUser?.id,
        body: trimmedBody,
        created_at: createdAt,
        delivered_at: createdAt,
        read_at: null,
        client_message_id: clientMessageId,
      };
      return {
        ...prev,
        conversation: {
          ...prev.conversation,
          last_message_preview: previewText(trimmedBody),
          last_message_at: createdAt,
        },
        messages: [...prev.messages, optimisticMessage],
      };
    });
    updateInboxPreview(activeConversationId, trimmedBody, createdAt, { isIncoming: false, isActive: true });
    isSendingRef.current = true;
    setIsSending(true);
    try {
      const res = await api.post(`/messages/conversation/${activeConversationId}/send`, {
        body: trimmedBody,
        client_message_id: clientMessageId,
      });
      setConversationDetail((prev) => {
        if (!prev) return prev;
        const updatedMessages = prev.messages.map((msg) =>
          msg.client_message_id === clientMessageId || msg.id === clientMessageId ? res.data : msg
        );
        const updated = { ...prev, messages: updatedMessages };
        if (prev.conversation?.status === "pending" && prev.conversation?.requester_id === currentUser?.id) {
          updated.can_send = false;
        }
        return updated;
      });
      sendRealtimeMessage({ type: "add", message: res.data });
      setMessageBody("");
      loadInbox();
      if (conversationDetail?.conversation?.status === "pending") {
        refreshConversation(activeConversationId);
      }
      socketRef.current?.emit("typing:stop", { conversation_id: activeConversationId });
    } catch (err) {
      console.error(err);
      setError("Unable to send message.");
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  };

  const handleAccept = async () => {
    if (!activeConversationId) return;
    const conversationId = activeConversationId;
    try {
      const res = await api.post(`/messages/conversation/${activeConversationId}/accept`);
      setConversationDetail(res.data);
      setRequests((prev) => prev.filter((item) => item.conversation.id !== conversationId));
      addConversationToInbox(res.data);
      loadInbox();
      loadRequests();
    } catch (err) {
      console.error(err);
      setError("Unable to accept request.");
    }
  };

  const handleDecline = async () => {
    if (!activeConversationId) return;
    const conversationId = activeConversationId;
    try {
      await api.post(`/messages/conversation/${activeConversationId}/decline`);
      setRequests((prev) => prev.filter((item) => item.conversation.id !== conversationId));
      setConversationDetail(null);
      setActiveConversationId(null);
      navigate("/messages");
      loadInbox();
      loadRequests();
    } catch (err) {
      console.error(err);
      setError("Unable to decline request.");
    }
  };

  const handleBlockToggle = async () => {
    if (!activeOtherUser) return;
    try {
      if (conversationDetail?.block_state === "blocked_by_me") {
        await api.post(`/users/${activeOtherUser.id}/unblock`);
        refreshConversation(activeConversationId);
      } else {
        await api.post(`/users/${activeOtherUser.id}/block`);
        setConversationDetail(null);
        setActiveConversationId(null);
        navigate("/messages");
      }
      setMenuOpen(false);
      loadInbox();
      loadRequests();
    } catch (err) {
      console.error(err);
      setError("Unable to update block status.");
    }
  };

  const handleTypingChange = (value) => {
    if (isSendingRef.current) return;
    setMessageBody(value);
    if (!socketRef.current || !activeConversationId) return;
    if (isPending || !canSend) return;
    const now = Date.now();
    if (now - typingThrottleRef.current.lastSent > 1000) {
      socketRef.current.emit("typing:start", { conversation_id: activeConversationId });
      typingThrottleRef.current.lastSent = now;
    }
    if (typingThrottleRef.current.timeoutId) {
      clearTimeout(typingThrottleRef.current.timeoutId);
    }
    typingThrottleRef.current.timeoutId = setTimeout(() => {
      socketRef.current?.emit("typing:stop", { conversation_id: activeConversationId });
    }, 4000);
  };

  const handleTypingBlur = () => {
    if (!socketRef.current || !activeConversationId) return;
    if (typingThrottleRef.current.timeoutId) {
      clearTimeout(typingThrottleRef.current.timeoutId);
      typingThrottleRef.current.timeoutId = null;
    }
    socketRef.current.emit("typing:stop", { conversation_id: activeConversationId });
  };

  const renderConversationItem = (item) => {
    const { conversation, other_user, unread_count, is_request_sent, block_state } = item;
    const isActive = conversation.id === activeConversationId;
    const otherPresence = presenceMap[other_user.id];
    const otherOnline = otherPresence?.status === "online";
    const preview = block_state === "blocked_by_me"
      ? "Blocked"
      : is_request_sent
        ? "Request sent"
        : conversation.last_message_preview || "No messages yet";
    return (
      <motion.div
        key={conversation.id}
        className={`message-item ${isActive ? "active" : ""}`}
        onClick={() => handleSelectConversation(conversation.id)}
        whileHover={{ y: -2 }}
      >
        <div className="message-avatar">
          {other_user.profile_picture_path ? (
            <img src={resolveAvatar(other_user.profile_picture_path)} alt="avatar" />
          ) : (
            <FiUser />
          )}
          {otherPresence && <span className={`online-dot ${otherOnline ? "online" : ""}`} />}
        </div>
        <div className="message-meta">
          <div className="message-row">
            <div className="message-name">
              {other_user.display_name}
              {other_user.is_admin && <VerifiedBadge size={14} />}
            </div>
            <div className="message-time">{formatTimestamp(conversation.last_message_at || conversation.created_at)}</div>
          </div>
          <div className="message-preview">
            {block_state === "blocked_by_me" && <FiLock size={12} />} {preview}
          </div>
        </div>
        {unread_count > 0 && <div className="unread-badge">{unread_count}</div>}
      </motion.div>
    );
  };

  const renderRequestItem = (item) => {
    const { conversation, other_user, preview_message, last_message_at } = item;
    const isActive = conversation.id === activeConversationId;
    return (
      <motion.div
        key={conversation.id}
        className={`message-item ${isActive ? "active" : ""}`}
        onClick={() => handleSelectConversation(conversation.id)}
        whileHover={{ y: -2 }}
      >
        <div className="message-avatar">
          {other_user.profile_picture_path ? (
            <img src={resolveAvatar(other_user.profile_picture_path)} alt="avatar" />
          ) : (
            <FiUser />
          )}
        </div>
        <div className="message-meta">
          <div className="message-row">
            <div className="message-name">
              {other_user.display_name}
              {other_user.is_admin && <VerifiedBadge size={14} />}
            </div>
            <div className="message-time">{formatTimestamp(last_message_at)}</div>
          </div>
          <div className="message-preview">{preview_message || "Message request"}</div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className={`container messages-page ${hasActiveConversation ? "show-thread" : "show-list"}`}>
      <div className="panel messages-sidebar" aria-hidden={hasActiveConversation}>
        <div className="panel-header messages-header">
          <div className="messages-title">
            <FiMessageCircle /> Messages
            <button className="icon-btn new-message-btn" onClick={handleOpenNewMessage}>
              <FiPlus />
            </button>
          </div>
          <div className="tabs messages-tabs">
            <button
              className={`tab ${activeTab === "inbox" ? "active" : ""}`}
              onClick={() => setActiveTab("inbox")}
            >
              Inbox
            </button>
            <button
              className={`tab ${activeTab === "requests" ? "active" : ""}`}
              onClick={() => setActiveTab("requests")}
            >
              Requests {requests.length > 0 && <span className="tab-count">{requests.length}</span>}
            </button>
          </div>
        </div>
        {error && <div className="messages-error">{error}</div>}
        <div className="panel-body messages-list">
          {activeTab === "inbox" && inbox.length === 0 && (
            <div className="messages-empty">No conversations yet.</div>
          )}
          {activeTab === "requests" && requests.length === 0 && (
            <div className="messages-empty">No requests pending.</div>
          )}
          {activeTab === "inbox" && inbox.map(renderConversationItem)}
          {activeTab === "requests" && requests.map(renderRequestItem)}
        </div>
      </div>

      <div className="panel messages-thread" aria-hidden={!hasActiveConversation}>
        {!activeConversationId && (
          <div className="thread-empty">
            <FiMessageCircle size={40} />
            <h3>Select a conversation</h3>
            <p>Choose a chat or request to start messaging.</p>
          </div>
        )}

        {activeConversationId && loadingThread && (
          <div className="thread-empty">Loading conversation...</div>
        )}

        {activeConversationId && conversationDetail && (
          <div className="thread-content">
            <div className="panel-header thread-header">
              <div className="thread-user">
                <button className="icon-btn thread-back-btn" onClick={handleBackToList}>
                  <FiChevronLeft />
                </button>
                <div
                  className="message-avatar large clickable"
                  onClick={() => {
                    if (!activeOtherUser) return;
                    const path = toProfilePath(activeOtherUser);
                    if (path) navigate(path);
                  }}
                >
                  {activeOtherUser?.profile_picture_path ? (
                    <img src={resolveAvatar(activeOtherUser.profile_picture_path)} alt="avatar" />
                  ) : (
                    <FiUser />
                  )}
                  {presenceKnown && <span className={`online-dot ${isOnline ? "online" : ""}`} />}
                </div>
                <div>
                  <div
                    className="thread-name clickable"
                    onClick={() => {
                      if (!activeOtherUser) return;
                      const path = toProfilePath(activeOtherUser);
                      if (path) navigate(path);
                    }}
                  >
                    {activeOtherUser?.display_name}
                    {activeOtherUser?.is_admin && <VerifiedBadge size={14} />}
                  </div>
                  <div className="thread-status">
                    {presenceKnown && (isOnline ? "Online" : "Offline")}
                    {presenceKnown && presence?.last_seen_at && !isOnline && (
                      <span> · Last active {formatTimestamp(presence.last_seen_at)}</span>
                    )}
                    {isPending && <span className="thread-pending"> · Pending</span>}
                    {typingActive && !isPending && <span className="thread-typing"> · Typing...</span>}
                  </div>
                </div>
              </div>
              <div className="thread-actions">
                {isPending && !isRequester && (
                  <div className="thread-request-actions">
                    <button className="btn-secondary" onClick={handleAccept}>
                      <FiCheck /> Accept
                    </button>
                    <button className="btn-ghost danger" onClick={handleDecline}>
                      <FiX /> Decline
                    </button>
                  </div>
                )}
                <button className="icon-btn" onClick={() => setMenuOpen((prev) => !prev)}>
                  <FiMoreVertical />
                </button>
                {menuOpen && (
                  <div className="thread-menu">
                    {activeOtherUser?.is_admin ? (
                      <button className="menu-item" disabled>
                        Admins cannot be blocked
                      </button>
                    ) : (
                      <button className="menu-item" onClick={handleBlockToggle}>
                        {conversationDetail?.block_state === "blocked_by_me" ? "Unblock user" : "Block user"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="thread-body">
              {conversationDetail.block_state === "blocked_by_me" && (
                <div className="request-locked">
                  <FiLock /> You blocked this user. Unblock to view history or message again.
                </div>
              )}

              <div className="thread-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
                {conversationDetail.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-bubble ${msg.sender_id === currentUser?.id ? "sent" : "received"}`}
                  >
                    <div className="bubble-body">{msg.body}</div>
                    <div className="bubble-time">{formatTimestamp(msg.created_at)}</div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {!isAtBottom && (
                <button className="scroll-to-bottom" onClick={() => scrollToBottom(true)}>
                  <FiArrowDown />
                  {pendingUnreadCount > 0 && (
                    <span className="scroll-count">{pendingUnreadCount}</span>
                  )}
                </button>
              )}

              {isPending && isRequester && !canSend && (
                <div className="request-locked">
                  <FiLock /> Request sent. You can message after they accept.
                </div>
              )}

              {!isPending && canSend && (
                <form className="thread-input" onSubmit={handleSend}>
                  <input
                    className="input"
                    placeholder="Type a message..."
                    value={messageBody}
                    onChange={(e) => handleTypingChange(e.target.value)}
                    onBlur={handleTypingBlur}
                    disabled={isSending}
                  />
                  <button className="btn-primary" type="submit" disabled={isSending || !messageBody.trim()}>
                    <FiSend />
                  </button>
                </form>
              )}

              {isPending && isRequester && canSend && (
                <form className="thread-input" onSubmit={handleSend}>
                  <input
                    className="input"
                    placeholder="Send your one request message..."
                    value={messageBody}
                    onChange={(e) => handleTypingChange(e.target.value)}
                    onBlur={handleTypingBlur}
                    disabled={isSending}
                  />
                  <button className="btn-primary" type="submit" disabled={isSending || !messageBody.trim()}>
                    <FiSend />
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {newMessageOpen && (
        <div className="modal-overlay messages-modal" onClick={handleCloseNewMessage}>
          <motion.div
            className="modal-card messages-modal-card"
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <div className="messages-modal-header">
              <h3>New message</h3>
              <button className="icon-btn" onClick={handleCloseNewMessage}>
                <FiX />
              </button>
            </div>
            <div className="messages-modal-body">
              <div className="messages-search">
                <FiSearch />
                <input
                  className="input"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedUser(null);
                  }}
                />
              </div>
              {searchLoading && <div className="messages-empty">Searching...</div>}
              {!searchLoading && searchResults.length === 0 && searchQuery && (
                <div className="messages-empty">No users found.</div>
              )}
              <div className="messages-search-results">
                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    className={`search-result ${selectedUser?.id === result.id ? "active" : ""}`}
                    onClick={() => {
                      setSelectedUser(result);
                      setNewMessageError("");
                    }}
                  >
                    <div className="message-avatar">
                      {result.profile_picture_path ? (
                        <img src={resolveAvatar(result.profile_picture_path)} alt="avatar" />
                      ) : (
                        <FiUser />
                      )}
                    </div>
                    <div className="message-meta">
                      <div className="message-name">
                        {result.display_name}
                        {result.is_admin && <VerifiedBadge size={14} />}
                      </div>
                      <div className="message-preview">@{result.username}</div>
                    </div>
                  </button>
                ))}
              </div>
              <textarea
                className="input"
                rows={3}
                placeholder={selectedUser ? `Message @${selectedUser.username}...` : "Write your message..."}
                value={newMessageText}
                onChange={(e) => setNewMessageText(e.target.value)}
              />
              {newMessageError && <div className="messages-error">{newMessageError}</div>}
              <button
                className="btn-primary"
                onClick={handleStartConversation}
                disabled={newMessageSending || !selectedUser || !newMessageText.trim()}
              >
                {newMessageSending ? "Sending..." : "Send message"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
