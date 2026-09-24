import assert from "node:assert/strict";
import test from "node:test";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_READ_CONFIRMATION_THRESHOLD,
  notificationCategoryFor,
  notificationChannelReadiness,
  notificationPreferencesState,
  validateNotificationPreferencesPayload,
  canonicalCategoriesForLegacyTelegram,
  legacyTelegramCategoriesForPreferences,
} from "../server/modules/notification-preferences.js";
import { notificationCategoryFor as clientNotificationCategoryFor, notificationCategoryKeys } from "../app/lib/notification-categories.js";

test("canonical notification categories and server mapping are stable", () => {
  assert.deepEqual(NOTIFICATION_CATEGORIES, ["friendships_follows", "likes", "comments_replies", "mentions", "reposts", "events_communities", "reading_reminders", "system_security"]);
  assert.equal(NOTIFICATION_READ_CONFIRMATION_THRESHOLD, 20);
  assert.equal(notificationCategoryFor("mention"), "mentions");
  assert.equal(notificationCategoryFor("repost"), "reposts");
  assert.equal(notificationCategoryFor("postponed_book"), "reading_reminders");
  assert.equal(notificationCategoryFor("future_unknown"), "system_security");
  assert.deepEqual(notificationCategoryKeys, NOTIFICATION_CATEGORIES);
  for (const type of ["friend_request", "like", "comment", "mention", "repost", "publication", "postponed_book", "security", "future_unknown"]) {
    assert.equal(clientNotificationCategoryFor(type), notificationCategoryFor(type));
  }
});

test("notification defaults are lazy and system in-app is mandatory", () => {
  const state = notificationPreferencesState({ rows: [], account: {}, requestTimezone: "Asia/Almaty", environment: {} });
  assert.equal(Object.keys(state.categories).length, 8);
  for (const preference of Object.values(state.categories)) assert.deepEqual({ inAppEnabled: preference.inAppEnabled, telegramEnabled: preference.telegramEnabled, emailMode: preference.emailMode }, { inAppEnabled: true, telegramEnabled: false, emailMode: "off" });
  assert.equal(state.categories.system_security.mandatoryInApp, true);
  assert.equal(state.effectiveTimezone, "Asia/Almaty");
  assert.throws(() => validateNotificationPreferencesPayload({ categories: { system_security: { inAppEnabled: false } } }), (error) => error.code === "SYSTEM_NOTIFICATION_REQUIRED" && error.statusCode === 409);
});

test("preference validation accepts partial settings and IANA timezone only", () => {
  assert.deepEqual(validateNotificationPreferencesPayload({ timezone: "Asia/Qyzylorda", categories: { likes: { inAppEnabled: false, emailMode: "daily" } } }), { timezone: "Asia/Qyzylorda", categories: { likes: { inAppEnabled: false, emailMode: "daily" } } });
  assert.deepEqual(validateNotificationPreferencesPayload({ timezone: null }), { timezone: null });
  assert.throws(() => validateNotificationPreferencesPayload({ timezone: "Mars/Olympus" }), /IANA/);
  assert.throws(() => validateNotificationPreferencesPayload({ categories: { other: { inAppEnabled: true } } }), /категор/i);
  assert.throws(() => validateNotificationPreferencesPayload({ categories: { likes: { emailMode: "weekly" } } }), /email/i);
});

test("external readiness needs explicit service switch and verified account state", () => {
  const account = { email: "reader@example.test", email_verified_at: new Date(), telegram_user_id: 42, telegram_connected_at: new Date(), telegram_subject: "legacy-only" };
  assert.deepEqual(notificationChannelReadiness(account, {}), {
    telegram: { available: false, serviceReady: false, connected: true, displayName: "Telegram", reason: "service_unavailable" },
    email: { available: false, serviceReady: false, verified: true, reason: "service_unavailable" },
  });
  const ready = notificationChannelReadiness(account, { USER_TELEGRAM_NOTIFICATIONS_READY: "1", USER_EMAIL_NOTIFICATIONS_READY: "1" });
  assert.equal(ready.telegram.available, true);
  assert.equal(ready.email.available, true);
  const blocked = notificationChannelReadiness({ ...account, telegram_delivery_error_at: new Date() }, { USER_TELEGRAM_NOTIFICATIONS_READY: "1" });
  assert.equal(blocked.telegram.available, false);
  assert.equal(blocked.telegram.connected, true);
  assert.equal(blocked.telegram.reason, "delivery_error");
  assert.equal(notificationChannelReadiness({ telegram_subject: "legacy-only" }, { USER_TELEGRAM_NOTIFICATIONS_READY: "1" }).telegram.available, false);
});

test("legacy Telegram categories adapt to the normalized source of truth", () => {
  assert.deepEqual(canonicalCategoriesForLegacyTelegram(["social", "events"]), ["friendships_follows", "likes", "comments_replies", "mentions", "reposts", "events_communities"]);
  assert.deepEqual(legacyTelegramCategoriesForPreferences(["likes", "events_communities"]), ["events", "social"]);
  assert.deepEqual(canonicalCategoriesForLegacyTelegram(["messages"]), []);
});
