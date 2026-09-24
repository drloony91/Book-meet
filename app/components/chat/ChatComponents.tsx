import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BookSticker, ChatAttachment, ChatAttachmentKind, ChatShareItem, Friend, Message, MessageSearchGroup, MessageSearchMatch } from "./types";
import { useI18n } from "../../i18n";
import { apiFetch } from "../../services/api";
import type { MentionRef } from "../../types/domain";
import type { GroupSummary } from "../../types/domain";
import { GroupChatRows } from "./GroupChatComponents";
import { MentionTextarea } from "../content/MentionTextarea";
import { MentionText } from "../content/MentionText";
import { chatDayLabel, localCalendarDayKey } from "./chat-utils.js";

export function Avatar({ friend, size = "md" }: { friend: Friend; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`avatar avatar-${size} avatar-${friend.color} ${friend.avatarUrl ? "has-photo" : ""}`} style={friend.avatarUrl ? { backgroundImage: `url(${friend.avatarUrl})` } : undefined} aria-hidden="true">
      {friend.support ? <span className="support-avatar-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 17v-2a11 11 0 0 1 22 0v2" /><path d="M5 16H3.5A2.5 2.5 0 0 0 1 18.5v5A2.5 2.5 0 0 0 3.5 26H7V16H5Zm22 0h1.5a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5H25V16h2Z" /><path d="M24 26c-1 2-3.5 3-6 3" /><path d="M8.5 15.5c1-4 4-6.5 7.5-6.5s6.5 2.5 7.5 6.5v5.2c0 4.6-3.3 7.8-7.5 7.8s-7.5-3.2-7.5-7.8v-5.2Z" fill="none" /><circle cx="12.5" cy="19" r="1" /><circle cx="16" cy="19" r="1" /><circle cx="19.5" cy="19" r="1" /></svg></span> : !friend.avatarUrl && friend.initials}
      {friend.supportCase && <span className="support-case-mark">🎧</span>}
      {friend.online && <span className="online-dot" />}
    </span>
  );
}

function attachmentInitials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru");
}

function ChatAttachmentVisual({ item, compact = false }: { item: ChatShareItem; compact?: boolean }) {
  const initials = item.kind === "user" && !item.imageUrl ? attachmentInitials(item.title) : "";
  return <span className={`chat-attachment-image chat-attachment-${item.kind} ${compact ? "is-compact" : ""} ${item.imageUrl ? "has-image" : "is-placeholder"}`} style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined} aria-hidden="true">{initials}</span>;
}

