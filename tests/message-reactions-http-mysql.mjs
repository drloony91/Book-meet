import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

test("TZ5 message likes: authenticated MySQL authorization, idempotency and visibility", async (t) => {
  const fixture = await queue3HttpFixture("q5-message-like");
  const { db, user, call } = fixture;
  try {
    const sender = await user("sender");
    const recipient = await user("recipient");
    const stranger = await user("stranger");
    const low = Math.min(sender.id, recipient.id);
    const high = Math.max(sender.id, recipient.id);
    await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [low, high]);
    const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, body: "Message reaction integration" }, 201);
    const messageId = Number(sent.message.id);

    await t.test("both participants including the author receive authoritative idempotent state", async () => {
      let reaction = await call(sender, "POST", `/messages/${messageId}/reactions/like`, {});
      assert.deepEqual(reaction, { messageId, likeCount: 1, likedByViewer: true, likedByUserIds: [sender.id] });
      reaction = await call(sender, "POST", `/messages/${messageId}/reactions/like`, {});
      assert.equal(reaction.likeCount, 1);
      reaction = await call(recipient, "POST", `/messages/${messageId}/reactions/like`, {});
      assert.equal(reaction.likeCount, 2);
      assert.equal(reaction.likedByViewer, true);
      assert.deepEqual(new Set(reaction.likedByUserIds), new Set([sender.id, recipient.id]));

      const social = await call(recipient, "GET", "/bootstrap/social");
      const message = social.messages[`${low}-${high}`].find((entry) => entry.id === messageId);
      assert.equal(message.likeCount, 2);
      assert.equal(message.likedByViewer, true);
      assert.deepEqual(new Set(message.likedByUserIds), new Set([sender.id, recipient.id]));

      reaction = await call(recipient, "DELETE", `/messages/${messageId}/reactions/like`);
      assert.equal(reaction.likeCount, 1);
      reaction = await call(recipient, "DELETE", `/messages/${messageId}/reactions/like`);
      assert.equal(reaction.likeCount, 1);
      assert.equal(reaction.likedByViewer, false);
    });

    await t.test("foreign, cleared and system message ids use controlled non-leaking errors", async () => {
      let error = await call(stranger, "POST", `/messages/${messageId}/reactions/like`, {}, 404);
      assert.equal(error.code, "MESSAGE_NOT_FOUND");
      const [systemMessage] = await db.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, is_system) VALUES (?, ?, 'system', 1)", [sender.id, recipient.id]);
      error = await call(recipient, "POST", `/messages/${systemMessage.insertId}/reactions/like`, {}, 409);
      assert.equal(error.code, "MESSAGE_REACTION_NOT_ALLOWED");
      await call(sender, "DELETE", `/social/messages/${recipient.id}/history`);
      error = await call(sender, "DELETE", `/messages/${messageId}/reactions/like`, undefined, 404);
      assert.equal(error.code, "MESSAGE_NOT_FOUND");
      assert.equal(error.error, (await call(stranger, "DELETE", `/messages/${messageId}/reactions/like`, undefined, 404)).error);
    });

    await t.test("current pair blocks still govern a participant mutation", async () => {
      await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [recipient.id, sender.id]);
      const error = await call(recipient, "POST", `/messages/${messageId}/reactions/like`, {}, 403);
      assert.match(error.error, /недоступно/i);
    });
  } finally {
    await fixture.close();
  }
});
