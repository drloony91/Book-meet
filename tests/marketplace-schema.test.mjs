import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("056–057 marketplace foundation is additive and retains records required by active conversations", async () => {
  const [previous, migration, restriction] = await Promise.all([
    read("mysql/migrations/055_reading_presence_visibility.sql"),
    read("mysql/migrations/056_marketplace_foundation.sql"),
    read("mysql/migrations/057_marketplace_seller_restrictions.sql"),
  ]);
  assert.match(previous, /ADD COLUMN reading_presence_visibility/);
  for (const marker of [
    "CREATE TABLE marketplace_listings",
    "CREATE TABLE marketplace_listing_images",
    "ALTER TABLE conversations",
    "marketplace_listing_id",
    "marketplace_buyer_reference_id",
    "uq_conversations_marketplace_listing_buyer",
    "CREATE TABLE marketplace_conversation_hidden",
    "fk_marketplace_conversation_hidden_member",
  ]) assert.ok(migration.includes(marker), `missing schema contract: ${marker}`);

  assert.match(migration, /listing_type ENUM\('sale', 'exchange'\)/);
  assert.match(migration, /status ENUM\('active', 'reserved', 'sold', 'exchanged', 'closed', 'removed'\)/);
  assert.match(migration, /ON DELETE SET NULL/); // seller, catalog and city live links do not erase the listing snapshot
  assert.match(migration, /book_title VARCHAR\(255\) NOT NULL/);
  assert.match(migration, /book_author VARCHAR\(255\) NOT NULL/);
  assert.match(migration, /seller_reference_id BIGINT UNSIGNED NOT NULL/);
  assert.match(migration, /catalog_book_id BIGINT UNSIGNED NULL/);
  assert.match(migration, /fk_conversations_marketplace_listing FOREIGN KEY \(marketplace_listing_id\) REFERENCES marketplace_listings\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /UNIQUE KEY uq_marketplace_listing_images_order \(listing_id, image_order\)/);
  assert.match(migration, /image_order BETWEEN 0 AND 5/);
  assert.match(migration, /FOREIGN KEY \(conversation_id, user_id\) REFERENCES conversation_members\(conversation_id, user_id\) ON DELETE CASCADE/);
  assert.match(migration, /conversation_type = 'marketplace' AND marketplace_listing_id IS NOT NULL AND marketplace_buyer_reference_id IS NOT NULL/);
  assert.doesNotMatch(migration, /CHECK\s*\([^;]*seller_user_id[^;]*seller_reference_id/s, "MySQL forbids CHECK on a foreign key with ON DELETE SET NULL");
  assert.doesNotMatch(migration, /CHECK\s*\([^;]*marketplace_buyer_user_id[^;]*marketplace_buyer_reference_id/s, "MySQL forbids CHECK on a foreign key with ON DELETE SET NULL");
  assert.match(migration, /listing_type = 'sale'.*price_amount IS NOT NULL/s);
  assert.match(migration, /listing_type = 'exchange'.*exchange_wishes IS NOT NULL/s);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.match(restriction, /CREATE TABLE marketplace_seller_restrictions/);
  assert.match(restriction, /restricted_until DATETIME NULL/);
  assert.match(restriction, /moderator_user_id BIGINT UNSIGNED NULL/);
  assert.doesNotMatch(restriction, /DROP\s+(?:TABLE|COLUMN)/i);
});

test("marketplace feature remains separate from retailer preview/wishlist and existing chat APIs", async () => {
  const [env, bootstrap, api, data] = await Promise.all([
    read(".env.example"),
    read("server/modules/bootstrap-router.js"),
    read("server/api.js"),
    read("server/data.js"),
  ]);
  assert.match(env, /BOOK_MEET_MARKETPLACE_ENABLED=0/);
  assert.match(bootstrap, /if \(marketplaceEnabled\(\)\) features\.marketplace = true/);
  assert.match(api, /router\.post\("\/books\/preview"/);
  assert.match(api, /router\.post\("\/wishlist\/preview"/);
  assert.match(data, /conversation\.conversation_type = 'direct'/);
  assert.match(api, /WHERE c\.conversation_type = 'group'/);
  assert.match(api, /router\.post\("\/social\/messages"/);
});
