import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from "react";
import {
  Shield, Search, ChevronLeft, Phone, Video, MoreVertical,
  Check, QrCode, X, ArrowDown, BellOff, Archive, ChevronDown, Flag,
  Users, MessageCircle, AlertTriangle,
  ChevronRight, Loader2, Ban, Lock, ShieldCheck
} from "lucide-react";
import Login from "./components/Login";
import MessageBubble from "./components/MessageBubble";
import DayDivider, { groupMessagesByDay } from "./components/DayDivider";
import { ChatListSkeleton, MessageSkeleton } from "./components/Skeletons";
import { useReadReceipts } from "./hooks/useReadReceipts";
import ErrorBoundary from "./components/ErrorBoundary";
import PendingApproval from "./components/PendingApproval";
import RejectedApproval from "./components/RejectedApproval";
import DeactivatedAccount from "./components/DeactivatedAccount";
import ChatComposer from "./components/ChatComposer";
import MobileNav from "./components/MobileNav";
import UserProfileCard from "./components/UserProfileCard";
import IncomingCall from "./components/IncomingCall";
// Nadiren mount edilen ekranlar: ilk yükleme paketinden çıkarılır (bundle code-splitting).
const UpdatePassword = lazy(() => import("./components/UpdatePassword"));
const UserSettings = lazy(() => import("./components/UserSettings"));
const AdminPanel = lazy(() => import("./components/AdminPanel"));
const ProfileAccount = lazy(() => import("./components/ProfileAccount"));
const MessageRequests = lazy(() => import("./components/MessageRequests"));
const CallScreen = lazy(() => import("./components/CallScreen"));
import NotificationBell from "./components/NotificationBell";
import NotificationPanel from "./components/NotificationPanel";
import ChatLockScreen from "./components/ChatLockScreen";
import ChatSecuritySettings from "./components/ChatSecuritySettings";
import LiveDraftBubble from "./components/LiveDraftBubble";
import { useAuth } from "./hooks/useAuth";
import { useMessages } from "./hooks/useMessages";
import { useConversations } from "./hooks/useConversations";
import { useUnreadCount } from "./hooks/useUnreadCount";
import { usePresence } from "./hooks/usePresence";
import { useTyping } from "./hooks/useTyping";
import { useUserSearch } from "./hooks/useUserSearch";
import { useMessageRequests } from "./hooks/useMessageRequests";
import { useVisualViewport } from "./hooks/useVisualViewport";
import { useCall } from "./hooks/useCall";
import { useNotifications } from "./hooks/useNotifications";
import { useChatLock } from "./hooks/useChatLock";
import { useLiveTyping } from "./hooks/useLiveTyping";
import { getLockedConversationIds } from "./services/chatLocks";
import { signOut } from "./services/auth";
import { blockUser, reportContent } from "./services/moderation";
import { searchMessages, setMuted, setArchived, setDisappearingMessages } from "./services/chat";
import { acceptMessageRequest, rejectMessageRequest, cancelMessageRequest } from "./services/messageRequests";
import { searchIncludes } from "./lib/searchText";
import { ensurePushSubscription, isPushConfigured } from "./lib/push";
import { clearAppBadgeCount } from "./lib/badge";
import { getSettings } from "./services/profiles";

/* ============================================================
   NEXA CHAT — v2 görsel sistem (Supabase, üretim yakını)
   ============================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root{
  --ink0:#05070A; --ink1:#0A0D12; --ink2:#10141B; --ink3:#161C26;
  --line:rgba(255,255,255,0.06); --line2:rgba(255,255,255,0.11);
  --txt:#EDF1F7; --txt2:#9AA4B5; --txt3:#5E6878;
  --blue:#4D9EFF; --blue-ink:#16273D; --blue-line:rgba(77,158,255,0.22);
  --green:#3ECF8E; --warn:#E0A458; --red:#E5484D; --violet:#8B7CF6;
  --shadow-sm:0 4px 14px -8px rgba(0,0,0,0.6);
  --shadow-md:0 12px 32px -16px rgba(0,0,0,0.7);
  --shadow-lg:0 24px 56px -20px rgba(0,0,0,0.75);
  --ease-premium:cubic-bezier(.2,.8,.2,1);
  --dur-fast:120ms; --dur-base:200ms; --dur-slow:320ms;
}
*{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
.nx-root{font-family:'Manrope',sans-serif; color:var(--txt); background:var(--ink0); font-feature-settings:'ss01';}
.nx-display{font-family:'Sora',sans-serif; letter-spacing:-0.02em;}
.nx-mono{font-family:'JetBrains Mono',monospace;}

.nx-surface{ background:var(--ink2); border:1px solid var(--line); }
.nx-raised{ background:linear-gradient(180deg, var(--ink3), var(--ink2)); border:1px solid var(--line); box-shadow:0 12px 32px -16px rgba(0,0,0,0.7); }
.nx-hairline-b{ border-bottom:1px solid var(--line); }
.nx-scroll{scrollbar-width:none;} .nx-scroll::-webkit-scrollbar{display:none;}
/* TEK viewport: visualViewport.height/top. Klavye yüksekliği ikinci kez düşülmez. */
.nx-viewport{
  position:fixed; left:0; right:0;
  top: var(--visual-viewport-top, 0px);
  height: var(--visual-viewport-height, 100dvh);
  max-height: var(--visual-viewport-height, 100dvh);
  overflow: hidden;
  display: flex;
  flex-direction: row;
  justify-content: center;
}
.nx-safe-t{padding-top:env(safe-area-inset-top);}
.nx-safe-b{padding-bottom:env(safe-area-inset-bottom);}

/* Composer: document flow. Klavye açıkken safe-area YOK (siyah boşluk kaynağı buydu). */
:root{
  --composer-pad-bottom: max(8px, env(safe-area-inset-bottom, 0px));
  --bottom-nav-height: auto;
}
html[data-keyboard-open="true"]{
  --composer-pad-bottom: 8px;
  --bottom-nav-height: 0px;
}
.composer-wrapper, .nx-composer{
  position: relative;
  flex: 0 0 auto;
  min-height: 52px;
  margin: 0;
  bottom: auto;
  transform: none;
  padding-bottom: var(--composer-pad-bottom);
}
html[data-keyboard-open="true"] .composer-wrapper,
html[data-keyboard-open="true"] .nx-composer{
  padding-bottom: 8px;
  margin-bottom: 0;
}
html:not([data-keyboard-open="true"]) .composer-wrapper,
html:not([data-keyboard-open="true"]) .nx-composer{
  padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
}
/* Odak varken (detection gecikse bile) safe-area'yı düşürme — aksesuar çubuğu üstü boşluk. */
.nx-chat-page:focus-within .composer-wrapper,
.nx-chat-page:focus-within .nx-composer{
  padding-bottom: 8px !important;
  margin-bottom: 0 !important;
}

