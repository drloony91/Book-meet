import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

test("demo message reactions persist per participant and reset with demo state", async () => {
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
    const created = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Demo message reaction" });
    const messageId = Number(created.message.id);
    let reaction = await call(sender, "POST", `/messages/${messageId}/reactions/like`, {});
    assert.deepEqual(reaction, { messageId, likeCount: 1, likedByViewer: true, likedByUserIds: [3] });
    reaction = await call(sender, "POST", `/messages/${messageId}/reactions/like`, {});
    assert.equal(reaction.likeCount, 1);
    reaction = await call(recipient, "POST", `/messages/${messageId}/reactions/like`, {});
    assert.equal(reaction.likeCount, 2);
    const bootstrap = await call(recipient, "GET", "/bootstrap");
    const projected = bootstrap.messages["2-3"].find((message) => message.id === messageId);
    assert.equal(projected.likeCount, 2);
    assert.equal(projected.likedByViewer, true);
    assert.deepEqual(new Set(projected.likedByUserIds), new Set([2, 3]));
    await call(sender, "DELETE", "/social/messages/2/history");
    await call(sender, "DELETE", `/messages/${messageId}/reactions/like`, undefined, 404);
    await call(null, "POST", "/__test__/reset");
    const resetSender = await login(3);
    assert.equal(Object.values((await call(resetSender, "GET", "/bootstrap")).messages).flat().some((message) => message.id === messageId), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
