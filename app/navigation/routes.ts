import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "../i18n/messages";
import type { Translate } from "../i18n";

export type MainView =
  | "home"
  | "reviews"
  | "publications"
  | "events"
  | "occasions"
  | "users"
  | "publishing"
  | "books"
  | "communities"
  | "partners"
  | "chat"
  | "liked"
  | "saved"
  | "notifications"
  | "profile"
  | "search";

// Search is a mobile-only nested screen, never a desktop main-navigation view.
export type RoutableMainView = Exclude<MainView, "profile" | "search">;
export type OverlayRouteKind = "user" | "book" | "event" | "review" | "excerpt" | "occasion" | "publisher-news" | "chat" | "notification" | "report";
export type MobileWorkflowKind = "review" | "excerpt" | "event" | "occasion" | "book" | "book-status" | "publisher-news";
export type MobileWorkflowRoute = { mode: "create" | "edit"; kind: MobileWorkflowKind; id?: number };
export type ParsedAppRoute = { view: MainView; overlay?: { kind: OverlayRouteKind; id: number }; workflow?: MobileWorkflowRoute };
export type ChatRouteState = {
  bookMeetChat?: boolean;
  backgroundPath?: string;
  chatMode?: "compact" | "expanded";
};

export type OverlayHistoryState = {
  bookMeetOverlay?: boolean;
  backgroundPath?: string;
};

export type MobileSearchRouteState = {
  bookMeetSearch?: boolean;
  backgroundPath?: string;
};

export type MobileWorkflowRouteState = {
  bookMeetWorkflow?: boolean;
  backgroundPath?: string;
};

export type MobileProfileSocialRoute = "followers" | "following" | "friends" | "incoming" | "outgoing";

export type MobileProfileSocialRouteState = {
  bookMeetProfileSocial?: boolean;
  backgroundPath?: string;
};

export const APP_NAVIGATION_EVENT = "bookmeet:navigation";

export const mainViewPaths: Record<RoutableMainView, string> = {
  home: "/",
  users: "/users",
  publishing: "/publishing",
  books: "/books",
  communities: "/communities",
  partners: "/partners",
  events: "/events",
  reviews: "/reviews",
  publications: "/blog",
  occasions: "/meet",
  chat: "/chat",
  liked: "/liked",
  saved: "/saved",
  notifications: "/notifications",
};

export const mainViewTitleKeys: Record<RoutableMainView, MessageKey> = {
  home: "nav.homeTagline",
  users: "directory.users",
  publishing: "nav.publishing",
  books: "nav.books",
  communities: "nav.communities",
  partners: "nav.partners",
  events: "content.bookEvents",
  reviews: "content.reviews",
  publications: "content.publications",
  occasions: "content.occasions",
  chat: "header.chats",
  liked: "feed.liked",
  saved: "feed.saved",
  notifications: "notifications.title",
};

export function mainViewTitle(view: RoutableMainView, t: Translate) {
  return view === "home" ? `Book Meet — ${t(mainViewTitleKeys.home)}` : `${t(mainViewTitleKeys[view])} — Book Meet`;
}

export const profileTabPaths = {
  main: "/profile",
  "author-books": "/profile/books",
  excerpts: "/profile/blog",
  "publisher-news": "/profile/news",
  library: "/profile/library",
  wishlist: "/profile/wishlist",
  communities: "/profile/communities",
  reviews: "/profile/reviews",
  events: "/profile/events",
  occasions: "/profile/occasions",
  friends: "/profile/friends",
  admin: "/profile/admin",
} as const;

export const mobileProfileSocialPaths: Record<MobileProfileSocialRoute, string> = {
  followers: "/profile/followers",
  following: "/profile/following",
  friends: "/profile/friends",
  incoming: "/profile/friends/incoming",
  outgoing: "/profile/friends/outgoing",
};