html[data-keyboard-open="true"] .nx-mobile-nav,
html[data-keyboard-open="true"] .bottom-navigation{
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
  pointer-events: none !important;
}

.nx-chat-page{
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.nx-chat-header{ flex: 0 0 auto; }
.nx-messages-container{
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

*{overflow-wrap:break-word;}
html,body,#root{height:100%; overflow:hidden; background:var(--ink0,#05070A);}
html,body{overflow-x:hidden; overscroll-behavior:none;}

@keyframes nxMeshA { 0%,100%{transform:translate3d(-4%,-2%,0) scale(1)} 50%{transform:translate3d(4%,3%,0) scale(1.08)} }
@keyframes nxMeshB { 0%,100%{transform:translate3d(3%,4%,0) scale(1.05)} 50%{transform:translate3d(-3%,-3%,0) scale(1)} }
@keyframes nxIn { from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:none} }
@keyframes nxSheet { from{opacity:0; transform:translateY(24px)} to{opacity:1; transform:none} }
@keyframes nxDash { to{stroke-dashoffset:-160} }
@keyframes nxDot { 0%,100%{opacity:.4} 50%{opacity:1} }
@keyframes nxTwinkle { 0%,100%{opacity:.15; transform:scale(1)} 50%{opacity:.6; transform:scale(1.3)} }
@keyframes nxPop { 0%{transform:scale(.7); opacity:0} 60%{transform:scale(1.08); opacity:1} 100%{transform:scale(1)} }
@keyframes nxShimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }

.nx-in{animation:nxIn .32s var(--ease-premium) both;}
.nx-sheet{animation:nxSheet .34s var(--ease-premium) both;}
.nx-pop{animation:nxPop .28s var(--ease-premium) both;}

