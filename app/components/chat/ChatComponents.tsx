import { FormEvent, useMemo, useState } from "react";
import type { ChatAttachment, ChatAttachmentKind, ChatShareItem, Friend, Message } from "./types";

export function Avatar({ friend, size = "md" }: { friend: Friend; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`avatar avatar-${size} avatar-${friend.color} ${friend.avatarUrl ? "has-photo" : ""}`} style={friend.avatarUrl ? { backgroundImage: `url(${friend.avatarUrl})` } : undefined} aria-hidden="true">
      {friend.support ? <span className="support-avatar-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 17v-2a11 11 0 0 1 22 0v2" /><path d="M5 16H3.5A2.5 2.5 0 0 0 1 18.5v5A2.5 2.5 0 0 0 3.5 26H7V16H5Zm22 0h1.5a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5H25V16h2Z" /><path d="M24 26c-1 2-3.5 3-6 3" /><path d="M8.5 15.5c1-4 4-6.5 7.5-6.5s6.5 2.5 7.5 6.5v5.2c0 4.6-3.3 7.8-7.5 7.8s-7.5-3.2-7.5-7.8v-5.2Z" fill="none" /><circle cx="12.5" cy="19" r="1" /><circle cx="16" cy="19" r="1" /><circle cx="19.5" cy="19" r="1" /></svg></span> : !friend.avatarUrl && friend.initials}
      {friend.supportCase && <span className="support-case-mark">🎧</span>}
      {friend.online && <span className="online-dot" />}
    </span>
  );
}

