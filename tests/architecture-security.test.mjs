import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { plainTextFromHtml, validateRichHtml } from "../server/modules/content-security.js";
import { imageType } from "../server/modules/image-storage.js";
import { requestLimitPolicy } from "../server/modules/request-limits.js";
import { canCreateFriendRequest, canMessagePair } from "../server/modules/social-permissions.js";
import { ageFromBirthDate } from "../server/data.js";
import { nextTopRank, top3Eligibility } from "../server/modules/top3.js";
import { createTelegramOutboxDispatcher, dispatchTelegramOutbox, shouldEnqueueSupportAlert, telegramAlertsEnabled, telegramAlertText, telegramDiagnostics } from "../server/modules/telegram-outbox.js";
import { safeReturnTo } from "../app/lib/navigation-security.js";
import { loadPublicCatalog } from "../server/modules/public-catalog.js";
import { consumeAccountActionToken, createOpaqueActionToken, hashAccountActionToken, replaceAccountActionToken } from "../server/modules/account-tokens.js";
import { mailerDiagnostics, mailerEnabled, sendAccountEmail } from "../server/modules/mailer.js";
import { occasionPayload } from "../server/modules/material-input.js";
import { en, kk, ru } from "../app/i18n/messages.ts";
import { notificationCategoryFor } from "../app/lib/notification-categories.js";

const root = path.resolve(import.meta.dirname, "..");
const assertLocalized = (source, key) => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(source, new RegExp(`(?:t\\(\\s*|translate\\([^,]+,\\s*)["']${escapedKey}["']`));
  for (const messages of [ru, kk, en]) assert.equal(typeof messages[key], "string", `${key} must exist in every locale`);
};

test("TOP3 assigns stable free ranks and rejects ineligible copies", () => {
  assert.equal(nextTopRank([{ book_id: 10, top_rank: 1 }, { book_id: 11, top_rank: 3 }], 11), 3);
  assert.equal(nextTopRank([{ book_id: 10, top_rank: 1 }, { book_id: 11, top_rank: 3 }], 12), 2);
  assert.equal(nextTopRank([{ book_id: 10, top_rank: 1 }, { book_id: 11, top_rank: 2 }, { book_id: 12, top_rank: 3 }], 13), null);
  assert.deepEqual(top3Eligibility({ isAuthor: false, readingStatus: "read" }), { allowed: true });
  assert.equal(top3Eligibility({ isAuthor: true, readingStatus: "read" }).allowed, false);
  assert.equal(top3Eligibility({ isAuthor: false, readingStatus: "reading" }).allowed, false);
});

test("guest returnTo accepts only same-origin application paths", () => {
  const origin = "https://bookmeet.club";
  assert.equal(safeReturnTo("/books?sort=popular#top", origin), "/books?sort=popular#top");
  assert.equal(safeReturnTo("https://bookmeet.club/communities", origin), "/communities");
  assert.equal(safeReturnTo("https://evil.example/steal", origin), "/");
  assert.equal(safeReturnTo("//evil.example/steal", origin), "/");
  assert.equal(safeReturnTo("javascript:alert(1)", origin), "/");
});

test("meet and discuss occasions accept at most one optional city", () => {
  const base = { type: "meet", primaryText: "Обо мне", audienceText: "Кого ищу", targetGender: "Все", targetProfileType: "Все" };
  assert.deepEqual(occasionPayload({ ...base, targetCities: [] }).targetCities, []);
  assert.deepEqual(occasionPayload({ ...base, targetCities: ["Астана"] }).targetCities, ["Астана"]);
  assert.throws(() => occasionPayload({ ...base, targetCities: ["Астана", "Алматы"] }), /только один город/);
});

