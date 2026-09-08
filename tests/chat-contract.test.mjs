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