export function FriendsPanel({
  friends,
  selectedId,
  onSelect,
  onFindFriends,
  onCreateOccasion,
  collapsed = false,
  onToggleCollapsed,
  adminMode = false,
}: {
  friends: Friend[];
  selectedId: number | null;
  onSelect: (friend: Friend) => void;
  onFindFriends: () => void;
  onCreateOccasion: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  adminMode?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => friends.filter((friend) => friend.name.toLowerCase().includes(query.toLowerCase())),
    [query, friends],
  );
  const realFriendCount = friends.filter((friend) => !friend.support && !friend.supportCase).length;
  const hasSearchablePeople = adminMode ? friends.length > 0 : realFriendCount > 0;

  return (
    <aside className={`friends-panel ${!hasSearchablePeople ? "is-empty" : ""} ${collapsed ? "is-collapsed" : ""}`} aria-label="Список друзей">
      <div className="friends-heading">
        <div>
          <h2>{adminMode ? "Запросы" : "Друзья"} <span>{adminMode ? friends.length : realFriendCount}</span></h2>
        </div>
        {!adminMode && <button className="friends-find-button" type="button" onClick={onFindFriends}>Найти друзей</button>}
      </div>
      {!adminMode && <button className="friends-collapse-toggle" type="button" onClick={onToggleCollapsed} aria-label={collapsed ? "Развернуть друзей" : "Свернуть друзей"} title={collapsed ? "Развернуть друзей" : "Свернуть друзей"}><span aria-hidden="true">&lt;</span><span aria-hidden="true">&gt;</span></button>}
      {hasSearchablePeople && (
        <label className="friend-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти друга" aria-label="Найти друга" />
        </label>
      )}
      <div className="friend-list">
        {filtered.map((friend) => (
          <button type="button" className={`friend-row ${selectedId === friend.id ? "is-active" : ""}`} key={friend.id} onClick={() => onSelect(friend)}>
            <Avatar friend={friend} />
            <span className="friend-copy">
              <span className="friend-topline"><strong>{friend.name}</strong><small>{friend.time}</small></span>
              <span className="friend-bottomline"><span>{friend.lastMessage}</span>{friend.unread && <b>{friend.unread}</b>}</span>
            </span>
          </button>
        ))}
        {!adminMode && realFriendCount === 0 && <div className="friends-empty"><p>У вас нет друзей</p></div>}
        {hasSearchablePeople && filtered.length === 0 && <div className="friends-empty"><p>Совпадений не найдено</p></div>}
        {adminMode && !friends.length && <div className="friends-empty"><p>Запросов пока нет</p></div>}
      </div>
      {!adminMode && <button className="friends-footnote" type="button" onClick={onCreateOccasion}>
        <span aria-hidden="true">📖</span>
        <span><strong>Книжный повод</strong><small>Предложить повод для знакомства</small></span>
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
  profileEnabled = true,
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
  profileEnabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareKind, setShareKind] = useState<ChatAttachmentKind | null>(null);
  const [shareQuery, setShareQuery] = useState("");
  const [attachment, setAttachment] = useState<ChatShareItem | null>(null);
  const messageTime = (message: Message) => message.createdAt ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt)) : message.time;
  const shareTypes: { kind: ChatAttachmentKind; label: string; hint: string }[] = [
    { kind: "book", label: "Книгой", hint: "Начните писать название книги или вставьте ссылку на книгу" },
    { kind: "user", label: "Профилем пользователя", hint: "Начните писать имя пользователя или вставьте ссылку на профиль" },
    { kind: "event", label: "Книжным событием", hint: "Начните писать название события или вставьте ссылку на событие" },
    { kind: "review", label: "Рецензией на книгу", hint: "Начните писать название книги или вставьте ссылку на рецензию" },
    { kind: "excerpt", label: "Публикацией писателя", hint: "Начните писать название публикации или вставьте ссылку на публикацию" },
    { kind: "occasion", label: "Поводом познакомиться", hint: "Начните писать тему повода или вставьте ссылку на повод" },
  ];
  const currentShareType = shareTypes.find((item) => item.kind === shareKind);
  const matchingItems = useMemo(() => {
    if (!shareKind) return [];
    const normalized = shareQuery.trim().toLocaleLowerCase("ru");
    return shareItems.filter((item) => item.kind === shareKind && (!normalized || `${item.title} ${item.subtitle}`.toLocaleLowerCase("ru").includes(normalized))).slice(0, 8);
  }, [shareItems, shareKind, shareQuery]);

  function itemFromUrl(text: string) {
    const urlMatch = text.match(/https?:\/\/[^\s]+|\/(?:books|users|events|reviews|blog|meet)\/\d+/i)?.[0];
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

  return (
    <main className={`chat-view ${expanded ? "chat-expanded" : "chat-compact"}`}>
      <header className="chat-header">
        <button className="chat-person" type="button" onClick={profileEnabled ? onOpenProfile : undefined} aria-label={profileEnabled ? `Открыть профиль ${friend.name}` : friend.name} disabled={!profileEnabled}>
          <Avatar friend={friend} size="md" />
          <span><strong>{friend.name}</strong><small>{friend.type} · {friend.city} · {friend.online ? "в сети" : "не в сети"}</small></span>
        </button>
        <div className="chat-actions">
          <button type="button" onClick={onToggleExpanded} aria-label={expanded ? "Свернуть диалог" : "Расширить диалог"} title={expanded ? "Свернуть диалог" : "Расширить диалог"}>{expanded ? "↙" : "⛶"}</button>
          {onReport && <button className="chat-report-button" type="button" onClick={onReport} aria-label="Пожаловаться на диалог" title="Пожаловаться на диалог"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 8v6" /><circle cx="12" cy="17" r="1" /></svg></button>}
          <button type="button" onClick={onClose} aria-label="Закрыть диалог" title="Закрыть диалог">×</button>
        </div>
      </header>
      <section className="message-area" aria-live="polite">
        <div className="chat-day">Сегодня</div>
        {messages.map((message) => (
          message.system ? (friend.support ? null : <div className="system-message" key={message.id}>✦ {message.text}</div>) :
            <div className={`message-wrap ${message.mine ? "mine" : "theirs"}`} key={message.id}>
              <div className="message-bubble">{message.attachment && (() => { const item = shareItems.find((candidate) => candidate.kind === message.attachment?.kind && candidate.id === message.attachment?.id); return item ? <button className="chat-attachment-card" type="button" onClick={() => onOpenAttachment(message.attachment!)}>{item.imageUrl && <span className="chat-attachment-image" style={{ backgroundImage: `url(${item.imageUrl})` }} />}<span><strong>{item.title}</strong><em>{item.subtitle}</em></span></button> : null; })()}{message.text && <p>{message.text}</p>}<time>{messageTime(message)}{message.mine && <span className={`message-checks ${message.read ? "is-read" : ""}`} aria-label={message.read ? "Прочитано" : "Отправлено"}>{message.read ? "✓✓" : "✓"}</span>}</time></div>
            </div>
        ))}
      </section>
      <div className="chat-composer">
        {shareOpen && <section className="chat-share-popover"><header><h3>Поделиться</h3><button type="button" onClick={() => { setShareOpen(false); setShareKind(null); }}>×</button></header>{!shareKind ? <div className="chat-share-types">{shareTypes.map((item) => <button type="button" key={item.kind} onClick={() => setShareKind(item.kind)}>{item.label}</button>)}</div> : <><button className="chat-share-back" type="button" onClick={() => { setShareKind(null); setShareQuery(""); }}>← Назад</button><input autoFocus value={shareQuery} onChange={(event) => changeShareQuery(event.target.value)} placeholder={currentShareType?.hint} /><div className="chat-share-results">{matchingItems.map((item) => <button type="button" key={`${item.kind}-${item.id}`} onClick={() => chooseAttachment(item)}>{item.imageUrl && <span style={{ backgroundImage: `url(${item.imageUrl})` }} />}<b>{item.title}</b><small>{item.subtitle}</small></button>)}{shareQuery.trim() && !matchingItems.length && <p>Совпадений не найдено</p>}</div></>}</section>}
        {attachment && <div className="chat-selected-attachment"><button type="button" onClick={() => onOpenAttachment(attachment)}><strong>{attachment.title}</strong><small>{attachment.subtitle}</small></button><button type="button" aria-label="Убрать вложение" onClick={() => setAttachment(null)}>×</button></div>}
      <form className="message-form" onSubmit={submit}>
        <button type="button" aria-label="Поделиться" onClick={() => { setShareOpen((open) => !open); setShareKind(null); setShareQuery(""); }}>＋</button>
        <input value={draft} onChange={(event) => changeDraft(event.target.value)} placeholder="Написать сообщение…" aria-label="Сообщение" />
        <button className="send-button" type="submit" aria-label="Отправить сообщение">↑</button>
      </form>
      </div>
    </main>
  );
}
