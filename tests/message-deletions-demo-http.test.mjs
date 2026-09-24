import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

const TOMBSTONE = "Пользователь удалил это сообщение";

test("demo author deletion splits unread hiding from read tombstones and keeps evidence private", async () => {
  process.env.DEMO_MODE = "1";
  const { default: router } = await import("../server/demo-api.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (id) => {
    const response = await fetch(`${base}/auth/demo-login?user=${id}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const call = async (cookie, method, route, body, expected = 200) => {
    const response = await fetch(`${base}${route}`, { method, headers: { Cookie: cookie ?? "", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  };
  try {
    await call(null, "POST", "/__test__/reset");
    const sender = await login(3);
    const recipient = await login(2);
    const stranger = await login(1);

    const unread = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Private unread evidence", mentions: [{ userId: 2, token: "@publisher" }] });
    const unreadId = Number(unread.message.id);
    await call(recipient, "POST", `/messages/${unreadId}/reactions/like`, {});
    const recipientFailure = await call(recipient, "DELETE", `/messages/${unreadId}`, undefined, 404);
    const strangerFailure = await call(stranger, "DELETE", `/messages/${unreadId}`, undefined, 404);
    assert.deepEqual(recipientFailure, strangerFailure);
    const hidden = await call(sender, "DELETE", `/messages/${unreadId}`);
    assert.equal(hidden.deletedBeforeRead, true);
    for (const cookie of [sender, recipient]) {
      const serialized = JSON.stringify(await call(cookie, "GET", "/bootstrap"));
      assert.doesNotMatch(serialized, /Private unread evidence|messageDeletionEvidence|originalBody/);
      assert.equal(serialized.includes(`\"id\":${unreadId}`), false);
    }
    await call(sender, "PATCH", `/messages/${unreadId}`, { body: "cannot return" }, 404);
    await call(sender, "POST", `/messages/${unreadId}/reactions/like`, {}, 404);
    await call(sender, "DELETE", `/messages/${unreadId}`, undefined, 404);

    const read = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Read before deletion" });
    const readId = Number(read.message.id);
    await call(recipient, "PATCH", "/social/messages/3/read");
    const tombstoned = await call(sender, "DELETE", `/messages/${readId}`);
    assert.equal(tombstoned.deletedBeforeRead, false);
    assert.equal(tombstoned.tombstone, TOMBSTONE);
    for (const cookie of [sender, recipient]) {
      const bootstrap = await call(cookie, "GET", "/bootstrap");
      const projected = bootstrap.messages["2-3"].find((message) => message.id === readId);
      assert.equal(projected.text, TOMBSTONE);
      assert.equal(projected.deleted, true);
      assert.equal(projected.read, true);
      assert.equal(projected.unread, false);
      assert.equal(projected.attachment, undefined);
      assert.deepEqual(projected.mentions, []);
      assert.equal(projected.likeCount, 0);
      assert.doesNotMatch(JSON.stringify(bootstrap), /Read before deletion|messageDeletionEvidence|originalBody/);
    }

    const cleared = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Cleared first" });
    await call(sender, "DELETE", "/social/messages/2/history");
    const clearedFailure = await call(sender, "DELETE", `/messages/${cleared.message.id}`, undefined, 404);
    assert.equal(clearedFailure.code, "MESSAGE_NOT_FOUND");

    const scenario = await call(null, "POST", "/__test__/chat-scenario", undefined, 201);
    const peer = await login(scenario.peerId);
    await call(sender, "POST", `/social/friends/${scenario.peerId}/accept`);
    const systemBootstrap = await call(peer, "GET", "/bootstrap");
    const system = systemBootstrap.messages[`3-${scenario.peerId}`].find((message) => message.system);
    const systemFailure = await call(peer, "DELETE", `/messages/${system.id}`, undefined, 409);
    assert.equal(systemFailure.code, "MESSAGE_SYSTEM_NOT_DELETABLE");

    await call(null, "POST", "/__test__/reset");
    const resetSender = await login(3);
    assert.doesNotMatch(JSON.stringify(await call(resetSender, "GET", "/bootstrap")), /Private unread evidence|Read before deletion/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
