// Runs only under the guarded disposable MySQL verification runner.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.BOOK_MEET_MARKETPLACE_ENABLED = "1";
const { queue3HttpFixture } = await import("./helpers/queue3-http.mjs");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZUAAAAASUVORK5CYII=";

test("C marketplace image writes roll back and replacements remove superseded files", async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "bookmeet-marketplace-images-"));
  const previousUploadDir = process.env.MARKETPLACE_PRIVATE_UPLOAD_DIR;
  process.env.MARKETPLACE_PRIVATE_UPLOAD_DIR = uploadDir;
  const fixture = await queue3HttpFixture("c-images");
  const { db, user, call, origin } = fixture;
  let listingId;
  try {
    const seller = await user("seller");
    const buyer = await user("buyer");
    const minor = await user("minor", { minor: true });
    const [[city]] = await db.query("SELECT id FROM cities ORDER BY id LIMIT 1");
    assert.ok(city?.id);
    const listing = { title: "Изображённая книга", author: "Автор", type: "sale", condition: "Хорошее", description: "Чистый экземпляр", cityId: city.id, price: 800, currency: "KZT", images: [png] };
    const invalid = await call(seller, "POST", "/marketplace/listings", { ...listing, images: [png.replace("image/png", "image/jpeg")] }, 400);
    assert.ok(invalid.error);
    assert.deepEqual(await readdir(uploadDir), [], "mismatched image signature must not leave a file");

    await call(seller, "POST", "/marketplace/listings", { ...listing, cityId: 2147483647 }, 400);
    assert.deepEqual(await readdir(uploadDir), [], "a failed create transaction must remove already saved files");

    const created = await call(seller, "POST", "/marketplace/listings", listing, 201);
    listingId = created.listing.id;
    const firstUrl = created.listing.images[0]?.url;
    assert.match(firstUrl, /^\/api\/marketplace\/images\/\d+$/);
    const [firstName] = await readdir(uploadDir);
    const firstFile = path.join(uploadDir, firstName);
    assert.ok((await stat(firstFile)).size > 0);
    assert.equal((await readFile(firstFile)).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const buyerImage = await fetch(`${origin}${firstUrl}`, { headers: { cookie: buyer.cookie } });
    assert.equal(buyerImage.status, 200);
    assert.match(buyerImage.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await buyerImage.arrayBuffer()).byteLength, (await stat(firstFile)).size);
    assert.equal((await fetch(`${origin}${firstUrl}`, { headers: { cookie: minor.cookie } })).status, 403);
    const [[sellerProfile]] = await db.query("SELECT birth_date FROM profiles WHERE user_id = ?", [seller.id]);
    await db.query("UPDATE profiles SET birth_date = '2015-01-01' WHERE user_id = ?", [seller.id]);
    assert.equal((await fetch(`${origin}${firstUrl}`, { headers: { cookie: buyer.cookie } })).status, 404);
    await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [sellerProfile.birth_date, seller.id]);
    await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [buyer.id, seller.id]);
    assert.equal((await fetch(`${origin}${firstUrl}`, { headers: { cookie: buyer.cookie } })).status, 404);
    await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [buyer.id, seller.id]);

    const updated = await call(seller, "PATCH", `/marketplace/listings/${listingId}`, { images: [png] });
    const secondUrl = updated.listing.images[0]?.url;
    assert.notEqual(secondUrl, firstUrl);
    const [secondName] = await readdir(uploadDir);
    assert.notEqual(secondName, firstName);
    assert.deepEqual(await readdir(uploadDir), [secondName], "replacement must remove the superseded file");
    assert.equal((await fetch(`${origin}${firstUrl}`, { headers: { cookie: buyer.cookie } })).status, 404);
    await call(seller, "DELETE", `/marketplace/listings/${listingId}`);
    assert.deepEqual(await readdir(uploadDir), [secondName], "soft removal retains the private audit copy");
    assert.equal((await fetch(`${origin}${secondUrl}`, { headers: { cookie: buyer.cookie } })).status, 404);
  } finally {
    if (listingId) await db.query("DELETE FROM marketplace_listings WHERE id = ?", [listingId]);
    await fixture.close();
    if (previousUploadDir === undefined) delete process.env.MARKETPLACE_PRIVATE_UPLOAD_DIR; else process.env.MARKETPLACE_PRIVATE_UPLOAD_DIR = previousUploadDir;
    await rm(uploadDir, { recursive: true, force: true });
  }
});
