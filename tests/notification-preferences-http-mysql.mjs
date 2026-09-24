import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

test("TZ5 notification preferences: MySQL persistence, readiness, constraints and range read-all", async (t) => {
  process.env.USER_TELEGRAM_NOTIFICATIONS_READY = "0";
  process.env.USER_EMAIL_NOTIFICATIONS_READY = "0";
  const fixture = await queue3HttpFixture("q5-notification-prefs");
  const { db, user, call } = fixture;
  try {
    const reader = await user("reader");
    const actor = await user("actor");
    await db.query("UPDATE users SET email = ?, email_verified_at = UTC_TIMESTAMP(), telegram_user_id = 123456, telegram_connected_at = UTC_TIMESTAMP() WHERE id = ?", ["verified-notifications@example.test", reader.id]);

    await t.test("verified Telegram IDs are nullable and unique", async () => {
      const [indexes] = await db.query("SHOW INDEX FROM users WHERE Key_name = 'users_telegram_user_id_unique'");
      assert.equal(indexes.length, 1);
      assert.equal(Number(indexes[0].Non_unique), 0);
      await assert.rejects(
        db.query("UPDATE users SET telegram_user_id = ? WHERE id = ?", [123456, actor.id]),
        /duplicate/i,
      );
      await db.query("UPDATE users SET telegram_user_id = NULL WHERE id = ?", [actor.id]);
    });

    await t.test("lazy defaults, partial persistence, timezone validation and mandatory system", async () => {
      const defaults = await call(reader, "GET", "/users/me/notification-preferences", undefined, 200, { "X-BookMeet-Timezone": "Asia/Qyzylorda" });
      assert.equal(defaults.effectiveTimezone, "Asia/Qyzylorda");
      assert.equal(defaults.categories.likes.inAppEnabled, true);
      const [[count]] = await db.query("SELECT COUNT(*) AS count FROM notification_preferences WHERE user_id = ?", [reader.id]);
      assert.equal(Number(count.count), 0);

      const saved = await call(reader, "PUT", "/users/me/notification-preferences", { timezone: "UTC", categories: { likes: { inAppEnabled: false } } });
      assert.equal(saved.timezone, "UTC");
      assert.equal(saved.categories.likes.inAppEnabled, false);
      assert.equal(saved.categories.comments_replies.inAppEnabled, true);
      assert.equal((await call(reader, "GET", "/users/me/notification-preferences")).categories.likes.inAppEnabled, false);

      let error = await call(reader, "PUT", "/users/me/notification-preferences", { categories: { system_security: { inAppEnabled: false } } }, 409);
      assert.equal(error.code, "SYSTEM_NOTIFICATION_REQUIRED");
      error = await call(reader, "PUT", "/users/me/notification-preferences", { timezone: "Not/AZone" }, 400);
      assert.equal(error.code, "INVALID_NOTIFICATION_PREFERENCES");
      await assert.rejects(db.query("INSERT INTO notification_preferences (user_id, category, in_app_enabled) VALUES (?, 'system_security', 0)", [reader.id]), /constraint|check/i);
    });

    await t.test("external channels require both explicit readiness and verified account state", async () => {
      let error = await call(reader, "PUT", "/users/me/notification-preferences", { categories: { likes: { telegramEnabled: true } } }, 409);
      assert.equal(error.code, "TELEGRAM_NOTIFICATIONS_UNAVAILABLE");
      error = await call(reader, "PUT", "/users/me/notification-preferences", { categories: { likes: { emailMode: "daily" } } }, 409);
      assert.equal(error.code, "EMAIL_NOTIFICATIONS_UNAVAILABLE");
      process.env.USER_TELEGRAM_NOTIFICATIONS_READY = "1";
      process.env.USER_EMAIL_NOTIFICATIONS_READY = "1";
      const enabled = await call(reader, "PUT", "/users/me/notification-preferences", { categories: { likes: { telegramEnabled: true, emailMode: "daily" } } });
      assert.equal(enabled.categories.likes.telegramEnabled, true);
      assert.equal(enabled.categories.likes.emailMode, "daily");
      await db.query("UPDATE users SET telegram_user_id = NULL, telegram_connected_at = NULL, telegram_subject = 'legacy-is-not-proof' WHERE id = ?", [reader.id]);
      error = await call(reader, "PUT", "/users/me/notification-preferences", { categories: { comments_replies: { telegramEnabled: true } } }, 409);
      assert.equal(error.code, "TELEGRAM_NOTIFICATIONS_UNAVAILABLE");
      await db.query("UPDATE users SET email_verified_at = NULL WHERE id = ?", [reader.id]);
      error = await call(reader, "PUT", "/users/me/notification-preferences", { categories: { comments_replies: { emailMode: "immediate" } } }, 409);
      assert.equal(error.code, "EMAIL_NOTIFICATIONS_UNAVAILABLE");
    });

    await t.test("legacy Telegram compatibility requires verified identity and disconnect clears delivery state", async () => {
      let error = await call(reader, "PATCH", "/users/me/telegram-notifications", { enabled: true, categories: ["social"] }, 409);
      assert.equal(error.code, "TELEGRAM_NOTIFICATIONS_UNAVAILABLE");
      let legacy = await call(reader, "GET", "/users/me/telegram-notifications");
      assert.equal(legacy.connected, false);
      assert.equal(legacy.available, false);
      assert.equal(legacy.enabled, false);

      await db.query("UPDATE users SET telegram_user_id = 654321, telegram_connected_at = UTC_TIMESTAMP() WHERE id = ?", [reader.id]);
      legacy = await call(reader, "PATCH", "/users/me/telegram-notifications", { enabled: true, categories: ["social", "events"] });
      assert.equal(legacy.connected, true);
      assert.equal(legacy.available, true);
      assert.equal(legacy.enabled, true);
      assert.deepEqual(legacy.categories, ["events", "social"]);

      const normalized = await call(reader, "GET", "/users/me/notification-preferences");
      assert.equal(normalized.categories.likes.telegramEnabled, true);
      assert.equal(normalized.categories.events_communities.telegramEnabled, true);

      await call(reader, "DELETE", "/users/me/telegram");
      const [[account]] = await db.query(
        `SELECT telegram_subject, telegram_user_id, telegram_connected_at, telegram_notifications_enabled
         FROM users
         WHERE id = ?`,
        [reader.id],
      );
      assert.equal(account.telegram_subject, "legacy-is-not-proof");
      assert.equal(account.telegram_user_id, null);
      assert.equal(account.telegram_connected_at, null);
      assert.equal(Number(account.telegram_notifications_enabled), 0);
      const [[deliveryRows]] = await db.query(
        "SELECT COUNT(*) AS count FROM notification_preferences WHERE user_id = ? AND telegram_enabled = 1",
        [reader.id],
      );
      assert.equal(Number(deliveryRows.count), 0);
    });

    await t.test("Telegram deep-link binding is hashed, expiring and one-time", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-only-bot-token";
      process.env.TELEGRAM_BOT_USERNAME = "BookMeetTestBot";
      process.env.TELEGRAM_WEBHOOK_SECRET = "test-only-webhook-secret";
      process.env.USER_TELEGRAM_NOTIFICATIONS_READY = "1";

      const expiredLink = await call(reader, "POST", "/users/me/telegram-link", undefined, 201);
      const expiredToken = new URL(expiredLink.deepLink).searchParams.get("start");
      const [[stored]] = await db.query("SELECT token_hash FROM telegram_link_tokens WHERE user_id = ?", [reader.id]);
      assert.notEqual(stored.token_hash, expiredToken);
      assert.equal(stored.token_hash.length, 64);
      await db.query("UPDATE telegram_link_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE user_id = ?", [reader.id]);
      const expired = await call(null, "POST", "/integrations/telegram/webhook", { message: { text: `/start ${expiredToken}`, from: { id: 777001, username: "expired_reader" } } }, 200, { "X-Telegram-Bot-Api-Secret-Token": "test-only-webhook-secret" });
      assert.equal(expired.linked, false);

      const link = await call(reader, "POST", "/users/me/telegram-link", undefined, 201);
      const token = new URL(link.deepLink).searchParams.get("start");
      await call(null, "POST", "/integrations/telegram/webhook", { message: { text: `/start ${token}`, from: { id: 777001, username: "mysql_reader" } } }, 403, { "X-Telegram-Bot-Api-Secret-Token": "wrong" });
      const linked = await call(null, "POST", "/integrations/telegram/webhook", { message: { text: `/start ${token}`, from: { id: 777001, username: "mysql_reader" } } }, 200, { "X-Telegram-Bot-Api-Secret-Token": "test-only-webhook-secret" });
      assert.equal(linked.linked, true);
      const replay = await call(null, "POST", "/integrations/telegram/webhook", { message: { text: `/start ${token}`, from: { id: 777001, username: "mysql_reader" } } }, 200, { "X-Telegram-Bot-Api-Secret-Token": "test-only-webhook-secret" });
      assert.equal(replay.linked, false);
      const preferences = await call(reader, "GET", "/users/me/notification-preferences");
      assert.equal(preferences.readiness.telegram.displayName, "@mysql_reader");
      const [[account]] = await db.query("SELECT telegram_user_id, telegram_display_name FROM users WHERE id = ?", [reader.id]);
      assert.equal(Number(account.telegram_user_id), 777001);
      assert.equal(account.telegram_display_name, "@mysql_reader");
      await call(reader, "DELETE", "/users/me/telegram");
    });

    await t.test("range read-all is atomic, confirmation-aware and fail-safe for unknown types", async () => {
      const values = [];
      for (let index = 0; index < 22; index += 1) values.push([reader.id, actor.id, "like", `Like ${index}`, "body", 1]);
      values.push([reader.id, actor.id, "mention", "Mention", "body", 1]);
      values.push([reader.id, actor.id, "future_security_event", "Future", "body", 1]);
      await db.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, is_unread) VALUES ?", [values]);

      const pending = await call(reader, "PATCH", "/notifications/read-all", { category: "likes", confirmed: false }, 409);
      assert.equal(pending.code, "NOTIFICATION_READ_CONFIRMATION_REQUIRED");
      assert.equal(pending.affectedCount, 22);
      const [[unchanged]] = await db.query("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND notification_type = 'like' AND is_unread = 1", [reader.id]);
      assert.equal(Number(unchanged.count), 22);

      const changed = await call(reader, "PATCH", "/notifications/read-all", { category: "likes", confirmed: true });
      assert.equal(changed.affectedCount, 22);
      assert.equal(changed.changedIds.length, 22);
      const system = await call(reader, "PATCH", "/notifications/read-all", { category: "system_security", confirmed: false });
      assert.equal(system.affectedCount, 1);
      const [[remaining]] = await db.query("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_unread = 1", [reader.id]);
      assert.equal(Number(remaining.count), 1);
    });

    await t.test("preferences cascade with the owning user", async () => {
      const doomed = await user("doomed");
      await call(doomed, "PUT", "/users/me/notification-preferences", { categories: { mentions: { inAppEnabled: false } } });
      await db.query("DELETE FROM users WHERE id = ?", [doomed.id]);
      const [[remaining]] = await db.query("SELECT COUNT(*) AS count FROM notification_preferences WHERE user_id = ?", [doomed.id]);
      assert.equal(Number(remaining.count), 0);
    });
  } finally {
    process.env.TELEGRAM_BOT_TOKEN = "";
    delete process.env.TELEGRAM_BOT_USERNAME;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.USER_TELEGRAM_NOTIFICATIONS_READY = "0";
    process.env.USER_EMAIL_NOTIFICATIONS_READY = "0";
    await fixture.close();
  }
});
