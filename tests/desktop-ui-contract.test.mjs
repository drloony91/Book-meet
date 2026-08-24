import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("desktop routes, username and privacy controls have stable contracts", async () => {
  const [routes, layout, auth, profile, content, css, controller, messages, brandMark, brandLettering] = await Promise.all([
    readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8"),
    readFile(path.join(root, "app", "components", "layout", "AppLayout.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "AuthScreens.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8"),
    readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8"),
    readFile(path.join(root, "app", "globals.css"), "utf8"),
    readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app", "i18n", "messages.ts"), "utf8"),
    readFile(path.join(root, "public", "desktop-brand", "book-meet-mark.png")),
    readFile(path.join(root, "public", "desktop-brand", "book-meet-lettering.png")),
  ]);
  assert.match(routes, /liked: "\/liked"/);
  assert.match(routes, /saved: "\/saved"/);
  assert.match(routes, /normalized === "\/profile\/settings"/);
  assert.match(layout, /desktop-navigation-quick/);
  assert.doesNotMatch(layout, /matchMedia\(\"\(min-width: 801px\)\"\)\.matches/);
  assert.match(auth, /autoComplete="username"/);
  assert.match(profile, /settings\.closedCommunity/);
  assert.match(profile, /profile\.birthVisibility/);
  assert.match(profile, /birthDateVisibility/);
  assert.match(profile, /key: "communities"/);
  assert.match(profile, /profile-avatar-edit-button/);
  assert.match(profile, /await onUserChange\(\{ \.\.\.user, avatarUrl: nextAvatarUrl \}\)/);
  assert.match(profile, /profile-aside-identity/);
  assert.match(profile, /ProfileSocialDialog/);
  assert.match(profile, /profile\.followBack/);
  assert.match(profile, /communityMemberships/);
  assert.match(profile, /profile-material-stream/);
  assert.match(profile, /profile-main-nav/);
  assert.doesNotMatch(profile, /openTab\("settings"\)|activeTab === "settings"/);
  assert.match(profile, /profile\.type !== "Издатель" && <section className="profile-edit-settings-section profile-privacy-settings"/);
  assert.doesNotMatch(profile, /profile-menu-order-list/);
  assert.match(profile, /eventTimestamp\(item\) >= Date\.now\(\)/);
  assert.match(profile, /t\("common\.back"\)/);
  assert.doesNotMatch(profile, /profile\.changePhoto[^\n]*setEditing\(true\)/);
  assert.match(content, /public-profile-aside/);
  assert.match(content, /public-profile-main/);
  assert.match(content, /materialQueryDraft/);
  assert.match(content, /profileCommunities/);
  assert.match(content, /public-profile-icon-actions/);
  assert.match(content, /MaterialActionBar/);
  assert.match(content, /desktop-icons\/heart\.png/);
  assert.match(content, /desktop-icons\/bookmark\.png/);
  assert.match(content, /desktop-icons\/comment\.png/);
  assert.match(content, /COMMENTS_SCROLL_REQUEST/);
  assert.match(content, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(content, /displayMaterialDate/);
  assert.match(content, /profileCommunities\.length > 0/);
  assert.match(content, /eventTimestamp\(item\) >= Date\.now\(\)/);
  assert.match(content, /profile\.communityNews/);
  assert.match(content, /profile\.publisherNews/);
  assert.match(layout, /bell-active\.png/);
  assert.match(layout, /desktop-quick-create-menu/);
  assert.match(layout, /desktop-brand\/book-meet-mark\.png/);
  assert.match(layout, /desktop-brand\/book-meet-lettering\.png/);
  assert.ok(brandMark.length > 0);
  assert.ok(brandLettering.length > 0);
  assert.match(controller, /toggleSave/);
  assert.match(controller, /savedMaterialRefs/);
  assert.equal((css.match(/Final desktop layout cascade/g) ?? []).length, 0);
  assert.match(css, /@media \(min-width: 801px\)/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /desktop-bell-nudge/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /mobile-chat-button\.mobile-chat-button-hidden/);
  assert.match(css, /\.desktop-navigation \{ top: 0; height: 100%; overflow: visible; \}/);
  assert.match(css, /\.desktop-brand-title \{ position: absolute; grid-column: auto; left: calc\(50% \+ 110px\);/);
  assert.match(css, /\.app-shell > \.mobile-shell-surface \{ height: calc\(100vh - var\(--desktop-header-height\)\); min-height: 0; overflow-y: auto; scrollbar-gutter: stable;/);
  assert.match(css, /\.my-profile-page \{ width: 100%; \}/);
  assert.match(css, /\.my-profile-card \{ width: min\(1260px, 100%\); max-width: none;/);
  assert.match(css, /\.directory-heading \{ width: min\(760px, 100%\); min-height: 50px; margin: 42px auto 20px; padding: 0; border: 0;/);
  assert.match(css, /\.organization-directory-filters \.directory-control-field > \.custom-select \{ min-width: 0; \}/);
  assert.match(css, /publication-preview-card/);
  assert.match(css, /profile-main-nav/);
  assert.match(css, /\.my-profile-main\.library-main \.library-import-actions > \.creation-action-button \{ display: inline-flex !important; \}/);
  assert.match(messages, /"content\.createOccasion": "Познакомиться"/);
  assert.match(messages, /"directory\.everyone": "Все"/);
  assert.match(messages, /"profile\.publisherNews": \["Новости издательства"/);
  assert.doesNotMatch(messages, /Новинки издательств/);
});

test("desktop profile dialogs and directory controls keep the correction contracts", async () => {
  const [profile, contentScreens, css, messages] = await Promise.all([
    readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "ContentScreens.tsx"), "utf8"),
    readFile(path.join(root, "app", "globals.css"), "utf8"),
    readFile(path.join(root, "app", "i18n", "messages.ts"), "utf8"),
  ]);
  assert.doesNotMatch(profile, /profile-main-summary-duplicate/);
  assert.doesNotMatch(profile, /profile-home-view-settings/);
  assert.doesNotMatch(profile, /profile-menu-visibility-settings/);
  assert.doesNotMatch(profile, /profile-menu-order-settings/);
  assert.match(profile, /friends\.incomingShort/);
  assert.match(profile, /friends\.outgoingShort/);
  assert.match(profile, /profile-social-group-title/);
  assert.match(profile, /linked-profile-section/);
  assert.match(css, /\.profile-social-dialog > h2,[\s\S]*\.profile-social-group \.profile-social-group-title,[\s\S]*\.mobile-profile-social-label \{ display: none; \}/);
  assert.match(css, /\.profile-social-subtabs \{ width: 100%; margin: 0 0 18px; \}/);
  assert.match(css, /\.content-scroll\.directory-page \{ overflow: visible; \}/);
  assert.match(css, /\.directory-controls \.directory-city-filter input \{[^}]*box-shadow: none;/);
  assert.match(contentScreens, /personal-material-empty-copy/);
  assert.match(messages, /"directory\.bookMatches": "По совпадениям"/);
  assert.match(messages, /"friends\.incomingShort": "Входящие запросы"/);
  assert.match(messages, /"friends\.outgoingShort": "Исходящие запросы"/);
});
