import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sendAccountEmail } from "./mailer.js";

export const TELEGRAM_LINK_TTL_MINUTES = 15;
export const EMAIL_UNSUBSCRIBE_TTL_DAYS = 30;

function safeEqual(first, second) {
  const left = Buffer.from(String(first ?? ""));
  const right = Buffer.from(String(second ?? ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function telegramLinkConfiguration(environment = process.env) {
  const botUsername = String(environment.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  const configured = Boolean(
    environment.TELEGRAM_BOT_TOKEN
    && environment.TELEGRAM_WEBHOOK_SECRET
    && /^[A-Za-z0-9_]{5,32}$/.test(botUsername),
  );
  return {
    configured,
    ready: configured && environment.USER_TELEGRAM_NOTIFICATIONS_READY === "1",
    botUsername: configured ? botUsername : null,
  };
}

export function telegramWebhookAuthorized(value, environment = process.env) {
  const expected = environment.TELEGRAM_WEBHOOK_SECRET;
  return Boolean(expected) && safeEqual(value, expected);
}

export function hashTelegramLinkToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function createTelegramLinkToken() {
  return randomBytes(24).toString("base64url");
}

export function telegramDeepLink(token, environment = process.env) {
  const configuration = telegramLinkConfiguration(environment);
  if (!configuration.ready) return null;
  return `https://t.me/${configuration.botUsername}?start=${encodeURIComponent(token)}`;
}

export async function replaceTelegramLinkToken(connection, userId, { token = createTelegramLinkToken(), now = new Date() } = {}) {
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_TTL_MINUTES * 60_000);
  await connection.query("DELETE FROM telegram_link_tokens WHERE user_id = ?", [Number(userId)]);
  await connection.query(
    "INSERT INTO telegram_link_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [Number(userId), hashTelegramLinkToken(token), expiresAt],
  );
  return { token, expiresAt };
}

export function safeTelegramDisplayName(from = {}) {
  const username = String(from.username ?? "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
  if (username) return `@${username}`;
  const name = [from.first_name, from.last_name].map((value) => String(value ?? "").replace(/[\r\n<>]/g, " ").trim()).filter(Boolean).join(" ").slice(0, 120);
  return name || "Telegram";
}

export async function consumeTelegramLinkToken(connection, { token, telegramUserId, displayName, now = new Date() }) {
  const numericTelegramUserId = Number(telegramUserId);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token ?? "")) || !Number.isSafeInteger(numericTelegramUserId) || numericTelegramUserId < 1) return null;
  const tokenHash = hashTelegramLinkToken(token);
  const [[row]] = await connection.query(
    `SELECT user_id FROM telegram_link_tokens
      WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
      LIMIT 1 FOR UPDATE`,
    [tokenHash, now],
  );
  if (!row) return null;
  const [account] = await connection.query(
    "UPDATE users SET telegram_user_id = ?, telegram_connected_at = ?, telegram_display_name = ?, telegram_delivery_error_at = NULL WHERE id = ? AND deleted_at IS NULL AND purged_at IS NULL",
    [numericTelegramUserId, now, String(displayName ?? "Telegram").slice(0, 120), Number(row.user_id)],
  );
  if (!account.affectedRows) return null;
  const [consumed] = await connection.query(
    "UPDATE telegram_link_tokens SET consumed_at = ? WHERE user_id = ? AND token_hash = ? AND consumed_at IS NULL",
    [now, Number(row.user_id), tokenHash],
  );
  if (!consumed.affectedRows) throw new Error("Telegram link token consumption conflict");
  return Number(row.user_id);
}

function unsubscribeSecret(environment) {
  return environment.NOTIFICATION_UNSUBSCRIBE_SECRET || "";
}

export function createEmailUnsubscribeToken(userId, { environment = process.env, now = new Date() } = {}) {
  const secret = unsubscribeSecret(environment);
  if (!secret || !Number.isSafeInteger(Number(userId)) || Number(userId) < 1) return null;
  const expires = Math.floor(now.getTime() / 1000) + EMAIL_UNSUBSCRIBE_TTL_DAYS * 86_400;
  const payload = `${Number(userId)}.${expires}`;
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyEmailUnsubscribeToken(token, { environment = process.env, now = new Date() } = {}) {
  const secret = unsubscribeSecret(environment);
  const [encoded, signature, extra] = String(token ?? "").split(".");
  if (!secret || !encoded || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  let payload;
  try { payload = Buffer.from(encoded, "base64url").toString("utf8"); } catch { return null; }
  const match = payload.match(/^(\d+)\.(\d+)$/);
  if (!match) return null;
  const userId = Number(match[1]);
  const expires = Number(match[2]);
  if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(expires) || expires <= Math.floor(now.getTime() / 1000)) return null;
  return { userId, expiresAt: new Date(expires * 1000) };
}

function notificationUrl(environment) {
  try { return new URL("/notifications", environment.APP_ORIGIN || "https://bookmeet.club").toString(); } catch { return "https://bookmeet.club/notifications"; }
}

function safeNotificationText(payload, environment) {
  return `${payload.title}\n${payload.summary}\n${notificationUrl(environment)}`;
}

export function createTelegramNotificationAdapter({ environment = process.env, fetchImpl = fetch } = {}) {
  return async ({ recipient, payload }) => {
    if (environment.USER_TELEGRAM_NOTIFICATIONS_READY !== "1" || !environment.TELEGRAM_BOT_TOKEN || !recipient?.telegramUserId || !recipient?.telegramConnected) throw new Error("Telegram adapter unavailable");
    const response = await fetchImpl(`https://api.telegram.org/bot${environment.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: recipient.telegramUserId, text: safeNotificationText(payload, environment), disable_web_page_preview: true }),
    });
    if (!response.ok) {
      const error = new Error(`Telegram delivery failed: ${response.status}`);
      if (response.status === 403) error.code = "TELEGRAM_CHANNEL_BLOCKED";
      throw error;
    }
  };
}

export async function markTelegramChannelError(connection, userId, { now = new Date() } = {}) {
  await connection.query("UPDATE users SET telegram_delivery_error_at = ? WHERE id = ?", [now, Number(userId)]);
  await connection.query("UPDATE notification_preferences SET telegram_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [Number(userId)]);
  await connection.query(
    "UPDATE notification_deliveries SET status = 'cancelled', cancelled_at = ?, next_attempt_at = NULL, locked_at = NULL, locked_by = NULL WHERE user_id = ? AND channel = 'telegram' AND status IN ('pending', 'failed')",
    [now, Number(userId)],
  );
}

export function createEmailNotificationAdapter({ environment = process.env, sendEmail = sendAccountEmail } = {}) {
  return async ({ recipient, payload, payloads, mode, idempotencyKey }) => {
    if (environment.USER_EMAIL_NOTIFICATIONS_READY !== "1" || !recipient?.email || !recipient?.emailVerified) throw new Error("Email adapter unavailable");
    const items = Array.isArray(payloads) ? payloads : payload ? [payload] : [];
    if (!items.length) throw new Error("Email payload unavailable");
    const unsubscribeToken = createEmailUnsubscribeToken(recipient.userId, { environment });
    if (!unsubscribeToken) throw new Error("Email unsubscribe signing unavailable");
    const unsubscribeUrl = new URL(`/api/notifications/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`, environment.APP_ORIGIN || "https://bookmeet.club").toString();
    const subject = mode === "daily" ? `Book Meet: ${items.length} уведомлений` : `Book Meet: ${items[0].title}`;
    const text = [
      mode === "daily" ? "Ваш дайджест Book Meet" : items[0].title,
      ...items.map((item) => `• ${item.summary}`),
      notificationUrl(environment),
      `Отключить необязательные email-уведомления: ${unsubscribeUrl}`,
    ].join("\n");
    const result = await sendEmail({ to: recipient.email, subject, text, messageId: idempotencyKey });
    if (!result.delivered) throw new Error("Email delivery failed");
  };
}

export async function verifyTelegramBot(environment = process.env, fetchImpl = fetch) {
  if (!environment.TELEGRAM_BOT_TOKEN) return { configured: false, verified: false, webhookConfigured: false };
  try {
    const [identityResponse, webhookResponse] = await Promise.all([
      fetchImpl(`https://api.telegram.org/bot${environment.TELEGRAM_BOT_TOKEN}/getMe`),
      fetchImpl(`https://api.telegram.org/bot${environment.TELEGRAM_BOT_TOKEN}/getWebhookInfo`),
    ]);
    const [identity, webhook] = await Promise.all([identityResponse.json(), webhookResponse.json()]);
    return { configured: true, verified: identityResponse.ok && identity.ok === true, webhookConfigured: webhookResponse.ok && webhook.ok === true && Boolean(webhook.result?.url) };
  } catch {
    return { configured: true, verified: false, webhookConfigured: false };
  }
}

export async function configureTelegramWebhook(environment = process.env, fetchImpl = fetch) {
  const configuration = telegramLinkConfiguration(environment);
  let webhookUrl;
  try { webhookUrl = new URL("/api/integrations/telegram/webhook", environment.APP_ORIGIN); } catch { return { configured: configuration.configured, applied: false, verified: false }; }
  if (!configuration.configured || webhookUrl.protocol !== "https:") return { configured: configuration.configured, applied: false, verified: false };
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${environment.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: webhookUrl.toString(), secret_token: environment.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: false }),
    });
    const result = await response.json();
    return { configured: true, applied: response.ok && result.ok === true, verified: response.ok && result.ok === true };
  } catch {
    return { configured: true, applied: false, verified: false };
  }
}

export function createNotificationDeliveryDispatcher(worker, { intervalMs = 15_000 } = {}) {
  let timer = null;
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || running) return [];
    running = true;
    try { return await worker.runOnce({ limit: 20 }); }
    finally { running = false; }
  };
  return {
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { void tick().catch(() => {}); }, intervalMs);
      timer.unref?.();
      setTimeout(() => { void tick().catch(() => {}); }, 1_000).unref?.();
    },
    stop() { stopped = true; if (timer) clearInterval(timer); timer = null; },
    wake() { if (!stopped) setTimeout(() => { void tick().catch(() => {}); }, 0); },
    tick,
  };
}
