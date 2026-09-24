import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createMarketplaceListingsRouter, marketplaceAdultBirthDateCutoff, parseMarketplaceListingPayload } from "../server/modules/marketplace-listings.js";

const validSale = {
  title: "Тестовая книга", author: "Автор", type: "sale", condition: "Хорошее", description: "Описание",
  cityId: 1, price: 1250, currency: "kzt", images: [],
};

test("marketplace adult cutoff follows UTC birthdays, including leap day", () => {
  assert.equal(marketplaceAdultBirthDateCutoff(new Date("2026-02-28T12:00:00Z")), "2008-02-28");
  assert.equal(marketplaceAdultBirthDateCutoff(new Date("2026-03-01T12:00:00Z")), "2008-03-01");
  assert.equal(marketplaceAdultBirthDateCutoff(new Date("2028-02-29T12:00:00Z")), "2010-02-28");
});

test("marketplace listing parser validates book choices, terms, city and images", () => {
  assert.deepEqual(parseMarketplaceListingPayload(validSale), {
    catalogBookId: null, bookTitle: "Тестовая книга", bookAuthor: "Автор", type: "sale", condition: "Хорошее",
    description: "Описание", cityId: 1, priceAmount: "1250.00", priceCurrency: "KZT", exchangeWishes: null, images: [],
  });
  assert.throws(() => parseMarketplaceListingPayload({ ...validSale, catalogBookId: 4 }), { code: "AMBIGUOUS_LISTING_BOOK" });
  assert.throws(() => parseMarketplaceListingPayload({ ...validSale, cityId: "not-a-city" }), { code: "INVALID_CITY" });
  assert.throws(() => parseMarketplaceListingPayload({ ...validSale, price: 0 }), { code: "INVALID_PRICE" });
  assert.throws(() => parseMarketplaceListingPayload({ ...validSale, images: Array(7).fill("data:image/png;base64,x") }), { code: "INVALID_LISTING_IMAGES" });
  assert.throws(() => parseMarketplaceListingPayload({ ...validSale, images: ["/uploads/private.png"] }), { code: "INVALID_LISTING_IMAGE" });
  assert.throws(() => parseMarketplaceListingPayload({ ...validSale, type: "exchange" }), { code: "INVALID_LISTING_TERMS" });
  assert.throws(() => parseMarketplaceListingPayload({ ...validSale, type: "exchange", price: null, currency: null }), { code: "INVALID_EXCHANGE_WISHES" });
  assert.deepEqual(parseMarketplaceListingPayload({ type: "exchange", exchangeWishes: "Фэнтези", cityId: 1, condition: "Новое", description: "Экземпляр без дефектов", title: "X", author: "Y", images: [] }).priceAmount, null);
});

