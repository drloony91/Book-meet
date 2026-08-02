import { useEffect, useRef } from "react";

export type MainView =
  | "home"
  | "reviews"
  | "publications"
  | "events"
  | "occasions"
  | "users"
  | "publishing"
  | "chat"
  | "profile";

export type RoutableMainView = Exclude<MainView, "profile">;
export type OverlayRouteKind = "user" | "book" | "event" | "review" | "excerpt" | "occasion" | "chat";
export type ParsedAppRoute = { view: MainView; overlay?: { kind: OverlayRouteKind; id: number } };
export type ChatRouteState = {
  bookMeetChat?: boolean;
  backgroundPath?: string;
  chatMode?: "compact" | "expanded";
};

export const mainViewPaths: Record<RoutableMainView, string> = {
  home: "/",
  users: "/users",
  publishing: "/publishing",
  events: "/events",
  reviews: "/reviews",
  publications: "/blog",
  occasions: "/meet",
  chat: "/chat",
};

export const mainViewTitles: Record<RoutableMainView, string> = {
  home: "Book Meet — встречаемся благодаря книгам",
  users: "Пользователи — Book Meet",
  publishing: "Новинки издательств — Book Meet",
  events: "Книжные события — Book Meet",
  reviews: "Рецензии — Book Meet",
  publications: "Публикации — Book Meet",
  occasions: "Поводы познакомиться — Book Meet",
  chat: "Диалоги — Book Meet",
};

export const profileTabPaths = {
  main: "/profile",
  "author-books": "/profile/books",
  excerpts: "/profile/blog",
  "publisher-news": "/profile/news",
  library: "/profile/library",
  wishlist: "/profile/wishlist",
  reviews: "/profile/reviews",
  events: "/profile/events",
  friends: "/profile/friends",
  settings: "/profile/settings",
  admin: "/profile/admin",
} as const;

export type RoutableProfileTab = keyof typeof profileTabPaths;

export function profileTabFromPathname(pathname: string): RoutableProfileTab {
  const normalized = normalizedPathname(pathname);
  const entry = Object.entries(profileTabPaths).find(([, path]) => path === normalized);
  return entry ? entry[0] as RoutableProfileTab : "main";
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
  if (normalized === "/profile" || Object.values(profileTabPaths).includes(normalized as typeof profileTabPaths[RoutableProfileTab])) return { view: "profile" };
  const dynamicRoutes: Array<{ pattern: RegExp; kind: OverlayRouteKind; view: RoutableMainView }> = [
    { pattern: /^\/users\/(\d+)$/, kind: "user", view: "users" },
    { pattern: /^\/books\/(\d+)$/, kind: "book", view: "home" },
    { pattern: /^\/events\/(\d+)$/, kind: "event", view: "events" },
    { pattern: /^\/reviews\/(\d+)$/, kind: "review", view: "reviews" },
    { pattern: /^\/blog\/(\d+)$/, kind: "excerpt", view: "publications" },
    { pattern: /^\/meet\/(\d+)$/, kind: "occasion", view: "occasions" },
    { pattern: /^\/chat\/(\d+)$/, kind: "chat", view: "chat" },
  ];
  for (const route of dynamicRoutes) {
    const match = normalized.match(route.pattern);
    if (match) return { view: route.view, overlay: { kind: route.kind, id: Number(match[1]) } };
  }
  return { view: mainViewFromPathname(normalized) };
}

export function initialMainView(): MainView {
  return typeof window === "undefined" ? "home" : appRouteFromPathname(window.location.pathname).view;
}

export function useRoutedPopup(routePath: string, fallbackPath: string, onClose: () => void, title: string) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const normalizedRoute = normalizedPathname(routePath);
    const currentPath = normalizedPathname(window.location.pathname);
    if (currentPath !== normalizedRoute) {
      window.history.pushState({ bookMeetOverlay: true, backgroundPath: currentPath }, "", normalizedRoute);
    }
    document.title = title;
    const closeAfterHistoryNavigation = () => {
      if (normalizedPathname(window.location.pathname) !== normalizedRoute) onCloseRef.current();
      else document.title = title;
    };
    window.addEventListener("popstate", closeAfterHistoryNavigation);
    return () => window.removeEventListener("popstate", closeAfterHistoryNavigation);
  }, [routePath, title]);

  return () => {
    const state = window.history.state as { bookMeetOverlay?: boolean; backgroundPath?: string } | null;
    if (normalizedPathname(window.location.pathname) === normalizedPathname(routePath) && state?.bookMeetOverlay && state.backgroundPath) {
      window.history.back();
      return;
    }
    window.history.replaceState({ bookMeetView: mainViewFromPathname(fallbackPath) }, "", fallbackPath);
    onCloseRef.current();
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  };
}