.nx-btn-primary{ background:var(--txt); color:#0B0E13; font-weight:600; transition:transform .15s ease, opacity .15s ease; }
.nx-btn-primary:active{transform:scale(.98); opacity:.9;}

.nx-shimmer{
  background:linear-gradient(90deg, var(--ink2) 25%, var(--ink3) 37%, var(--ink2) 63%);
  background-size:400% 100%;
  animation:nxShimmer 1.4s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce){ .nx-root *{animation-duration:.001s !important; transition-duration:.001s !important;} }
`;

/* ---------------- helpers ---------------- */
function fmtTime(ts) {
  if (!ts) return "";
  try { return new Date(ts).toTimeString().slice(0, 5); } catch { return ""; }
}
function toneFromId(id) {
  const palette = ["#4D9EFF", "#8B7CF6", "#3ECF8E", "#E0A458", "#4DD0E1", "#F06292", "#E5484D"];
  const s = String(id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
function shortId(id) {
  const s = String(id || "").replace(/-/g, "").toUpperCase();
  return (s.slice(0, 4) || "····") + "··" + (s.slice(4, 8) || "····");
}
function nameOf(p) { return p?.display_name || p?.username || "Bilinmeyen"; }
function convToContact(conv) {
  if (!conv) return { id: null, otherId: null, name: "Sohbet", tone: "#4D9EFF", online: false, device: "", key: "", handle: "" };
  const others = Array.isArray(conv.others) ? conv.others : [];
  const other = others[0];
  const group = conv.type === "group" || conv.is_group;
  const name = group ? (conv?.title || "Grup") : nameOf(other);
  const idForTone = other?.id || conv?.id;
  return {
    id: conv?.id,
    otherId: other?.id || null,
    name,
    tone: toneFromId(idForTone),
    online: !!other?.is_online,
    avatarUrl: group ? conv?.avatar_url : other?.avatar_url,
    device: group ? `${conv?.members?.length || 0} üye` : (other?.is_online ? "çevrimiçi" : (other?.username ? "@" + other.username : "doğrudan mesaj")),
    key: shortId(conv?.id),
    handle: other?.username ? "@" + other.username : "",
    isGroup: group,
  };
}

/* ---------------- background ---------------- */
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";
const STARS = [
  { x: "8%", y: "12%", s: 1.5, d: "5s", dl: "0s", o: 0.5 }, { x: "22%", y: "6%", s: 1, d: "7s", dl: "1.2s", o: 0.35 },
  { x: "37%", y: "16%", s: 1, d: "6s", dl: "2.4s", o: 0.4 }, { x: "52%", y: "9%", s: 1.5, d: "8s", dl: "0.6s", o: 0.45 },
  { x: "68%", y: "14%", s: 1, d: "5.5s", dl: "3s", o: 0.35 }, { x: "81%", y: "7%", s: 1.5, d: "7.5s", dl: "1.8s", o: 0.5 },
  { x: "91%", y: "18%", s: 1, d: "6.5s", dl: "0.9s", o: 0.35 }, { x: "15%", y: "26%", s: 1, d: "9s", dl: "2s", o: 0.3 },
];

function Field() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e) => {
      const t = e.touches ? e.touches[0] : e;
      if (!t) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = (t.clientX / window.innerWidth - 0.5) * 12;
        const y = (t.clientY / window.innerHeight - 0.5) * 12;
        el.style.setProperty("--px", `${x}px`);
        el.style.setProperty("--py", `${y}px`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,#04060B 0%,#070A11 42%,#0A0E16 72%,#0C1019 100%)" }} />
      <div className="absolute w-[160%] h-[46%] -top-[10%] -left-[30%] will-change-transform"
        style={{ background: "radial-gradient(ellipse 55% 60% at 50% 30%, rgba(58,96,150,0.28), rgba(40,66,104,0.10) 55%, transparent 75%)", filter: "blur(30px)", animation: "nxMeshA 30s ease-in-out infinite", transform: "translate(var(--px,0),var(--py,0))" }} />
      <div className="absolute w-[130%] h-[36%] top-[4%] -right-[25%] will-change-transform"
        style={{ background: "radial-gradient(ellipse 60% 55% at 55% 40%, rgba(96,120,158,0.14), transparent 70%)", filter: "blur(26px)", animation: "nxMeshB 38s ease-in-out infinite" }} />
      {STARS.map((st, i) => (
        <span key={i} className="absolute rounded-full"
          style={{ left: st.x, top: st.y, width: st.s, height: st.s, background: "#C8D6EE", opacity: st.o, animation: `nxTwinkle ${st.d} ease-in-out infinite`, animationDelay: st.dl }} />
      ))}
      <div className="absolute inset-0 opacity-[0.045] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
    </div>
  );
}

function Avatar({ contact, size = 44 }) {
  const url = contact?.avatarUrl;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full overflow-hidden flex items-center justify-center nx-display font-semibold"
        style={{ background: "var(--ink3)", border: "1px solid var(--line2)", borderRadius: "31%", color: contact?.tone, fontSize: size * 0.36 }}>
        {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : (contact?.name || "?")[0]}
      </div>
      {contact?.online && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full" style={{ width: size * 0.24, height: size * 0.24, background: "var(--green)", border: "2px solid var(--ink0)" }} />
      )}
    </div>
  );
}

function CenterState({ icon: Icon, title, subtitle, tone = "var(--txt3)" }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-12 nx-in">
      {Icon && <Icon size={22} style={{ color: tone }} />}
      <p className="text-[13.5px] font-semibold mt-3" style={{ color: "var(--txt2)" }}>{title}</p>
      {subtitle && <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--txt3)" }}>{subtitle}</p>}
    </div>
  );
}

/* ---------------- Chat view ---------------- */
function ChatView({ contact, conversationId, meId, meEmail, onBack, onBlock, onReport, onAudioCall, onVideoCall, onLockChange, disappearingSeconds, onSetDisappearing }) {
  const lock = useChatLock(conversationId);
  const live = useLiveTyping(conversationId, meId);
  const [reloadToken, setReloadToken] = useState(0);
  const {
    messages, reactions, loading, loadingOlder, hasMore, error, sending,
    send, edit, remove, react, unreact, loadOlder, jumpToMessage,
  } = useMessages(conversationId, meId, reloadToken, !!disappearingSeconds);
  const { typingUsers, notifyTyping } = useTyping(conversationId, meId);
  const { statusFor } = useReadReceipts(conversationId, meId, contact.isGroup);

  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [menu, setMenu] = useState(false);
  const [secOpen, setSecOpen] = useState(false);
  const [mediaErr, setMediaErr] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [highlightId, setHighlightId] = useState(null);
  const listRef = useRef(null);
  const lastIdRef = useRef(null);
  const searchDebounceRef = useRef(null);

  const requiresPin = !!lock.status?.requires_pin;
  // Kilit açıldığında mesajları yeniden çek (RLS kilitliyken boş döner).
  const prevReq = useRef(requiresPin);
  useEffect(() => {
    if (prevReq.current && !requiresPin) setReloadToken((t) => t + 1);
    prevReq.current = requiresPin;
    onLockChange?.();
  }, [requiresPin, onLockChange]);
  const nearBottomRef = useRef(true); // kullanıcı en altta mı?

  const reactionsByMsg = useMemo(() => {
    const map = {};
    for (const r of reactions) (map[r.message_id] ||= []).push(r);
    return map;
  }, [reactions]);

  const dayGroups = useMemo(() => groupMessagesByDay(messages), [messages]);

  // Pencereyi DEĞİL, yalnızca mesaj listesi kabını kaydır (window.scrollTo yok).
  const scrollListToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.id !== lastIdRef.current) {
      const firstRender = lastIdRef.current === null;
      lastIdRef.current = last.id;
      // Yalnızca kullanıcı altta ise veya mesaj kendisininse otomatik kaydır.
      if (firstRender || nearBottomRef.current || last.sender_id === meId) {
        scrollListToBottom(!firstRender);
        setNewCount(0);
      } else {
        setNewCount((c) => c + 1);
      }
    }
  }, [messages, meId, scrollListToBottom]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollTop < 48 && hasMore && !loadingOlder) loadOlder();
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < 120;
    nearBottomRef.current = atBottom;
    if (atBottom) setNewCount(0);
  };

  const jumpToBottom = () => { scrollListToBottom(true); setNewCount(0); };

  // Composer focus + iOS klavye animasyonu: yalnızca kullanıcı altta ise kaydır.
  const onComposerFocus = useCallback(() => {
    if (!nearBottomRef.current) return;
    const kick = () => { if (nearBottomRef.current) scrollListToBottom(false); };
    requestAnimationFrame(kick);
    setTimeout(kick, 120);
    setTimeout(kick, 320);
  }, [scrollListToBottom]);

  // visualViewport resize (klavye): altta ise son mesaja hizala; eski mesaj okuyorsa zorlamaz.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const onVv = () => {
      if (nearBottomRef.current) scrollListToBottom(false);
    };
    vv.addEventListener("resize", onVv);
    return () => vv.removeEventListener("resize", onVv);
  }, [scrollListToBottom]);

  // Sohbet içi arama: debounce + sunucu taraflı arama (mevcut RLS'e tabi).
  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    if (!searchOpen || !searchQuery.trim()) { setSearchResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const rows = await searchMessages(conversationId, searchQuery, 30);
        setSearchResults(rows);
      } catch (_) {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(searchDebounceRef.current);
  }, [searchQuery, searchOpen, conversationId]);

  const jumpToSearchResult = async (result) => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    await jumpToMessage(result.id, result.created_at);
    setHighlightId(result.id);
    setTimeout(() => {
      listRef.current?.querySelector(`[data-msg-id="${result.id}"]`)?.scrollIntoView({ block: "center" });
    }, 60);
    setTimeout(() => setHighlightId(null), 1600);
  };

  const submit = () => {
    const t = input.trim();
    if (editingId) {
      if (t) edit(editingId, t);
      setEditingId(null);
      setInput("");
      return;
    }
    if (!t || sending) return;
    send(t, { replyToId: replyTo?.id || null });
    setInput("");
    setReplyTo(null);
    live.clearDraft();
    lock.touch();
  };

  const onMediaUploaded = (meta) => {
    setMediaErr("");
    send(meta.name || "Medya", { messageType: meta.kind, metadata: meta, replyToId: replyTo?.id || null });
    setReplyTo(null);
  };

  const toggleReaction = (messageId, emoji) => {
    const mine = (reactionsByMsg[messageId] || []).some((r) => r.user_id === meId && r.emoji === emoji);
    if (mine) unreact(messageId, emoji);
    else react(messageId, emoji);
  };

  const startEdit = (m) => { setEditingId(m.id); setInput(m.content || ""); };

  const canCall = !!contact.otherId; // yalnızca birebir sohbette
  return (
    <div className="nx-chat-page absolute inset-0 flex flex-col min-h-0 overflow-hidden nx-in">
      {/* header — kabuk nx-safe-t; burada safe-area ikinci kez eklenmez */}
      <div className="nx-chat-header relative z-20 px-3 pb-2 flex items-center gap-2.5 shrink-0"
        style={{ paddingTop: 12, background: "linear-gradient(180deg, rgba(5,7,10,0.85), rgba(5,7,10,0.4) 80%, transparent)", backdropFilter: "blur(10px)" }}>
        <button type="button" tabIndex={-1} onClick={onBack} className="p-2 -ml-1 rounded-xl active:scale-90 transition-transform" aria-label="Geri">
          <ChevronLeft size={20} style={{ color: "var(--txt2)" }} />
        </button>
        <Avatar contact={contact} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="nx-display font-semibold text-[14px] truncate">{contact.name}</span>
          </div>
          <span className="text-[11px]" style={{ color: "var(--txt3)" }}>
            {typingUsers.length > 0 ? "yazıyor…" : contact.device}
          </span>
        </div>
        <button type="button" tabIndex={-1} onClick={() => setSearchOpen((o) => !o)}
          className="p-2 rounded-xl min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-90 transition-transform"
          style={{ color: searchOpen ? "var(--blue)" : "var(--txt2)" }} aria-label="Sohbette ara"><Search size={17} strokeWidth={1.8} /></button>
        <button type="button" tabIndex={-1} onClick={() => canCall && onVideoCall?.()} disabled={!canCall}
          className="p-2 rounded-xl min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: "var(--txt2)" }} aria-label="Görüntülü arama"><Video size={17} strokeWidth={1.8} /></button>
        <button type="button" tabIndex={-1} onClick={() => canCall && onAudioCall?.()} disabled={!canCall}
          className="p-2 rounded-xl min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: "var(--txt2)" }} aria-label="Sesli arama"><Phone size={16} strokeWidth={1.8} /></button>
        <div className="relative">
          <button type="button" tabIndex={-1} onClick={() => setMenu(!menu)} className="p-2 rounded-xl" aria-label="Menü">
            <MoreVertical size={17} strokeWidth={1.8} style={{ color: "var(--txt2)" }} />
          </button>
          {menu && (
            <div className="absolute right-0 top-11 w-[220px] nx-raised rounded-[24px] p-1.5 z-30 nx-in">
              {contact.otherId ? (
                <>
                  <button type="button" tabIndex={-1} onClick={() => { setSecOpen(true); setMenu(false); }} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-[18px] text-[13.5px] text-left min-h-[44px]">
                    <ShieldCheck size={15} style={{ color: "var(--blue)" }} /> Sohbet Güvenliği
                  </button>
                  <button type="button" tabIndex={-1} onClick={() => { onReport?.(); setMenu(false); }} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-[18px] text-[13.5px] text-left min-h-[44px]">
                    <Flag size={15} style={{ color: "var(--warn)" }} /> Şikâyet Et
                  </button>
                  <button type="button" tabIndex={-1} onClick={() => { onBlock?.(); setMenu(false); }} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-[18px] text-[13.5px] text-left min-h-[44px]" style={{ color: "var(--red)" }}>
                    <Ban size={15} /> Engelle
                  </button>
                </>
              ) : (
                <p className="px-3.5 py-3 text-[12.5px]" style={{ color: "var(--txt3)" }}>Bu sohbet için işlem yok.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className="px-3 pb-2 z-20 shrink-0 nx-sheet">
          <div className="nx-surface rounded-[18px] flex items-center gap-2.5 px-4 h-11">
            <Search size={14} style={{ color: "var(--txt3)" }} />
            <input
              autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Bu sohbette ara…" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              enterKeyHint="search"
              className="flex-1 bg-transparent outline-none min-w-0"
              style={{ color: "var(--txt)", fontSize: "16px" }}
            />
            {searchLoading && <Loader2 size={14} className="animate-spin" style={{ color: "var(--txt3)" }} />}
            <button type="button" tabIndex={-1} onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); }} aria-label="Aramayı kapat">
              <X size={15} style={{ color: "var(--txt3)" }} />
            </button>
          </div>
          {searchQuery.trim() && (
            <div className="nx-surface rounded-[18px] mt-2 max-h-[240px] overflow-y-auto nx-scroll nx-in">
              {!searchLoading && searchResults.length === 0 && (
                <p className="px-4 py-3 text-[12px]" style={{ color: "var(--txt3)" }}>Sonuç yok.</p>
              )}
              {searchResults.map((r, i) => (
                <button type="button" tabIndex={-1} key={r.id} onClick={() => jumpToSearchResult(r)}
                  className="w-full text-left px-4 py-2.5 flex flex-col gap-0.5 active:opacity-70"
                  style={{ borderBottom: i < searchResults.length - 1 ? "1px solid var(--line)" : "none" }}>
                  <span className="text-[12.5px] truncate" style={{ color: "var(--txt)" }}>{r.content}</span>
                  <span className="nx-mono text-[9px]" style={{ color: "var(--txt3)" }}>{fmtTime(r.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-4 z-10 shrink-0">
        <p className="nx-mono text-[8.5px] tracking-[0.2em] text-center" style={{ color: "var(--txt3)" }}>
          ŞİFRELİ KANAL · SUPABASE (E2E DEĞİL)
        </p>
      </div>

      {/* messages */}
      <div ref={listRef} className="nx-messages-container flex-1 min-h-0 overflow-y-auto nx-scroll px-4 py-3 space-y-1.5" onScroll={onScroll}>
        {loadingOlder && (
          <div className="flex items-center justify-center gap-2 py-2" style={{ color: "var(--txt3)" }}>
            <Loader2 size={13} className="animate-spin" /> <span className="text-[11px]">Eski mesajlar…</span>
          </div>
        )}
        {loading && messages.length === 0 && <MessageSkeleton />}
        {error && !loading && <CenterState icon={AlertTriangle} title={error} tone="var(--red)" />}
        {!loading && !error && messages.length === 0 && (
          <CenterState icon={MessageCircle} title="Henüz mesaj yok" subtitle="İlk mesajı sen gönder." />
        )}

        {!loading && dayGroups.map((group) => (
          <React.Fragment key={group.key}>
            <DayDivider date={group.date} />
            {group.items.map((m) => {
              const repliedTo = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
              const mine = m.sender_id === meId;
              return (
                <MessageBubble
                  key={m.id}
                  message={m}
                  mine={mine}
                  meId={meId}
                  contactName={contact.name}
                  repliedTo={repliedTo}
                  reactions={reactionsByMsg[m.id] || []}
                  onToggleReaction={(emoji) => toggleReaction(m.id, emoji)}
                  onReply={setReplyTo}
                  onEdit={startEdit}
                  onDelete={remove}
                  onReport={onReport}
                  readStatus={mine ? statusFor(m) : undefined}
                  highlighted={highlightId === m.id}
                />
              );
            })}
          </React.Fragment>
        ))}

        {live.status?.active && !!live.remoteDraft?.trim() && (
          <LiveDraftBubble text={live.remoteDraft} name={contact.name} />
        )}

        {typingUsers.length > 0 && !live.remoteDraft?.trim() && (
          <div className="flex items-center gap-1.5 pl-1 pt-1">
            <span className="w-1 h-1 rounded-full" style={{ background: "var(--violet)", animation: "nxDot 1.2s infinite" }} />
            <span className="nx-mono text-[9px] tracking-[0.16em]" style={{ color: "var(--txt3)" }}>YAZIYOR</span>
          </div>
        )}
      </div>

      {newCount > 0 && (
        <button type="button" tabIndex={-1} onClick={jumpToBottom}
          className="absolute left-1/2 -translate-x-1/2 z-20 px-3.5 py-2 rounded-full nx-raised flex items-center gap-1.5 nx-pop active:scale-95 transition-transform"
          style={{ bottom: 92 }}>
          <ArrowDown size={13} style={{ color: "var(--blue)" }} />
          <span className="text-[11.5px] font-semibold">{newCount} yeni mesaj</span>
        </button>
      )}

      {/* Composer: kilit / güvenlik overlay açıkken UNMOUNT — aksi halde PIN input + textarea = iOS prev/next */}
      {!requiresPin && !secOpen && (
        <ChatComposer
          input={input}
          setInput={setInput}
          notifyTyping={notifyTyping}
          onSubmit={submit}
          onFocus={() => {
            if (searchOpen) { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); }
            onComposerFocus();
            lock.touch();
          }}
          onBlur={() => live.clearDraft()}
          onDraftChange={(v) => live.sendDraft(v)}
          liveActive={!!live.status?.active}
          sending={sending}
          editingId={editingId}
          onCancelEdit={() => { setEditingId(null); setInput(""); }}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          mediaErr={mediaErr}
          conversationId={conversationId}
          onMediaUploaded={onMediaUploaded}
          onMediaError={setMediaErr}
          meId={meId}
          contactName={contact.name}
          suppressFocus={searchOpen}
        />
      )}

      {requiresPin && (
        <ChatLockScreen
          name={contact.name}
          status={lock.status}
          onVerify={lock.verify}
          onForgot={(pwd) => lock.forgotRemove(meEmail, pwd)}
          onBack={onBack}
        />
      )}

      {secOpen && (
        <ChatSecuritySettings
          conversationName={contact.name} lock={lock} live={live} onClose={() => setSecOpen(false)}
          disappearingSeconds={disappearingSeconds} onSetDisappearing={onSetDisappearing}
        />
      )}
    </div>
  );
}

/* ---------------- Chat list row ---------------- */
function ChatRow({ conv, contact, locked, unread, isLast, onOpen, onReload }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = conv.lastMessage;
  const muted = !!conv.muted_until && new Date(conv.muted_until).getTime() > Date.now();
  const archived = !!conv.archived_at;
  const lastText = locked
    ? "Kilitli sohbet"
    : (last ? (last.deleted_at ? "Mesaj silindi" : (last.message_type && last.message_type !== "text" ? "Medya" : last.content)) : "Henüz mesaj yok");
  const lastTime = fmtTime(conv.last_message_at || last?.created_at || conv.created_at);

  const toggleMute = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await setMuted(conv.id, muted ? null : new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString());
      await onReload?.();
    } catch (_) { /* noop */ } finally { setBusy(false); setMenuOpen(false); }
  };
  const toggleArchive = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await setArchived(conv.id, !archived);
      await onReload?.();
    } catch (_) { /* noop */ } finally { setBusy(false); setMenuOpen(false); }
  };

  return (
    <div className="relative group">
      <button onClick={() => onOpen(conv.id)}
        className="w-full rounded-[24px] p-3 flex items-center gap-3.5 text-left active:scale-[0.99] transition-transform">
        <Avatar contact={contact} size={46} />
        <div className="flex-1 min-w-0 nx-hairline-b pb-3" style={{ borderColor: isLast ? "transparent" : "var(--line)" }}>
          <div className="flex items-center gap-1.5">
            <span className="nx-display font-semibold text-[14px] truncate">{contact.name}</span>
            {locked && <Lock size={11} style={{ color: "var(--txt3)" }} />}
            {muted && <BellOff size={11} style={{ color: "var(--txt3)" }} />}
            {conv.type === "group" && <Users size={11} style={{ color: "var(--txt3)" }} />}
            <span className="ml-auto nx-mono text-[9.5px] shrink-0 pr-6" style={{ color: "var(--txt3)" }}>{lastTime}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[12.5px] truncate" style={{ color: unread ? "var(--txt)" : "var(--txt2)" }}>{lastText}</span>
            {unread > 0 && (
              <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[9.5px] font-bold flex items-center justify-center"
                style={{ background: "var(--blue)", color: "#05070A" }}>{unread}</span>
            )}
          </div>
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        className="absolute top-3 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: "var(--txt3)" }} aria-label="Sohbet seçenekleri">
        <MoreVertical size={15} />
      </button>
      {menuOpen && (
        <div className="absolute right-2 top-10 w-[184px] nx-raised rounded-[20px] p-1.5 z-30 nx-in" onClick={(e) => e.stopPropagation()}>
          <button disabled={busy} onClick={toggleMute} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] text-[12.5px] text-left min-h-[40px]">
            <BellOff size={13} /> {muted ? "Sesi Aç" : "Sustur"}
          </button>
          <button disabled={busy} onClick={toggleArchive} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] text-[12.5px] text-left min-h-[40px]">
            <Archive size={13} /> {archived ? "Arşivden Çıkar" : "Arşivle"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Chat list ---------------- */
function chatListMatches(conv, contact, rawQ) {
  if (!String(rawQ || "").trim()) return true;
  const last = conv.lastMessage?.deleted_at ? "" : (conv.lastMessage?.content || "");
  const hay = [contact?.name, contact?.handle, contact?.device, conv?.title, last]
    .filter(Boolean)
    .join(" ");
  return searchIncludes(hay, rawQ);
}

function ChatList({ conversations, unreadCounts, loading, error, onOpen, headerRight, lockedIds, onReload }) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const filtered = conversations
    .map((c) => ({ conv: c, contact: convToContact(c) }))
    .filter((x) => chatListMatches(x.conv, x.contact, q));
  const items = filtered.filter((x) => !x.conv.archived_at);
  const archivedItems = filtered.filter((x) => !!x.conv.archived_at);

  const renderRow = (x, idx, list) => {
    const unread = (unreadCounts && unreadCounts[x.conv.id] != null) ? unreadCounts[x.conv.id] : x.conv.unread || 0;
    return (
      <ChatRow key={x.conv.id} conv={x.conv} contact={x.contact} locked={lockedIds?.has?.(x.conv.id)}
        unread={unread} isLast={idx === list.length - 1} onOpen={onOpen} onReload={onReload} />
    );
  };

  return (
    <div className="flex flex-col h-full nx-in">
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="nx-display text-[22px] font-bold tracking-tight">Mesajlar</h1>
            <span className="nx-mono text-[8.5px] tracking-[0.28em]" style={{ color: "var(--txt3)" }}>NEXA · SECURE 2400</span>
          </div>
          {headerRight}
        </div>
        <div className="nx-surface rounded-[20px] flex items-center gap-2.5 px-4 h-12">
          <Search size={15} strokeWidth={1.8} style={{ color: "var(--txt3)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sohbetlerde ara"
            className="flex-1 bg-transparent outline-none text-[13.5px]" style={{ color: "var(--txt)" }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nx-scroll px-3 pb-3">
        {loading && <ChatListSkeleton />}
        {error && !loading && <CenterState icon={AlertTriangle} title={error} tone="var(--red)" />}
        {!loading && !error && items.length === 0 && archivedItems.length === 0 && (
          <CenterState icon={MessageCircle} title="Henüz sohbet yok" subtitle="Kişiler sekmesinden birini seçerek yeni bir sohbet başlat." />
        )}
        {!loading && items.map((x, idx) => renderRow(x, idx, items))}

        {!loading && archivedItems.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setShowArchived((s) => !s)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px]" style={{ color: "var(--txt3)" }}>
              <Archive size={13} />
              <span>Arşivlenmiş sohbetler ({archivedItems.length})</span>
              <ChevronDown size={13} className="ml-auto transition-transform" style={{ transform: showArchived ? "rotate(180deg)" : "none" }} />
            </button>
            {showArchived && archivedItems.map((x, idx) => renderRow(x, idx, archivedItems))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Contacts (gerçek kullanıcı arama → mini kart) ---------------- */
function Contacts({ onSelectUser }) {
  const { query, setQuery, results, loading, error, active } = useUserSearch();

  return (
    <div className="h-full overflow-y-auto nx-scroll px-5 pt-5 nx-in">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="nx-display text-[22px] font-bold tracking-tight">Kişiler</h1>
          <span className="nx-mono text-[8.5px] tracking-[0.28em]" style={{ color: "var(--txt3)" }}>KULLANICI ARA</span>
        </div>
        <button disabled title="Yakında" className="w-11 h-11 rounded-[20px] nx-surface flex items-center justify-center opacity-40 cursor-not-allowed" aria-label="QR ile ekle (yakında)">
          <QrCode size={17} strokeWidth={1.8} />
        </button>
      </div>

      <div className="nx-surface rounded-[18px] flex items-center gap-2.5 px-4 h-12 mb-4">
        <Search size={16} strokeWidth={1.8} style={{ color: "var(--txt3)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Kullanıcı adı veya isim…"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          className="flex-1 bg-transparent outline-none min-w-0"
          style={{ color: "var(--txt)", fontSize: "16px" }}
        />
        {loading && <Loader2 size={15} className="animate-spin" style={{ color: "var(--txt3)" }} />}
      </div>

      {!active && (
        <CenterState icon={Search} title="Kullanıcı ara" subtitle="Mesaj isteği göndermek için en az 2 karakter yaz." />
      )}
      {active && error && !loading && <CenterState icon={AlertTriangle} title={error} tone="var(--red)" />}
      {active && !loading && !error && results.length === 0 && (
        <CenterState icon={Users} title="Sonuç yok" subtitle="Bu isimde onaylı bir kullanıcı bulunamadı." />
      )}

      {active && results.length > 0 && (
        <div className="nx-surface rounded-[28px] overflow-hidden">
          {results.map((c, i) => {
            const contact = { name: nameOf(c), tone: toneFromId(c.id), avatarUrl: c.avatar_url, online: false };
            return (
              <button key={c.id} onClick={() => onSelectUser(c)}
                className="w-full p-3.5 flex items-center gap-3.5 text-left active:opacity-80"
                style={{ borderBottom: i < results.length - 1 ? "1px solid var(--line)" : "none" }}>
                <Avatar contact={contact} size={42} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold truncate">{nameOf(c)}</p>
                  <p className="nx-mono text-[9.5px] mt-0.5 truncate" style={{ color: "var(--txt3)" }}>{c.username ? "@" + c.username : shortId(c.id)}</p>
                </div>
                <ChevronRight size={16} strokeWidth={1.8} className="shrink-0" style={{ color: "var(--txt2)" }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Security center ---------------- */
function SecurityCenter() {
  return (
    <div className="h-full overflow-y-auto nx-scroll px-5 pt-5 pb-6 nx-in">
      <div className="mb-5">
        <h1 className="nx-display text-[22px] font-bold tracking-tight">Güvenlik</h1>
        <span className="nx-mono text-[8.5px] tracking-[0.28em]" style={{ color: "var(--txt3)" }}>HESAP KORUMA MERKEZİ</span>
      </div>

      <div className="nx-raised rounded-[28px] p-6 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-[20px] flex items-center justify-center mb-4" style={{ background: "var(--ink3)", border: "1px solid var(--line)" }}>
          <Shield size={20} strokeWidth={1.8} style={{ color: "var(--blue)" }} />
        </div>
        <p className="nx-display text-[15px] font-semibold mb-1">Güvenlik merkezi yakında</p>
        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--txt2)" }}>
          Aktif cihazlar, oturum geçmişi ve güvenlik olayları gerçek verilere bağlandığında
          burada görünecek. Şu an gösterilecek doğrulanmış veri yok.
        </p>
      </div>

      <div className="nx-surface rounded-[22px] p-4 mt-4">
        <div className="flex items-center gap-2.5 text-[12.5px]" style={{ color: "var(--txt2)" }}>
          <Check size={13} style={{ color: "var(--green)" }} /> Oturum Supabase Auth ile korunuyor
        </div>
        <div className="flex items-center gap-2.5 text-[12.5px] mt-2" style={{ color: "var(--txt2)" }}>
          <Check size={13} style={{ color: "var(--green)" }} /> Erişim satır düzeyi güvenlik (RLS) ile sınırlı
        </div>
      </div>
    </div>
  );
}

/* ---------------- banned ---------------- */
function BannedScreen({ reason, onLogout, busy }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center relative z-10 nx-in">
      <div className="w-14 h-14 rounded-[22px] flex items-center justify-center mb-5" style={{ background: "rgba(229,72,77,0.1)", border: "1px solid rgba(229,72,77,0.3)" }}>
        <Ban size={24} style={{ color: "var(--red)" }} />
      </div>
      <h1 className="nx-display text-[19px] font-bold mb-2">Hesabınız askıya alındı</h1>
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--txt2)" }}>
        {reason || "Bu hesap yönetim tarafından kısıtlanmıştır. İtiraz için destek ile iletişime geçin."}
      </p>
      <button onClick={onLogout} disabled={busy} className="mt-7 h-[48px] px-6 rounded-[18px] nx-surface text-[13.5px] font-semibold flex items-center gap-2">
        {busy && <Loader2 size={14} className="animate-spin" />} Oturumu kapat
      </button>
    </div>
  );
}

/* ---------------- authed shell ---------------- */
function Authed({ user, profile, isModerator, refreshProfile }) {
  usePresence(user.id);
  const [tab, setTab] = useState("chats");
  const [activeConvId, setActiveConvId] = useState(null);
  const [overlay, setOverlay] = useState(null); // 'settings' | 'admin'
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null); // arama sonucu mini kart
  const [notifOpen, setNotifOpen] = useState(false);
  const [lockedIds, setLockedIds] = useState(() => new Set());

  const { conversations, loading: convLoading, error: convError, reload } = useConversations(user.id);
  const { counts, total } = useUnreadCount(user.id);
  const { incoming, outgoing, count: reqCount, loading: reqLoading, reload: reloadReq } = useMessageRequests(user.id);
  const call = useCall(user.id);
  const notif = useNotifications(user.id, isModerator); // yalnızca adminler abone olur

  // PWA: Web Push aboneliği (VAPID varsa; bildirim ayarı açıksa)
  useEffect(() => {
    if (!user?.id || !isPushConfigured()) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings(user.id);
        if (cancelled) return;
        if (s && s.notifications_enabled === false) return;
        await ensurePushSubscription(user.id);
      } catch (_) { /* izin reddi / tablo yok */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const refreshLocked = useCallback(async () => {
    try { const ids = await getLockedConversationIds(); setLockedIds(new Set(ids)); }
    catch (_) { /* noop */ }
  }, []);
  useEffect(() => { refreshLocked(); }, [refreshLocked, conversations]);

  const openNotification = (n) => {
    notif.markRead(n.id);
    setNotifOpen(false);
    if (n.type === "account_application") setOverlay("admin"); // AdminPanel → Başvurular (varsayılan sekme)
  };

  const activeConv = conversations.find((c) => c.id === activeConvId) || null;
  const activeContact = activeConv ? convToContact(activeConv) : null;

  const startCallWith = (type) => {
    if (!activeContact?.otherId) return;
    call.startCall(
      { id: activeContact.otherId, name: activeContact.name, avatarUrl: activeContact.avatarUrl },
      activeConvId,
      type
    );
  };

  const openConversation = (convId) => {
    setSelectedUser(null);
    setTab("chats");
    setActiveConvId(convId);
  };

  // Aramada seçilen kullanıcı için mevcut direct conversation'ı bul.
  const findDirectConvWith = useCallback((otherId) => {
    const c = conversations.find(
      (cv) => (cv.type === "direct" || !cv.is_group) && Array.isArray(cv.others) && cv.others.some((o) => o?.id === otherId)
    );
    return c?.id || null;
  }, [conversations]);

  const outgoingPendingFor = useCallback((otherId) =>
    outgoing.some((r) => r.receiver_id === otherId && r.status === "pending"), [outgoing]);

  const acceptRequest = async (req) => {
    const convId = await acceptMessageRequest(req.id);
    await Promise.all([reloadReq(), reload()]);
    if (convId) openConversation(convId);
  };
  const rejectRequest = async (id) => { await rejectMessageRequest(id); await reloadReq(); };
  const cancelRequest = async (id) => { await cancelMessageRequest(id); await reloadReq(); };
  const blockFromRequest = async (senderId) => {
    try { await blockUser(user.id, senderId); } catch (_) { /* noop */ }
    await reloadReq();
  };

  const doBlock = async () => {
    const otherId = activeContact?.otherId;
    if (!otherId) return;
    try { await blockUser(user.id, otherId); } catch (_) { /* noop */ }
    setActiveConvId(null);
    reload();
  };

  const doReport = async (messageId = null) => {
    const otherId = activeContact?.otherId || null;
    try {
      await reportContent({
        reporterId: user.id,
        reportedUserId: otherId,
        messageId,
        conversationId: activeConvId,
        reason: messageId ? "Mesaj şikâyeti" : "Kullanıcı şikâyeti",
      });
    } catch (_) { /* noop */ }
  };

  const doLogout = async () => {
    setLogoutBusy(true);
    try {
      await clearAppBadgeCount();
      await signOut();
    } catch (_) { /* noop */ } finally { setLogoutBusy(false); }
  };

  return (
    <>
      <div className="relative flex-1 min-h-0">
        {tab === "chats" && !activeConvId && (
          <ChatList conversations={conversations} unreadCounts={counts} loading={convLoading} error={convError} onOpen={setActiveConvId}
            lockedIds={lockedIds} onReload={reload}
            headerRight={isModerator ? <NotificationBell count={notif.unread} onClick={() => setNotifOpen(true)} /> : null} />
        )}
        {tab === "requests" && !activeConvId && (
          <MessageRequests
            incoming={incoming} outgoing={outgoing} loading={reqLoading}
            onAccept={acceptRequest} onReject={rejectRequest} onCancel={cancelRequest} onBlock={blockFromRequest}
          />
        )}
        {tab === "contacts" && !activeConvId && (
          <Contacts onSelectUser={setSelectedUser} />
        )}
        {tab === "security" && !activeConvId && <SecurityCenter />}
        {tab === "profile" && !activeConvId && (
          <ProfileAccount user={user} profile={profile} onLogout={doLogout} busy={logoutBusy}
            onOpenSettings={() => setOverlay("settings")} onOpenAdmin={() => setOverlay("admin")} isModerator={isModerator} />
        )}

        {activeConvId && activeContact && (
          <ChatView contact={activeContact} conversationId={activeConvId} meId={user.id} meEmail={user.email}
            onBack={() => setActiveConvId(null)} onBlock={doBlock} onReport={doReport}
            onLockChange={refreshLocked}
            disappearingSeconds={activeConv?.disappearing_seconds ?? null}
            onSetDisappearing={async (secs) => { await setDisappearingMessages(activeConvId, secs); await reload(); }}
            onAudioCall={() => startCallWith("audio")} onVideoCall={() => startCallWith("video")} />
        )}
        {activeConvId && !activeContact && (
          <div className="absolute inset-0 flex items-center justify-center gap-2" style={{ color: "var(--txt3)" }}>
            <Loader2 size={16} className="animate-spin" /> <span className="text-[12.5px]">Sohbet açılıyor…</span>
          </div>
        )}
      </div>

      {!activeConvId && <MobileNav tab={tab} setTab={setTab} unreadTotal={total} requestCount={reqCount} />}

      {selectedUser && (
        <UserProfileCard
          user={selectedUser}
          existingConvId={findDirectConvWith(selectedUser.id)}
          outgoingPending={outgoingPendingFor(selectedUser.id)}
          onClose={() => setSelectedUser(null)}
          onOpenConversation={openConversation}
          onSent={reloadReq}
        />
      )}

      {overlay === "settings" && (
        <UserSettings user={user} profile={profile} onClose={() => setOverlay(null)} onSaved={refreshProfile} />
      )}
      {overlay === "admin" && isModerator && (
        <AdminPanel me={user} onClose={() => { setOverlay(null); notif.reload(); }} />
      )}

      {isModerator && (
        <NotificationPanel
          open={notifOpen}
          items={notif.items}
          loading={notif.loading}
          error={notif.error}
          unread={notif.unread}
          onClose={() => setNotifOpen(false)}
          onMarkAll={notif.markAllRead}
          onItemClick={openNotification}
        />
      )}

      {/* WebRTC arama katmanları */}
      {call.active && (
        <CallScreen
          call={call.active} callStatus={call.callStatus}
          localStream={call.localStream} remoteStream={call.remoteStream}
          durationSec={call.durationSec} micOn={call.micOn} camOn={call.camOn}
          onToggleMic={call.toggleMic} onToggleCam={call.toggleCam}
          onSwitchCamera={call.switchCamera} onHangup={call.hangup}
        />
      )}
      {!call.active && call.incoming && (
        <IncomingCall incoming={call.incoming} onAccept={call.acceptIncoming} onReject={call.rejectIncoming} />
      )}
      {call.error && !call.active && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-[16px] nx-raised flex items-center gap-3 max-w-[92%]"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 90px)" }}>
          <span className="text-[12.5px]" style={{ color: "var(--txt)" }}>{call.error.message}</span>
          <button onClick={call.dismissError} className="text-[11px] font-semibold shrink-0" style={{ color: "var(--blue)" }}>Tamam</button>
        </div>
      )}
    </>
  );
}

/* ---------------- root ---------------- */
export default function App() {
  const {
    user, loading, profile, profileLoading, isModerator,
    banned, banReason, deactivated, deactivationReason,
    approvalStatus, rejectionReason, approved,
    recovery, clearRecovery, refreshProfile,
  } = useAuth();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Gerçek görünür yüksekliği (mobil klavye/adres çubuğu) takip et.
  useVisualViewport();

  const doLogout = async () => {
    setLogoutBusy(true);
    try { await signOut(); } catch (_) { /* noop */ } finally { setLogoutBusy(false); }
  };

  const doRefresh = async () => {
    setRefreshing(true);
    try { await refreshProfile(); } catch (_) { /* noop */ } finally { setRefreshing(false); }
  };

  // Oturum var ama profil henüz gelmedi → gating kararı için bekle (siyah ekran yok).
  const profileNotReady = !!user && !profile;

  return (
    <div className="nx-root nx-viewport w-full" style={{ background: "var(--ink0)" }}>
      <style>{CSS}</style>
      <div className="relative w-full max-w-[430px] h-full overflow-hidden flex flex-col nx-safe-t">
        <Field />
        <ErrorBoundary>
        <Suspense fallback={
          <div className="flex-1 flex flex-col items-center justify-center relative z-10 gap-3">
            <Loader2 size={22} className="animate-spin" style={{ color: "var(--blue)" }} />
          </div>
        }>
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center relative z-10 gap-3">
              <Loader2 size={22} className="animate-spin" style={{ color: "var(--blue)" }} />
              <span className="nx-mono text-[9px] tracking-[0.28em]" style={{ color: "var(--txt3)" }}>OTURUM KONTROL EDİLİYOR</span>
            </div>
          ) : recovery ? (
            <UpdatePassword onDone={clearRecovery} />
          ) : !user ? (
            <Login />
          ) : banned ? (
            <BannedScreen reason={banReason} onLogout={doLogout} busy={logoutBusy} />
          ) : profileNotReady ? (
            <div className="flex-1 flex flex-col items-center justify-center relative z-10 gap-3">
              <Loader2 size={22} className="animate-spin" style={{ color: "var(--blue)" }} />
              <span className="nx-mono text-[9px] tracking-[0.28em]" style={{ color: "var(--txt3)" }}>
                {profileLoading ? "PROFİL YÜKLENİYOR" : "HESAP DURUMU ALINIYOR"}
              </span>
              {!profileLoading && (
                <button onClick={doRefresh} disabled={refreshing}
                  className="mt-2 h-[40px] px-5 rounded-[16px] nx-surface text-[12.5px] font-semibold flex items-center gap-2">
                  {refreshing && <Loader2 size={13} className="animate-spin" />} Yeniden dene
                </button>
              )}
            </div>
          ) : deactivated ? (
            <DeactivatedAccount reason={deactivationReason} onRefresh={doRefresh} onLogout={doLogout} refreshing={refreshing} logoutBusy={logoutBusy} />
          ) : approvalStatus === "rejected" ? (
            <RejectedApproval reason={rejectionReason} onRefresh={doRefresh} onLogout={doLogout} refreshing={refreshing} logoutBusy={logoutBusy} />
          ) : !approved ? (
            <PendingApproval onRefresh={doRefresh} onLogout={doLogout} refreshing={refreshing} logoutBusy={logoutBusy} />
          ) : (
            <Authed user={user} profile={profile} isModerator={isModerator} refreshProfile={refreshProfile} />
          )}
        </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
