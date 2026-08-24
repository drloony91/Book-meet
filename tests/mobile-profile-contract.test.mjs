import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("mobile profiles use routed full-page states without replacing desktop profile flows", async () => {
  const [ownProfile, publicProfile, controller, routes, css, messages, packageJson, domain, serverData, demoApi] = await Promise.all([
    readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8"),
    readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8"),
    readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8"),
    readFile(path.join(root, "app", "globals.css"), "utf8"),
    readFile(path.join(root, "app", "i18n", "messages.ts"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "app", "types", "domain.ts"), "utf8"),
    readFile(path.join(root, "server", "data.js"), "utf8"),
    readFile(path.join(root, "server", "demo-api.js"), "utf8"),
  ]);

  assert.match(routes, /normalized === "\/profile\/settings"/);
  assert.match(routes, /followers: "\/profile\/followers"/);
  assert.match(routes, /following: "\/profile\/following"/);
  assert.match(routes, /incoming: "\/profile\/friends\/incoming"/);
  assert.match(routes, /outgoing: "\/profile\/friends\/outgoing"/);
  assert.match(routes, /mobileProfileSocialRouteFromPathname/);
  assert.match(routes, /\^\\\/users\\\/\(\\d\+\)\$/);
  assert.match(ownProfile, /mobile-profile-back/);
  assert.match(ownProfile, /\{"<"\}/);
  assert.match(ownProfile, /bookMeetProfileSettings/);
  assert.match(ownProfile, /normalizedPathname\(window\.location\.pathname\) === "\/profile\/settings"/);
  assert.match(ownProfile, /mobile-profile-primary-actions/);
  assert.match(ownProfile, /mobile-own-profile-social-links/);
  assert.doesNotMatch(ownProfile, /mobile-profile-subpage/);
  assert.match(ownProfile, /window\.matchMedia\("\(min-width: 801px\)"\)\.matches/);
  assert.match(ownProfile, /<strong>\{formatNumber\(friends\.length\)\}<\/strong><span>\{t\("profile\.friends"\)\}<\/span>/);
  assert.doesNotMatch(ownProfile, /profile-home-view-settings/);
  assert.doesNotMatch(ownProfile, /profile-menu-visibility-settings/);
  assert.doesNotMatch(ownProfile, /profile-menu-order-settings/);
  assert.match(ownProfile, /profile-social-mobile-back/);
  assert.match(ownProfile, /window\.addEventListener\("popstate", syncProfileTab\)/);
  assert.match(ownProfile, /initialMobileSocialRoute/);
  assert.match(ownProfile, /bookMeetProfileSocial/);
  assert.match(ownProfile, /window\.history\.pushState\(\{ bookMeetProfileSocial: true, backgroundPath \}/);
  assert.match(ownProfile, /window\.history\.back\(\)/);
  assert.match(ownProfile, /onMobileRouteChange=\{mobileProfile \? navigateProfileSocial : undefined\}/);
  assert.doesNotMatch(publicProfile, /setMobileSocialView/);
  assert.doesNotMatch(publicProfile, /profileFollowers\?:/);
  assert.doesNotMatch(publicProfile, /profileFollowing\?:/);
  assert.match(publicProfile, /profileCommunities/);
  assert.match(publicProfile, /mobile-public-profile-social-links"><div><strong>\{friendCount\}/);
  assert.doesNotMatch(publicProfile, /mobile-public-profile-social-links"><button/);
  assert.match(publicProfile, /public-profile-back-mobile/);
  assert.doesNotMatch(controller, /profileFollowers=\{profileFollowerUsers\}/);
  assert.doesNotMatch(controller, /profileFollowing=\{profileFollowingUsers\}/);
  assert.match(controller, /friendCount=\{profileUser\.friendCount \?\? profileFriendUsers\.length\}/);
  assert.match(controller, /followerCount=\{profileUser\.followerCount \?\? profileFollowerUsers\.length\}/);
  assert.match(domain, /friendCount\?: number; followerCount\?: number/);
  assert.match(serverData, /AS friend_count/);
  assert.match(serverData, /AS follower_count/);
  assert.match(serverData, /NOT EXISTS \(SELECT 1 FROM friendships/);
  assert.match(demoApi, /friendCountByUser/);
  assert.match(demoApi, /followerCountByUser/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.mobile-profile-back/);
  assert.match(css, /\.mobile-profile-back,[\s\S]*display: grid !important;[\s\S]*max-width: 36px !important;[\s\S]*max-height: 36px !important;[\s\S]*border-radius: 50% !important/);
  assert.match(css, /\.app-shell\.mobile-header-hidden \.my-profile-page \.profile-page-topbar \{ top: 0; \}/);
  assert.match(css, /\.public-profile-modal[\s\S]*height: 100dvh/);
  assert.match(css, /\.profile-social-dialog[\s\S]*height: 100dvh/);
  assert.match(css, /@media \(min-width: 801px\)[\s\S]*\.my-profile-card/);
  assert.match(messages, /"profile\.editProfile": \["Редактировать профиль", "Профильді өңдеу", "Edit profile"\]/);
  assert.match(packageJson, /tests\/mobile-profile-contract\.test\.mjs/);
});
