import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("A1 unified-conversation migration is additive and keeps direct chat on the legacy boundary", async () => {
  const [migration, api, data] = await Promise.all([
    read("mysql/migrations/052_unified_conversations_stop_point.sql"),
    read("server/api.js"),
    read("server/data.js"),
  ]);

  for (const fragment of [
    "CREATE TABLE conversations",
    "CREATE TABLE conversation_members",
    "conversation_backfill_orphans",
    "conversation_backfill_reconciliations",
    "conversation_type ENUM('direct', 'group', 'marketplace')",
    "direct_user_low_id",
    "direct_user_high_id",
    "created_actor_type",
    "created_actor_id",
    "created_by_user_id",
    "add_members_policy",
    "remove_members_policy",
    "history_cleared_message_id",
    "ADD COLUMN conversation_id",
    "uq_conversations_direct_pair",
    "fk_messages_conversation",
    "message_deletion_evidence",
    "sender_reference_id",
    "message_reference_id",
    "recipient_reference_id",
    "source_message_total",
    "mapped_message_total",
    "orphan_message_total",
    "active_membership_total",
  ]) assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(migration, /direct_user_low_id < direct_user_high_id/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /WHERE m\.conversation_id IS NULL/);
  assert.match(migration, /missing_sender_identity/);
  assert.match(migration, /self_pair/);
  assert.match(migration, /users\.deleted_at IS NULL/);
  assert.match(migration, /users\.purged_at IS NULL/);
  assert.match(migration, /source_message_total = mapped_message_total \+ orphan_message_total/);
  const orphanTable = migration.slice(migration.indexOf("CREATE TABLE conversation_backfill_orphans"), migration.indexOf("CREATE TABLE conversation_backfill_reconciliations"));
  assert.match(orphanTable, /message_id BIGINT UNSIGNED NULL/);
  assert.match(orphanTable, /recipient_user_id BIGINT UNSIGNED NULL/);
  assert.match(orphanTable, /ON DELETE SET NULL/);
  assert.doesNotMatch(orphanTable, /ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.doesNotMatch(api, /\/groups(?:\/|"|`)/);
  assert.match(data, /conversation\.conversation_type = 'direct'/);
});

test("A2 group lifecycle remains feature-gated and uses membership read boundaries", async () => {
  const [migration, api, feature] = await Promise.all([
    read("mysql/migrations/053_group_chat_server_foundations.sql"),
    read("server/api.js"),
    read("server/modules/group-chat-feature.js"),
  ]);
  for (const marker of ["operator_user_id", "last_read_message_id", "last_read_at", "conversation_polls", "message_id BIGINT UNSIGNED NOT NULL", "uq_conversation_polls_message", "uq_conversation_poll_option_poll_id", "fk_conversation_poll_votes_option_for_poll", "group_message_moderation_evidence", "deleter_reference_id", "original_sticker_id", "/group-conversations/:conversationId", "/polls/:pollId/vote", "pollDtosForMessages", "assertGroupJoinCandidate", "assertGroupCompatibility", "validatedGroupChatAttachment", "syncGroupMentions", "owner-transfer", "history_cleared_message_id", "group.deleted"]) assert.match(`${migration}\n${api}`, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(feature, /value === "1" \|\| value === "true"/);
  assert.match(api, /SELECT personal_user_id FROM linked_profiles/);
  assert.match(api, /messageId <= currentCursor/);
  assert.match(api, /advanced: false/);
  assert.match(api, /last_read_message_id = \?, last_read_at = UTC_TIMESTAMP/);
});