export function mobileProfileSocialRouteFromPathname(pathname: string): MobileProfileSocialRoute | null {
  const normalized = normalizedPathname(pathname);
  const entry = Object.entries(mobileProfileSocialPaths).find(([, path]) => path === normalized);
  return entry ? entry[0] as MobileProfileSocialRoute : null;
}

export type RoutableProfileTab = keyof typeof profileTabPaths;

export function profileTabFromPathname(pathname: string): RoutableProfileTab {
  const normalized = normalizedPathname(pathname);
  const entry = Object.entries(profileTabPaths).find(([, path]) => path === normalized);
  return entry && !["friends", "excerpts", "reviews", "events", "occasions"].includes(entry[0]) ? entry[0] as RoutableProfileTab : "main";
}

export function normalizedPathname(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

export function mainViewFromPathname(pathname: string): RoutableMainView {
  const normalized = normalizedPathname(pathname);
  const entry = Object.entries(mainViewPaths).find(([, path]) => path === normalized);
  if (entry) return entry[0] as RoutableMainView;
  if (/^\/users\/\d+$/.test(normalized)) return "users";
  if (/^\/events\/\d+$/.test(normalized)) return "events";
  if (/^\/reviews\/\d+$/.test(normalized)) return "reviews";
  if (/^\/blog\/\d+$/.test(normalized)) return "publications";
  if (/^\/meet\/\d+$/.test(normalized)) return "occasions";
  if (/^\/publishing\/\d+$/.test(normalized)) return "publishing";
  if (/^\/chat\/\d+$/.test(normalized)) return "chat";
  if (/^\/(?:create|edit)\/(?:review|publication|event|occasion|book|book-status|news)(?:\/\d+)?$/.test(normalized)) return "home";
  return "home";
}

export function appRouteFromPathname(pathname: string): ParsedAppRoute {
  const normalized = normalizedPathname(pathname);
  if (normalized === "/search") return { view: "search" };
  const workflowMatch = normalized.match(/^\/(create|edit)\/(review|publication|event|occasion|book|book-status|news)(?:\/(\d+))?$/);
  if (workflowMatch) {
    const mode = workflowMatch[1] as MobileWorkflowRoute["mode"];
    const routeKind = workflowMatch[2];
    const kind: MobileWorkflowKind = routeKind === "publication" ? "excerpt" : routeKind === "news" ? "publisher-news" : routeKind as MobileWorkflowKind;
    const id = workflowMatch[3] ? Number(workflowMatch[3]) : undefined;
    if ((mode === "create" && !id && kind !== "book-status") || (mode === "edit" && id)) {
      return { view: ["book", "book-status", "publisher-news"].includes(kind) ? "profile" : kind === "excerpt" ? "publications" : kind === "occasion" ? "occasions" : kind === "event" ? "events" : "reviews", workflow: { mode, kind, id } };
    }
  }
  if (normalized === "/profile" || normalized === "/profile/settings" || mobileProfileSocialRouteFromPathname(normalized) || Object.values(profileTabPaths).includes(normalized as typeof profileTabPaths[RoutableProfileTab])) return { view: "profile" };
  const dynamicRoutes: Array<{ pattern: RegExp; kind: OverlayRouteKind; view: RoutableMainView }> = [
    { pattern: /^\/users\/(\d+)$/, kind: "user", view: "users" },
    { pattern: /^\/books\/(\d+)$/, kind: "book", view: "home" },
    { pattern: /^\/events\/(\d+)$/, kind: "event", view: "events" },
    { pattern: /^\/reviews\/(\d+)$/, kind: "review", view: "reviews" },
    { pattern: /^\/blog\/(\d+)$/, kind: "excerpt", view: "publications" },
    { pattern: /^\/meet\/(\d+)$/, kind: "occasion", view: "occasions" },
    { pattern: /^\/publishing\/(\d+)$/, kind: "publisher-news", view: "publishing" },
    { pattern: /^\/chat\/(\d+)$/, kind: "chat", view: "chat" },
    { pattern: /^\/notifications\/(\d+)$/, kind: "notification", view: "notifications" },
    { pattern: /^\/reports\/[a-z_-]+\/(\d+)$/, kind: "report", view: "home" },
  ];
  for (const route of dynamicRoutes) {
    const match = normalized.match(route.pattern);
    if (match) return { view: route.view, overlay: { kind: route.kind, id: Number(match[1]) } };
  }
  return { view: mainViewFromPathname(normalized) };
}

export function mobileWorkflowPath(workflow: MobileWorkflowRoute) {
  const routeKind = workflow.kind === "excerpt" ? "publication" : workflow.kind === "publisher-news" ? "news" : workflow.kind;
  return `/${workflow.mode}/${routeKind}${workflow.id ? `/${workflow.id}` : ""}`;
}

export function openMobileWorkflowRoute(workflow: MobileWorkflowRoute) {
  if (window.matchMedia("(min-width: 801px)").matches) return false;
  const nextPath = mobileWorkflowPath(workflow);
  if (normalizedPathname(window.location.pathname) === nextPath) return true;
  const backgroundPath = `${window.location.pathname}${window.location.search}`;
  window.history.pushState({ bookMeetWorkflow: true, backgroundPath } satisfies MobileWorkflowRouteState, "", nextPath);
  notifyAppNavigation();
  return true;
}

export function closeActiveMobileWorkflow(fallbackPath: string) {
  if (!appRouteFromPathname(window.location.pathname).workflow) return false;
  const state = window.history.state as MobileWorkflowRouteState | null;
  if (state?.bookMeetWorkflow && state.backgroundPath) window.history.back();
  else {
    const fallbackRoute = appRouteFromPathname(fallbackPath);
    window.history.replaceState({ bookMeetView: fallbackRoute.view }, "", fallbackPath);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }
  return true;
}

export function reportTargetFromPathname(pathname: string) {
  const match = normalizedPathname(pathname).match(/^\/reports\/(user|book|review|excerpt|event|occasion|publisher_news|chat|comment)\/(\d+)$/);
  return match ? { kind: match[1] as "user" | "book" | "review" | "excerpt" | "event" | "occasion" | "publisher_news" | "chat" | "comment", id: Number(match[2]) } : null;
}

export function initialMainView(): MainView {
  if (typeof window === "undefined") return "home";
  const route = appRouteFromPathname(window.location.pathname);
  return route.view === "search" && window.matchMedia("(min-width: 801px)").matches ? "home" : route.view;
}

export function notifyAppNavigation() {
  window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT));
}

