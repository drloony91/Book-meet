import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("message search API is indexed, rate-limited and viewer-scoped", async () => {
  const [migration, api, demo, searchModule, compliance] = await Promise.all([
    read("mysql/migrations/049_message_search.sql"),
    read("server/api.js"),
    read("server/demo-api.js"),
    read("server/modules/message-search.js"),
    read("server/modules/compliance.js"),
  ]);
  assert.match(migration, /FULLTEXT KEY messages_body_fulltext \(body\)/);
  assert.match(api, /router\.get\("\/conversations\/:id\/messages\/search", messageSearchRateLimit/);
  assert.match(api, /router\.get\("\/messages\/search", messageSearchRateLimit/);
  assert.match(api, /FORCE INDEX \(messages_body_fulltext\)/);
  assert.match(api, /MATCH\(m\.body\) AGAINST \(\? IN BOOLEAN MODE\)/);
  assert.match(api, /m\.deleted_at IS NULL[\s\S]*m\.deleted_before_read = 0/);
  assert.match(api, /m\.id > COALESCE\(history_clear\.cleared_through_message_id, 0\)/);
  assert.match(api, /assertMessagePairAccess\(connection, userId, peerId, \{ lock: false \}\)/);
  assert.match(api, /assertUsersCanInteract\(connection, userId, targetId, \{ lock \}\)/);
  assert.match(api, /assertAgeCompatible\(connection, userId, targetId, \{ lock \}\)/);
  assert.match(compliance, /ORDER BY u\.id\$\{lock \? " FOR UPDATE" : ""\}/);
  assert.doesNotMatch(api.slice(api.indexOf('router.get("/conversations/:id/messages/search"'), api.indexOf('router.post("/social/messages"')), /message_edit_history|message_deletion_evidence/);
  assert.match(demo, /router\.get\("\/conversations\/:id\/messages\/search", messageSearchRateLimit/);
  assert.match(demo, /router\.get\("\/messages\/search", messageSearchRateLimit/);
  assert.match(searchModule, /MESSAGE_SEARCH_MIN_TOKEN_LENGTH = 3/);
  assert.match(searchModule, /tokens\.map\(\(token\) => `\+\$\{token\}\*`\)/);
});

test("message search UI cancels stale requests and reaches exact messages on desktop and mobile", async () => {
  const [chat, layout, controller, mobile, css] = await Promise.all([
    read("app/components/chat/ChatComponents.tsx"),
    read("app/components/layout/AppLayout.tsx"),
    read("app/hooks/useBookMeetController.tsx"),
    read("app/screens/MobileMessagesPage.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(chat, /new AbortController\(\)/);
  assert.match(chat, /controller\.abort\(\)/);
  assert.match(chat, /data-message-id=\{message\.id\}/);
  assert.match(chat, /scrollIntoView\(\{ block: "center", behavior: "smooth" \}\)/);
  assert.match(chat, /is-search-highlighted/);
  assert.match(chat, /searchScrollTopRef/);
  assert.match(chat, /closeMessageSearch\(true\)/);
  assert.match(chat, /group\.matchesNextCursor/);
  assert.match(chat, /conversationSearchVersionRef/);
  assert.match(chat, /onSelectMessageSearchResult/);
  const toggleLike = chat.slice(chat.indexOf("async function toggleLike"), chat.indexOf("function startEditing"));
  assert.equal((toggleLike.match(/setPendingLikeMessageIds/g) ?? []).length, 2, "like pending state must be added and cleared exactly once");
  assert.match(layout, /onSelectMessageSearchResult=\{chatPage \? onSelectMessageSearchResult : undefined\}/);
  assert.match(controller, /initialTargetMessageId=\{chatTargetMessageId\}/);
  assert.match(mobile, /GeneralMessageSearch/);
  assert.match(css, /\.mobile-chat-dialog \.chat-search-header/);
  assert.match(css, /@keyframes message-search-highlight/);
});
