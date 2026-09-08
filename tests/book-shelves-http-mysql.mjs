import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

async function library(db, user, book, status = "read") {
  await db.query("INSERT INTO user_books (user_id, book_id, reading_status, is_author) VALUES (?, ?, ?, 0)", [user.id, book, status]);
}

test("TZ3 shelves: real HTTP CRUD, visibility, actions and atomic batch add", async (t) => {
  const fixture = await queue3HttpFixture("q3-shelves");
  const { db, user, book, call, request } = fixture;
  try {
    const owner = await user("owner"); const viewer = await user("viewer"); const minor = await user("minor", { minor: true }); const admin = await user("admin", { role: "admin" });
    const first = await book("first"); const second = await book("second"); const adult = await book("adult", true);
    await library(db, owner, first); await library(db, owner, second); await library(db, owner, adult);
    const created = await call(owner, "POST", "/shelves", { title: "Осеннее чтение", description: "Книги на осень", items: [{ bookId: second, description: "Начать со второй" }, { bookId: first, description: "Потом первая" }] }, 201);
    const shelf = created.shelf;
    assert.deepEqual(shelf.items.map((item) => item.bookId), [second, first]);
    assert.deepEqual((await call(viewer, "GET", `/users/${owner.id}/shelves`)).shelves.map((item) => item.id), [shelf.id]);
    assert.equal((await call(viewer, "GET", `/shelves/${shelf.id}`)).shelf.items[0].description, "Начать со второй");

    await t.test("owner edit rejects duplicates and keeps order transactionally", async () => {
      await call(owner, "PATCH", `/shelves/${shelf.id}`, { title: "x", description: "", items: [{ bookId: first, description: "" }, { bookId: first, description: "" }] }, 400);
      const changed = await call(owner, "PATCH", `/shelves/${shelf.id}`, { title: "Обновлённая полка", description: "Описание", items: [{ bookId: first, description: "Первой" }, { bookId: second, description: "Второй" }] });
      assert.deepEqual(changed.shelf.items.map((item) => [item.bookId, item.position, item.description]), [[first, 0, "Первой"], [second, 1, "Второй"]]);
      await call(owner, "POST", "/shelves", { title: "Ошибка", description: "", items: [{ bookId: 999999999, description: "" }] }, 409);
    });

    await t.test("batch add is idempotent, preserves statuses and returns authoritative additions", async () => {
      const firstBatch = await call(viewer, "POST", `/shelves/${shelf.id}/add-to-library`, {});
      assert.deepEqual([firstBatch.addedCount, firstBatch.skippedExistingCount, firstBatch.skippedUnavailableCount], [2, 0, 0]);
      assert.deepEqual(firstBatch.addedBooks.map((item) => [item.catalogBookId, item.readingStatus]), [[first, "want"], [second, "want"]]);
      await db.query("UPDATE user_books SET reading_status = 'reading' WHERE user_id = ? AND book_id = ?", [viewer.id, first]);
      const outcomes = await Promise.all([request(viewer, "POST", `/shelves/${shelf.id}/add-to-library`, {}), request(viewer, "POST", `/shelves/${shelf.id}/add-to-library`, {})]);
      assert.deepEqual(outcomes.map((item) => item.status), [200, 200]);
      assert.equal(outcomes[0].data.addedCount + outcomes[1].data.addedCount, 0);
      const [[preserved]] = await db.query("SELECT reading_status FROM user_books WHERE user_id = ? AND book_id = ?", [viewer.id, first]);
      assert.equal(preserved.reading_status, "reading");
    });

    await t.test("adult filtering, block/hide and all material actions are server enforced", async () => {
      const adultShelf = (await call(owner, "POST", "/shelves", { title: "18+", description: "", items: [{ bookId: adult, description: "" }] }, 201)).shelf;
      const minorDetail = await call(minor, "GET", `/shelves/${adultShelf.id}`);
      assert.equal(minorDetail.shelf.items[0].bookId, null); assert.equal(minorDetail.shelf.items[0].book, null);
      const minorBatch = await call(minor, "POST", `/shelves/${adultShelf.id}/add-to-library`, {});
      assert.equal(minorBatch.skippedUnavailableCount, 1);
      await call(viewer, "POST", "/reactions", { materialKind: "shelf", materialId: shelf.id }, 201);
      await call(viewer, "POST", "/saves", { materialKind: "shelf", materialId: shelf.id }, 201);
      await call(viewer, "POST", "/comments", { materialKind: "shelf", materialId: shelf.id, body: "Хорошая полка" }, 201);
      assert.equal((await call(viewer, "GET", "/reactions?kind=shelf&id=" + shelf.id)).userIds.includes(viewer.id), true);
      assert.equal((await call(viewer, "GET", "/saves?kind=shelf&id=" + shelf.id)).saved, true);
      assert.equal((await call(viewer, "GET", "/comments?kind=shelf&id=" + shelf.id)).comments.length, 1);
      await db.query("INSERT INTO user_hides (hider_user_id, hidden_user_id) VALUES (?, ?)", [viewer.id, owner.id]);
      await call(viewer, "GET", `/shelves/${shelf.id}`, undefined, 404);
      await db.query("DELETE FROM user_hides WHERE hider_user_id = ? AND hidden_user_id = ?", [viewer.id, owner.id]);
      await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [viewer.id, owner.id]);
      await call(viewer, "POST", "/saves", { materialKind: "shelf", materialId: shelf.id }, 403);
      await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [viewer.id, owner.id]);
    });

    await t.test("report moderation and deletion remove shelf relations but retain canonical books", async () => {
      const report = await call(viewer, "POST", "/reports", { targetKind: "shelf", targetId: shelf.id, reason: "Проверка" }, 201);
      await call(admin, "POST", `/admin/reports/${report.id}/delete-material`, { reason: "Удалено" });
      await call(owner, "GET", `/shelves/${shelf.id}`, undefined, 404);
      const [[bookStillExists]] = await db.query("SELECT COUNT(*) AS total FROM books WHERE id = ?", [first]);
      assert.equal(Number(bookStillExists.total), 1);
      const [[actionCount]] = await db.query("SELECT COUNT(*) AS total FROM material_likes WHERE material_kind = 'shelf' AND material_id = ?", [shelf.id]);
      assert.equal(Number(actionCount.total), 0);
    });
  } finally { await fixture.close(); }
});
