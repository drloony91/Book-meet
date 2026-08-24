import { useEffect, useRef, useState, type ReactNode } from "react";
import { FriendsPanel } from "../chat/ChatComponents";
import type { Friend } from "../chat/types";
import { CompactLocaleButtons, LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { useI18n, type Translate } from "../../i18n";
import type { RoutableMainView } from "../../navigation/routes";
import type { UserProfileData } from "../../types/domain";

type WorkspaceNavigationItem = {
  view: RoutableMainView;
  label: string;
  group: "feed" | "library" | "personal";
};

function workspaceNavigationItems(t: Translate): WorkspaceNavigationItem[] {
  return [
    { view: "home", label: t("content.feed"), group: "feed" },
    { view: "events", label: t("desktop.nav.events"), group: "feed" },
    { view: "reviews", label: t("content.reviews"), group: "feed" },
    { view: "occasions", label: t("nav.dating"), group: "feed" },
    { view: "books", label: t("desktop.nav.books"), group: "library" },
    { view: "publishing", label: t("nav.publishers"), group: "library" },
    { view: "users", label: t("desktop.nav.people"), group: "library" },
    { view: "communities", label: t("desktop.nav.communities"), group: "library" },
    { view: "liked", label: t("feed.liked"), group: "personal" },
    { view: "saved", label: t("feed.saved"), group: "personal" },
  ];
}

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
  mobileMenuOpen = false,
  onMobileMenuToggle,
  onSearch,
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
  mobileMenuOpen?: boolean;
  onMobileMenuToggle?: () => void;
  onSearch?: () => void;
  guestAction?: { label: string; onClick: () => void };
}) {
  const { t } = useI18n();
  return (
    <header className="topbar">
      <button className="mobile-menu-toggle" type="button" onClick={onMobileMenuToggle} aria-label={mobileMenuOpen ? t("nav.closeMobileMenu") : t("nav.openMobileMenu")} aria-expanded={mobileMenuOpen}>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <button className="brand brand-header-logo" type="button" onClick={onHome} aria-label={`Book Meet — ${t("common.home")}`}>
        <img className="desktop-brand-mark" src="/desktop-brand/book-meet-mark.png" alt="" aria-hidden="true" />
        <img className="mobile-brand-logo" src="/book-meet-header-logo-v3.png" alt="" aria-hidden="true" />
      </button>
      <button className="mobile-search-button" type="button" onClick={onSearch} aria-label={t("common.search")} title={t("common.search")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4" /><path d="m16 16 4.3 4.3" /></svg>
      </button>
      <div className="desktop-brand-title" aria-hidden="true"><img src="/desktop-brand/book-meet-lettering.png" alt="" /></div>
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
        <button className={`mobile-chat-button ${showMobileChats ? "" : "mobile-chat-button-hidden"} ${chatsOpen ? "is-active" : ""} ${unreadMessages ? "has-messages" : ""}`} type="button" onClick={onChats} aria-label={`${t("header.chats")}: ${unreadMessages}`} aria-expanded={chatsOpen} title={t("header.chats")}><img className="desktop-header-icon" src="/desktop-icons/chat.png" alt="" aria-hidden="true" /><svg className="mobile-header-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" /></svg>{unreadMessages > 0 && <b>{unreadMessages > 99 ? "99+" : unreadMessages}</b>}</button>
        <button className={`notification-button ${unreadCount ? "has-notifications" : ""}`} type="button" onClick={onNotifications} aria-label={`${t("header.notifications")}: ${unreadCount}`} aria-expanded={notificationsOpen}>
          <span><img className="desktop-header-icon" src={unreadCount ? "/desktop-icons/bell-active.png" : "/desktop-icons/bell.png"} alt="" aria-hidden="true" /><span className="mobile-header-icon">🔔</span></span>{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}
        </button>
        {guestAction ? <button className="primary-button guest-login-button" type="button" onClick={guestAction.onClick}>{guestAction.label}</button> : <button className="user-button" type="button" onClick={onProfile} aria-label={t("nav.openAccount", { caption: accountCaption })}>
          <span className="user-copy"><strong>{accountName}</strong><small>{accountCaption}</small></span>
          <span className={`avatar avatar-sm avatar-user ${avatarUrl ? "has-photo" : ""}`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && initials}<span className="online-dot" /></span>
        </button>}
        {notificationsMenu}
      </div>
    </header>
  );
}

export function MobileNavigationDrawer({
  open,
  activeView,
  onClose,
  onNavigate,
  createOptions = [],
}: {
  open: boolean;
  activeView?: string;
  onClose: () => void;
  onNavigate: (view: RoutableMainView) => void;
  createOptions?: MobileCreateOption[];
}) {
  const { t } = useI18n();
  const [drawerCreateOpen, setDrawerCreateOpen] = useState(false);
  const items = workspaceNavigationItems(t);
  const isActive = (target: RoutableMainView) => target === "home" ? ["home", "publications"].includes(activeView ?? "") : target === activeView;
  if (!open) return null;
  return <>
    <button className="mobile-navigation-overlay" type="button" aria-label={t("nav.closeMobileMenu")} onClick={onClose} />
    <aside className="mobile-navigation-drawer" aria-label={t("nav.mobileMenu")}>
      <div className="mobile-navigation-drawer-header"><img src="/mobile-icons/book-meet-logo.png" alt="Book Meet" /></div>
      <div className="mobile-navigation-quick-row">
        {items.filter((item) => item.group === "personal").map((item) => <button type="button" key={item.view} className={isActive(item.view) ? "is-active" : ""} onClick={() => { onNavigate(item.view); onClose(); }} aria-label={item.label} title={item.label} aria-current={isActive(item.view) ? "page" : undefined}><img src={item.view === "liked" ? "/desktop-icons/heart.png" : "/desktop-icons/bookmark.png"} alt="" aria-hidden="true" /></button>)}
        <div className={`mobile-drawer-create ${drawerCreateOpen ? "is-open" : ""}`}><button type="button" aria-expanded={drawerCreateOpen} aria-label={t("content.createMaterial")} title={t("content.createMaterial")} onClick={() => setDrawerCreateOpen((value) => !value)}><img src="/desktop-icons/plus.png" alt="" aria-hidden="true" /></button><div className="mobile-drawer-create-menu" aria-hidden={!drawerCreateOpen}>{createOptions.map((option) => <button type="button" key={option.label} onClick={() => { option.onClick(); setDrawerCreateOpen(false); onClose(); }}>{option.label}</button>)}</div></div>
      </div>
      <nav className="mobile-navigation-list mobile-navigation-feed" aria-label={t("nav.sectionsLeft")}>
        {items.filter((item) => item.group === "feed").map((item) => <button type="button" key={item.view} className={isActive(item.view) ? "is-active" : ""} onClick={() => { onNavigate(item.view); onClose(); }} aria-current={isActive(item.view) ? "page" : undefined}><span>{item.label}</span></button>)}
      </nav>
      <nav className="mobile-navigation-list mobile-navigation-library" aria-label={t("nav.sectionsRight")}>
        {items.filter((item) => item.group === "library").map((item) => <button type="button" key={item.view} className={isActive(item.view) ? "is-active" : ""} onClick={() => { onNavigate(item.view); onClose(); }} aria-current={isActive(item.view) ? "page" : undefined}><span>{item.label}</span></button>)}
      </nav>
      <div className="mobile-navigation-locale"><CompactLocaleButtons /></div>
    </aside>
  </>;
}

export type MobileCreateOption = { label: string; onClick: () => void };

export function MobileBottomNavigation({
  activeView,
  initials,
  avatarUrl,
  unreadCount,
  unreadMessages,
  chatsOpen,
  notificationsOpen,
  createOptions,
  onHome,
  onChats,
  onNotifications,
  onProfile,
}: {
  activeView?: string;
  initials: string;
  avatarUrl?: string;
  unreadCount: number;
  unreadMessages: number;
  chatsOpen: boolean;
  notificationsOpen: boolean;
  createOptions: MobileCreateOption[];
  onHome: () => void;
  onChats: () => void;
  onNotifications: () => void;
  onProfile: () => void;
}) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const activateCreate = (action: () => void) => { setCreateOpen(false); action(); };
  return <nav className="mobile-bottom-navigation" aria-label={t("nav.mobileBottom")}>
    <button type="button" className={activeView === "home" || activeView === "publications" ? "is-active" : ""} onClick={onHome} aria-current={activeView === "home" || activeView === "publications" ? "page" : undefined} aria-label={t("nav.main")} title={t("nav.main")}>
      <span className="mobile-bottom-icon"><img src="/mobile-icons/home.png" alt="" aria-hidden="true" /></span>
    </button>
    <button type="button" className={chatsOpen || activeView === "chat" ? "is-active" : ""} onClick={onChats} aria-label={`${t("header.chats")}: ${unreadMessages}`} aria-current={activeView === "chat" ? "page" : undefined} title={t("header.chats")}>
      <span className="mobile-bottom-icon"><img src="/desktop-icons/chat.png" alt="" aria-hidden="true" />{unreadMessages > 0 && <b>{unreadMessages > 99 ? "99+" : unreadMessages}</b>}</span>
    </button>
    <div className={`mobile-bottom-create ${createOpen ? "is-open" : ""}`}>
      <div className="mobile-bottom-create-menu" aria-hidden={!createOpen}>
        {createOptions.map((option) => <button type="button" key={option.label} onClick={() => activateCreate(option.onClick)}>{option.label}</button>)}
      </div>
      <button className="mobile-bottom-create-toggle" type="button" aria-expanded={createOpen} aria-label={t("content.createMaterial")} title={t("content.createMaterial")} onClick={() => setCreateOpen((value) => !value)}><img src="/desktop-icons/plus.png" alt="" aria-hidden="true" /></button>
    </div>
    <button type="button" className={notificationsOpen || activeView === "notifications" ? "is-active" : ""} onClick={onNotifications} aria-label={`${t("header.notifications")}: ${unreadCount}`} aria-expanded={notificationsOpen} aria-current={activeView === "notifications" ? "page" : undefined} title={t("header.notifications")}>
      <span className="mobile-bottom-icon"><img src={unreadCount ? "/desktop-icons/bell-active.png" : "/desktop-icons/bell.png"} alt="" aria-hidden="true" />{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}</span>
    </button>
    <button type="button" className={activeView === "profile" ? "is-active" : ""} onClick={onProfile} aria-current={activeView === "profile" ? "page" : undefined} aria-label={t("nav.profile")} title={t("nav.profile")}>
      <span className={`avatar avatar-sm mobile-bottom-avatar ${avatarUrl ? "has-photo" : ""}`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && initials}</span>
    </button>
  </nav>;
}

