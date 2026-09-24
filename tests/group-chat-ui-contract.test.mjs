import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import express from "express";

const root = path.resolve(import.meta.dirname, "..");

test("group-chat client route and hook remain feature-gated and isolated from direct chat", async () => {
  const [routes, hook, controller, components, mobile] = await Promise.all([
    readFile(path.join(root, "app/navigation/routes.ts"), "utf8"), readFile(path.join(root, "app/hooks/useGroupChats.ts"), "utf8"), readFile(path.join(root, "app/hooks/useBookMeetController.tsx"), "utf8"), readFile(path.join(root, "app/components/chat/GroupChatComponents.tsx"), "utf8"), readFile(path.join(root, "app/screens/MobileMessagesPage.tsx"), "utf8"),
  ]);
  assert.match(routes, /kind: "group-chat"/);
  assert.ok(routes.includes("/chat\\/groups\\/"));
  assert.ok(routes.includes("/chat\\/(\\d+)"));
  assert.match(hook, /if \(!enabled\)/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /bookmeet:group-chat-refresh/);
  assert.match(hook, /lastReadSentRef/);
  assert.match(hook, /createPoll/);
  assert.match(hook, /loadOlder/);
  assert.match(hook, /historyClearedMessageId/);
  assert.match(hook, /nextCursor/);
  assert.match(controller, /data\.features\?\.groupChats === true/);
  assert.match(controller, /\/chat\/groups\/\$\{conversationId\}/);
  assert.match(components, /role="dialog"/);
  assert.match(components, /datetime-local/);
  assert.match(components, /allowsMultiple/);
  assert.match(components, /groupChats\.deleteConfirmAgain/);
  assert.match(components, /searchCandidates/);
  assert.match(components, /prepareGroupAvatar/);
  assert.match(components, /onLoadThrough/);
  assert.match(mobile, /GroupChatRows/);
});

test("demo group chat projection and operations follow the same closed feature gate", async () => {
  process.env.DEMO_MODE = "1";
  process.env.BOOK_MEET_GROUP_CHATS_ENABLED = "0";
  const { default: router } = await import("../server/demo-api.js");
  const app = express(); app.use(express.json()); app.use("/api", router);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (cookie, method, route, body, expected = 200) => {
    const response = await fetch(`${base}${route}`, { method, headers: { Cookie: cookie ?? "", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`); return data;
  };
  const login = async (id) => (await fetch(`${base}/auth/demo-login?user=${id}`, { redirect: "manual" })).headers.get("set-cookie").split(";")[0];
  try {
    await call(null, "POST", "/__test__/reset"); const owner = await login(3); const member = await login(2);
    await call(owner, "GET", "/group-conversations", undefined, 404);
    assert.equal((await call(owner, "GET", "/bootstrap")).features, undefined);
    process.env.BOOK_MEET_GROUP_CHATS_ENABLED = "true";
    assert.equal((await call(owner, "GET", "/bootstrap")).features.groupChats, true);
    const candidates = await call(owner, "GET", "/group-conversations/candidates?q=Издательство"); assert.ok(candidates.users.some((user) => user.id === 2));
    const avatarUrl = "data:image/jpeg;base64,dGVzdA==";
    const created = await call(owner, "POST", "/group-conversations", { name: "UI group", participantIds: [2], avatarUrl }, 201);
    const detail = await call(owner, "GET", `/group-conversations/${created.id}`); assert.equal(detail.avatarUrl, avatarUrl); assert.equal(detail.historyClearedMessageId, 0);
    const list = await call(owner, "GET", "/group-conversations"); assert.equal(list.conversations[0].memberCount, 2);
    const message = await call(owner, "POST", `/group-conversations/${created.id}/messages`, { body: "demo group marker" }, 201);
    const visible = await call(member, "GET", `/group-conversations/${created.id}/messages`); assert.equal(visible.messages[0].text, "demo group marker");
    await call(member, "POST", `/group-conversations/${created.id}/messages/${message.id}/reactions/like`, {});
    assert.equal((await call(member, "GET", `/group-conversations/${created.id}/messages/search?q=marker`)).total, 1);
    assert.equal((await call(owner, "PATCH", `/group-conversations/${created.id}/read`, { messageId: message.id })).advanced, false);
    const poll = await call(owner, "POST", `/group-conversations/${created.id}/polls`, { question: "Which marker?", options: ["Blue", "Green"], allowsMultiple: false, mayChangeVote: false }, 201);
    assert.equal(poll.poll.options.length, 2);
    await call(member, "POST", `/group-conversations/${created.id}/polls/${poll.poll.id}/vote`, { optionIds: [poll.poll.options[0].id] });
    const polls = await call(member, "GET", `/group-conversations/${created.id}/polls`); assert.equal(polls.polls[0].options[0].voteCount, 1);
    await call(member, "POST", `/group-conversations/${created.id}/polls/${poll.poll.id}/vote`, { optionIds: [poll.poll.options[1].id] }, 409);
    for (let index = 0; index < 201; index += 1) await call(owner, "POST", `/group-conversations/${created.id}/messages`, { body: `history item ${index}` }, 201);
    const latest = await call(owner, "GET", `/group-conversations/${created.id}/messages`); assert.equal(latest.messages.length, 200); assert.ok(latest.nextCursor);
    const older = await call(owner, "GET", `/group-conversations/${created.id}/messages?before=${latest.nextCursor}`); assert.ok(older.messages.length > 0); assert.ok(older.messages.some((item) => item.text === "demo group marker"));
    await call(owner, "PATCH", `/group-conversations/${created.id}`, { avatarUrl: null, addMembersPolicy: "members", removeMembersPolicy: "owner_or_moderators" });
    assert.equal((await call(owner, "GET", `/group-conversations/${created.id}`)).avatarUrl, undefined);
    await call(owner, "POST", `/group-conversations/${created.id}/owner-transfer`, { userId: 2 });
    await call(owner, "POST", `/group-conversations/${created.id}/leave`, {});
    await call(member, "POST", `/group-conversations/${created.id}/history/clear`, {});
    await call(member, "DELETE", `/group-conversations/${created.id}`, {});
    await call(member, "GET", `/group-conversations/${created.id}`, undefined, 404);
  } finally { process.env.BOOK_MEET_GROUP_CHATS_ENABLED = "0"; await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
