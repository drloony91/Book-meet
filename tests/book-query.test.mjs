import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { matchesBookQuery, normalizeBookSearchText, resolveCanonicalBook, resolveViewerBook } from "../app/lib/domain.ts";
import { includesFollowingFeed } from "../app/lib/feed-filter.ts";

const root = path.resolve(import.meta.dirname, "..");

const book = {
  title: "«Мастер и Маргарита»",
  author: "Михаил Афанасьевич Булгаков",
  isbn: "978-5-17-090630-7",
  publisher: "АСТ",
  annotation: "Роман о Москве и Воланде",
};

test("book matcher ignores token order, punctuation and quotation marks", () => {
  assert.equal(matchesBookQuery(book, "Булгаков Мастер"), true);
  assert.equal(matchesBookQuery(book, "Мастер Булгаков"), true);
  assert.equal(matchesBookQuery(book, "\"Мастер\", Булгаков!"), true);
  assert.equal(normalizeBookSearchText("«Мастер» — Булгаков"), "мастер булгаков");
});

test("book matcher searches ISBN and requires every query token", () => {
  assert.equal(matchesBookQuery(book, "978 17 090630"), true);
  assert.equal(matchesBookQuery(book, "Булгаков АСТ 978"), true);
  assert.equal(matchesBookQuery(book, "Булгаков Достоевский"), false);
});

test("book matcher covers every catalog search field and normalizes internal whitespace", () => {
  assert.equal(matchesBookQuery(book, "Воланде"), true);
  assert.equal(normalizeBookSearchText("  Мастер\n   Булгаков  "), "мастер булгаков");
});

test("viewer book resolution overlays only the viewer relation onto canonical metadata", () => {
  const canonical = { id: 7, catalogBookId: 7, title: "Canonical", author: "Author", annotation: "Canonical annotation", genres: [], pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", ratingCount: 3, averageRating: 4.2, coverTone: "blue" };
  const viewer = { id: 1, books: [{ ...canonical, title: "Stale user title", rating: 4.5, review: "Short", readingStatus: "read", ratingCount: 0 }], profile: {} };
  const foreignOwner = { id: 2, books: [{ ...canonical, rating: 1, review: "Foreign", readingStatus: "want" }], profile: {} };
  const resolved = resolveViewerBook(canonical, [canonical], viewer);
  assert.equal(resolved.title, "Canonical");
  assert.equal(resolved.annotation, "Canonical annotation");
  assert.equal(resolved.rating, 4.5);
  assert.equal(resolved.review, "Short");
  assert.equal(resolved.ratingCount, 3);
  assert.equal(resolved.averageRating, 4.2);
  assert.notEqual(resolved.rating, foreignOwner.books[0].rating);
  assert.notEqual(resolved.review, foreignOwner.books[0].review);
});

test("general catalogue book resolution keeps aggregate rating fields beside author metadata", () => {
  const catalogueBook = { id: 24, catalogBookId: 24, title: "Catalogue title", author: "Author", annotation: "Catalogue annotation", genres: [], pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", ratingCount: 8, averageRating: 4.6, coverTone: "blue", links: [] };
  const authorBook = { ...catalogueBook, ratingCount: 0, averageRating: undefined, annotation: "Author annotation" };
  const canonical = resolveCanonicalBook(catalogueBook, [{ id: 2, authorBooks: [authorBook], books: [], profile: {} }], [catalogueBook]);
  const resolved = resolveViewerBook(canonical, [catalogueBook], undefined);
  assert.equal(resolved.annotation, "Catalogue annotation");
  assert.equal(resolved.ratingCount, 8);
  assert.equal(resolved.averageRating, 4.6);
});

test("catalog route leaves the empty query uncapped while bounding searches", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  const routeStart = api.indexOf('router.get("/books/catalog"');
  const routeEnd = api.indexOf('router.get("/books', routeStart + 1);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "catalog route must be present");
  const route = api.slice(routeStart, routeEnd);
  assert.match(route, /const catalogLimit = needle === null \? "" : " LIMIT 100"/);
  assert.match(route, /ORDER BY b\.title_key, b\.author_key\$\{catalogLimit\}/);
  assert.doesNotMatch(route, /ORDER BY b\.title_key, b\.author_key\s+LIMIT 100/);
  assert.doesNotMatch(route, /creator_user\.deleted_at/);
  const bootstrapCatalog = data.slice(data.indexOf("const [catalogRows]"), data.indexOf("return {", data.indexOf("const [catalogRows]")));
  assert.doesNotMatch(bootstrapCatalog, /creator_user\.deleted_at/);
  assert.match(bootstrapCatalog, /hiddenUserIds\.has\(Number\(row\.creator_user_id\)\)/);
  assert.match(demo, /response\.json\(\{ books: needle \? sorted\.slice\(0, 100\) : sorted \}\)/);
});

test("personal library keeps the disabled spreadsheet import out of the UI", async () => {
  const components = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  assert.doesNotMatch(components, /readFirstWorksheetRows/);
  assert.doesNotMatch(components, /t\("library\.import"\)/);
  assert.doesNotMatch(components, /accept="\.csv,\.xls,\.xlsx"/);
});

test("library book editing stays on the canonical catalogue id", async () => {
  const components = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const controller = await readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8");
  assert.match(components, /const canonicalBookId = \(item: Pick<LibraryBook, "id"> & \{ catalogBookId\?: number \}\) => item\.catalogBookId \?\? item\.id/);
  assert.match(components, /books\.find\(\(item\) => canonicalBookId\(item\) === initialEditId\)/);
  assert.match(components, /apiFetch\(editingOwnedBook \? `\/api\/books\/\$\{canonicalId\}` : "\/api\/books"/);
  assert.match(components, /current\.map\(\(item\) => canonicalBookId\(item\) === relationId/);
  assert.match(controller, /const ownedCatalogId =/);
  assert.match(controller, /\(book\.catalogBookId \?\? book\.id\) === id/);
  assert.match(controller, /setProfileEditId\(id\)/);
});

test("following feed includes self, confirmed friends and explicit follows for every material group", () => {
  const entries = [
    { kind: "review", item: { ownerId: 10 } }, { kind: "excerpt", item: { ownerId: 11 } }, { kind: "publisher-news", item: { ownerId: 12 } },
    { kind: "event", item: { creatorId: 13 } }, { kind: "occasion", item: { creatorId: 14 } },
  ];
  assert.equal(includesFollowingFeed(entries[0], 10, () => false, () => false), true);
  assert.equal(includesFollowingFeed(entries[1], 10, (id) => id === 11, () => false), true);
  assert.equal(includesFollowingFeed(entries[2], 10, () => false, (id) => id === 12), true);
  assert.equal(includesFollowingFeed(entries[3], 10, () => false, (id) => id === 13), true);
  assert.equal(includesFollowingFeed(entries[4], 10, () => false, () => false), false);
});
