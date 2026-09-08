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
    await t.test("goals are private, validate periods and return server-computed statistics", async () => {
      const created = await call(owner, "POST", "/reading-goals", { goalKind: "month", targetYear: year, targetMonth: new Date().getUTCMonth() + 1, targetCount: 2 }, 201);
      assert.equal(created.goal.targetCount, 2);
      await call(owner, "POST", "/reading-goals", { goalKind: "month", targetYear: year, targetMonth: new Date().getUTCMonth() + 1, targetCount: 2 }, 409);
      const changed = await call(owner, "PATCH", `/reading-goals/${created.goal.id}`, { targetCount: 3 });
      assert.equal(changed.goal.targetCount, 3);
      const statistics = await call(owner, "GET", `/reading-statistics?year=${year}`);
      assert.equal(statistics.goals[0].projection.target, 3);
      const peer = await login(4);
      assert.deepEqual((await call(peer, "GET", "/reading-goals")).goals, []);
      assert.equal(Object.hasOwn((await call(peer, "GET", "/bootstrap")).users.find((user) => user.id === 3), "readingGoals"), false);
      await call(owner, "DELETE", `/reading-goals/${created.goal.id}`);
    });
    await t.test("notes keep frozen progress, enforce the spoiler gate, and reset after report moderation", async () => {
      await call(null, "POST", "/__test__/reset");
      const adminAuthor = await login(1);
      const viewer = await login(3);
      const bookId = 24;
      await call(adminAuthor, "POST", "/books", { useExistingId: bookId, readingStatus: "reading", chaptersCurrent: 41, chaptersTotal: 100, progressUnit: "chapters" }, 201);
      const created = await call(adminAuthor, "POST", `/books/${bookId}/notes`, { body: "Секрет на сорок первом проценте" }, 201);
      assert.equal(created.note.progressPercent, 41);
      await call(viewer, "PATCH", `/books/${bookId}`, { readingStatus: "reading", chaptersCurrent: 40, chaptersTotal: 100, progressUnit: "chapters" });
      const gated = await call(viewer, "GET", `/books/${bookId}/notes?scope=all`);
      assert.equal(gated.notes.some((note) => note.id === created.note.id), false);
      await call(viewer, "PATCH", `/books/${bookId}`, { readingStatus: "read", rating: 4, shortReview: "Прочитано", readMonth: 1, readYear: year });
      assert.equal((await call(viewer, "GET", `/books/${bookId}/notes?scope=all`)).notes[0].id, created.note.id);
      const report = await call(viewer, "POST", "/reports", { targetKind: "book_note", targetId: created.note.id, reason: "Проверка заметки" }, 201);
      await call(adminAuthor, "POST", `/admin/reports/${report.id}/delete-material`, { reason: "Удалено модератором" });
      assert.deepEqual((await call(adminAuthor, "GET", `/books/${bookId}/notes?scope=mine`)).notes, []);
      await call(null, "POST", "/__test__/reset");
      assert.deepEqual((await call(await login(1), "GET", `/books/${bookId}/notes?scope=mine`)).notes, []);
    });
    await t.test("shelves preserve ordered own-library books and batch additions", async () => {
      await call(null, "POST", "/__test__/reset");
      const shelfOwner = await login(3); const shelfViewer = await login(4);
      const created = await call(shelfOwner, "POST", "/shelves", { title: "Демо-полка", description: "Проверка", items: [{ bookId: 24, description: "Первая" }] }, 201);
      assert.equal(created.shelf.items[0].position, 0);
      assert.equal((await call(shelfViewer, "GET", `/users/3/shelves`)).shelves[0].id, created.shelf.id);
      const added = await call(shelfViewer, "POST", `/shelves/${created.shelf.id}/add-to-library`, {});
      assert.equal(added.addedCount, 1); assert.equal(added.addedBooks[0].readingStatus, "want");
      assert.equal((await call(shelfViewer, "POST", `/shelves/${created.shelf.id}/add-to-library`, {})).skippedExistingCount, 1);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
