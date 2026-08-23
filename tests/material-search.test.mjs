import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeMaterialSearchQuery, searchBootstrapMaterials } from "../server/modules/material-search.js";

const root = path.resolve(import.meta.dirname, "..");
const bootstrap = {
  activeUserId: 1,
  users: [
    { id: 1, initials: "ME", profile: { name: "Me" }, reviews: [{ id: 11, bookTitle: "City Lines", bookAuthor: "Aida", preview: "warm streets", fullText: "A quiet city novel", createdAtValue: "2026-01-02T00:00:00.000Z" }], excerpts: [] },
    { id: 2, initials: "OT", profile: { name: "Other" }, reviews: [{ id: 12, bookTitle: "Hidden book", bookAuthor: "Blocked", preview: "must not leak", fullText: "secret", createdAtValue: "2026-12-02T00:00:00.000Z" }], excerpts: [{ id: 21, bookTitle: "Steppe Wind", previewText: "new Kazakh stories", text: "wind and road", bodyHtml: "<p>wind and road</p>", createdAtValue: "2026-03-02T00:00:00.000Z" }] },
  ],
  events: [
    { id: 31, creatorId: 2, creatorName: "Other", status: "published", title: "City reading", summary: "Aida speaks", description: "at the library", city: "Astana", address: "Main 1", createdAt: "2026-04-02T00:00:00.000Z" },
    { id: 32, creatorId: 2, creatorName: "Other", status: "pending", title: "City draft", summary: "not public", description: "", city: "Astana", address: "", createdAt: "2026-05-02T00:00:00.000Z" },
  ],
  occasions: [
    { id: 41, creatorId: 1, creatorName: "Me", status: "pending", type: "meet", primaryText: "Coffee and books", audienceText: "readers", targetCities: ["Astana"], meetingCity: "Astana", meetingAddress: "Park", createdAt: "2026-06-02T00:00:00.000Z" },
  ],
};

test("material search matches every word across a combined safe text", () => {
  const result = searchBootstrapMaterials(bootstrap, "CITY quiet");
  assert.deepEqual(result.items.map((item) => [item.kind, item.id]), [["review", 11]]);
  assert.equal(normalizeMaterialSearchQuery("!!").error, "SEARCH_QUERY_TOO_SHORT");
  assert.equal(normalizeMaterialSearchQuery("x".repeat(121)).error, "SEARCH_QUERY_TOO_LONG");
});

test("material search orders newest-first and paginates without returning all rows", () => {
  const first = searchBootstrapMaterials(bootstrap, "astana", { page: 1, limit: 1 });
  const second = searchBootstrapMaterials(bootstrap, "astana", { page: 2, limit: 1 });
  assert.deepEqual(first.items.map((item) => item.id), [41]);
  assert.equal(first.hasMore, true);
  assert.deepEqual(second.items.map((item) => item.id), [31]);
  assert.equal(second.hasMore, false);
});

test("material search cannot reintroduce absent bootstrap materials or other users drafts", () => {
  const filtered = { ...bootstrap, users: bootstrap.users.filter((user) => user.id !== 2) };
  const absent = searchBootstrapMaterials(filtered, "hidden");
  const drafts = searchBootstrapMaterials(bootstrap, "city");
  assert.equal(absent.total, 0);
  assert.ok(!drafts.items.some((item) => item.id === 32));
});

test("material search excludes materials from users blocked by the viewer", () => {
  const blocked = {
    ...bootstrap,
    users: bootstrap.users.map((user) => user.id === 2 ? { ...user, blockedByMe: true } : user),
  };
  const result = searchBootstrapMaterials(blocked, "hidden");
  assert.equal(result.total, 0);
});

test("search endpoint stays authenticated in both APIs and mobile route stays outside desktop main navigation", async () => {
  const [api, demo, routes, controller, page] = await Promise.all([
    readFile(path.join(root, "server", "api.js"), "utf8"),
    readFile(path.join(root, "server", "demo-api.js"), "utf8"),
    readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8"),
    readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "MobileGlobalSearchPage.tsx"), "utf8"),
  ]);
  assert.match(api, /router\.get\("\/search\/materials"/);
  assert.match(api, /authenticatedUser\(request\)/);
  assert.match(api, /loadBootstrap\(user\.id, \{ sections: \["catalog"\] \}\)/);
  assert.match(demo, /router\.use\(requireUser\);[\s\S]*router\.get\("\/search\/materials"/);
  assert.match(routes, /Exclude<MainView, "profile" \| "search">/);
  assert.doesNotMatch(routes, /search:\s*"\/search"/);
  assert.match(controller, /matchMedia\("\(min-width: 801px\)"\)/);
  assert.match(page, /setTimeout\(\(\) => void fetchPage\(1, true\), 380\)/);
  assert.match(page, /AbortController/);
  assert.match(page, /bookmeet:mobile-material-search/);
  assert.match(page, /window\.location\.pathname !== "\/search"/);
  assert.match(page, /aria-label=\{t\("common\.back"\)\}>\{"<"\}/);
  assert.match(page, /likes: Record<string, number\[\]>/);
  assert.match(page, /saved: Boolean\(saves\[key\]\?\.includes\(userId\)\)/);
  assert.match(page, /onToggleLike: \(\) => onToggleLike\(actionItem\)/);
  assert.match(page, /onOpenComments: \(\) => onOpenResult\(entry\)/);
  assert.match(page, /onOpenUser=\{onOpenUser\}/);
  assert.match(page, /\{ \.\.\.\(source as ReadingItem\), ownerId: entry\.ownerId \}/);
  assert.match(controller, /onOpenUser=\{openUserProfile\} onToggleLike=\{toggleLike\} onToggleSave=\{toggleSave\}/);
  assert.match(controller, /mobileSearchQueryRef/);
});
