import { useState, type ReactNode } from "react";
import { FriendsPanel } from "../chat/ChatComponents";
import type { Friend } from "../chat/types";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { useI18n } from "../../i18n";

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
  guestAction,
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
  guestAction?: { label: string; onClick: () => void };
}) {
  const { t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileNavigate = (action: () => void) => { setMobileMenuOpen(false); action(); };
  return (
    <header className="topbar">
      <button className="brand brand-header-logo" type="button" onClick={onHome} aria-label={`Book Meet — ${t("common.home")}`}>
        <img src="/book-meet-header-logo-v3.png" alt="" aria-hidden="true" />
      </button>
      <nav className="topbar-menu topbar-menu-left" aria-label={t("nav.sectionsLeft")}>
        <button type="button" onClick={onBooks}>{t("nav.books")}</button>
        <button type="button" onClick={onPublishing}>{t("nav.publishing")}</button>
      </nav>
      <nav className="topbar-menu topbar-menu-right" aria-label={t("nav.sectionsRight")}>
        <button type="button" onClick={onCommunities}>{t("nav.communities")}</button>
        <button type="button" onClick={onPartners}>{t("nav.partners")}</button>
      </nav>
      <div className="topbar-account-actions">
        <LocaleSwitcher />
        {showMobileChats && <button className={`mobile-chat-button ${unreadMessages ? "has-messages" : ""}`} type="button" onClick={onChats} aria-label={`${t("header.chats")}: ${unreadMessages}`} aria-expanded={chatsOpen}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" /></svg>{unreadMessages > 0 && <b>{unreadMessages > 99 ? "99+" : unreadMessages}</b>}</button>}
        <button className={`notification-button ${unreadCount ? "has-notifications" : ""}`} type="button" onClick={onNotifications} aria-label={`${t("header.notifications")}: ${unreadCount}`} aria-expanded={notificationsOpen}>
          <span>🔔</span>{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}
        </button>
        {guestAction ? <button className="primary-button guest-login-button" type="button" onClick={guestAction.onClick}>{guestAction.label}</button> : <button className="user-button" type="button" onClick={() => { if (window.matchMedia("(max-width: 800px)").matches) setMobileMenuOpen((open) => !open); else onProfile(); }} aria-label={t("nav.openAccount", { caption: accountCaption })} aria-expanded={mobileMenuOpen}>
          <span className="user-copy"><strong>{accountName}</strong><small>{accountCaption}</small></span>
          <span className={`avatar avatar-sm avatar-user ${avatarUrl ? "has-photo" : ""}`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && initials}<span className="online-dot" /></span>
        </button>}
        {!guestAction && mobileMenuOpen && <nav className="mobile-account-menu" aria-label={t("nav.userMenu")}>
          <button type="button" onClick={() => mobileNavigate(onProfile)}>{t("nav.profile")}</button>
          <button type="button" onClick={() => mobileNavigate(onBooks)}>{t("nav.books")}</button>
          <button type="button" onClick={() => mobileNavigate(onPublishing)}>{t("nav.publishers")}</button>
          <button type="button" onClick={() => mobileNavigate(onCommunities)}>{t("nav.communityShort")}</button>
          <button type="button" onClick={() => mobileNavigate(onPartners)}>{t("nav.partnersShort")}</button>
          <button type="button" onClick={() => mobileNavigate(onLogout)}>{t("common.logout")}</button>
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
  const { t } = useI18n();
  const [friendsCollapsed, setFriendsCollapsed] = useState(false);
  return (
    <div className={`workspace ${friends.length ? "" : "workspace-without-friends"} ${contentHub ? "workspace-content-hub" : ""} ${friendsCollapsed ? "friends-collapsed" : ""} ${mobileFriendsOpen ? "mobile-friends-open" : "mobile-friends-closed"}`}>
      {mobileFriendsOpen && <button className="mobile-friends-backdrop" type="button" aria-label={t("header.closeChats")} onClick={onCloseMobileFriends} />}
      <FriendsPanel friends={friends} selectedId={selectedId} adminMode={adminMode} collapsed={friendsCollapsed} onToggleCollapsed={() => setFriendsCollapsed((value) => !value)} onExpandCollapsed={() => { if (friendsCollapsed) setFriendsCollapsed(false); }} onFindFriends={onFindFriends} onCreateOccasion={onCreateOccasion} onSelect={(friend) => { if (friendsCollapsed) setFriendsCollapsed(false); onSelectFriend(friend); }} />
      <section className="workspace-main">
        {expandedChat ?? children}
      </section>
    </div>
  );
}