export function WorkspaceScreen({
  friends,
  selectedId,
  adminMode,
  contentHub = false,
  expandedChat,
  mobileChatPage = false,
  mobileFriendsOpen = false,
  children,
  onFindFriends,
  onCreateOccasion,
  onSelectFriend,
  onCloseMobileFriends,
  onNavigate,
  activeView,
  profileType,
  onCreateEvent,
  onCreateReview,
  onCreatePublication,
  onCreatePublisherNews,
}: {
  friends: Friend[];
  selectedId: number | null;
  adminMode: boolean;
  contentHub?: boolean;
  expandedChat?: ReactNode;
  mobileChatPage?: boolean;
  mobileFriendsOpen?: boolean;
  children: ReactNode;
  onFindFriends: () => void;
  onCreateOccasion: () => void;
  onSelectFriend: (friend: Friend) => void;
  onCloseMobileFriends?: () => void;
  onNavigate?: (view: RoutableMainView) => void;
  activeView?: string;
  profileType?: UserProfileData["type"];
  onCreateEvent?: () => void;
  onCreateReview?: () => void;
  onCreatePublication?: () => void;
  onCreatePublisherNews?: () => void;
}) {
  const { t } = useI18n();
  const [friendsCollapsed, setFriendsCollapsed] = useState(false);
  const [desktopCreateOpen, setDesktopCreateOpen] = useState(false);
  const desktopCreateRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!desktopCreateOpen) return;
    const close = (event: PointerEvent) => { if (!desktopCreateRef.current?.contains(event.target as Node)) setDesktopCreateOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [desktopCreateOpen]);
  const chatPage = activeView === "chat";
  const navigationItems = workspaceNavigationItems(t);
  const navItems = navigationItems.filter((item) => item.group === "feed");
  const quickItems: Array<{ view: RoutableMainView; label: string; icon: string }> = [
    { view: "liked", label: t("feed.liked"), icon: "/desktop-icons/heart.png" },
    { view: "saved", label: t("feed.saved"), icon: "/desktop-icons/bookmark.png" },
  ];
  const libraryItems = navigationItems.filter((item) => item.group === "library");
  const publisher = profileType === "Издатель" || profileType === "Сообщество";
  const readerOrBlogger = profileType === "Читатель" || profileType === "Блогер";
  const chooseCreate = (action?: () => void) => { setDesktopCreateOpen(false); action?.(); };
  const navActive = (target: RoutableMainView) => target === "home" ? ["home", "publications"].includes(activeView ?? "") : target === activeView;
  const navigate = (target: RoutableMainView) => onNavigate?.(target);
  return (
    <div className={`workspace ${friends.length ? "" : "workspace-without-friends"} ${onNavigate ? "has-desktop-navigation" : ""} ${contentHub ? "workspace-content-hub" : ""} ${chatPage ? "workspace-chat-page" : ""} ${mobileChatPage ? "mobile-chat-page" : ""} ${friendsCollapsed ? "friends-collapsed" : ""} ${mobileFriendsOpen ? "mobile-friends-open" : "mobile-friends-closed"}`}>
      {mobileFriendsOpen && <button className="mobile-friends-backdrop" type="button" aria-label={t("header.closeChats")} onClick={onCloseMobileFriends} />}
      {onNavigate && <aside className="desktop-navigation" aria-label={t("nav.sectionsLeft")}>
        <div className="desktop-navigation-quick">{quickItems.map((item) => <button type="button" key={item.view} className={navActive(item.view) ? "is-active" : ""} onClick={() => navigate(item.view)} aria-label={item.label} title={item.label}><img src={item.icon} alt="" aria-hidden="true" /></button>)}<div ref={desktopCreateRef} className={`desktop-quick-create ${desktopCreateOpen ? "is-open" : ""}`}><button type="button" className="desktop-quick-create-toggle" aria-expanded={desktopCreateOpen} aria-label={t("content.createMaterial")} title={t("content.createMaterial")} onClick={() => setDesktopCreateOpen((value) => !value)}><img src="/desktop-icons/plus.png" alt="" aria-hidden="true" /></button><div className="desktop-quick-create-menu" aria-hidden={!desktopCreateOpen}>{!publisher && <button type="button" onClick={() => chooseCreate(onCreatePublication)}>{t("content.createPublication")}</button>}{readerOrBlogger && <button type="button" onClick={() => chooseCreate(onCreateReview)}>{t("content.createReview")}</button>}<button type="button" onClick={() => chooseCreate(onCreateEvent)}>{t("content.createEvent")}</button>{!publisher && <button type="button" onClick={() => chooseCreate(onCreateOccasion)}>{t("content.createOccasion")}</button>}{publisher && <button type="button" onClick={() => chooseCreate(onCreatePublisherNews)}>{t("content.publishNews")}</button>}</div></div></div>
        <div className="desktop-navigation-block">{navItems.map((item) => <button type="button" key={item.view} className={navActive(item.view) ? "is-active" : ""} onClick={() => navigate(item.view)} aria-current={navActive(item.view) ? "page" : undefined}><strong>{item.label}</strong></button>)}</div>
        <div className="desktop-navigation-block">{libraryItems.map((item) => <button type="button" key={item.view} className={navActive(item.view) ? "is-active" : ""} onClick={() => navigate(item.view)} aria-current={navActive(item.view) ? "page" : undefined}><strong>{item.label}</strong></button>)}</div>
      </aside>}
      {(chatPage || mobileFriendsOpen) && <FriendsPanel friends={friends} selectedId={selectedId} adminMode={adminMode} variant={chatPage ? "page" : "default"} collapsed={chatPage ? false : friendsCollapsed} onToggleCollapsed={() => setFriendsCollapsed((value) => !value)} onExpandCollapsed={() => { if (friendsCollapsed) setFriendsCollapsed(false); }} onFindFriends={onFindFriends} onCreateOccasion={onCreateOccasion} onSelect={(friend) => { if (friendsCollapsed) setFriendsCollapsed(false); onSelectFriend(friend); }} />}
      <section className="workspace-main">
        {expandedChat ?? children}
      </section>
    </div>
  );
}
