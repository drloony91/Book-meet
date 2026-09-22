import { randomUUID } from "node:crypto";
import { notificationCategoryFor, notificationPreferencesState } from "./notification-preferences.js";
import { markTelegramChannelError } from "./notification-channels.js";

export const NOTIFICATION_DELIVERY_MAX_ATTEMPTS = 5;
export const NOTIFICATION_DAILY_LOCAL_HOUR = 9;
const EXTERNAL_CHANNELS = new Set(["telegram", "email"]);

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function zonedWallTimeToUtc(parts, timeZone) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute ?? 0, parts.second ?? 0);
  let value = desired;
  for (let index = 0; index < 4; index += 1) {
    const actual = dateParts(new Date(value), timeZone);
    const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const adjustment = desired - actualWall;
    value += adjustment;
    if (!adjustment) break;
  }
  return new Date(value);
}

export function nextDailyNotificationAt(now = new Date(), timeZone = "UTC", localHour = NOTIFICATION_DAILY_LOCAL_HOUR) {
  const local = dateParts(now, timeZone);
  const nextDay = local.hour >= localHour;
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day + (nextDay ? 1 : 0)));
  return zonedWallTimeToUtc({
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
    hour: localHour,
    minute: 0,
    second: 0,
  }, timeZone);
}

export function notificationRetryDelayMs(attemptCount) {
  return Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.max(0, Math.min(10, Number(attemptCount) - 1))));
}

export function safeNotificationDeliveryError(error) {
  const source = String(error?.message ?? "Notification delivery failed");
  return source
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bbearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/bot[A-Za-z0-9:_-]{8,}/gi, "bot[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 255);
}

const EXTERNAL_TITLES = Object.freeze({
  friendships_follows: "Новое социальное уведомление",
  likes: "Новая реакция",
  comments_replies: "Новый комментарий или ответ",
  mentions: "Новое упоминание",
  reposts: "Новый репост",
  events_communities: "Новое событие сообщества",
  reading_reminders: "Новое напоминание о чтении",
  system_security: "Важное системное уведомление",
});

export function safeExternalNotificationPayload(event) {
  return {
    title: EXTERNAL_TITLES[event.category] ?? EXTERNAL_TITLES.system_security,
    summary: "Откройте Book Meet, чтобы посмотреть подробности.",
    link: event.material_kind && event.material_id ? { materialKind: String(event.material_kind), materialId: Number(event.material_id) } : null,
  };
}

export function notificationDeliveryPlan(state, category, now = new Date()) {
  const preference = state.categories[category];
  const plan = [];
  if (category === "system_security" || preference.inAppEnabled) plan.push({ channel: "in_app", mode: "immediate", dueAt: now });
  if (preference.telegramEnabled && state.readiness.telegram.available) plan.push({ channel: "telegram", mode: "immediate", dueAt: now });
  if (preference.emailMode !== "off" && state.readiness.email.available) {
    const dueAt = preference.emailMode === "daily" ? nextDailyNotificationAt(now, state.effectiveTimezone) : now;
    plan.push({ channel: "email", mode: preference.emailMode, dueAt, digestWindowAt: preference.emailMode === "daily" ? dueAt : null });
  }
  return plan;
}

async function accountNotificationState(connection, userId, requestTimezone = "UTC", environment = process.env) {
  const [[account]] = await connection.query(
    `SELECT email, email_verified_at, notification_timezone, telegram_user_id, telegram_connected_at
       FROM users WHERE id = ? AND deleted_at IS NULL AND purged_at IS NULL`,
    [userId],
  );
  if (!account) return null;
  const [rows] = await connection.query(
    `SELECT category, in_app_enabled, telegram_enabled, email_mode
       FROM notification_preferences WHERE user_id = ?`,
    [userId],
  );
  return notificationPreferencesState({ rows, account, requestTimezone, environment });
}

