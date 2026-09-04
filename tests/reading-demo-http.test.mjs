import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

// Exercise the browser adapter over HTTP so it cannot hide a DTO/privacy
// regression that the production MySQL matrix already rejects.
test("demo reading API shares production state, history and privacy contracts", async (t) => {
  process.env.DEMO_MODE = "1";
  const { default: router } = await import("../server/demo-api.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use((error, _request, response, _next) => response.status(error.statusCode ?? 500).json({ error: error.message, code: error.code }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (id) => {
    const response = await fetch(`${base}/auth/demo-login?user=${id}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const call = async (cookie, method, path, body, status = 200) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie ?? "", "Content-Type": "application/json", "X-BookMeet-Timezone": "UTC" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
    return value;
  };
  try {
    await call(null, "POST", "/__test__/reset");
    const owner = await login(3);
    const bookId = 24;
    const year = new Date().getUTCFullYear();
    await t.test("canonical identity, five statuses and full mutation DTO", async () => {
      const initial = await call(owner, "GET", "/bootstrap");
      assert.equal(initial.users.find((user) => user.id === 3).books[0].id, bookId);
      assert.equal(initial.books.filter((book) => book.id === bookId).length, 1);
      let result = await call(owner, "PATCH", `/books/${bookId}`, { readingStatus: "reading", chaptersCurrent: 0, chaptersTotal: 10, readingComment: "PRIVATE_DEMO_READING" });
      assert.equal(result.book.progressPercent, 0);
      assert.equal(result.book.hasCompletedReading, true);
      assert.equal(result.readingHistory.length, 1);
      result = await call(owner, "PATCH", `/books/${bookId}`, { pagesCurrent: 25, pagesTotal: 100 });
      assert.equal(result.book.progressUnit, "pages");
      assert.equal(result.book.progressPercent, 25);
      result = await call(owner, "PATCH", `/books/${bookId}`, { progressUnit: "chapters" });
      assert.equal(result.book.progressUnit, "pages");
      await call(owner, "PATCH", `/books/${bookId}`, { pagesCurrent: 101 }, 400);
      for (const state of ["abandoned", "want", "postponed", "reading"]) {
        result = await call(owner, "PATCH", `/books/${bookId}`, { readingStatus: state });
        assert.equal(result.book.readingStatus, state);
        assert.equal(result.book.pagesCurrent, 25);
        if (!["reading", "postponed"].includes(state)) assert.equal(result.book.readingComment, undefined);
      }
      await call(owner, "PATCH", `/books/${bookId}`, { readingStatus: "read" }, 400);
      result = await call(owner, "PATCH", `/books/${bookId}`, { readingStatus: "read", rating: 4.5, shortReview: "Завершено", readMonth: 1, readYear: year, top3: true });
      assert.equal(result.readingHistory.length, 2);
      assert.equal(result.book.hasCompletedReading, true);
      assert.equal(result.book.topRank, 1);
      result = await call(owner, "POST", "/books", { useExistingId: bookId, rating: 5 }, 201);
      assert.equal(result.readingHistory.length, 2);
      assert.equal(result.book.topRank, 1);
      assert.equal(result.book.review, "Завершено");
    });
    await t.test("due notification is stable across PATCH, POST and refresh but resets for a changed date", async () => {
      const payload = { readingStatus: "postponed", postponedMonth: 1, postponedYear: year - 1, readingComment: "PRIVATE_POSTPONED" };
      await call(owner, "PATCH", `/books/${bookId}`, payload);
      await call(owner, "POST", "/books", { useExistingId: bookId, ...payload }, 201);
      await call(owner, "PATCH", `/books/${bookId}`, { readingComment: "PRIVATE_UPDATED" });
      let state = await call(owner, "GET", "/bootstrap");
      assert.equal(state.notifications.filter((entry) => entry.type === "postponed_book").length, 1);
      const book = state.users.find((user) => user.id === 3).books.find((item) => item.id === bookId);
      assert.equal(book.postponedOverdue, true);
      assert.equal(book.postponedNotifiedAt, undefined);
      await call(owner, "PATCH", `/books/${bookId}`, { postponedMonth: 2 });
      await call(owner, "PATCH", `/books/${bookId}`, { postponedMonth: 1 });
      state = await call(owner, "GET", "/bootstrap");
      assert.equal(state.notifications.filter((entry) => entry.type === "postponed_book").length, 3);
    });
    await t.test("canonical catalog and another reader never expose personal progress fields", async () => {
      const created = await call(owner, "POST", "/books", { author: "Demo Author", title: "Private state isolation", readingStatus: "reading", chaptersCurrent: 2, chaptersTotal: 10, readingComment: "PRIVATE_CATALOG_SENTINEL" }, 201);
      assert.equal(created.book.progressPercent, 20);
      await call(null, "POST", "/__test__/chat-scenario", undefined, 201);
      const peer = await login(4);
      const state = await call(peer, "GET", "/bootstrap");
      const publicBook = state.users.find((user) => user.id === 3).books.find((book) => book.id === created.bookId);
      assert.equal(publicBook.progressPercent, 20);
      for (const key of ["chaptersCurrent", "chaptersTotal", "pagesCurrent", "pagesTotal", "progressUnit", "lastReadChapter", "readingComment", "postponedMonth", "postponedYear", "postponedNotifiedAt", "postponedTimezone"]) {
        assert.equal(publicBook[key], undefined, `private viewer field ${key}`);
        assert.equal(state.books.find((book) => book.id === created.bookId)[key], undefined, `private catalog field ${key}`);
      }
      assert.equal(JSON.stringify(state).includes("PRIVATE_"), false);
      const minor = await login(7);
      const minorState = await call(minor, "GET", "/bootstrap");
      assert.equal(minorState.users.find((user) => user.id === 3)?.books.length ?? 0, 0);
    });
    await t.test("library removal keeps completed history and canonical book", async () => {
      await call(owner, "DELETE", `/books/${bookId}`);
      const state = await call(owner, "GET", "/bootstrap");
      const user = state.users.find((entry) => entry.id === 3);
      assert.equal(user.books.some((book) => book.id === bookId), false);
      assert.equal(user.readingHistory.filter((entry) => entry.bookId === bookId).length, 2);
      assert.equal(state.books.some((book) => book.id === bookId), true);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
