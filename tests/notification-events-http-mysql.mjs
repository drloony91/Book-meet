import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";
import { createMysqlNotificationDeliveryStore, createNotificationDeliveryWorker, createNotificationEvent } from "../server/modules/notification-events.js";

test("TZ5 notification events: MySQL transaction, dedupe, delivery state and cancellation", async (t) => {
  process.env.USER_TELEGRAM_NOTIFICATIONS_READY = "1";
  process.env.USER_EMAIL_NOTIFICATIONS_READY = "1";
  const fixture = await queue3HttpFixture("q5-ne");
  const { db, user, book, call } = fixture;
  try {
    const recipient = await user("recipient");
    const actor = await user("actor");
    await db.query(
      "UPDATE users SET email = ?, email_verified_at = UTC_TIMESTAMP(), telegram_user_id = ?, telegram_connected_at = UTC_TIMESTAMP(), notification_timezone = 'Asia/Almaty' WHERE id = ?",
      ["notification-events@example.test", 700001, recipient.id],
    );
    await call(recipient, "PUT", "/users/me/notification-preferences", {
      categories: { friendships_follows: { inAppEnabled: true, telegramEnabled: true, emailMode: "immediate" } },
    });

    await t.test("active producer creates one event, projection and selected channel jobs", async () => {
      await call(actor, "POST", "/social/follows", { targetId: recipient.id }, 201);
      const [events] = await db.query("SELECT * FROM notification_events WHERE recipient_user_id = ? AND event_type = 'new_follower'", [recipient.id]);
      assert.equal(events.length, 1);
      assert.equal(events[0].category, "friendships_follows");
      const [deliveries] = await db.query("SELECT channel, mode, status FROM notification_deliveries WHERE event_id = ? ORDER BY id", [events[0].id]);
      assert.deepEqual(deliveries.map((row) => [row.channel, row.mode, row.status]), [["in_app", "immediate", "delivered"], ["telegram", "immediate", "pending"], ["email", "immediate", "pending"]]);
      const [[projection]] = await db.query("SELECT notification_event_id FROM notifications WHERE user_id = ? AND notification_type = 'new_follower'", [recipient.id]);
      assert.equal(Number(projection.notification_event_id), Number(events[0].id));
      await call(actor, "POST", "/social/follows", { targetId: recipient.id }, 201);
      const [[counts]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND event_type = 'new_follower'", [recipient.id]);
      assert.equal(Number(counts.total), 1);
    });

    await t.test("delete and recreate actions create one event per real lifecycle occurrence", async () => {
      const cycleRecipient = await user("cycle-recipient");
      const cycleActor = await user("cycle-actor");

      await call(cycleActor, "POST", "/social/follows", { targetId: cycleRecipient.id }, 201);
      await call(cycleActor, "POST", "/social/follows", { targetId: cycleRecipient.id }, 201);
      let [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'new_follower'", [cycleRecipient.id, cycleActor.id]);
      assert.equal(Number(count.total), 1);
      await call(cycleActor, "DELETE", `/social/follows/${cycleRecipient.id}`);
      await call(cycleActor, "POST", "/social/follows", { targetId: cycleRecipient.id }, 201);
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'new_follower'", [cycleRecipient.id, cycleActor.id]);
      assert.equal(Number(count.total), 2);

      const likedBook = await book("occurrence-like");
      const [createdReview] = await db.query("INSERT INTO reviews (user_id, book_id, rating, preview, body, is_adult) VALUES (?, ?, 5, 'Preview', '<p>Body</p>', 0)", [cycleRecipient.id, likedBook]);
      const reviewId = Number(createdReview.insertId);
      const likeBody = { materialKind: "review", materialId: reviewId };
      await call(cycleActor, "POST", "/reactions", likeBody, 201);
      await call(cycleActor, "POST", "/reactions", likeBody, 201);
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'like' AND material_kind = 'review' AND material_id = ?", [cycleRecipient.id, cycleActor.id, reviewId]);
      assert.equal(Number(count.total), 1);
      await call(cycleActor, "DELETE", "/reactions", likeBody);
      await call(cycleActor, "POST", "/reactions", likeBody, 201);
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'like' AND material_kind = 'review' AND material_id = ?", [cycleRecipient.id, cycleActor.id, reviewId]);
      assert.equal(Number(count.total), 2);

      const writer = await user("writer", { type: "Писатель" });
      const reader = await user("reader");
      const writerBook = await book("writer-occurrence");
      await db.query("UPDATE books SET creator_user_id = ? WHERE id = ?", [writer.id, writerBook]);
      await call(reader, "POST", "/books", { useExistingId: writerBook, readingStatus: "want" }, 201);
      await call(reader, "POST", "/books", { useExistingId: writerBook, readingStatus: "want" }, 201);
      await call(reader, "DELETE", `/books/${writerBook}`);
      await call(reader, "POST", "/books", { useExistingId: writerBook, readingStatus: "want" }, 201);
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'author_book_activity' AND material_id = ?", [writer.id, reader.id, writerBook]);
      assert.equal(Number(count.total), 2);

      const giftOwner = await user("gift-owner");
      const giftActor = await user("gift-actor");
      await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [Math.min(giftOwner.id, giftActor.id), Math.max(giftOwner.id, giftActor.id)]);
      const [gift] = await db.query(
        "INSERT INTO wishlist_items (user_id, author, title, genres, annotation, cover_tone, marketplace, product_url, pickup_address, recipient_name, recipient_phone, price_currency) VALUES (?, 'Author', 'Gift', '[]', '', 'blue', 'Flip', 'https://www.flip.kz/catalog?prod=1', 'Pickup', 'Recipient', '77000000000', 'KZT')",
        [giftOwner.id],
      );
      await call(giftActor, "POST", `/wishlist/${gift.insertId}/reserve`);
      await call(giftActor, "POST", `/wishlist/${gift.insertId}/reserve`);
      await call(giftOwner, "DELETE", `/wishlist/${gift.insertId}/reservation`);
      await call(giftActor, "POST", `/wishlist/${gift.insertId}/reserve`);
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'gift_reserved' AND material_id = ?", [giftOwner.id, giftActor.id, gift.insertId]);
      assert.equal(Number(count.total), 2);

      const friendA = await user("friend-a");
      const friendB = await user("friend-b");
      for (let occurrence = 0; occurrence < 2; occurrence += 1) {
        await call(friendA, "POST", "/social/friend-requests", { targetId: friendB.id }, 201);
        await call(friendB, "POST", `/social/friends/${friendA.id}/accept`);
        await call(friendA, "DELETE", `/social/friends/${friendB.id}`);
        await call(friendA, "DELETE", `/social/friends/${friendB.id}`);
      }
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'friendship_started'", [friendB.id, friendA.id]);
      assert.equal(Number(count.total), 2);
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'friendship_ended'", [friendB.id, friendA.id]);
      assert.equal(Number(count.total), 2);

      const rejectA = await user("reject-a");
      const rejectB = await user("reject-b");
      for (let occurrence = 0; occurrence < 2; occurrence += 1) {
        await call(rejectA, "POST", "/social/friend-requests", { targetId: rejectB.id }, 201);
        await call(rejectB, "POST", `/social/friends/${rejectA.id}/reject`, {});
      }
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'friend_rejected'", [rejectA.id, rejectB.id]);
      assert.equal(Number(count.total), 2);

      const community = await user("community", { type: "Сообщество" });
      const member = await user("member");
      for (let occurrence = 0; occurrence < 2; occurrence += 1) {
        await call(member, "POST", "/social/friend-requests", { targetId: community.id }, 201);
        await call(member, "DELETE", `/social/friends/${community.id}`);
      }
      [[count]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND actor_user_id = ? AND event_type = 'friendship_started'", [community.id, member.id]);
      assert.equal(Number(count.total), 2);
    });

    await t.test("preference disable and Telegram disconnect cancel only pending external deliveries", async () => {
      await call(recipient, "PUT", "/users/me/notification-preferences", { categories: { friendships_follows: { telegramEnabled: false, emailMode: "off" } } });
      const [cancelled] = await db.query("SELECT channel, status FROM notification_deliveries WHERE user_id = ? AND channel IN ('telegram', 'email')", [recipient.id]);
      assert.equal(cancelled.every((row) => row.status === "cancelled"), true);

      await call(recipient, "PUT", "/users/me/notification-preferences", { categories: { friendships_follows: { telegramEnabled: true, emailMode: "immediate" } } });
      await call(actor, "POST", "/social/friend-requests", { targetId: recipient.id }, 201);
      const [[friendEvent]] = await db.query("SELECT id FROM notification_events WHERE recipient_user_id = ? AND event_type = 'friend_request' ORDER BY id DESC LIMIT 1", [recipient.id]);
      await call(recipient, "DELETE", "/users/me/telegram");
      const [jobs] = await db.query("SELECT channel, status FROM notification_deliveries WHERE event_id = ? AND channel IN ('telegram', 'email') ORDER BY channel", [friendEvent.id]);
      assert.deepEqual(jobs.map((row) => [row.channel, row.status]), [["telegram", "cancelled"], ["email", "pending"]]);
    });

    await t.test("event creation is transactional, idempotent and unknown types stay mandatory in-app", async () => {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await createNotificationEvent(connection, { recipientUserId: recipient.id, actorUserId: actor.id, eventType: "future_security_event", title: "Security", body: "Internal evidence", dedupeKey: "rollback-security" });
        await connection.rollback();
        const [[rolledBack]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND dedupe_key = 'rollback-security'", [recipient.id]);
        assert.equal(Number(rolledBack.total), 0);

        await connection.beginTransaction();
        const first = await createNotificationEvent(connection, { recipientUserId: recipient.id, actorUserId: actor.id, eventType: "future_security_event", title: "Security", body: "Internal evidence", dedupeKey: "stable-security" });
        const repeated = await createNotificationEvent(connection, { recipientUserId: recipient.id, actorUserId: actor.id, eventType: "future_security_event", title: "Ignored repeat", body: "Ignored repeat", dedupeKey: "stable-security" });
        await connection.commit();
        assert.equal(first.created, true);
        assert.equal(repeated.created, false);
        const [[event]] = await db.query("SELECT id, category, title FROM notification_events WHERE recipient_user_id = ? AND dedupe_key = 'stable-security'", [recipient.id]);
        assert.equal(event.category, "system_security");
        assert.equal(event.title, "Security");
        const [internal] = await db.query("SELECT status FROM notification_deliveries WHERE event_id = ? AND channel = 'in_app'", [event.id]);
        assert.deepEqual(internal.map((row) => row.status), ["delivered"]);
      } finally {
        connection.release();
      }
    });

    await t.test("delivery claims cannot be double-owned and FKs retain/cascade as designed", async () => {
      const store = createMysqlNotificationDeliveryStore({ pool: db });
      const now = new Date(Date.now() + 60_000);
      const [first, second] = await Promise.all([
        store.claimDue({ workerId: "mysql-worker-a", limit: 1, now }),
        store.claimDue({ workerId: "mysql-worker-b", limit: 1, now }),
      ]);
      assert.equal(first.length + second.length, 1);
      const claimed = first[0] ?? second[0];
      const owner = first.length ? "mysql-worker-a" : "mysql-worker-b";
      await store.markDelivered({ id: claimed.id, workerId: owner, now });
      const [[delivered]] = await db.query("SELECT status, attempt_count FROM notification_deliveries WHERE id = ?", [claimed.id]);
      assert.equal(delivered.status, "delivered");
      assert.equal(Number(delivered.attempt_count), 1);

      const connectionForCrash = await db.getConnection();
      let crashedDeliveryId;
      try {
        await connectionForCrash.beginTransaction();
        const crashedEvent = await createNotificationEvent(connectionForCrash, { recipientUserId: recipient.id, actorUserId: actor.id, eventType: "new_follower", title: "Crash lease", body: "Internal", dedupeKey: "crash-lease-event" });
        await connectionForCrash.commit();
        const [[crashedDelivery]] = await db.query("SELECT id FROM notification_deliveries WHERE event_id = ? AND channel = 'email'", [crashedEvent.event.id]);
        crashedDeliveryId = Number(crashedDelivery.id);
      } finally {
        connectionForCrash.release();
      }
      await db.query("UPDATE notification_deliveries SET status = 'processing', attempt_count = 1, locked_by = 'crashed-worker', locked_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), next_attempt_at = UTC_TIMESTAMP() WHERE id = ?", [crashedDeliveryId]);
      const reclaimNow = new Date();
      const [reclaimedA, reclaimedB] = await Promise.all([
        store.claimDue({ workerId: "replacement-a", limit: 1, now: reclaimNow }),
        store.claimDue({ workerId: "replacement-b", limit: 1, now: reclaimNow }),
      ]);
      const reclaimed = [...reclaimedA, ...reclaimedB].filter((row) => Number(row.id) === crashedDeliveryId);
      assert.equal(reclaimed.length, 1);
      const replacementOwner = reclaimedA.some((row) => Number(row.id) === crashedDeliveryId) ? "replacement-a" : "replacement-b";
      const [[reclaimedRow]] = await db.query("SELECT status, attempt_count, locked_by FROM notification_deliveries WHERE id = ?", [crashedDeliveryId]);
      assert.equal(reclaimedRow.status, "processing");
      assert.equal(Number(reclaimedRow.attempt_count), 2);
      assert.equal(reclaimedRow.locked_by, replacementOwner);
      await store.markDelivered({ id: crashedDeliveryId, workerId: replacementOwner, now: reclaimNow });

      const doomedActor = await user("doomed-actor");
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const created = await createNotificationEvent(connection, { recipientUserId: recipient.id, actorUserId: doomedActor.id, eventType: "system", title: "System", body: "Internal", dedupeKey: "actor-retention" });
        await connection.commit();
        await db.query("DELETE FROM users WHERE id = ?", [doomedActor.id]);
        const [[retained]] = await db.query("SELECT actor_user_id FROM notification_events WHERE id = ?", [created.event.id]);
        assert.equal(retained.actor_user_id, null);
      } finally {
        connection.release();
      }

      const doomedRecipient = await user("doomed-recipient");
      const connection2 = await db.getConnection();
      let eventId;
      try {
        await connection2.beginTransaction();
        const created = await createNotificationEvent(connection2, { recipientUserId: doomedRecipient.id, eventType: "system", title: "System", body: "Internal", dedupeKey: "recipient-cascade" });
        eventId = Number(created.event.id);
        await connection2.commit();
      } finally {
        connection2.release();
      }
      await db.query("DELETE FROM users WHERE id = ?", [doomedRecipient.id]);
      const [[cascade]] = await db.query("SELECT COUNT(*) AS total FROM notification_events WHERE id = ?", [eventId]);
      assert.equal(Number(cascade.total), 0);
    });

    await t.test("daily email jobs share one safe digest call and one atomic result", async () => {
      const digestUser = await user("digest-user");
      await db.query("UPDATE users SET email = ?, email_verified_at = UTC_TIMESTAMP(), notification_timezone = 'America/New_York' WHERE id = ?", ["digest@example.test", digestUser.id]);
      await db.query("INSERT INTO notification_preferences (user_id, category, in_app_enabled, telegram_enabled, email_mode) VALUES (?, 'likes', 1, 0, 'daily')", [digestUser.id]);
      await db.query("UPDATE notification_deliveries SET next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY) WHERE status IN ('pending', 'failed')");
      const connection = await db.getConnection();
      const eventIds = [];
      try {
        await connection.beginTransaction();
        for (const suffix of ["a", "b"]) {
          const created = await createNotificationEvent(connection, { recipientUserId: digestUser.id, actorUserId: actor.id, eventType: "like", title: `Internal ${suffix}`, body: `PRIVATE_${suffix}`, materialKind: "review", materialId: suffix === "a" ? 71 : 72, dedupeKey: `digest-${suffix}` }, { now: new Date("2026-03-08T12:00:00.000Z") });
          eventIds.push(Number(created.event.id));
        }
        await connection.commit();
      } finally {
        connection.release();
      }
      const digestWindow = new Date("2026-03-08T13:00:00.000Z");
      await db.query("UPDATE notification_deliveries SET next_attempt_at = ?, digest_window_at = ? WHERE event_id IN (?) AND channel = 'email'", [new Date("2026-03-08T12:59:00.000Z"), digestWindow, eventIds]);
      const calls = [];
      const worker = createNotificationDeliveryWorker({
        store: createMysqlNotificationDeliveryStore({ pool: db }),
        adapters: { email: async (input) => calls.push(input) },
        workerId: "digest-worker",
        now: () => new Date("2026-03-08T13:00:00.000Z"),
      });
      const result = await worker.runOnce({ limit: 10 });
      assert.equal(result.length, 2);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].idempotencyKey, "notification-digest:" + digestUser.id + ":2026-03-08T13:00:00.000Z");
      assert.equal(calls[0].payloads.length, 2);
      assert.equal(JSON.stringify(calls[0]).includes("PRIVATE_"), false);
      const [delivered] = await db.query("SELECT status FROM notification_deliveries WHERE event_id IN (?) AND channel = 'email'", [eventIds]);
      assert.deepEqual(delivered.map((row) => row.status), ["delivered", "delivered"]);
    });

    await t.test("schema exposes unique idempotency and required foreign keys", async () => {
      const [indexes] = await db.query("SHOW INDEX FROM notification_deliveries WHERE Key_name = 'uq_notification_deliveries_idempotency'");
      assert.equal(indexes.length, 1);
      assert.equal(Number(indexes[0].Non_unique), 0);
      const [foreignKeys] = await db.query(
        `SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('notification_events', 'notification_deliveries')`,
      );
      const rules = new Map(foreignKeys.map((row) => [row.CONSTRAINT_NAME, row.DELETE_RULE]));
      assert.equal(rules.get("fk_notification_events_actor"), "SET NULL");
      assert.equal(rules.get("fk_notification_deliveries_event"), "CASCADE");
      assert.equal(rules.get("fk_notification_deliveries_user"), "CASCADE");
      const [[digestColumn]] = await db.query("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_deliveries' AND COLUMN_NAME = 'digest_window_at'");
      assert.equal(digestColumn.IS_NULLABLE, "YES");
      const [[digestCheck]] = await db.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_deliveries' AND CONSTRAINT_TYPE = 'CHECK' AND CONSTRAINT_NAME = 'chk_notification_deliveries_digest_window'");
      assert.equal(digestCheck.CONSTRAINT_NAME, "chk_notification_deliveries_digest_window");
    });
  } finally {
    delete process.env.USER_TELEGRAM_NOTIFICATIONS_READY;
    delete process.env.USER_EMAIL_NOTIFICATIONS_READY;
    await fixture.close();
  }
});
