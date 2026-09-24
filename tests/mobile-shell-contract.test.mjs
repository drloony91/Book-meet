import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("mobile shell keeps the shared navigation contract and isolates desktop", async () => {
  const [layout, controller, css, messages, localeSwitcher, routes, notifications, homeAsset, logoAsset] = await Promise.all([
    readFile(path.join(root, "app", "components", "layout", "AppLayout.tsx"), "utf8"),
    readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app", "globals.css"), "utf8"),
    readFile(path.join(root, "app", "i18n", "messages.ts"), "utf8"),
    readFile(path.join(root, "app", "i18n", "LocaleSwitcher.tsx"), "utf8"),
    readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8"),
    readFile(path.join(root, "app", "components", "notifications", "Notifications.tsx"), "utf8"),
    readFile(path.join(root, "public", "mobile-icons", "home.png")),
    readFile(path.join(root, "public", "book-meet-brand-v4.png")),
  ]);

  assert.match(layout, /mobile-menu-toggle/);
  assert.match(layout, /mobile-search-button/);
  assert.match(layout, /mobile-navigation-drawer/);
  assert.match(layout, /mobile-bottom-navigation/);
  for (const view of ["home", "events", "reviews", "occasions", "books", "publishing", "users", "communities", "liked", "saved"]) {
    assert.match(layout, new RegExp(`view: "${view}"`));
  }
  assert.doesNotMatch(layout, /mobile-account-menu/);
  assert.match(layout, /mobile-icons\/home\.png/);
  assert.match(layout, /desktop-icons\/chat\.png/);
  assert.match(layout, /desktop-icons\/bell(?:-active)?\.png/);
  assert.match(layout, /book-meet-brand-v4\.png/);
  assert.match(layout, /CompactLocaleButtons/);
  assert.doesNotMatch(layout, /mobile-navigation-drawer-header[\s\S]{0,160}>×</);
  assert.doesNotMatch(layout, /<span>\{t\("nav\.main"\)\}<\/span>/);
  assert.doesNotMatch(layout, /<span>\{t\("header\.chats"\)\}<\/span>/);
  assert.doesNotMatch(layout, /<span>\{t\("header\.notifications"\)\}<\/span>/);
  assert.doesNotMatch(layout, /<span>\{t\("nav\.profile"\)\}<\/span>/);
  assert.match(localeSwitcher, />KZ<\/button>[\s\S]*>RU<\/button>[\s\S]*>EN<\/button>/);
  assert.match(routes, /notifications: "\/notifications"/);
  assert.match(routes, /kind: "notification", view: "notifications"/);
  assert.match(notifications, /export function NotificationsPage/);
  assert.match(controller, /view === "search" \|\| view === "chat" \|\| view === "notifications" \|\| view === "profile" \? "mobile-header-hidden"/);
  assert.match(controller, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(controller, /document\.body\.style\.overflow = "hidden"/);
  assert.match(controller, /setMobileNavigationOpen\(false\)/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /mobile-navigation-open.*mobile-shell-surface|mobile-shell-surface.*mobile-navigation-open/);
  assert.match(css, /mobile-navigation-open.*mobile-bottom-navigation|mobile-bottom-navigation.*mobile-navigation-open/);
  assert.match(css, /mobile-navigation-drawer[^\{]*\{/);
  assert.doesNotMatch(layout, /lastScrollY|setHidden|mobile-bottom-navigation \$\{hidden/);
  assert.doesNotMatch(css, /\.mobile-bottom-navigation\.is-hidden/);
  assert.match(css, /\.topbar \{ position: fixed/);
  assert.match(css, /\.app-shell\.mobile-header-hidden \.topbar \{ display: none; \}/);
  assert.match(css, /\.app-shell\.mobile-header-hidden \.my-profile-page \.profile-page-topbar \{ top: 0; \}/);
  assert.match(css, /\.notifications-page \{ width: 100%; min-height: 100dvh/);
  assert.match(css, /compact-locale-buttons button\.is-active/);
  assert.match(css, /mobile-navigation-overlay[\s\S]*display: block/);
  assert.match(css, /overflow-y: auto/);
  for (const key of ["nav.openMobileMenu", "nav.closeMobileMenu", "nav.mobileMenu", "nav.mobileBottom"]) assert.match(messages, new RegExp(key.replaceAll(".", "\\.")));
  assert.ok(homeAsset.length > 0);
  assert.ok(logoAsset.length > 0);
});
