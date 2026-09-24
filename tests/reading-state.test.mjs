import assert from "node:assert/strict";
import test from "node:test";
import { currentYearInTimezone, normalizeReadingState, postponedOverdue, progressPercent, readingStateDto } from "../server/modules/reading-state.js";

test("reading state keeps incomplete progress uncomputed and accepts zero", () => {
  assert.equal(progressPercent(0, 10), 0);
  assert.equal(progressPercent(3, null), null);
  assert.throws(() => normalizeReadingState({ readingStatus: "reading", chaptersCurrent: 11, chaptersTotal: 10 }), /больше общего/);
  assert.throws(() => normalizeReadingState({ readingStatus: "reading", chaptersCurrent: 4_294_967_296 }), /неотрицательным/);
  const state = normalizeReadingState({ readingStatus: "reading", chaptersCurrent: 0, chaptersTotal: 10 });
  assert.equal(readingStateDto(state, { owner: false }).progressPercent, 0);
});

test("status validation is conditional and postponed month uses the saved timezone year", () => {
  const now = new Date("2026-01-01T00:30:00Z");
  const postponed = normalizeReadingState({ readingStatus: "postponed", postponedMonth: 12 }, {}, { now, timezone: "America/Los_Angeles" });
  assert.equal(postponed.postponedYear, 2025);
  assert.equal(currentYearInTimezone("America/Los_Angeles", now), 2025);
  assert.throws(() => normalizeReadingState({ readingStatus: "read", rating: 5, shortReview: "ok", readMonth: 1, readYear: 2027 }, {}, { now, timezone: "UTC" }), /корректный год/);
  assert.throws(() => normalizeReadingState({ readingStatus: "not-a-status" }), /корректный статус/);
  const abandoned = normalizeReadingState({ readingStatus: "abandoned", shortReview: "" });
  assert.equal(abandoned.shortReview, "");
});

test("partial active patch merges values and only an actual pair edit selects its unit", () => {
  const existing = { readingStatus: "reading", chaptersCurrent: 2, chaptersTotal: 10, pagesCurrent: 4, pagesTotal: 20, progressUnit: "chapters" };
  const unchanged = normalizeReadingState({ chaptersCurrent: 2, chaptersTotal: 10 }, existing);
  assert.equal(unchanged.progressUnit, "chapters");
  const changed = normalizeReadingState({ pagesCurrent: 5 }, existing);
  assert.equal(changed.progressUnit, "pages");
  const both = normalizeReadingState({ chaptersCurrent: 3, pagesCurrent: 6, progressUnit: "chapters" }, existing);
  assert.equal(both.progressUnit, "chapters");
});

test("owner postponed projection has a timezone-aware due flag without leaking its fields", () => {
  const owner = readingStateDto({ readingStatus: "postponed", postponedMonth: 12, postponedYear: 2025, postponedTimezone: "UTC", chaptersCurrent: 3, chaptersTotal: 10 }, { owner: true });
  assert.equal(owner.postponedOverdue, true);
  assert.equal(readingStateDto({ readingStatus: "postponed", postponedMonth: 12, postponedYear: 2025 }, { owner: false }).postponedMonth, undefined);
  assert.equal(postponedOverdue(12, 2025, "UTC", new Date("2026-01-01T00:00:00Z")), true);
});
