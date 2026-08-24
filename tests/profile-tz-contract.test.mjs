import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("profile TZ keeps privacy, persistence, unified organization feed and responsive contracts in sync", async () => {
  const files = await Promise.all([
    readFile(path.join(root, "mysql", "migrations", "034_profile_social_visibility.sql"), "utf8"),
    readFile(path.join(root, "server", "data.js"), "utf8"),
    readFile(path.join(root, "server", "api.js"), "utf8"),
    readFile(path.join(root, "server", "demo-api.js"), "utf8"),
    readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8"),
    readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app", "globals.css"), "utf8"),
    readFile(path.join(root, "index.html"), "utf8"),
  ]);
  const [migration, data, api, demoApi, content, profiles, controller, css, indexHtml] = files;

  for (const column of ["followers_visibility", "friends_visibility", "wishlist_visibility"]) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column} ENUM\\('nobody', 'friends', 'everyone'\\) NOT NULL DEFAULT 'friends'`));
  }
  assert.match(data, /friendCount: canViewFriends \?/);
  assert.match(data, /followerCount: canViewFollowers \?/);
  assert.match(data, /friendIds: canViewFriends \?/);
  assert.match(data, /followerIds: canViewFollowers \?/);
  assert.match(data, /wishBooks: user\.profile\.canViewWishlist \?/);
  assert.match(demoApi, /wishBooks: canViewWishlist \?/);

  assert.match(content, /mobile-public-profile-social-links"><button/);
  assert.match(content, /disabled=\{!user\.profile\.canViewFriends\}/);
  assert.match(content, /disabled=\{!user\.profile\.canViewFollowers\}/);
  assert.match(controller, /profileFollowers=\{profileFollowerUsers\}/);
  assert.match(controller, /friendCount=\{profileUser\.friendCount\}/);
  assert.match(controller, /followerCount=\{profileUser\.followerCount\}/);

  for (const endpoint of ["/reviews", "/excerpts"]) {
    assert.match(api, new RegExp(`router\\.post\\(\\"${endpoint}`));
    assert.match(api, new RegExp(`router\\.patch\\(\\"${endpoint}/:id`));
    assert.match(demoApi, new RegExp(`router\\.post\\(\\"${endpoint}`));
    assert.match(demoApi, new RegExp(`router\\.patch\\(\\"${endpoint}/:id`));
  }
  assert.match(api, /router\.patch\("\/books\/:id"/);
  assert.match(demoApi, /router\.patch\("\/books\/:id"/);
  assert.match(content, /editingId \? `\/api\/reviews\/\$\{editingId\}` : "\/api\/reviews"/);
  assert.match(content, /editingId \? `\/api\/excerpts\/\$\{editingId\}` : "\/api\/excerpts"/);

  assert.match(content, /export function MaterialAuthorRow/);
  for (const card of ["EventCard", "OccasionCard", "MaterialPreviewCard", "PublisherNewsCard"]) {
    const block = content.slice(content.indexOf(`export function ${card}`), content.indexOf("\nexport function", content.indexOf(`export function ${card}`) + 1));
    assert.match(block, /<MaterialAuthorRow/);
  }
  assert.match(content, /MaterialAuthorRow owner=\{owner\} fallbackName=\{owner\.profile\.name\}/);
  assert.match(content, /MaterialAuthorRow owner=\{owner\} fallbackName=\{author\}/);

  assert.match(profiles, /\^\\\/\(\?:create\|edit\)\\\/news/);
  assert.match(profiles, /setActiveTab\("main"\)/);
  assert.match(profiles, /canPublishNews/);
  assert.match(profiles, /<PublisherNewsEditor item=\{editingPublisherNews/);
  assert.match(profiles, /onOpenNews=\{setOpenedPublisherNews\}/);
  assert.doesNotMatch(profiles, /activeTab === "publisher-news"/);
  assert.match(controller, /route\.workflow\.kind !== "publisher-news"/);
  assert.match(controller, /"\/create\/news"/);

  assert.match(css, /--desktop-header-height: 76px/);
  assert.match(css, /\.profile-overlay-top \{ inset: var\(--desktop-header-height\)/);
  assert.match(css, /\.app-shell > \.mobile-shell-surface \{ height: calc\(100vh - var\(--desktop-header-height\)\); min-height: 0; overflow-y: auto/);
  assert.match(css, /\.my-profile-main\.library-main \.library-title-row h1/);
  assert.match(profiles, /className="profile-bio-wide"><span>\{t\("profile\.aboutMe"\)\}/);
  assert.match(css, /\.mobile-profile-primary-actions/);
  assert.match(indexHtml, /href="\/book-meet-favicon-v2\.png"/);
  await access(path.join(root, "public", "book-meet-favicon-v2.png"));
});
