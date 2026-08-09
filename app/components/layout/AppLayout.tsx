import { useState, type ReactNode } from "react";
import { FriendsPanel } from "../chat/ChatComponents";
import type { Friend } from "../chat/types";

export function BookMeetHeader({
  accountName,
  accountCaption,
  initials,
  avatarUrl,
  unreadCount,
  unreadMessages,
  chatsOpen,
  showMobileChats = true,
  notificationsOpen,
  notificationsMenu,
  onHome,
  onPublishing,
  onBooks,
  onCommunities,
  onPartners,
  onNotifications,
  onChats,
  onProfile,
  onLogout,
}: {
  accountName: string;
  accountCaption: string;
  initials: string;
  avatarUrl?: string;
  unreadCount: number;
  unreadMessages: number;
  chatsOpen: boolean;
  showMobileChats?: boolean;
  notificationsOpen: boolean;
  notificationsMenu?: ReactNode;
  onHome: () => void;
  onPublishing: () => void;
  onBooks: () => void;
  onCommunities: () => void;
  onPartners: () => void;
  onNotifications: () => void;
  onChats: () => void;
  onProfile: () => void;
  onLogout: () => void;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileNavigate = (action: () => void) => { setMobileMenuOpen(false); action(); };
  return (
    <header className="topbar">
      <button className="brand brand-header-logo" type="button" onClick={onHome} aria-label="Book Meet — на главную">
        <img src="/book-meet-header-logo-v3.png" alt="" aria-hidden="true" />
      </button>
      <nav className="topbar-menu topbar-menu-left" aria-label="Основные разделы слева">
        <button type="button" onClick={onBooks}>Все книги</button>
        <button type="button" onClick={onPublishing}>Новинки издательств</button>
      </nav>
      <nav className="topbar-menu topbar-menu-right" aria-label="Основные разделы справа">
        <button type="button" onClick={onCommunities}>Книжные сообщества</button>
        <button type="button" onClick={onPartners}>Наши партнеры</button>
      </nav>
      <div className="topbar-account-actions">
        {showMobileChats && <button className={`mobile-chat-button ${unreadMessages ? "has-messages" : ""}`} type="button" onClick={onChats} aria-label={`Диалоги: ${unreadMessages}`} aria-expanded={chatsOpen}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" /></svg>{unreadMessages > 0 && <b>{unreadMessages > 99 ? "99+" : unreadMessages}</b>}</button>}
        <button className={`notification-button ${unreadCount ? "has-notifications" : ""}`} type="button" onClick={onNotifications} aria-label={`Уведомления: ${unreadCount}`} aria-expanded={notificationsOpen}>
          <span>🔔</span>{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}
        </button>
        <button className="user-button" type="button" onClick={() => { if (window.matchMedia("(max-width: 800px)").matches) setMobileMenuOpen((open) => !open); else onProfile(); }} aria-label={`Открыть: ${accountCaption}`} aria-expanded={mobileMenuOpen}>
          <span className="user-copy"><strong>{accountName}</strong><small>{accountCaption}</small></span>
          <span className={`avatar avatar-sm avatar-user ${avatarUrl ? "has-photo" : ""}`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && initials}<span className="online-dot" /></span>
        </button>
        {mobileMenuOpen && <nav className="mobile-account-menu" aria-label="Меню пользователя">
          <button type="button" onClick={() => mobileNavigate(onProfile)}>Профиль</button>
          <button type="button" onClick={() => mobileNavigate(onBooks)}>Все книги</button>
          <button type="button" onClick={() => mobileNavigate(onPublishing)}>Издательства</button>
          <button type="button" onClick={() => mobileNavigate(onCommunities)}>Сообщества</button>
          <button type="button" onClick={() => mobileNavigate(onPartners)}>Партнеры</button>
          <button type="button" onClick={() => mobileNavigate(onLogout)}>Выйти</button>
        </nav>}
        {notificationsMenu}
      </div>
    </header>
  );
}

export function WorkspaceScreen({
  friends,
  selectedId,
  adminMode,
  contentHub = false,
  expandedChat,
  mobileFriendsOpen = false,
  children,
  onFindFriends,
  onCreateOccasion,
  onSelectFriend,
  onCloseMobileFriends,
}: {
  friends: Friend[];
  selectedId: number | null;
  adminMode: boolean;
  contentHub?: boolean;
  expandedChat?: ReactNode;
  mobileFriendsOpen?: boolean;
  children: ReactNode;
  onFindFriends: () => void;
  onCreateOccasion: () => void;
  onSelectFriend: (friend: Friend) => void;
  onCloseMobileFriends?: () => void;
}) {
  const [friendsCollapsed, setFriendsCollapsed] = useState(false);
  return (
    <div className={`workspace ${friends.length ? "" : "workspace-without-friends"} ${contentHub ? "workspace-content-hub" : ""} ${friendsCollapsed ? "friends-collapsed" : ""} ${mobileFriendsOpen ? "mobile-friends-open" : "mobile-friends-closed"}`}>
      {mobileFriendsOpen && <button className="mobile-friends-backdrop" type="button" aria-label="Закрыть список диалогов" onClick={onCloseMobileFriends} />}
      <FriendsPanel friends={friends} selectedId={selectedId} adminMode={adminMode} collapsed={friendsCollapsed} onToggleCollapsed={() => setFriendsCollapsed((value) => !value)} onExpandCollapsed={() => { if (friendsCollapsed) setFriendsCollapsed(false); }} onFindFriends={onFindFriends} onCreateOccasion={onCreateOccasion} onSelect={(friend) => { if (friendsCollapsed) setFriendsCollapsed(false); onSelectFriend(friend); }} />
      <section className="workspace-main">
        {expandedChat ?? children}
      </section>
    </div>
  );
}
