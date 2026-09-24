// Runs only under the guarded disposable MySQL verification runner.
import assert from "node:assert/strict";
import test from "node:test";

process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
const { queue3HttpFixture } = await import("./helpers/queue3-http.mjs");

test("C marketplace conversations keep one buyer/listing pair and atomically cap first messages", async () => {
  const fixture = await queue3HttpFixture("c-dialogs");
  const { db, user, call, request } = fixture;
  let listingId;
  try {
    const seller = await user("seller");
    const buyer = await user("buyer");
    const other = await user("other");
    const minor = await user("minor", { minor: true });
    const [[city]] = await db.query("SELECT id FROM cities ORDER BY id LIMIT 1");
    const created = await call(seller, "POST", "/marketplace/listings", { title: "Диалоговая книга", author: "Автор", type: "sale", condition: "Хорошее", description: "Бумажная книга", cityId: city.id, price: 1500, currency: "KZT" }, 201);
    listingId = created.listing.id;
    process.env.BOOK_MEET_MARKETPLACE_ENABLED = "0";
    await call(buyer, "POST", `/marketplace/listings/${listingId}/conversations`, {}, 404);
    process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
    await call(minor, "POST", `/marketplace/listings/${listingId}/conversations`, {}, 403);
    await call(seller, "POST", `/marketplace/listings/${listingId}/conversations`, {}, 404);
    const opened = await call(buyer, "POST", `/marketplace/listings/${listingId}/conversations`, {}, 201);
    const conversationId = opened.conversation.id;
    assert.match(opened.conversation.safetyWarning, /не принимает оплату/i);
    assert.equal((await call(buyer, "POST", `/marketplace/listings/${listingId}/conversations`, {})).conversation.id, conversationId);
    const [[pair]] = await db.query("SELECT COUNT(*) AS total FROM conversations WHERE marketplace_listing_id = ? AND marketplace_buyer_reference_id = ?", [listingId, buyer.id]);
    assert.equal(Number(pair.total), 1);
    await call(buyer, "POST", `/marketplace/conversations/${conversationId}/messages`, { body: "Первое" }, 201);
    const concurrent = await Promise.all([1, 2, 3].map((number) => request(buyer, "POST", `/marketplace/conversations/${conversationId}/messages`, { body: `Одновременное ${number}` })));
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 201, 429]);
    assert.equal((await call(buyer, "GET", `/marketplace/conversations/${conversationId}/messages`)).messages.length, 3);
    await call(seller, "POST", `/marketplace/conversations/${conversationId}/messages`, { body: "Ответ продавца" }, 201);
    await call(buyer, "POST", `/marketplace/conversations/${conversationId}/messages`, { body: "Теперь можно" }, 201);

    const [[sellerProfile]] = await db.query("SELECT birth_date FROM profiles WHERE user_id = ?", [seller.id]);
    await db.query("UPDATE profiles SET birth_date = '2015-01-01' WHERE user_id = ?", [seller.id]);
    assert.equal((await call(buyer, "GET", "/marketplace/conversations")).conversations.some((item) => item.id === conversationId), false);
    await call(buyer, "GET", `/marketplace/conversations/${conversationId}`, undefined, 404);
    await call(buyer, "GET", `/marketplace/conversations/${conversationId}/messages`, undefined, 404);
    await call(buyer, "POST", `/marketplace/conversations/${conversationId}/messages`, { body: "Нельзя писать несовершеннолетнему" }, 404);
    await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [sellerProfile.birth_date, seller.id]);
    const [[buyerProfile]] = await db.query("SELECT birth_date FROM profiles WHERE user_id = ?", [buyer.id]);
    await db.query("UPDATE profiles SET birth_date = '2015-01-01' WHERE user_id = ?", [buyer.id]);
    assert.equal((await call(seller, "GET", "/marketplace/conversations")).conversations.some((item) => item.id === conversationId), false);
    await call(seller, "GET", `/marketplace/conversations/${conversationId}`, undefined, 404);
    await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [buyerProfile.birth_date, buyer.id]);

    await call(buyer, "DELETE", `/marketplace/conversations/${conversationId}`);
    assert.equal((await call(buyer, "GET", "/marketplace/conversations")).conversations.some((item) => item.id === conversationId), false);
    assert.equal((await call(seller, "GET", "/marketplace/conversations")).conversations.some((item) => item.id === conversationId), true);
    await call(seller, "POST", `/marketplace/conversations/${conversationId}/messages`, { body: "Возвращаю диалог" }, 201);
    assert.equal((await call(buyer, "GET", "/marketplace/conversations")).conversations.some((item) => item.id === conversationId), true);

    await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [seller.id, buyer.id]);
    await call(buyer, "POST", `/marketplace/conversations/${conversationId}/messages`, { body: "Обход блокировки" }, 404);
    assert.equal((await call(buyer, "GET", "/marketplace/conversations")).conversations.some((item) => item.id === conversationId), false);
    await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [seller.id, buyer.id]);

    const unanswered = await call(other, "POST", `/marketplace/listings/${listingId}/conversations`, {}, 201);
    await call(seller, "DELETE", `/marketplace/listings/${listingId}`);
    assert.equal((await call(buyer, "GET", `/marketplace/conversations/${conversationId}`)).conversation.listing.unavailable, true);
    assert.equal((await call(other, "GET", "/marketplace/conversations")).conversations.some((item) => item.id === unanswered.conversation.id), false);
    await call(other, "GET", `/marketplace/conversations/${unanswered.conversation.id}`, undefined, 404);
    await call(other, "POST", `/marketplace/listings/${listingId}/conversations`, {}, 404);
  } finally {
    process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
    if (listingId) {
      await db.query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE marketplace_listing_id = ?)", [listingId]);
      await db.query("DELETE FROM conversations WHERE marketplace_listing_id = ?", [listingId]);
      await db.query("DELETE FROM marketplace_listings WHERE id = ?", [listingId]);
    }
    await fixture.close();
  }
});