export function FriendsPanel({
  friends,
  selectedId,
  onSelect,
  onFindFriends,
  onCreateOccasion,
  collapsed = false,
  onToggleCollapsed,
  onExpandCollapsed,
  adminMode = false,
  variant = "default",
  onSelectMessageSearchResult,
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
}: {
  friends: Friend[];
  selectedId: number | null;
  onSelect: (friend: Friend) => void;
  onFindFriends: () => void;
  onCreateOccasion: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onExpandCollapsed?: () => void;
  adminMode?: boolean;
  variant?: "default" | "page";
  onSelectMessageSearchResult?: (peerId: number, messageId: number) => void;
  groups?: GroupSummary[];
  selectedGroupId?: number | null;
  onSelectGroup?: (id: number) => void;
  onCreateGroup?: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [contentSearchOpen, setContentSearchOpen] = useState(false);
  const filtered = useMemo(
    () => friends.filter((friend) => friend.name.toLowerCase().includes(query.toLowerCase())),
    [query, friends],
  );
  const realFriendCount = friends.filter((friend) => !friend.support && !friend.supportCase).length;
  const hasSearchablePeople = friends.length > 0;

  const pageMode = variant === "page";
  return (
    <aside className={`friends-panel ${!hasSearchablePeople ? "is-empty" : ""} ${collapsed ? "is-collapsed" : ""} ${pageMode ? "friends-panel-page" : ""}`} aria-label={t("chat.friendsList")} onClick={(event) => { if (!pageMode && collapsed && !(event.target as Element).closest(".friends-collapse-toggle")) onExpandCollapsed?.(); }}>
      <div className="friends-heading">
        <div>
          <h2>{adminMode ? t("chat.requests") : t("chat.friends")} <span>{adminMode ? friends.length : realFriendCount}</span></h2>
        </div>
        {!adminMode && !pageMode && <button className="friends-find-button" type="button" onClick={onFindFriends}>{t("chat.findFriends")}</button>}
      </div>
      {pageMode && onSelectMessageSearchResult && <button className="friends-message-search-toggle" type="button" aria-expanded={contentSearchOpen} onClick={() => setContentSearchOpen((open) => !open)}><span aria-hidden="true">⌕</span>{t("chat.searchAllMessages")}</button>}
      {pageMode && contentSearchOpen && onSelectMessageSearchResult && <GeneralMessageSearch onSelectResult={onSelectMessageSearchResult} />}
      {!adminMode && !pageMode && <button className={`friends-collapse-toggle ${collapsed ? "is-collapsed" : ""}`} type="button" onClick={onToggleCollapsed} aria-label={collapsed ? t("chat.expandFriends") : t("chat.collapseFriends")} title={collapsed ? t("chat.expandFriends") : t("chat.collapseFriends")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></button>}
      {hasSearchablePeople && (
        <label className="friend-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("chat.findFriend")} aria-label={t("chat.findFriend")} />
        </label>
      )}
      <div className="friend-list">
        {!adminMode && groups && onSelectGroup && onCreateGroup && <GroupChatRows groups={groups} selectedId={selectedGroupId} onOpen={onSelectGroup} onCreate={onCreateGroup} />}
        {filtered.map((friend) => (
          <button type="button" className={`friend-row ${selectedId === friend.id ? "is-active" : ""}`} key={friend.id} onClick={() => onSelect(friend)}>
            <Avatar friend={friend} />
            <span className="friend-copy">
              <span className="friend-topline"><strong data-i18n-skip>{friend.name}</strong><small data-i18n-skip>{friend.time}</small></span>
              <span className="friend-bottomline"><span data-i18n-skip>{friend.lastMessage}</span>{friend.unread && <b>{friend.unread}</b>}</span>
            </span>
          </button>
        ))}
        {!adminMode && realFriendCount === 0 && <div className="friends-empty"><p>{t("chat.noFriends")}</p></div>}
        {hasSearchablePeople && filtered.length === 0 && <div className="friends-empty"><p>{t("common.nothingFound")}</p></div>}
        {adminMode && !friends.length && <div className="friends-empty"><p>{t("chat.noRequests")}</p></div>}
      </div>
      {!adminMode && !pageMode && <button className="friends-footnote" type="button" onClick={onCreateOccasion}>
        <span aria-hidden="true">📖</span>
        <span><strong>{t("chat.bookOccasion")}</strong><small>{t("chat.suggestOccasion")}</small></span>
      </button>}
    </aside>
  );
}

export function GeneralMessageSearch({ onSelectResult }: { onSelectResult: (peerId: number, messageId: number) => void }) {
  const { t, formatDate } = useI18n();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<MessageSearchGroup[]>([]);
  const [expandedPeerIds, setExpandedPeerIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pendingPeerIds, setPendingPeerIds] = useState<number[]>([]);
  const requestRef = useRef(0);
  const groupRequestRef = useRef(new Map<number, number>());
  const searchVersionRef = useRef(0);

  async function runSearch(searchQuery: string, cursor?: string, append = false, signal?: AbortSignal, searchVersion = searchVersionRef.current) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: searchQuery, limit: "10" });
      if (cursor) params.set("cursor", cursor);
      const response = await apiFetch(`/api/messages/search?${params}`, { credentials: "same-origin", signal });
      const data = await response.json().catch(() => ({})) as { error?: string; groups?: MessageSearchGroup[]; nextCursor?: string | null };
      if (signal?.aborted || requestRef.current !== requestId || searchVersionRef.current !== searchVersion || query.trim() !== searchQuery) return;
      if (!response.ok || !Array.isArray(data.groups)) throw new Error(data.error || t("chat.searchError"));
      setGroups((current) => {
        if (!append) return data.groups!;
        const currentPeerIds = new Set(current.map((group) => group.peer.id));
        return [...current, ...data.groups!.filter((group) => !currentPeerIds.has(group.peer.id))];
      });
      setNextCursor(data.nextCursor ?? null);
    } catch (searchError) {
      if (signal?.aborted || requestRef.current !== requestId || searchVersionRef.current !== searchVersion || query.trim() !== searchQuery) return;
      setGroups([]);
      setNextCursor(null);
      setError(searchError instanceof Error ? searchError.message : t("chat.searchError"));
    } finally {
      if (requestRef.current === requestId && searchVersionRef.current === searchVersion && query.trim() === searchQuery) setLoading(false);
    }
  }

  async function loadMoreGroup(group: MessageSearchGroup) {
    if (!group.matchesNextCursor || pendingPeerIds.includes(group.peer.id)) return;
    const peerId = group.peer.id;
    const searchQuery = query.trim();
    const searchVersion = searchVersionRef.current;
    const requestId = (groupRequestRef.current.get(peerId) ?? 0) + 1;
    groupRequestRef.current.set(peerId, requestId);
    setPendingPeerIds((current) => [...current, peerId]);
    try {
      const params = new URLSearchParams({ q: searchQuery, limit: "20", cursor: group.matchesNextCursor });
      const response = await apiFetch(`/api/conversations/${peerId}/messages/search?${params}`, { credentials: "same-origin" });
      const data = await response.json().catch(() => ({})) as { error?: string; matches?: MessageSearchMatch[]; nextCursor?: string | null };
      if (groupRequestRef.current.get(peerId) !== requestId || searchVersionRef.current !== searchVersion || query.trim() !== searchQuery) return;
      if (!response.ok || !Array.isArray(data.matches)) throw new Error(data.error || t("chat.searchError"));
      setGroups((current) => current.map((item) => item.peer.id === peerId ? { ...item, matches: [...item.matches, ...data.matches!], matchesNextCursor: data.nextCursor ?? null } : item));
    } catch (loadError) {
      if (groupRequestRef.current.get(peerId) === requestId && searchVersionRef.current === searchVersion && query.trim() === searchQuery) setError(loadError instanceof Error ? loadError.message : t("chat.searchError"));
    } finally {
      if (groupRequestRef.current.get(peerId) === requestId && searchVersionRef.current === searchVersion && query.trim() === searchQuery) setPendingPeerIds((current) => current.filter((id) => id !== peerId));
    }
  }

  useEffect(() => {
    const clean = query.trim();
    const searchVersion = ++searchVersionRef.current;
    groupRequestRef.current.clear(); setPendingPeerIds([]);
    if (!clean) { requestRef.current += 1; setGroups([]); setNextCursor(null); setError(""); setLoading(false); return; }
    if (Array.from(clean).length < 3) { requestRef.current += 1; setGroups([]); setNextCursor(null); setError(t("chat.searchMinLength")); setLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => void runSearch(clean, undefined, false, controller.signal, searchVersion), 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, t]);

  return <section className="global-message-search" aria-label={t("chat.searchAllMessages")}>
    <label className="message-search-input"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("chat.searchAllMessages")} aria-label={t("chat.searchAllMessages")} /></label>
    <div className="message-search-status" aria-live="polite">{loading ? t("common.loading") : error}</div>
    {!loading && query.trim() && !error && !groups.length && <p className="message-search-empty">{t("common.nothingFound")}</p>}
    <div className="message-search-groups">{groups.map((group) => {
      const expanded = expandedPeerIds.includes(group.peer.id);
      return <section className="message-search-group" key={group.peer.id}>
        <button type="button" className="message-search-group-toggle" aria-expanded={expanded} onClick={() => setExpandedPeerIds((current) => expanded ? current.filter((id) => id !== group.peer.id) : [...current, group.peer.id])}>
          <span data-i18n-skip>{group.peer.name}</span><b>{t("chat.searchMatches", { count: group.count })}</b><span aria-hidden="true">{expanded ? "−" : "+"}</span>
        </button>
        {expanded && <div className="message-search-results">{group.matches.map((match) => <button type="button" className="message-search-result" key={match.messageId} onClick={() => onSelectResult(group.peer.id, match.messageId)}><span data-i18n-skip>{match.snippet}</span><small><span data-i18n-skip>{match.author.name}</span> · {formatDate(match.createdAt, { dateStyle: "medium", timeStyle: "short" })}</small></button>)}{group.matchesNextCursor && <button className="message-search-more" type="button" disabled={pendingPeerIds.includes(group.peer.id)} onClick={() => void loadMoreGroup(group)}>{t("chat.searchMore")}</button>}</div>}
      </section>;
    })}</div>
    {nextCursor && <button className="message-search-more" type="button" disabled={loading} onClick={() => void runSearch(query.trim(), nextCursor, true, undefined, searchVersionRef.current)}>{t("chat.searchMore")}</button>}
  </section>;
}

