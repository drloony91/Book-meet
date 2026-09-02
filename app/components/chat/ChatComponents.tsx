import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ChatAttachment, ChatAttachmentKind, ChatShareItem, Friend, Message } from "./types";
import { useI18n } from "../../i18n";
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
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
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
      {!adminMode && !pageMode && <button className={`friends-collapse-toggle ${collapsed ? "is-collapsed" : ""}`} type="button" onClick={onToggleCollapsed} aria-label={collapsed ? t("chat.expandFriends") : t("chat.collapseFriends")} title={collapsed ? t("chat.expandFriends") : t("chat.collapseFriends")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></button>}
      {hasSearchablePeople && (
        <label className="friend-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("chat.findFriend")} aria-label={t("chat.findFriend")} />
        </label>
      )}
      <div className="friend-list">
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

export function ChatView({
  friend,
  messages,
  onOpenProfile,
  onSend,
  expanded,
  onToggleExpanded,
  onClose,
  shareItems,
  onOpenAttachment,
  onReport,
  onClearHistory,
  profileEnabled = true,
  fullPage = false,
  mobileDialog = false,
}: {
  friend: Friend;
  messages: Message[];
  onOpenProfile: () => void;
  onSend: (message: string, attachment?: ChatAttachment) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  shareItems: ChatShareItem[];
  onOpenAttachment: (attachment: ChatAttachment) => void;
  onReport?: () => void;
  onClearHistory: () => Promise<boolean>;
  profileEnabled?: boolean;
  fullPage?: boolean;
  mobileDialog?: boolean;
}) {
  const { t, locale, formatTime, domainLabel } = useI18n();
  const [draft, setDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareKind, setShareKind] = useState<ChatAttachmentKind | null>(null);
  const [shareQuery, setShareQuery] = useState("");
  const [attachment, setAttachment] = useState<ChatShareItem | null>(null);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyClearing, setHistoryClearing] = useState(false);
  const [calendarNow, setCalendarNow] = useState(() => new Date());
  useEffect(() => { setHistoryMenuOpen(false); }, [friend.id]);
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
  ];
  const currentShareType = shareTypes.find((item) => item.kind === shareKind);
  const matchingItems = useMemo(() => {
    if (!shareKind) return [];
    const normalized = shareQuery.trim().toLocaleLowerCase("ru");
    return shareItems.filter((item) => item.kind === shareKind && (!normalized || `${item.title} ${item.subtitle}`.toLocaleLowerCase("ru").includes(normalized))).slice(0, 8);
  }, [shareItems, shareKind, shareQuery]);

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
    onSend(clean, attachment ? { kind: attachment.kind, id: attachment.id } : undefined);
    setDraft("");
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

  return (
    <main className={`chat-view ${expanded ? "chat-expanded" : "chat-compact"} ${fullPage ? "chat-full-page" : ""}`}>
      <header className="chat-header">
        {mobileDialog && <button className="chat-mobile-back" type="button" onClick={onClose} aria-label={t("common.back")} title={t("common.back")}>{"<"}</button>}
        <button className="chat-person" type="button" onClick={profileEnabled ? onOpenProfile : undefined} aria-label={profileEnabled ? t("chat.openProfile", { name: friend.name }) : friend.name} disabled={!profileEnabled}>
          <Avatar friend={friend} size="md" />
          <span><strong data-i18n-skip>{friend.name}</strong><small>{mobileDialog && friend.username ? <span data-i18n-skip>@{friend.username}</span> : <>{domainLabel(friend.type)}<span data-i18n-skip> · {friend.city}</span> · {friend.online ? t("chat.online") : t("chat.offline")}</>}</small></span>
        </button>
        <div className="chat-actions">
          {!fullPage && <button className="chat-expand-action" type="button" onClick={onToggleExpanded} aria-label={expanded ? t("chat.collapse") : t("chat.expand")} title={expanded ? t("chat.collapse") : t("chat.expand")}>{expanded ? "↙" : "⛶"}</button>}
          {onReport && <button className="modal-tool-button modal-report-button" type="button" onClick={onReport} data-tooltip={t("safety.report")} aria-label={t("chat.report")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5m0 3h.01" /></svg></button>}
          <div className="chat-history-menu"><button className="chat-history-trigger" type="button" onClick={() => setHistoryMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={historyMenuOpen} aria-label={t("chat.actions")} title={t("chat.actions")}>⋯</button>{historyMenuOpen && <div className="chat-history-dropdown" role="menu"><button type="button" role="menuitem" disabled={historyClearing} onClick={() => void clearHistory()}>{historyClearing ? t("chat.clearingHistory") : t("chat.clearHistory")}</button></div>}</div>
          {!fullPage && <button className="chat-close-action" type="button" onClick={onClose} aria-label={t("chat.close")} title={t("chat.close")}>×</button>}
        </div>
      </header>
      <section className="message-area" aria-live="polite">
        {messageGroups.map((group) => <div className="chat-day-group" key={group.key}><div className="chat-day">{group.label}</div>{group.messages.map((message) => (
          message.system ? <div className="system-message" key={message.id}><span data-i18n-skip>✦ {message.text}</span><time dateTime={message.createdAt}>{messageTime(message)}</time></div> :
            <div className={`message-wrap ${message.mine ? "mine" : "theirs"}`} key={message.id}>
              <div className="message-bubble">{message.attachment && (() => { const item = shareItems.find((candidate) => candidate.kind === message.attachment?.kind && candidate.id === message.attachment?.id); return item ? <button className="chat-attachment-card" type="button" onClick={() => onOpenAttachment(message.attachment!)}><ChatAttachmentVisual item={item} /><span data-i18n-skip><strong>{item.title}</strong><em>{item.subtitle}</em></span></button> : null; })()}{message.text && <p data-i18n-skip>{message.text}</p>}<time>{messageTime(message)}{message.mine && <span className={`message-checks ${message.read ? "is-read" : ""}`} aria-label={message.read ? t("chat.read") : t("chat.sent")}>{message.read ? "✓✓" : "✓"}</span>}</time></div>
            </div>
        ))}</div>)}
      </section>
      <div className="chat-composer">
        {shareOpen && <section className="chat-share-popover"><header><h3>{t("chat.share")}</h3><button type="button" onClick={() => { setShareOpen(false); setShareKind(null); }}>×</button></header>{!shareKind ? <div className="chat-share-types">{shareTypes.map((item) => <button type="button" key={item.kind} onClick={() => setShareKind(item.kind)}>{item.label}</button>)}</div> : <><button className="chat-share-back" type="button" onClick={() => { setShareKind(null); setShareQuery(""); }}>← {t("common.back")}</button><input autoFocus value={shareQuery} onChange={(event) => changeShareQuery(event.target.value)} placeholder={currentShareType?.hint} /><div className="chat-share-results">{matchingItems.map((item) => <button type="button" key={`${item.kind}-${item.id}`} onClick={() => chooseAttachment(item)}><ChatAttachmentVisual item={item} compact /><b>{item.title}</b><small>{item.subtitle}</small></button>)}{shareQuery.trim() && !matchingItems.length && <p>{t("common.nothingFound")}</p>}</div></>}</section>}
        {attachment && <div className="chat-selected-attachment"><ChatAttachmentVisual item={attachment} compact /><button type="button" data-i18n-skip onClick={() => onOpenAttachment(attachment)}><strong>{attachment.title}</strong><small>{attachment.subtitle}</small></button><button type="button" aria-label={t("chat.removeAttachment")} onClick={() => setAttachment(null)}>×</button></div>}
      <form className="message-form" onSubmit={submit}>
        <button type="button" aria-label={t("chat.share")} onClick={() => { setShareOpen((open) => !open); setShareKind(null); setShareQuery(""); }}>＋</button>
        <input value={draft} onChange={(event) => changeDraft(event.target.value)} placeholder={t("chat.writeMessage")} aria-label={t("chat.message")} />
        <button className="send-button" type="submit" aria-label={t("chat.send")}>↑</button>
      </form>
      </div>
    </main>
  );
}
