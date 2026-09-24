import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

test("TZ5 stickers persist as standalone messages and deletion evidence", async () => {
  const fixture = await queue3HttpFixture("q5-message-sticker");
  const { db, user, call } = fixture;
  try {
    const sender = await user("sender"); const recipient = await user("recipient");
    await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [Math.min(sender.id, recipient.id), Math.max(sender.id, recipient.id)]);
    const catalog = await call(sender, "GET", "/stickers");
    const stickerId = catalog.stickers[0].id;
    await call(sender, "POST", "/social/messages", { targetId: recipient.id, stickerId: "unknown-sticker" }, 422);
    await call(sender, "POST", "/social/messages", { targetId: recipient.id, stickerId, body: "not standalone" }, 422);
    const sent = await call(sender, "POST", "/social/messages", { targetId: recipient.id, stickerId }, 201);
    const messageId = Number(sent.message.id);
    assert.equal(sent.message.kind, "sticker"); assert.equal(sent.message.sticker.id, stickerId);
    const [[stored]] = await db.query("SELECT body, message_kind, sticker_id, attachment_kind FROM messages WHERE id = ?", [messageId]);
    assert.deepEqual([stored.body, stored.message_kind, stored.sticker_id, stored.attachment_kind], ["", "sticker", stickerId, null]);
    const edit = await call(sender, "PATCH", `/messages/${messageId}`, { body: "no" }, 409);
    assert.equal(edit.code, "MESSAGE_STICKER_NOT_EDITABLE");
    await call(recipient, "PATCH", `/social/messages/${sender.id}/read`);
    await call(sender, "DELETE", `/messages/${messageId}`);
    const [[evidence]] = await db.query("SELECT original_body, message_kind, sticker_id FROM message_deletion_evidence WHERE message_reference_id = ?", [messageId]);
    assert.deepEqual([evidence.original_body, evidence.message_kind, evidence.sticker_id], ["", "sticker", stickerId]);
    const [[deleted]] = await db.query("SELECT message_kind, sticker_id FROM messages WHERE id = ?", [messageId]);
    assert.deepEqual([deleted.message_kind, deleted.sticker_id], ["text", null]);
  } finally { await fixture.close(); }
});