export function ChatView({
  friend,
  messages,
  onOpenProfile,
  onSend,
  onEditMessage,
  onDeleteMessage,
  onToggleLike,
  expanded,
  onToggleExpanded,
  onClose,
  shareItems,
  onOpenAttachment,
  onReport,
  onClearHistory,
  initialTargetMessageId,
  onSelectMessageSearchResult,
  profileEnabled = true,
  fullPage = false,
  mobileDialog = false,
}: {
  friend: Friend;
  messages: Message[];
  onOpenProfile: () => void;
  onSend: (message: string, attachment?: ChatAttachment, mentions?: MentionRef[], stickerId?: string) => void;
  onEditMessage: (messageId: number, body: string, mentions?: MentionRef[]) => Promise<boolean>;
  onDeleteMessage: (messageId: number) => Promise<boolean>;
  onToggleLike: (messageId: number, liked: boolean) => Promise<void>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  shareItems: ChatShareItem[];
  onOpenAttachment: (attachment: ChatAttachment) => void;
  onReport?: () => void;
  onClearHistory: () => Promise<boolean>;
  initialTargetMessageId?: number | null;
  onSelectMessageSearchResult?: (peerId: number, messageId: number) => void;
  profileEnabled?: boolean;
  fullPage?: boolean;
  mobileDialog?: boolean;
}) {
  const { t, locale, formatTime, formatDate, domainLabel } = useI18n();
  const [draft, setDraft] = useState("");
  const [mentionUserIds, setMentionUserIds] = useState<number[]>([]);
  const [mentionRefs, setMentionRefs] = useState<MentionRef[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickers, setStickers] = useState<BookSticker[]>([]);
  const [stickerError, setStickerError] = useState(false);
  const [shareKind, setShareKind] = useState<ChatAttachmentKind | null>(null);
  const [shareQuery, setShareQuery] = useState("");
  const [attachment, setAttachment] = useState<ChatShareItem | null>(null);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyClearing, setHistoryClearing] = useState(false);
  const [pendingLikeMessageIds, setPendingLikeMessageIds] = useState<number[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editMentionUserIds, setEditMentionUserIds] = useState<number[]>([]);
  const [editMentionRefs, setEditMentionRefs] = useState<MentionRef[]>([]);
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [pendingDeleteMessageIds, setPendingDeleteMessageIds] = useState<number[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<MessageSearchMatch[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const messageAreaRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchScrollTopRef = useRef(0);
  const searchRequestRef = useRef(0);
  const conversationSearchVersionRef = useRef(0);
  const highlightTimerRef = useRef(0);
  const activeFriendIdRef = useRef(friend.id);
  const editOperationRef = useRef(0);
  activeFriendIdRef.current = friend.id;
  const [calendarNow, setCalendarNow] = useState(() => new Date());
  useEffect(() => {
    editOperationRef.current += 1;
    setHistoryMenuOpen(false);
    setEmojiOpen(false); setStickerOpen(false); setStickerError(false);
    setEditingMessageId(null);
    setEditDraft("");
    setEditMentionUserIds([]);
    setEditMentionRefs([]);
    setEditError("");
    setEditSaving(false);
    setPendingDeleteMessageIds([]);
    setSearchOpen(false);
    setGlobalSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setSearchError("");
    setHighlightedMessageId(null);
    searchRequestRef.current += 1;
    conversationSearchVersionRef.current += 1;
  }, [friend.id]);
  useEffect(() => {
    let active = true;
    void apiFetch("/api/stickers", { credentials: "same-origin" }).then(async (response) => {
      const data = await response.json().catch(() => ({})) as { stickers?: BookSticker[] };
      if (!active) return;
      if (!response.ok || !Array.isArray(data.stickers)) { setStickerError(true); return; }
      setStickers(data.stickers); setStickerError(false);
    }).catch(() => { if (active) setStickerError(true); });
    return () => { active = false; };
  }, [locale]);
  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);
  useEffect(() => {
    let midnightTimer = 0;
    const scheduleNextLocalMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnightTimer = window.setTimeout(() => {
        setCalendarNow(new Date());
        scheduleNextLocalMidnight();
      }, Math.max(1_000, nextMidnight.getTime() - now.getTime() + 100));
    };
    scheduleNextLocalMidnight();
    return () => window.clearTimeout(midnightTimer);
  }, []);
  const messageTime = (message: Message) => message.createdAt ? formatTime(message.createdAt) : message.time;
  const messageGroups = useMemo(() => {
    const visibleMessages = messages.filter((message) => !(message.system && friend.support));
    return visibleMessages.reduce<{ key: string; label: string; messages: Message[] }[]>((groups, message) => {
      const createdAt = message.createdAt ? new Date(message.createdAt) : calendarNow;
      const key = localCalendarDayKey(createdAt);
      const last = groups[groups.length - 1];
      if (last?.key === key) last.messages.push(message);
      else groups.push({ key, label: chatDayLabel(createdAt, calendarNow, locale, t("chat.today"), t("chat.yesterday")), messages: [message] });
      return groups;
    }, []);
  }, [calendarNow, friend.support, locale, messages, t]);
  const shareTypes: { kind: ChatAttachmentKind; label: string; hint: string }[] = [
    { kind: "book", label: t("chat.shareBook"), hint: t("chat.hintBook") },
    { kind: "user", label: t("chat.shareUser"), hint: t("chat.hintUser") },
    { kind: "event", label: t("chat.shareEvent"), hint: t("chat.hintEvent") },
    { kind: "review", label: t("chat.shareReview"), hint: t("chat.hintReview") },
    { kind: "excerpt", label: t("chat.shareExcerpt"), hint: t("chat.hintExcerpt") },
    { kind: "occasion", label: t("chat.shareOccasion"), hint: t("chat.hintOccasion") },
    { kind: "publisher_news", label: t("chat.sharePublisherNews"), hint: t("chat.hintPublisherNews") },
    { kind: "shelf", label: t("shelves.label"), hint: t("shelves.title") },
  ];
  const currentShareType = shareTypes.find((item) => item.kind === shareKind);
  const matchingItems = useMemo(() => {
    if (!shareKind) return [];
    const normalized = shareQuery.trim().toLocaleLowerCase("ru");
    return shareItems.filter((item) => item.kind === shareKind && (!normalized || `${item.title} ${item.subtitle}`.toLocaleLowerCase("ru").includes(normalized))).slice(0, 8);
  }, [shareItems, shareKind, shareQuery]);

  function focusMessage(messageId: number) {
    const element = messageAreaRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!element) return false;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightedMessageId(messageId);
    window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId((current) => current === messageId ? null : current), 2400);
    return true;
  }

  useEffect(() => {
    if (!initialTargetMessageId) return;
    const timer = window.setTimeout(() => focusMessage(initialTargetMessageId), 60);
    return () => window.clearTimeout(timer);
  }, [initialTargetMessageId, messages.length]);

  async function searchConversation(search: string, cursor?: string, append = false, signal?: AbortSignal, searchVersion = conversationSearchVersionRef.current) {
    const requestId = ++searchRequestRef.current;
    setSearchLoading(true);
    setSearchError("");
    try {
      const params = new URLSearchParams({ q: search, limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const response = await apiFetch(`/api/conversations/${friend.id}/messages/search?${params}`, { credentials: "same-origin", signal });
      const data = await response.json().catch(() => ({})) as { error?: string; total?: number; matches?: MessageSearchMatch[]; nextCursor?: string | null };
      if (signal?.aborted || activeFriendIdRef.current !== friend.id || searchRequestRef.current !== requestId || conversationSearchVersionRef.current !== searchVersion || searchQuery.trim() !== search) return;
      if (!response.ok || !Array.isArray(data.matches) || !Number.isInteger(data.total)) throw new Error(data.error || t("chat.searchError"));
      setSearchMatches((current) => append ? [...current, ...data.matches!] : data.matches!);
      setSearchTotal(data.total!);
      setSearchNextCursor(data.nextCursor ?? null);
    } catch (searchFailure) {
      if (signal?.aborted || activeFriendIdRef.current !== friend.id || searchRequestRef.current !== requestId || conversationSearchVersionRef.current !== searchVersion || searchQuery.trim() !== search) return;
      setSearchMatches([]);
      setSearchTotal(0);
      setSearchNextCursor(null);
      setSearchError(searchFailure instanceof Error ? searchFailure.message : t("chat.searchError"));
    } finally {
      if (activeFriendIdRef.current === friend.id && searchRequestRef.current === requestId && conversationSearchVersionRef.current === searchVersion && searchQuery.trim() === search) setSearchLoading(false);
    }
  }

  useEffect(() => {
    if (!searchOpen) return;
    const clean = searchQuery.trim();
    const searchVersion = ++conversationSearchVersionRef.current;
    if (!clean) { searchRequestRef.current += 1; setSearchMatches([]); setSearchTotal(0); setSearchNextCursor(null); setSearchError(""); setSearchLoading(false); return; }
    if (Array.from(clean).length < 3) { searchRequestRef.current += 1; setSearchMatches([]); setSearchTotal(0); setSearchNextCursor(null); setSearchError(t("chat.searchMinLength")); setSearchLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => void searchConversation(clean, undefined, false, controller.signal, searchVersion), 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [friend.id, searchOpen, searchQuery, t]);

  function openMessageSearch() {
    searchScrollTopRef.current = messageAreaRef.current?.scrollTop ?? 0;
    setSearchOpen(true);
  }

  function closeMessageSearch(restoreScroll = true) {
    searchRequestRef.current += 1;
    conversationSearchVersionRef.current += 1;
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setSearchError("");
    if (restoreScroll) window.requestAnimationFrame(() => { if (messageAreaRef.current) messageAreaRef.current.scrollTop = searchScrollTopRef.current; });
  }

  function chooseSearchResult(messageId: number) {
    closeMessageSearch(false);
    window.requestAnimationFrame(() => focusMessage(messageId));
  }

  function itemFromUrl(text: string) {
    const urlMatch = text.match(/https?:\/\/[^\s]+|\/(?:books|users|events|reviews|blog|meet|publishing)\/\d+/i)?.[0];
    if (!urlMatch) return null;
    try {
      const url = new URL(urlMatch, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      const item = shareItems.find((candidate) => candidate.path === url.pathname);
      return item ? { item, url: urlMatch } : null;
    } catch {
      return null;
    }
  }

  function chooseAttachment(item: ChatShareItem) {
    setAttachment(item);
    setShareOpen(false);
    setShareKind(null);
    setShareQuery("");
  }

  function changeDraft(next: string) {
    const parsed = itemFromUrl(next);
    if (parsed) {
      setAttachment(parsed.item);
      setDraft(next.replace(parsed.url, "").replace(/\s{2,}/g, " ").trimStart());
      return;
    }
    setDraft(next);
  }

  function insertEmoji(emoji: string) {
    const node = composerRef.current;
    const start = node?.selectionStart ?? draft.length;
    const end = node?.selectionEnd ?? draft.length;
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    changeDraft(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(start + emoji.length, start + emoji.length); });
  }

  function sendSticker(sticker: BookSticker) {
    onSend("", undefined, undefined, sticker.id);
    setStickerOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  const stickerLabel = (sticker: BookSticker) => sticker.labels?.[locale] ?? sticker.label;

  function changeShareQuery(next: string) {
    const parsed = itemFromUrl(next);
    if (parsed && parsed.item.kind === shareKind) {
      chooseAttachment(parsed.item);
      return;
    }
    setShareQuery(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean && !attachment) return;
    onSend(clean, attachment ? { kind: attachment.kind, id: attachment.id } : undefined, mentionRefs.length ? mentionRefs : mentionUserIds.map((userId) => ({ userId, token: "" })));
    setDraft(""); setMentionUserIds([]); setMentionRefs([]);
    setAttachment(null);
  }

  async function clearHistory() {
    if (historyClearing || !window.confirm(t("chat.clearHistoryConfirm", { name: friend.name }))) return;
    setHistoryClearing(true);
    try {
      if (await onClearHistory()) setHistoryMenuOpen(false);
    } finally {
      setHistoryClearing(false);
    }
  }

  async function toggleLike(message: Message) {
    if (pendingLikeMessageIds.includes(message.id)) return;
    setPendingLikeMessageIds((current) => [...current, message.id]);
    try {
      await onToggleLike(message.id, !message.likedByViewer);
    } finally {
      setPendingLikeMessageIds((current) => current.filter((messageId) => messageId !== message.id));
    }
  }

  function startEditing(message: Message) {
    editOperationRef.current += 1;
    setEditingMessageId(message.id);
    setEditDraft(message.text);
    setEditMentionUserIds((message.mentions ?? []).map((mention) => mention.userId));
    setEditMentionRefs(message.mentions ?? []);
    setEditError("");
  }

  function cancelEditing() {
    if (editSaving) return;
    editOperationRef.current += 1;
    setEditingMessageId(null);
    setEditDraft("");
    setEditMentionUserIds([]);
    setEditMentionRefs([]);
    setEditError("");
  }

  async function submitEdit(event: FormEvent, messageId: number) {
    event.preventDefault();
    if (editSaving) return;
    const clean = editDraft.replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "").trim();
    if (!clean) { setEditError(t("chat.editEmpty")); return; }
    const friendId = friend.id;
    const operationId = ++editOperationRef.current;
    setEditError("");
    setEditSaving(true);
    const saved = await onEditMessage(messageId, clean, editMentionRefs.length ? editMentionRefs : editMentionUserIds.map((userId) => ({ userId, token: "" })));
    if (activeFriendIdRef.current !== friendId || editOperationRef.current !== operationId) return;
    setEditSaving(false);
    if (saved) {
      setEditingMessageId(null);
      setEditDraft("");
      setEditMentionUserIds([]);
      setEditMentionRefs([]);
    }
  }

  async function deleteMessage(message: Message) {
    if (pendingDeleteMessageIds.includes(message.id) || !window.confirm(t("chat.deleteMessageConfirm"))) return;
    const friendId = friend.id;
    setPendingDeleteMessageIds((current) => [...current, message.id]);
    try {
      await onDeleteMessage(message.id);
    } finally {
      if (activeFriendIdRef.current === friendId) setPendingDeleteMessageIds((current) => current.filter((messageId) => messageId !== message.id));
    }
  }

  return (
    <main className={`chat-view ${expanded ? "chat-expanded" : "chat-compact"} ${fullPage ? "chat-full-page" : ""} ${searchOpen ? "chat-search-open" : ""}`}>
      {mobileDialog && searchOpen ? <header className="chat-header chat-search-header">
        <label className="message-search-input"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("chat.searchInConversation")} aria-label={t("chat.searchInConversation")} /></label>
        <button className="chat-search-close" type="button" onClick={() => closeMessageSearch(true)} aria-label={t("chat.closeSearch")} title={t("chat.closeSearch")}>×</button>
      </header> : <header className="chat-header">
        {mobileDialog && <button className="chat-mobile-back" type="button" onClick={onClose} aria-label={t("common.back")} title={t("common.back")}>{"<"}</button>}
        <button className="chat-person" type="button" onClick={profileEnabled ? onOpenProfile : undefined} aria-label={profileEnabled ? t("chat.openProfile", { name: friend.name }) : friend.name} disabled={!profileEnabled}>
          <Avatar friend={friend} size="md" />
          <span><strong data-i18n-skip>{friend.name}</strong><small>{mobileDialog && friend.username ? <span data-i18n-skip>@{friend.username}</span> : <>{domainLabel(friend.type)}<span data-i18n-skip> · {friend.city}</span> · {friend.online ? t("chat.online") : t("chat.offline")}</>}</small></span>
        </button>
        <div className="chat-actions">
          <button className="chat-search-action" type="button" onClick={openMessageSearch} aria-label={t("chat.searchInConversation")} title={t("chat.searchInConversation")}>⌕</button>
          {onSelectMessageSearchResult && <button className="chat-global-search-action" type="button" onClick={() => setGlobalSearchOpen(true)} aria-label={t("chat.searchAllMessages")} title={t("chat.searchAllMessages")}>⌕</button>}
          {!fullPage && <button className="chat-expand-action" type="button" onClick={onToggleExpanded} aria-label={expanded ? t("chat.collapse") : t("chat.expand")} title={expanded ? t("chat.collapse") : t("chat.expand")}>{expanded ? "↙" : "⛶"}</button>}
          {onReport && <button className="modal-tool-button modal-report-button" type="button" onClick={onReport} data-tooltip={t("safety.report")} aria-label={t("chat.report")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5m0 3h.01" /></svg></button>}
          <div className="chat-history-menu"><button className="chat-history-trigger" type="button" onClick={() => setHistoryMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={historyMenuOpen} aria-label={t("chat.actions")} title={t("chat.actions")}>⋯</button>{historyMenuOpen && <div className="chat-history-dropdown" role="menu"><button type="button" role="menuitem" disabled={historyClearing} onClick={() => void clearHistory()}>{historyClearing ? t("chat.clearingHistory") : t("chat.clearHistory")}</button></div>}</div>
          {!fullPage && <button className="chat-close-action" type="button" onClick={onClose} aria-label={t("chat.close")} title={t("chat.close")}>×</button>}
        </div>
      </header>}
      {searchOpen && <section className={`conversation-message-search ${mobileDialog ? "is-mobile" : ""}`} aria-label={t("chat.searchResults")}>
        {!mobileDialog && <div className="conversation-message-search-bar"><label className="message-search-input"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("chat.searchInConversation")} aria-label={t("chat.searchInConversation")} /></label><button type="button" onClick={() => closeMessageSearch(true)} aria-label={t("chat.closeSearch")}>×</button></div>}
        <div className="message-search-status" aria-live="polite">{searchLoading ? t("common.loading") : searchError || (searchQuery.trim() && !searchMatches.length ? t("common.nothingFound") : searchQuery.trim() ? t("chat.searchMatches", { count: searchTotal }) : t("chat.searchHint"))}</div>
        <div className="message-search-results">{searchMatches.map((match) => <button type="button" className="message-search-result" key={match.messageId} onClick={() => chooseSearchResult(match.messageId)}><span data-i18n-skip>{match.snippet}</span><small><span data-i18n-skip>{match.author.name}</span> · {formatDate(match.createdAt, { dateStyle: "medium", timeStyle: "short" })}</small></button>)}</div>
        {searchNextCursor && <button className="message-search-more" type="button" disabled={searchLoading} onClick={() => void searchConversation(searchQuery.trim(), searchNextCursor, true, undefined, conversationSearchVersionRef.current)}>{t("chat.searchMore")}</button>}
      </section>}
      {globalSearchOpen && onSelectMessageSearchResult && <section className={`conversation-message-search global-message-search-panel ${mobileDialog ? "is-mobile" : ""}`} aria-label={t("chat.searchAllMessages")}>
        <div className="conversation-message-search-bar"><span>{t("chat.searchAllMessages")}</span><button type="button" onClick={() => setGlobalSearchOpen(false)} aria-label={t("chat.closeSearch")} title={t("chat.closeSearch")}>×</button></div>
        <GeneralMessageSearch onSelectResult={(peerId, messageId) => { setGlobalSearchOpen(false); onSelectMessageSearchResult(peerId, messageId); }} />
      </section>}
      <section ref={messageAreaRef} className="message-area" aria-live="polite">
        {messageGroups.map((group) => <div className="chat-day-group" key={group.key}><div className="chat-day">{group.label}</div>{group.messages.map((message) => (
          message.system ? <div className={`system-message ${highlightedMessageId === message.id ? "is-search-highlighted" : ""}`} data-message-id={message.id} key={message.id}><span data-i18n-skip>✦ {message.text}</span><time dateTime={message.createdAt}>{messageTime(message)}</time></div> :
            <div className={`message-wrap ${message.mine ? "mine" : "theirs"} ${highlightedMessageId === message.id ? "is-search-highlighted" : ""}`} data-message-id={message.id} key={message.id}>
              <div className={`message-bubble ${editingMessageId === message.id ? "is-editing" : ""} ${message.deleted ? "is-deleted" : ""}`}>
                {editingMessageId === message.id ? <form className="message-edit-form" aria-label={t("chat.editForm")} onSubmit={(event) => void submitEdit(event, message.id)}>
                  <MentionTextarea autoFocus rows={3} maxLength={5000} value={editDraft} onChange={(event) => { setEditDraft(event.target.value); if (editError) setEditError(""); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelEditing(); } else if (event.key === "Enter" && !event.shiftKey && !event.defaultPrevented) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} aria-label={t("chat.editMessage")} aria-invalid={Boolean(editError)} mentionUserIds={editMentionUserIds} onMentionUserIdsChange={setEditMentionUserIds} mentionRefs={editMentionRefs} onMentionRefsChange={setEditMentionRefs} />
                  {editError && <p className="message-edit-error" role="alert">{editError}</p>}
                  <div className="message-edit-actions"><button type="submit" disabled={editSaving}>{t("chat.editSave")}</button><button type="button" disabled={editSaving} onClick={cancelEditing}>{t("chat.editCancel")}</button></div>
                </form> : <>{message.sticker && <img className="chat-book-sticker" src={message.sticker.assetUrl} alt={stickerLabel(message.sticker)} />}{message.attachment && (() => { const item = shareItems.find((candidate) => candidate.kind === message.attachment?.kind && candidate.id === message.attachment?.id); return item ? <button className="chat-attachment-card" type="button" onClick={() => onOpenAttachment(message.attachment!)}><ChatAttachmentVisual item={item} /><span data-i18n-skip><strong>{item.title}</strong><em>{item.subtitle}</em></span></button> : null; })()}{message.text && <p {...(message.deleted ? {} : { "data-i18n-skip": true })}>{message.deleted ? t("chat.messageDeleted") : <MentionText text={message.text} mentions={message.mentions} onOpenUser={profileEnabled ? onOpenProfile : undefined} />}</p>}<time>{message.editedAt && <span className="message-edited-label">{t("chat.edited")} · </span>}{messageTime(message)}{message.mine && !message.deleted && <span className={`message-checks ${message.read ? "is-read" : ""}`} aria-label={message.read ? t("chat.read") : t("chat.sent")}>{message.read ? "✓✓" : "✓"}</span>}</time></>}
              </div>
              {editingMessageId !== message.id && !message.deleted && <div className="message-inline-actions">
                {message.mine && !message.attachment && !message.sticker && <button className="message-edit-button" type="button" onClick={() => startEditing(message)} aria-label={t("chat.editMessage")} title={t("chat.editMessage")}><span aria-hidden="true">✎</span></button>}
                {message.mine && <button className="message-delete-button" type="button" disabled={pendingDeleteMessageIds.includes(message.id)} onClick={() => void deleteMessage(message)} aria-label={t("chat.deleteMessage")} title={t("chat.deleteMessage")}><span aria-hidden="true">×</span></button>}
                <button className={`message-like-button ${message.likedByViewer ? "is-active" : ""}`} type="button" disabled={pendingLikeMessageIds.includes(message.id)} onClick={() => void toggleLike(message)} aria-pressed={Boolean(message.likedByViewer)} aria-label={message.likedByViewer ? t("chat.unlikeMessage") : t("chat.likeMessage")} title={message.likedByViewer ? t("chat.unlikeMessage") : t("chat.likeMessage")}><span aria-hidden="true">♥</span>{Boolean(message.likeCount) && <b>{message.likeCount}</b>}</button>
              </div>}
            </div>
        ))}</div>)}
      </section>
      <div className="chat-composer">
        {emojiOpen && <section className="chat-picker" aria-label={t("chat.emoji")}><div role="group" aria-label={t("chat.emoji")}>{([ ["📚", "chat.emojiBooks"], ["✨", "chat.emojiSparkles"], ["☕", "chat.emojiTea"], ["❤️", "chat.emojiHeart"], ["😊", "chat.emojiSmile"], ["🤔", "chat.emojiThinking"], ["👏", "chat.emojiClap"], ["🎉", "chat.emojiCelebrate"] ] as const).map(([emoji, label]) => <button type="button" key={emoji} onClick={() => insertEmoji(emoji)} aria-label={t(label)}>{emoji}</button>)}</div></section>}
        {stickerOpen && <section className="chat-picker chat-sticker-picker" aria-label={t("chat.stickerPicker")}><div role="group" aria-label={t("chat.stickerPicker")}>{stickers.map((sticker) => <button type="button" key={sticker.id} onClick={() => sendSticker(sticker)} aria-label={stickerLabel(sticker)}><img src={sticker.assetUrl} alt="" /></button>)}</div>{stickerError && <p role="alert">{t("chat.stickerError")}</p>}</section>}
        {shareOpen && <section className="chat-share-popover"><header><h3>{t("chat.share")}</h3><button type="button" onClick={() => { setShareOpen(false); setShareKind(null); }}>×</button></header>{!shareKind ? <div className="chat-share-types">{shareTypes.map((item) => <button type="button" key={item.kind} onClick={() => setShareKind(item.kind)}>{item.label}</button>)}</div> : <><button className="chat-share-back" type="button" onClick={() => { setShareKind(null); setShareQuery(""); }}>← {t("common.back")}</button><input autoFocus value={shareQuery} onChange={(event) => changeShareQuery(event.target.value)} placeholder={currentShareType?.hint} /><div className="chat-share-results">{matchingItems.map((item) => <button type="button" key={`${item.kind}-${item.id}`} onClick={() => chooseAttachment(item)}><ChatAttachmentVisual item={item} compact /><b>{item.title}</b><small>{item.subtitle}</small></button>)}{shareQuery.trim() && !matchingItems.length && <p>{t("common.nothingFound")}</p>}</div></>}</section>}
        {attachment && <div className="chat-selected-attachment"><ChatAttachmentVisual item={attachment} compact /><button type="button" data-i18n-skip onClick={() => onOpenAttachment(attachment)}><strong>{attachment.title}</strong><small>{attachment.subtitle}</small></button><button type="button" aria-label={t("chat.removeAttachment")} onClick={() => setAttachment(null)}>×</button></div>}
      <form className="message-form" onSubmit={submit}>
        <button type="button" aria-label={t("chat.share")} onClick={() => { setShareOpen((open) => !open); setShareKind(null); setShareQuery(""); }}>＋</button>
        <button type="button" aria-label={t("chat.emoji")} aria-expanded={emojiOpen} onClick={() => { setEmojiOpen((open) => !open); setStickerOpen(false); }}>☺</button>
        <MentionTextarea ref={composerRef} rows={1} value={draft} onChange={(event) => changeDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.defaultPrevented) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={t("chat.writeMessage")} aria-label={t("chat.message")} mentionUserIds={mentionUserIds} onMentionUserIdsChange={setMentionUserIds} mentionRefs={mentionRefs} onMentionRefsChange={setMentionRefs} />
        <button type="button" aria-label={t("chat.stickers")} aria-expanded={stickerOpen} onClick={() => { setStickerOpen((open) => !open); setEmojiOpen(false); }}>▣</button>
        <button className="send-button" type="submit" aria-label={t("chat.send")}>↑</button>
      </form>
      </div>
    </main>
  );
}
