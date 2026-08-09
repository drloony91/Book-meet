import type { ReactNode } from "react";
import { FriendsPanel } from "../chat/ChatComponents";
import type { Friend } from "../chat/types";

export function BookMeetHeader({
  accountName,
  accountCaption,
  initials,
  avatarUrl,
  unreadCount,
  notificationsOpen,
  notificationsMenu,
  onHome,
  onPublishing,
  onNotifications,
  onProfile,
}: {
  accountName: string;
  accountCaption: string;
  initials: string;
  avatarUrl?: string;
  unreadCount: number;
  notificationsOpen: boolean;
  notificationsMenu?: ReactNode;
  onHome: () => void;
  onPublishing: () => void;
  onNotifications: () => void;
  onProfile: () => void;
}) {
  return (
    <header className="topbar">
      <button className="brand brand-header-logo" type="button" onClick={onHome} aria-label="Book Meet — на главную">
        <img src="/book-meet-header-logo-v3.png" alt="" aria-hidden="true" />
      </button>
      <nav className="topbar-menu topbar-menu-left" aria-label="Основные разделы слева">
        <button type="button" title="Раздел появится позже">Книги</button>
        <button type="button" onClick={onPublishing}>Новинки издательств</button>
      </nav>
      <div className="topbar-center">Твоё книжное пространство</div>
      <nav className="topbar-menu topbar-menu-right" aria-label="Основные разделы справа">
        <button type="button" title="Раздел появится позже">Сообщества</button>
        <button type="button" title="Раздел появится позже">Партнеры</button>
      </nav>
      <div className="topbar-account-actions">
        <button className={`notification-button ${unreadCount ? "has-notifications" : ""}`} type="button" onClick={onNotifications} aria-label={`Уведомления: ${unreadCount}`} aria-expanded={notificationsOpen}>
          <span>🔔</span>{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}
        </button>
        <button className="user-button" type="button" onClick={onProfile} aria-label={`Открыть: ${accountCaption}`}>
          <span className="user-copy"><strong>{accountName}</strong><small>{accountCaption}</small></span>
          <span className={`avatar avatar-sm avatar-user ${avatarUrl ? "has-photo" : ""}`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && initials}<span className="online-dot" /></span>
        </button>
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
  children,
  onFindFriends,
  onCreateOccasion,
  onSelectFriend,
}: {
  friends: Friend[];
  selectedId: number | null;
  adminMode: boolean;
  contentHub?: boolean;
  expandedChat?: ReactNode;
  children: ReactNode;
  onFindFriends: () => void;
  onCreateOccasion: () => void;
  onSelectFriend: (friend: Friend) => void;
}) {
  return (
    <div className={`workspace ${friends.length ? "" : "workspace-without-friends"} ${contentHub ? "workspace-content-hub" : ""}`}>
      <FriendsPanel friends={friends} selectedId={selectedId} adminMode={adminMode} onFindFriends={onFindFriends} onCreateOccasion={onCreateOccasion} onSelect={onSelectFriend} />
      <section className="workspace-main">
        {expandedChat ?? children}
      </section>
    </div>
  );
}
