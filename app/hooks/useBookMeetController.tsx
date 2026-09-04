"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar, ChatView } from "../components/chat/ChatComponents";
import type { ChatAttachment, ChatShareItem, Friend, Message } from "../components/chat/types";
import { sortChatFriends } from "../components/chat/chat-utils.js";
import { BookMeetHeader, MobileBottomNavigation, MobileNavigationDrawer, WorkspaceScreen, type MobileCreateOption } from "../components/layout/AppLayout";
import { NotificationDetail, NotificationsMenu, NotificationsPage } from "../components/notifications/Notifications";
import {
  appRouteFromPathname,
  restoreGuardedRouteAfterNavigation,
  initialMainView,
  mainViewTitle,
  mainViewPaths,
  mobileWorkflowPath,
  notifyAppNavigation,
  normalizedPathname,
  useCurrentAppRoute,
  type ChatRouteState,
  type MainView,
  type MobileSearchRouteState,
  type MobileWorkflowRoute,
  type MobileWorkflowRouteState,
  type OverlayHistoryState,
  type RoutableMainView,
} from "../navigation/routes";
import { MobileGlobalSearchPage, type SearchEntry } from "../screens/MobileGlobalSearchPage";
import { MobileMessagesPage, type MobileMessageRequest } from "../screens/MobileMessagesPage";
import { ChatScreen } from "../screens/ChatScreen";
import { AuthBookTransition, LoginScreen } from "../screens/AuthScreens";
import { safeReturnTo } from "../lib/navigation-security";
import { CommunitiesDirectoryPage, PublishingDirectoryPage, UsersDirectoryPage } from "../screens/UsersDirectoryScreen";
import { AllBooksDirectoryPage, EventsDirectoryPage, HomeContent, MaterialsDirectoryPage, OccasionsDirectoryPage, PersonalMaterialFeed, SimpleDirectoryPage } from "../screens/ContentScreens";
import { ContentHubControls } from "../components/content/ContentHubControls";
import { AdminProfile, MyProfile } from "../screens/ProfileScreens";
import {
  AdminCatalogEditor,
  BookEditor,
  EventForm,
  EventModal,
  OccasionForm,
  OccasionModal,
  PublicationEditor,
  PublisherNewsModal,
  ReadingModal,
  ReviewEditor,
  UnifiedBookModal,
  UserProfileModal,
  deleteReadingMaterial,
  editReadingMaterial,
  emptyEvent,
  emptyOccasion,
} from "../components/content/ContentComponents";
import { EmptyContentState } from "../components/common/EmptyContentState";
import { MaterialSharePicker } from "../components/content/MaterialSharePicker";
import { ModalIconActions } from "../components/modals/ModalIconActions";
import { SafetyCenter, openReportDialog } from "../components/safety/SafetyCenter";
import { ComplianceAccessGate } from "../components/compliance/AccessGate";
import {
  catalogFromSources,
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
import { announceLibraryMutation, announceLibraryMutationStart, applyLibraryMutation, buildReadingPatch, isLibraryMutationResponse } from "../services/library-mutations";
import { BootstrapRequestError, loadApplicationData } from "../services/bootstrap";
import { conversationKey, finishMinimumLoading } from "./controller-utils";
import type {
  AdminCatalogItem,
  AdminCatalogKind,
  AdminSection,
  AuthResult,
  AuthorBook,
  BookEvent,
  BookFormat,
  BookLink,
  BootstrapData,
  CityOption,
  CommunityMembership,
  DemoUser,
  EventStatus,
  Excerpt,
  FlipProductPreview,
  Follow,
  FriendRequest,
  Friendship,
  SocialRelationship,
  LibraryBook,
  LibraryView,
  MaterialComment,
  MaterialActionRef,
  Occasion,
  OccasionType,
  ProfileTab,
  PublisherNews,
  ReadingItem,
  Review,
  SocialNotification,
  SafetyReport,
  UserBlock,
  UserSuspension,
  TotpSetup,
  TotpStatus,
  UserProfileData,
  WishBook,
} from "../types/domain";
import { localizedApiError, useI18n } from "../i18n";

export function useBookMeetController() {
  const { t, formatDate, formatTime, formatNumber } = useI18n();
  const localizedViewTitle = (target: MainView) => target === "profile" ? `${t("profile.my")} — Book Meet` : target === "search" ? `${t("common.search")} — Book Meet` : mainViewTitle(target, t);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const setData = (updater: (current: { users: DemoUser[] } | null) => { users: DemoUser[] } | null) => setUsers((current) => updater({ users: current })?.users ?? current);
  const [catalogBooks, setCatalogBooks] = useState<Array<LibraryBook | AuthorBook>>([]);
  const [activeOrganizationIds, setActiveOrganizationIds] = useState<number[]>([]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authTransition, setAuthTransition] = useState(false);
  const [newlyRegistered, setNewlyRegistered] = useState(false);
  const [completionProfileEditing, setCompletionProfileEditing] = useState(false);
  const [accessGate, setAccessGate] = useState<BootstrapData["accessGate"]>();
  const [completionNotice, setCompletionNotice] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [view, setView] = useState<MainView>(initialMainView);
  const currentRoute = useCurrentAppRoute();
  const mobileSearchQueryRef = useRef(typeof window !== "undefined" && normalizedPathname(window.location.pathname) === "/search" ? new URLSearchParams(window.location.search).get("q") ?? "" : "");
  if (currentRoute.view === "search") mobileSearchQueryRef.current = new URLSearchParams(window.location.search).get("q") ?? "";
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [mobileFriendsOpen, setMobileFriendsOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [profileUserId, setProfileUserId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [communityMemberships, setCommunityMemberships] = useState<CommunityMembership[]>([]);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [eventClock, setEventClock] = useState(() => Date.now());
  const [detailNotification, setDetailNotification] = useState<SocialNotification | null>(null);
  const [likes, setLikes] = useState<Record<string, number[]>>({});
  const [saves, setSaves] = useState<Record<string, number[]>>({});
  const [likedMaterialRefs, setLikedMaterialRefs] = useState<MaterialActionRef[]>([]);
  const [savedMaterialRefs, setSavedMaterialRefs] = useState<MaterialActionRef[]>([]);
  const [commenters, setCommenters] = useState<Record<string, number[]>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [saveCounts, setSaveCounts] = useState<Record<string, number>>({});
  const [selectedBook, setSelectedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [materialShareAttachment, setMaterialShareAttachment] = useState<ChatAttachment | null>(null);
  const [catalogBookToAdd, setCatalogBookToAdd] = useState<LibraryBook | null>(null);
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
  const [selectedPublisherNews, setSelectedPublisherNews] = useState<PublisherNews | null>(null);
  const [profileAction, setProfileAction] = useState<"review" | "excerpt" | "book" | "book-status" | null>(null);
  const [quickMaterialAction, setQuickMaterialAction] = useState<"review" | "excerpt" | null>(null);
  const [quickMaterialEditId, setQuickMaterialEditId] = useState<number | null>(null);
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
  // A bootstrap/SSE response that began before a library write must not put a
  // stale personal relation (or its completion history) back into the UI.
  const libraryMutationEpoch = useRef(0);
  const currentUser = users.find((user) => user.id === activeUserId) ?? null;
  const profileIncomplete = Boolean(accessGate && !accessGate.profileComplete);
  useEffect(() => {
    const start = (event: Event) => {
      const viewerId = (event as CustomEvent<{ viewerId?: unknown }>).detail?.viewerId;
      if (viewerId === activeUserId) libraryMutationEpoch.current += 1;
    };
    const apply = (event: Event) => {
      const detail = (event as CustomEvent<{ viewerId?: unknown; result?: unknown }>).detail;
      const result = detail?.result;
      if (!Number.isInteger(detail?.viewerId) || detail.viewerId !== activeUserId || !isLibraryMutationResponse(result) || !activeUserId) return;
      libraryMutationEpoch.current += 1;
      setUsers((current) => current.map((user) => user.id === activeUserId ? applyLibraryMutation(user, result) : user));
    };
    window.addEventListener("bookmeet:library-mutation-start", start);
    window.addEventListener("bookmeet:library-mutation", apply);
    return () => { window.removeEventListener("bookmeet:library-mutation-start", start); window.removeEventListener("bookmeet:library-mutation", apply); };
  }, [activeUserId]);
  useEffect(() => {
    const show = () => setCompletionNotice(true);
    window.addEventListener("bookmeet:profile-completion-required", show);
    return () => window.removeEventListener("bookmeet:profile-completion-required", show);
  }, []);
  useEffect(() => {
    if (!profileIncomplete) return;
    const captureMaterialOpen = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const card = event.target.closest(".material-clickable-card");
      if (!card || card.matches(".directory-user-card, .publishing-card") || event.target.closest(".inline-user-link")) return;
      event.preventDefault(); event.stopPropagation(); setCompletionNotice(true);
    };
    document.addEventListener("click", captureMaterialOpen, true);
    return () => document.removeEventListener("click", captureMaterialOpen, true);
  }, [profileIncomplete]);
  useEffect(() => {
    const open = (event: Event) => {
      const attachment = (event as CustomEvent<{ attachment?: ChatAttachment }>).detail?.attachment;
      if (attachment) setMaterialShareAttachment(attachment);
    };
    window.addEventListener("bookmeet:share-material", open);
    return () => window.removeEventListener("bookmeet:share-material", open);
  }, []);
  useEffect(() => {
    const ownedCatalogId = (value: unknown) => {
      const id = Number((value as { bookId?: number } | undefined)?.bookId);
      return Number.isInteger(id) && currentUser?.books.some((book) => (book.catalogBookId ?? book.id) === id) ? id : null;
    };
    const edit = (event: Event) => {
      const id = ownedCatalogId((event as CustomEvent<{ bookId?: number }>).detail);
      if (id === null) return;
      setProfileAction("book"); setProfileEditId(id); setSelectedBook(null); setView("profile");
      window.history.pushState({}, "", "/profile/library");
    };
    const remove = async (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: number; title?: string }>).detail;
      const id = ownedCatalogId(detail);
      if (id === null || !window.confirm(t("library.deleteConfirm", { title: detail?.title ?? "" }))) return;
      const response = await apiFetch(`/api/books/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) { window.alert(t("book.deleteError")); return; }
      setUsers((current) => current.map((user) => user.id === currentUser?.id ? { ...user, books: user.books.filter((book) => (book.catalogBookId ?? book.id) !== id) } : user));
      setSelectedBook(null);
    };
    window.addEventListener("bookmeet:edit-owned-book", edit);
    window.addEventListener("bookmeet:delete-owned-book", remove);
    return () => { window.removeEventListener("bookmeet:edit-owned-book", edit); window.removeEventListener("bookmeet:delete-owned-book", remove); };
  }, [currentUser, t]);
  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const scrollY = window.scrollY;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavigationOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [mobileNavigationOpen]);
  const catalog = useMemo(() => catalogFromSources(catalogBooks, users), [catalogBooks, users]);
  const visibleUsers = users.filter((user) => currentUser?.isAdmin || user.id === activeUserId || !user.blockedByMe);
  const routeDataRef = useRef({ users, catalog, activeUserId, friendships, communityMemberships, notifications, events, occasions, adultAccess, blockedByUserIds, accessGate });
  routeDataRef.current = { users, catalog, activeUserId, friendships, communityMemberships, notifications, events, occasions, adultAccess, blockedByUserIds, accessGate };

  useEffect(() => {
    if (currentUser) document.documentElement.dataset.bookMeetUserId = String(currentUser.id);
    else delete document.documentElement.dataset.bookMeetUserId;
    return () => { delete document.documentElement.dataset.bookMeetUserId; };
  }, [currentUser?.id]);

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
        const startedAtMutationEpoch = libraryMutationEpoch.current;
        const data = await loadApplicationData(["catalog", "social", "moderation"]);
        if (!active) return;
        if (startedAtMutationEpoch === libraryMutationEpoch.current) setUsers(data.users);
        else setUsers((current) => data.users.map((incoming) => incoming.id === activeUserId ? current.find((user) => user.id === incoming.id) ?? incoming : incoming));
        setCatalogBooks(data.books ?? []);
        setActiveOrganizationIds(data.activeOrganizationIds ?? []);
        setMessages(data.messages ?? {});
        setFriendRequests(data.friendRequests ?? []);
        setFriendships(data.friendships ?? []);
        setCommunityMemberships(data.communityMemberships ?? []);
        setFollows(data.follows ?? []);
        setNotifications(data.notifications ?? []);
        setLikes(data.likes ?? {});
        setSaves(data.saves ?? {});
        setLikedMaterialRefs(data.likedMaterialRefs ?? []);
        setSavedMaterialRefs(data.savedMaterialRefs ?? []);
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
      if (restoreGuardedRouteAfterNavigation()) return;
      const route = appRouteFromPathname(window.location.pathname);
      const routeData = routeDataRef.current;
      if (route.view === "search" && window.matchMedia("(min-width: 801px)").matches) {
        setView("home");
        window.history.replaceState({ bookMeetView: "home" }, "", "/");
        document.title = localizedViewTitle("home");
        return;
      }
      setSelectedFriend(null);
      setChatExpanded(false);
      setMobileFriendsOpen(false);
      setProfileUserId(null);
      setSelectedBook(null);
      setSelectedMaterial(null);
      setSelectedEvent(null);
      setSelectedOccasion(null);
      setSelectedPublisherNews(null);
      setDetailNotification(null);
      setNotificationsOpen(false);
      setQuickMaterialAction(null);
      setQuickMaterialEditId(null);
      setEventFormOpen(false);
      setEditingEvent(null);
      setOccasionFormOpen(false);
      setEditingOccasion(null);
      setProfileAction(null);
      setProfileEditId(null);
      if (route.workflow) {
        const state = (window.history.state ?? {}) as MobileWorkflowRouteState;
        const fallbackPath = state.backgroundPath || (route.workflow.kind === "excerpt" ? "/blog" : route.workflow.kind === "publisher-news" || route.workflow.kind === "book" || route.workflow.kind === "book-status" ? "/profile/library" : `/${route.workflow.kind === "occasion" ? "meet" : `${route.workflow.kind}s`}`);
        if (window.matchMedia("(min-width: 801px)").matches && route.workflow.kind !== "publisher-news") {
          const fallbackRoute = appRouteFromPathname(fallbackPath);
          setView(fallbackRoute.view);
          window.history.replaceState({ bookMeetView: fallbackRoute.view }, "", fallbackPath);
          document.title = localizedViewTitle(fallbackRoute.view);
          return;
        }
        const viewer = routeData.users.find((user) => user.id === routeData.activeUserId);
        const denyWorkflow = () => {
          const fallbackRoute = appRouteFromPathname(fallbackPath);
          setView(fallbackRoute.view);
          window.history.replaceState({ bookMeetView: fallbackRoute.view }, "", fallbackPath);
          notifyAppNavigation();
        };
        // On a direct refresh the route effect can run before bootstrap has
        // supplied the active user. Keep the URL intact until activeUserId
        // changes and the same route owner can validate it with real data.
        if (!routeData.activeUserId) return;
        if (!viewer) { denyWorkflow(); return; }
        const workflow = route.workflow;
        const mayCreateReview = ["Читатель", "Писатель", "Блогер"].includes(viewer.profile.type.trim());
        const mayCreateExcerpt = ["Читатель", "Писатель", "Блогер"].includes(viewer.profile.type.trim());
        const approvedOrganization = !["Издатель", "Сообщество"].includes(viewer.profile.type) || viewer.profile.publisherStatus === "approved";
        if (workflow.mode === "create") {
          if (workflow.kind === "review" && !mayCreateReview || workflow.kind === "excerpt" && !mayCreateExcerpt || workflow.kind === "event" && !approvedOrganization || workflow.kind === "occasion" && !["Читатель", "Писатель", "Блогер"].includes(viewer.profile.type) || workflow.kind === "book" && ["Издатель", "Сообщество"].includes(viewer.profile.type) || workflow.kind === "publisher-news" && (!approvedOrganization || !["Издатель", "Сообщество"].includes(viewer.profile.type))) { denyWorkflow(); return; }
          setView(workflow.kind === "book" || workflow.kind === "book-status" || workflow.kind === "publisher-news" ? "profile" : workflow.kind === "excerpt" ? "publications" : workflow.kind === "occasion" ? "occasions" : workflow.kind === "event" ? "events" : "reviews");
          if (workflow.kind === "review" || workflow.kind === "excerpt") setQuickMaterialAction(workflow.kind);
          if (workflow.kind === "event") setEventFormOpen(true);
          if (workflow.kind === "occasion") setOccasionFormOpen(true);
          if (workflow.kind === "book") setProfileAction("book");
          return;
        }
        if (!workflow.id) { denyWorkflow(); return; }
        if (workflow.kind === "review" && viewer.reviews.some((item) => item.id === workflow.id) || workflow.kind === "excerpt" && (viewer.excerpts ?? []).some((item) => item.id === workflow.id)) {
          setView(workflow.kind === "review" ? "reviews" : "publications");
          setQuickMaterialAction(workflow.kind);
          setQuickMaterialEditId(workflow.id);
          return;
        }
        if ((workflow.kind === "book" || workflow.kind === "book-status") && viewer.books.some((item) => (item.catalogBookId ?? item.id) === workflow.id) || workflow.kind === "publisher-news" && (viewer.publisherNews ?? []).some((item) => item.id === workflow.id)) {
          setView("profile");
          setProfileAction(workflow.kind === "publisher-news" ? null : workflow.kind === "book-status" ? "book-status" : "book");
          setProfileEditId(workflow.id);
          return;
        }
        const event = routeData.events.find((item) => item.id === workflow.id && (item.creatorId === viewer.id || viewer.isAdmin));
        const occasion = routeData.occasions.find((item) => item.id === workflow.id && (item.creatorId === viewer.id || viewer.isAdmin));
        if (workflow.kind === "event" && event) { setView("events"); setEditingEvent(event); return; }
        if (workflow.kind === "occasion" && occasion) { setView("occasions"); setEditingOccasion(occasion); return; }
        denyWorkflow();
        return;
      }
      if (route.overlay?.kind === "chat") {
        const desktopChat = window.matchMedia("(min-width: 801px)").matches;
        const viewer = routeData.users.find((user) => user.id === routeData.activeUserId);
        const chatUser = routeData.users.find((user) => user.id === route.overlay!.id);
        setView("chat");
        setChatExpanded(false);
        if (viewer && chatUser) {
          const mayChat = routeData.friendships.some((item) => (item.userA === viewer.id && item.userB === chatUser.id) || (item.userA === chatUser.id && item.userB === viewer.id)) || routeData.communityMemberships.some((item) => (item.communityId === viewer.id && item.memberId === chatUser.id) || (item.communityId === chatUser.id && item.memberId === viewer.id)) || viewer.isAdmin || chatUser.isAdmin || viewer.profile.type === "Издатель" || chatUser.profile.type === "Издатель";
          if (mayChat) {
            setSelectedFriend({
              id: chatUser.id,
              name: chatUser.isAdmin && !viewer.isAdmin ? t("chat.support") : chatUser.profile.name,
              username: chatUser.username,
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
            document.title = `${chatUser.isAdmin && !viewer.isAdmin ? t("chat.support") : chatUser.profile.name} — ${t("header.chats")} Book Meet`;
          }
        }
        return;
      }
      const overlayState = (window.history.state ?? {}) as OverlayHistoryState;
      const backgroundRoute = route.overlay && overlayState.backgroundPath ? appRouteFromPathname(overlayState.backgroundPath) : null;
      setView(backgroundRoute?.view ?? route.view);
      if (!route.overlay) {
        document.title = route.view === "profile" ? `${t("profile.my")} — Book Meet` : localizedViewTitle(route.view);
        return;
      }
      if (routeData.accessGate && !routeData.accessGate.profileComplete && ["book", "review", "excerpt", "event", "occasion", "publisher-news"].includes(route.overlay.kind)) {
        setCompletionNotice(true);
        return;
      }
      const adultKind = route.overlay.kind === "book" || route.overlay.kind === "review" || route.overlay.kind === "excerpt" || route.overlay.kind === "event" || route.overlay.kind === "occasion" ? route.overlay.kind : null;
      if (adultKind && routeData.adultAccess.status !== "adult" && routeData.adultAccess.restricted[adultKind]?.includes(route.overlay.id)) {
        setAdultRestrictionNotice(routeData.adultAccess.status);
        document.title = `${t("content.adultMaterial")} — Book Meet`;
        return;
      }
      if (route.overlay.kind === "user") setProfileUserId(routeData.users.find((user) => user.id === route.overlay!.id && !user.isAdmin)?.id ?? null);
      if (route.overlay.kind === "book") setSelectedBook(routeData.catalog.find((book) => book.id === route.overlay!.id) ?? null);
      if (route.overlay.kind === "review") setSelectedMaterial(reviewReadingItemById(routeData.users, route.overlay.id));
      if (route.overlay.kind === "excerpt") setSelectedMaterial(excerptReadingItemById(routeData.users, route.overlay.id, t("content.publications")));
      if (route.overlay.kind === "event") setSelectedEvent(routeData.events.find((item) => item.id === route.overlay!.id) ?? null);
      if (route.overlay.kind === "occasion") setSelectedOccasion(routeData.occasions.find((item) => item.id === route.overlay!.id) ?? null);
      if (route.overlay.kind === "publisher-news") {
        const viewer = routeData.users.find((user) => user.id === routeData.activeUserId);
        const owner = routeData.users.find((user) => (viewer?.isAdmin || user.id === viewer?.id || !user.blockedByMe && !routeData.blockedByUserIds.includes(user.id)) && (user.publisherNews ?? []).some((item) => item.id === route.overlay!.id));
        setSelectedPublisherNews(owner?.publisherNews?.find((item) => item.id === route.overlay!.id) ?? null);
      }
      if (route.overlay.kind === "notification") setDetailNotification(routeData.notifications.find((item) => item.id === route.overlay!.id) ?? null);
    };
    restoreRoute();
    window.addEventListener("popstate", restoreRoute);
    return () => window.removeEventListener("popstate", restoreRoute);
  }, [activeUserId, t]);

  useEffect(() => {
    if (view === "profile") {
      document.title = `${t("profile.my")} — Book Meet`;
      return;
    }
    if (!appRouteFromPathname(window.location.pathname).overlay) document.title = localizedViewTitle(view);
  }, [view, t]);

  useEffect(() => {
    const openEditor = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: "review" | "excerpt"; id: number; admin?: boolean }>).detail;
      if (!detail?.id || !["review", "excerpt"].includes(detail.kind)) return;
      if (detail.admin && currentUser?.isAdmin) {
        const owner = users.find((user) => detail.kind === "review" ? user.reviews.some((item) => item.id === detail.id) : (user.excerpts ?? []).some((item) => item.id === detail.id));
        if (!owner) return;
        setSelectedMaterial(null);
        if (detail.kind === "review") {
          const source = owner.reviews.find((item) => item.id === detail.id);
          if (source) setAdminEditingMaterial({ id: detail.id, kind: "review", title: source.bookTitle, subtitle: owner.profile.name, text: source.preview, source: { ...source, ownerId: owner.id, ownerName: owner.profile.name } });
        } else {
          const source = owner.excerpts?.find((item) => item.id === detail.id);
          if (source) setAdminEditingMaterial({ id: detail.id, kind: "excerpt", title: source.bookTitle || t("content.publications"), subtitle: owner.profile.name, text: source.previewText, source: { ...source, ownerId: owner.id, ownerName: owner.profile.name } });
        }
        return;
      }
      openMobileWorkflow({ mode: "edit", kind: detail.kind, id: detail.id });
      if (window.matchMedia("(max-width: 800px)").matches) {
        setQuickMaterialAction(detail.kind);
        setQuickMaterialEditId(detail.id);
        setSelectedMaterial(null);
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
  const isCommunityMemberPair = (firstId: number, secondId: number) => communityMemberships.some((item) => (item.communityId === firstId && item.memberId === secondId) || (item.communityId === secondId && item.memberId === firstId));
  const friendIds = currentUser ? friendships.flatMap((item) => item.userA === currentUser.id ? [item.userB] : item.userB === currentUser.id ? [item.userA] : []) : [];
  const currentFriendUsers = users.filter((user) => friendIds.includes(user.id));
  const currentMembershipUsers = currentUser ? communityMemberships.flatMap((item) => item.communityId === currentUser.id ? [item.memberId] : item.memberId === currentUser.id ? [item.communityId] : []).map((id) => users.find((user) => user.id === id)).filter((user): user is DemoUser => Boolean(user)) : [];
  const adminUser = users.find((user) => user.isAdmin);
  const conversationUsers = currentUser ? users.filter((user) => user.id !== currentUser.id && Object.prototype.hasOwnProperty.call(messages, conversationKey(currentUser.id, user.id)) && (user.profile.type === "Издатель" || currentUser.profile.type === "Издатель")) : [];
  const friendRows: Friend[] = [...new Map([...currentFriendUsers, ...currentMembershipUsers, ...conversationUsers].map((user) => [user.id, user])).values()].map((user) => {
    const conversation = currentUser ? messages[conversationKey(currentUser.id, user.id)] ?? [] : [];
    const last = [...conversation].reverse().find((message) => !message.system);
    return { id: user.id, name: user.profile.name, username: user.username, type: user.profile.type, city: user.profile.city, initials: user.initials, avatarUrl: user.avatarUrl, color: user.color, online: Boolean(user.online), unread: conversation.filter((message) => message.unread && !message.mine && !message.system).length || undefined, lastMessage: last?.text || (last?.attachment ? t("chat.attachment") : user.profile.type === "Сообщество" || currentUser?.profile.type === "Сообщество" ? t("chat.communityMember") : t("notification.friendshipStarted")), time: last?.createdAt ? formatTime(last.createdAt) : last?.time ?? "", lastActivityAt: last?.createdAt, bio: user.profile.bio, books: user.profile.favoriteGenres.join(", ") };
  });
  const supportRow: Friend[] = currentUser && !currentUser.isAdmin && adminUser && !friendRows.some((friend) => friend.id === adminUser.id) ? (() => { const conversation = messages[conversationKey(currentUser.id, adminUser.id)] ?? []; const last = [...conversation].reverse().find((message) => !message.system); return [{ id: adminUser.id, name: t("chat.support"), username: adminUser.username, type: adminUser.profile.type, city: adminUser.profile.city, initials: "✓", color: "navy", online: Boolean(adminUser.online), support: true, unread: conversation.filter((message) => message.unread && !message.mine && !message.system).length || undefined, lastMessage: last?.text ?? t("chat.alwaysHelp"), time: last?.createdAt ? formatTime(last.createdAt) : last?.time ?? "", lastActivityAt: last?.createdAt, bio: t("chat.officialSupport"), books: "" }]; })() : [];
  const adminSupportRows: Friend[] = currentUser?.isAdmin ? users.filter((user) => user.id !== currentUser.id && !friendIds.includes(user.id) && Object.prototype.hasOwnProperty.call(messages, conversationKey(currentUser.id, user.id))).map((user) => { const conversation = messages[conversationKey(currentUser.id, user.id)] ?? []; const last = [...conversation].reverse().find((message) => !message.system); return { id: user.id, name: user.profile.name, username: user.username, type: user.profile.type, city: user.profile.city, initials: user.initials, avatarUrl: user.avatarUrl, color: user.color, online: Boolean(user.online), supportCase: true, unread: conversation.filter((message) => message.unread && !message.mine && !message.system).length || undefined, lastMessage: last?.text || (last?.attachment ? t("chat.attachment") : t("chat.supportRequest")), time: last?.createdAt ? formatTime(last.createdAt) : last?.time ?? "", lastActivityAt: last?.createdAt, bio: user.profile.bio, books: user.profile.favoriteGenres.join(", ") }; }) : [];
  const currentFriends: Friend[] = sortChatFriends(currentUser?.isAdmin ? [...friendRows, ...adminSupportRows] : [...friendRows.filter((friend) => friend.id !== adminUser?.id), ...(currentUser && adminUser ? (friendRows.some((friend) => friend.id === adminUser.id) ? friendRows.filter((friend) => friend.id === adminUser.id).map((friend) => ({ ...friend, name: t("chat.support"), support: true })) : supportRow) : [])]);
  const mobileMessageRequests: MobileMessageRequest[] = currentUser ? friendRequests.filter((request) => request.status === "pending" && request.toId === currentUser.id && request.fromId !== currentUser.id).flatMap((request) => {
    const user = users.find((candidate) => candidate.id === request.fromId);
    if (!user) return [];
    const row: MobileMessageRequest = { id: request.id, friend: { id: user.id, name: user.profile.name, username: user.username, type: user.profile.type, city: user.profile.city, initials: user.initials, avatarUrl: user.avatarUrl, color: user.color, online: Boolean(user.online), lastMessage: request.message ?? "", time: t("common.now"), bio: user.profile.bio, books: user.profile.favoriteGenres.join(", ") } };
    if (request.message) row.message = request.message;
    return [row];
  }) : [];
  const allReviews: Review[] = visibleUsers.flatMap((user, userIndex) => user.reviews.map((review, reviewIndex) => ({ id: review.id, ownerId: user.id, quote: review.preview, fullText: review.fullText, bodyHtml: review.bodyHtml, linkedBookId: review.bookId, book: `«${review.bookTitle}»`, author: review.bookAuthor, user: user.profile.name, rating: String(review.rating), tone: ["blue", "green", "red"][(userIndex + reviewIndex) % 3], createdAt: review.createdAt, createdAtValue: review.createdAtValue, isAdult: review.isAdult })));
  const allExcerpts: Excerpt[] = visibleUsers.flatMap((user) => (user.excerpts ?? []).map((excerpt) => ({ id: excerpt.id, ownerId: user.id, text: excerpt.previewText || excerpt.text.slice(0, 500), fullText: excerpt.text || excerpt.previewText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.bookId, linkedBookIds: excerpt.bookIds, title: excerpt.bookTitle || t("content.publications"), author: user.profile.name, genre: "", createdAt: excerpt.createdAt, createdAtValue: excerpt.createdAtValue, isAdult: excerpt.isAdult })));
  const allPublisherNews = visibleUsers.flatMap((user) => user.publisherNews ?? []);
  const shareItems = useMemo<ChatShareItem[]>(() => {
    const books: ChatShareItem[] = catalog.map((book) => ({ kind: "book", id: book.id, title: book.title, subtitle: book.author, preview: book.annotation, imageUrl: book.coverUrl, path: `/books/${book.id}` }));
    const people: ChatShareItem[] = users.filter((user) => !user.isAdmin).map((user) => ({ kind: "user", id: user.id, title: user.profile.name, subtitle: `${user.profile.type} · ${user.profile.city}`, preview: user.profile.bio, imageUrl: user.avatarUrl, path: `/users/${user.id}` }));
    const eventItems: ChatShareItem[] = events.filter((item) => item.status === "published").map((item) => ({ kind: "event", id: item.id, title: item.title, subtitle: `${item.city} · ${item.date}`, preview: item.summary, imageUrl: item.bookCoverUrl, path: `/events/${item.id}` }));
    const reviewItems: ChatShareItem[] = users.flatMap((user) => user.reviews.map((review) => ({ kind: "review" as const, id: review.id, title: review.bookTitle, subtitle: `${t("content.reviews")} · ${user.profile.name}`, preview: review.preview, imageUrl: catalog.find((book) => book.id === review.bookId)?.coverUrl, path: `/reviews/${review.id}` })));
    const excerptItems: ChatShareItem[] = users.flatMap((user) => (user.excerpts ?? []).map((excerpt) => ({ kind: "excerpt" as const, id: excerpt.id, title: excerpt.bookTitle || t("content.publications"), subtitle: user.profile.name, preview: excerpt.previewText, imageUrl: catalog.find((book) => book.id === excerpt.bookId)?.coverUrl, path: `/blog/${excerpt.id}` })));
    const occasionItems: ChatShareItem[] = occasions.filter((item) => item.status === "published").map((item) => ({ kind: "occasion", id: item.id, title: item.primaryText.slice(0, 72), subtitle: `${item.targetCities.join(", ")} · ${item.creatorName}`, preview: item.audienceText, path: `/meet/${item.id}` }));
    const publisherNewsItems: ChatShareItem[] = users.flatMap((user) => {
      if (!["Издатель", "Сообщество"].includes(user.profile.type) || user.profile.publisherStatus !== "approved") return [];
      return (user.publisherNews ?? []).map((news) => ({ kind: "publisher_news" as const, id: news.id, title: news.title, subtitle: `${t("content.publisherNews")} · ${user.profile.name}`, preview: news.previewText, path: `/publishing/${news.id}` }));
    });
    return [...books, ...people, ...eventItems, ...reviewItems, ...excerptItems, ...occasionItems, ...publisherNewsItems];
  }, [catalog, users, events, occasions]);
  const homeReviews = currentUser ? allReviews : [];
  const homeExcerpts = currentUser ? allExcerpts : [];
  const currentNotifications = currentUser ? notifications.filter((notification) => notification.userId === currentUser.id && notification.type !== "new_message").sort((a, b) => b.id - a.id) : [];
  const unreadCount = currentNotifications.filter((notification) => notification.unread).length;
  const unreadMessages = currentFriends.reduce((total, friend) => total + (friend.unread ?? 0), 0);
  const profileUser = users.find((user) => user.id === profileUserId && !user.isAdmin) ?? null;
  const activeUnreadMessageIds = selectedFriend && currentUser ? (messages[conversationKey(currentUser.id, selectedFriend.id)] ?? []).filter((message) => message.unread && !message.mine && !message.system).map((message) => message.id).join(",") : "";

  useEffect(() => {
    if (!selectedFriend || !currentUser || !activeUnreadMessageIds) return;
    let active = true;
    const peerId = selectedFriend.id;
    const key = conversationKey(currentUser.id, peerId);
    void apiFetch(`/api/social/messages/${peerId}/read`, { method: "PATCH", credentials: "same-origin" }).then((response) => {
      if (!response.ok) throw new Error(t("chat.readStatusError"));
      if (active) setMessages((current) => ({ ...current, [key]: (current[key] ?? []).map((message) => message.mine ? message : { ...message, unread: false }) }));
    }).catch((error) => console.warn(error));
    return () => { active = false; };
  }, [activeUnreadMessageIds, currentUser?.id, selectedFriend?.id, t]);

  useEffect(() => {
    if (!currentUser) { setCommenters({}); return; }
    let active = true;
    apiFetch("/api/material-stats", { credentials: "same-origin" }).then((response) => response.json()).then((data: { commenters?: Record<string, number[]>; commentCounts?: Record<string, number>; saveCounts?: Record<string, number> }) => { if (active) { setCommenters(data.commenters ?? {}); setCommentCounts(data.commentCounts ?? {}); setSaveCounts(data.saveCounts ?? {}); } }).catch((error) => console.warn(error));
    return () => { active = false; };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!selectedFriend || chatExpanded || view === "chat") return;
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest(".chat-popup, .friends-panel") || target.closest(".mobile-chat-dialog"))) return;
      const state = (window.history.state ?? {}) as ChatRouteState;
      if (/^\/chat\/\d+$/.test(normalizedPathname(window.location.pathname)) && state.backgroundPath) {
        const backgroundRoute = appRouteFromPathname(state.backgroundPath);
        window.history.replaceState({ bookMeetView: backgroundRoute.view }, "", state.backgroundPath);
        setView(backgroundRoute.view);
        document.title = backgroundRoute.view === "profile" ? `${t("profile.my")} — Book Meet` : localizedViewTitle(backgroundRoute.view);
      }
      setSelectedFriend(null);
      setChatExpanded(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideInteraction, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsideInteraction, true);
  }, [selectedFriend, chatExpanded, view]);

  function applyBootstrap(data: BootstrapData, preserveCurrentLibrary = false) {
    setUsers(preserveCurrentLibrary ? (current) => data.users.map((incoming) => incoming.id === activeUserId ? current.find((user) => user.id === incoming.id) ?? incoming : incoming) : data.users);
    setCatalogBooks(data.books ?? []);
    setActiveOrganizationIds(data.activeOrganizationIds ?? []);
    setActiveUserId(data.activeUserId);
    setMessages(data.messages ?? {});
    setFriendRequests(data.friendRequests ?? []);
    setFriendships(data.friendships ?? []);
    setCommunityMemberships(data.communityMemberships ?? []);
    setFollows(data.follows ?? []);
    setNotifications(data.notifications ?? []);
    setLikes(data.likes ?? {});
    setSaves(data.saves ?? {});
    setLikedMaterialRefs(data.likedMaterialRefs ?? []);
    setSavedMaterialRefs(data.savedMaterialRefs ?? []);
    setEvents(data.events ?? []);
    setOccasions(data.occasions ?? []);
    setAdultAccess(data.adultAccess ?? { status: "adult", restricted: {} });
    setBlocks(data.blocks ?? []);
    setBlockedByUserIds(data.blockedByUserIds ?? []);
    setReports(data.reports ?? []);
    if (data.accessGate) setAccessGate(data.accessGate);
    setSuspension(null);
    setStartupError("");
  }

  async function refreshBootstrap() {
    try {
      const startedAtMutationEpoch = libraryMutationEpoch.current;
      applyBootstrap(await loadApplicationData(), startedAtMutationEpoch !== libraryMutationEpoch.current);
    } catch (error) {
      if (!(error instanceof BootstrapRequestError) || error.status !== 423) throw error;
      setSuspension({ permanent: Boolean(error.data.permanent), until: typeof error.data.until === "string" ? error.data.until : undefined, reason: typeof error.data.reason === "string" ? error.data.reason : "" });
      setUsers([]); setCatalogBooks([]); setActiveOrganizationIds([]);
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
      setStartupError(authError.endsWith("not_configured") ? t("auth.googleUnavailable") : t("auth.googleFinishError"));
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
        if (data.profileCompleted === false) setNewlyRegistered(false);
      }
    }).catch(async (error) => {
      if (!active) return;
      if (error instanceof BootstrapRequestError && error.status === 401) {
        return;
      }
      if (error instanceof BootstrapRequestError && error.status === 423) {
        setSuspension({ permanent: Boolean(error.data.permanent), until: typeof error.data.until === "string" ? error.data.until : undefined, reason: typeof error.data.reason === "string" ? error.data.reason : "" });
        return;
      }
      if (error instanceof BootstrapRequestError && error.status === 410 && error.data.deletedProfile) {
        setDeletedRecovery({ daysRemaining: Number(error.data.daysRemaining ?? 0) });
        return;
      }
      setStartupError(error instanceof Error ? error.message : t("common.serverUnavailable"));
    }).finally(async () => { await finishMinimumLoading(loadingStartedAt); if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const createReview = () => startCreating("review");
    const createExcerpt = () => startCreating("excerpt");
    const addCatalogBook = (event: Event) => {
      if (!currentUser || ["Издатель", "Сообщество"].includes(currentUser.profile.type)) return;
      const bookId = Number((event as CustomEvent<{ bookId?: number }>).detail?.bookId);
      const catalogBook = catalog.find((book) => (book.catalogBookId ?? book.id) === bookId);
      if (!catalogBook || currentUser.books.some((book) => (book.catalogBookId ?? book.id) === bookId)) return;
      setCatalogBookToAdd({ ...catalogBook, id: bookId, catalogBookId: bookId, rating: 0, review: "", readingStatus: "want", topRank: undefined });
      setSelectedBook(null);
    };
    window.addEventListener("bookmeet:create-review", createReview);
    window.addEventListener("bookmeet:create-excerpt", createExcerpt);
    window.addEventListener("bookmeet:add-catalog-book", addCatalogBook);
    return () => { window.removeEventListener("bookmeet:create-review", createReview); window.removeEventListener("bookmeet:create-excerpt", createExcerpt); window.removeEventListener("bookmeet:add-catalog-book", addCatalogBook); };
  }, [currentUser, catalog]);

  async function saveCatalogBookToLibrary(book: LibraryBook) {
    if (!currentUser) return;
    const requestViewerId = currentUser.id;
    announceLibraryMutationStart(requestViewerId);
    const catalogBookId = book.catalogBookId ?? book.id;
    const payload = { ...buildReadingPatch(book), top3: Boolean(book.topRank), useExistingId: catalogBookId };
    const response = await apiFetch("/api/books", { method: "POST", body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({})) as { bookId?: number; topRank?: 1 | 2 | 3; error?: string; code?: string };
    if (!response.ok) {
      window.alert(data.code === "TOP3_LIMIT" ? t("book.top3Limit") : localizedApiError(data.error, t("book.addLibraryError")));
      return;
    }
    if (!isLibraryMutationResponse(data)) { window.alert(t("book.addLibraryError")); return; }
    announceLibraryMutation(data, requestViewerId);
    setCatalogBookToAdd(null);
  }

  function addNotification(notification: Omit<SocialNotification, "id" | "unread" | "createdAt">) {
    setNotifications((current) => [...current, { ...notification, id: Date.now() + Math.random(), unread: true, createdAt: t("common.now") }]);
  }

  function toggleLike(item: ReadingItem) {
    if (profileIncomplete) { setCompletionNotice(true); return; }
    if (!currentUser || !item.ownerId || item.ownerId === currentUser.id) return;
    const key = `${item.kind}-${item.id}`;
    const alreadyLiked = (likes[key] ?? []).includes(currentUser.id);
    void apiFetch("/api/reactions", { method: alreadyLiked ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: currentUser.id, ownerId: item.ownerId, materialKind: item.kind, materialId: item.id, text: t("notification.likeText", { name: currentUser.profile.name, title: item.title }) }) }).then((response) => { if (!response.ok) throw new Error("like"); }).catch((error) => {
      console.warn(error);
      setLikes((current) => ({ ...current, [key]: alreadyLiked ? [...new Set([...(current[key] ?? []), currentUser.id])] : (current[key] ?? []).filter((id) => id !== currentUser.id) }));
      setLikedMaterialRefs((current) => alreadyLiked ? [{ kind: item.kind, id: item.id, createdAt: new Date().toISOString() }, ...current.filter((ref) => !(ref.kind === item.kind && ref.id === item.id))] : current.filter((ref) => !(ref.kind === item.kind && ref.id === item.id)));
    });
    setLikes((current) => ({ ...current, [key]: alreadyLiked ? (current[key] ?? []).filter((id) => id !== currentUser.id) : [...(current[key] ?? []), currentUser.id] }));
    setLikedMaterialRefs((current) => alreadyLiked ? current.filter((ref) => !(ref.kind === item.kind && ref.id === item.id)) : [{ kind: item.kind, id: item.id, createdAt: new Date().toISOString() }, ...current]);
    if (alreadyLiked) return;
    setNotifications((current) => {
      const existing = current.find((notification) => notification.userId === item.ownerId && notification.type === "like" && notification.materialId === item.id && notification.materialKind === item.kind);
      const total = (likes[key] ?? []).length + 1;
      const text = total > 1 ? t("notification.likeTextMultiple", { name: currentUser.profile.name, count: formatNumber(total - 1), title: item.title }) : t("notification.likeText", { name: currentUser.profile.name, title: item.title });
      if (existing) return current.map((notification) => notification.id === existing.id ? { ...notification, actorId: currentUser.id, text, unread: true, createdAt: t("common.now") } : notification);
      return [...current, { id: Date.now() + Math.random(), userId: item.ownerId!, actorId: currentUser.id, type: "like", title: t("notification.like"), text, unread: true, createdAt: t("common.now"), materialId: item.id, materialKind: item.kind }];
    });
  }

  function toggleSave(item: ReadingItem) {
    if (profileIncomplete) { setCompletionNotice(true); return; }
    if (!currentUser) return;
    const key = `${item.kind}-${item.id}`;
    const saved = (saves[key] ?? []).includes(currentUser.id);
    const actionAt = new Date().toISOString();
    setSaves((current) => ({ ...current, [key]: saved ? (current[key] ?? []).filter((id) => id !== currentUser.id) : [currentUser.id] }));
    setSaveCounts((current) => ({ ...current, [key]: Math.max(0, (current[key] ?? 0) + (saved ? -1 : 1)) }));
    setSavedMaterialRefs((current) => saved ? current.filter((ref) => !(ref.kind === item.kind && ref.id === item.id)) : [{ kind: item.kind, id: item.id, createdAt: actionAt }, ...current]);
    void apiFetch("/api/saves", { method: saved ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ materialKind: item.kind, materialId: item.id }) }).then((response) => { if (!response.ok) throw new Error("save"); }).catch((error) => {
      console.warn(error);
      setSaves((current) => ({ ...current, [key]: saved ? [currentUser.id] : (current[key] ?? []).filter((id) => id !== currentUser.id) }));
      setSaveCounts((current) => ({ ...current, [key]: Math.max(0, (current[key] ?? 0) + (saved ? 1 : -1)) }));
      setSavedMaterialRefs((current) => saved ? [{ kind: item.kind, id: item.id, createdAt: actionAt }, ...current] : current.filter((ref) => !(ref.kind === item.kind && ref.id === item.id)));
    });
  }

  async function addComment(item: ReadingItem, text: string): Promise<MaterialComment | null> {
    if (profileIncomplete) { setCompletionNotice(true); return null; }
    if (!currentUser || !item.ownerId) return null;
    const notificationText = t("notification.commentText", { name: currentUser.profile.name, title: item.title, text });
    try {
      const response = await apiFetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: currentUser.id, ownerId: item.ownerId, materialKind: item.kind, materialId: item.id, body: text, notificationText }) });
      if (!response.ok) throw new Error(t("material.commentError"));
      const data = await response.json() as { comment: MaterialComment };
      const key = `${item.kind}-${item.id}`;
      setCommenters((current) => ({ ...current, [key]: current[key]?.includes(currentUser.id) ? current[key] : [...(current[key] ?? []), currentUser.id] }));
      setCommentCounts((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
      if (item.ownerId !== currentUser.id) addNotification({ userId: item.ownerId, actorId: currentUser.id, type: "comment", title: t("notification.comment"), text: notificationText, materialId: item.id, materialKind: item.kind });
      return data.comment;
    } catch (error) { console.warn(error); return null; }
  }

  function navigateMainView(nextView: RoutableMainView, options?: { replace?: boolean }) {
    setMobileNavigationOpen(false);
    setMobileFriendsOpen(false);
    if (nextView !== "chat") {
      setSelectedFriend(null);
      setChatExpanded(false);
    }
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

  function openMobileWorkflow(workflow: MobileWorkflowRoute) {
    if (window.matchMedia("(min-width: 801px)").matches) return false;
    const nextPath = mobileWorkflowPath(workflow);
    const currentPath = `${window.location.pathname}${window.location.search}`;
    window.history.pushState({ bookMeetWorkflow: true, backgroundPath: currentPath } satisfies MobileWorkflowRouteState, "", nextPath);
    notifyAppNavigation();
    return true;
  }

  function closeMobileWorkflow(fallbackPath: string) {
    const route = appRouteFromPathname(window.location.pathname);
    if (!route.workflow) return false;
    const state = window.history.state as MobileWorkflowRouteState | null;
    if (state?.bookMeetWorkflow && state.backgroundPath) window.history.back();
    else {
      const fallbackRoute = appRouteFromPathname(fallbackPath);
      window.history.replaceState({ bookMeetView: fallbackRoute.view }, "", fallbackPath);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    }
    return true;
  }

  function openMobileSearch() {
    if (window.matchMedia("(min-width: 801px)").matches) return;
    setMobileNavigationOpen(false);
    setMobileFriendsOpen(false);
    setNotificationsOpen(false);
    setView("search");
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (normalizedPathname(window.location.pathname) !== "/search") {
      window.history.pushState({ bookMeetSearch: true, backgroundPath: currentPath } satisfies MobileSearchRouteState, "", "/search");
      notifyAppNavigation();
    }
  }

  function closeMobileSearch() {
    const state = window.history.state as MobileSearchRouteState | null;
    if (normalizedPathname(window.location.pathname) === "/search" && state?.bookMeetSearch && state.backgroundPath) {
      window.history.back();
      return;
    }
    navigateMainView("home", { replace: true });
  }

  function openMobileSearchResult(entry: SearchEntry) {
    if (entry.kind === "review" || entry.kind === "excerpt") setSelectedMaterial(entry.item as ReadingItem);
    else if (entry.kind === "event") setSelectedEvent(entry.item as BookEvent);
    else setSelectedOccasion(entry.item as Occasion);
  }

  function openOwnProfile(options?: { replace?: boolean }) {
    setMobileNavigationOpen(false);
    setMobileFriendsOpen(false);
    setProfileUserId(null);
    setSelectedBook(null);
    setSelectedMaterial(null);
    setSelectedEvent(null);
    setSelectedOccasion(null);
    setSelectedPublisherNews(null);
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

  function closeOwnProfile() {
    const state = window.history.state as { backgroundPath?: string } | null;
    if (state?.backgroundPath && state.backgroundPath !== "/profile") {
      window.history.back();
      return;
    }
    goHome();
  }

  function goHome() { navigateMainView("home"); setSelectedFriend(null); setChatExpanded(false); setProfileAction(null); setProfileEditId(null); }
  function startCreating(action: "review" | "excerpt" | "book") {
    if (profileIncomplete) { setCompletionNotice(true); return; }
    const currentProfileType = currentUser?.profile.type.trim();
    if (action === "review" && !["Читатель", "Писатель", "Блогер"].includes(currentProfileType ?? "")) {
      setRoleRestrictionNotice("review");
      return;
    }
    if (action === "excerpt" && !["Читатель", "Писатель", "Блогер"].includes(currentProfileType ?? "")) {
      setRoleRestrictionNotice("excerpt");
      return;
    }
    if (action === "review" || action === "excerpt") {
      openMobileWorkflow({ mode: "create", kind: action });
      setQuickMaterialEditId(null);
      setQuickMaterialAction(action);
      return;
    }
    openMobileWorkflow({ mode: "create", kind: "book" });
    setProfileAction(action);
    setProfileEditId(null);
    openOwnProfile();
  }

  function startOccasionCreation() {
    if (profileIncomplete) { setCompletionNotice(true); return; }
    if (["Издатель", "Сообщество"].includes(currentUser?.profile.type ?? "")) {
      setRoleRestrictionNotice(currentUser?.profile.publisherStatus === "approved" ? "occasion" : "publisher-pending");
      return;
    }
    openMobileWorkflow({ mode: "create", kind: "occasion" });
    setOccasionFormOpen(true);
  }

  function startEventCreation() {
    if (profileIncomplete) { setCompletionNotice(true); return; }
    if (["Издатель", "Сообщество"].includes(currentUser?.profile.type ?? "") && currentUser?.profile.publisherStatus !== "approved") {
      setRoleRestrictionNotice("publisher-pending");
      return;
    }
    openMobileWorkflow({ mode: "create", kind: "event" });
    setEventFormOpen(true);
  }

  function startEventEditing(item: BookEvent) {
    openMobileWorkflow({ mode: "edit", kind: "event", id: item.id });
    setEditingEvent(item);
  }

  function startOccasionEditing(item: Occasion) {
    openMobileWorkflow({ mode: "edit", kind: "occasion", id: item.id });
    setEditingOccasion(item);
  }

  function startPublisherNewsCreation() {
    if (profileIncomplete) { setCompletionNotice(true); return; }
    if (openMobileWorkflow({ mode: "create", kind: "publisher-news" })) {
      setProfileAction(null);
      setProfileEditId(null);
      setView("profile");
      return;
    }
    setProfileAction(null);
    setProfileEditId(null);
    setView("profile");
    window.history.pushState({ bookMeetWorkflow: true, backgroundPath: normalizedPathname(window.location.pathname) }, "", "/create/news");
    notifyAppNavigation();
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
    if (!user || (!isFriendPair(currentUser.id, userId) && !isCommunityMemberPair(currentUser.id, userId) && !currentUser.isAdmin && !user.isAdmin && currentUser.profile.type !== "Издатель" && user.profile.type !== "Издатель")) return;
    const currentPath = normalizedPathname(window.location.pathname);
    const desktopChat = window.matchMedia("(min-width: 801px)").matches;
    const currentChatState = (window.history.state ?? {}) as ChatRouteState;
    const isSwitchingChat = /^\/chat\/\d+$/.test(currentPath);
    const backgroundPath = isSwitchingChat ? (currentChatState.backgroundPath ?? "/chat") : currentPath;
    const nextState: ChatRouteState = { bookMeetChat: true, backgroundPath, chatMode: "compact" };
    window.history[isSwitchingChat ? "replaceState" : "pushState"](nextState, "", `/chat/${userId}`);
    notifyAppNavigation();
    document.title = `${user.isAdmin && !currentUser.isAdmin ? t("chat.support") : user.profile.name} — ${t("header.chats")} Book Meet`;
    setSelectedFriend({ id: user.id, name: user.isAdmin && !currentUser.isAdmin ? t("chat.support") : user.profile.name, username: user.username, type: user.profile.type, city: user.profile.city, initials: user.initials, avatarUrl: user.avatarUrl, color: user.isAdmin ? "navy" : user.color, online: Boolean(user.online), support: Boolean(user.isAdmin && !currentUser.isAdmin), lastMessage: "", time: "", bio: user.profile.bio, books: user.profile.favoriteGenres.join(", ") });
    setChatExpanded(false);
    if (!desktopChat) setView("chat");
    setProfileUserId(null); setNotificationsOpen(false);
  }

  async function sendMessage(text: string, attachment?: ChatAttachment) {
    if (!selectedFriend || !currentUser) return;
    const response = await apiFetch("/api/social/messages", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId: selectedFriend.id, body: text, attachment }) });
    if (!response.ok) { alert(t("chat.sendError")); return; }
    const data = await response.json() as { message?: Message };
    const createdAt = data.message?.createdAt ?? new Date().toISOString();
    const key = conversationKey(currentUser.id, selectedFriend.id);
    setMessages((current) => ({ ...current, [key]: [...(current[key] ?? []), { id: data.message?.id ?? Date.now(), mine: true, senderId: currentUser.id, text, attachment, time: "", createdAt, read: false }] }));
  }

  async function shareMaterial(targetId: number, attachment: ChatAttachment) {
    if (!currentUser || !isFriendPair(currentUser.id, targetId)) throw new Error(t("share.error"));
    const response = await apiFetch("/api/social/messages", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId, body: "", attachment }) });
    const data = await response.json().catch(() => ({})) as { error?: string; message?: Message };
    if (!response.ok) throw new Error(localizedApiError(data.error, t("share.error")));
    const key = conversationKey(currentUser.id, targetId);
    setMessages((current) => ({ ...current, [key]: [...(current[key] ?? []), { id: data.message?.id ?? Date.now(), mine: true, senderId: currentUser.id, text: "", attachment, time: "", createdAt: data.message?.createdAt ?? new Date().toISOString(), read: false }] }));
  }

  async function clearChatHistory() {
    if (!selectedFriend || !currentUser) return false;
    try {
      const response = await apiFetch(`/api/social/messages/${selectedFriend.id}/history`, { method: "DELETE", credentials: "same-origin" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        window.alert(localizedApiError(data.error, t("chat.clearHistoryError")));
        return false;
      }
      const key = conversationKey(currentUser.id, selectedFriend.id);
      setMessages((current) => ({ ...current, [key]: [] }));
      return true;
    } catch {
      window.alert(t("chat.clearHistoryError"));
      return false;
    }
  }

  async function sendFriendRequest(targetId: number, message: string) {
    if (!currentUser || currentUser.id === targetId) return;
    const target = users.find((user) => user.id === targetId);
    if (target?.profile.type !== "Сообщество" && (currentUser.profile.type === "Издатель" || target?.profile.type === "Издатель")) return;
    if (friendRequests.some((request) => request.status === "pending" && ((request.fromId === currentUser.id && request.toId === targetId) || (request.fromId === targetId && request.toId === currentUser.id)))) return;
    const response = await apiFetch("/api/social/friend-requests", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId, message }) });
    if (!response.ok) { alert(t("social.friendRequestError")); return; }
    setFriendRequests((current) => [...current, { id: Date.now(), fromId: currentUser.id, toId: targetId, status: "pending", message }]);
    const targetIsCommunity = users.find((user) => user.id === targetId)?.profile.type === "Сообщество";
    addNotification({ userId: targetId, actorId: currentUser.id, type: "friend_request", title: targetIsCommunity ? t("notification.newMembershipRequest") : t("notification.friendRequest"), text: targetIsCommunity ? t("notification.membershipRequestText", { name: currentUser.profile.name, message: message ? t("notification.messageSuffix", { message }) : "" }) : t("notification.friendRequestText", { name: currentUser.profile.name, message: message ? t("notification.messageSuffix", { message }) : "" }) });
  }

  async function cancelFriendRequest(targetId: number) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/friend-requests/${targetId}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error(localizedApiError((await response.json() as { error?: string }).error, t("social.cancelRequestError")));
    setFriendRequests((current) => current.filter((request) => !(request.status === "pending" && request.fromId === currentUser.id && request.toId === targetId)));
    setNotifications((current) => current.filter((notification) => !(notification.type === "friend_request" && notification.actorId === currentUser.id && notification.userId === targetId)));
  }

  async function acceptFriend(targetId: number) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/friends/${targetId}/accept`, { method: "POST", credentials: "same-origin" });
    if (!response.ok) { alert(t("social.acceptRequestError")); return; }
    setFriendRequests((current) => current.map((request) => request.status === "pending" && request.fromId === targetId && request.toId === currentUser.id ? { ...request, status: "accepted" } : request));
    const isMembership = currentUser.profile.type === "Сообщество";
    if (isMembership) setCommunityMemberships((current) => [...current, { communityId: currentUser.id, memberId: targetId }]);
    else setFriendships((current) => [...current, { userA: currentUser.id, userB: targetId }]);
    if (!isMembership) setFollows((current) => {
      const pairs = [{ followerId: currentUser.id, targetId }, { followerId: targetId, targetId: currentUser.id }];
      return [...current, ...pairs.filter((pair) => !current.some((follow) => follow.followerId === pair.followerId && follow.targetId === pair.targetId))];
    });
    const systemText = isMembership ? t("social.membershipAcceptedSystem") : t("social.friendshipAcceptedSystem");
    const notificationTitle = isMembership ? t("social.requestAccepted") : t("notification.friendshipStarted");
    addNotification({ userId: currentUser.id, actorId: targetId, type: "friendship_started", title: notificationTitle, text: systemText });
    addNotification({ userId: targetId, actorId: currentUser.id, type: "friendship_started", title: notificationTitle, text: systemText });
    setProfileUserId(null);
  }

  async function rejectFriend(targetId: number, comment: string) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/friends/${targetId}/reject`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ comment }) });
    if (!response.ok) { alert(t("social.rejectRequestError")); return; }
    setFriendRequests((current) => current.map((request) => request.status === "pending" && request.fromId === targetId && request.toId === currentUser.id ? { ...request, status: "rejected", comment } : request));
    const isMembership = currentUser.profile.type === "Сообщество";
    addNotification({ userId: targetId, actorId: currentUser.id, type: "friend_rejected", title: isMembership ? t("social.requestRejected") : t("notification.friendRejected"), text: isMembership ? t("notification.membershipRejectedText", { name: currentUser.profile.name, comment: comment.trim() ? t("notification.commentSuffix", { comment: comment.trim() }) : "" }) : t("notification.friendRejectedText", { name: currentUser.profile.name, comment: comment.trim() ? t("notification.commentSuffix", { comment: comment.trim() }) : "" }) });
    setProfileUserId(null);
  }

  async function removeFriend(targetId: number) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/friends/${targetId}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) { alert(t("social.friendListError")); return; }
    const targetIsCommunity = users.find((user) => user.id === targetId)?.profile.type === "Сообщество";
    if (targetIsCommunity || currentUser.profile.type === "Сообщество") setCommunityMemberships((current) => current.filter((item) => !((item.communityId === currentUser.id && item.memberId === targetId) || (item.communityId === targetId && item.memberId === currentUser.id))));
    else setFriendships((current) => current.filter((item) => !((item.userA === currentUser.id && item.userB === targetId) || (item.userA === targetId && item.userB === currentUser.id))));
    const membershipEnded = targetIsCommunity || currentUser.profile.type === "Сообщество";
    addNotification({ userId: targetId, actorId: currentUser.id, type: "friendship_ended", title: membershipEnded ? t("social.membershipEnded") : t("notification.friendshipEnded"), text: membershipEnded ? t("notification.membershipEndedText", { name: currentUser.profile.name }) : t("notification.friendshipEndedText", { name: currentUser.profile.name }) });
    setProfileUserId(null); if (selectedFriend?.id === targetId) { setSelectedFriend(null); setChatExpanded(false); }
  }

  async function followUser(targetId: number) {
    if (!currentUser || follows.some((follow) => follow.followerId === currentUser.id && follow.targetId === targetId)) return;
    const response = await apiFetch("/api/social/follows", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId }) });
    if (!response.ok) { alert(t("social.followError")); return; }
    setFollows((current) => [...current, { followerId: currentUser.id, targetId }]);
    addNotification({ userId: targetId, actorId: currentUser.id, type: "new_follower", title: t("notification.newFollower"), text: t("notification.newFollowerText", { name: currentUser.profile.name }) });
  }

  async function unfollowUser(targetId: number) {
    if (!currentUser) return;
    const response = await apiFetch(`/api/social/follows/${targetId}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error(localizedApiError((await response.json() as { error?: string }).error, t("social.unfollowError")));
    setFollows((current) => current.filter((follow) => !(follow.followerId === currentUser.id && follow.targetId === targetId)));
    setNotifications((current) => current.filter((notification) => !(notification.type === "new_follower" && notification.actorId === currentUser.id && notification.userId === targetId)));
  }

  async function unblockUser(targetId: number) {
    const response = await apiFetch(currentUser?.isAdmin ? `/api/admin/users/${targetId}/suspension` : `/api/social/blocks/${targetId}`, { method: "DELETE", credentials: "same-origin" });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(localizedApiError(data.error, t("social.unblockError")));
    await refreshBootstrap();
  }

  async function blockUser(targetId: number) {
    const endpoint = currentUser?.isAdmin ? `/api/admin/users/${targetId}/suspension` : "/api/social/blocks";
    const body = currentUser?.isAdmin
      ? { permanent: true, reason: t("admin.blockedByAdmin") }
      : { targetId };
    const response = await apiFetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(localizedApiError(data.error, t("social.blockError")));
    setProfileUserId(null);
    await refreshBootstrap();
  }

  function handleUserChange(updatedUser: DemoUser): Promise<void> {
    const previous = users.find((user) => user.id === updatedUser.id);
    setUsers((current) => current.map((user) => user.id === updatedUser.id ? updatedUser : user));
    const saveTask = profileSaveQueue.current.catch(() => undefined).then(async () => {
      const organizationKeepsUsername = ["Издатель", "Сообщество"].includes(updatedUser.profile.type) && previous?.username === updatedUser.username;
      const response = await apiFetch("/api/users/me/state", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: updatedUser.profile, username: organizationKeepsUsername ? undefined : updatedUser.username, avatarUrl: updatedUser.avatarUrl, reviews: updatedUser.reviews, excerpts: updatedUser.excerpts ?? [], publisherNews: updatedUser.publisherNews ?? [] }) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(localizedApiError(data.error, t("profile.saveMaterialsError")));
      }
    });
    profileSaveQueue.current = saveTask.catch(() => undefined);
    if (previous && updatedUser.reviews.length > previous.reviews.length) {
      const recipients = users.filter((user) => user.id !== updatedUser.id && (isFriendPair(user.id, updatedUser.id) || follows.some((follow) => follow.followerId === user.id && follow.targetId === updatedUser.id)));
      recipients.forEach((recipient) => addNotification({ userId: recipient.id, actorId: updatedUser.id, type: "publication", title: t("notification.newReview"), text: t("notification.newReviewText", { name: updatedUser.profile.name }) }));
    }
    return saveTask.catch((error) => {
      if (previous) setUsers((current) => current.map((user) => user === updatedUser ? previous : user));
      throw error;
    });
  }

  async function handleHomeViewChange(homeView: "classic" | "feed") {
    const response = await apiFetch("/api/users/me/home-view", { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ homeView }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(localizedApiError(data.error, t("settings.homeViewError")));
    setUsers((current) => current.map((user) => user.id === activeUserId ? { ...user, profile: { ...user.profile, homeView } } : user));
  }

  async function createEvent(value: typeof emptyEvent) {
    if (profileIncomplete) { setCompletionNotice(true); return; }
    const response = await apiFetch("/api/events", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const data = await response.json() as { event?: BookEvent; error?: string };
    if (!response.ok || !data.event) { alert(localizedApiError(data.error, t("event.submitError"))); return; }
    setEvents((current) => [...current, data.event!]);
    setEventFormOpen(false);
    closeMobileWorkflow("/events");
    if (currentUser) addNotification({ userId: currentUser.id, actorId: currentUser.id, type: "event_submitted", title: t("notification.eventSubmitted"), text: t("notification.eventSubmittedText", { title: data.event.title }), materialId: data.event.id, materialKind: "event" });
  }

  async function resubmitEvent(value: typeof emptyEvent) {
    if (!editingEvent) return;
    const response = await apiFetch(`/api/events/${editingEvent.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const data = await response.json() as { event?: BookEvent; error?: string };
    if (!response.ok || !data.event) { alert(localizedApiError(data.error, t("event.resubmitError"))); return; }
    setEvents((current) => current.map((item) => item.id === editingEvent.id ? data.event! : item));
    setEditingEvent(null);
    closeMobileWorkflow("/events");
  }

  async function moderateEvent(id: number, action: "accept" | "revision" | "reject" | "edit", note = "", event?: typeof emptyEvent, pinned = false) {
    const response = await apiFetch(`/api/admin/events/${id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note, event, pinned }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { alert(localizedApiError(data.error, t("admin.applyDecisionError"))); return; }
    setEvents((current) => current.map((item) => item.id !== id ? item : action === "edit" && event ? { ...item, ...event } : { ...item, status: action === "accept" ? "published" : action === "revision" ? "needs_changes" : "rejected", moderationNote: note, pinned: action === "accept" ? pinned : false }));
  }

  async function createOccasion(value: typeof emptyOccasion) {
    if (profileIncomplete) { setCompletionNotice(true); return; }
    const response = await apiFetch("/api/occasions", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const data = await response.json() as { occasion?: Occasion; error?: string };
    if (!response.ok || !data.occasion) { alert(localizedApiError(data.error, t("occasion.submitError"))); return; }
    setOccasions((current) => [data.occasion!, ...current]); setOccasionFormOpen(false); closeMobileWorkflow("/meet");
  }

  async function resubmitOccasion(value: typeof emptyOccasion) {
    if (!editingOccasion) return;
    const response = await apiFetch(`/api/occasions/${editingOccasion.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const data = await response.json() as { occasion?: Occasion; error?: string };
    if (!response.ok || !data.occasion) { alert(localizedApiError(data.error, t("occasion.resubmitError"))); return; }
    setOccasions((current) => current.map((item) => item.id === editingOccasion.id ? data.occasion! : item));
    setEditingOccasion(null);
    closeMobileWorkflow("/meet");
  }

  async function moderateOccasion(id: number, action: "accept" | "revision" | "reject" | "edit", note = "", occasion?: typeof emptyOccasion) {
    const response = await apiFetch(`/api/admin/occasions/${id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note, occasion }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { alert(localizedApiError(data.error, t("admin.applyDecisionError"))); return; }
    setOccasions((current) => current.map((item) => item.id !== id ? item : action === "edit" && occasion ? { ...item, ...occasion, type: occasion.type || item.type } : { ...item, status: action === "accept" ? "published" : action === "revision" ? "needs_changes" : "rejected", moderationNote: note }));
  }

  async function moderatePublisher(id: number, action: "accept" | "revision" | "reject", note = "") {
    const response = await apiFetch(`/api/admin/publishers/${id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { alert(localizedApiError(data.error, t("admin.publisherStatusError"))); return; }
    const publisherStatus = action === "accept" ? "approved" : action === "revision" ? "needs_changes" : "rejected";
    setUsers((current) => current.map((user) => user.id === id ? { ...user, profile: { ...user.profile, publisherStatus, publisherModerationNote: note } } : user));
  }

  async function deleteMaterial(kind: AdminCatalogKind, id: number) {
    const response = await apiFetch(`/api/admin/materials/${kind}/${id}`, { method: "DELETE", credentials: "same-origin" });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { window.alert(localizedApiError(data.error, t("material.deleteError"))); return; }
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
      else if (notification.materialKind === "excerpt") { const excerpt = owner?.excerpts?.find((item) => item.id === notification.materialId); if (excerpt) setSelectedMaterial({ id: excerpt.id, kind: "excerpt", title: excerpt.bookTitle || t("content.publications"), author: owner!.profile.name, text: excerpt.text, preview: excerpt.previewText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.bookId, linkedBookIds: excerpt.bookIds, ownerId: owner!.id, createdAt: excerpt.createdAt }); }
      else if (notification.materialKind === "event") setSelectedEvent(events.find((item) => item.id === notification.materialId) ?? null);
      else if (notification.materialKind === "occasion") setSelectedOccasion(occasions.find((item) => item.id === notification.materialId) ?? null);
      else setDetailNotification(notification);
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
      if (!response.ok) { await finishMinimumLoading(loadingStartedAt); setAuthTransition(false); return { error: localizedApiError(data.error, t("auth.loginError")) }; }
      applyBootstrap(data);
      setNewlyRegistered(false);
      const returnTo = safeReturnTo(sessionStorage.getItem("bookmeet:returnTo") || "/");
      sessionStorage.removeItem("bookmeet:returnTo");
      window.history.replaceState({}, "", returnTo);
      setView(appRouteFromPathname(returnTo).view);
      await finishMinimumLoading(loadingStartedAt); setAuthTransition(false);
      return {};
    } catch {
      await finishMinimumLoading(loadingStartedAt); setAuthTransition(false);
      return { error: t("common.serverConnectionError") };
    }
  }

  async function register(value: { email: string; username: string; password: string; legalAcceptance: { agreementAccepted: boolean; personalDataAccepted: boolean; documentIds: number[] } }): Promise<AuthResult> {
    const loadingStartedAt = Date.now();
    setAuthTransition(true);
    try {
      const response = await apiFetch("/api/auth/register", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      const data = await response.json() as BootstrapData & AuthResult;
      if (!response.ok) { await finishMinimumLoading(loadingStartedAt); setAuthTransition(false); return { error: data.code ? localizedApiError(data.code, localizedApiError(data.error, t("auth.createProfileError"))) : localizedApiError(data.error, t("auth.createProfileError")) }; }
      applyBootstrap(data);
      setNewlyRegistered(true);
      window.history.replaceState({}, "", "/profile");
      setView("profile");
      await finishMinimumLoading(loadingStartedAt); setAuthTransition(false);
      return {};
    } catch {
      await finishMinimumLoading(loadingStartedAt); setAuthTransition(false);
      return { error: t("common.serverConnectionError") };
    }
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    setUsers([]); setCatalogBooks([]); setActiveOrganizationIds([]); setActiveUserId(null); setMessages({}); setFriendRequests([]); setFriendships([]); setCommunityMemberships([]); setFollows([]); setNotifications([]); setLikes({}); setSaves({}); setLikedMaterialRefs([]); setSavedMaterialRefs([]); setEvents([]); setOccasions([]); setBlocks([]); setBlockedByUserIds([]); setReports([]); setSuspension(null); setCommenters({}); setCommentCounts({}); setSaveCounts({}); setSelectedFriend(null); setChatExpanded(false);
    navigateMainView("home", { replace: true }); setNotificationsOpen(false); setProfileAction(null); setNewlyRegistered(false); setAuthTransition(false);
  }

  async function resolveDeletedProfile(action: "restore" | "new") {
    setAuthTransition(true);
    try {
      const response = await apiFetch(`/api/auth/deleted-profile/${action}`, { method: "POST", credentials: "same-origin" });
      const data = await response.json() as BootstrapData & { error?: string };
      if (!response.ok) throw new Error(localizedApiError(data.error, t("profile.deletedResolveError")));
      applyBootstrap(data);
      setDeletedRecovery(null);
      setNewlyRegistered(action === "new");
      setView(action === "new" ? "profile" : "home");
      window.history.replaceState({}, "", action === "new" ? "/profile" : "/");
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : t("profile.deletedResolveError"));
    } finally {
      setAuthTransition(false);
    }
  }

  if (authTransition) return <AuthBookTransition />;
  if (authLoading) return <AuthBookTransition />;
  if (deletedRecovery) return <main className="deleted-profile-recovery"><section role="dialog" aria-modal="true"><h1>{t("profile.deletedTitle")}</h1><p>{t("profile.deletedRetention", { days: formatNumber(deletedRecovery.daysRemaining) })}</p><p>{t("profile.deletedNewWarning")}</p>{startupError && <span className="login-error">{startupError}</span>}<div className="form-actions"><button className="primary-button" type="button" onClick={() => void resolveDeletedProfile("restore")}>{t("admin.restoreProfile")}</button><button className="danger-button" type="button" onClick={() => void resolveDeletedProfile("new")}>{t("profile.createNew")}</button></div></section></main>;
  if (suspension) return <main className="suspension-screen"><section><h1>{t("profile.accessRestricted")}</h1><p>{suspension.permanent ? t("profile.blockedIndefinitely") : t("profile.blockedUntil", { date: formatDate(suspension.until ?? "", { dateStyle: "medium", timeStyle: "short" }) })}</p><p><strong>{t("safety.reason")}:</strong> <span data-i18n-skip>{suspension.reason || t("profile.rulesViolation")}</span></p></section></main>;
  if (!currentUser) return <LoginScreen onLogin={login} onRegister={register} initialError={startupError} />;
  const relationshipToProfile: SocialRelationship = profileUser ? isFriendPair(currentUser.id, profileUser.id) ? "friends" : isCommunityMemberPair(currentUser.id, profileUser.id) ? "community-member" : friendRequests.some((request) => request.status === "pending" && request.fromId === profileUser.id && request.toId === currentUser.id) ? "incoming" : friendRequests.some((request) => request.status === "pending" && request.fromId === currentUser.id && request.toId === profileUser.id) ? "outgoing" : "none" : "none";
  const profileFriendUsers = profileUser?.friendIds ? profileUser.friendIds.map((id) => users.find((candidate) => candidate.id === id)).filter((candidate): candidate is DemoUser => Boolean(candidate) && !candidate!.isAdmin) : [];
  const profileMemberUsers = profileUser?.memberIds ? profileUser.memberIds.map((id) => users.find((candidate) => candidate.id === id)).filter((candidate): candidate is DemoUser => Boolean(candidate) && !candidate!.isAdmin) : [];
  const profileFriendIds = new Set(profileFriendUsers.map((user) => user.id));
  const profileFollowerUsers = profileUser?.followerIds ? profileUser.followerIds.filter((id) => !profileFriendIds.has(id)).map((id) => users.find((candidate) => candidate.id === id)).filter((candidate): candidate is DemoUser => Boolean(candidate) && !candidate!.isAdmin) : [];
  const profileFollowingUsers = profileUser ? follows.filter((follow) => follow.followerId === profileUser.id && !profileFriendIds.has(follow.targetId)).map((follow) => users.find((candidate) => candidate.id === follow.targetId)).filter((candidate): candidate is DemoUser => Boolean(candidate) && !candidate!.isAdmin) : [];
  const profileCommunityUsers = profileUser ? communityMemberships.filter((membership) => membership.memberId === profileUser.id).map((membership) => users.find((candidate) => candidate.id === membership.communityId)).filter((candidate): candidate is DemoUser => Boolean(candidate) && candidate!.profile.type === "Сообщество") : [];
  const relationshipFor = (userId: number): SocialRelationship => isFriendPair(currentUser.id, userId) ? "friends" : isCommunityMemberPair(currentUser.id, userId) ? "community-member" : friendRequests.some((request) => request.status === "pending" && request.fromId === userId && request.toId === currentUser.id) ? "incoming" : friendRequests.some((request) => request.status === "pending" && request.fromId === currentUser.id && request.toId === userId) ? "outgoing" : "none";
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
    setMobileFriendsOpen(false);
    document.title = localizedViewTitle("chat");
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
    if (attachment.kind === "book") setSelectedBook(catalog.find((book) => book.id === attachment.id) ?? null);
    else if (attachment.kind === "user") openUserProfile(attachment.id);
    else if (attachment.kind === "event") setSelectedEvent(events.find((item) => item.id === attachment.id) ?? null);
    else if (attachment.kind === "review") setSelectedMaterial(reviewReadingItemById(users, attachment.id));
    else if (attachment.kind === "excerpt") setSelectedMaterial(excerptReadingItemById(users, attachment.id, t("content.publications")));
    else if (attachment.kind === "publisher_news") openPersonalMaterial("publisher_news", attachment.id);
    else setSelectedOccasion(occasions.find((item) => item.id === attachment.id) ?? null);
  };
  const openPersonalMaterial = (kind: MaterialActionRef["kind"], id: number) => {
    if (kind === "event") { setSelectedEvent(events.find((item) => item.id === id) ?? null); return; }
    if (kind === "occasion") { setSelectedOccasion(occasions.find((item) => item.id === id) ?? null); return; }
    if (kind === "review") { setSelectedMaterial(reviewReadingItemById(users, id)); return; }
    if (kind === "excerpt") { setSelectedMaterial(excerptReadingItemById(users, id, t("content.publications"))); return; }
    const source = allPublisherNews.find((item) => item.id === id);
    if (window.matchMedia("(min-width: 801px)").matches) {
      const owner = source ? users.find((user) => user.id === source.ownerId) : undefined;
      setSelectedMaterial(source ? { id: source.id, kind: "publisher_news", title: source.title, author: owner?.profile.name ?? t("content.publisherNews"), text: source.body, preview: source.previewText, bodyHtml: source.bodyHtml, ownerId: source.ownerId, createdAt: source.createdAt } : null);
      return;
    }
    setSelectedPublisherNews(source ?? null);
  };
  const chat = selectedFriend ? <ChatView friend={selectedFriend} messages={activeChatMessages} profileEnabled={!selectedFriend.support} onOpenProfile={() => openUserProfile(selectedFriend.id)} onSend={sendMessage} onClearHistory={clearChatHistory} shareItems={shareItems} onOpenAttachment={openChatAttachment} onReport={!currentUser.isAdmin && !selectedFriend.support ? () => openReportDialog({ kind: "chat", id: selectedFriend.id }) : undefined} expanded={chatExpanded} onToggleExpanded={toggleChatExpanded} onClose={closeChat} /> : null;
  const mobileChatPage = currentRoute.overlay?.kind === "chat" && selectedFriend ? <div className="mobile-chat-dialog"><ChatView friend={selectedFriend} messages={activeChatMessages} profileEnabled={!selectedFriend.support} onOpenProfile={() => openUserProfile(selectedFriend.id)} onSend={sendMessage} onClearHistory={clearChatHistory} shareItems={shareItems} onOpenAttachment={openChatAttachment} onReport={!currentUser.isAdmin && !selectedFriend.support ? () => openReportDialog({ kind: "chat", id: selectedFriend.id }) : undefined} expanded={false} onToggleExpanded={() => undefined} onClose={closeChat} fullPage mobileDialog /> </div> : <MobileMessagesPage friends={currentFriends} requests={mobileMessageRequests} onSelectFriend={(friend) => openChat(friend.id)} onOpenRequest={openUserProfile} />;
  const chatPage = selectedFriend ? <ChatView friend={selectedFriend} messages={activeChatMessages} profileEnabled={!selectedFriend.support} onOpenProfile={() => openUserProfile(selectedFriend.id)} onSend={sendMessage} onClearHistory={clearChatHistory} shareItems={shareItems} onOpenAttachment={openChatAttachment} onReport={!currentUser.isAdmin && !selectedFriend.support ? () => openReportDialog({ kind: "chat", id: selectedFriend.id }) : undefined} expanded={false} onToggleExpanded={() => undefined} onClose={() => undefined} fullPage /> : <ChatScreen hasFriends={currentFriends.length > 0} />;
  const routedChatPage = <><div className="desktop-chat-page">{chatPage}</div>{mobileChatPage}</>;
  const upcomingEvents = events.filter((item) => eventTimestamp(item) > eventClock);
  const visibleHomeEvents = upcomingEvents.filter((item) => item.creatorId === currentUser.id && item.status !== "rejected" || item.status === "published").sort((a, b) => eventTimestamp(a) - eventTimestamp(b));
  const visibleHomeOccasions = occasions.filter((item) => item.creatorId === currentUser.id && item.status !== "rejected" || item.status === "published" && (item.targetGender === "Все" || item.targetGender === currentUser.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === currentUser.profile.type));
  const materialDirectoryProps = { reviews: allReviews, excerpts: allExcerpts, publisherNews: allPublisherNews, currentUser, users: visibleUsers, catalog, likes, saves, commenters, commentCounts, saveCounts, onToggleLike: toggleLike, onToggleSave: toggleSave, onComment: addComment, onOpenUser: openUserProfile, relationshipFor, isFollowing: followsUser, onAddFriend: sendFriendRequest, onFollow: followUser };
  const activeOrganizationUsers = visibleUsers.filter((user) => activeOrganizationIds.includes(user.id) && !user.deletedAt && !user.purged);
  const mobileCreateOptions: MobileCreateOption[] = [
    ...(!["Издатель", "Сообщество"].includes(currentUser.profile.type) ? [{ label: t("content.createPublication"), onClick: () => startCreating("excerpt") }] : []),
    ...(["Читатель", "Писатель", "Блогер"].includes(currentUser.profile.type) ? [{ label: t("content.createReview"), onClick: () => startCreating("review") }] : []),
    { label: t("content.createEvent"), onClick: startEventCreation },
    ...(!["Издатель", "Сообщество"].includes(currentUser.profile.type) ? [{ label: t("content.createOccasion"), onClick: startOccasionCreation }] : []),
    ...(["Издатель", "Сообщество"].includes(currentUser.profile.type) ? [{ label: t("content.publishNews"), onClick: startPublisherNewsCreation }] : []),
  ];
  const mobileSearchQuery = mobileSearchQueryRef.current;
  const directoryShell = (content: ReactNode) => <div className="directory-page-shell"><button className="back-button directory-home-button" type="button" onClick={goHome}>← {t("common.home")}</button>{content}</div>;
  const workspaceContent = view === "reviews"
    ? directoryShell(<MaterialsDirectoryPage kind="review" onCreate={() => startCreating("review")} {...materialDirectoryProps} />)
    : view === "publications"
      ? directoryShell(<MaterialsDirectoryPage kind="excerpt" onCreate={() => startCreating("excerpt")} {...materialDirectoryProps} />)
      : view === "events"
        ? <EventsDirectoryPage events={upcomingEvents} currentUser={currentUser} users={users} catalog={catalog} onHome={goHome} onCreate={startEventCreation} onEdit={startEventEditing} onOpenUser={openUserProfile} />
        : view === "occasions"
          ? <OccasionsDirectoryPage occasions={occasions} currentUser={currentUser} users={visibleUsers} catalog={catalog} onHome={goHome} onCreate={startOccasionCreation} onEdit={startOccasionEditing} onOpenUser={openUserProfile} />
          : view === "users"
            ? directoryShell(<UsersDirectoryPage currentUser={currentUser} users={visibleUsers} onOpenUser={openUserProfile} />)
            : view === "publishing"
              ? directoryShell(<PublishingDirectoryPage users={activeOrganizationUsers} events={upcomingEvents} onOpenUser={openUserProfile} />)
            : view === "books"
              ? directoryShell(<AllBooksDirectoryPage users={visibleUsers} currentUser={currentUser} onOpenUser={openUserProfile} />)
            : view === "communities"
              ? directoryShell(<CommunitiesDirectoryPage users={activeOrganizationUsers} events={upcomingEvents} onOpenUser={openUserProfile} />)
            : view === "partners"
              ? directoryShell(<SimpleDirectoryPage kind="partners" />)
            : view === "liked"
              ? <PersonalMaterialFeed mode="liked" refs={likedMaterialRefs} users={visibleUsers} events={events} occasions={occasions} publisherNews={allPublisherNews} currentUser={currentUser} likes={likes} saves={saves} commentCounts={commentCounts} saveCounts={saveCounts} onToggleLike={toggleLike} onToggleSave={toggleSave} onOpenUser={openUserProfile} onOpenMaterial={openPersonalMaterial} />
            : view === "saved"
              ? <PersonalMaterialFeed mode="saved" refs={savedMaterialRefs} users={visibleUsers} events={events} occasions={occasions} publisherNews={allPublisherNews} currentUser={currentUser} likes={likes} saves={saves} commentCounts={commentCounts} saveCounts={saveCounts} onToggleLike={toggleLike} onToggleSave={toggleSave} onOpenUser={openUserProfile} onOpenMaterial={openPersonalMaterial} />
            : view === "chat" ? routedChatPage
              : <HomeContent reviews={homeReviews} excerpts={homeExcerpts} publisherNews={allPublisherNews} events={visibleHomeEvents} occasions={visibleHomeOccasions} catalog={catalog} currentUserType={currentUser.profile.type === "Писатель" ? "writer" : currentUser.profile.type === "Блогер" ? "blogger" : "reader"} onOpenUser={openUserProfile} onCreateEvent={startEventCreation} onEditEvent={startEventEditing} onCreateOccasion={startOccasionCreation} onEditOccasion={startOccasionEditing} onCreateReview={() => startCreating("review")} onCreateExcerpt={() => startCreating("excerpt")} onNavigate={navigateMainView} currentUserName={currentUser.profile.name} currentUser={currentUser} users={visibleUsers} likes={likes} saves={saves} commentCounts={commentCounts} saveCounts={saveCounts} onToggleLike={toggleLike} onToggleSave={toggleSave} onComment={addComment} relationshipFor={relationshipFor} isFollowing={followsUser} onAddFriend={sendFriendRequest} onFollow={followUser} />;

  return (
    <div className={`app-shell ${mobileNavigationOpen ? "mobile-navigation-open" : ""} ${view === "chat" ? "mobile-chat-route" : ""} ${view === "search" || view === "chat" || view === "notifications" || view === "profile" ? "mobile-header-hidden" : ""} ${view === "chat" && currentRoute.overlay?.kind === "chat" && selectedFriend ? "mobile-chat-dialog-active" : ""}`}>
      <div className="mobile-shell-surface">
      {view !== "search" && <BookMeetHeader
        accountName={currentUser.isAdmin ? t("chat.support") : currentUser.profile.name}
        accountCaption={currentUser.isAdmin ? t("admin.title") : t("profile.my")}
        initials={currentUser.initials}
        avatarUrl={currentUser.avatarUrl}
        unreadCount={unreadCount}
        unreadMessages={unreadMessages}
        chatsOpen={view === "chat" || mobileFriendsOpen}
        showMobileChats={view !== "profile"}
        notificationsOpen={notificationsOpen}
        mobileMenuOpen={mobileNavigationOpen}
        onMobileMenuToggle={() => setMobileNavigationOpen((open) => !open)}
        onSearch={openMobileSearch}
        onHome={goHome}
        onBooks={() => navigateMainView("books")}
        onPublishing={() => navigateMainView("publishing")}
        onCommunities={() => navigateMainView("communities")}
        onPartners={() => navigateMainView("partners")}
        onNotifications={() => { setMobileNavigationOpen(false); setMobileFriendsOpen(false); if (window.matchMedia("(max-width: 800px)").matches) navigateMainView("notifications"); else setNotificationsOpen((open) => !open); }}
         onChats={() => { setMobileNavigationOpen(false); setNotificationsOpen(false); navigateMainView("chat"); }}
        onProfile={() => { setProfileAction(null); setProfileEditId(null); openOwnProfile(); }}
        onLogout={logout}
        notificationsMenu={notificationsOpen ? <NotificationsMenu notifications={currentNotifications} users={users} onOpen={openNotification} onClose={() => setNotificationsOpen(false)} onMarkAllRead={() => { setNotifications((current) => current.map((notification) => notification.userId === currentUser.id ? { ...notification, unread: false } : notification)); void apiFetch("/api/notifications/read-all", { method: "PATCH", credentials: "same-origin" }).catch((error) => console.warn(error)); }} /> : null}
      />}

      {view === "search" ? (
        <MobileGlobalSearchPage userId={currentUser.id} initialQuery={mobileSearchQuery} users={visibleUsers} likes={likes} saves={saves} commentCounts={commentCounts} saveCounts={saveCounts} onBack={closeMobileSearch} onOpenResult={openMobileSearchResult} onOpenUser={openUserProfile} onToggleLike={toggleLike} onToggleSave={toggleSave} />
      ) : view === "notifications" ? (
        <NotificationsPage notifications={currentNotifications} users={users} onOpen={openNotification} onMarkAllRead={() => { setNotifications((current) => current.map((notification) => notification.userId === currentUser.id ? { ...notification, unread: false } : notification)); void apiFetch("/api/notifications/read-all", { method: "PATCH", credentials: "same-origin" }).catch((error) => console.warn(error)); }} />
      ) : view === "profile" && !chatExpanded ? (
        currentUser.isAdmin ? <AdminProfile onBack={closeOwnProfile} onLogout={logout} events={events} occasions={occasions} users={users} catalog={catalog} reports={reports} onModerateEvent={moderateEvent} onModerateOccasion={moderateOccasion} onModeratePublisher={moderatePublisher} onOpenChat={openChat} onOpenUser={openUserProfile} onRefresh={() => void refreshBootstrap()} onDeleteMaterial={deleteMaterial} /> : <MyProfile key={`${currentUser.id}-${profileAction ?? "profile"}-${profileEditId ?? "new"}-${newlyRegistered || completionProfileEditing ? "setup" : "ready"}`} onBack={closeOwnProfile} user={currentUser} users={users} catalog={catalog} friends={currentUser.profile.type === "Сообщество" ? currentMembershipUsers : currentFriendUsers} friendRequests={friendRequests} communityMemberships={communityMemberships} follows={follows} events={events} occasions={occasions} likes={likes} saves={saves} commentCounts={commentCounts} saveCounts={saveCounts} initialAction={profileAction} initialEditId={profileEditId} initialEditing={newlyRegistered || completionProfileEditing} onProfileCompleted={async () => { const response = await apiFetch("/api/users/me/profile-complete", { method: "PATCH", credentials: "same-origin" }); if (response.ok) await refreshBootstrap(); setNewlyRegistered(false); setCompletionProfileEditing(false); }} onToggleLike={toggleLike} onToggleSave={toggleSave} onComment={addComment} onEditEvent={startEventEditing} onDeleteEvent={(id) => setEvents((current) => current.filter((item) => item.id !== id))} onEditOccasion={startOccasionEditing} onDeleteOccasion={(id) => setOccasions((current) => current.filter((item) => item.id !== id))} onModerateEvent={moderateEvent} onModerateOccasion={moderateOccasion} onOpenUser={openUserProfile} onOpenChat={openChat} onUserChange={handleUserChange} onHomeViewChange={handleHomeViewChange} onLogout={logout} onAcceptFriend={acceptFriend} onRejectFriend={(id) => rejectFriend(id, "")} onCancelFriendRequest={(id) => { void cancelFriendRequest(id); }} onRemoveFriend={removeFriend} onFollow={(id) => { void followUser(id); }} />
      ) : (
        <WorkspaceScreen
          friends={currentFriends}
          selectedId={selectedFriend?.id ?? null}
          adminMode={Boolean(currentUser.isAdmin)}
          contentHub={["home", "events", "reviews", "publications", "occasions"].includes(view)}
          profileType={currentUser.profile.type}
          onFindFriends={() => navigateMainView("users")}
          onCreateEvent={startEventCreation}
          onCreateReview={() => startCreating("review")}
          onCreatePublication={() => startCreating("excerpt")}
          onCreateOccasion={startOccasionCreation}
          onCreatePublisherNews={startPublisherNewsCreation}
          onSelectFriend={(friend) => openChat(friend.id)}
          onNavigate={navigateMainView}
          activeView={view}
           expandedChat={chatExpanded && chat ? chat : undefined}
           mobileChatPage={view === "chat"}
           mobileFriendsOpen={mobileFriendsOpen}
          onCloseMobileFriends={() => setMobileFriendsOpen(false)}
        >
          <ContentHubControls view={view} profileType={currentUser.profile.type} showSwitch={false} onNavigate={navigateMainView} onEvent={startEventCreation} onReview={() => startCreating("review")} onPublication={() => startCreating("excerpt")} onOccasion={startOccasionCreation} onPublisherNews={startPublisherNewsCreation} />
          {workspaceContent}
        </WorkspaceScreen>
      )}

      {selectedFriend && view !== "chat" && !chatExpanded && (!currentRoute.overlay || currentRoute.overlay.kind === "chat") && <div className={`chat-popup-layer ${mobileFriendsOpen ? "mobile-friends-visible" : ""}`}><div className="chat-popup">{chat}</div></div>}

      {view !== "search" && <MobileBottomNavigation
        activeView={view}
        initials={currentUser.initials}
        avatarUrl={currentUser.avatarUrl}
        unreadCount={unreadCount}
        unreadMessages={unreadMessages}
        chatsOpen={view === "chat" || mobileFriendsOpen}
        notificationsOpen={notificationsOpen}
        createOptions={mobileCreateOptions}
        onHome={goHome}
         onChats={() => { setMobileNavigationOpen(false); setNotificationsOpen(false); navigateMainView("chat"); }}
        onNotifications={() => { setMobileNavigationOpen(false); setMobileFriendsOpen(false); if (window.matchMedia("(max-width: 800px)").matches) navigateMainView("notifications"); else setNotificationsOpen((open) => !open); }}
        onProfile={() => { setProfileAction(null); setProfileEditId(null); openOwnProfile(); }}
      />}
      </div>

      <MobileNavigationDrawer open={mobileNavigationOpen} activeView={view} onClose={() => setMobileNavigationOpen(false)} onNavigate={navigateMainView} createOptions={mobileCreateOptions} />

      {selectedBook && <UnifiedBookModal book={selectedBook} viewer={currentUser} users={visibleUsers} catalog={catalog} events={events} retainWhenInactive onClose={() => setSelectedBook(null)} onEdit={() => { const id = selectedBook.catalogBookId ?? selectedBook.id; setProfileAction("book"); setProfileEditId(id); setSelectedBook(null); setView("profile"); window.history.pushState({}, "", "/profile/library"); }} onDelete={async () => { const id = selectedBook.catalogBookId ?? selectedBook.id; const response = await apiFetch(`/api/books/${id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert(t("book.deleteError")); return; } setUsers((current) => current.map((user) => user.id === currentUser.id ? { ...user, books: user.books.filter((book) => (book.catalogBookId ?? book.id) !== id) } : user)); setSelectedBook(null); }} onReport={currentUser.isAdmin || currentUser.books.some((book) => (book.catalogBookId ?? book.id) === (selectedBook.catalogBookId ?? selectedBook.id)) || selectedBook.creatorUserId === currentUser.id || (currentUser.authorBooks ?? []).some((book) => (book.catalogBookId ?? book.id) === (selectedBook.catalogBookId ?? selectedBook.id)) ? undefined : () => openReportDialog({ kind: "book", id: selectedBook.catalogBookId ?? selectedBook.id })} onOpenUser={openUserProfile} onOpenEvent={(event) => setSelectedEvent(event)} onOpenReview={(review, user) => { setSelectedMaterial({ id: review.id, kind: "review", title: review.bookTitle, author: user.profile.name, text: review.fullText, bodyHtml: review.bodyHtml, linkedBookId: review.bookId, ownerId: user.id, createdAt: review.createdAt, preview: review.preview, bookAuthor: review.bookAuthor, rating: review.rating }); }} />}
      {selectedMaterial && <ReadingModal item={selectedMaterial} currentUser={currentUser} users={visibleUsers} catalog={catalog} likedUserIds={likes[`${selectedMaterial.kind}-${selectedMaterial.id}`] ?? []} saved={Boolean(saves[`${selectedMaterial.kind}-${selectedMaterial.id}`]?.includes(currentUser.id))} savesCount={saveCounts[`${selectedMaterial.kind}-${selectedMaterial.id}`] ?? 0} onToggleLike={() => toggleLike(selectedMaterial)} onToggleSave={() => toggleSave(selectedMaterial)} onComment={(text) => addComment(selectedMaterial, text)} onOpenUser={openUserProfile} onClose={() => setSelectedMaterial(null)} onReport={selectedMaterial.ownerId !== currentUser.id && !currentUser.isAdmin ? () => openReportDialog({ kind: selectedMaterial.kind, id: selectedMaterial.id }) : undefined} onEdit={currentUser.isAdmin || selectedMaterial.ownerId === currentUser.id ? () => void editReadingMaterial(selectedMaterial, currentUser) : undefined} onDelete={currentUser.isAdmin || selectedMaterial.ownerId === currentUser.id ? () => void deleteReadingMaterial(selectedMaterial, currentUser) : undefined} />}
      {adminEditingMaterial && <AdminCatalogEditor item={adminEditingMaterial} users={users} catalog={catalog} onClose={() => setAdminEditingMaterial(null)} onSave={async (payload) => { const response = await apiFetch(`/api/admin/materials/${adminEditingMaterial.kind}/${adminEditingMaterial.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const data = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) { window.alert(localizedApiError(data.error, t("common.saveChangesError"))); return; } setAdminEditingMaterial(null); await refreshBootstrap(); }} />}
      {detailNotification && <NotificationDetail notification={detailNotification} actor={users.find((user) => user.id === detailNotification.actorId)} isFollowing={follows.some((follow) => follow.followerId === currentUser.id && follow.targetId === detailNotification.actorId)} onClose={() => setDetailNotification(null)} onFollow={() => followUser(detailNotification.actorId)} />}
      {quickMaterialAction === "review" && <ReviewEditor review={quickMaterialEditId ? currentUser.reviews.find((item) => item.id === quickMaterialEditId) : null} catalog={catalog} onClose={() => { setQuickMaterialAction(null); setQuickMaterialEditId(null); closeMobileWorkflow("/reviews"); }} onSave={async (review) => { const response = await apiFetch(quickMaterialEditId ? `/api/reviews/${quickMaterialEditId}` : "/api/reviews", { method: quickMaterialEditId ? "PATCH" : "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(review) }); const data = await response.json().catch(() => ({})) as { id?: number; bookTitle?: string; bookAuthor?: string; error?: string }; if (!response.ok) throw new Error(localizedApiError(data.error, t("common.saveChangesError"))); const saved = { ...review, id: data.id ?? review.id, bookTitle: data.bookTitle ?? review.bookTitle, bookAuthor: data.bookAuthor ?? review.bookAuthor }; setData((current) => current ? { ...current, users: current.users.map((item) => item.id === currentUser.id ? { ...item, reviews: item.reviews.some((entry) => entry.id === review.id) ? item.reviews.map((entry) => entry.id === review.id ? saved : entry) : [saved, ...item.reviews] } : item) } : current); setQuickMaterialAction(null); setQuickMaterialEditId(null); closeMobileWorkflow("/reviews"); }} />}
      {quickMaterialAction === "excerpt" && <PublicationEditor excerpt={quickMaterialEditId ? (currentUser.excerpts ?? []).find((item) => item.id === quickMaterialEditId) : null} catalog={catalog} onClose={() => { setQuickMaterialAction(null); setQuickMaterialEditId(null); closeMobileWorkflow("/blog"); }} onSave={async (excerpt) => { const response = await apiFetch(quickMaterialEditId ? `/api/excerpts/${quickMaterialEditId}` : "/api/excerpts", { method: quickMaterialEditId ? "PATCH" : "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(excerpt) }); const data = await response.json().catch(() => ({})) as { id?: number; bookTitle?: string; bookIds?: number[]; error?: string }; if (!response.ok) throw new Error(localizedApiError(data.error, t("common.saveChangesError"))); const saved = { ...excerpt, id: data.id ?? excerpt.id, bookTitle: data.bookTitle ?? excerpt.bookTitle, bookIds: data.bookIds ?? excerpt.bookIds }; setData((current) => current ? { ...current, users: current.users.map((item) => item.id === currentUser.id ? { ...item, excerpts: (item.excerpts ?? []).some((entry) => entry.id === excerpt.id) ? (item.excerpts ?? []).map((entry) => entry.id === excerpt.id ? saved : entry) : [saved, ...(item.excerpts ?? [])] } : item) } : current); setQuickMaterialAction(null); setQuickMaterialEditId(null); closeMobileWorkflow("/blog"); }} />}
      {eventFormOpen && <div className="modal-backdrop workflow-page-backdrop" onMouseDown={() => { setEventFormOpen(false); closeMobileWorkflow("/events"); }}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm catalog={catalog} onCreateBook={() => { setEventFormOpen(false); closeMobileWorkflow("/events"); startCreating("book"); }} onCancel={() => { setEventFormOpen(false); closeMobileWorkflow("/events"); }} onSave={createEvent} /></section></div>}
      {editingEvent && <div className="modal-backdrop workflow-page-backdrop" onMouseDown={() => { setEditingEvent(null); closeMobileWorkflow("/events"); }}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm initial={editingEvent} catalog={catalog} onCreateBook={() => { setEditingEvent(null); closeMobileWorkflow("/events"); startCreating("book"); }} submitLabel={t("moderation.resubmit")} onCancel={() => { setEditingEvent(null); closeMobileWorkflow("/events"); }} onSave={resubmitEvent} /></section></div>}
      {selectedEvent && <EventModal item={selectedEvent} users={visibleUsers} currentUserId={currentUser.id} currentUser={currentUser} onOpenUser={openUserProfile} onReport={selectedEvent.creatorId !== currentUser.id && !currentUser.isAdmin ? () => openReportDialog({ kind: "event", id: selectedEvent.id }) : undefined} onOpenBook={(bookId) => {
        setSelectedBook(catalog.find((book) => book.id === (bookId ?? selectedEvent.linkedBookId)) ?? null);
      }} onClose={() => setSelectedEvent(null)} />}
      {occasionFormOpen && <div className="modal-backdrop workflow-page-backdrop" onMouseDown={() => { setOccasionFormOpen(false); closeMobileWorkflow("/meet"); }}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm catalog={catalog} onCancel={() => { setOccasionFormOpen(false); closeMobileWorkflow("/meet"); }} onSave={createOccasion} /></section></div>}
      {editingOccasion && <div className="modal-backdrop workflow-page-backdrop" onMouseDown={() => { setEditingOccasion(null); closeMobileWorkflow("/meet"); }}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm initial={editingOccasion} catalog={catalog} submitLabel={t("moderation.resubmit")} onCancel={() => { setEditingOccasion(null); closeMobileWorkflow("/meet"); }} onSave={resubmitOccasion} /></section></div>}
      {selectedOccasion && <OccasionModal item={selectedOccasion} currentUser={currentUser} users={visibleUsers} onReport={selectedOccasion.creatorId !== currentUser.id && !currentUser.isAdmin ? () => openReportDialog({ kind: "occasion", id: selectedOccasion.id }) : undefined} onOpenUser={openUserProfile} onOpenBook={(bookId) => { setSelectedBook(catalog.find((book) => book.id === bookId) ?? null); }} onClose={() => setSelectedOccasion(null)} />}
      {selectedPublisherNews && <PublisherNewsModal item={selectedPublisherNews} owner={visibleUsers.find((user) => user.id === selectedPublisherNews.ownerId)} currentUser={currentUser} users={visibleUsers} catalog={catalog} onOpenUser={openUserProfile} onClose={() => setSelectedPublisherNews(null)} onReport={selectedPublisherNews.ownerId !== currentUser.id && !currentUser.isAdmin ? () => openReportDialog({ kind: "publisher_news", id: selectedPublisherNews.id }) : undefined} />}
      {roleRestrictionNotice && <div className="modal-backdrop" onMouseDown={() => setRoleRestrictionNotice(null)}><section className="simple-warning-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>{roleRestrictionNotice === "review" ? t("restriction.reviewRoles") : roleRestrictionNotice === "excerpt" ? t("restriction.publicationRoles") : roleRestrictionNotice === "occasion" ? t("restriction.organizationOccasion") : t("restriction.organizationPending")}</h2><button className="primary-button" type="button" autoFocus onClick={() => setRoleRestrictionNotice(null)}>{t("common.close")}</button></section></div>}
      {profileUser && profileUser.id !== currentUser.id && <UserProfileModal user={profileUser} viewer={currentUser} users={visibleUsers} catalog={catalog} profileFriends={profileUser.profile.type === "Сообщество" ? profileMemberUsers : profileFriendUsers} profileFollowers={profileFollowerUsers} profileCommunities={profileCommunityUsers} events={events} occasions={occasions} likes={likes} friendCount={profileUser.profile.type === "Сообщество" ? profileUser.memberCount : profileUser.friendCount} followerCount={profileUser.followerCount} relationship={relationshipToProfile} incomingMessage={friendRequests.find((request) => request.status === "pending" && request.fromId === profileUser.id && request.toId === currentUser.id)?.message} isFollowing={(currentUser.profile.type === "Издатель" || profileUser.profile.type === "Издатель" ? false : isFriendPair(currentUser.id, profileUser.id)) || follows.some((follow) => follow.followerId === currentUser.id && follow.targetId === profileUser.id)} canMessage={Boolean(currentUser.isAdmin || profileUser.isAdmin || currentUser.profile.type === "Издатель" || profileUser.profile.type === "Издатель")} blockedByMe={Boolean(profileUser.blockedByMe || currentUser.isAdmin && profileUser.suspension)} onClose={() => setProfileUserId(null)} onAddFriend={(message) => sendFriendRequest(profileUser.id, message)} onCancelFriendRequest={() => cancelFriendRequest(profileUser.id)} onAccept={() => acceptFriend(profileUser.id)} onReject={(comment) => rejectFriend(profileUser.id, comment)} onRemoveFriend={() => removeFriend(profileUser.id)} onOpenChat={() => openChat(profileUser.id)} onFollow={() => followUser(profileUser.id)} onUnfollow={() => unfollowUser(profileUser.id)} onBlock={() => blockUser(profileUser.id)} onUnblock={() => unblockUser(profileUser.id)} onReport={currentUser.isAdmin ? undefined : () => openReportDialog({ kind: "user", id: profileUser.id })} onToggleLike={toggleLike} onComment={addComment} onOpenUser={openUserProfile} />}
      {blockedProfileNotice && <div className="nested-modal-backdrop" onMouseDown={() => setBlockedProfileNotice(false)}><section className="confirm-social-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>{t("social.blockedNotice")}</h2><button className="primary-button" type="button" autoFocus onClick={() => setBlockedProfileNotice(false)}>{t("common.ok")}</button></section></div>}
      {adultRestrictionNotice && <div className="nested-modal-backdrop"><section className="adult-restriction-modal" role="alertdialog" aria-modal="true" aria-labelledby="adult-restriction-title"><span className="adult-restriction-mark" aria-hidden="true">18+</span><h2 id="adult-restriction-title">{t("content.adultRestriction")}</h2>{adultRestrictionNotice === "missing" && <p>{t("content.birthDateRequired")}</p>}<div className="form-actions">{adultRestrictionNotice === "missing" ? <><button className="primary-button" type="button" onClick={() => leaveRestrictedMaterial(true)}>{t("event.goProfile")}</button><button className="outline-button" type="button" onClick={() => leaveRestrictedMaterial(false)}>{t("common.logout")}</button></> : <button className="primary-button" type="button" autoFocus onClick={() => leaveRestrictedMaterial(false)}>{t("common.ok")}</button>}</div></section></div>}
      {catalogBookToAdd && <BookEditor book={catalogBookToAdd} catalog={catalog} top3Count={currentUser.books.filter((item) => item.topRank).length} onClose={() => setCatalogBookToAdd(null)} onSave={(book) => void saveCatalogBookToLibrary(book)} />}
      {materialShareAttachment && <MaterialSharePicker attachment={materialShareAttachment} recipients={currentFriendUsers} onClose={() => setMaterialShareAttachment(null)} onSend={shareMaterial} />}
      {accessGate && (accessGate.pendingLegalDocuments.length > 0 || newlyRegistered && !accessGate.profileComplete || completionNotice && !accessGate.profileComplete) && <ComplianceAccessGate gate={accessGate} registrationFlow={newlyRegistered} onDismiss={() => setCompletionNotice(false)} onAccepted={async () => { await refreshBootstrap(); }} onOpenProfile={() => { setCompletionNotice(false); setCompletionProfileEditing(true); setProfileAction(null); setProfileEditId(null); setView("profile"); window.history.replaceState({}, "", "/profile"); }} />}
      <SafetyCenter onChanged={() => void refreshBootstrap()} />
    </div>
  );
}
