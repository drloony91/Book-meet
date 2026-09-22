import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

const TOMBSTONE = "Пользователь удалил это сообщение";

test("TZ5 message deletion: private evidence, read race, cleanup and rollback", async (t) => {
  const fixture = await queue3HttpFixture("q5-message-delete");
  const { db, user, request, call } = fixture;
  let rollbackTriggerCreated = false;
  try {
    const sender = await user("sender");
    const recipient = await user("recipient");
    const stranger = await user("stranger");
    const mentioned = await user("mentioned");
    const low = Math.min(sender.id, recipient.id);
    const high = Math.max(sender.id, recipient.id);
    const conversation = `${low}-${high}`;
    await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [low, high]);

    await t.test("ownership and current pair policy do not disclose foreign message ids", async () => {
      const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, body: "Authorization target" }, 201);
      const messageId = Number(sent.message.id);
      const recipientError = await call(recipient, "DELETE", `/messages/${messageId}`, undefined, 404);
      const strangerError = await call(stranger, "DELETE", `/messages/${messageId}`, undefined, 404);
      assert.deepEqual(strangerError, recipientError);
      assert.equal(recipientError.code, "MESSAGE_NOT_FOUND");

      await db.query("DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
      const pairError = await call(sender, "DELETE", `/messages/${messageId}`, undefined, 403);
      assert.match(pairError.error, /Переписка доступна/);
      await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [low, high]);
    });

    await t.test("unread deletion hides the row, retains only private evidence and scopes delivery cleanup", async () => {
      const token = `@${mentioned.id}`;
      const originalBody = `Unread private evidence ${token}`;
      const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, body: originalBody, mentions: [{ userId: mentioned.id, token }] }, 201);
      const messageId = Number(sent.message.id);
      await call(recipient, "POST", `/messages/${messageId}/reactions/like`, {});

      const [event] = await db.query(
        `INSERT INTO notification_events
           (recipient_user_id, actor_user_id, event_type, category, title, body, material_kind, material_id, dedupe_key)
         VALUES (?, ?, 'new_message', 'mentions', 'New message', 'private preview', 'message', ?, ?)`,
        [recipient.id, sender.id, messageId, `message-delete:${messageId}`],
      );
      await db.query(
        `INSERT INTO notification_deliveries
           (event_id, user_id, channel, mode, idempotency_key, status, next_attempt_at)
         VALUES (?, ?, 'telegram', 'immediate', ?, 'pending', UTC_TIMESTAMP())`,
        [event.insertId, recipient.id, `message-delete:${messageId}:telegram`],
      );
      await db.query(
        `INSERT INTO notifications
           (notification_event_id, user_id, actor_user_id, notification_type, title, body, material_kind, material_id, group_key)
         VALUES (?, ?, ?, 'new_message', 'New message', 'private preview', 'message', ?, ?)`,
        [event.insertId, recipient.id, sender.id, messageId, `message-delete:${messageId}`],
      );
      const [otherEvent] = await db.query(
        `INSERT INTO notification_events
           (recipient_user_id, actor_user_id, event_type, category, title, body, material_kind, material_id, dedupe_key)
         VALUES (?, ?, 'new_message', 'mentions', 'Other message', 'must remain', 'message', ?, ?)`,
        [recipient.id, sender.id, messageId + 1, `message-delete:other:${messageId}`],
      );
      await db.query(
        `INSERT INTO notification_deliveries
           (event_id, user_id, channel, mode, idempotency_key, status, next_attempt_at)
         VALUES (?, ?, 'telegram', 'immediate', ?, 'pending', UTC_TIMESTAMP())`,
        [otherEvent.insertId, recipient.id, `message-delete:other:${messageId}:telegram`],
      );

      const deleted = await call(sender, "DELETE", `/messages/${messageId}`);
      assert.equal(deleted.deletedBeforeRead, true);
      assert.equal("tombstone" in deleted, false);

      const [[row]] = await db.query("SELECT body, attachment_kind, attachment_id, read_at, deleted_at, deleted_before_read, moderation_retained_until FROM messages WHERE id = ?", [messageId]);
      assert.equal(row.body, "");
      assert.equal(row.read_at, null);
      assert.equal(Number(row.deleted_before_read), 1);
      assert.equal(row.moderation_retained_until, null);
      assert.ok(row.deleted_at);
      const [[evidence]] = await db.query("SELECT message_reference_id, sender_reference_id, recipient_reference_id, original_body, was_read, deleted_before_read, moderation_retained_until FROM message_deletion_evidence WHERE message_reference_id = ?", [messageId]);
      assert.equal(Number(evidence.message_reference_id), messageId);
      assert.equal(Number(evidence.sender_reference_id), sender.id);
      assert.equal(Number(evidence.recipient_reference_id), recipient.id);
      assert.equal(evidence.original_body, originalBody);
      assert.equal(Number(evidence.was_read), 0);
      assert.equal(Number(evidence.deleted_before_read), 1);
      assert.equal(evidence.moderation_retained_until, null);
      const [[liveRelations]] = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM message_reactions WHERE message_id = ?) AS reactions,
           (SELECT COUNT(*) FROM content_mentions WHERE entity_type = 'message' AND entity_id = ?) AS mentions,
           (SELECT COUNT(*) FROM notifications WHERE material_kind = 'message' AND material_id = ?) AS notifications`,
        [messageId, messageId, messageId],
      );
      assert.deepEqual([Number(liveRelations.reactions), Number(liveRelations.mentions), Number(liveRelations.notifications)], [0, 0, 0]);
      const [[cancelled]] = await db.query("SELECT status FROM notification_deliveries WHERE event_id = ?", [event.insertId]);
      const [[untouched]] = await db.query("SELECT status FROM notification_deliveries WHERE event_id = ?", [otherEvent.insertId]);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(untouched.status, "pending");

      for (const actor of [sender, recipient]) {
        const social = await call(actor, "GET", "/bootstrap/social");
        assert.equal((social.messages[conversation] ?? []).some((message) => message.id === messageId), false);
        assert.doesNotMatch(JSON.stringify(social), /Unread private evidence|message_deletion_evidence|original_body/);
      }
      await call(sender, "PATCH", `/messages/${messageId}`, { body: "cannot return" }, 404);
      await call(sender, "POST", `/messages/${messageId}/reactions/like`, {}, 404);
      await call(sender, "DELETE", `/messages/${messageId}`, undefined, 404);
    });

    await t.test("read deletion projects only a neutral tombstone", async () => {
      const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, body: "Read private evidence" }, 201);
      const messageId = Number(sent.message.id);
      await call(recipient, "PATCH", `/social/messages/${sender.id}/read`);
      const deleted = await call(sender, "DELETE", `/messages/${messageId}`);
      assert.equal(deleted.deletedBeforeRead, false);
      assert.equal(deleted.tombstone, TOMBSTONE);
      for (const actor of [sender, recipient]) {
        const social = await call(actor, "GET", "/bootstrap/social");
        const projected = social.messages[conversation].find((message) => message.id === messageId);
        assert.equal(projected.text, TOMBSTONE);
        assert.equal(projected.deleted, true);
        assert.equal(projected.read, true);
        assert.equal(projected.unread, false);
        assert.equal(projected.attachment, undefined);
        assert.deepEqual(projected.mentions, []);
        assert.equal(projected.likeCount, 0);
        assert.doesNotMatch(JSON.stringify(social), /Read private evidence|message_deletion_evidence|original_body/);
      }
    });

    await t.test("concurrent read and delete serialize to one coherent outcome", async () => {
      for (let index = 0; index < 4; index += 1) {
        const body = `Concurrent read-delete ${index}`;
        const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, body }, 201);
        const messageId = Number(sent.message.id);
        const [readResult, deleteResult] = await Promise.all([
          request(recipient, "PATCH", `/social/messages/${sender.id}/read`),
          request(sender, "DELETE", `/messages/${messageId}`),
        ]);
        assert.equal(readResult.status, 200, JSON.stringify(readResult.data));
        assert.equal(deleteResult.status, 200, JSON.stringify(deleteResult.data));
        const [[row]] = await db.query("SELECT read_at, deleted_at, deleted_before_read FROM messages WHERE id = ?", [messageId]);
        const [[evidence]] = await db.query("SELECT was_read, original_read_at, deleted_before_read, original_body FROM message_deletion_evidence WHERE message_reference_id = ?", [messageId]);
        assert.equal(evidence.original_body, body);
        assert.equal(Number(row.deleted_before_read), Number(evidence.deleted_before_read));
        if (Number(row.deleted_before_read)) {
          assert.equal(row.read_at, null);
          assert.equal(Number(evidence.was_read), 0);
          assert.equal(evidence.original_read_at, null);
        } else {
          assert.ok(row.read_at);
          assert.equal(Number(evidence.was_read), 1);
          assert.ok(evidence.original_read_at);
        }
        for (const actor of [sender, recipient]) {
          const social = await call(actor, "GET", "/bootstrap/social");
          const projected = (social.messages[conversation] ?? []).find((message) => message.id === messageId);
          if (Number(row.deleted_before_read)) assert.equal(projected, undefined);
          else assert.equal(projected?.text, TOMBSTONE);
          assert.doesNotMatch(JSON.stringify(social), new RegExp(body));
        }
      }
    });

    await t.test("a failed live-row update rolls back evidence and relation cleanup", async () => {
      const token = `@${mentioned.id}`;
      const body = `Rollback deletion ${token}`;
      const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, body, mentions: [{ userId: mentioned.id, token }] }, 201);
      const messageId = Number(sent.message.id);
      await call(sender, "POST", `/messages/${messageId}/reactions/like`, {});
      await db.query("DROP TRIGGER IF EXISTS q5_message_delete_rollback");
      await db.query("CREATE TRIGGER q5_message_delete_rollback BEFORE UPDATE ON messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'message deletion rollback sentinel'");
      rollbackTriggerCreated = true;
      try {
        const error = await call(sender, "DELETE", `/messages/${messageId}`, undefined, 500);
        assert.match(error.error, /rollback sentinel/i);
      } finally {
        await db.query("DROP TRIGGER IF EXISTS q5_message_delete_rollback");
        rollbackTriggerCreated = false;
      }
      const [[row]] = await db.query("SELECT body, deleted_at FROM messages WHERE id = ?", [messageId]);
      assert.equal(row.body, body);
      assert.equal(row.deleted_at, null);
      const [[relations]] = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM message_deletion_evidence WHERE message_reference_id = ?) AS evidence,
           (SELECT COUNT(*) FROM message_reactions WHERE message_id = ?) AS reactions,
           (SELECT COUNT(*) FROM content_mentions WHERE entity_type = 'message' AND entity_id = ?) AS mentions`,
        [messageId, messageId, messageId],
      );
      assert.deepEqual([Number(relations.evidence), Number(relations.reactions), Number(relations.mentions)], [0, 1, 1]);
    });

    await t.test("system and author-cleared messages use controlled errors", async () => {
      const [system] = await db.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, is_system) VALUES (?, ?, 'system', 1)", [sender.id, recipient.id]);
      const systemError = await call(sender, "DELETE", `/messages/${system.insertId}`, undefined, 409);
      assert.equal(systemError.code, "MESSAGE_SYSTEM_NOT_DELETABLE");
      const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, body: "Cleared deletion target" }, 201);
      await call(sender, "DELETE", `/social/messages/${recipient.id}/history`);
      const clearedError = await call(sender, "DELETE", `/messages/${sent.message.id}`, undefined, 404);
      assert.equal(clearedError.code, "MESSAGE_NOT_FOUND");
    });
  } finally {
    if (rollbackTriggerCreated) await db.query("DROP TRIGGER IF EXISTS q5_message_delete_rollback");
    await fixture.close();
  }
});
