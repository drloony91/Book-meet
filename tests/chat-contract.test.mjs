import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chatDayLabel, localCalendarDayKey, sortChatFriends } from "../app/components/chat/chat-utils.js";

const root = path.resolve(import.meta.dirname, "..");

test("chat dates use the viewer local calendar and localized labels", () => {
  process.env.TZ = "Asia/Almaty";
  const now = new Date("2026-08-30T00:30:00+05:00");
  assert.equal(localCalendarDayKey(new Date("2026-08-29T20:30:00Z")), "2026-08-30");
  assert.equal(chatDayLabel(new Date("2026-08-29T20:30:00Z"), now, "ru", "Сегодня", "Вчера"), "Сегодня");
  assert.equal(chatDayLabel(new Date("2026-08-29T18:59:00Z"), now, "ru", "Сегодня", "Вчера"), "Вчера");
  assert.equal(chatDayLabel(new Date("2026-08-26T10:00:00+05:00"), now, "ru", "Сегодня", "Вчера"), "26 августа");
  assert.equal(chatDayLabel(new Date("2025-08-26T10:00:00+05:00"), now, "ru", "Сегодня", "Вчера"), "26 августа 2025 года");
  assert.equal(chatDayLabel(new Date("2025-08-26T10:00:00+05:00"), now, "en", "Today", "Yesterday"), "August 26, 2025");
});

test("chat rows sort by user-message activity, keep empty rows stable and support last", () => {
  const rows = [
    { id: 1, name: "Empty A" },
    { id: 2, name: "Older", lastActivityAt: "2026-08-28T10:00:00Z" },
    { id: 3, name: "Empty B" },
    { id: 4, name: "Newest", lastActivityAt: "2026-08-30T10:00:00Z" },
    { id: 5, name: "Support", support: true, lastActivityAt: "2026-08-31T10:00:00Z" },
  ];
  assert.deepEqual(sortChatFriends(rows).map((row) => row.id), [4, 2, 1, 3, 5]);
});

