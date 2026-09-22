import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("queue 4 schema has stable mention, comment and repost contracts", async () => {
  const migration = await read("mysql/migrations/043_social_content.sql");
  for (const fragment of ["parent_comment_id", "reply_to_comment_id", "deleted_at", "material_comment_likes", "content_mentions", "reposts", "provenance_repost_id", "clean_source_root_id"]) assert.match(migration, new RegExp(fragment));
  assert.match(migration, /mention_token VARCHAR/);
});

test("mentions retain stable ids and tokens across UI, DTO and chat boundaries", async () => {
  const [api, renderer, textarea, chat, data] = await Promise.all([read("server/api.js"), read("app/components/content/MentionText.tsx"), read("app/components/content/MentionTextarea.tsx"), read("app/components/chat/ChatComponents.tsx"), read("server/data.js")]);
  assert.match(api, /function mentionRefs/);
  assert.match(api, /mention_token/);
  assert.match(api, /entityType: "message"/);
  assert.match(api, /mentionDtos/);
  assert.match(textarea, /onMentionRefsChange/);
  assert.match(textarea, /ArrowDown/);
  assert.match(renderer, /never reparses arbitrary @words/);
  assert.match(renderer, /onOpenUser\(mention.userId\)/);
  assert.match(chat, /MentionTextarea/);
  assert.match(chat, /MentionText/);
  assert.match(data, /messageMentionRows/);
  assert.match(data, /contentMentionRows/);
});

test("unavailable mention labels are neutralized at the DTO boundary and in rich renderers", async () => {
  const [api, data, renderer] = await Promise.all([read("server/api.js"), read("server/data.js"), read("app/components/content/MentionText.tsx")]);
  for (const source of [api, data]) {
    assert.match(source, /NEUTRAL_MENTION_TOKEN\s*=\s*"@пользователь"/);
    assert.match(source, /Object\.defineProperty\(entry, "sourceToken"/);
    assert.match(source, /neutralizeMentionedText/);
  }
  assert.match(renderer, /const NEUTRAL_MENTION_LABEL = "@пользователь"/);
  assert.match(renderer, /findMentionPositions/);
  assert.match(renderer, /sort\(\(left, right\) => left\.start - right\.start/);
});

test("clean repost source is neutral when its owner or publisher approval is unavailable", async () => {
  const data = await read("server/data.js");
  assert.match(data, /source_owner_deleted_at/);
  assert.match(data, /source_owner_publisher_status !== "approved"/);
  assert.match(data, /source: \{ available: false, label: "Материал недоступен" \}/);
});

test("queue 4 API keeps viewer-aware hiding and idempotent social mutations server-side", async () => {
  const api = await read("server/api.js");
  for (const fragment of ["/users/:userId/hide", "/users/me/hidden-users", "hideExists", "syncMentions", "/comments/:id/like", "/materials/:type/:id/repost", "Комментарий скрыт"]) assert.match(api, new RegExp(fragment.replaceAll("/", "\\/")));
  assert.match(api, /addressedUserId/);
  assert.match(api, /escapedParagraph/);
});

test("repost and mention lifecycle stays transactional and does not expose provenance", async () => {
  const api = await read("server/api.js");
  assert.match(api, /isOwnTextRepost/);
  assert.match(api, /provenanceRepostId/);
  assert.match(api, /DELETE FROM reposts WHERE id = \? AND user_id = \?/);
  assert.match(api, /DELETE FROM reposts WHERE id = \?/);
  assert.match(api, /plainTextFromHtml\(bodyHtml\)/);
  assert.match(api, /mentionableText = String\(text \?\? ""\)/);
  assert.match(api, /\^@\[\\w\.\-\]\{1,30\}\$/);
});

test("shared comment UI owns reply, emoji and cursor controls", async () => {
  const comments = await read("app/components/content/SocialComments.tsx");
  for (const fragment of ["SocialComments", "MentionTextarea", "replyTo", "nextRepliesCursor", "replyCursors", "emoji-picker", "parentCommentId", "replyToCommentId", "Array\\.from\\(text\\)\\.length", "PATCH"]) assert.match(comments, new RegExp(fragment));
});

test("material engagement and reading modal use the one shared comments block", async () => {
  const content = await read("app/components/content/ContentComponents.tsx");
  const engagement = content.slice(content.indexOf("export function MaterialEngagement"), content.indexOf("type EventAttendee"));
  const reading = content.slice(content.indexOf("export function ReadingModal"), content.indexOf("function PublicProfileDetails"));
  assert.match(engagement, /<SocialComments/);
  assert.match(reading, /<SocialComments/);
  assert.doesNotMatch(reading, /comments\.slice\(/);
  assert.doesNotMatch(reading, /comment-pages/);
});

test("reposts stay limited to permitted material detail UI and clean reposts stay in profiles", async () => {
  const actions = await read("app/components/content/SocialMaterialActions.tsx");
  const content = await read("app/components/content/ContentComponents.tsx");
  const profile = await read("app/screens/ProfileScreens.tsx");
  assert.match(actions, /\/api\/materials\/\$\{kind\}\/\$\{materialId\}\/repost/);
  assert.match(actions, /MentionTextarea/);
  assert.match(content, /<RepostAction kind=\{kind\}/);
  assert.match(content, /item\.kind === "review" \|\| item\.kind === "excerpt"/);
  assert.doesNotMatch(content, /kind="book"[^>]*RepostAction|kind="comment"[^>]*RepostAction|kind="message"[^>]*RepostAction/);
  assert.match(profile, /profileUser\.cleanReposts/);
  assert.doesNotMatch(await read("app/screens/ContentScreens.tsx"), /cleanReposts/);
});

test("hidden user settings load, paginate and unhide through their own endpoint", async () => {
  const actions = await read("app/components/content/SocialMaterialActions.tsx");
  const profile = await read("app/screens/ProfileScreens.tsx");
  const messages = await read("app/i18n/messages.ts");
  assert.match(actions, /\/api\/users\/me\/hidden-users/);
  assert.match(actions, /method: "DELETE"/);
  assert.match(profile, /<HiddenUsersPanel/);
  for (const key of ["repost.action", "repost.unavailable", "hide.action", "hide.title"]) assert.match(messages, new RegExp(`"${key}"`));
});
