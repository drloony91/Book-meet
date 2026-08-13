import test from "node:test";
import assert from "node:assert/strict";
import { matchesBookQuery, normalizeBookSearchText } from "../app/lib/domain.ts";

const book = {
  title: "«Мастер и Маргарита»",
  author: "Михаил Афанасьевич Булгаков",
  isbn: "978-5-17-090630-7",
  publisher: "АСТ",
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
