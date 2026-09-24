// Runs only as a child of the disposable MySQL suite, never against .env DBs.
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import express from "express";
import mysql from "mysql2/promise";
import { assertSafeIntegrationEnvironment, testDatabaseEnvironment } from "../scripts/db-test.mjs";
import { hashSessionToken } from "../server/security.js";

assertSafeIntegrationEnvironment();
process.env.LEGAL_CONSENT_REQUIRED = "0";
process.env.TELEGRAM_ALERTS_ENABLED = "0";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.SMTP_HOST = "";
const { default: router } = await import("../server/api.js");
const { closePool, withTransaction } = await import("../server/db.js");
const { deliverDuePostponedBookReminders } = await import("../server/modules/postponed-reminders.js");

test("TZ2 real authenticated HTTP, transactions and viewer privacy", async (t) => {
  const db = mysql.createPool({ host: testDatabaseEnvironment.DB_HOST, port: Number(testDatabaseEnvironment.DB_PORT), database: testDatabaseEnvironment.DB_NAME, user: testDatabaseEnvironment.MYSQL_TEST_ROOT_USER, password: testDatabaseEnvironment.MYSQL_TEST_ROOT_PASSWORD, timezone: "Z", decimalNumbers: true, connectionLimit: 3 });
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use((error, _request, response, _next) => response.status(error.statusCode ?? 500).json({ error: error.message, code: error.code }));
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const year = new Date().getUTCFullYear();
  const completed = { readingStatus: "read", rating: 4.5, shortReview: "HTTP reading completion", readMonth: 2, readYear: year - 1 };

  async function user(name, { role = "user", type = "Читатель", minor = false } = {}) {
    const [created] = await db.query("INSERT INTO users (username, username_key, password_hash, initials, color, role, profile_completed) VALUES (?, ?, 'test-only-hash', 'T2', 'blue', ?, 1)", [name, name, role]);
    const id = Number(created.insertId);
    await db.query("INSERT INTO profiles (user_id, display_name, city, profile_type, gender, birth_date, bio, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres, publisher_status) VALUES (?, ?, 'Астана', ?, 'Женский', ?, '', '', '', '', '', '[]', '[]', 'approved')", [id, name, type, `${year - (minor ? 15 : 30)}-01-01`]);
    const token = randomBytes(32).toString("hex");
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))", [hashSessionToken(token), id]);
    return { id, cookie: `book_meet_session=${token}` };
  }
  async function book(name, adult = false) {
    const [created] = await db.query("INSERT INTO books (author, author_key, title, title_key, genres, annotation, is_adult) VALUES ('TZ2 HTTP', 'tz2 http', ?, ?, '[]', 'Canonical metadata', ?)", [name, name, adult ? 1 : 0]);
    return Number(created.insertId);
  }
  async function call(actor, method, route, body, expected = 200, headers = {}) {
    const response = await fetch(`${origin}/api${route}`, { method, headers: { cookie: actor.cookie, "content-type": "application/json", "X-BookMeet-Timezone": "UTC", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  }
  async function count(table, actor, id, extra = "") {
    assert.ok(["reading_cycles", "user_books", "notifications"].includes(table));
    const idColumn = table === "notifications" ? "material_id" : "book_id";
    const [[row]] = await db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ? AND ${idColumn} = ? ${extra}`, [actor.id, id]);
    return Number(row.count);
  }
  const owner = await user("tz2-http-owner");
  const admin = await user("tz2-http-admin", { role: "admin" });
  try {
    await t.test("five statuses, partial fields, explicit null and active unit semantics", async () => {
      const id = await book("tz2-http-progress");
      const added = await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "reading", chaptersCurrent: 0, chaptersTotal: 10, pagesCurrent: 20, pagesTotal: 100, progressUnit: "chapters", readingComment: "private thoughts" }, 201);
      assert.equal(added.book.progressPercent, 0);
      assert.equal(added.book.chaptersCurrent, 0);
      assert.equal(added.book.readingComment, "private thoughts");
      const pages = await call(owner, "PATCH", `/books/${id}`, { pagesCurrent: 25 });
      assert.equal(pages.book.progressUnit, "pages");
      assert.equal(pages.book.progressPercent, 25);
      const cleared = await call(owner, "PATCH", `/books/${id}`, { pagesTotal: null });
      assert.equal(cleared.book.pagesTotal ?? null, null);
      assert.equal(cleared.book.progressPercent, null);
      const chapters = await call(owner, "PATCH", `/books/${id}`, { chaptersCurrent: 2 });
      assert.equal(chapters.book.progressPercent, 20);
      const onlyUnit = await call(owner, "PATCH", `/books/${id}`, { progressUnit: "pages" });
      assert.equal(onlyUnit.book.progressUnit, "chapters", "view toggles cannot change saved percent without editing a pair");
      for (const payload of [{ chaptersCurrent: 11 }, { chaptersCurrent: -1 }, { chaptersCurrent: 1.5 }, { chaptersCurrent: 4_294_967_296 }, { chaptersTotal: 0 }, { readingStatus: "rereading" }, { readingStatus: "read", rating: 5, shortReview: "missing dates" }]) await call(owner, "PATCH", `/books/${id}`, payload, 400);
      const abandoned = await call(owner, "PATCH", `/books/${id}`, { readingStatus: "abandoned", shortReview: "Stopped", rating: "irrelevant", readMonth: 99, chaptersCurrent: -1 });
      assert.equal(abandoned.book.review, "Stopped");
      assert.equal(abandoned.book.progressPercent, 20);
      assert.equal(abandoned.book.chaptersCurrent, 2);
      assert.equal(abandoned.book.rating ?? 0, 0);
      assert.ok(!Object.hasOwn(abandoned.book, "readingComment"));
      const wanted = await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "want", rating: "irrelevant", chaptersCurrent: -1, featuredMonth: 99, publicationYear: -1 }, 201);
      assert.equal(wanted.book.chaptersCurrent, 2, "POST preserves inactive stored progress just like PATCH");
      assert.equal(wanted.book.review, "");
    });

    await t.test("reread history, same-status corrections and library-only deletion", async () => {
      const id = await book("tz2-http-history");
      await call(owner, "POST", "/books", { useExistingId: id, ...completed }, 201);
      assert.equal(await count("reading_cycles", owner, id, "AND status = 'completed'"), 1);
      const corrected = await call(owner, "PATCH", `/books/${id}`, { readMonth: 3 });
      assert.equal(corrected.book.review, completed.shortReview, "partial SQL-row patch must preserve short_review");
      await call(owner, "PATCH", `/books/${id}`, { readingStatus: "reading", chaptersCurrent: 0, chaptersTotal: 10 });
      await call(owner, "PATCH", `/books/${id}`, { ...completed, readMonth: 4 });
      await Promise.all([call(owner, "PATCH", `/books/${id}`, { shortReview: "edited once" }), call(owner, "PATCH", `/books/${id}`, { rating: 5 })]);
      assert.equal(await count("reading_cycles", owner, id, "AND status = 'completed'"), 2);
      assert.equal(await count("user_books", owner, id), 1);
      const [cycles] = await db.query("SELECT completed_month FROM reading_cycles WHERE user_id = ? AND book_id = ? ORDER BY id", [owner.id, id]);
      assert.deepEqual(cycles.map((row) => row.completed_month), [3, 4]);
      await call(owner, "DELETE", `/books/${id}`);
      assert.equal(await count("reading_cycles", owner, id, "AND status = 'completed'"), 2);
      assert.equal(await count("user_books", owner, id), 0);
      const bootstrap = await call(owner, "GET", "/bootstrap/catalog");
      assert.equal(bootstrap.users.find((item) => item.id === owner.id).readingHistory.filter((item) => item.bookId === id).length, 2);
      const readded = await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "want" }, 201);
      assert.equal(readded.readingHistory.filter((item) => item.bookId === id).length, 2);
    });

    await t.test("Top-3 partial patch, removal and rating aggregation regression", async () => {
      const id = await book("tz2-http-top-three");
      const added = await call(owner, "POST", "/books", { useExistingId: id, ...completed, top3: true }, 201);
      assert.ok(added.book.topRank);
      const changed = await call(owner, "PATCH", `/books/${id}`, { shortReview: "Still a favourite" });
      assert.equal(changed.book.topRank, added.book.topRank);
      const removed = await call(owner, "PATCH", `/books/${id}`, { top3: false });
      assert.equal(removed.book.topRank, undefined);
      const catalog = await call(owner, "GET", "/books/catalog?q=tz2-http-top-three");
      assert.equal(catalog.books.find((item) => item.id === id).ratingCount, 1);
      assert.equal(catalog.books.find((item) => item.id === id).averageRating, 4.5);
      await call(owner, "PATCH", `/books/${id}`, { top3: true });
      const reread = await call(owner, "PATCH", `/books/${id}`, { readingStatus: "reading" });
      assert.equal(reread.book.topRank, undefined);
    });

    await t.test("postponed schedule combinations, concurrent dedupe and date-reset generations", async () => {
      const id = await book("tz2-http-postponed");
      const added = await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "postponed", postponedYear: year - 1, postponedMonth: null }, 201);
      assert.equal(added.book.postponedOverdue, true);
      assert.equal(await count("notifications", owner, id, "AND notification_type = 'postponed_book'"), 1);
      await Promise.all(Array.from({ length: 4 }, (_, index) => call(owner, "PATCH", `/books/${id}`, { readingComment: `schedule comment ${index}` })));
      await call(owner, "GET", "/bootstrap/social");
      await call(owner, "GET", "/bootstrap/social");
      assert.equal(await count("notifications", owner, id), 1);
      await call(owner, "PATCH", `/books/${id}`, { postponedYear: year - 2 });
      await call(owner, "PATCH", `/books/${id}`, { postponedYear: year - 1 });
      assert.equal(await count("notifications", owner, id), 3, "returning to an earlier date is a new scheduled period after reset");
      const future = await call(owner, "PATCH", `/books/${id}`, { postponedYear: year + 1 });
      assert.equal(future.book.postponedOverdue, false);
      assert.equal(await count("notifications", owner, id), 3);
      const monthOnly = await call(owner, "PATCH", `/books/${id}`, { postponedMonth: 12, postponedYear: null });
      assert.equal(monthOnly.book.postponedYear, year);
      const empty = await call(owner, "PATCH", `/books/${id}`, { postponedMonth: null, postponedYear: null });
      assert.equal(empty.book.postponedMonth ?? null, null);
      assert.equal(empty.book.postponedYear ?? null, null);
      assert.equal(empty.book.postponedOverdue, false);
    });

    await t.test("worker honours local year boundaries and concurrent delivery commits once", async () => {
      // Future rows ordered before the due rows cannot permanently consume
      // the worker's bounded scan and starve reminders behind them.
      for (let index = 0; index < 3; index += 1) {
        const id = await book(`tz2-http-worker-future-${index}`);
        await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "postponed", postponedYear: year + 2 }, 201);
      }
      for (let index = 0; index < 3; index += 1) {
        const id = await book(`tz2-http-worker-year-only-${index}`);
        await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "postponed", postponedYear: year }, 201, { "X-BookMeet-Timezone": "America/Los_Angeles" });
      }
      const east = await book("tz2-http-worker-east");
      const west = await book("tz2-http-worker-west");
      for (const [id, timezone] of [[east, "Pacific/Kiritimati"], [west, "America/Los_Angeles"]]) {
        await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "postponed", postponedMonth: 12, postponedYear: year }, 201, { "X-BookMeet-Timezone": timezone });
      }
      let broadcasts = 0;
      const broadcast = () => { broadcasts += 1; };
      const first = await deliverDuePostponedBookReminders({ withTransaction, now: new Date(`${year}-12-31T23:30:00Z`), broadcast, limit: 2 });
      assert.equal(first, 1);
      assert.equal(broadcasts, 1);
      assert.equal(await count("notifications", owner, east), 1);
      assert.equal(await count("notifications", owner, west), 0);
      const next = await Promise.all(Array.from({ length: 3 }, () => deliverDuePostponedBookReminders({ withTransaction, now: new Date(`${year + 1}-01-01T09:00:00Z`), broadcast })));
      assert.equal(next.reduce((sum, value) => sum + value, 0), 4);
      assert.equal(broadcasts, 2, "no-op scans must not broadcast");
      assert.equal(await count("notifications", owner, west), 1);
    });

    await t.test("owner/friend/stranger/blocked/minor data matrix is enforced by the server", async () => {
      const friend = await user("tz2-http-friend");
      const stranger = await user("tz2-http-stranger");
      const minor = await user("tz2-http-minor", { minor: true });
      const id = await book("tz2-http-private");
      await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "reading", pagesCurrent: 30, pagesTotal: 100, readingComment: "OWNER_PRIVATE_TZ2" }, 201);
      await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [Math.min(owner.id, friend.id), Math.max(owner.id, friend.id)]);
      for (const viewer of [friend, stranger]) {
        const bootstrap = await call(viewer, "GET", "/bootstrap/catalog");
        const other = bootstrap.users.find((item) => item.id === owner.id);
        const projected = other.books.find((item) => item.id === id);
        assert.equal(projected.progressPercent, 30);
        for (const key of ["pagesCurrent", "pagesTotal", "chaptersCurrent", "chaptersTotal", "progressUnit", "lastReadChapter", "readingComment", "postponedMonth", "postponedYear"]) assert.ok(!Object.hasOwn(projected, key), `private ${key} leaked to ${viewer.id}`);
        assert.ok(!Object.hasOwn(other, "readingHistory"));
        assert.ok(!JSON.stringify(bootstrap).includes("OWNER_PRIVATE_TZ2"));
      }
      for (const [blocker, blocked] of [[stranger, owner], [owner, stranger]]) {
        await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [blocker.id, blocked.id]);
        const bootstrap = await call(stranger, "GET", "/bootstrap/catalog");
        assert.ok(!bootstrap.users.find((item) => item.id === owner.id)?.books?.some((item) => item.id === id), "blocked reader state must be absent in either block direction");
        const ownerSocial = await call(owner, "GET", "/bootstrap/social");
        assert.ok(ownerSocial.notifications.some((entry) => entry.type === "postponed_book"), "blocking never hides own due-book notifications");
        await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [blocker.id, blocked.id]);
      }
      const minorView = await call(minor, "GET", "/bootstrap/catalog");
      assert.ok(!minorView.users.find((item) => item.id === owner.id)?.books?.some((item) => item.id === id), "reader lists obey cross-age privacy");
      await call(stranger, "PATCH", `/books/${id}`, { readingStatus: "want", userId: owner.id }, 404);
      const adultId = await book("tz2-http-adult", true);
      await call(minor, "POST", "/books", { useExistingId: adultId, readingStatus: "want" }, 403);
      const changedAge = await user("tz2-http-changed-age");
      await call(changedAge, "POST", "/books", { useExistingId: adultId, ...completed }, 201);
      const safeId = await book("tz2-http-safe-age");
      await call(changedAge, "POST", "/books", { useExistingId: safeId, readingStatus: "want" }, 201);
      await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [`${year - 15}-01-01`, changedAge.id]);
      await call(changedAge, "PATCH", `/books/${adultId}`, { readingStatus: "want" }, 403);
      const safeMutation = await call(changedAge, "PATCH", `/books/${safeId}`, { readingStatus: "reading" });
      assert.ok(!safeMutation.readingHistory.some((entry) => entry.bookId === adultId), "full mutation response must retain the owner age filter for historical books too");
      const community = await user("tz2-http-community", { type: "Сообщество" });
      await call(community, "POST", "/community-books", { bookId: id }, 201);
      await call(community, "PATCH", `/books/${id}`, { readingStatus: "reading" }, 403);
      assert.equal(await count("reading_cycles", community, id), 0);
    });

    await t.test("failed cycle and notification inserts roll back the entire status transition", async () => {
      const id = await book("tz2-http-rollback");
      await call(owner, "POST", "/books", { useExistingId: id, readingStatus: "want" }, 201);
      await db.query("CREATE TRIGGER tz2_reject_cycle BEFORE INSERT ON reading_cycles FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TZ2 deliberate cycle failure'");
      try { await call(owner, "PATCH", `/books/${id}`, completed, 500); }
      finally { await db.query("DROP TRIGGER tz2_reject_cycle"); }
      const [[afterCycle]] = await db.query("SELECT reading_status FROM user_books WHERE user_id = ? AND book_id = ?", [owner.id, id]);
      assert.equal(afterCycle.reading_status, "want");
      assert.equal(await count("reading_cycles", owner, id), 0);
      await db.query("CREATE TRIGGER tz2_reject_notification BEFORE INSERT ON notifications FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TZ2 deliberate notification failure'");
      try { await call(owner, "PATCH", `/books/${id}`, { readingStatus: "postponed", postponedYear: year - 1 }, 500); }
      finally { await db.query("DROP TRIGGER tz2_reject_notification"); }
      const [[afterNotification]] = await db.query("SELECT reading_status, postponed_notified_at FROM user_books WHERE user_id = ? AND book_id = ?", [owner.id, id]);
      assert.equal(afterNotification.reading_status, "want");
      assert.equal(afterNotification.postponed_notified_at, null);
      assert.equal(await count("notifications", owner, id), 0);
    });

    await t.test("account finalization purges retained cycles but preserves the canonical book", async () => {
      const retiring = await user("tz2-http-retiring");
      const id = await book("tz2-http-retained");
      await call(retiring, "POST", "/books", { useExistingId: id, ...completed }, 201);
      await call(retiring, "DELETE", `/books/${id}`);
      assert.equal(await count("reading_cycles", retiring, id), 1);
      await call(retiring, "DELETE", "/users/me/profile");
      await call(admin, "DELETE", `/admin/users/${retiring.id}/permanent`);
      assert.equal(await count("reading_cycles", retiring, id), 0);
      const [[canonical]] = await db.query("SELECT id FROM books WHERE id = ?", [id]);
      assert.equal(Number(canonical.id), id);
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closePool();
    await db.end();
  }
});
