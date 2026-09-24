// Runs only under the guarded disposable MySQL verification runner.
import assert from "node:assert/strict";
import test from "node:test";

process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
const { queue3HttpFixture } = await import("./helpers/queue3-http.mjs");

test("C marketplace reports and moderation restrict listings with a recorded reason", async () => {
  const fixture = await queue3HttpFixture("c-moderation");
  const { db, user, call } = fixture;
  const listingIds = [];
  try {
    const seller = await user("seller");
    const buyer = await user("buyer");
    const admin = await user("admin", { role: "admin" });
    const [[city]] = await db.query("SELECT id FROM cities ORDER BY id LIMIT 1");
    const payload = (title) => ({ title, author: "Автор", type: "sale", condition: "Хорошее", description: "Бумажная книга", cityId: city.id, price: 500, currency: "KZT" });
    const first = await call(seller, "POST", "/marketplace/listings", payload("Жалоба и модерация"), 201);
    listingIds.push(first.listing.id);
    const dialogue = await call(buyer, "POST", `/marketplace/listings/${first.listing.id}/conversations`, {}, 201);
    await call(buyer, "POST", `/marketplace/conversations/${dialogue.conversation.id}/messages`, { body: "Интересует книга" }, 201);
    await call(seller, "POST", `/marketplace/conversations/${dialogue.conversation.id}/messages`, { body: "Она доступна" }, 201);
    const listingReport = await call(buyer, "POST", "/reports", { targetKind: "marketplace_listing", targetId: first.listing.id, reason: "Подозрительное объявление" }, 201);
    const dialogueReport = await call(buyer, "POST", "/reports", { targetKind: "marketplace_conversation", targetId: dialogue.conversation.id, reason: "Подозрительный диалог" }, 201);
    assert.ok(listingReport.reference && dialogueReport.reference);
    const moderation = await call(admin, "GET", "/bootstrap/moderation");
    assert.equal(moderation.reports.find((report) => report.id === listingReport.id)?.targetTitle, "Жалоба и модерация");
    const projectedDialogue = moderation.reports.find((report) => report.id === dialogueReport.id);
    assert.match(projectedDialogue?.targetTitle ?? "", /Диалог: Жалоба и модерация/);
    assert.deepEqual(projectedDialogue?.conversationMessages?.map((message) => message.text), ["Интересует книга", "Она доступна"]);
    await call(admin, "POST", "/reports", { targetKind: "marketplace_conversation", targetId: dialogue.conversation.id, reason: "Чужая история" }, 404);
    assert.equal((await call(admin, "GET", `/admin/marketplace/sellers/${seller.id}/restriction`)).restriction, null);
    await call(buyer, "GET", `/admin/marketplace/sellers/${seller.id}/restriction`, undefined, 403);
    await call(buyer, "PATCH", `/admin/marketplace/listings/${first.listing.id}/moderation`, { reason: "Не моя роль" }, 403);
    await call(admin, "POST", `/admin/marketplace/sellers/${seller.id}/restriction`, { reason: "Проверка жалобы" });
    assert.equal((await call(admin, "GET", `/admin/marketplace/sellers/${seller.id}/restriction`)).restriction.reason, "Проверка жалобы");
    await call(seller, "POST", "/marketplace/listings", payload("Второе объявление"), 403);
    await call(admin, "PATCH", `/admin/marketplace/listings/${first.listing.id}/moderation`, { reason: "Нарушение правил" });
    assert.equal((await call(buyer, "GET", `/marketplace/conversations/${dialogue.conversation.id}`)).conversation.listing.unavailable, true);
    const [[removed]] = await db.query("SELECT status, moderation_note FROM marketplace_listings WHERE id = ?", [first.listing.id]);
    assert.deepEqual({ status: removed.status, moderation_note: removed.moderation_note }, { status: "removed", moderation_note: "Нарушение правил" });
    const [audit] = await db.query("SELECT action_type, reason FROM moderation_audit_log WHERE object_type = 'marketplace_listing' AND object_id = ?", [first.listing.id]);
    assert.ok(audit.some((entry) => entry.action_type === "marketplace_listing_removed" && entry.reason === "Нарушение правил"));
    await call(admin, "DELETE", `/admin/marketplace/sellers/${seller.id}/restriction`, { reason: "Проверка завершена" });
    assert.equal((await call(admin, "GET", `/admin/marketplace/sellers/${seller.id}/restriction`)).restriction, null);
    const second = await call(seller, "POST", "/marketplace/listings", payload("Второе объявление"), 201);
    listingIds.push(second.listing.id);
  } finally {
    if (listingIds.length) {
      await db.query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE marketplace_listing_id IN (?))", [listingIds]);
      await db.query("DELETE FROM conversations WHERE marketplace_listing_id IN (?)", [listingIds]);
      await db.query("DELETE FROM marketplace_listings WHERE id IN (?)", [listingIds]);
    }
    await fixture.close();
  }
});
