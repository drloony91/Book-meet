import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeTelegramLinkToken,
  configureTelegramWebhook,
  createEmailNotificationAdapter,
  createEmailUnsubscribeToken,
  createTelegramNotificationAdapter,
  hashTelegramLinkToken,
  replaceTelegramLinkToken,
  safeTelegramDisplayName,
  telegramDeepLink,
  telegramLinkConfiguration,
  telegramWebhookAuthorized,
  verifyEmailUnsubscribeToken,
  verifyTelegramBot,
} from "../server/modules/notification-channels.js";

test("Telegram link configuration, authorization and display names are safe", () => {
  const environment = { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_WEBHOOK_SECRET: "webhook-secret", TELEGRAM_BOT_USERNAME: "@BookMeetBot", USER_TELEGRAM_NOTIFICATIONS_READY: "1" };
  assert.deepEqual(telegramLinkConfiguration(environment), { configured: true, ready: true, botUsername: "BookMeetBot" });
  assert.equal(telegramWebhookAuthorized("webhook-secret", environment), true);
  assert.equal(telegramWebhookAuthorized("wrong", environment), false);
  assert.match(telegramDeepLink("safe_token_12345678901234567890", environment), /^https:\/\/t\.me\/BookMeetBot\?start=/);
  assert.equal(safeTelegramDisplayName({ username: "reader<script>" }), "@readerscript");
  assert.equal(safeTelegramDisplayName({ first_name: "Reader\n", last_name: "<One>" }), "Reader One");
});

test("Telegram link token is hashed at rest, one-time and expiry-aware", async () => {
  const calls = [];
  const token = "telegram_link_token_1234567890";
  const now = new Date("2026-09-18T10:00:00.000Z");
  const connection = { async query(sql, params) { calls.push([sql, params]); return sql.startsWith("DELETE") ? [{ affectedRows: 1 }] : [{ affectedRows: 1 }]; } };
  const created = await replaceTelegramLinkToken(connection, 7, { token, now });
  assert.equal(created.token, token);
  assert.equal(created.expiresAt.toISOString(), "2026-09-18T10:15:00.000Z");
  assert.equal(calls[1][1][1], hashTelegramLinkToken(token));
  assert.equal(calls[1][1].includes(token), false);

  let consumed = false;
  const consumeConnection = { async query(sql) {
    if (sql.startsWith("SELECT")) return consumed ? [[]] : [[{ user_id: 7 }]];
    if (sql.startsWith("UPDATE users")) return [{ affectedRows: 1 }];
    if (sql.startsWith("UPDATE telegram_link_tokens")) { consumed = true; return [{ affectedRows: 1 }]; }
    return [{ affectedRows: 1 }];
  } };
  assert.equal(await consumeTelegramLinkToken(consumeConnection, { token, telegramUserId: 991, displayName: "@reader", now }), 7);
  assert.equal(await consumeTelegramLinkToken(consumeConnection, { token, telegramUserId: 991, displayName: "@reader", now }), null);
});

test("email unsubscribe links reject tampering and expiry", () => {
  const environment = { NOTIFICATION_UNSUBSCRIBE_SECRET: "long-test-secret" };
  const now = new Date("2026-09-18T10:00:00.000Z");
  const token = createEmailUnsubscribeToken(42, { environment, now });
  assert.equal(verifyEmailUnsubscribeToken(token, { environment, now }).userId, 42);
  assert.equal(verifyEmailUnsubscribeToken(`${token}x`, { environment, now }), null);
  assert.equal(verifyEmailUnsubscribeToken(token, { environment, now: new Date("2026-10-19T10:00:00.000Z") }), null);
  assert.equal(createEmailUnsubscribeToken(42, { environment: { AUDIT_HASH_SECRET: "must-not-be-reused" }, now }), null);
});

test("external adapters receive only generic content and stable identifiers", async () => {
  let telegramRequest;
  const telegram = createTelegramNotificationAdapter({
    environment: { USER_TELEGRAM_NOTIFICATIONS_READY: "1", TELEGRAM_BOT_TOKEN: "test-token", APP_ORIGIN: "https://bookmeet.club" },
    fetchImpl: async (url, options) => { telegramRequest = { url, options }; return { ok: true }; },
  });
  await telegram({ recipient: { telegramUserId: 12, telegramConnected: true }, payload: { title: "Новое упоминание", summary: "Откройте Book Meet, чтобы посмотреть.", body: "PRIVATE" } });
  assert.equal(telegramRequest.url.includes("test-token"), true);
  assert.equal(telegramRequest.options.body.includes("PRIVATE"), false);

  let emailMessage;
  const email = createEmailNotificationAdapter({
    environment: { USER_EMAIL_NOTIFICATIONS_READY: "1", NOTIFICATION_UNSUBSCRIBE_SECRET: "long-test-secret", APP_ORIGIN: "https://bookmeet.club" },
    sendEmail: async (message) => { emailMessage = message; return { delivered: true }; },
  });
  await email({ recipient: { userId: 42, email: "reader@example.test", emailVerified: true }, payload: { title: "Новая реакция", summary: "Откройте Book Meet, чтобы посмотреть.", body: "PRIVATE" }, idempotencyKey: "event-42" });
  assert.equal(emailMessage.messageId, "event-42");
  assert.equal(emailMessage.text.includes("PRIVATE"), false);
  assert.match(emailMessage.text, /unsubscribe\?token=/);
});

test("a Telegram 403 becomes a terminal channel-blocked signal", async () => {
  const telegram = createTelegramNotificationAdapter({
    environment: { USER_TELEGRAM_NOTIFICATIONS_READY: "1", TELEGRAM_BOT_TOKEN: "test-token" },
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(
    telegram({ recipient: { telegramUserId: 12, telegramConnected: true }, payload: { title: "Book Meet", summary: "Откройте Book Meet." } }),
    (error) => error.code === "TELEGRAM_CHANNEL_BLOCKED",
  );
});

test("Telegram live verification reports booleans only", async () => {
  const responses = [{ ok: true, json: async () => ({ ok: true, result: { username: "BookMeetBot" } }) }, { ok: true, json: async () => ({ ok: true, result: { url: "https://bookmeet.club/api/integrations/telegram/webhook" } }) }];
  const result = await verifyTelegramBot({ TELEGRAM_BOT_TOKEN: "test-token" }, async () => responses.shift());
  assert.deepEqual(result, { configured: true, verified: true, webhookConfigured: true });
  assert.equal(JSON.stringify(result).includes("test-token"), false);
});

test("Telegram webhook configuration is HTTPS-only and returns safe status", async () => {
  const environment = { APP_ORIGIN: "https://bookmeet.club", TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "webhook-secret", TELEGRAM_BOT_USERNAME: "BookMeetBot" };
  let requestBody;
  const result = await configureTelegramWebhook(environment, async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, json: async () => ({ ok: true }) }; });
  assert.deepEqual(result, { configured: true, applied: true, verified: true });
  assert.equal(requestBody.url, "https://bookmeet.club/api/integrations/telegram/webhook");
  assert.equal(JSON.stringify(result).includes("test-token"), false);
  assert.deepEqual(await configureTelegramWebhook({ ...environment, APP_ORIGIN: "http://bookmeet.club" }, async () => { throw new Error("must not fetch"); }), { configured: true, applied: false, verified: false });
});
