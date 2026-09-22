import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

function eventReader(response, controller) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  async function next(timeoutMs = 1_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.startsWith(":")) continue;
        const event = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1] ?? "";
        return { event, data };
      }
      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve(null), remaining)),
      ]);
      if (!result || result.done) return null;
      buffer += decoder.decode(result.value, { stream: true }).replaceAll("\r\n", "\n");
    }
    return null;
  }
  return { next, close: () => controller.abort() };
}

test("TZ5 realtime chat invalidations are participant-only and contain no message content", async () => {
  process.env.DEMO_MODE = "1";
  const { default: router } = await import("../server/demo-api.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (id) => (await fetch(`${base}/auth/demo-login?user=${id}`, { redirect: "manual" })).headers.get("set-cookie").split(";")[0];
  const call = async (cookie, method, route, body, expected = 200) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { Cookie: cookie ?? "", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  };
  const streams = [];
  const open = async (cookie) => {
    const controller = new AbortController();
    const response = await fetch(`${base}/realtime`, { headers: { Cookie: cookie }, signal: controller.signal });
    assert.equal(response.status, 200);
    const stream = eventReader(response, controller);
    streams.push(stream);
    assert.equal((await stream.next()).event, "connected");
    return stream;
  };
  try {
    await call(null, "POST", "/__test__/reset");
    const senderCookie = await login(3);
    const recipientCookie = await login(2);
    const outsiderCookie = await login(1);
    const [sender, recipient, outsider] = await Promise.all([open(senderCookie), open(recipientCookie), open(outsiderCookie)]);

    const sent = await call(senderCookie, "POST", "/social/messages", { targetId: 2, body: "private realtime text" });
    for (const participant of [sender, recipient]) {
      const received = await participant.next();
      assert.equal(received.event, "chat");
      assert.deepEqual(JSON.parse(received.data), { type: "message.created", messageId: sent.message.id });
      assert.doesNotMatch(received.data, /private realtime text|body|sticker|attachment|targetId|userId/);
    }
    assert.equal(await outsider.next(250), null);

    await call(senderCookie, "POST", "/social/messages", { targetId: 2 }, 400);
    assert.equal(await sender.next(250), null);
    assert.equal(await recipient.next(250), null);
  } finally {
    for (const stream of streams) stream.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
