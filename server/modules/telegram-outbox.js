import { getPool, withTransaction } from "../db.js";

const EVENT_LABELS = {
  support_message: "Новое обращение в поддержку",
  event_pending: "Событие ожидает модерации",
  occasion_pending: "Книжный повод ожидает модерации",
  organization_pending: "Профиль организации ожидает модерации",
  report_created: "Новая жалоба",
};

export function telegramAlertsEnabled(environment = process.env) {
  return environment.TELEGRAM_ALERTS_ENABLED === "1"
    && Boolean(environment.TELEGRAM_BOT_TOKEN)
    && Boolean(environment.TELEGRAM_CHAT_ID);
}

// Deliberately configuration-only: callers can expose this to operators without
// reading token/chat values or attempting a Telegram request.
export function telegramDiagnostics(environment = process.env) {
  const configured = Boolean(environment.TELEGRAM_BOT_TOKEN && environment.TELEGRAM_CHAT_ID);
  const enabledFlag = environment.TELEGRAM_ALERTS_ENABLED === "1";
  return {
    configured,
    enabled: telegramAlertsEnabled(environment),
    status: !configured ? "not_configured" : enabledFlag ? "configured_unverified" : "disabled",
  };
}

export function shouldEnqueueSupportAlert(participants, senderId, recipientId) {
  const sender = participants.find((participant) => Number(participant.id) === Number(senderId));
  const recipient = participants.find((participant) => Number(participant.id) === Number(recipientId));
  return sender?.role !== "admin" && recipient?.role === "admin";
}

export async function enqueueTelegramAlert(connection, { eventType, entityId, actorUserId, summary = "", dedupeKey }) {
  if (!EVENT_LABELS[eventType]) throw new Error("Неизвестный тип Telegram-уведомления");
  const safeEntityId = Number(entityId);
  if (!Number.isSafeInteger(safeEntityId) || safeEntityId < 1) throw new Error("Некорректный идентификатор Telegram-уведомления");
  const key = String(dedupeKey || `${eventType}:${safeEntityId}`).slice(0, 190);
  await connection.query(
    `INSERT IGNORE INTO telegram_alert_outbox (event_type, entity_id, actor_user_id, summary, dedupe_key)
     VALUES (?, ?, ?, ?, ?)`,
    [eventType, safeEntityId, Number(actorUserId) || null, String(summary).trim().slice(0, 500) || null, key],
  );
}

export function telegramAlertText(row) {
  const label = EVENT_LABELS[row.event_type] ?? "Новое событие Book Meet";
  const parts = [label, `ID: ${Number(row.entity_id)}`];
  if (row.summary) parts.push(String(row.summary).slice(0, 500));
  return parts.join("\n");
}

async function claimNextAlert() {
  return withTransaction(async (connection) => {
    const [[row]] = await connection.query(
      `SELECT id, event_type, entity_id, actor_user_id, summary, attempts
         FROM telegram_alert_outbox
        WHERE delivered_at IS NULL
          AND available_at <= UTC_TIMESTAMP()
          AND (locked_at IS NULL OR locked_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))
        ORDER BY id
        LIMIT 1
        FOR UPDATE`,
    );
    if (!row) return null;
    await connection.query(
      "UPDATE telegram_alert_outbox SET locked_at = UTC_TIMESTAMP() WHERE id = ? AND delivered_at IS NULL",
      [row.id],
    );
    return { ...row, id: Number(row.id), attempts: Number(row.attempts) };
  });
}

function retryDelaySeconds(attempts) {
  return Math.min(3600, 15 * (2 ** Math.min(8, Math.max(0, attempts))));
}

async function sendTelegramAlert(row, { fetchImpl = fetch, environment = process.env } = {}) {
  const response = await fetchImpl(`https://api.telegram.org/bot${environment.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: environment.TELEGRAM_CHAT_ID, text: telegramAlertText(row) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
}

export async function dispatchTelegramOutbox(options = {}) {
  const environment = options.environment ?? process.env;
  if (!telegramAlertsEnabled(environment)) return { status: "disabled" };
  const row = await (options.claimNext ?? claimNextAlert)();
  if (!row) return { status: "idle" };
  try {
    await sendTelegramAlert(row, { fetchImpl: options.fetchImpl, environment });
    await (options.pool ?? getPool()).query(
      "UPDATE telegram_alert_outbox SET delivered_at = UTC_TIMESTAMP(), locked_at = NULL, last_error = NULL WHERE id = ? AND delivered_at IS NULL",
      [row.id],
    );
    return { status: "delivered", id: row.id };
  } catch (error) {
    const attempts = Number(row.attempts) + 1;
    await (options.pool ?? getPool()).query(
      `UPDATE telegram_alert_outbox
          SET attempts = ?, available_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), locked_at = NULL, last_error = ?
        WHERE id = ? AND delivered_at IS NULL`,
      [attempts, retryDelaySeconds(attempts), String(error?.message ?? "Telegram delivery failed").replace(/bot[^/\s]+/gi, "bot[redacted]").slice(0, 255), row.id],
    );
    return { status: "retry", id: row.id, attempts };
  }
}

export function createTelegramOutboxDispatcher({ intervalMs = 15_000, ...options } = {}) {
  let timer = null;
  let wakeTimer = null;
  let running = false;
  let stopping = false;
  let wakeRequested = false;
  const enabled = () => telegramAlertsEnabled(options.environment ?? process.env);
  const scheduleWake = () => {
    if (stopping || !enabled() || wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void tick();
    }, 0);
    wakeTimer.unref?.();
  };
  const tick = async () => {
    if (stopping) return;
    if (running) { wakeRequested = true; return; }
    running = true;
    wakeRequested = false;
    try {
      let result;
      do { result = await dispatchTelegramOutbox(options); } while (!stopping && result.status === "delivered");
    } catch (error) {
      console.warn("Telegram alert dispatcher failed", String(error?.message ?? "unknown error").replace(/bot[^/\s]+/gi, "bot[redacted]"));
    } finally {
      running = false;
      if (wakeRequested && !stopping) scheduleWake();
    }
  };
  return {
    start() {
      if (timer || !enabled()) return;
      stopping = false;
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
      void tick();
    },
    // Called only after a successful API response, which is after its DB transaction committed.
    wake() {
      if (stopping || !enabled()) return;
      wakeRequested = true;
      scheduleWake();
    },
    stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      if (wakeTimer) clearTimeout(wakeTimer);
      timer = null;
      wakeTimer = null;
    },
    tick,
  };
}