function cleanEventInput(input) {
  const recipientUserId = Number(input.recipientUserId);
  const actorUserId = Number(input.actorUserId) || null;
  const eventType = String(input.eventType ?? "").trim().slice(0, 64);
  const dedupeKey = String(input.dedupeKey ?? "").trim().slice(0, 190);
  const title = String(input.title ?? "").trim().slice(0, 160);
  const body = String(input.body ?? "").trim();
  if (!Number.isSafeInteger(recipientUserId) || recipientUserId < 1 || !eventType || !dedupeKey || !title || !body) {
    throw new Error("Invalid notification event");
  }
  const materialId = Number(input.materialId);
  return {
    recipientUserId,
    actorUserId,
    eventType,
    category: notificationCategoryFor(eventType),
    title,
    body,
    materialKind: input.materialKind ? String(input.materialKind).slice(0, 20) : null,
    materialId: Number.isSafeInteger(materialId) && materialId > 0 ? materialId : null,
    dedupeKey,
    groupKey: input.groupKey ? String(input.groupKey).slice(0, 255) : null,
  };
}

export async function createNotificationEvent(connection, input, { environment = process.env, now = new Date() } = {}) {
  const event = cleanEventInput(input);
  const state = await accountNotificationState(connection, event.recipientUserId, "UTC", environment);
  if (!state) return { created: false, skipped: "recipient_unavailable" };
  const [inserted] = await connection.query(
    `INSERT IGNORE INTO notification_events
       (recipient_user_id, actor_user_id, event_type, category, title, body, material_kind, material_id, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.recipientUserId, event.actorUserId, event.eventType, event.category, event.title, event.body, event.materialKind, event.materialId, event.dedupeKey],
  );
  const [[stored]] = await connection.query(
    `SELECT id, recipient_user_id, actor_user_id, event_type, category, title, body, material_kind, material_id, dedupe_key, created_at
       FROM notification_events WHERE recipient_user_id = ? AND dedupe_key = ?`,
    [event.recipientUserId, event.dedupeKey],
  );
  if (!inserted.affectedRows) return { created: false, event: stored };

  const plan = notificationDeliveryPlan(state, event.category, now);
  const selectedInApp = plan.some((delivery) => delivery.channel === "in_app");
  if (selectedInApp) {
    await connection.query(
      `INSERT INTO notification_deliveries
         (event_id, user_id, channel, mode, idempotency_key, status, delivered_at)
       VALUES (?, ?, 'in_app', 'immediate', ?, 'delivered', ?)` ,
      [stored.id, event.recipientUserId, `notification:${stored.id}:in_app:immediate`, now],
    );
    await connection.query(
      `INSERT INTO notifications
         (notification_event_id, user_id, actor_user_id, notification_type, title, body, material_kind, material_id, group_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notification_event_id = VALUES(notification_event_id), actor_user_id = VALUES(actor_user_id),
         notification_type = VALUES(notification_type), title = VALUES(title), body = VALUES(body),
         material_kind = VALUES(material_kind), material_id = VALUES(material_id), is_unread = 1, created_at = CURRENT_TIMESTAMP`,
      [stored.id, event.recipientUserId, event.actorUserId, event.eventType, event.title, event.body, event.materialKind, event.materialId, event.groupKey],
    );
  }

  const external = plan.filter((delivery) => delivery.channel !== "in_app");
  for (const delivery of external) {
    await connection.query(
      `INSERT INTO notification_deliveries
         (event_id, user_id, channel, mode, idempotency_key, status, next_attempt_at, digest_window_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [stored.id, event.recipientUserId, delivery.channel, delivery.mode, `notification:${stored.id}:${delivery.channel}:${delivery.mode}`, delivery.dueAt, delivery.digestWindowAt ?? null],
    );
  }
  return { created: true, event: stored, deliveries: { inApp: selectedInApp, external } };
}

export async function cancelNotificationDeliveries(connection, { userId, channel, category, materialKind, materialId, eventType, actorUserId } = {}) {
  const clauses = ["d.status IN ('pending', 'failed')", "d.channel IN ('telegram', 'email')"];
  const values = [];
  if (userId) { clauses.push("d.user_id = ?"); values.push(Number(userId)); }
  if (channel) { clauses.push("d.channel = ?"); values.push(channel); }
  if (category) { clauses.push("e.category = ?"); values.push(category); }
  if (materialKind) { clauses.push("e.material_kind = ?"); values.push(materialKind); }
  if (materialId) { clauses.push("e.material_id = ?"); values.push(Number(materialId)); }
  if (eventType) { clauses.push("e.event_type = ?"); values.push(eventType); }
  if (actorUserId) { clauses.push("e.actor_user_id = ?"); values.push(Number(actorUserId)); }
  const [result] = await connection.query(
    `UPDATE notification_deliveries d JOIN notification_events e ON e.id = d.event_id
        SET d.status = 'cancelled', d.cancelled_at = UTC_TIMESTAMP(), d.locked_at = NULL, d.locked_by = NULL, d.next_attempt_at = NULL
      WHERE ${clauses.join(" AND ")}`,
    values,
  );
  return Number(result.affectedRows);
}

export function createNotificationDeliveryWorker({ store, adapters, workerId = `worker:${randomUUID()}`, now = () => new Date(), maxAttempts = NOTIFICATION_DELIVERY_MAX_ATTEMPTS } = {}) {
  if (!store || !adapters) throw new Error("Notification delivery worker requires store and adapters");
  return {
    async runOnce({ limit = 20 } = {}) {
      const claimed = await store.claimDue({ workerId, limit, now: now() });
      const results = [];
      const groups = new Map();
      for (const delivery of claimed) {
        const digestWindow = delivery.digest_window_at ? new Date(delivery.digest_window_at).toISOString() : "missing";
        const key = delivery.channel === "email" && delivery.mode === "daily"
          ? `daily:${delivery.user_id}:${digestWindow}`
          : `single:${delivery.id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(delivery);
      }
      for (const deliveries of groups.values()) {
        const [first] = deliveries;
        const ids = deliveries.map((delivery) => delivery.id);
        const adapter = adapters[first.channel];
        const recipient = {
          userId: Number(first.user_id),
          email: first.email || null,
          emailVerified: Boolean(first.email_verified_at),
          telegramUserId: first.telegram_user_id ? Number(first.telegram_user_id) : null,
          telegramConnected: Boolean(first.telegram_connected_at),
        };
        if (!EXTERNAL_CHANNELS.has(first.channel) || typeof adapter !== "function") {
          await store.markFailedBatch({ ids, workerId, terminal: true, error: "Notification channel adapter unavailable", now: now() });
          results.push(...ids.map((id) => ({ id, status: "failed" })));
          continue;
        }
        try {
          if (first.channel === "email" && first.mode === "daily") {
            const digestWindow = new Date(first.digest_window_at).toISOString();
            await adapter({
              idempotencyKey: `notification-digest:${first.user_id}:${digestWindow}`,
              mode: "daily",
              recipient,
              payloads: deliveries.map(safeExternalNotificationPayload),
            });
          } else {
            await adapter({ idempotencyKey: first.idempotency_key, mode: first.mode, recipient, payload: safeExternalNotificationPayload(first) });
          }
          await store.markDeliveredBatch({ ids, workerId, now: now() });
          results.push(...ids.map((id) => ({ id, status: "delivered" })));
        } catch (error) {
          const channelBlocked = first.channel === "telegram" && error?.code === "TELEGRAM_CHANNEL_BLOCKED";
          if (channelBlocked && typeof store.markChannelError === "function") await store.markChannelError({ userId: first.user_id, now: now() });
          const terminal = channelBlocked || deliveries.some((delivery) => Number(delivery.attempt_count) >= maxAttempts);
          await store.markFailedBatch({
            ids,
            workerId,
            terminal,
            error: safeNotificationDeliveryError(error),
            nextAttemptAt: terminal ? null : new Date(now().getTime() + notificationRetryDelayMs(Math.max(...deliveries.map((delivery) => Number(delivery.attempt_count))))),
            now: now(),
          });
          results.push(...ids.map((id) => ({ id, status: terminal ? "failed" : "retry" })));
        }
      }
      return results;
    },
  };
}

export function createMysqlNotificationDeliveryStore({ pool, lockTimeoutMinutes = 5 } = {}) {
  if (!pool) throw new Error("Notification delivery store requires a pool");
  return {
    async claimDue({ workerId, limit, now }) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const due = `((d.status IN ('pending', 'failed') AND d.next_attempt_at <= ?
                       AND (d.locked_at IS NULL OR d.locked_at < DATE_SUB(?, INTERVAL ? MINUTE)))
                   OR (d.status = 'processing' AND d.locked_at < DATE_SUB(?, INTERVAL ? MINUTE)))`;
        const dueValues = [now, now, lockTimeoutMinutes, now, lockTimeoutMinutes];
        const [[digestUser]] = await connection.query(
          `SELECT u.id FROM users u
            WHERE EXISTS (
              SELECT 1 FROM notification_deliveries d
               WHERE d.user_id = u.id AND d.channel = 'email' AND d.mode = 'daily' AND ${due}
            )
            ORDER BY u.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          dueValues,
        );
        let rows;
        if (digestUser) {
          const [[digest]] = await connection.query(
            `SELECT d.digest_window_at FROM notification_deliveries d
              WHERE d.user_id = ? AND d.channel = 'email' AND d.mode = 'daily' AND ${due}
              ORDER BY d.digest_window_at, d.id LIMIT 1 FOR UPDATE`,
            [digestUser.id, ...dueValues],
          );
          [rows] = await connection.query(
            `SELECT d.id, d.event_id, d.user_id, d.channel, d.mode, d.idempotency_key, d.attempt_count, d.digest_window_at,
                    u.email, u.email_verified_at, u.telegram_user_id, u.telegram_connected_at,
                    e.category, e.material_kind, e.material_id
               FROM notification_deliveries d JOIN notification_events e ON e.id = d.event_id JOIN users u ON u.id = d.user_id
              WHERE d.user_id = ? AND d.channel = 'email' AND d.mode = 'daily' AND d.digest_window_at <=> ? AND ${due}
              ORDER BY d.id FOR UPDATE`,
            [digestUser.id, digest.digest_window_at, ...dueValues],
          );
        } else {
          [rows] = await connection.query(
            `SELECT d.id, d.event_id, d.user_id, d.channel, d.mode, d.idempotency_key, d.attempt_count, d.digest_window_at,
                    u.email, u.email_verified_at, u.telegram_user_id, u.telegram_connected_at,
                    e.category, e.material_kind, e.material_id
               FROM notification_deliveries d JOIN notification_events e ON e.id = d.event_id JOIN users u ON u.id = d.user_id
              WHERE NOT (d.channel = 'email' AND d.mode = 'daily') AND ${due}
              ORDER BY COALESCE(d.next_attempt_at, d.locked_at), d.id LIMIT ? FOR UPDATE SKIP LOCKED`,
            [...dueValues, Math.max(1, Math.min(100, Number(limit) || 20))],
          );
        }
        if (rows.length) {
          await connection.query(
            `UPDATE notification_deliveries SET status = 'processing', locked_at = ?, locked_by = ?, attempt_count = attempt_count + 1
              WHERE id IN (${rows.map(() => "?").join(",")})`,
            [now, String(workerId).slice(0, 100), ...rows.map((row) => row.id)],
          );
        }
        await connection.commit();
        return rows.map((row) => ({ ...row, attempt_count: Number(row.attempt_count) + 1 }));
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async markDeliveredBatch({ ids, workerId, now }) {
      if (!ids.length) return;
      await pool.query(
        `UPDATE notification_deliveries SET status = 'delivered', delivered_at = ?, locked_at = NULL, locked_by = NULL, last_error = NULL
          WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'processing' AND locked_by = ?`,
        [now, ...ids, workerId],
      );
    },
    async markFailedBatch({ ids, workerId, terminal, error, nextAttemptAt }) {
      if (!ids.length) return;
      await pool.query(
        `UPDATE notification_deliveries SET status = 'failed', next_attempt_at = ?, locked_at = NULL, locked_by = NULL, last_error = ?
          WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'processing' AND locked_by = ?`,
        [terminal ? null : nextAttemptAt, safeNotificationDeliveryError({ message: error }), ...ids, workerId],
      );
    },
    async markChannelError({ userId, now }) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await markTelegramChannelError(connection, userId, { now });
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async markDelivered({ id, workerId, now }) { return this.markDeliveredBatch({ ids: [id], workerId, now }); },
    async markFailed({ id, workerId, terminal, error, nextAttemptAt }) { return this.markFailedBatch({ ids: [id], workerId, terminal, error, nextAttemptAt }); },
  };
}
