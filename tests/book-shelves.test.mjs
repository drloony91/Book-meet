import assert from "node:assert/strict";
import test from "node:test";
import { shelfCursor, shelfPayload } from "../server/modules/book-shelves.js";

test("shelf payload uses code-point limits, strict fields and stable positions", () => {
  const title = "📚".repeat(120);
  const value = shelfPayload({ title, description: "", items: [{ bookId: 2, description: "Первая" }, { bookId: 1, description: "Вторая" }] });
  assert.equal(value.title, title);
  assert.deepEqual(value.items.map((item) => [item.bookId, item.position]), [[2, 0], [1, 1]]);
  assert.throws(() => shelfPayload({ title: "📚".repeat(121), description: "", items: [{ bookId: 1, description: "" }] }), /Название/);
  assert.throws(() => shelfPayload({ title: "x", description: "", items: [{ bookId: 1, description: "" }, { bookId: 1, description: "" }] }), /повторяться/);
  assert.throws(() => shelfPayload({ title: "x", description: "", items: [] }), /хотя бы одну/);
});

test("shelf cursor accepts only a positive safe integer", () => {
  assert.equal(shelfCursor(undefined), null);
  assert.equal(shelfCursor("8"), 8);
  for (const value of ["0", "-1", "1.2", "bad", String(Number.MAX_SAFE_INTEGER + 1)]) assert.throws(() => shelfCursor(value));
});
