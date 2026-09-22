import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

test("TZ5 message edits: ownership, private history, mentions and transactions", async (t) => {
  const fixture = await queue3HttpFixture("q5-message-edit");
  const { db, user, call } = fixture;
  try {
    const sender = await user("sender");
    const recipient = await user("recipient");
    const stranger = await user("stranger");
    const firstMention = await user("mention-a");
    const secondMention = await user("mention-b");
    const low = Math.min(sender.id, recipient.id);
    const high = Math.max(sender.id, recipient.id);
    await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [low, high]);
    const firstToken = `@q5-message-edit-mention-a`;
    const secondToken = `@q5-message-edit-mention-b`;
    const originalBody = `Previous private version ${firstToken}`;
    const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, body: originalBody, mentions: [{ userId: firstMention.id, token: firstToken }] }, 201);
    const messageId = Number(sent.message.id);

    await t.test("foreign participants get the same non-leaking not-found response", async () => {
      const recipientError = await call(recipient, "PATCH", `/messages/${messageId}`, { body: "Recipient rewrite" }, 404);
      const strangerError = await call(stranger, "PATCH", `/messages/${messageId}`, { body: "Stranger rewrite" }, 404);
      assert.equal(recipientError.code, "MESSAGE_NOT_FOUND");
      assert.deepEqual(strangerError, recipientError);
    });

    await t.test("current pair, block and age policies are rechecked", async () => {
      await db.query("DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
      let error = await call(sender, "PATCH", `/messages/${messageId}`, { body: "Pair ended" }, 403);
      assert.match(error.error, /Переписка доступна/);
      await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [low, high]);

      await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [recipient.id, sender.id]);
      error = await call(sender, "PATCH", `/messages/${messageId}`, { body: "Blocked rewrite" }, 403);
      assert.match(error.error, /недоступно/i);
      await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [recipient.id, sender.id]);

      await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [`${fixture.year - 15}-01-01`, recipient.id]);
      error = await call(sender, "PATCH", `/messages/${messageId}`, { body: "Cross-age rewrite" }, 403);
      assert.equal(error.code, "CROSS_AGE_INTERACTION_FORBIDDEN");
      await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [`${fixture.year - 30}-01-01`, recipient.id]);
    });

    await t.test("empty, system and attachment edits use controlled errors", async () => {
      let error = await call(sender, "PATCH", `/messages/${messageId}`, { body: "\u200b\u2060\ufeff" }, 422);
      assert.equal(error.code, "MESSAGE_BODY_REQUIRED");
      assert.match(error.error, /удален|удаления|delete/i);
      const [system] = await db.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, is_system) VALUES (?, ?, 'system', 1)", [sender.id, recipient.id]);
      error = await call(sender, "PATCH", `/messages/${system.insertId}`, { body: "Rewrite system" }, 409);
      assert.equal(error.code, "MESSAGE_SYSTEM_NOT_EDITABLE");
      const [attached] = await db.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, attachment_kind, attachment_id) VALUES (?, ?, 'attached', 'book', 1)", [sender.id, recipient.id]);
      error = await call(sender, "PATCH", `/messages/${attached.insertId}`, { body: "Rewrite attachment" }, 409);
      assert.equal(error.code, "MESSAGE_ATTACHMENT_NOT_EDITABLE");
    });

    await t.test("edit replaces mentions and exposes only the authoritative current DTO", async () => {
      const currentBody = `Current version ${secondToken}`;
      const edited = await call(sender, "PATCH", `/messages/${messageId}`, { body: currentBody, mentions: [{ userId: secondMention.id, token: secondToken }] });
      assert.equal(edited.message.text, currentBody);
      assert.match(edited.message.editedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(edited.message.mentions.map((mention) => mention.userId), [secondMention.id]);
      assert.equal("history" in edited.message, false);
      const [mentionRows] = await db.query("SELECT mentioned_user_id FROM content_mentions WHERE entity_type = 'message' AND entity_id = ?", [messageId]);
      assert.deepEqual(mentionRows.map((row) => Number(row.mentioned_user_id)), [secondMention.id]);
      const [historyRows] = await db.query("SELECT message_reference_id, editor_user_id, previous_body FROM message_edit_history WHERE message_reference_id = ?", [messageId]);
      assert.deepEqual(historyRows.map((row) => [Number(row.message_reference_id), Number(row.editor_user_id), row.previous_body]), [[messageId, sender.id, originalBody]]);

      const social = await call(recipient, "GET", "/bootstrap/social");
      const projected = social.messages[`${low}-${high}`].find((message) => message.id === messageId);
      assert.equal(projected.text, currentBody);
      assert.ok(projected.editedAt);
      const serialized = JSON.stringify(social);
      assert.doesNotMatch(serialized, /Previous private version|message_edit_history|previous_body/);
      const bootstrap = await call(recipient, "GET", "/bootstrap");
      assert.doesNotMatch(JSON.stringify(bootstrap), /Previous private version|message_edit_history|previous_body/);
    });

    await t.test("a failed message update rolls back history and mention replacement", async () => {
      const [[beforeHistory]] = await db.query("SELECT COUNT(*) AS count FROM message_edit_history WHERE message_reference_id = ?", [messageId]);
      await db.query("DROP TRIGGER IF EXISTS q5_message_edit_rollback");
      await db.query("CREATE TRIGGER q5_message_edit_rollback BEFORE UPDATE ON messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'message edit rollback sentinel'");
      try {
        const error = await call(sender, "PATCH", `/messages/${messageId}`, { body: `Failed version ${firstToken}`, mentions: [{ userId: firstMention.id, token: firstToken }] }, 500);
        assert.match(error.error, /rollback sentinel/i);
      } finally {
        await db.query("DROP TRIGGER IF EXISTS q5_message_edit_rollback");
      }
      const [[current]] = await db.query("SELECT body FROM messages WHERE id = ?", [messageId]);
      assert.equal(current.body, `Current version ${secondToken}`);
      const [[afterHistory]] = await db.query("SELECT COUNT(*) AS count FROM message_edit_history WHERE message_reference_id = ?", [messageId]);
      assert.equal(Number(afterHistory.count), Number(beforeHistory.count));
      const [mentions] = await db.query("SELECT mentioned_user_id FROM content_mentions WHERE entity_type = 'message' AND entity_id = ?", [messageId]);
      assert.deepEqual(mentions.map((row) => Number(row.mentioned_user_id)), [secondMention.id]);
    });

    await t.test("an author clear cursor hides the id from later edits", async () => {
      await call(sender, "DELETE", `/social/messages/${recipient.id}/history`);
      const error = await call(sender, "PATCH", `/messages/${messageId}`, { body: "After clear" }, 404);
      assert.equal(error.code, "MESSAGE_NOT_FOUND");
    });
  } finally {
    await db.query("DROP TRIGGER IF EXISTS q5_message_edit_rollback");
    await fixture.close();
  }
});
