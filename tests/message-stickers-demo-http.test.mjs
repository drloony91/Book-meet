import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

test("TZ5 stickers are server-authoritative, standalone, non-searchable and tombstoned safely in demo", async () => {
  process.env.DEMO_MODE = "1";
  const { default: router } = await import("../server/demo-api.js");
  const app = express(); app.use(express.json()); app.use("/api", router);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (id) => (await fetch(`${base}/auth/demo-login?user=${id}`, { redirect: "manual" })).headers.get("set-cookie").split(";")[0];
  const call = async (cookie, method, route, body, expected = 200) => {
    const response = await fetch(`${base}${route}`, { method, headers: { Cookie: cookie ?? "", "Content-Type": "application/json", "X-BookMeet-Locale": "en" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`); return data;
  };
  try {
    await call(null, "POST", "/__test__/reset");
    const sender = await login(3); const recipient = await login(2);
    const catalog = await call(sender, "GET", "/stickers");
    assert.equal(catalog.version, 1); assert.ok(catalog.stickers.length >= 4);
    assert.equal(catalog.stickers[0].label, "Open book"); assert.match(catalog.stickers[0].assetUrl, /^\/stickers\/.+\.svg$/);
    await call(sender, "POST", "/social/messages", { targetId: 2, stickerId: "not-a-book-meet-sticker" }, 422);
    await call(sender, "POST", "/social/messages", { targetId: 2, stickerId: catalog.stickers[0].id, body: "not allowed" }, 422);
    const sent = await call(sender, "POST", "/social/messages", { targetId: 2, stickerId: catalog.stickers[0].id });
    const id = Number(sent.message.id);
    assert.equal(sent.message.kind, "sticker"); assert.equal(sent.message.text, ""); assert.equal(sent.message.sticker.id, catalog.stickers[0].id);
    const bootstrap = await call(recipient, "GET", "/bootstrap");
    const projected = bootstrap.messages["2-3"].find((message) => Number(message.id) === id);
    assert.equal(projected.sticker.id, catalog.stickers[0].id); assert.equal(projected.sticker.labels.en, "Open book");
    const edit = await call(sender, "PATCH", `/messages/${id}`, { body: "nope" }, 409);
    assert.equal(edit.code, "MESSAGE_STICKER_NOT_EDITABLE");
    const search = await call(recipient, "GET", "/conversations/3/messages/search?q=open");
    assert.equal(search.total, 0);
    await call(recipient, "PATCH", "/social/messages/3/read");
    await call(sender, "DELETE", `/messages/${id}`);
    const after = await call(recipient, "GET", "/bootstrap");
    const tombstone = after.messages["2-3"].find((message) => Number(message.id) === id);
    assert.equal(tombstone.deleted, true); assert.equal(tombstone.sticker, undefined);
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
