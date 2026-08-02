"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar, ChatView } from "../components/chat/ChatComponents";
import type { ChatAttachment, ChatShareItem, Friend, Message } from "../components/chat/types";
import { BookMeetHeader, WorkspaceScreen } from "../components/layout/AppLayout";
import { NotificationDetail, NotificationsMenu } from "../components/notifications/Notifications";
import {
  appRouteFromPathname,
  initialMainView,
  mainViewPaths,
  mainViewTitles,
  notifyAppNavigation,
  normalizedPathname,
  useCurrentAppRoute,
  type ChatRouteState,
  type MainView,
  type OverlayHistoryState,
  type RoutableMainView,
} from "../navigation/routes";
import { ChatScreen } from "../screens/ChatScreen";
import { AuthBookTransition, LoginScreen } from "../screens/AuthScreens";
import { PublishingDirectoryPage, UsersDirectoryPage } from "../screens/UsersDirectoryScreen";
import { EventsDirectoryPage, HomeContent, MaterialsDirectoryPage, OccasionsDirectoryPage } from "../screens/ContentScreens";
import { AdminProfile, MyProfile } from "../screens/ProfileScreens";
import {
  AdminCatalogEditor,
  EventForm,
  EventModal,
  OccasionForm,
  OccasionModal,
  ReadingModal,
  UnifiedBookModal,
  UserProfileModal,
  deleteReadingMaterial,
  editReadingMaterial,
  emptyEvent,
  emptyOccasion,
} from "../components/content/ContentComponents";
import { EmptyContentState } from "../components/common/EmptyContentState";
import { ModalIconActions } from "../components/modals/ModalIconActions";
import { SafetyCenter, openReportDialog } from "../components/safety/SafetyCenter";
import {
  catalogFromUsers,
  eventTimestamp,
  excerptReadingItemById,
  formatKazakhstanPhone,
  normalizeBookKey,
  resolveCanonicalBook,
  reviewReadingItemById,
  sanitizeRichHtml,
  userBookMatches,
} from "../lib/domain";
import { apiFetch } from "../services/api";
import { BootstrapRequestError, loadApplicationData } from "../services/bootstrap";
import { conversationKey, finishMinimumLoading } from "./controller-utils";
import type {
  AdminCatalogItem,
  AdminMaterialKind,
  AdminSection,
  AuthResult,
  AuthorBook,
  BookEvent,
  BookFormat,
  BookLink,
  BootstrapData,
  CityOption,
  DemoUser,
  EventStatus,
  Excerpt,
  FlipProductPreview,
  Follow,
  FriendRequest,
  Friendship,
  LibraryBook,
  LibraryView,
  MaterialComment,
  Occasion,
  OccasionType,
  ProfileTab,
  ReadingItem,
  Review,
  SocialNotification,
  SafetyReport,
  UserBlock,
  UserSuspension,
  TotpSetup,
  TotpStatus,
  UserExcerpt,
  UserProfileData,
  UserReview,
  WishBook,
} from "../types/domain";