async function serve(handler) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => { request.bookMeetUser = { id: 7 }; next(); });
  app.use(handler);
  app.use((error, _request, response, _next) => response.status(error.statusCode || 500).json({ code: error.code, error: error.message }));
  app.use((_request, response) => response.json({ unrelated: true }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test("marketplace listing routes fail closed when the feature flag is off", async (t) => {
  const previous = process.env.BOOK_MEET_MARKETPLACE_ENABLED;
  delete process.env.BOOK_MEET_MARKETPLACE_ENABLED;
  const route = createMarketplaceListingsRouter({
    getPool: () => assert.fail("disabled marketplace should not touch the database"),
    withTransaction: async () => assert.fail("disabled marketplace should not open a transaction"),
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    saveImage: async () => assert.fail("disabled marketplace should not store images"), removeImage: async () => {}, ageFromBirthDate: () => 99,
  });
  const server = await serve(route);
  t.after(async () => { await server.close(); if (previous === undefined) delete process.env.BOOK_MEET_MARKETPLACE_ENABLED; else process.env.BOOK_MEET_MARKETPLACE_ENABLED = previous; });
  const response = await fetch(`${server.url}/marketplace/listings`);
  assert.equal(response.status, 404);
  const unrelated = await fetch(`${server.url}/reading-statistics`);
  assert.equal(unrelated.status, 200, "marketplace flag must not disable subsequent API routes");
  assert.deepEqual(await unrelated.json(), { unrelated: true });
});

test("marketplace endpoints require a known adult personal profile before listing data is read", async (t) => {
  const previous = process.env.BOOK_MEET_MARKETPLACE_ENABLED;
  process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
  let listingReads = 0;
  const pool = { query: async (sql) => {
    if (sql.includes("SELECT u.role")) return [[{ role: "user", deleted_at: null, purged_at: null, profile_type: "Читатель", birth_date: "2012-06-01" }]];
    listingReads += 1; return [[]];
  } };
  const route = createMarketplaceListingsRouter({
    getPool: () => pool, withTransaction: async () => {},
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    saveImage: async () => "/uploads/marketplace-test.png", removeImage: async () => {}, ageFromBirthDate: () => 14,
  });
  const server = await serve(route);
  t.after(async () => { await server.close(); if (previous === undefined) delete process.env.BOOK_MEET_MARKETPLACE_ENABLED; else process.env.BOOK_MEET_MARKETPLACE_ENABLED = previous; });
  const response = await fetch(`${server.url}/marketplace/listings`);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "MARKETPLACE_ADULTS_ONLY");
  assert.equal(listingReads, 0);
});

test("marketplace feed filters blocked sellers and paginates without exposing the lookahead row", async (t) => {
  const previous = process.env.BOOK_MEET_MARKETPLACE_ENABLED;
  process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
  const queries = [];
  const listing = (id) => ({
    id, seller_user_id: 9, seller_name: "Продавец", seller_username: "seller",
    catalog_book_id: null, book_title: `Книга ${id}`, book_author: "Автор", listing_type: "sale",
    item_condition: "Хорошее", description: "Описание", city_id: 1, city_name: "Алматы",
    price_amount: "100.00", price_currency: "KZT", exchange_wishes: null, status: "active",
    created_at: "2026-09-24T00:00:00.000Z", updated_at: "2026-09-24T00:00:00.000Z",
  });
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes("SELECT u.role")) return [[{ role: "user", deleted_at: null, purged_at: null, profile_type: "Читатель", birth_date: "1990-01-01" }]];
    if (sql.includes("FROM marketplace_listing_images")) return [[{ listing_id: 41, id: 10, image_path: "marketplace-private:marketplace-cover.png" }]];
    return [[listing(41), listing(40), listing(39)]];
  } };
  const route = createMarketplaceListingsRouter({
    getPool: () => pool, withTransaction: async () => assert.fail("read must not open a transaction"),
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    saveImage: async () => assert.fail("read must not save images"), removeImage: async () => {}, ageFromBirthDate: () => 36,
  });
  const server = await serve(route);
  t.after(async () => { await server.close(); if (previous === undefined) delete process.env.BOOK_MEET_MARKETPLACE_ENABLED; else process.env.BOOK_MEET_MARKETPLACE_ENABLED = previous; });
  const response = await fetch(`${server.url}/marketplace/listings?limit=2&beforeId=42&minPrice=0&q=50%25_off`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.listings.map((item) => item.id), [41, 40]);
  assert.equal(body.nextBeforeId, 40);
  assert.deepEqual(body.listings[0].images, [{ id: 10, url: "/api/marketplace/images/10" }]);
  const feedQuery = queries.find(({ sql }) => sql.includes("FROM marketplace_listings") && sql.includes("ORDER BY l.created_at"));
  assert.match(feedQuery.sql, /NOT EXISTS \(SELECT 1 FROM user_blocks/);
  assert.match(feedQuery.sql, /p\.birth_date <= \?/);
  assert.match(feedQuery.sql, /l\.id < \?/);
  assert.deepEqual(feedQuery.params.slice(-3), ["0.00", 42, 3]);
  assert.match(feedQuery.params[2], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(feedQuery.params[3], "%50!%!_off%");
  assert.deepEqual(queries.find(({ sql }) => sql.includes("FROM marketplace_listing_images")).params, [41, 40]);
});

test("marketplace rejects image writes before adult and listing-owner authorization", async (t) => {
  const previous = process.env.BOOK_MEET_MARKETPLACE_ENABLED;
  process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
  let age = 17;
  let saved = 0;
  const pool = { query: async (sql) => {
    if (sql.includes("SELECT u.role")) return [[{ role: "user", deleted_at: null, purged_at: null, profile_type: "Читатель", birth_date: "2000-01-01" }]];
    if (sql.includes("SELECT id FROM marketplace_listings")) return [[]];
    assert.fail(`Unexpected query: ${sql}`);
  } };
  const route = createMarketplaceListingsRouter({
    getPool: () => pool, withTransaction: async () => assert.fail("rejected write must not open a transaction"),
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    saveImage: async () => { saved += 1; return "/uploads/marketplace-test.png"; },
    removeImage: async () => {}, ageFromBirthDate: () => age,
  });
  const server = await serve(route);
  t.after(async () => { await server.close(); if (previous === undefined) delete process.env.BOOK_MEET_MARKETPLACE_ENABLED; else process.env.BOOK_MEET_MARKETPLACE_ENABLED = previous; });
  const image = "data:image/png;base64,AAAA";
  const create = await fetch(`${server.url}/marketplace/listings`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...validSale, images: [image] }),
  });
  assert.equal(create.status, 403);
  age = 36;
  const edit = await fetch(`${server.url}/marketplace/listings/50`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: [image] }),
  });
  assert.equal(edit.status, 404);
  assert.equal(saved, 0);
});
