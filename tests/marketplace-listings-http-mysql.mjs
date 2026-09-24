// Runs only under the guarded disposable MySQL verification runner.
import assert from "node:assert/strict";
import test from "node:test";

process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
const { queue3HttpFixture } = await import("./helpers/queue3-http.mjs");

test("C marketplace listings enforce adult, owner, block, filters and soft removal", async () => {
  const fixture = await queue3HttpFixture("c-listings");
  const { db, user, book, call } = fixture;
  let listingId;
  try {
    const seller = await user("seller");
    const buyer = await user("buyer");
    const minor = await user("minor", { minor: true });
    const catalogId = await book("catalog");
    const [[city]] = await db.query("SELECT id FROM cities ORDER BY id LIMIT 1");
    assert.ok(city?.id, "seeded city is required for marketplace listings");

    process.env.BOOK_MEET_MARKETPLACE_ENABLED = "0";
    await call(seller, "GET", "/marketplace/listings", undefined, 404);
    process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
    await call(minor, "GET", "/marketplace/listings", undefined, 403);
    await call(minor, "POST", "/marketplace/listings", { title: "X", author: "Y", type: "sale", condition: "Хорошее", description: "Экземпляр", cityId: city.id, price: 100, currency: "KZT" }, 403);

    const payload = { catalogBookId: catalogId, type: "sale", condition: "Хорошее", description: "Без повреждений", cityId: city.id, price: 1000, currency: "KZT" };
    const created = await call(seller, "POST", "/marketplace/listings", payload, 201);
    listingId = created.listing.id;
    assert.equal(created.listing.status, "active");
    assert.equal(created.listing.catalogBookId, catalogId);
    assert.equal(created.listing.price, 1000);
    await call(seller, "POST", "/marketplace/listings", payload, 409);
    const feed = await call(buyer, "GET", `/marketplace/listings?type=sale&cityId=${city.id}&minPrice=1000&maxPrice=1000`);
    assert.ok(feed.listings.some((listing) => listing.id === listingId));
    const [[sellerProfile]] = await db.query("SELECT birth_date FROM profiles WHERE user_id = ?", [seller.id]);
    await db.query("UPDATE profiles SET birth_date = '2015-01-01' WHERE user_id = ?", [seller.id]);
    assert.equal((await call(buyer, "GET", "/marketplace/listings")).listings.some((listing) => listing.id === listingId), false);
    await call(buyer, "GET", `/marketplace/listings/${listingId}`, undefined, 404);
    await call(seller, "PATCH", `/marketplace/listings/${listingId}`, { description: "Нельзя редактировать" }, 403);
    await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [sellerProfile.birth_date, seller.id]);
    assert.equal((await call(buyer, "GET", "/marketplace/listings")).listings.some((listing) => listing.id === listingId), true);
    assert.equal((await call(buyer, "GET", `/marketplace/listings?type=exchange`)).listings.some((listing) => listing.id === listingId), false);
    await call(buyer, "PATCH", `/marketplace/listings/${listingId}`, { description: "Подмена" }, 404);
    await call(buyer, "DELETE", `/marketplace/listings/${listingId}`, undefined, 404);

    await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [buyer.id, seller.id]);
    assert.equal((await call(buyer, "GET", "/marketplace/listings")).listings.some((listing) => listing.id === listingId), false);
    await call(buyer, "GET", `/marketplace/listings/${listingId}`, undefined, 404);
    await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [buyer.id, seller.id]);

    const reserved = await call(seller, "PATCH", `/marketplace/listings/${listingId}`, { status: "reserved" });
    assert.equal(reserved.listing.status, "reserved");
    assert.equal((await call(buyer, "GET", "/marketplace/listings")).listings.some((listing) => listing.id === listingId), false);
    assert.equal((await call(seller, "GET", "/marketplace/listings/mine")).listings.some((listing) => listing.id === listingId), true);
    await call(seller, "DELETE", `/marketplace/listings/${listingId}`);
    assert.equal((await call(seller, "GET", "/marketplace/listings/mine")).listings.some((listing) => listing.id === listingId), false);
    const [[retained]] = await db.query("SELECT status, seller_reference_id FROM marketplace_listings WHERE id = ?", [listingId]);
    assert.deepEqual({ status: retained.status, seller_reference_id: Number(retained.seller_reference_id) }, { status: "removed", seller_reference_id: seller.id });
  } finally {
    process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
    if (listingId) await db.query("DELETE FROM marketplace_listings WHERE id = ?", [listingId]);
    await fixture.close();
  }
});
