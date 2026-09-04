import test from "node:test";
import assert from "node:assert/strict";
import { readingPercent, sortBookReaders } from "../app/lib/reading-state.ts";

const entry = (id, name, status, percent, history = false) => ({
  reader: { id, profile: { name } },
  item: { id: 7, catalogBookId: 7, readingStatus: status, progressPercent: percent, hasCompletedReading: history },
});
const ids = (entries, viewer) => sortBookReaders(entries, viewer).map(({ reader }) => reader.id);

test("reading percentage uses only the active pair and keeps zero distinct from unknown", () => {
  assert.equal(readingPercent({ chaptersCurrent: 0, chaptersTotal: 10, progressUnit: "chapters" }), 0);
  assert.equal(readingPercent({ chaptersCurrent: 2, chaptersTotal: 3, progressUnit: "chapters" }), 66);
  assert.equal(readingPercent({ chaptersCurrent: 2, chaptersTotal: 3, pagesCurrent: 3, pagesTotal: 4, progressUnit: "pages" }), 75);
  assert.equal(readingPercent({ chaptersCurrent: 2, progressUnit: "chapters" }), null);
  assert.equal(readingPercent({ chaptersTotal: 10, progressUnit: "chapters" }), null);
  assert.equal(readingPercent({ chaptersCurrent: 2, chaptersTotal: 3 }), null);
  assert.equal(readingPercent({ chaptersCurrent: 2, chaptersTotal: 0, progressUnit: "chapters" }), null);
  assert.equal(readingPercent({ chaptersCurrent: 11, chaptersTotal: 10, progressUnit: "chapters" }), null);
  assert.equal(readingPercent({ chaptersCurrent: 1.5, chaptersTotal: 10, progressUnit: "chapters" }), null);
});

test("reader sorting with viewer progress orders nearest readers then completed then wanting", () => {
  const list = [entry(1, "А", "want"), entry(2, "Б", "read"), entry(3, "В", "reading", 80), entry(4, "Г", "reading", 45), entry(5, "Д", "reading", 10), entry(6, "Е", "reading")];
  const before = structuredClone(list);
  assert.deepEqual(ids(list, { readingStatus: "reading", progressPercent: 50 }), [4, 3, 5, 6, 2, 1]);
  assert.deepEqual(list, before, "sorting must not mutate bootstrap data");
});

test("completed viewer sees completed then descending progress then wanting", () => {
  const list = [entry(1, "А", "want"), entry(2, "Б", "read"), entry(3, "В", "reading", 80), entry(4, "Г", "reading", 0), entry(5, "Д", "reading", 50), entry(6, "Е", "reading")];
  assert.deepEqual(ids(list, { readingStatus: "read" }), [2, 3, 5, 4, 6, 1]);
});

test("wanting, absent or progress-less viewer sees wanting then ascending progress then completed", () => {
  const list = [entry(1, "А", "read"), entry(2, "Б", "want"), entry(3, "В", "reading", 80), entry(4, "Г", "reading", 0), entry(5, "Д", "reading", 50), entry(6, "Е", "reading")];
  for (const viewer of [undefined, { readingStatus: "want" }, { readingStatus: "reading" }, { readingStatus: "postponed" }, { readingStatus: "abandoned" }]) {
    assert.deepEqual(ids(list, viewer), [2, 4, 5, 3, 6, 1]);
  }
});

test("paused viewer uses retained zero progress and historical completions remain readers", () => {
  const list = [entry(1, "А", "want"), entry(2, "Б", "read"), entry(3, "В", "reading", 80), entry(4, "Г", "reading", 5), entry(5, "Д", "abandoned", undefined, true), entry(6, "Е", "postponed", undefined, true), entry(7, "Ж", "abandoned"), entry(8, "З", "postponed")];
  for (const status of ["abandoned", "postponed"]) {
    assert.deepEqual(ids(list, { readingStatus: status, progressPercent: 0 }), [4, 3, 2, 5, 6, 1, 7, 8]);
    assert.deepEqual(ids(list, { readingStatus: status, progressPercent: 0, hasCompletedReading: true }), [4, 3, 2, 5, 6, 1, 7, 8], "historical completion does not override a paused viewer's retained progress");
    assert.deepEqual(ids(list, { readingStatus: status, hasCompletedReading: true }), [1, 4, 3, 2, 5, 6, 7, 8], "paused viewer without progress uses want ordering even after an earlier completion");
  }
});

test("reader sorting is deterministic by display name then user id at equal distance", () => {
  const list = [entry(9, "Борис", "reading", 40), entry(4, "Анна", "reading", 60), entry(2, "Анна", "reading", 40), entry(7, "Яна", "want")];
  assert.deepEqual(ids(list, { readingStatus: "reading", progressPercent: 50 }), [2, 4, 9, 7]);
});