type RouteLeaveGuard = { path: string; confirm: () => boolean };
const routeLeaveGuards: RouteLeaveGuard[] = [];
const releasedGuardPaths = new Set<string>();

export function registerRouteLeaveGuard(guard: RouteLeaveGuard) {
  releasedGuardPaths.delete(guard.path);
  routeLeaveGuards.push(guard);
  if (normalizedPathname(window.location.pathname) === normalizedPathname(guard.path) && (window.history.state as { bookMeetDraftGuard?: string } | null)?.bookMeetDraftGuard !== guard.path) {
    window.history.pushState({ ...(window.history.state ?? {}), bookMeetDraftGuard: guard.path }, "", guard.path);
  }
  return () => {
    const index = routeLeaveGuards.lastIndexOf(guard);
    if (index >= 0) routeLeaveGuards.splice(index, 1);
    const state = window.history.state as { bookMeetDraftGuard?: string } | null;
    if (!routeLeaveGuards.some((item) => item.path === guard.path) && state?.bookMeetDraftGuard === guard.path && normalizedPathname(window.location.pathname) === normalizedPathname(guard.path)) releasedGuardPaths.add(guard.path);
  };
}

function handleGuardedSameRouteNavigation(routePath: string) {
  const guard = [...routeLeaveGuards].reverse().find((item) => normalizedPathname(item.path) === routePath);
  if (!guard && releasedGuardPaths.delete(routePath)) {
    window.history.back();
    return true;
  }
  if (!guard || (window.history.state as { bookMeetDraftGuard?: string } | null)?.bookMeetDraftGuard === guard.path) return false;
  if (guard.confirm()) window.history.back();
  else window.history.forward();
  return true;
}

