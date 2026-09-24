import assert from "node:assert/strict";
import test from "node:test";
import { decodeMessageSearchCursor, encodeMessageSearchCursor, messageMatchesSearch, messageSearchSnippet, normalizeMessageSearchQuery } from "../server/modules/message-search.js";

test("message search validates bounded FULLTEXT-compatible tokens", () => {
  assert.deepEqual(normalizeMessageSearchQuery("  Книжный   клуб  "), { text: "Книжный   клуб", tokens: ["книжный", "клуб"], booleanQuery: "+книжный* +клуб*" });
  assert.deepEqual(normalizeMessageSearchQuery("слово+другое*третий").tokens, ["слово", "другое", "третий"], "boolean operators must never enter the bound FULLTEXT expression");
  assert.throws(() => normalizeMessageSearchQuery(""), (error) => error.code === "MESSAGE_SEARCH_QUERY_REQUIRED");
  assert.throws(() => normalizeMessageSearchQuery("я"), (error) => error.code === "MESSAGE_SEARCH_QUERY_TOO_SHORT");
  assert.throws(() => normalizeMessageSearchQuery("раз два три четыре пять шесть семь восемь девять"), /не более 8/);
});

test("demo matcher mirrors all-token prefix behavior and snippets stay plain text", () => {
  const search = normalizeMessageSearchQuery("книж клуб");
  assert.equal(messageMatchesSearch("Сегодня обсуждаем книжный клуб", search.tokens), true);
  assert.equal(messageMatchesSearch("Сегодня обсуждаем книжный вечер", search.tokens), false);
  const snippet = messageSearchSnippet(`Начало ${"длинный ".repeat(30)} книжный клуб завершение`, search.tokens, 80);
  assert.ok(snippet.length <= 82);
  assert.match(snippet, /книжный клуб/);
  assert.doesNotMatch(snippet, /<mark>|<script>/);
});

test("message search cursor is opaque, stable and rejects tampering", () => {
  const encoded = encodeMessageSearchCursor({ id: 42, createdAt: "2026-09-17T12:00:00.000Z" });
  const decoded = decodeMessageSearchCursor(encoded);
  assert.equal(decoded.id, 42);
  assert.equal(decoded.createdAt.toISOString(), "2026-09-17T12:00:00.000Z");
  assert.throws(() => decodeMessageSearchCursor("not-a-cursor"), (error) => error.code === "MESSAGE_SEARCH_CURSOR_INVALID");
});
