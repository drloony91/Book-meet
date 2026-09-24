import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

test("demo message search enforces visibility, pagination, grouping and current content", async () => {
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
    const short = await call(sender, "GET", "/conversations/2/messages/search?q=я", undefined, 422);
    assert.equal(short.code, "MESSAGE_SEARCH_QUERY_TOO_SHORT");

    const first = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Редкий книжный поиск один" });
    const second = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Редкий книжный поиск два" });
    const pageOne = await call(sender, "GET", "/conversations/2/messages/search?q=редкий&limit=1");
    assert.equal(pageOne.total, 2);
    assert.equal(pageOne.matches[0].messageId, second.message.id);
    assert.ok(pageOne.nextCursor);
    const pageTwo = await call(sender, "GET", `/conversations/2/messages/search?q=редкий&limit=1&cursor=${encodeURIComponent(pageOne.nextCursor)}`);
    assert.equal(pageTwo.matches[0].messageId, first.message.id);

    const edited = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Старая архивная формулировка" });
    await call(sender, "PATCH", `/messages/${edited.message.id}`, { body: "Новая актуальная формулировка" });
    assert.equal((await call(sender, "GET", "/conversations/2/messages/search?q=архивная")).total, 0);
    assert.equal((await call(sender, "GET", "/conversations/2/messages/search?q=актуальная")).total, 1);

    const deleted = await call(sender, "POST", "/social/messages", { targetId: 2, body: "Секретный удаляемый поисктокен" });
    await call(sender, "DELETE", `/messages/${deleted.message.id}`);
    assert.equal((await call(recipient, "GET", "/conversations/3/messages/search?q=поисктокен")).total, 0);

    const scenario = await call(null, "POST", "/__test__/chat-scenario", undefined, 201);
    await call(sender, "POST", `/social/friends/${scenario.peerId}/accept`);
    await call(sender, "POST", "/social/messages", { targetId: scenario.peerId, body: "Редкий общий поисктокен свежий" });
    const grouped = await call(sender, "GET", "/messages/search?q=редкий");
    assert.equal(grouped.groups[0].peer.id, scenario.peerId);
    assert.equal(grouped.groups.find((group) => group.peer.id === 2).count, 2);
    assert.ok(grouped.groups.every((group) => group.matches.every((match) => !Object.hasOwn(match, "body"))));

    for (let index = 0; index < 6; index += 1) await call(sender, "POST", "/social/messages", { targetId: 2, body: `Постраничный групповой поисковый маркер ${index}` });
    const pagedGrouped = await call(sender, "GET", "/messages/search?q=постраничный");
    const pagedGroup = pagedGrouped.groups.find((group) => group.peer.id === 2);
    assert.equal(pagedGroup.count, 6);
    assert.equal(pagedGroup.matches.length, 5, "a global group initially returns only the documented five matches");
    assert.ok(pagedGroup.matchesNextCursor);
    const pagedGroupTail = await call(sender, "GET", `/conversations/2/messages/search?q=постраничный&cursor=${encodeURIComponent(pagedGroup.matchesNextCursor)}`);
    assert.equal(pagedGroupTail.matches.length, 1);

    const foreign = await call(sender, "GET", `/conversations/${scenario.minorPeerId}/messages/search?q=редкий`, undefined, 404);
    const absent = await call(sender, "GET", "/conversations/999999/messages/search?q=редкий", undefined, 404);
    assert.deepEqual(foreign, absent);

    await call(sender, "DELETE", "/social/messages/2/history");
    assert.equal((await call(sender, "GET", "/conversations/2/messages/search?q=редкий")).total, 0);
    assert.equal((await call(recipient, "GET", "/conversations/3/messages/search?q=редкий")).total, 2);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