export function useBookMeetController() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authTransition, setAuthTransition] = useState(false);
  const [newlyRegistered, setNewlyRegistered] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [view, setView] = useState<MainView>(initialMainView);
  const currentRoute = useCurrentAppRoute();
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [profileUserId, setProfileUserId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [eventClock, setEventClock] = useState(() => Date.now());
  const [detailNotification, setDetailNotification] = useState<SocialNotification | null>(null);
  const [likes, setLikes] = useState<Record<string, number[]>>({});
  const [commenters, setCommenters] = useState<Record<string, number[]>>({});
  const [selectedBook, setSelectedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<ReadingItem | null>(null);
  const [adminEditingMaterial, setAdminEditingMaterial] = useState<AdminCatalogItem | null>(null);
  const [events, setEvents] = useState<BookEvent[]>([]);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<BookEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<BookEvent | null>(null);
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [occasionFormOpen, setOccasionFormOpen] = useState(false);
  const [editingOccasion, setEditingOccasion] = useState<Occasion | null>(null);
  const [selectedOccasion, setSelectedOccasion] = useState<Occasion | null>(null);
  const [profileAction, setProfileAction] = useState<"review" | "excerpt" | "book" | null>(null);
  const [profileEditId, setProfileEditId] = useState<number | null>(null);
  const [roleRestrictionNotice, setRoleRestrictionNotice] = useState<"review" | "excerpt" | "occasion" | "publisher-pending" | null>(null);
  const [blocks, setBlocks] = useState<UserBlock[]>([]);
  const [blockedByUserIds, setBlockedByUserIds] = useState<number[]>([]);
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [suspension, setSuspension] = useState<UserSuspension | null>(null);
  const [blockedProfileNotice, setBlockedProfileNotice] = useState(false);
  const [adultAccess, setAdultAccess] = useState<NonNullable<BootstrapData["adultAccess"]>>({ status: "adult", restricted: {} });
  const [adultRestrictionNotice, setAdultRestrictionNotice] = useState<"minor" | "missing" | null>(null);
  const [deletedRecovery, setDeletedRecovery] = useState<{ daysRemaining: number } | null>(null);
  const profileSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const currentUser = users.find((user) => user.id === activeUserId) ?? null;
  const visibleUsers = users.filter((user) => currentUser?.isAdmin || user.id === activeUserId || !user.blockedByMe);
  const routeDataRef = useRef({ users, activeUserId, friendships, notifications, events, occasions, adultAccess });
  routeDataRef.current = { users, activeUserId, friendships, notifications, events, occasions, adultAccess };

  useEffect(() => {
    if (profileUserId && blockedByUserIds.includes(profileUserId)) setBlockedProfileNotice(true);
  }, [profileUserId, blockedByUserIds]);

  useEffect(() => {
    const timer = window.setInterval(() => setEventClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeUserId || authLoading || authTransition) return;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.hidden) return;
      refreshing = true;
      try {
        const data = await loadApplicationData(["catalog", "social", "moderation"]);
        if (!active) return;
        setUsers(data.users);
        setMessages(data.messages ?? {});
        setFriendRequests(data.friendRequests ?? []);
        setFriendships(data.friendships ?? []);
        setFollows(data.follows ?? []);
        setNotifications(data.notifications ?? []);
        setLikes(data.likes ?? {});
        setEvents(data.events ?? []);
        setOccasions(data.occasions ?? []);
        setAdultAccess(data.adultAccess ?? { status: "adult", restricted: {} });
        setBlocks(data.blocks ?? []);
        setBlockedByUserIds(data.blockedByUserIds ?? []);
        setReports(data.reports ?? []);
      } catch (error) {
        if (error instanceof BootstrapRequestError && error.status === 423) {
          setSuspension({ permanent: Boolean(error.data.permanent), until: typeof error.data.until === "string" ? error.data.until : undefined, reason: typeof error.data.reason === "string" ? error.data.reason : "" });
          return;
        }
        console.warn("Realtime refresh failed", error);
      } finally {
        refreshing = false;
      }
    };
    const eventsSource = new EventSource("/api/realtime", { withCredentials: true });
    eventsSource.addEventListener("update", refresh);
    const timer = window.setInterval(refresh, 30_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; eventsSource.close(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [activeUserId, authLoading, authTransition]);

  useEffect(() => {
    const restoreRoute = () => {
      const route = appRouteFromPathname(window.location.pathname);
      const routeData = routeDataRef.current;
      setSelectedFriend(null);
      setChatExpanded(false);
      setProfileUserId(null);
      setSelectedBook(null);
      setSelectedMaterial(null);
      setSelectedEvent(null);
      setSelectedOccasion(null);
      setDetailNotification(null);
      setNotificationsOpen(false);
      if (route.overlay?.kind === "chat") {
        const viewer = routeData.users.find((user) => user.id === routeData.activeUserId);
        const chatUser = routeData.users.find((user) => user.id === route.overlay!.id);
        const chatState = (window.history.state ?? {}) as ChatRouteState;
        const expanded = chatState.chatMode ? chatState.chatMode === "expanded" : !chatState.backgroundPath;
        const backgroundRoute = chatState.backgroundPath ? appRouteFromPathname(chatState.backgroundPath) : null;
        setView(backgroundRoute?.view ?? "chat");
        setChatExpanded(expanded);
        if (viewer && chatUser) {
          const mayChat = routeData.friendships.some((item) => (item.userA === viewer.id && item.userB === chatUser.id) || (item.userA === chatUser.id && item.userB === viewer.id)) || viewer.isAdmin || chatUser.isAdmin;
          if (mayChat) {
            setSelectedFriend({
              id: chatUser.id,
              name: chatUser.isAdmin && !viewer.isAdmin ? "Служба поддержки" : chatUser.profile.name,
              type: chatUser.profile.type,
              city: chatUser.profile.city,
              initials: chatUser.initials,
              avatarUrl: chatUser.avatarUrl,
              color: chatUser.isAdmin ? "navy" : chatUser.color,
              online: Boolean(chatUser.online),
              support: Boolean(chatUser.isAdmin && !viewer.isAdmin),
              lastMessage: "",
              time: "",
              bio: chatUser.profile.bio,
              books: chatUser.profile.favoriteGenres.join(", "),
            });
            document.title = `${chatUser.isAdmin && !viewer.isAdmin ? "Служба поддержки" : chatUser.profile.name} — Диалоги Book Meet`;
          }
        }
        return;
      }
      const overlayState = (window.history.state ?? {}) as OverlayHistoryState;
      const backgroundRoute = route.overlay && overlayState.backgroundPath ? appRouteFromPathname(overlayState.backgroundPath) : null;
      setView(backgroundRoute?.view ?? route.view);
      if (!route.overlay) {
        document.title = route.view === "profile" ? "Мой профиль — Book Meet" : mainViewTitles[route.view];
        return;
      }
      const adultKind = route.overlay.kind === "book" || route.overlay.kind === "review" || route.overlay.kind === "excerpt" || route.overlay.kind === "event" || route.overlay.kind === "occasion" ? route.overlay.kind : null;
      if (adultKind && routeData.adultAccess.status !== "adult" && routeData.adultAccess.restricted[adultKind]?.includes(route.overlay.id)) {
        setAdultRestrictionNotice(routeData.adultAccess.status);
        document.title = "Материал 18+ — Book Meet";
        return;
      }
      if (route.overlay.kind === "user") setProfileUserId(routeData.users.find((user) => user.id === route.overlay!.id && !user.isAdmin)?.id ?? null);
      if (route.overlay.kind === "book") setSelectedBook(catalogFromUsers(routeData.users).find((book) => book.id === route.overlay!.id) ?? null);
      if (route.overlay.kind === "review") setSelectedMaterial(reviewReadingItemById(routeData.users, route.overlay.id));
      if (route.overlay.kind === "excerpt") setSelectedMaterial(excerptReadingItemById(routeData.users, route.overlay.id));
      if (route.overlay.kind === "event") setSelectedEvent(routeData.events.find((item) => item.id === route.overlay!.id) ?? null);
      if (route.overlay.kind === "occasion") setSelectedOccasion(routeData.occasions.find((item) => item.id === route.overlay!.id) ?? null);
      if (route.overlay.kind === "notification") setDetailNotification(routeData.notifications.find((item) => item.id === route.overlay!.id) ?? null);
    };
    restoreRoute();
    window.addEventListener("popstate", restoreRoute);
    return () => window.removeEventListener("popstate", restoreRoute);
  }, [activeUserId]);

  useEffect(() => {
    if (view === "profile") {
      document.title = "Мой профиль — Book Meet";
      return;
    }
    if (!appRouteFromPathname(window.location.pathname).overlay) document.title = mainViewTitles[view];
  }, [view]);

  useEffect(() => {
    const openEditor = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: "review" | "excerpt"; id: number; admin?: boolean }>).detail;
      if (!detail?.id || !["review", "excerpt"].includes(detail.kind)) return;
      if (detail.admin && currentUser?.isAdmin) {
        const owner = users.find((user) => detail.kind === "review" ? user.reviews.some((item) => item.id === detail.id) : (user.excerpts ?? []).some((item) => item.id === detail.id));
        const source = detail.kind === "review" ? owner?.reviews.find((item) => item.id === detail.id) : owner?.excerpts?.find((item) => item.id === detail.id);
        if (owner && source) {
          setSelectedMaterial(null);
          setAdminEditingMaterial({ id: detail.id, kind: detail.kind, title: detail.kind === "review" ? (source as UserReview).bookTitle : (source as UserExcerpt).bookTitle || "Публикация", subtitle: owner.profile.name, text: detail.kind === "review" ? (source as UserReview).preview : (source as UserExcerpt).previewText, source: { ...source, ownerId: owner.id, ownerName: owner.profile.name } });
        }
        return;
      }
      setProfileAction(detail.kind);
      setProfileEditId(detail.id);
      setSelectedMaterial(null);
      openOwnProfile();
    };
    window.addEventListener("bookmeet:edit-material", openEditor);
    return () => window.removeEventListener("bookmeet:edit-material", openEditor);
  }, [currentUser?.isAdmin, users]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".notifications-menu, .notification-button")) setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [notificationsOpen]);

  const isFriendPair = (firstId: number, secondId: number) => friendships.some((item) => (item.userA === firstId && item.userB === secondId) || (item.userA === secondId && item.userB === firstId));
  const friendIds = currentUser ? friendships.flatMap((item) => item.userA === currentUser.id ? [item.userB] : item.userB === currentUser.id ? [item.userA] : []) : [];
  const currentFriendUsers = users.filter((user) => friendIds.includes(user.id));
  const adminUser = users.find((user) => user.isAdmin);
  const friendRows: Friend[] = currentFriendUsers.map((user) => {
    const conversation = currentUser ? messages[conversationKey(currentUser.id, user.id)] ?? [] : [];
    const last = [...conversation].reverse().find((message) => !message.system);
    return { id: user.id, name: user.profile.name, type: user.profile.type, city: user.profile.city, initials: user.initials, avatarUrl: user.avatarUrl, color: user.color, online: Boolean(user.online), unread: conversation.filter((message) => message.unread && !message.mine && !message.system).length || undefined, lastMessage: last?.text || (last?.attachment ? "Вложение" : "Теперь вы друзья"), time: last?.time ?? "сейчас", bio: user.profile.bio, books: user.profile.favoriteGenres.join(", ") };
  });
  const supportRow: Friend[] = currentUser && !currentUser.isAdmin && adminUser && !friendRows.some((friend) => friend.id === adminUser.id) ? (() => { const conversation = messages[conversationKey(currentUser.id, adminUser.id)] ?? []; const last = [...conversation].reverse().find((message) => !message.system); return [{ id: adminUser.id, name: "Служба поддержки", type: adminUser.profile.type, city: adminUser.profile.city, initials: "✓", color: "navy", online: Boolean(adminUser.online), support: true, unread: conversation.filter((message) => message.unread && !message.mine && !message.system).length || undefined, lastMessage: last?.text ?? "Мы всегда на связи", time: last?.time ?? "", bio: "Официальная служба поддержки Book Meet", books: "" }]; })() : [];
  const adminSupportRows: Friend[] = currentUser?.isAdmin ? users.filter((user) => user.id !== currentUser.id && !friendIds.includes(user.id) && Object.prototype.hasOwnProperty.call(messages, conversationKey(currentUser.id, user.id))).map((user) => { const conversation = messages[conversationKey(currentUser.id, user.id)] ?? []; const last = [...conversation].reverse().find((message) => !message.system); return { id: user.id, name: user.profile.name, type: user.profile.type, city: user.profile.city, initials: user.initials, avatarUrl: user.avatarUrl, color: user.color, online: Boolean(user.online), supportCase: true, unread: conversation.filter((message) => message.unread && !message.mine && !message.system).length || undefined, lastMessage: last?.text || (last?.attachment ? "Вложение" : "Обращение в поддержку"), time: last?.time ?? "", bio: user.profile.bio, books: user.profile.favoriteGenres.join(", ") }; }) : [];
  const currentFriends: Friend[] = currentUser?.isAdmin ? [...friendRows, ...adminSupportRows] : [...friendRows.filter((friend) => friend.id !== adminUser?.id), ...(currentUser && adminUser ? (friendRows.some((friend) => friend.id === adminUser.id) ? friendRows.filter((friend) => friend.id === adminUser.id).map((friend) => ({ ...friend, name: "Служба поддержки", support: true })) : supportRow) : [])];
  const allReviews: Review[] = visibleUsers.flatMap((user, userIndex) => user.reviews.map((review, reviewIndex) => ({ id: review.id, ownerId: user.id, quote: review.preview, fullText: review.fullText, book: `«${review.bookTitle}»`, author: review.bookAuthor, user: user.profile.name, rating: String(review.rating), tone: ["blue", "green", "red"][(userIndex + reviewIndex) % 3], createdAt: review.createdAt, createdAtValue: review.createdAtValue, isAdult: review.isAdult })));
  const allExcerpts: Excerpt[] = visibleUsers.flatMap((user) => (user.excerpts ?? []).map((excerpt) => ({ id: excerpt.id, ownerId: user.id, text: excerpt.previewText || excerpt.text.slice(0, 500), fullText: excerpt.text || excerpt.previewText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.bookId, title: excerpt.bookTitle || "Публикация", author: user.profile.name, genre: "", createdAt: excerpt.createdAt, createdAtValue: excerpt.createdAtValue, isAdult: excerpt.isAdult })));
  const shareItems = useMemo<ChatShareItem[]>(() => {
    const books: ChatShareItem[] = catalogFromUsers(users).map((book) => ({ kind: "book", id: book.id, title: book.title, subtitle: book.author, preview: book.annotation, imageUrl: book.coverUrl, path: `/books/${book.id}` }));
    const people: ChatShareItem[] = users.filter((user) => !user.isAdmin).map((user) => ({ kind: "user", id: user.id, title: user.profile.name, subtitle: `${user.profile.type} · ${user.profile.city}`, preview: user.profile.bio, imageUrl: user.avatarUrl, path: `/users/${user.id}` }));
    const eventItems: ChatShareItem[] = events.filter((item) => item.status === "published").map((item) => ({ kind: "event", id: item.id, title: item.title, subtitle: `${item.city} · ${item.date}`, preview: item.summary, imageUrl: item.bookCoverUrl, path: `/events/${item.id}` }));
    const reviewItems: ChatShareItem[] = users.flatMap((user) => user.reviews.map((review) => ({ kind: "review" as const, id: review.id, title: review.bookTitle, subtitle: `Рецензия · ${user.profile.name}`, preview: review.preview, imageUrl: catalogFromUsers(users).find((book) => book.id === review.bookId)?.coverUrl, path: `/reviews/${review.id}` })));
    const excerptItems: ChatShareItem[] = users.flatMap((user) => (user.excerpts ?? []).map((excerpt) => ({ kind: "excerpt" as const, id: excerpt.id, title: excerpt.bookTitle || "Публикация", subtitle: user.profile.name, preview: excerpt.previewText, imageUrl: catalogFromUsers(users).find((book) => book.id === excerpt.bookId)?.coverUrl, path: `/blog/${excerpt.id}` })));
    const occasionItems: ChatShareItem[] = occasions.filter((item) => item.status === "published").map((item) => ({ kind: "occasion", id: item.id, title: item.primaryText.slice(0, 72), subtitle: `${item.targetCities.join(", ")} · ${item.creatorName}`, preview: item.audienceText, path: `/meet/${item.id}` }));
    return [...books, ...people, ...eventItems, ...reviewItems, ...excerptItems, ...occasionItems];
  }, [users, events, occasions]);
  const homeReviews = currentUser ? allReviews : [];
  const homeExcerpts = currentUser ? allExcerpts : [];
  const currentNotifications = currentUser ? notifications.filter((notification) => notification.userId === currentUser.id).sort((a, b) => b.id - a.id) : [];
  const unreadCount = currentNotifications.filter((notification) => notification.unread).length;
  const profileUser = users.find((user) => user.id === profileUserId && !user.isAdmin) ?? null;

  useEffect(() => {
    if (!currentUser) { setCommenters({}); return; }
    let active = true;
    apiFetch("/api/material-stats", { credentials: "same-origin" }).then((response) => response.json()).then((data: { commenters?: Record<string, number[]> }) => { if (active) setCommenters(data.commenters ?? {}); }).catch((error) => console.warn(error));
    return () => { active = false; };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!selectedFriend || chatExpanded) return;
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".chat-popup")) return;
      const state = (window.history.state ?? {}) as ChatRouteState;
      if (/^\/chat\/\d+$/.test(normalizedPathname(window.location.pathname)) && state.backgroundPath) {
        const backgroundRoute = appRouteFromPathname(state.backgroundPath);
        window.history.replaceState({ bookMeetView: backgroundRoute.view }, "", state.backgroundPath);
        setView(backgroundRoute.view);
        document.title = backgroundRoute.view === "profile" ? "Мой профиль — Book Meet" : mainViewTitles[backgroundRoute.view];
      }
      setSelectedFriend(null);
      setChatExpanded(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideInteraction, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsideInteraction, true);
  }, [selectedFriend, chatExpanded]);

  function applyBootstrap(data: BootstrapData) {
    setUsers(data.users);
    setActiveUserId(data.activeUserId);
    setMessages(data.messages ?? {});
    setFriendRequests(data.friendRequests ?? []);
    setFriendships(data.friendships ?? []);
    setFollows(data.follows ?? []);
    setNotifications(data.notifications ?? []);
    setLikes(data.likes ?? {});
    setEvents(data.events ?? []);
    setOccasions(data.occasions ?? []);
    setAdultAccess(data.adultAccess ?? { status: "adult", restricted: {} });
    setBlocks(data.blocks ?? []);
    setBlockedByUserIds(data.blockedByUserIds ?? []);
    setReports(data.reports ?? []);
    setSuspension(null);
    setStartupError("");
  }

  async function refreshBootstrap() {
    try {
      applyBootstrap(await loadApplicationData());
    } catch (error) {
      if (!(error instanceof BootstrapRequestError) || error.status !== 423) throw error;
      setSuspension({ permanent: Boolean(error.data.permanent), until: typeof error.data.until === "string" ? error.data.until : undefined, reason: typeof error.data.reason === "string" ? error.data.reason : "" });
      setUsers([]);
      setActiveUserId(null);
    }
  }

  useEffect(() => {
    let active = true;
    const loadingStartedAt = Date.now();
    const query = new URLSearchParams(window.location.search);
    const oauthSuccess = query.get("auth") === "success";
    const oauthRegistration = query.get("registered") === "1";
    const authError = query.get("auth_error");
    if (authError) {
      setStartupError(authError.endsWith("not_configured") ? "Google-вход пока не настроен." : "Не удалось завершить вход через Google. Попробуйте ещё раз.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    loadApplicationData().then(async (data) => {
      if (!active) return;
      const needsProfile = oauthRegistration || data.profileCompleted === false;
      if (oauthSuccess) {
        setAuthTransition(true);
        applyBootstrap(data);
        setNewlyRegistered(needsProfile);
        setView(needsProfile ? "profile" : "home");
        setAuthTransition(false);
        window.history.replaceState({}, "", needsProfile ? "/profile" : "/");
      } else {
        applyBootstrap(data);
        if (data.profileCompleted === false) {
          setNewlyRegistered(true);
          setView("profile");
          const initialRoute = appRouteFromPathname(window.location.pathname);
          const restrictedKind = initialRoute.overlay?.kind === "book" || initialRoute.overlay?.kind === "review" || initialRoute.overlay?.kind === "excerpt" || initialRoute.overlay?.kind === "event" || initialRoute.overlay?.kind === "occasion" ? initialRoute.overlay.kind : null;
          const restrictedAdultLink = restrictedKind && data.adultAccess?.status === "missing" && data.adultAccess.restricted[restrictedKind]?.includes(initialRoute.overlay!.id);
          window.history.replaceState(restrictedAdultLink ? { backgroundPath: "/profile" } : {}, "", restrictedAdultLink ? window.location.pathname : "/profile");
        }
      }
    }).catch((error) => {
      if (!active) return;
      if (error instanceof BootstrapRequestError && error.status === 401) return;
      if (error instanceof BootstrapRequestError && error.status === 423) {
        setSuspension({ permanent: Boolean(error.data.permanent), until: typeof error.data.until === "string" ? error.data.until : undefined, reason: typeof error.data.reason === "string" ? error.data.reason : "" });
        return;
      }
      if (error instanceof BootstrapRequestError && error.status === 410 && error.data.deletedProfile) {
        setDeletedRecovery({ daysRemaining: Number(error.data.daysRemaining ?? 0) });
        return;
      }
      setStartupError(error instanceof Error ? error.message : "Сервер Book Meet пока недоступен");
    }).finally(async () => { await finishMinimumLoading(loadingStartedAt); if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const createReview = () => startCreating("review");
    const createExcerpt = () => startCreating("excerpt");
    window.addEventListener("bookmeet:create-review", createReview);
    window.addEventListener("bookmeet:create-excerpt", createExcerpt);
    return () => { window.removeEventListener("bookmeet:create-review", createReview); window.removeEventListener("bookmeet:create-excerpt", createExcerpt); };
  }, [currentUser?.id, currentUser?.profile.type]);

  function addNotification(notification: Omit<SocialNotification, "id" | "unread" | "createdAt">) {
    setNotifications((current) => [...current, { ...notification, id: Date.now() + Math.random(), unread: true, createdAt: "сейчас" }]);
  }

  function toggleLike(item: ReadingItem) {
    if (!currentUser || !item.ownerId || item.ownerId === currentUser.id) return;
    const key = `${item.kind}-${item.id}`;
    const alreadyLiked = (likes[key] ?? []).includes(currentUser.id);
    void apiFetch("/api/reactions", { method: alreadyLiked ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: currentUser.id, ownerId: item.ownerId, materialKind: item.kind, materialId: item.id, text: `${currentUser.profile.name} поставил(а) «Нравится»: ${item.title}.` }) }).catch((error) => console.warn(error));
    setLikes((current) => ({ ...current, [key]: alreadyLiked ? (current[key] ?? []).filter((id) => id !== currentUser.id) : [...(current[key] ?? []), currentUser.id] }));
    if (alreadyLiked) return;
    setNotifications((current) => {
      const existing = current.find((notification) => notification.userId === item.ownerId && notification.type === "like" && notification.materialId === item.id && notification.materialKind === item.kind);
      const total = (likes[key] ?? []).length + 1;
      const text = total > 1 ? `${currentUser.profile.name} и ещё ${total - 1} поставили «Нравится»: ${item.title}.` : `${currentUser.profile.name} поставил(а) «Нравится»: ${item.title}.`;
      if (existing) return current.map((notification) => notification.id === existing.id ? { ...notification, actorId: currentUser.id, text, unread: true, createdAt: "сейчас" } : notification);
      return [...current, { id: Date.now() + Math.random(), userId: item.ownerId!, actorId: currentUser.id, type: "like", title: "Нравится", text, unread: true, createdAt: "сейчас", materialId: item.id, materialKind: item.kind }];
    });
  }

  async function addComment(item: ReadingItem, text: string): Promise<MaterialComment | null> {
    if (!currentUser || !item.ownerId) return null;
    const notificationText = `${currentUser.profile.name} прокомментировал(а) материал «${item.title}»: ${text}`;
    try {
      const response = await apiFetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: currentUser.id, ownerId: item.ownerId, materialKind: item.kind, materialId: item.id, body: text, notificationText }) });
      if (!response.ok) throw new Error("Не удалось сохранить комментарий");
      const data = await response.json() as { comment: MaterialComment };
      const key = `${item.kind}-${item.id}`;
      setCommenters((current) => ({ ...current, [key]: current[key]?.includes(currentUser.id) ? current[key] : [...(current[key] ?? []), currentUser.id] }));
      if (item.ownerId !== currentUser.id) addNotification({ userId: item.ownerId, actorId: currentUser.id, type: "comment", title: "Новый комментарий", text: notificationText, materialId: item.id, materialKind: item.kind });
      return data.comment;
    } catch (error) { console.warn(error); return null; }
  }

  function navigateMainView(nextView: RoutableMainView, options?: { replace?: boolean }) {
    setView(nextView);
    setProfileUserId(null);
    setSelectedBook(null);
    setSelectedMaterial(null);
    setSelectedEvent(null);
    setSelectedOccasion(null);
    const nextPath = mainViewPaths[nextView];
    if (normalizedPathname(window.location.pathname) !== nextPath) {
      window.history[options?.replace ? "replaceState" : "pushState"]({ bookMeetView: nextView }, "", nextPath);
      notifyAppNavigation();
    }
  }

  function openOwnProfile(options?: { replace?: boolean }) {
    setProfileUserId(null);
    setSelectedBook(null);
    setSelectedMaterial(null);
    setSelectedEvent(null);
    setSelectedOccasion(null);
    setView("profile");
    if (normalizedPathname(window.location.pathname) !== "/profile") {
      const backgroundPath = normalizedPathname(window.location.pathname);
      window.history[options?.replace ? "replaceState" : "pushState"]({ bookMeetPage: true, backgroundPath }, "", "/profile");
      notifyAppNavigation();
    }
  }

  function leaveRestrictedMaterial(openProfile = false) {
    const state = (window.history.state ?? {}) as OverlayHistoryState;
    const route = appRouteFromPathname(window.location.pathname);
    const backgroundPath = state.backgroundPath || (route.view in mainViewPaths ? mainViewPaths[route.view as RoutableMainView] : "/");
    const backgroundRoute = appRouteFromPathname(backgroundPath);
    setAdultRestrictionNotice(null);
    setView(backgroundRoute.view);
    window.history.replaceState({ bookMeetView: backgroundRoute.view }, "", backgroundPath);
    notifyAppNavigation();
    if (openProfile) openOwnProfile();
  }

  function closeOwnProfile() { goHome(); }

  function goHome() { navigateMainView("home"); setSelectedFriend(null); setChatExpanded(false); setProfileAction(null); setProfileEditId(null); }
  function startCreating(action: "review" | "excerpt" | "book") {
    if (action === "review" && currentUser?.profile.type !== "Читатель" && currentUser?.profile.type !== "Блогер") {
      setRoleRestrictionNotice("review");
      return;
    }
    if (action === "excerpt" && currentUser?.profile.type !== "Писатель" && currentUser?.profile.type !== "Блогер") {
      setRoleRestrictionNotice("excerpt");
      return;
    }
    setProfileAction(action);
    setProfileEditId(null);
    openOwnProfile();
  }

  function startOccasionCreation() {
    if (currentUser?.profile.type === "Издатель") {
      setRoleRestrictionNotice(currentUser.profile.publisherStatus === "approved" ? "occasion" : "publisher-pending");
      return;
    }
    setOccasionFormOpen(true);
  }

  function startEventCreation() {
    if (currentUser?.profile.type === "Издатель" && currentUser.profile.publisherStatus !== "approved") {
      setRoleRestrictionNotice("publisher-pending");
      return;
    }
    setEventFormOpen(true);
  }

  function openUserProfile(userId: number) {
    if (blockedByUserIds.includes(userId)) {
      setBlockedProfileNotice(true);
      return;
    }
    const user = users.find((item) => item.id === userId);
    if (!user || user.isAdmin) return;
    if (user.id === currentUser?.id) {
      openOwnProfile();
      return;
    }
    setProfileUserId(userId); setNotificationsOpen(false);
  }

  function openChat(userId: number) {
    if (!currentUser) return;
    const user = users.find((item) => item.id === userId);
    if (!user || (!isFriendPair(currentUser.id, userId) && !currentUser.isAdmin && !user.isAdmin)) return;
    const currentPath = normalizedPathname(window.location.pathname);
    const currentChatState = (window.history.state ?? {}) as ChatRouteState;
    const isSwitchingChat = /^\/chat\/\d+$/.test(currentPath);
    const expanded = selectedFriend ? chatExpanded : false;
    const backgroundPath = isSwitchingChat ? (currentChatState.backgroundPath ?? "/chat") : currentPath;
    const nextState: ChatRouteState = { bookMeetChat: true, backgroundPath, chatMode: expanded ? "expanded" : "compact" };
    window.history[isSwitchingChat ? "replaceState" : "pushState"](nextState, "", `/chat/${userId}`);
    notifyAppNavigation();
    document.title = `${user.isAdmin && !currentUser.isAdmin ? "Служба поддержки" : user.profile.name} — Диалоги Book Meet`;
    setSelectedFriend({ id: user.id, name: user.isAdmin && !currentUser.isAdmin ? "Служба поддержки" : user.profile.name, type: user.profile.type, city: user.profile.city, initials: user.initials, avatarUrl: user.avatarUrl, color: user.isAdmin ? "navy" : user.color, online: Boolean(user.online), support: Boolean(user.isAdmin && !currentUser.isAdmin), lastMessage: "", time: "", bio: user.profile.bio, books: user.profile.favoriteGenres.join(", ") });
    const key = conversationKey(currentUser.id, userId);
    setMessages((current) => ({ ...current, [key]: (current[key] ?? []).map((message) => message.mine ? message : { ...message, unread: false }) }));
    setNotifications((current) => current.map((notification) => notification.userId === currentUser.id && notification.actorId === userId && notification.type === "new_message" ? { ...notification, unread: false } : notification));
    void apiFetch(`/api/social/messages/${userId}/read`, { method: "PATCH", credentials: "same-origin" }).catch((error) => console.warn(error));
    setProfileUserId(null); setNotificationsOpen(false);
  }

  async function sendMessage(text: string, attachment?: ChatAttachment) {
    if (!selectedFriend || !currentUser) return;
    const response = await apiFetch("/api/social/messages", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId: selectedFriend.id, body: text, attachment }) });
    if (!response.ok) { alert("Не удалось отправить сообщение"); return; }
    const data = await response.json() as { message?: Message };
    const createdAt = data.message?.createdAt ?? new Date().toISOString();
    const key = conversationKey(currentUser.id, selectedFriend.id);
    setMessages((current) => ({ ...current, [key]: [...(current[key] ?? []), { id: data.message?.id ?? Date.now(), mine: true, senderId: currentUser.id, text, attachment, time: "", createdAt, read: false }] }));
    addNotification({ userId: selectedFriend.id, actorId: currentUser.id, type: "new_message", title: "Новое сообщение", text: `${currentUser.profile.name}: ${text || "поделился(ась) материалом"}` });
  }

  async function sendFriendRequest(targetId: number, message: string) {
    if (!currentUser || currentUser.id === targetId) return;
    if (friendRequests.some((request) => request.status === "pending" && ((request.fromId === currentUser.id && request.toId === targetId) || (request.fromId === targetId && request.toId === currentUser.id)))) return;
    const response = await apiFetch("/api/social/friend-requests", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId, message }) });
    if (!response.ok) { alert("Не удалось отправить предложение дружбы"); return; }
    setFriendRequests((current) => [...current, { id: Date.now(), fromId: currentUser.id, toId: targetId, status: "pending", message }]);
    addNotification({ userId: targetId, actorId: currentUser.id, type: "friend_request", title: "Новый друг", text: `${currentUser.profile.name} хочет добавить вас в друзья.${message ? ` Сообщение: ${message}` : ""}` });
  }

  async function cancelFriendRequest(targetId: number) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/friend-requests/${targetId}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "Не удалось отменить запрос");
    setFriendRequests((current) => current.filter((request) => !(request.status === "pending" && request.fromId === currentUser.id && request.toId === targetId)));
    setNotifications((current) => current.filter((notification) => !(notification.type === "friend_request" && notification.actorId === currentUser.id && notification.userId === targetId)));
  }

  async function acceptFriend(targetId: number) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/friends/${targetId}/accept`, { method: "POST", credentials: "same-origin" });
    if (!response.ok) { alert("Не удалось принять предложение дружбы"); return; }
    setFriendRequests((current) => current.map((request) => request.status === "pending" && request.fromId === targetId && request.toId === currentUser.id ? { ...request, status: "accepted" } : request));
    setFriendships((current) => [...current, { userA: currentUser.id, userB: targetId }]);
    setFollows((current) => {
      const pairs = [{ followerId: currentUser.id, targetId }, { followerId: targetId, targetId: currentUser.id }];
      return [...current, ...pairs.filter((pair) => !current.some((follow) => follow.followerId === pair.followerId && follow.targetId === pair.targetId))];
    });
    const key = conversationKey(currentUser.id, targetId);
    setMessages((current) => ({ ...current, [key]: [{ id: Date.now(), mine: false, system: true, text: "Теперь вы друзья и можете начать переписку", time: "сейчас" }] }));
    addNotification({ userId: currentUser.id, actorId: targetId, type: "friendship_started", title: "Теперь вы друзья", text: "Теперь вы друзья и можете начать переписку." });
    addNotification({ userId: targetId, actorId: currentUser.id, type: "friendship_started", title: "Теперь вы друзья", text: "Теперь вы друзья и можете начать переписку." });
    setProfileUserId(null);
  }

  async function rejectFriend(targetId: number, comment: string) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/friends/${targetId}/reject`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ comment }) });
    if (!response.ok) { alert("Не удалось отклонить предложение дружбы"); return; }
    setFriendRequests((current) => current.map((request) => request.status === "pending" && request.fromId === targetId && request.toId === currentUser.id ? { ...request, status: "rejected", comment } : request));
    addNotification({ userId: targetId, actorId: currentUser.id, type: "friend_rejected", title: "Предложение дружбы отклонено", text: `${currentUser.profile.name} отклонил предложение дружбы.${comment.trim() ? ` Комментарий: ${comment.trim()}` : ""} Вы не сможете начать переписку, но можете подписаться на пользователя и следить за обновлениями.` });
    setProfileUserId(null);
  }

  async function removeFriend(targetId: number) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/friends/${targetId}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) { alert("Не удалось изменить список друзей"); return; }
    setFriendships((current) => current.filter((item) => !((item.userA === currentUser.id && item.userB === targetId) || (item.userA === targetId && item.userB === currentUser.id))));
    addNotification({ userId: targetId, actorId: currentUser.id, type: "friendship_ended", title: "Дружба завершена", text: `${currentUser.profile.name} перестал дружить с вами.` });
    setProfileUserId(null); if (selectedFriend?.id === targetId) { setSelectedFriend(null); setChatExpanded(false); }
  }

  async function followUser(targetId: number) {
    if (!currentUser || follows.some((follow) => follow.followerId === currentUser.id && follow.targetId === targetId)) return;
    const response = await apiFetch("/api/social/follows", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId }) });
    if (!response.ok) { alert("Не удалось подписаться на пользователя"); return; }
    setFollows((current) => [...current, { followerId: currentUser.id, targetId }]);
    addNotification({ userId: targetId, actorId: currentUser.id, type: "new_follower", title: "Новый подписчик", text: `${currentUser.profile.name} подписался на ваши обновления.` });
  }

  async function unfollowUser(targetId: number) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/follows/${targetId}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "Не удалось отменить подписку");
    setFollows((current) => current.filter((follow) => !(follow.followerId === currentUser.id && follow.targetId === targetId)));
    setNotifications((current) => current.filter((notification) => !(notification.type === "new_follower" && notification.actorId === currentUser.id && notification.userId === targetId)));
  }

  async function unblockUser(targetId: number) {
    const response = await apiFetch(`/api/social/blocks/${targetId}`, { method: "DELETE", credentials: "same-origin" });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(data.error || "Не удалось разблокировать пользователя");
    await refreshBootstrap();
  }

  function handleUserChange(updatedUser: DemoUser): Promise<void> {
    const previous = users.find((user) => user.id === updatedUser.id);
    setUsers((current) => current.map((user) => user.id === updatedUser.id ? updatedUser : user));
    const saveTask = profileSaveQueue.current.catch(() => undefined).then(async () => {
      const response = await apiFetch("/api/users/me/state", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: updatedUser.profile, avatarUrl: updatedUser.avatarUrl, reviews: updatedUser.reviews, excerpts: updatedUser.excerpts ?? [], publisherNews: updatedUser.publisherNews ?? [] }) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "Не удалось сохранить профиль и материалы");
      }
    });
    profileSaveQueue.current = saveTask.catch(() => undefined);
    if (previous && updatedUser.reviews.length > previous.reviews.length) {
      const recipients = users.filter((user) => user.id !== updatedUser.id && (isFriendPair(user.id, updatedUser.id) || follows.some((follow) => follow.followerId === user.id && follow.targetId === updatedUser.id)));
      recipients.forEach((recipient) => addNotification({ userId: recipient.id, actorId: updatedUser.id, type: "publication", title: "Новая рецензия", text: `${updatedUser.profile.name} опубликовал новую рецензию.` }));
    }
    return saveTask.catch((error) => {
      if (previous) setUsers((current) => current.map((user) => user === updatedUser ? previous : user));
      throw error;
    });
  }

  async function createEvent(value: typeof emptyEvent) {
    const response = await apiFetch("/api/events", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const data = await response.json() as { event?: BookEvent; error?: string };
    if (!response.ok || !data.event) { alert(data.error ?? "Не удалось отправить событие на модерацию"); return; }
    setEvents((current) => [...current, data.event!]);
    setEventFormOpen(false);
    if (currentUser) addNotification({ userId: currentUser.id, actorId: currentUser.id, type: "event_submitted", title: "Событие на модерации", text: `Событие «${data.event.title}» отправлено на модерацию. Вы уже видите его на главной странице.`, materialId: data.event.id, materialKind: "event" });
  }

  async function resubmitEvent(value: typeof emptyEvent) {
    if (!editingEvent) return;
    const response = await apiFetch(`/api/events/${editingEvent.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const data = await response.json() as { event?: BookEvent; error?: string };
    if (!response.ok || !data.event) { alert(data.error ?? "Не удалось повторно отправить событие"); return; }
    setEvents((current) => current.map((item) => item.id === editingEvent.id ? data.event! : item));
    setEditingEvent(null);
  }

  async function moderateEvent(id: number, action: "accept" | "revision" | "reject" | "edit", note = "", event?: typeof emptyEvent, pinned = false) {
    const response = await apiFetch(`/api/admin/events/${id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note, event, pinned }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { alert(data.error ?? "Не удалось выполнить действие модерации"); return; }
    setEvents((current) => current.map((item) => item.id !== id ? item : action === "edit" && event ? { ...item, ...event } : { ...item, status: action === "accept" ? "published" : action === "revision" ? "needs_changes" : "rejected", moderationNote: note, pinned: action === "accept" ? pinned : false }));
  }

  async function createOccasion(value: typeof emptyOccasion) {
    const response = await apiFetch("/api/occasions", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const data = await response.json() as { occasion?: Occasion; error?: string };
    if (!response.ok || !data.occasion) { alert(data.error ?? "Не удалось отправить повод на модерацию"); return; }
    setOccasions((current) => [data.occasion!, ...current]); setOccasionFormOpen(false);
  }

  async function resubmitOccasion(value: typeof emptyOccasion) {
    if (!editingOccasion) return;
    const response = await apiFetch(`/api/occasions/${editingOccasion.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const data = await response.json() as { occasion?: Occasion; error?: string };
    if (!response.ok || !data.occasion) { alert(data.error ?? "Не удалось повторно отправить повод"); return; }
    setOccasions((current) => current.map((item) => item.id === editingOccasion.id ? data.occasion! : item));
    setEditingOccasion(null);
  }

  async function moderateOccasion(id: number, action: "accept" | "revision" | "reject" | "edit", note = "", occasion?: typeof emptyOccasion) {
    const response = await apiFetch(`/api/admin/occasions/${id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note, occasion }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { alert(data.error ?? "Не удалось выполнить действие модерации"); return; }
    setOccasions((current) => current.map((item) => item.id !== id ? item : action === "edit" && occasion ? { ...item, ...occasion, type: occasion.type || item.type } : { ...item, status: action === "accept" ? "published" : action === "revision" ? "needs_changes" : "rejected", moderationNote: note }));
  }

  async function moderatePublisher(id: number, action: "accept" | "revision" | "reject", note = "") {
    const response = await apiFetch(`/api/admin/publishers/${id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { alert(data.error ?? "Не удалось изменить статус издательства"); return; }
    const publisherStatus = action === "accept" ? "approved" : action === "revision" ? "needs_changes" : "rejected";
    setUsers((current) => current.map((user) => user.id === id ? { ...user, profile: { ...user.profile, publisherStatus, publisherModerationNote: note } } : user));
  }

  async function deleteMaterial(kind: AdminMaterialKind, id: number) {
    const response = await apiFetch(`/api/admin/materials/${kind}/${id}`, { method: "DELETE", credentials: "same-origin" });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { window.alert(data.error ?? "Не удалось удалить материал"); return; }
    if (kind === "event") setEvents((current) => current.filter((item) => item.id !== id));
    else if (kind === "occasion") setOccasions((current) => current.filter((item) => item.id !== id));
    else setUsers((current) => current.map((user) => kind === "book" ? { ...user, books: user.books.filter((item) => item.id !== id), authorBooks: (user.authorBooks ?? []).filter((item) => item.id !== id), reviews: user.reviews.filter((item) => item.bookId !== id), excerpts: (user.excerpts ?? []).map((item) => item.bookId === id ? { ...item, bookId: undefined } : item) } : kind === "review" ? { ...user, reviews: user.reviews.filter((item) => item.id !== id) } : { ...user, excerpts: (user.excerpts ?? []).filter((item) => item.id !== id) }));
  }

  function openNotification(notification: SocialNotification) {
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, unread: false } : item));
    void apiFetch(`/api/notifications/${notification.id}/read`, { method: "PATCH", credentials: "same-origin" }).catch((error) => console.warn(error));
    setNotificationsOpen(false);
    if (["like", "comment"].includes(notification.type) && notification.materialId && notification.materialKind) {
      const owner = users.find((user) => user.id === notification.userId);
      if (notification.materialKind === "review") { const review = owner?.reviews.find((item) => item.id === notification.materialId); if (review) setSelectedMaterial({ id: review.id, kind: "review", title: review.bookTitle, author: owner!.profile.name, text: review.fullText, ownerId: owner!.id, createdAt: review.createdAt, preview: review.preview, bookAuthor: review.bookAuthor, rating: review.rating }); }
      else { const excerpt = owner?.excerpts?.find((item) => item.id === notification.materialId); if (excerpt) setSelectedMaterial({ id: excerpt.id, kind: "excerpt", title: excerpt.bookTitle || "Публикация", author: owner!.profile.name, text: excerpt.text, preview: excerpt.previewText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.bookId, ownerId: owner!.id, createdAt: excerpt.createdAt }); }
    } else if (notification.materialKind === "event" && notification.materialId) setSelectedEvent(events.find((item) => item.id === notification.materialId) ?? null);
    else if (notification.materialKind === "occasion" && notification.materialId) setSelectedOccasion(occasions.find((item) => item.id === notification.materialId) ?? null);
    else if (["friend_request", "new_follower", "publication", "friendship_ended", "author_book_activity", "gift_reserved"].includes(notification.type)) openUserProfile(notification.actorId);
    else if (["friendship_started", "new_message"].includes(notification.type)) openChat(notification.actorId);
    else setDetailNotification(notification);
  }

  async function login(email: string, password: string, totp = ""): Promise<AuthResult> {
    const loadingStartedAt = Date.now();
    setAuthTransition(true);
    try {
      const response = await apiFetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, totp }) });
      const data = await response.json() as BootstrapData & AuthResult;
      if (data.requiresTotp) { await finishMinimumLoading(loadingStartedAt); setAuthTransition(false); return { requiresTotp: true }; }
      if (data.deletedProfile) { setDeletedRecovery({ daysRemaining: Number(data.daysRemaining ?? 0) }); await finishMinimumLoading(loadingStartedAt); setAuthTransition(false); return { deletedProfile: true, daysRemaining: data.daysRemaining }; }
      if (response.status === 423) {
        const locked = data as unknown as { permanent?: boolean; until?: string; reason?: string };
        setSuspension({ permanent: Boolean(locked.permanent), until: locked.until, reason: locked.reason ?? "" });
        await finishMinimumLoading(loadingStartedAt); setAuthTransition(false); return {};
      }
      if (!response.ok) { await finishMinimumLoading(loadingStartedAt); setAuthTransition(false); return { error: data.error ?? "Не удалось войти" }; }
      applyBootstrap(data);
      setNewlyRegistered(false);
      navigateMainView("home", { replace: true });
      await finishMinimumLoading(loadingStartedAt); setAuthTransition(false);
      return {};
    } catch {
      await finishMinimumLoading(loadingStartedAt); setAuthTransition(false);
      return { error: "Не удалось связаться с сервером Book Meet" };
    }
  }

  async function register(value: { email: string; password: string }): Promise<AuthResult> {
    const loadingStartedAt = Date.now();
    setAuthTransition(true);
    try {
      const response = await apiFetch("/api/auth/register", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      const data = await response.json() as BootstrapData & AuthResult;
      if (!response.ok) { await finishMinimumLoading(loadingStartedAt); setAuthTransition(false); return { error: data.error ?? "Не удалось создать профиль" }; }
      applyBootstrap(data);
      setNewlyRegistered(true);
      window.history.replaceState({}, "", "/profile");
      setView("profile");
      await finishMinimumLoading(loadingStartedAt); setAuthTransition(false);
      return {};
    } catch {
      await finishMinimumLoading(loadingStartedAt); setAuthTransition(false);
      return { error: "Не удалось связаться с сервером Book Meet" };
    }
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    setUsers([]); setActiveUserId(null); setMessages({}); setFriendRequests([]); setFriendships([]); setFollows([]); setNotifications([]); setLikes({}); setEvents([]); setOccasions([]); setBlocks([]); setBlockedByUserIds([]); setReports([]); setSuspension(null); setCommenters({}); setSelectedFriend(null); setChatExpanded(false);
    navigateMainView("home", { replace: true }); setNotificationsOpen(false); setProfileAction(null); setNewlyRegistered(false); setAuthTransition(false);
  }

  async function resolveDeletedProfile(action: "restore" | "new") {
    setAuthTransition(true);
    try {
      const response = await apiFetch(`/api/auth/deleted-profile/${action}`, { method: "POST", credentials: "same-origin" });
      const data = await response.json() as BootstrapData & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось обработать удалённый профиль");
      applyBootstrap(data);
      setDeletedRecovery(null);
      setNewlyRegistered(action === "new");
      setView(action === "new" ? "profile" : "home");
      window.history.replaceState({}, "", action === "new" ? "/profile" : "/");
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : "Не удалось обработать удалённый профиль");
    } finally {
      setAuthTransition(false);
    }
  }

  if (authTransition) return <AuthBookTransition />;
  if (authLoading) return <AuthBookTransition />;
  if (deletedRecovery) return <main className="deleted-profile-recovery"><section role="dialog" aria-modal="true"><h1>Профиль удалён</h1><p>Данные профиля будут храниться ещё {deletedRecovery.daysRemaining} дн. Вы можете восстановить прежний профиль или создать новый.</p><p>При создании нового профиля прежний будет удалён окончательно. Это действие нельзя отменить.</p>{startupError && <span className="login-error">{startupError}</span>}<div className="form-actions"><button className="primary-button" type="button" onClick={() => void resolveDeletedProfile("restore")}>Восстановить профиль</button><button className="danger-button" type="button" onClick={() => void resolveDeletedProfile("new")}>Создать новый</button></div></section></main>;
  if (suspension) return <main className="suspension-screen"><section><h1>Доступ к сайту ограничен</h1><p>{suspension.permanent ? "Ваш профиль заблокирован бессрочно." : `Ваш профиль заблокирован до ${new Date(suspension.until ?? "").toLocaleString("ru-RU")}.`}</p><p><strong>Причина:</strong> {suspension.reason || "Нарушение правил сайта."}</p></section></main>;
  if (!currentUser) return <LoginScreen onLogin={login} onRegister={register} initialError={startupError} />;
  const relationshipToProfile = profileUser ? isFriendPair(currentUser.id, profileUser.id) ? "friends" : friendRequests.some((request) => request.status === "pending" && request.fromId === profileUser.id && request.toId === currentUser.id) ? "incoming" : friendRequests.some((request) => request.status === "pending" && request.fromId === currentUser.id && request.toId === profileUser.id) ? "outgoing" : "none" : "none";
  const relationshipFor = (userId: number) => isFriendPair(currentUser.id, userId) ? "friends" as const : friendRequests.some((request) => request.status === "pending" && request.fromId === userId && request.toId === currentUser.id) ? "incoming" as const : friendRequests.some((request) => request.status === "pending" && request.fromId === currentUser.id && request.toId === userId) ? "outgoing" as const : "none" as const;
  const followsUser = (userId: number) => isFriendPair(currentUser.id, userId) || follows.some((follow) => follow.followerId === currentUser.id && follow.targetId === userId);
  const activeChatMessages = selectedFriend ? (messages[conversationKey(currentUser.id, selectedFriend.id)] ?? []).map((message) => ({ ...message, mine: message.senderId === currentUser.id })) : [];
  const closeChat = () => {
    const state = (window.history.state ?? {}) as ChatRouteState;
    if (/^\/chat\/\d+$/.test(normalizedPathname(window.location.pathname)) && state.bookMeetChat && state.backgroundPath) {
      window.history.back();
      return;
    }
    window.history.replaceState({ bookMeetView: "chat" }, "", "/chat");
    setView("chat");
    setSelectedFriend(null);
    setChatExpanded(false);
    document.title = mainViewTitles.chat;
  };
  const toggleChatExpanded = () => {
    const nextExpanded = !chatExpanded;
    const state = (window.history.state ?? {}) as ChatRouteState;
    if (/^\/chat\/\d+$/.test(normalizedPathname(window.location.pathname))) {
      window.history.replaceState({ ...state, bookMeetChat: true, chatMode: nextExpanded ? "expanded" : "compact" }, "", window.location.pathname);
    }
    setChatExpanded(nextExpanded);
  };
  const openChatAttachment = (attachment: ChatAttachment) => {
    if (attachment.kind === "book") setSelectedBook(catalogFromUsers(users).find((book) => book.id === attachment.id) ?? null);
    else if (attachment.kind === "user") openUserProfile(attachment.id);
    else if (attachment.kind === "event") setSelectedEvent(events.find((item) => item.id === attachment.id) ?? null);
    else if (attachment.kind === "review") setSelectedMaterial(reviewReadingItemById(users, attachment.id));
    else if (attachment.kind === "excerpt") setSelectedMaterial(excerptReadingItemById(users, attachment.id));
    else setSelectedOccasion(occasions.find((item) => item.id === attachment.id) ?? null);
  };
  const chat = selectedFriend ? <ChatView friend={selectedFriend} messages={activeChatMessages} profileEnabled={!selectedFriend.support} onOpenProfile={() => openUserProfile(selectedFriend.id)} onSend={sendMessage} shareItems={shareItems} onOpenAttachment={openChatAttachment} onReport={!currentUser.isAdmin && !selectedFriend.support ? () => openReportDialog({ kind: "chat", id: selectedFriend.id }) : undefined} expanded={chatExpanded} onToggleExpanded={toggleChatExpanded} onClose={closeChat} /> : null;
  const upcomingEvents = events.filter((item) => eventTimestamp(item) > eventClock);
  const visibleHomeEvents = upcomingEvents.filter((item) => item.creatorId === currentUser.id && item.status !== "rejected" || item.status === "published").sort((a, b) => eventTimestamp(a) - eventTimestamp(b));
  const visibleHomeOccasions = occasions.filter((item) => item.creatorId === currentUser.id && item.status !== "rejected" || item.status === "published" && (item.targetGender === "Все" || item.targetGender === currentUser.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === currentUser.profile.type));
  const materialDirectoryProps = { reviews: allReviews, excerpts: allExcerpts, currentUser, users: visibleUsers, likes, commenters, onToggleLike: toggleLike, onComment: addComment, onOpenUser: openUserProfile, relationshipFor, isFollowing: followsUser, onAddFriend: sendFriendRequest, onFollow: followUser };
  const directoryShell = (content: ReactNode) => <div className="directory-page-shell"><button className="back-button directory-home-button" type="button" onClick={goHome}>← На главную</button>{content}</div>;
  const workspaceContent = view === "reviews"
    ? directoryShell(<MaterialsDirectoryPage kind="review" onCreate={() => startCreating("review")} {...materialDirectoryProps} />)
    : view === "publications"
      ? directoryShell(<MaterialsDirectoryPage kind="excerpt" onCreate={() => startCreating("excerpt")} {...materialDirectoryProps} />)
      : view === "events"
        ? <EventsDirectoryPage events={upcomingEvents} currentUser={currentUser} users={users} onHome={goHome} onCreate={startEventCreation} onEdit={setEditingEvent} onOpenUser={openUserProfile} />
        : view === "occasions"
          ? <OccasionsDirectoryPage occasions={occasions} currentUser={currentUser} onHome={goHome} onCreate={startOccasionCreation} onEdit={setEditingOccasion} onOpenUser={openUserProfile} />
          : view === "users"
            ? directoryShell(<UsersDirectoryPage currentUser={currentUser} users={visibleUsers} onOpenUser={openUserProfile} />)
            : view === "publishing"
              ? directoryShell(<PublishingDirectoryPage users={visibleUsers} events={upcomingEvents} onOpenUser={openUserProfile} />)
            : view === "chat" ? <ChatScreen />
              : <HomeContent reviews={homeReviews} excerpts={homeExcerpts} events={visibleHomeEvents} occasions={visibleHomeOccasions} currentUserType={currentUser.profile.type === "Писатель" ? "writer" : currentUser.profile.type === "Блогер" ? "blogger" : "reader"} onOpenUser={openUserProfile} onCreateEvent={startEventCreation} onEditEvent={setEditingEvent} onCreateOccasion={startOccasionCreation} onEditOccasion={setEditingOccasion} onCreateReview={() => startCreating("review")} onCreateExcerpt={() => startCreating("excerpt")} onNavigate={navigateMainView} currentUserName={currentUser.profile.name} currentUser={currentUser} users={visibleUsers} likes={likes} onToggleLike={toggleLike} onComment={addComment} relationshipFor={relationshipFor} isFollowing={followsUser} onAddFriend={sendFriendRequest} onFollow={followUser} />;

  return (
    <div className="app-shell">
      <BookMeetHeader
        accountName={currentUser.isAdmin ? "Служба поддержки" : currentUser.profile.name}
        accountCaption={currentUser.isAdmin ? "Админка" : "Мой профиль"}
        initials={currentUser.initials}
        avatarUrl={currentUser.avatarUrl}
        unreadCount={unreadCount}
        notificationsOpen={notificationsOpen}
        onHome={goHome}
        onPublishing={() => navigateMainView("publishing")}
        onNotifications={() => setNotificationsOpen((open) => !open)}
        onProfile={() => { setProfileAction(null); setProfileEditId(null); openOwnProfile(); }}
        notificationsMenu={notificationsOpen ? <NotificationsMenu notifications={currentNotifications} users={users} onOpen={openNotification} onClose={() => setNotificationsOpen(false)} onMarkAllRead={() => { setNotifications((current) => current.map((notification) => notification.userId === currentUser.id ? { ...notification, unread: false } : notification)); void apiFetch("/api/notifications/read-all", { method: "PATCH", credentials: "same-origin" }).catch((error) => console.warn(error)); }} /> : null}
      />

      {view === "profile" && !chatExpanded ? (
        currentUser.isAdmin ? <AdminProfile onBack={closeOwnProfile} onLogout={logout} events={events} occasions={occasions} users={users} reports={reports} onModerateEvent={moderateEvent} onModerateOccasion={moderateOccasion} onModeratePublisher={moderatePublisher} onOpenChat={openChat} onOpenUser={openUserProfile} onRefresh={() => void refreshBootstrap()} onDeleteMaterial={deleteMaterial} /> : <MyProfile key={`${currentUser.id}-${profileAction ?? "profile"}-${profileEditId ?? "new"}-${newlyRegistered ? "setup" : "ready"}`} onBack={closeOwnProfile} user={currentUser} users={users} friends={currentFriendUsers} friendRequests={friendRequests} follows={follows} events={events} occasions={occasions} likes={likes} initialAction={profileAction} initialEditId={profileEditId} initialEditing={newlyRegistered} onProfileCompleted={() => { if (newlyRegistered) void apiFetch("/api/users/me/profile-complete", { method: "PATCH", credentials: "same-origin" }); setNewlyRegistered(false); }} onToggleLike={toggleLike} onComment={addComment} onEditEvent={setEditingEvent} onDeleteEvent={(id) => setEvents((current) => current.filter((item) => item.id !== id))} onModerateEvent={moderateEvent} onModerateOccasion={moderateOccasion} onOpenUser={openUserProfile} onOpenChat={openChat} onUserChange={handleUserChange} onLogout={logout} />
      ) : (
        <WorkspaceScreen
          friends={currentFriends}
          selectedId={selectedFriend?.id ?? null}
          adminMode={Boolean(currentUser.isAdmin)}
          onFindFriends={() => navigateMainView("users")}
          onCreateOccasion={startOccasionCreation}
          onSelectFriend={(friend) => openChat(friend.id)}
          expandedChat={chatExpanded && chat ? chat : undefined}
        >
          {workspaceContent}
        </WorkspaceScreen>
      )}

      {selectedFriend && !chatExpanded && (!currentRoute.overlay || currentRoute.overlay.kind === "chat") && <div className="chat-popup-layer"><div className="chat-popup">{chat}</div></div>}

      {selectedBook && <UnifiedBookModal book={selectedBook} users={visibleUsers} onClose={() => setSelectedBook(null)} onReport={currentUser.isAdmin || selectedBook.creatorUserId === currentUser.id || users.some((user) => user.id === currentUser.id && (user.authorBooks ?? []).some((book) => book.id === selectedBook.id)) ? undefined : () => openReportDialog({ kind: "book", id: selectedBook.id })} onOpenUser={openUserProfile} onOpenReview={(review, user) => { setSelectedBook(null); setSelectedMaterial({ id: review.id, kind: "review", title: review.bookTitle, author: user.profile.name, text: review.fullText, ownerId: user.id, createdAt: review.createdAt, preview: review.preview, bookAuthor: review.bookAuthor, rating: review.rating }); }} />}
      {selectedMaterial && <ReadingModal item={selectedMaterial} currentUser={currentUser} users={visibleUsers} likedUserIds={likes[`${selectedMaterial.kind}-${selectedMaterial.id}`] ?? []} onToggleLike={() => toggleLike(selectedMaterial)} onComment={(text) => addComment(selectedMaterial, text)} onOpenUser={openUserProfile} onClose={() => setSelectedMaterial(null)} onReport={selectedMaterial.ownerId !== currentUser.id && !currentUser.isAdmin ? () => openReportDialog({ kind: selectedMaterial.kind, id: selectedMaterial.id }) : undefined} onEdit={currentUser.isAdmin || selectedMaterial.ownerId === currentUser.id ? () => void editReadingMaterial(selectedMaterial, currentUser) : undefined} onDelete={currentUser.isAdmin || selectedMaterial.ownerId === currentUser.id ? () => void deleteReadingMaterial(selectedMaterial, currentUser) : undefined} />}
      {adminEditingMaterial && <AdminCatalogEditor item={adminEditingMaterial} users={users} onClose={() => setAdminEditingMaterial(null)} onSave={async (payload) => { const response = await fetch(`/api/admin/materials/${adminEditingMaterial.kind}/${adminEditingMaterial.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const data = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) { window.alert(data.error ?? "Не удалось сохранить изменения"); return; } setAdminEditingMaterial(null); await refreshBootstrap(); }} />}
      {detailNotification && <NotificationDetail notification={detailNotification} actor={users.find((user) => user.id === detailNotification.actorId)} isFollowing={follows.some((follow) => follow.followerId === currentUser.id && follow.targetId === detailNotification.actorId)} onClose={() => setDetailNotification(null)} onFollow={() => followUser(detailNotification.actorId)} />}
      {eventFormOpen && <div className="modal-backdrop" onMouseDown={() => setEventFormOpen(false)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm catalog={catalogFromUsers(users)} onCreateBook={() => { setEventFormOpen(false); startCreating("book"); }} onCancel={() => setEventFormOpen(false)} onSave={createEvent} /></section></div>}
      {editingEvent && <div className="modal-backdrop" onMouseDown={() => setEditingEvent(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm initial={editingEvent} catalog={catalogFromUsers(users)} onCreateBook={() => { setEditingEvent(null); startCreating("book"); }} submitLabel="Отправить повторно" onCancel={() => setEditingEvent(null)} onSave={resubmitEvent} /></section></div>}
      {selectedEvent && <EventModal item={selectedEvent} users={visibleUsers} currentUserId={currentUser.id} onOpenUser={openUserProfile} onReport={selectedEvent.creatorId !== currentUser.id && !currentUser.isAdmin ? () => openReportDialog({ kind: "event", id: selectedEvent.id }) : undefined} onOpenBook={selectedEvent.linkedBookId ? () => {
        setSelectedBook(catalogFromUsers(users).find((book) => book.id === selectedEvent.linkedBookId) ?? null);
        setSelectedEvent(null);
      } : undefined} onClose={() => setSelectedEvent(null)} />}
      {occasionFormOpen && <div className="modal-backdrop" onMouseDown={() => setOccasionFormOpen(false)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm onCancel={() => setOccasionFormOpen(false)} onSave={createOccasion} /></section></div>}
      {editingOccasion && <div className="modal-backdrop" onMouseDown={() => setEditingOccasion(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm initial={editingOccasion} submitLabel="Отправить повторно" onCancel={() => setEditingOccasion(null)} onSave={resubmitOccasion} /></section></div>}
      {selectedOccasion && <OccasionModal item={selectedOccasion} onReport={selectedOccasion.creatorId !== currentUser.id && !currentUser.isAdmin ? () => openReportDialog({ kind: "occasion", id: selectedOccasion.id }) : undefined} onOpenUser={openUserProfile} onClose={() => setSelectedOccasion(null)} />}
      {roleRestrictionNotice && <div className="modal-backdrop" onMouseDown={() => setRoleRestrictionNotice(null)}><section className="simple-warning-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>{roleRestrictionNotice === "review" ? "Рецензии могут писать только читатели и блогеры" : roleRestrictionNotice === "excerpt" ? "Публикации могут создавать только писатели и блогеры" : roleRestrictionNotice === "occasion" ? "Издательства не могут создавать поводы познакомиться" : "Профиль издательства ожидает официального подтверждения"}</h2><button className="primary-button" type="button" autoFocus onClick={() => setRoleRestrictionNotice(null)}>Закрыть</button></section></div>}
      {profileUser && profileUser.id !== currentUser.id && <UserProfileModal user={profileUser} viewer={currentUser} users={visibleUsers} events={events} likes={likes} friendCount={friendships.filter((item) => item.userA === profileUser.id || item.userB === profileUser.id).length} relationship={relationshipToProfile} incomingMessage={friendRequests.find((request) => request.status === "pending" && request.fromId === profileUser.id && request.toId === currentUser.id)?.message} isFollowing={isFriendPair(currentUser.id, profileUser.id) || follows.some((follow) => follow.followerId === currentUser.id && follow.targetId === profileUser.id)} canMessage={Boolean(currentUser.isAdmin || profileUser.isAdmin)} blockedByMe={Boolean(profileUser.blockedByMe)} onClose={() => setProfileUserId(null)} onAddFriend={(message) => sendFriendRequest(profileUser.id, message)} onCancelFriendRequest={() => cancelFriendRequest(profileUser.id)} onAccept={() => acceptFriend(profileUser.id)} onReject={(comment) => rejectFriend(profileUser.id, comment)} onRemoveFriend={() => removeFriend(profileUser.id)} onOpenChat={() => openChat(profileUser.id)} onFollow={() => followUser(profileUser.id)} onUnfollow={() => unfollowUser(profileUser.id)} onUnblock={() => unblockUser(profileUser.id)} onReport={currentUser.isAdmin ? undefined : () => openReportDialog({ kind: "user", id: profileUser.id })} onToggleLike={toggleLike} onComment={addComment} onOpenUser={openUserProfile} />}
      {blockedProfileNotice && <div className="nested-modal-backdrop" onMouseDown={() => setBlockedProfileNotice(false)}><section className="confirm-social-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>Кажется, с вами не хотят общаться</h2><button className="primary-button" type="button" autoFocus onClick={() => setBlockedProfileNotice(false)}>Ок</button></section></div>}
      {adultRestrictionNotice && <div className="nested-modal-backdrop"><section className="adult-restriction-modal" role="alertdialog" aria-modal="true" aria-labelledby="adult-restriction-title"><span className="adult-restriction-mark" aria-hidden="true">18+</span><h2 id="adult-restriction-title">Материал предназначен для лиц старше 18 лет</h2>{adultRestrictionNotice === "missing" && <p>Пожалуйста, укажите дату рождения в профиле, чтобы система могла определить ваш возраст.</p>}<div className="form-actions">{adultRestrictionNotice === "missing" ? <><button className="primary-button" type="button" onClick={() => leaveRestrictedMaterial(true)}>Перейти в профиль</button><button className="outline-button" type="button" onClick={() => leaveRestrictedMaterial(false)}>Выйти</button></> : <button className="primary-button" type="button" autoFocus onClick={() => leaveRestrictedMaterial(false)}>Ок</button>}</div></section></div>}
      <SafetyCenter onChanged={() => void refreshBootstrap()} />
    </div>
  );
}
