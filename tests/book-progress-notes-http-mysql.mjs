import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

async function reading(fixture, actor, bookId, current, total, unit = "chapters") {
  const columns = unit === "chapters" ? [current, total, null, null] : [null, null, current, total];
  await fixture.db.query(
    "INSERT INTO user_books (user_id, book_id, reading_status, chapters_current, chapters_total, pages_current, pages_total, progress_unit, is_author) VALUES (?, ?, 'reading', ?, ?, ?, ?, ?, 0)",
    [actor.id, bookId, ...columns, unit],
  );
  const [cycle] = await fixture.db.query("INSERT INTO reading_cycles (user_id, book_id, status) VALUES (?, ?, 'active')", [actor.id, bookId]);
  return Number(cycle.insertId);
}

async function create(fixture, actor, bookId, current, total, body, unit = "chapters") {
  return fixture.call(actor, "POST", `/books/${bookId}/notes`, { body, expectedProgress: { unit, current, total, percent: Math.floor(current / total * 100) } }, 201);
}

test("TZ3 notes: real HTTP authorization, frozen snapshots, spoiler filtering and moderation", async (t) => {
  const fixture = await queue3HttpFixture("q3-notes");
  const { db, user, book, call, request } = fixture;
  try {
    const author = await user("author");
    const lower = await user("lower");
    const equal = await user("equal");
    const higher = await user("higher");
    const reader = await user("reader");
    const wanter = await user("wanter");
    const unknown = await user("unknown");
    const minor = await user("minor", { minor: true });
    const admin = await user("admin", { role: "admin" });
    const id = await book("visibility");
    await reading(fixture, author, id, 0, 10);
    const zero = (await create(fixture, author, id, 0, 10, "Нулевая заметка")).note;
    await db.query("UPDATE user_books SET chapters_current = 40, chapters_total = 100 WHERE user_id = ? AND book_id = ?", [author.id, id]);
    const forty = (await create(fixture, author, id, 40, 100, "Сорок процентов")).note;
    await db.query("UPDATE user_books SET chapters_current = 60 WHERE user_id = ? AND book_id = ?", [author.id, id]);
    const sixty = (await create(fixture, author, id, 60, 100, "Шестьдесят процентов")).note;

    await reading(fixture, lower, id, 39, 100);
    await reading(fixture, equal, id, 40, 100);
    await reading(fixture, higher, id, 80, 100);
    await db.query("INSERT INTO user_books (user_id, book_id, reading_status, is_author) VALUES (?, ?, 'read', 0), (?, ?, 'want', 0), (?, ?, 'reading', 0)", [reader.id, id, wanter.id, id, unknown.id, id]);
    const visible = async (actor) => (await call(actor, "GET", `/books/${id}/notes?scope=all`)).notes.map((note) => note.id).sort((a, b) => a - b);
    assert.deepEqual(await visible(lower), [zero.id]);
    assert.deepEqual(await visible(equal), [zero.id, forty.id]);
    assert.deepEqual(await visible(higher), [zero.id, forty.id, sixty.id]);
    assert.deepEqual(await visible(reader), [zero.id, forty.id, sixty.id]);
    assert.deepEqual(await visible(wanter), [zero.id]);
    assert.deepEqual(await visible(unknown), [zero.id]);
    await db.query("UPDATE user_books SET chapters_current = 40, chapters_total = NULL, progress_unit = 'chapters' WHERE user_id = ? AND book_id = ?", [unknown.id, id]);
    assert.deepEqual(await visible(unknown), [zero.id], "an active status with a NULL total still receives only the zero-percent note");
    await db.query("UPDATE user_books SET progress_unit = NULL WHERE user_id = ? AND book_id = ?", [unknown.id, id]);
    assert.deepEqual(await visible(unknown), [zero.id], "an active status with a NULL unit still receives only the zero-percent note");
    assert.deepEqual((await call(author, "GET", `/books/${id}/notes?scope=mine`)).notes.map((note) => note.id).sort((a, b) => a - b), [zero.id, forty.id, sixty.id]);
    await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [lower.id, author.id]);
    assert.deepEqual(await visible(lower), []);
    await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [lower.id, author.id]);
    await db.query("INSERT INTO user_hides (hider_user_id, hidden_user_id) VALUES (?, ?)", [lower.id, author.id]);
    assert.deepEqual(await visible(lower), []);

    await t.test("create and patch reject forged snapshots but preserve the original snapshot", async () => {
      await call(author, "POST", `/books/${id}/notes`, { body: "x", progressCurrent: 99 }, 400);
      await call(author, "POST", `/books/${id}/notes`, { body: "x", expectedProgress: { unit: "chapters", current: 1, total: 10, percent: 10 } }, 409);
      await call(author, "PATCH", `/book-notes/${forty.id}`, { body: "Изменённый текст", progressPercent: 99 }, 400);
      const patched = await call(author, "PATCH", `/book-notes/${forty.id}`, { body: "Изменённый текст" });
      assert.equal(patched.note.progressCurrent, 40); assert.equal(patched.note.progressTotal, 100); assert.equal(patched.note.progressPercent, 40);
      await db.query("UPDATE user_books SET reading_status = 'abandoned' WHERE user_id = ? AND book_id = ?", [author.id, id]);
      assert.equal((await call(author, "PATCH", `/book-notes/${forty.id}`, { body: "Можно править после статуса" })).note.body, "Можно править после статуса");
    });

    await t.test("age, cursor, report visibility and admin deletion are server enforced", async () => {
      const adult = await book("adult", true);
      await call(minor, "GET", `/books/${adult}/notes?scope=all`, undefined, 404);
      await call(equal, "GET", `/books/${id}/notes?scope=all&cursor=bad`, undefined, 400);
      const report = await call(equal, "POST", "/reports", { targetKind: "book_note", targetId: forty.id, reason: "Проверка модерации" }, 201);
      await call(lower, "POST", "/reports", { targetKind: "book_note", targetId: sixty.id, reason: "Не должен видеть" }, 404);
      await call(admin, "POST", `/admin/reports/${report.id}/delete-material`, { reason: "Удалено модератором" });
      assert.equal((await call(author, "GET", `/books/${id}/notes?scope=mine`)).notes.some((note) => note.id === forty.id), false);
      const [[removed]] = await db.query("SELECT COUNT(*) AS total FROM book_progress_notes WHERE id = ?", [forty.id]);
      assert.equal(Number(removed.total), 0);
    });
  } finally { await fixture.close(); }
});