test("account action tokens are opaque, purpose-scoped, expiring and single-use", async () => {
  const rows = new Map();
  const connection = { query: async (sql, values = []) => {
    if (sql.startsWith("DELETE FROM account_action_tokens")) { for (const [key, value] of rows) if (value.userId === values[0] && value.purpose === values[1]) rows.delete(key); return [{ affectedRows: 1 }]; }
    if (sql.startsWith("INSERT INTO account_action_tokens")) { rows.set(values[2], { id: values[2], userId: values[0], purpose: values[1], expired: false, consumed: false }); return [{ insertId: 1 }]; }
    if (sql.includes("FROM account_action_tokens")) { const row = rows.get(values[0]); return [[row && row.purpose === values[1] && !row.expired && !row.consumed ? { id: row.id, user_id: row.userId } : undefined]]; }
    if (sql.startsWith("UPDATE account_action_tokens SET consumed_at")) { const row = rows.get(values[0]); if (!row || row.consumed) return [{ affectedRows: 0 }]; row.consumed = true; return [{ affectedRows: 1 }]; }
    throw new Error(`Unexpected token query: ${sql}`);
  } };
  const token = createOpaqueActionToken();
  assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(hashAccountActionToken(token), token);
  await replaceAccountActionToken(connection, { userId: 42, purpose: "password_reset", token, ttlMinutes: 30 });
  assert.equal(await consumeAccountActionToken(connection, { token, purpose: "email_verify" }), null);
  assert.equal(await consumeAccountActionToken(connection, { token, purpose: "password_reset" }), 42);
  assert.equal(await consumeAccountActionToken(connection, { token, purpose: "password_reset" }), null);
  const expiredToken = createOpaqueActionToken();
  await replaceAccountActionToken(connection, { userId: 42, purpose: "password_reset", token: expiredToken, ttlMinutes: 30 });
  rows.get(hashAccountActionToken(expiredToken)).expired = true;
  assert.equal(await consumeAccountActionToken(connection, { token: expiredToken, purpose: "password_reset" }), null);
});

test("mailer is an env-only safe no-op when SMTP is not configured", async () => {
  assert.equal(mailerEnabled({}), false);
  assert.deepEqual(mailerDiagnostics({}), { configured: false, enabled: false, status: "not_configured", missing: ["smtp_host", "smtp_user", "smtp_pass", "mail_from"], portValid: true, secure: false, transportMode: "starttls_required" });
  const diagnostics = mailerDiagnostics({ SMTP_HOST: "smtp.example", SMTP_USER: "user", SMTP_PASS: "password", MAIL_FROM: "Book Meet <no-reply@example.com>", SMTP_PORT: "465", SMTP_SECURE: "1" });
  assert.deepEqual(diagnostics, { configured: true, enabled: true, status: "configured_unverified", missing: [], portValid: true, secure: true, transportMode: "implicit_tls" });
  assert.doesNotMatch(JSON.stringify(diagnostics), /smtp\.example|password|no-reply/);
  assert.deepEqual(await sendAccountEmail({ to: "person@example.com", subject: "test", text: "text" }, {}), { delivered: false, reason: "disabled" });
});

test("delivery diagnostics expose structural status only", () => {
  assert.deepEqual(telegramDiagnostics({}), { configured: false, enabled: false, status: "not_configured" });
  assert.deepEqual(telegramDiagnostics({ TELEGRAM_BOT_TOKEN: "secret-token", TELEGRAM_CHAT_ID: "42", TELEGRAM_ALERTS_ENABLED: "0" }), { configured: true, enabled: false, status: "disabled" });
  const configured = telegramDiagnostics({ TELEGRAM_BOT_TOKEN: "secret-token", TELEGRAM_CHAT_ID: "42", TELEGRAM_ALERTS_ENABLED: "1" });
  assert.deepEqual(configured, { configured: true, enabled: true, status: "configured_unverified" });
  assert.doesNotMatch(JSON.stringify(configured), /secret-token|42/);
});

test("notification category mapping is exhaustive and unknown types stay in All", () => {
  assert.equal(notificationCategoryFor("like"), "reactions");
  assert.equal(notificationCategoryFor("comment"), "comments");
  for (const type of ["event_submitted", "event_moderation", "event_reminder"]) assert.equal(notificationCategoryFor(type), "events");
  for (const type of ["friend_request", "friendship_started", "friend_rejected", "new_follower", "friendship_ended", "publication", "author_book_activity", "gift_reserved"]) assert.equal(notificationCategoryFor(type), "friends");
  assert.equal(notificationCategoryFor("system_future"), null);
});

test("Nodemailer dynamic import and createTransport API remain compatible without delivery", async () => {
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport({ streamTransport: true, newline: "unix", buffer: true });
  assert.equal(typeof transport.sendMail, "function");
  assert.equal(typeof transport.close, "function");
  transport.close();
});

