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
  | "profile";

export type RoutableMainView = Exclude<MainView, "profile">;
export type OverlayRouteKind = "user" | "book" | "event" | "review" | "excerpt" | "occasion" | "chat" | "notification" | "report";
export type ParsedAppRoute = { view: MainView; overlay?: { kind: OverlayRouteKind; id: number } };
export type ChatRouteState = {
  bookMeetChat?: boolean;
  backgroundPath?: string;
  chatMode?: "compact" | "expanded";
};

export type OverlayHistoryState = {
  bookMeetOverlay?: boolean;
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
  if (/^\/chat\/\d+$/.test(normalized)) return "chat";
  return "home";
}

export function appRouteFromPathname(pathname: string): ParsedAppRoute {
  const normalized = normalizedPathname(pathname);
  if (normalized === "/profile" || normalized === "/profile/settings" || Object.values(profileTabPaths).includes(normalized as typeof profileTabPaths[RoutableProfileTab])) return { view: "profile" };
  const dynamicRoutes: Array<{ pattern: RegExp; kind: OverlayRouteKind; view: RoutableMainView }> = [
    { pattern: /^\/users\/(\d+)$/, kind: "user", view: "users" },
    { pattern: /^\/books\/(\d+)$/, kind: "book", view: "home" },
    { pattern: /^\/events\/(\d+)$/, kind: "event", view: "events" },
    { pattern: /^\/reviews\/(\d+)$/, kind: "review", view: "reviews" },
    { pattern: /^\/blog\/(\d+)$/, kind: "excerpt", view: "publications" },
    { pattern: /^\/meet\/(\d+)$/, kind: "occasion", view: "occasions" },
    { pattern: /^\/chat\/(\d+)$/, kind: "chat", view: "chat" },
    { pattern: /^\/notifications\/(\d+)$/, kind: "notification", view: "home" },
    { pattern: /^\/reports\/[a-z_-]+\/(\d+)$/, kind: "report", view: "home" },
  ];
  for (const route of dynamicRoutes) {
    const match = normalized.match(route.pattern);
    if (match) return { view: route.view, overlay: { kind: route.kind, id: Number(match[1]) } };
  }
  return { view: mainViewFromPathname(normalized) };
}

export function reportTargetFromPathname(pathname: string) {
  const match = normalizedPathname(pathname).match(/^\/reports\/(user|book|review|excerpt|event|occasion|publisher_news|chat|comment)\/(\d+)$/);
  return match ? { kind: match[1] as "user" | "book" | "review" | "excerpt" | "event" | "occasion" | "publisher_news" | "chat" | "comment", id: Number(match[2]) } : null;
}

export function initialMainView(): MainView {
  return typeof window === "undefined" ? "home" : appRouteFromPathname(window.location.pathname).view;
}

export function notifyAppNavigation() {
  window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT));
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

export function useRoutedPopup(routePath: string, fallbackPath: string, onClose: () => void, title: string) {
  const onCloseRef = useRef(onClose);
  const normalizedRoute = normalizedPathname(routePath);
  const [active, setActive] = useState(() => typeof window !== "undefined" && normalizedPathname(window.location.pathname) === normalizedRoute);
  const wasActiveRef = useRef(active);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    openOverlayRoute(normalizedRoute);
    const syncActive = () => {
      const matches = normalizedPathname(window.location.pathname) === normalizedRoute;
      wasActiveRef.current = matches;
      setActive(matches);
      if (matches) document.title = title;
    };
    const closeAfterHistoryNavigation = () => {
      const matches = normalizedPathname(window.location.pathname) === normalizedRoute;
      const shouldClose = wasActiveRef.current && !matches;
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
  }, [normalizedRoute, title]);

  return { active, close: () => closeOverlayRoute(normalizedRoute, fallbackPath) };
}