export function restoreGuardedRouteAfterNavigation() {
  const blocked = [...routeLeaveGuards].reverse().find((guard) => !guard.confirm());
  if (!blocked) return false;
  // registerRouteLeaveGuard places a same-URL sentinel in front of the real
  // background entry. Moving forward restores it without dispatching another
  // application navigation that could unmount the draft-holding component.
  window.history.forward();
  return true;
}

export function openOverlayRoute(routePath: string) {
  const normalizedRoute = normalizedPathname(routePath);
  const currentPath = normalizedPathname(window.location.pathname);
  if (currentPath === normalizedRoute) return;
  window.history.pushState({ bookMeetOverlay: true, backgroundPath: currentPath } satisfies OverlayHistoryState, "", normalizedRoute);
  notifyAppNavigation();
}

export function closeOverlayRoute(routePath: string, fallbackPath: string) {
  const currentPath = normalizedPathname(window.location.pathname);
  const state = window.history.state as OverlayHistoryState | null;
  if (currentPath === normalizedPathname(routePath) && state?.bookMeetOverlay && state.backgroundPath) {
    window.history.back();
    return;
  }
  window.history.replaceState({ bookMeetView: mainViewFromPathname(fallbackPath) }, "", fallbackPath);
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
}

export function useCurrentAppRoute() {
  const [route, setRoute] = useState(() => typeof window === "undefined" ? appRouteFromPathname("/") : appRouteFromPathname(window.location.pathname));
  useEffect(() => {
    const update = () => setRoute(appRouteFromPathname(window.location.pathname));
    window.addEventListener("popstate", update);
    window.addEventListener(APP_NAVIGATION_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(APP_NAVIGATION_EVENT, update);
    };
  }, []);
  return route;
}

export function useRoutedPopup(routePath: string, fallbackPath: string, onClose: () => void, title: string, enabled = true) {
  const onCloseRef = useRef(onClose);
  const normalizedRoute = normalizedPathname(routePath);
  const [active, setActive] = useState(() => !enabled || typeof window !== "undefined" && normalizedPathname(window.location.pathname) === normalizedRoute);
  const wasActiveRef = useRef(active);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!enabled) {
      wasActiveRef.current = false;
      setActive(true);
      return;
    }
    openOverlayRoute(normalizedRoute);
    const syncActive = () => {
      const matches = normalizedPathname(window.location.pathname) === normalizedRoute;
      wasActiveRef.current = matches;
      setActive(matches);
      if (matches) document.title = title;
    };
    const closeAfterHistoryNavigation = () => {
      const matches = normalizedPathname(window.location.pathname) === normalizedRoute;
      if (matches && handleGuardedSameRouteNavigation(normalizedRoute)) {
        wasActiveRef.current = true;
        setActive(true);
        return;
      }
      const shouldClose = wasActiveRef.current && !matches;
      // Child popup effects can receive popstate before the application-level
      // route restorer. Give the shared draft guard the first chance to put
      // the route back before local state is cleared and the popup unmounts.
      if (shouldClose && restoreGuardedRouteAfterNavigation()) {
        wasActiveRef.current = true;
        setActive(true);
        return;
      }
      wasActiveRef.current = matches;
      setActive(matches);
      if (matches) document.title = title;
      else if (shouldClose) onCloseRef.current();
    };
    syncActive();
    window.addEventListener(APP_NAVIGATION_EVENT, syncActive);
    window.addEventListener("popstate", closeAfterHistoryNavigation);
    return () => {
      window.removeEventListener(APP_NAVIGATION_EVENT, syncActive);
      window.removeEventListener("popstate", closeAfterHistoryNavigation);
    };
  }, [enabled, normalizedRoute, title]);

  return { active, close: () => enabled ? closeOverlayRoute(normalizedRoute, fallbackPath) : onCloseRef.current() };
}