test("public catalog maps only the minimal read-only DTO", async () => {
  const results = [
    [[{ id: 1, author: "Автор", title: "Книга", genres: "[]", annotation: "Текст", cover_tone: "blue", created_at: "2026-01-01", popularity: 2 }]],
    [[{ id: 2, kind: "review", title: "Книга", preview: "Отзыв", owner_id: 8, owner_name: "Читатель", owner_initials: "ЧТ", owner_color: "mint", owner_avatar_path: "/uploads/reader.jpg", created_at: "2026-01-02", private_email: "hidden@example.com" }]],
    [[]],
    [[]],
    [[
      { id: 3, title: "Событие", summary: "Описание", event_date: new Date("2026-08-20T00:00:00Z"), event_time: "18:00", city: "Алматы", address: "Адрес", created_at: "2026-01-03" },
      { id: 30, title: "Прошедшее", summary: "", event_date: "2026-08-10", event_time: "18:00", city: "Алматы", address: "", created_at: "2026-01-03" },
    ]],
    [[
      { id: 5, occasion_type: "meet", primary_text: "Поговорим о книгах", audience_text: "Ищу собеседника", target_cities: '["Астана"]', target_gender: "Все", target_profile_type: "Все", status: "published", is_adult: 0, created_at: "2026-01-04" },
      { id: 6, occasion_type: "meet", primary_text: "Только для читателей", audience_text: "", target_cities: "[]", target_gender: "Все", target_profile_type: "Читатель", status: "published", is_adult: 0, created_at: "2026-01-04" },
      { id: 7, occasion_type: "meet", primary_text: "18+", audience_text: "", target_cities: "[]", target_gender: "Все", target_profile_type: "Все", status: "published", is_adult: 1, created_at: "2026-01-04" },
    ]],
    [[{ id: 4, initials: "КК", color: "blue", display_name: "Клуб", city: "Астана", profile_type: "Сообщество", bio: "О клубе", community_type: "Книжный клуб", publisher_bin: "secret" }]],
  ];
  const data = await loadPublicCatalog({ query: async () => results.shift() }, { now: new Date("2026-08-12T12:00:00Z") });
  assert.deepEqual(Object.keys(data.materials[0]).sort(), ["createdAt", "id", "kind", "owner", "ownerName", "preview", "title"]);
  assert.deepEqual(Object.keys(data.materials[0].owner).sort(), ["avatarUrl", "color", "id", "initials", "name"]);
  assert.deepEqual(Object.keys(data.organizations[0]).sort(), ["avatarUrl", "bio", "city", "color", "communityIsClosed", "communityType", "id", "initials", "name", "type"].sort());
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].date, "2026-08-20");
  assert.equal(data.occasions.length, 1);
  assert.deepEqual(Object.keys(data.occasions[0]).sort(), ["audienceText", "createdAt", "id", "meetingAddress", "meetingCity", "meetingDate", "meetingEndTime", "meetingStartTime", "primaryText", "targetCities", "type"]);
  assert.equal("private_email" in data.materials[0], false);
  assert.equal("private_email" in data.materials[0].owner, false);
  assert.equal("publisher_bin" in data.organizations[0], false);
});

test("demo public catalog reuses the safe event and occasion policies", async () => {
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  assert.match(demo, /state\.events\.filter\(\(item\) => isPublicUpcomingEvent\(item\)\)/);
  assert.match(demo, /state\.occasions\.filter\(isPublicOccasion\)/);
});