test("production chat persistence, per-user clearing and notification boundaries are explicit", async () => {
  const [migration, api, data, demo, controller, chat, domain, bootstrapRouter] = await Promise.all([
    readFile(path.join(root, "mysql/migrations/038_chat_history_clears.sql"), "utf8"),
    readFile(path.join(root, "server/api.js"), "utf8"),
    readFile(path.join(root, "server/data.js"), "utf8"),
    readFile(path.join(root, "server/demo-api.js"), "utf8"),
    readFile(path.join(root, "app/hooks/useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app/components/chat/ChatComponents.tsx"), "utf8"),
    readFile(path.join(root, "app/types/domain.ts"), "utf8"),
    readFile(path.join(root, "server/modules/bootstrap-router.js"), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS chat_history_clears/);
  assert.match(migration, /PRIMARY KEY \(user_id, peer_user_id\)/);
  assert.match(migration, /cleared_through_message_id BIGINT UNSIGNED NOT NULL/);
  assert.match(migration, /DELETE FROM notifications WHERE notification_type = 'new_message'/);
  assert.match(api, /router\.delete\("\/social\/messages\/:targetId\/history"/);
  assert.match(api, /async function assertMessagePairAccess/);
  assert.match(api, /router\.patch\("\/social\/messages\/:targetId\/read"[\s\S]+?assertMessagePairAccess\(connection, userId, targetId\)/);
  assert.match(api, /COALESCE\(MAX\(id\), 0\) AS message_id/);
  assert.match(api, /INSERT INTO chat_history_clears/);
  assert.doesNotMatch(api, /notification_type, title, body, group_key\)[\s\S]{0,180}'new_message'/);
  assert.match(data, /notification_type <> 'new_message'/);
  assert.match(data, /clearedThroughByPeer/);
  assert.match(data, /activeOrganizationIds/);
  assert.match(bootstrapRouter, /activeOrganizationIds/);
  assert.match(domain, /activeOrganizationIds\?: number\[\]/);
  assert.doesNotMatch(controller, /addNotification\([^\n]+type: "new_message"/);
  assert.doesNotMatch(controller, /setMessages\([^\n]+system: true/);
  assert.match(controller, /activeUnreadMessageIds/);
  assert.match(controller, /sortChatFriends/);
  assert.match(controller, /onClearHistory=\{clearChatHistory\}/);
  assert.match(chat, /messageGroups/);
  assert.match(chat, /scheduleNextLocalMidnight/);
  assert.match(chat, /system-message[\s\S]+?<time dateTime=\{message\.createdAt\}>\{messageTime\(message\)\}<\/time>/);
  assert.match(chat, /chat\.clearHistory/);
  assert.match(demo, /chatHistoryClears/);
  assert.match(demo, /function assertDemoMessagePairAccess/);
  assert.match(demo, /CROSS_AGE_INTERACTION_FORBIDDEN/);
  assert.doesNotMatch(demo, /notification\(targetId, request\.demoUserId, "new_message"/);
});

test("publisher and community news are readable share attachments in production and demo", async () => {
  const [api, demo, types, controller, content, messages, routes] = await Promise.all([
    readFile(path.join(root, "server/api.js"), "utf8"),
    readFile(path.join(root, "server/demo-api.js"), "utf8"),
    readFile(path.join(root, "app/components/chat/types.ts"), "utf8"),
    readFile(path.join(root, "app/hooks/useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app/components/content/ContentComponents.tsx"), "utf8"),
    readFile(path.join(root, "app/i18n/messages.ts"), "utf8"),
    readFile(path.join(root, "docs/codex/ROUTES_AND_API.md"), "utf8"),
  ]);
  assert.match(types, /ChatAttachmentKind = .*publisher_news/);
  assert.match(controller, /kind: "publisher_news"/);
  assert.match(controller, /openPersonalMaterial\("publisher_news", attachment\.id\)/);
  assert.match(content, /shareAttachment=\{actions\.shareAttachment \?\? \{ kind: "publisher_news", id: item\.id \}\}/);
  assert.match(content, /shareAttachment=\{\{ kind: "publisher_news", id: item\.id \}\}/);
  assert.match(api, /publisher_news: "SELECT n\.id, n\.user_id AS owner_id FROM publisher_news/);
  assert.match(api, /\["review", "excerpt", "event", "occasion", "publisher_news", "shelf"\]\.includes\(kind\)/);
  assert.match(demo, /\["book", "review", "excerpt", "event", "occasion", "publisher_news", "shelf"\]\.includes\(kind\)/);
  assert.match(demo, /publisherStatus === "approved".*publisherNews/);
  assert.match(messages, /chat\.sharePublisherNews/);
  assert.match(messages, /chat\.hintPublisherNews/);
  assert.match(routes, /approved `publisher_news`/);
});

test("chat realtime invalidations are targeted, content-free and refresh only the social projection", async () => {
  const [api, demo, controller, routes, architecture, packageJson] = await Promise.all([
    readFile(path.join(root, "server/api.js"), "utf8"),
    readFile(path.join(root, "server/demo-api.js"), "utf8"),
    readFile(path.join(root, "app/hooks/useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "docs/codex/ROUTES_AND_API.md"), "utf8"),
    readFile(path.join(root, "docs/codex/ARCHITECTURE.md"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
  ]);
  assert.match(api, /const client = \{ response, userId: Number\(request\.bookMeetUser\.id\) \}/);
  assert.match(api, /function broadcastChatRealtime\(\{ userIds, payload \}\)/);
  assert.match(api, /if \(!recipients\.has\(client\.userId\)\) continue/);
  assert.match(api, /if \(response\.statusCode >= 400\) return;[\s\S]+?response\.locals\.chatRealtime/);
  assert.match(api, /queueChatRealtime\(response, \[userId, targetId\], \{ type: "message\.created", messageId: createdMessage\.id \}\)/);
  assert.match(api, /queueChatRealtime\(response, \[userId\], \{ type: "history\.cleared" \}\)/);
  assert.doesNotMatch(api, /queueChatRealtime\([^\n]+(?:body|attachment|sticker|mentions)/);
  assert.match(demo, /const client = \{ response, userId: Number\(request\.demoUserId\) \}/);
  assert.match(demo, /broadcastDemoRealtime\("chat", payload, userIds\)/);
  assert.match(controller, /eventsSource\.addEventListener\("chat", \(\) => \{ void refreshSocial\(\); \}\)/);
  assert.match(controller, /const data = await loadApplicationData\(\["social"\]\)/);
  assert.match(controller, /Number\(data\.activeUserId\) !== activeUserId/);
  assert.doesNotMatch(controller, /addEventListener\("chat",[^\n]+event\.data/);
  assert.match(routes, /content-free `chat` invalidation/);
  assert.match(architecture, /reload `\/bootstrap\/social`/);
  assert.match(packageJson, /tests\/message-realtime-demo-http\.test\.mjs/);
});

test("message likes are participant-scoped, idempotent and projected without N+1 queries", async () => {
  const [migration, api, data, demo, controller, chat, types, messages, routes, model] = await Promise.all([
    readFile(path.join(root, "mysql/migrations/044_message_reactions.sql"), "utf8"),
    readFile(path.join(root, "server/api.js"), "utf8"),
    readFile(path.join(root, "server/data.js"), "utf8"),
    readFile(path.join(root, "server/demo-api.js"), "utf8"),
    readFile(path.join(root, "app/hooks/useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app/components/chat/ChatComponents.tsx"), "utf8"),
    readFile(path.join(root, "app/components/chat/types.ts"), "utf8"),
    readFile(path.join(root, "app/i18n/messages.ts"), "utf8"),
    readFile(path.join(root, "docs/codex/ROUTES_AND_API.md"), "utf8"),
    readFile(path.join(root, "docs/codex/DATA_MODEL.md"), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_reactions/);
  assert.match(migration, /reaction_type ENUM\('like'\) NOT NULL DEFAULT 'like'/);
  assert.match(migration, /PRIMARY KEY \(message_id, user_id\)/);
  assert.match(migration, /REFERENCES messages\(id\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(api, /async function assertMessageReactionAccess/);
  assert.match(api, /sender_user_id = \? OR recipient_user_id = \?/);
  assert.match(api, /cleared_through_message_id/);
  assert.match(api, /MESSAGE_REACTION_NOT_ALLOWED/);
  assert.match(api, /router\.post\("\/messages\/:id\/reactions\/like", messageReactionRateLimit/);
  assert.match(api, /router\.delete\("\/messages\/:id\/reactions\/like", messageReactionRateLimit/);
  assert.match(api, /INSERT IGNORE INTO message_reactions/);
  assert.match(data, /message_id IN \(\$\{messageIds\.map/);
  assert.match(data, /likeCount: likedByUserIds\.length/);
  assert.match(data, /likedByViewer: likedByUserIds\.includes/);
  assert.match(demo, /messageReactions: \{\}/);
  assert.match(demo, /assertDemoMessageReactionAccess/);
  assert.match(demo, /clearedThroughMessageId = Number\(state\.chatHistoryClears/);
  assert.match(types, /likedByUserIds\?: number\[\]/);
  assert.match(controller, /async function toggleMessageLike/);
  assert.match(controller, /async function toggleMessageLike[\s\S]+?if \(!response\.ok \|\| data\.messageId !== messageId[\s\S]+?setMessages\(\(current\)/);
  assert.match(chat, /className={`message-like-button/);
  assert.match(chat, /aria-pressed=\{Boolean\(message\.likedByViewer\)\}/);
  for (const key of ["chat.likeMessage", "chat.unlikeMessage", "chat.likeError"]) assert.match(messages, new RegExp(`"${key}"`));
  assert.match(routes, /POST\/DELETE `\/messages\/:id\/reactions\/like`/);
  assert.match(model, /`message_reactions`/);
});

test("message editing is author-only, transactional and projects no private history", async () => {
  const [migration, api, data, demo, controller, chat, types, messages, routes, model] = await Promise.all([
    readFile(path.join(root, "mysql/migrations/045_message_edits.sql"), "utf8"),
    readFile(path.join(root, "server/api.js"), "utf8"),
    readFile(path.join(root, "server/data.js"), "utf8"),
    readFile(path.join(root, "server/demo-api.js"), "utf8"),
    readFile(path.join(root, "app/hooks/useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app/components/chat/ChatComponents.tsx"), "utf8"),
    readFile(path.join(root, "app/components/chat/types.ts"), "utf8"),
    readFile(path.join(root, "app/i18n/messages.ts"), "utf8"),
    readFile(path.join(root, "docs/codex/ROUTES_AND_API.md"), "utf8"),
    readFile(path.join(root, "docs/codex/DATA_MODEL.md"), "utf8"),
  ]);
  assert.match(migration, /ALTER TABLE messages[\s\S]+edited_at TIMESTAMP NULL/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_edit_history/);
  assert.match(migration, /message_reference_id BIGINT UNSIGNED NOT NULL/);
  assert.match(migration, /previous_body TEXT NOT NULL/);
  assert.match(migration, /REFERENCES messages\(id\) ON DELETE SET NULL/);
  assert.match(api, /router\.patch\("\/messages\/:id", messageEditRateLimit/);
  assert.match(api, /WHERE id = \? AND sender_user_id = \?/);
  assert.match(api, /MESSAGE_SYSTEM_NOT_EDITABLE/);
  assert.match(api, /MESSAGE_ATTACHMENT_NOT_EDITABLE/);
  assert.match(api, /MESSAGE_BODY_REQUIRED/);
  assert.match(api, /INSERT INTO message_edit_history/);
  assert.match(api, /syncMentions\(connection, \{ entityType: "message"[\s\S]+mentionUserIds: request\.body\?\.mentionUserIds/);
  assert.match(data, /editedAt: !deleted && row\.edited_at/);
  assert.doesNotMatch(data, /FROM message_edit_history/);
  assert.match(demo, /messageEditHistory: \[\]/);
  assert.match(demo, /messageEditHistory: _messageEditHistory/);
  assert.match(demo, /router\.patch\("\/messages\/:id", messageEditRateLimit/);
  assert.match(types, /editedAt\?: string/);
  assert.match(controller, /async function editMessage/);
  assert.match(controller, /const requestId = \+\+messageEditRequestRef\.current/);
  assert.match(controller, /messageEditRequestRef\.current !== requestId/);
  assert.match(controller, /selectedFriendIdRef\.current !== friendId/);
  assert.match(controller, /if \(!response\.ok \|\| data\.message\?\.id !== messageId/);
  assert.match(chat, /className="message-edit-form"/);
  assert.match(chat, /message\.mine && !message\.attachment/);
  assert.match(chat, /event\.key === "Escape"/);
  assert.match(chat, /const operationId = \+\+editOperationRef\.current/);
  assert.match(chat, /editOperationRef\.current !== operationId/);
  assert.match(chat, /message-edited-label/);
  for (const key of ["chat.editMessage", "chat.editSave", "chat.editCancel", "chat.editEmpty", "chat.editError", "chat.edited"]) assert.match(messages, new RegExp(`"${key}"`));
  assert.match(routes, /`PATCH \/messages\/:id`/);
  assert.match(model, /`message_edit_history`/);
});

test("message deletion is author-only, race-safe and keeps private evidence out of DTOs", async () => {
  const [migration, api, data, demo, controller, chat, types, messages, routes, model, packageJson] = await Promise.all([
    readFile(path.join(root, "mysql/migrations/048_message_deletion_evidence.sql"), "utf8"),
    readFile(path.join(root, "server/api.js"), "utf8"),
    readFile(path.join(root, "server/data.js"), "utf8"),
    readFile(path.join(root, "server/demo-api.js"), "utf8"),
    readFile(path.join(root, "app/hooks/useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app/components/chat/ChatComponents.tsx"), "utf8"),
    readFile(path.join(root, "app/components/chat/types.ts"), "utf8"),
    readFile(path.join(root, "app/i18n/messages.ts"), "utf8"),
    readFile(path.join(root, "docs/codex/ROUTES_AND_API.md"), "utf8"),
    readFile(path.join(root, "docs/codex/DATA_MODEL.md"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
  ]);
  assert.match(migration, /deleted_before_read TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(migration, /moderation_retained_until DATETIME NULL/);
  assert.match(migration, /CREATE TABLE message_deletion_evidence/);
  assert.match(migration, /message_reference_id BIGINT UNSIGNED NOT NULL/);
  assert.match(migration, /original_body TEXT NOT NULL/);
  assert.match(migration, /REFERENCES messages\(id\) ON DELETE SET NULL/);
  assert.match(api, /async function assertMessageDeleteAccess/);
  assert.match(api, /assertMessageDeleteAccess[\s\S]+?assertMessagePairAccess[\s\S]+?FOR UPDATE/);
  assert.match(api, /router\.delete\("\/messages\/:id", messageEditRateLimit/);
  assert.match(api, /INSERT INTO message_deletion_evidence/);
  assert.match(api, /SET body = '', attachment_kind = NULL, attachment_id = NULL/);
  assert.match(api, /materialKind: "message"[\s\S]+?materialId: messageId/);
  assert.match(api, /SELECT id FROM messages FORCE INDEX \(PRIMARY\)[\s\S]+?WHERE id IN \(\$\{candidates\.map[\s\S]+?ORDER BY id FOR UPDATE/);
  assert.match(data, /if \(row\.deleted_before_read\) return false/);
  assert.match(data, /deleted \? "Пользователь удалил это сообщение" : row\.body/);
  assert.doesNotMatch(data, /FROM message_deletion_evidence/);
  assert.match(demo, /messageDeletionEvidence: \[\]/);
  assert.match(demo, /messageDeletionEvidence: _messageDeletionEvidence/);
  assert.match(types, /deleted\?: boolean/);
  assert.match(controller, /async function deleteMessage/);
  assert.match(controller, /messageDeleteRequestRef\.current\.get\(messageId\) !== requestId/);
  assert.match(chat, /className="message-delete-button"/);
  assert.match(chat, /message\.deleted \? t\("chat\.messageDeleted"\)/);
  for (const key of ["chat.deleteMessage", "chat.deleteMessageConfirm", "chat.deleteMessageError", "chat.messageDeleted"]) assert.match(messages, new RegExp(`"${key}"`));
  assert.match(routes, /`DELETE \/messages\/:id`/);
  assert.match(model, /`message_deletion_evidence`/);
  assert.match(packageJson, /tests\/message-deletions-demo-http\.test\.mjs/);
});
