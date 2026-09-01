import test from "node:test";
import assert from "node:assert/strict";
import { matchesBookQuery, normalizeBookSearchText, resolveViewerBook } from "../app/lib/domain.ts";
import { includesFollowingFeed } from "../app/lib/feed-filter.ts";

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
  const canonical = { id: 7, catalogBookId: 7, title: "Canonical", author: "Author", annotation: "Canonical annotation", genres: [], pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", ratingCount: 3, coverTone: "blue" };
  const viewer = { id: 1, books: [{ ...canonical, title: "Stale user title", rating: 4.5, review: "Short", readingStatus: "read", ratingCount: 0 }], profile: {} };
  const foreignOwner = { id: 2, books: [{ ...canonical, rating: 1, review: "Foreign", readingStatus: "want" }], profile: {} };
  const resolved = resolveViewerBook(canonical, [canonical], viewer);
  assert.equal(resolved.title, "Canonical");
  assert.equal(resolved.annotation, "Canonical annotation");
  assert.equal(resolved.rating, 4.5);
  assert.equal(resolved.review, "Short");
  assert.equal(resolved.ratingCount, 3);
  assert.notEqual(resolved.rating, foreignOwner.books[0].rating);
  assert.notEqual(resolved.review, foreignOwner.books[0].review);
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