test("Telegram outbox filters admin replies and delivers without payload leakage", async () => {
  const participants = [{ id: 1, role: "user" }, { id: 2, role: "admin" }];
  assert.equal(shouldEnqueueSupportAlert(participants, 1, 2), true);
  assert.equal(shouldEnqueueSupportAlert(participants, 2, 1), false);
  assert.equal(telegramAlertsEnabled({ TELEGRAM_ALERTS_ENABLED: "1", TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" }), true);
  assert.equal(telegramAlertsEnabled({ TELEGRAM_ALERTS_ENABLED: "0", TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" }), false);
  const poolQueries = [];
  const environment = { TELEGRAM_ALERTS_ENABLED: "1", TELEGRAM_BOT_TOKEN: "secret-token", TELEGRAM_CHAT_ID: "alerts" };
  let requestBody;
  const result = await dispatchTelegramOutbox({
    environment,
    claimNext: async () => ({ id: 9, event_type: "support_message", entity_id: 71, summary: "Новое сообщение пользователя", attempts: 0 }),
    fetchImpl: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, status: 200 }; },
    pool: { query: async (...args) => { poolQueries.push(args); } },
  });
  assert.equal(result.status, "delivered");
  assert.equal(requestBody.chat_id, "alerts");
  assert.doesNotMatch(requestBody.text, /secret-token|alerts/);
  assert.match(telegramAlertText({ event_type: "report_created", entity_id: 4, summary: "book" }), /ID: 4/);
  assert.match(poolQueries[0][0], /delivered_at = UTC_TIMESTAMP\(\)/);
});

test("Telegram outbox retries safely and skips an empty or disabled queue", async () => {
  const environment = { TELEGRAM_ALERTS_ENABLED: "1", TELEGRAM_BOT_TOKEN: "very-secret", TELEGRAM_CHAT_ID: "42" };
  const poolQueries = [];
  const retry = await dispatchTelegramOutbox({
    environment,
    claimNext: async () => ({ id: 10, event_type: "report_created", entity_id: 3, summary: "user", attempts: 1 }),
    fetchImpl: async () => { throw new Error("https://api.telegram.org/botvery-secret/sendMessage failed"); },
    pool: { query: async (...args) => { poolQueries.push(args); } },
  });
  assert.equal(retry.status, "retry");
  assert.equal(retry.attempts, 2);
  assert.doesNotMatch(String(poolQueries[0][1][2]), /very-secret/);
  let fetched = false;
  const idle = await dispatchTelegramOutbox({ environment, claimNext: async () => null, fetchImpl: async () => { fetched = true; } });
  assert.equal(idle.status, "idle");
  assert.equal(fetched, false);
  const disabled = await dispatchTelegramOutbox({ environment: { TELEGRAM_ALERTS_ENABLED: "0" }, fetchImpl: async () => { fetched = true; } });
  assert.equal(disabled.status, "disabled");
});

test("Telegram dispatcher stops cleanly and delivered rows are not claimed twice", async () => {
  const environment = { TELEGRAM_ALERTS_ENABLED: "1", TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" };
  let pending = { id: 12, event_type: "event_pending", entity_id: 8, summary: "Событие", attempts: 0 };
  let sends = 0;
  const options = {
    environment,
    claimNext: async () => pending,
    fetchImpl: async () => { sends += 1; return { ok: true, status: 200 }; },
    pool: { query: async (sql) => { if (/delivered_at = UTC_TIMESTAMP/.test(sql)) pending = null; } },
  };
  assert.equal((await dispatchTelegramOutbox(options)).status, "delivered");
  assert.equal((await dispatchTelegramOutbox(options)).status, "idle");
  assert.equal(sends, 1);
  let claimsAfterStop = 0;
  const dispatcher = createTelegramOutboxDispatcher({ ...options, claimNext: async () => { claimsAfterStop += 1; return null; } });
  dispatcher.stop();
  await dispatcher.tick();
  assert.equal(claimsAfterStop, 0);
});

test("Telegram dispatcher wakes promptly after a committed API mutation", async () => {
  const environment = { TELEGRAM_ALERTS_ENABLED: "1", TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" };
  let claims = 0;
  const dispatcher = createTelegramOutboxDispatcher({
    environment,
    intervalMs: 60_000,
    claimNext: async () => { claims += 1; return null; },
  });
  dispatcher.wake();
  await new Promise((resolve) => setTimeout(resolve, 15));
  dispatcher.stop();
  assert.equal(claims, 1);
});

test("издательские социальные разрешения проверяются общим предикатом", () => {
  assert.equal(canCreateFriendRequest("Читатель", "Блогер"), true);
  assert.equal(canCreateFriendRequest("Издатель", "Читатель"), false);
  assert.equal(canCreateFriendRequest("Читатель", "Издатель"), false);
  assert.equal(canCreateFriendRequest("Издатель", "Сообщество", { communityMembership: true }), true);
  assert.equal(canMessagePair({ firstProfileType: "Читатель", secondProfileType: "Блогер" }), false);
  assert.equal(canMessagePair({ firstProfileType: "Читатель", secondProfileType: "Издатель" }), true);
  assert.equal(canMessagePair({ firstProfileType: "Читатель", secondProfileType: "Блогер", friends: true }), true);
});

test("сервер удаляет опасный HTML, обработчики событий и запрещенные стили", () => {
  const cleaned = validateRichHtml('<p onclick="steal()" style="text-align:center;color:red">Текст<script>alert(1)</script></p><img src=x onerror=steal()>');
  assert.equal(cleaned, '<p style="text-align:center">Текст</p>');
  assert.equal(plainTextFromHtml(cleaned), "Текст");
});

test("дата рождения, спойлеры и материалы 18+ защищены общими контрактами", async () => {
  assert.equal(ageFromBirthDate("2000-08-03", new Date("2026-08-02T12:00:00Z")), 25);
  assert.equal(ageFromBirthDate("2000-08-02", new Date("2026-08-02T12:00:00Z")), 26);
  assert.equal(ageFromBirthDate("2025-02-31"), null);
  assert.equal(validateRichHtml('<span class="spoiler" onclick="steal()">секрет</span>'), '<span class="spoiler">секрет</span>');
  const migration = await readFile(path.join(root, "mysql", "migrations", "019_profile_age_material_controls.sql"), "utf8");
  const visibilityMigration = await readFile(path.join(root, "mysql", "migrations", "033_profile_birth_date_visibility.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  assert.match(migration, /birth_date DATE/);
  assert.match(migration, /profile_tab_order LONGTEXT/);
  assert.match(migration, /last_read_chapter INT/);
  assert.match(migration, /ADD COLUMN is_adult/);
  assert.match(api, /assertAdultMaterialAllowed/);
  assert.match(data, /hideAdultMaterials/);
  assert.match(visibilityMigration, /birth_date_visibility ENUM\('nobody', 'friends', 'everyone'\)/);
  assert.match(data, /birth_date_visibility === "friends" && isViewerFriend/);
  assertLocalized(profile, "profile.birthVisibility");
  assert.doesNotMatch(profile, /t\("settings\.changeOrder"\)/);
  assertLocalized(content, "editor.spoiler");
  assertLocalized(content, "library.chaptersRead");
});

test("участие в сообществе не является дружбой, а реакции читают только доступные материалы", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "024_community_memberships.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const controller = await readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8");
  const bootstrapRouter = await readFile(path.join(root, "server", "modules", "bootstrap-router.js"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS community_memberships/);
  assert.match(migration, /profile_type <> 'Сообщество'/);
  assert.match(migration, /DELETE f FROM friendships/);
  assert.match(data, /communityMemberships: communityMembershipRows/);
  assert.match(api, /INSERT IGNORE INTO community_memberships/);
  assert.match(api, /changesCommunitySemantics/);
  assert.match(api, /Перед сменой типа профиля завершите дружбу/);
  assert.match(api, /DELETE FROM community_memberships WHERE \(community_user_id = \? AND member_user_id = \?\)/);
  assert.match(api, /ORDER BY u\.id FOR UPDATE/);
  assert.match(api, /async function lockInteractionPair/);
  assert.match(api, /await lockInteractionPair\(connection, blockerId, blockedId\)/);
  assert.match(api, /const membership = currentProfile\?\.profile_type === "Сообщество";\s+await assertUsersCanInteract/);
  assert.match(api, /router\.get\("\/material-stats"[\s\S]*const pool = getPool\(\)/);
  assert.match(api, /readableMaterialInfo/);
  assert.match(api, /interactableMaterialInfo/);
  assert.match(api, /p\.publisher_status = 'approved'/);
  assert.match(controller, /isCommunityMemberPair/);
  assert.match(controller, /community-member/);
  assert.match(bootstrapRouter, /communityMemberships/);
});

test("material stats reuses a request-local readability cache across all material loops", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const routeStart = api.indexOf('router.get("/material-stats"');
  const routeEnd = api.indexOf('router.post("/comments"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "material-stats route boundaries must remain discoverable");
  const route = api.slice(routeStart, routeEnd);
  assert.match(route, /const readableMaterialCache = new Map\(\);/);
  assert.match(route, /const key = `\$\{kind\}-\$\{materialId\}`;/);
  assert.match(route, /readableMaterialCache\.set\(key, readableMaterialInfo\(pool, request\.bookMeetUser\.id, kind, materialId\)\.catch\(\(\) => null\)\)/);
  assert.equal((route.match(/readableMaterialInfo\(/g) ?? []).length, 1, "the route loop bodies must call the shared helper");
  assert.equal((route.match(/await getReadableMaterial\(/g) ?? []).length, 3, "comment, viewer-save and global-save loops must share the helper");
});

test("тип загруженного изображения определяется по содержимому, а не по расширению", () => {
  assert.deepEqual(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { mime: "image/png", extension: "png" });
  assert.deepEqual(imageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), { mime: "image/jpeg", extension: "jpg" });
  assert.equal(imageType(Buffer.from("<script>alert(1)</script>")), null);
});

test("изменяющие API-запросы имеют отдельные лимиты", () => {
  assert.equal(requestLimitPolicy("GET", "/bootstrap"), null);
  assert.deepEqual(requestLimitPolicy("POST", "/auth/register"), { name: "auth", limit: 20, windowMs: 900_000 });
  assert.deepEqual(requestLimitPolicy("POST", "/social/messages"), { name: "messages", limit: 60, windowMs: 60_000 });
});

test("bootstrap разделен на независимые серверные и клиентские секции", async () => {
  const router = await readFile(path.join(root, "server", "modules", "bootstrap-router.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const client = await readFile(path.join(root, "app", "services", "bootstrap.ts"), "utf8");
  for (const section of ["session", "catalog", "social", "moderation"]) {
    assert.match(router, new RegExp(`${section}:`));
    assert.match(client, new RegExp(`"${section}"`));
  }
  assert.match(data, /options\.sections/);
  assert.match(data, /includeCatalog/);
  assert.match(data, /includeSocial/);
  assert.match(data, /includeModeration/);
});

test("маршрутизируемые поп-апы используют единый стек истории", async () => {
  const routes = await readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8");
  assert.match(routes, /APP_NAVIGATION_EVENT/);
  assert.match(routes, /openOverlayRoute/);
  assert.match(routes, /closeOverlayRoute/);
  assert.match(routes, /return \{ active, close:/);
  assert.match(routes, /notifications/);
  assert.match(routes, /reportTargetFromPathname/);
});

test("локальные правки этапа 1 закреплены контрактами интерфейса и данных", async () => {
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const users = await readFile(path.join(root, "app", "screens", "UsersDirectoryScreen.tsx"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const cityFixes = await readFile(path.join(root, "mysql", "migrations", "018_city_catalog_corrections.sql"), "utf8");
  assertLocalized(content, "content.reviews");
  assert.match(content, /material-review-meta/);
  assert.match(content, /\{item\.rating \?\? 0\} ★/);
  assertLocalized(content, "event.setReminder");
  assert.match(content, /event-attendees/);
  assertLocalized(users, "directory.who");
  assert.match(users, /material-clickable-card/);
  assert.match(data, /reminder_user_ids/);
  assert.match(cityFixes, /Тюмень/);
  assert.match(cityFixes, /Москва/);
});

test("этапы 5 и 6 закрепляют доступ 18+, поводы и публичное участие", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "020_occasion_meeting_schedule.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const materialInput = await readFile(path.join(root, "server", "modules", "material-input.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const controller = await readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  assert.match(migration, /meeting_date DATE NULL/);
  assert.match(migration, /meeting_start_time TIME NULL/);
  assert.match(materialInput, /Выберите будущую дату встречи/);
  assert.match(materialInput, /Время завершения можно указать только после времени начала/);
  assert.match(data, /adultAccess: \{ status: adultStatus, restricted: restrictedAdultMaterials \}/);
  assert.match(data, /WHERE is_adult = 1 AND status = 'published'/);
  assertLocalized(controller, "content.adultMaterial");
  assertLocalized(controller, "event.goProfile");
  assert.match(content, /occasion-type-switch/);
  assertLocalized(content, "occasion.nextDay");
  assertLocalized(content, "event.showAll");
  assert.match(content, /events\/\$\{item\.id\}\/attendees\?page=/);
  assert.match(api, /router\.get\("\/events\/:id\/attendees"/);
  assert.match(content, /libraryStatus === "reading"/);
  assertLocalized(content, "book.readingNow");
});

test("этап 9 разделяет крупные обязанности и удаляет одноразовые deploy-скрипты", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const materialInput = await readFile(path.join(root, "server", "modules", "material-input.js"), "utf8");
  const locationRouter = await readFile(path.join(root, "server", "modules", "location-router.js"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.match(api, /createLocationRouter/);
  assert.match(api, /from "\.\/modules\/material-input\.js"/);
  assert.match(materialInput, /export function occasionPayload/);
  assert.match(locationRouter, /router\.get\("\/cities"/);
  assert.match(profile, /components\/admin\/AdminStatisticsPanel/);
  assert.match(content, /\.\/text\/SpoilerText/);
  assert.equal(packageJson.scripts["deploy:publisher"], undefined);
  assert.equal(packageJson.scripts["deploy:social-events"], undefined);
  assert.equal(packageJson.scripts["deploy:safety"], undefined);
});

test("внешние изображения и книжные страницы проверяют каждый редирект", async () => {
  const images = await readFile(path.join(root, "server", "modules", "image-storage.js"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  assert.match(images, /redirect: "manual"/);
  assert.match(images, /Перенаправление изображения ведет на запрещенный адрес/);
  assert.match(api, /redirect: "manual"/);
  assert.match(api, /Книжный источник перенаправил запрос на другой сайт/);
});

test("этапы 7 и 8 закрепляют удаление профиля, восстановление и очистку личных данных", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "021_deleted_profiles.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const bootstrap = await readFile(path.join(root, "server", "modules", "bootstrap-router.js"), "utf8");
  const controller = await readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  assert.match(migration, /deletion_expires_at DATETIME/);
  assert.match(migration, /purged_at DATETIME/);
  assert.doesNotMatch(api, /DELETE FROM messages WHERE sender_user_id = \? OR recipient_user_id = \?/);
  assert.match(api, /INTERVAL 15 DAY/);
  assert.match(api, /UPDATE reports SET reporter_user_id = NULL, reporter_anonymized = 1/);
  assert.match(api, /INSERT INTO finalized_profile_deletions/);
  assert.match(api, /purgeExpiredDeletedProfiles/);
  assert.match(api, /router\.post\("\/auth\/deleted-profile\/restore"/);
  assert.match(api, /router\.post\("\/auth\/deleted-profile\/new"/);
  assert.match(api, /router\.delete\("\/admin\/users\/:id\/permanent"/);
  assert.match(bootstrap, /deletedProfile/);
  assertLocalized(controller, "profile.createNew");
  assertLocalized(profile, "settings.deleteConfirm");
});

test("исправления карточки книги, страны, городов и интерфейса защищены контрактами", async () => {
  const cities = await readFile(path.join(root, "mysql", "migrations", "022_kazakhstan_city_aliases.sql"), "utf8");
  const controller = await readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const home = await readFile(path.join(root, "app", "screens", "ContentScreens.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(cities, /Актобе/);
  assert.match(cities, /Ақтөбе/);
  assert.match(cities, /Жезказган/);
  assert.match(cities, /Жезқазған/);
  assert.match(cities, /language_code/);
  assert.match(controller, /retainWhenInactive/);
  assert.match(controller, /quickMaterialAction === "review"/);
  assert.match(controller, /quickMaterialAction === "excerpt"/);
  assert.match(content, /className="book-reader-row"[^>]+onClick/);
  assert.match(content, /reader\.avatarUrl \? "has-photo"/);
  assert.match(content, /wishlist-card material-clickable-card/);
  assert.match(content, /export function PublicationEditor/);
  assert.match(home, /item\.country\?\.toLocaleLowerCase/);
  assert.match(styles, /admin-report-buttons button:last-child/);
  assert.match(styles, /occasion-form \.adult-material-checkbox input/);
  assert.match(styles, /comment-format-toolbar button/);
  assert.match(styles, /element\.animate|will-change: transform/);
});
