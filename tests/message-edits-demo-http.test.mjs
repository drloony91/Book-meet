import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

test("demo message editing is author-only, persistent and keeps history private", async () => {
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
    const created = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Previous private version" });
    const messageId = Number(created.message.id);

    let error = await call(recipient, "PATCH", `/messages/${messageId}`, { body: "Recipient rewrite" }, 404);
    assert.equal(error.code, "MESSAGE_NOT_FOUND");
    error = await call(sender, "PATCH", `/messages/${messageId}`, { body: "\u200b\u2060" }, 422);
    assert.equal(error.code, "MESSAGE_BODY_REQUIRED");
    assert.match(error.error, /удален|удаления|жою|delete/i);

    const edited = await call(sender, "PATCH", `/messages/${messageId}`, { body: "  Current version  " });
    assert.equal(edited.message.text, "Current version");
    assert.match(edited.message.editedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal("history" in edited.message, false);

    const bootstrap = await call(recipient, "GET", "/bootstrap");
    const serialized = JSON.stringify(bootstrap);
    const projected = bootstrap.messages["2-3"].find((message) => message.id === messageId);
    assert.equal(projected.text, "Current version");
    assert.equal(projected.editedAt, edited.message.editedAt);
    assert.doesNotMatch(serialized, /Previous private version|messageEditHistory|previousBody/);

    const attached = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Shared", attachment: { kind: "book", id: 21 } });
    error = await call(sender, "PATCH", `/messages/${attached.message.id}`, { body: "Rewrite attachment" }, 409);
    assert.equal(error.code, "MESSAGE_ATTACHMENT_NOT_EDITABLE");

    const scenario = await call(null, "POST", "/__test__/chat-scenario", undefined, 201);
    const peer = await login(scenario.peerId);
    await call(sender, "POST", `/social/friends/${scenario.peerId}/accept`);
    const systemBootstrap = await call(peer, "GET", "/bootstrap");
    const systemMessage = systemBootstrap.messages[`3-${scenario.peerId}`].find((message) => message.system);
    assert.ok(systemMessage?.id);
    error = await call(peer, "PATCH", `/messages/${systemMessage.id}`, { body: "Rewrite system" }, 409);
    assert.equal(error.code, "MESSAGE_SYSTEM_NOT_EDITABLE");

    const clearMessage = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Hidden after clear" });
    await call(sender, "DELETE", "/social/messages/2/history");
    const cleared = await call(sender, "PATCH", `/messages/${clearMessage.message.id}`, { body: "Rewrite cleared" }, 404);
    assert.equal(cleared.code, "MESSAGE_NOT_FOUND");

    await call(null, "POST", "/__test__/reset");
    const resetSender = await login(3);
    assert.equal(JSON.stringify(await call(resetSender, "GET", "/bootstrap")).includes("Current version"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
