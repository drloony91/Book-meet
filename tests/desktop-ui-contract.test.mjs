import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("desktop routes, username and privacy controls have stable contracts", async () => {
  const [routes, layout, auth, profile, content, css, controller] = await Promise.all([
    readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8"),
    readFile(path.join(root, "app", "components", "layout", "AppLayout.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "AuthScreens.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8"),
    readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8"),
    readFile(path.join(root, "app", "globals.css"), "utf8"),
    readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8"),
  ]);
  assert.match(routes, /liked: "\/liked"/);
  assert.match(routes, /saved: "\/saved"/);
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
  assert.match(layout, /bell-active\.png/);
  assert.match(layout, /desktop-quick-create-menu/);
  assert.match(controller, /toggleSave/);
  assert.match(controller, /savedMaterialRefs/);
  assert.equal((css.match(/Final desktop layout cascade/g) ?? []).length, 0);
  assert.match(css, /@media \(min-width: 801px\)/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /desktop-bell-nudge/);
  assert.match(css, /prefers-reduced-motion/);
});
