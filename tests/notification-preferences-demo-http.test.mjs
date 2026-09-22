import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createEmailUnsubscribeToken } from "../server/modules/notification-channels.js";

test("demo notification preferences and range read-all match the production contract", async () => {
  process.env.DEMO_MODE = "1";
  delete process.env.USER_TELEGRAM_NOTIFICATIONS_READY;
  delete process.env.USER_EMAIL_NOTIFICATIONS_READY;
  const { default: router } = await import("../server/demo-api.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (cookie, method, route, body, expected = 200, headers = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { Cookie: cookie ?? "", "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  };
  try {
    await call(null, "POST", "/__test__/reset");
    await call(null, "POST", "/__test__/notifications-scenario", undefined, 201);
    const login = await fetch(`${base}/auth/demo-login?user=3`, { redirect: "manual" });
    const cookie = login.headers.get("set-cookie").split(";")[0];

    const defaults = await call(cookie, "GET", "/users/me/notification-preferences", undefined, 200, { "X-BookMeet-Timezone": "Asia/Qyzylorda" });
    assert.equal(defaults.effectiveTimezone, "Asia/Qyzylorda");
    assert.equal(defaults.categories.likes.inAppEnabled, true);
    assert.equal(defaults.categories.system_security.mandatoryInApp, true);
    assert.equal(defaults.readiness.telegram.available, false);

    let error = await call(cookie, "PUT", "/users/me/notification-preferences", { categories: { system_security: { inAppEnabled: false } } }, 409);
    assert.equal(error.code, "SYSTEM_NOTIFICATION_REQUIRED");
    error = await call(cookie, "PUT", "/users/me/notification-preferences", { categories: { likes: { telegramEnabled: true } } }, 409);
    assert.equal(error.code, "TELEGRAM_NOTIFICATIONS_UNAVAILABLE");
    error = await call(cookie, "PUT", "/users/me/notification-preferences", { categories: { likes: { emailMode: "daily" } } }, 409);
    assert.equal(error.code, "EMAIL_NOTIFICATIONS_UNAVAILABLE");
    error = await call(cookie, "PUT", "/users/me/notification-preferences", { timezone: "Mars/Olympus" }, 400);
    assert.equal(error.code, "INVALID_NOTIFICATION_PREFERENCES");

    const saved = await call(cookie, "PUT", "/users/me/notification-preferences", { timezone: "UTC", categories: { likes: { inAppEnabled: false } } });
    assert.equal(saved.timezone, "UTC");
    assert.equal(saved.categories.likes.inAppEnabled, false);
    assert.equal((await call(cookie, "GET", "/users/me/notification-preferences")).categories.likes.inAppEnabled, false);

    const before = await call(cookie, "GET", "/bootstrap");
    assert.equal(before.notifications.filter((item) => item.unread && item.type === "like").length, 22);
    const confirmation = await call(cookie, "PATCH", "/notifications/read-all", { category: "likes", confirmed: false }, 409);
    assert.equal(confirmation.code, "NOTIFICATION_READ_CONFIRMATION_REQUIRED");
    assert.equal(confirmation.affectedCount, 22);
    assert.equal((await call(cookie, "GET", "/bootstrap")).notifications.filter((item) => item.unread && item.type === "like").length, 22);

    const changed = await call(cookie, "PATCH", "/notifications/read-all", { category: "likes", confirmed: true });
    assert.equal(changed.affectedCount, 22);
    assert.equal(changed.changedIds.length, 22);
    const afterLikes = await call(cookie, "GET", "/bootstrap");
    assert.equal(afterLikes.notifications.filter((item) => item.unread && item.type === "like").length, 0);
    assert.equal(afterLikes.notifications.filter((item) => item.unread).length, 2);

    const system = await call(cookie, "PATCH", "/notifications/read-all", { category: "system_security", confirmed: false });
    assert.equal(system.affectedCount, 1);
    assert.equal((await call(cookie, "GET", "/bootstrap")).notifications.filter((item) => item.unread).length, 1);

    process.env.USER_TELEGRAM_NOTIFICATIONS_READY = "1";
    await call(null, "POST", "/__test__/telegram-legacy-scenario", { verified: false }, 201);
    error = await call(cookie, "PATCH", "/users/me/telegram-notifications", { enabled: true, categories: ["social"] }, 409);
    assert.equal(error.code, "TELEGRAM_NOTIFICATIONS_UNAVAILABLE");
    const legacySubjectOnly = await call(cookie, "GET", "/users/me/telegram-notifications");
    assert.equal(legacySubjectOnly.connected, false);
    assert.equal(legacySubjectOnly.available, false);
    assert.equal(legacySubjectOnly.enabled, false);

    await call(null, "POST", "/__test__/telegram-legacy-scenario", { verified: true }, 201);
    const compatible = await call(cookie, "PATCH", "/users/me/telegram-notifications", { enabled: true, categories: ["social", "events"] });
    assert.equal(compatible.connected, true);
    assert.equal(compatible.available, true);
    assert.equal(compatible.enabled, true);
    assert.deepEqual(compatible.categories, ["events", "social"]);
    const normalized = await call(cookie, "GET", "/users/me/notification-preferences");
    assert.equal(normalized.categories.likes.telegramEnabled, true);
    assert.equal(normalized.categories.events_communities.telegramEnabled, true);
    assert.equal(normalized.categories.system_security.telegramEnabled, false);

    await call(cookie, "DELETE", "/users/me/telegram");
    const disconnected = await call(cookie, "GET", "/users/me/telegram-notifications");
    assert.equal(disconnected.connected, false);
    assert.equal(disconnected.enabled, false);
    const cleared = await call(cookie, "GET", "/users/me/notification-preferences");
    assert.equal(Object.values(cleared.categories).some((item) => item.telegramEnabled), false);

    process.env.TELEGRAM_WEBHOOK_SECRET = "demo-webhook-secret";
    const link = await call(cookie, "POST", "/users/me/telegram-link", undefined, 201);
    const token = new URL(link.deepLink).searchParams.get("start");
    assert.ok(token);
    const linked = await call(null, "POST", "/integrations/telegram/webhook", { message: { text: `/start ${token}`, from: { id: 8181, username: "reader_three" } } }, 200, { "X-Telegram-Bot-Api-Secret-Token": "demo-webhook-secret" });
    assert.equal(linked.linked, true);
    const replay = await call(null, "POST", "/integrations/telegram/webhook", { message: { text: `/start ${token}`, from: { id: 8181, username: "reader_three" } } }, 200, { "X-Telegram-Bot-Api-Secret-Token": "demo-webhook-secret" });
    assert.equal(replay.linked, false);
    const linkedPreferences = await call(cookie, "GET", "/users/me/notification-preferences");
    assert.equal(linkedPreferences.readiness.telegram.displayName, "@reader_three");
    assert.equal((await call(cookie, "POST", "/users/me/telegram/test")).delivered, true);
    await call(cookie, "DELETE", "/users/me/telegram");

    process.env.USER_EMAIL_NOTIFICATIONS_READY = "1";
    process.env.NOTIFICATION_UNSUBSCRIBE_SECRET = "demo-unsubscribe-secret";
    await call(null, "POST", "/__test__/notification-event-scenario", { inspectOnly: true }, 201);
    await call(cookie, "PUT", "/users/me/notification-preferences", { categories: { likes: { emailMode: "daily" } } });
    const unsubscribeToken = createEmailUnsubscribeToken(3, { environment: process.env });
    assert.equal((await call(null, "POST", "/notifications/email/unsubscribe", { token: unsubscribeToken })).unsubscribed, true);
    assert.equal((await call(cookie, "GET", "/users/me/notification-preferences")).categories.likes.emailMode, "off");
    await call(cookie, "PUT", "/users/me/notification-preferences", { categories: { likes: { emailMode: "daily" } } });
    const scenario = await call(null, "POST", "/__test__/notification-event-scenario", {}, 201);
    assert.equal(scenario.events.filter((item) => item.dedupeKey === "demo-like:51:2").length, 1);
    assert.equal(scenario.notifications.filter((item) => item.eventId === scenario.events.at(-1).id).length, 1);
    assert.deepEqual(scenario.deliveries.filter((item) => item.eventId === scenario.events.at(-1).id).map((item) => [item.channel, item.mode]), [["in_app", "immediate"], ["telegram", "immediate"], ["email", "daily"]]);
    assert.equal(scenario.deliveries.some((item) => Object.hasOwn(item, "text")), false);
    await call(cookie, "PUT", "/users/me/notification-preferences", { categories: { likes: { telegramEnabled: false, emailMode: "off" } } });
    const cancelled = await call(null, "POST", "/__test__/notification-event-scenario", { inspectOnly: true }, 201);
    assert.equal(cancelled.deliveries.filter((item) => ["telegram", "email"].includes(item.channel)).every((item) => item.status === "cancelled"), true);
    delete process.env.USER_TELEGRAM_NOTIFICATIONS_READY;
    delete process.env.USER_EMAIL_NOTIFICATIONS_READY;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.NOTIFICATION_UNSUBSCRIBE_SECRET;
  } finally {
    delete process.env.USER_TELEGRAM_NOTIFICATIONS_READY;
    delete process.env.USER_EMAIL_NOTIFICATIONS_READY;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.NOTIFICATION_UNSUBSCRIBE_SECRET;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
