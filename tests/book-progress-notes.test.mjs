import assert from "node:assert/strict";
import test from "node:test";
import { expectedProgress, noteBody, noteCursor, progressSnapshot, sameProgress } from "../server/modules/book-progress-notes.js";

test("book progress note input uses one authoritative uint32 snapshot", () => {
  assert.deepEqual(progressSnapshot({ unit: "chapters", current: 3, total: 8 }), { unit: "chapters", current: 3, total: 8, percent: 37 });
  assert.equal(progressSnapshot({ unit: "pages", current: 3, total: 0 }), null);
  assert.equal(progressSnapshot({ unit: "pages", current: 4_294_967_296, total: 4_294_967_296 }), null);
  assert.ok(sameProgress(expectedProgress({ unit: "pages", current: 10, total: 10, percent: 100 }), { unit: "pages", current: 10, total: 10, percent: 100 }));
  assert.throws(() => expectedProgress({ unit: "pages", current: 1, total: 3, percent: 34 }), /ожидаемый прогресс/);
  assert.equal(noteBody("  заметка  "), "заметка");
  assert.throws(() => noteBody(" "), /от 1 до 3000/);
  assert.equal(noteCursor(undefined), null);
  assert.equal(noteCursor("42"), 42);
  assert.throws(() => noteCursor("4.2"), /курсор/);
});
