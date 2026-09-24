import { Router } from "express";
import QRCode from "qrcode";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { getPool, withTransaction } from "./db.js";
import { ageFromBirthDate, loadBootstrap, loadUsers, resolveBook } from "./data.js";
import { createBootstrapRouter } from "./modules/bootstrap-router.js";
import { groupChatsEnabled } from "./modules/group-chat-feature.js";
import { createReadingSessionsRouter, readingSessionsEnabled } from "./modules/reading-sessions.js";
import { loadReadingStatistics } from "./modules/reading-statistics.js";
import { authorizedReadingPresenceRecipients, createReadingPresenceRouter } from "./modules/reading-presence-router.js";
import { assertMarketplaceAdult, createMarketplaceListingsRouter } from "./modules/marketplace-listings.js";
import { createMarketplaceConversationsRouter } from "./modules/marketplace-conversations.js";
import { createMarketplaceModerationRouter } from "./modules/marketplace-moderation.js";
import { searchBootstrapMaterials } from "./modules/material-search.js";
import { decodeMessageSearchCursor, encodeMessageSearchCursor, messageSearchLimit, messageSearchSnippet, normalizeMessageSearchQuery, MESSAGE_SEARCH_GROUP_LIMIT, MESSAGE_SEARCH_GROUP_MATCH_LIMIT } from "./modules/message-search.js";
import { activeBookSticker, archivedBookSticker, bookStickerCatalog, stickerDto } from "./modules/book-stickers.js";
import { plainTextFromHtml, validateRichHtml } from "./modules/content-security.js";
import { previewRemoteCover, removeMarketplaceImage, saveAvatar, saveCover, saveMarketplaceImage, saveRemoteCover } from "./modules/image-storage.js";
import { cleanUrl, eventPayload, knownCities, knownCity, occasionPayload } from "./modules/material-input.js";
import { createLocationRouter } from "./modules/location-router.js";
import { canCreateFriendRequest, canMessagePair } from "./modules/social-permissions.js";
import { consumeAccountActionToken, createOpaqueActionToken, EMAIL_VERIFICATION_TTL_MINUTES, PASSWORD_RESET_TTL_MINUTES, replaceAccountActionToken } from "./modules/account-tokens.js";
import { sendAccountEmail } from "./modules/mailer.js";
import { authText, requestLocale } from "./modules/i18n.js";
import { enqueueTelegramAlert, shouldEnqueueSupportAlert } from "./modules/telegram-outbox.js";
import { loadPublicCatalog } from "./modules/public-catalog.js";
import { nextTopRank, top3Eligibility } from "./modules/top3.js";
import { LoginAttemptTracker } from "./modules/login-attempts.js";
import { normalizeUsername, usernameStem, usernameValidationError } from "./modules/username.js";
import { normalizeReadingState, postponedOverdue, readingStateStorage, validTimezone } from "./modules/reading-state.js";
import { annualPlan, eligibleGoalPeriods, monthPace, validateGoalPayload } from "./modules/reading-goals.js";
import { expectedProgress, noteBody, noteCursor, noteDto, progressSnapshot, sameProgress } from "./modules/book-progress-notes.js";
import { assertShelfReadable, shelfCursor, shelfDto, shelfPayload, shelvesForUser } from "./modules/book-shelves.js";
import { LEGACY_TELEGRAM_NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORIES, NOTIFICATION_READ_CONFIRMATION_THRESHOLD, canonicalCategoriesForLegacyTelegram, legacyTelegramCategoriesForPreferences, notificationCategoryFor, notificationPreferencesState, validateNotificationPreferencesPayload } from "./modules/notification-preferences.js";
import { cancelNotificationDeliveries, createNotificationEvent } from "./modules/notification-events.js";
import { consumeTelegramLinkToken, createTelegramNotificationAdapter, markTelegramChannelError, replaceTelegramLinkToken, safeTelegramDisplayName, telegramDeepLink, telegramLinkConfiguration, telegramWebhookAuthorized, verifyEmailUnsubscribeToken } from "./modules/notification-channels.js";
import { deliverDuePostponedBookReminders as deliverDuePostponedBooks } from "./modules/postponed-reminders.js";
import { LEGAL_DOCUMENT_TYPES, REQUIRED_LEGAL_DOCUMENT_TYPES, REPORT_STATUSES, REPORT_TARGET_KINDS, activeLegalDocuments, assertAgeCompatible, assertLegalDocumentDeletable, legalAccessState, legalConsentRequired, legalDocumentWriteMode, logModerationAction, logSecurityEvent, profileAccessState, recordLegalAcceptances, removeCrossAgeRelationships, requestAuditMetadata, validateLegalAcceptance } from "./modules/compliance.js";
import { clearSessionCookie, clearTransientCookie, createSessionToken, generateRecoveryCodes, generateTotpSecret, hashPassword, hashRecoveryCode, hashSessionToken, isValidEmail, normalizeEmail, normalizeIdentity, readCookie, recoveryCodeIndex, sessionCookie, transientCookie, verifyPassword, verifyTotp } from "./security.js";

const router = Router();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;
const loginAttempts = new LoginAttemptTracker({ limit: LOGIN_ATTEMPT_LIMIT, windowMs: LOGIN_WINDOW_MS });
const MESSAGE_REACTION_WINDOW_MS = 60 * 1000;
const messageReactionAttempts = new LoginAttemptTracker({ limit: 120, windowMs: MESSAGE_REACTION_WINDOW_MS });
const messageEditAttempts = new LoginAttemptTracker({ limit: 30, windowMs: 60 * 1000 });
const messageSearchAttempts = new LoginAttemptTracker({ limit: 60, windowMs: 60 * 1000 });
const notificationPreferenceAttempts = new LoginAttemptTracker({ limit: 20, windowMs: 60 * 1000 });
const notificationReadAttempts = new LoginAttemptTracker({ limit: 60, windowMs: 60 * 1000 });
const passwordRecoveryAttempts = new Map();
const PASSWORD_RECOVERY_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RECOVERY_LIMIT = 5;
const GOOGLE_CALLBACK_PATH = "/book-meet-return";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_JWKS_FETCH_TIMEOUT_MS = 6_000;
const GOOGLE_JWKS_RETRY_DELAYS_MS = [0, 350, 1_000];
const GOOGLE_JWKS_STALE_MS = 14 * 24 * 60 * 60 * 1000;
const GOOGLE_JWKS_SEED_FILE = path.join(projectRoot, "server", "google-jwks.json");
let googleJwksCache = { expiresAt: 0, savedAt: 0, keys: [] };
let googleJwksRefreshPromise;
// Keep the authenticated owner next to each SSE response.  A bare response
// cannot be used for chat notifications: it would reveal a direct-message
// mutation to every connected account.
const realtimeClients = new Set();
const presenceTouches = new Map();
const PROFILE_TABS = new Set(["main", "author-books", "excerpts", "publisher-news", "library", "wishlist", "reviews", "events", "occasions", "friends", "communities"]);

function deletionDaysRemaining(value) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

async function removeAvatarFile(publicPath) {
  if (!String(publicPath ?? "").startsWith("/uploads/")) return;
  const uploadDirectory = path.resolve(projectRoot, process.env.UPLOAD_DIR || "uploads");
  const target = path.resolve(uploadDirectory, String(publicPath).slice("/uploads/".length));
  if (target !== uploadDirectory && target.startsWith(`${uploadDirectory}${path.sep}`)) {
    await unlink(target).catch((error) => { if (error?.code !== "ENOENT") console.warn("Unable to remove deleted profile avatar", error); });
  }
}

async function purgeDeletedProfile(connection, userId) {
  const [[account]] = await connection.query("SELECT deleted_at, purged_at FROM users WHERE id = ? FOR UPDATE", [userId]);
  if (!account?.deleted_at || account.purged_at) return false;
  const tombstone = `deleted-${userId}-${randomBytes(6).toString("hex")}`;
  await connection.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM account_action_tokens WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM friend_requests WHERE from_user_id = ? OR to_user_id = ?", [userId, userId]);
  await connection.query("DELETE FROM friendships WHERE user_low_id = ? OR user_high_id = ?", [userId, userId]);
  await connection.query("DELETE FROM community_memberships WHERE community_user_id = ? OR member_user_id = ?", [userId, userId]);
  await connection.query("DELETE FROM follows WHERE follower_user_id = ? OR target_user_id = ?", [userId, userId]);
  await connection.query("DELETE FROM user_blocks WHERE blocker_user_id = ? OR blocked_user_id = ?", [userId, userId]);
  await connection.query("DELETE FROM event_reminders WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM wishlist_items WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM reading_sessions WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM user_books WHERE user_id = ? AND is_author = 0", [userId]);
  await connection.query("DELETE FROM reading_cycles WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM reading_goals WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM book_progress_notes WHERE user_id = ?", [userId]);
  const [ownedShelves] = await connection.query("SELECT id FROM book_shelves WHERE owner_user_id = ?", [userId]);
  for (const shelf of ownedShelves) await deleteShelfMaterialRelations(connection, Number(shelf.id));
  await connection.query("DELETE FROM book_shelves WHERE owner_user_id = ?", [userId]);
  await connection.query("DELETE FROM user_hides WHERE hider_user_id = ? OR hidden_user_id = ?", [userId, userId]);
  await connection.query("DELETE FROM material_likes WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM material_saves WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM notifications WHERE user_id = ? OR actor_user_id = ?", [userId, userId]);
  await connection.query("DELETE FROM linked_profiles WHERE personal_user_id = ? OR community_user_id = ?", [userId, userId]);
  await connection.query("UPDATE reports SET reporter_user_id = NULL, reporter_anonymized = 1 WHERE reporter_user_id = ?", [userId]);
  await connection.query("UPDATE report_appeals SET appellant_user_id = NULL WHERE appellant_user_id = ?", [userId]);
  await connection.query(
    `UPDATE profiles SET display_name = 'Удалённый пользователь', city = '', city_id = NULL, gender = 'Не указан', birth_date = NULL,
            show_birth_date_to_friends = 1, birth_date_visibility = 'friends', followers_visibility = 'friends', friends_visibility = 'friends', wishlist_visibility = 'friends', reading_presence_visibility = 'nobody', profile_tab_order = NULL, hidden_profile_tabs = NULL, bio = '', author_influences = '', writing_themes = '', weekend = '', joy = '', talk = '',
            stranger_message = '', favorite_genres = '[]', disliked_genres = '[]', publisher_website = NULL, publisher_sales_links = NULL,
            publisher_legal_name = NULL, publisher_bin = NULL, publisher_account = NULL, publisher_bik = NULL, publisher_bank = NULL,
            publisher_legal_address = NULL, publisher_postal_address = NULL, publisher_moderation_note = NULL, community_type = NULL, community_rules = NULL WHERE user_id = ?`,
    [userId],
  );
  await connection.query(
    `UPDATE users SET username = ?, username_key = ?, email = NULL, email_key = NULL, password_hash = ?, google_subject = NULL,
            telegram_subject = NULL, totp_secret = NULL, totp_pending_secret = NULL, totp_pending_expires_at = NULL,
            totp_recovery_codes = NULL, totp_enabled = 0, initials = '—', avatar_path = NULL,
            profile_completed = 0, deletion_expires_at = NULL, purged_at = UTC_TIMESTAMP(), last_seen_at = NULL WHERE id = ?`,
    [tombstone, tombstone, await hashPassword(randomBytes(32).toString("base64url")), userId],
  );
  await connection.query("INSERT INTO finalized_profile_deletions (user_id, tombstone_key, finalized_at) VALUES (?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE tombstone_key = VALUES(tombstone_key), finalized_at = VALUES(finalized_at)", [userId, hashSessionToken(tombstone)]);
  return true;
}

async function assertAdultMaterialAllowed(connection, userId, isAdult) {
  if (!isAdult) return;
  const [[account]] = await connection.query(
    "SELECT u.role, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?",
    [userId],
  );
  if (account?.role !== "admin" && Number(ageFromBirthDate(account?.birth_date) ?? -1) < 18) {
    throw Object.assign(new Error("Материалы 18+ могут создавать только совершеннолетние пользователи"), { statusCode: 403 });
  }
}

const ADULT_MATERIAL_TABLES = { book: "books", review: "reviews", excerpt: "excerpts", event: "events", occasion: "occasions", publisher_news: "publisher_news" };
async function assertAdultMaterialReadable(connection, userId, kind, materialId) {
  const table = ADULT_MATERIAL_TABLES[kind];
  if (!table || !Number(materialId)) return;
  const [[material]] = await connection.query(`SELECT is_adult FROM ${table} WHERE id = ? LIMIT 1`, [Number(materialId)]);
  if (!material?.is_adult) return;
  const [[account]] = await connection.query(
    "SELECT u.role, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?",
    [userId],
  );
  if (account?.role !== "admin" && Number(ageFromBirthDate(account?.birth_date) ?? -1) < 18) {
    throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
  }
}

function broadcastRealtime() {
  const payload = `event: update\ndata: ${Date.now()}\n\n`;
  for (const client of realtimeClients) {
    try { client.response.write(payload); } catch { realtimeClients.delete(client); }
  }
}

function queueChatRealtime(response, userIds, payload) {
  response.locals.chatRealtime = {
    userIds: [...new Set(userIds.map(Number).filter((userId) => Number.isSafeInteger(userId) && userId > 0))],
    // Do not put text, attachments, stickers, mentions, reaction owners or
    // any authorization facts on the wire.  The client reloads its own social
    // projection and treats this only as an invalidation signal.
    payload,
  };
}

function broadcastChatRealtime({ userIds, payload }) {
  if (!userIds.length) return;
  const recipients = new Set(userIds);
  const event = `event: chat\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of realtimeClients) {
    if (!recipients.has(client.userId)) continue;
    try { client.response.write(event); } catch { realtimeClients.delete(client); }
  }
}

function broadcastReadingRealtime(userId) {
  const event = `event: reading\ndata: ${JSON.stringify({ type: "reading-sessions-changed" })}\n\n`;
  for (const client of realtimeClients) {
    if (client.userId !== userId) continue;
    try { client.response.write(event); } catch { realtimeClients.delete(client); }
  }
}

async function broadcastReadingPresenceRealtime({ readerId, bookId, visibilities }) {
  const connectedUserIds = [...new Set([...realtimeClients].map((client) => client.userId))];
  if (!connectedUserIds.length) return;
  let audience = visibilities;
  if (!audience?.length) {
    const [[profile]] = await getPool().query("SELECT reading_presence_visibility FROM profiles WHERE user_id = ?", [readerId]);
    audience = [profile?.reading_presence_visibility];
  }
  const recipients = new Set(await authorizedReadingPresenceRecipients(getPool(), { readerId, bookId, visibilities: audience, connectedUserIds }));
  if (!recipients.size) return;
  const event = `event: reading-presence\ndata: ${JSON.stringify({ type: "reading-presence-changed" })}\n\n`;
  for (const client of realtimeClients) {
    if (!recipients.has(client.userId)) continue;
    try { client.response.write(event); } catch { realtimeClients.delete(client); }
  }
}

async function deliverDueEventReminders() {
  try {
    const delivered = await withTransaction(async (connection) => {
      const [candidates] = await connection.query(
        `SELECT er.user_id, e.id AS event_id, e.creator_user_id, e.title
           FROM event_reminders er
           JOIN events e ON e.id = er.event_id
          WHERE er.reminded_at IS NULL
            AND e.status = 'published'
            AND TIMESTAMP(e.event_date, e.event_time) > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 HOUR)
            AND TIMESTAMP(e.event_date, e.event_time) <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 29 HOUR)
          FOR UPDATE`,
      );
      let created = 0;
      for (const candidate of candidates) {
        const result = await createNotificationEvent(connection, {
          recipientUserId: candidate.user_id,
          actorUserId: candidate.creator_user_id,
          eventType: "event_reminder",
          title: "Событие уже завтра",
          body: `Через 24 часа начнётся событие «${candidate.title}».`,
          materialKind: "event",
          materialId: candidate.event_id,
          dedupeKey: `event-reminder:${candidate.user_id}:${candidate.event_id}`,
          groupKey: `event-reminder:${candidate.user_id}:${candidate.event_id}`,
        });
        if (result.created) created += 1;
      }
      await connection.query(
        `UPDATE event_reminders er
           JOIN events e ON e.id = er.event_id
            SET er.reminded_at = UTC_TIMESTAMP()
          WHERE er.reminded_at IS NULL
            AND e.status = 'published'
            AND TIMESTAMP(e.event_date, e.event_time) > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 HOUR)
            AND TIMESTAMP(e.event_date, e.event_time) <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 29 HOUR)`,
      );
      return created;
    });
    if (delivered) broadcastRealtime();
  } catch (error) {
    console.warn("Не удалось проверить напоминания о событиях:", error.message);
  }
}

async function deliverDuePostponedBookReminders() {
  try { return await deliverDuePostponedBooks({ withTransaction, broadcast: broadcastRealtime }); } catch (error) { console.warn("Не удалось проверить отложенные книги:", error.message); return 0; }
}

const reminderTimer = setInterval(deliverDueEventReminders, 5 * 60 * 1000);
reminderTimer.unref?.();
setTimeout(deliverDueEventReminders, 15_000).unref?.();
if (process.env.NODE_ENV !== "test") {
  const postponedBookReminderTimer = setInterval(deliverDuePostponedBookReminders, 60 * 1000);
  postponedBookReminderTimer.unref?.();
  setTimeout(deliverDuePostponedBookReminders, 20_000).unref?.();
}

async function purgeExpiredDeletedProfiles() {
  try {
    const [rows] = await getPool().query(
      "SELECT id FROM users WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND deletion_expires_at <= UTC_TIMESTAMP() LIMIT 100",
    );
    for (const row of rows) await withTransaction((connection) => purgeDeletedProfile(connection, Number(row.id)));
  } catch (error) {
    console.warn("Не удалось удалить профили с истёкшим сроком хранения:", error.message);
  }
}

const deletedProfileCleanupTimer = setInterval(purgeExpiredDeletedProfiles, 6 * 60 * 60 * 1000);
deletedProfileCleanupTimer.unref?.();
setTimeout(purgeExpiredDeletedProfiles, 30_000).unref?.();

async function enforceAgeBoundaries() {
  try {
    const removed = await withTransaction((connection) => removeCrossAgeRelationships(connection));
    if (removed) console.warn(`Удалено несовместимых по возрасту дружеских связей: ${removed}`);
  } catch (error) {
    console.warn("Не удалось выполнить аудит возрастных границ:", error.message);
  }
}

const ageBoundaryTimer = setInterval(enforceAgeBoundaries, 24 * 60 * 60 * 1000);
ageBoundaryTimer.unref?.();
setTimeout(enforceAgeBoundaries, 45_000).unref?.();

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function messageReactionRateLimit(request, response, next) {
  const client = request.ip || request.socket.remoteAddress || "unknown";
  const userId = Number(request.bookMeetUser?.id);
  const attempt = messageReactionAttempts.state([`message-reaction:ip:${client}`, `message-reaction:user:${userId}`]);
  if (attempt.blocked) {
    response.setHeader("Retry-After", String(attempt.retryAfterSeconds));
    return response.status(429).json({ code: "MESSAGE_REACTION_RATE_LIMITED", error: "Слишком много реакций. Попробуйте позже" });
  }
  attempt.fail();
  next();
}

function messageEditRateLimit(request, response, next) {
  const client = request.ip || request.socket.remoteAddress || "unknown";
  const userId = Number(request.bookMeetUser?.id);
  const attempt = messageEditAttempts.state([`message-edit:ip:${client}`, `message-edit:user:${userId}`]);
  if (attempt.blocked) {
    response.setHeader("Retry-After", String(attempt.retryAfterSeconds));
    return response.status(429).json({ code: "MESSAGE_EDIT_RATE_LIMITED", error: "Слишком много изменений. Попробуйте позже" });
  }
  attempt.fail();
  next();
}

function messageSearchRateLimit(request, response, next) {
  const client = request.ip || request.socket.remoteAddress || "unknown";
  const userId = Number(request.bookMeetUser?.id);
  const attempt = messageSearchAttempts.state([`message-search:ip:${client}`, `message-search:user:${userId}`]);
  if (attempt.blocked) {
    response.setHeader("Retry-After", String(attempt.retryAfterSeconds));
    return response.status(429).json({ code: "MESSAGE_SEARCH_RATE_LIMITED", error: "Слишком много поисковых запросов. Попробуйте позже" });
  }
  attempt.fail();
  next();
}

function notificationRateLimit(tracker, code, message) {
  return (request, response, next) => {
    const client = request.ip || request.socket.remoteAddress || "unknown";
    const userId = Number(request.bookMeetUser?.id);
    const attempt = tracker.state([`${code}:ip:${client}`, `${code}:user:${userId}`]);
    if (attempt.blocked) {
      response.setHeader("Retry-After", String(attempt.retryAfterSeconds));
      return response.status(429).json({ code, error: message });
    }
    attempt.fail();
    next();
  };
}

const notificationPreferenceRateLimit = notificationRateLimit(notificationPreferenceAttempts, "NOTIFICATION_PREFERENCES_RATE_LIMITED", "Слишком много изменений настроек. Попробуйте позже");
const notificationReadRateLimit = notificationRateLimit(notificationReadAttempts, "NOTIFICATION_READ_RATE_LIMITED", "Слишком много операций с уведомлениями. Попробуйте позже");

function loginAttemptState(request, email) {
  const client = request.ip || request.socket.remoteAddress || "unknown";
  return loginAttempts.state([`ip:${client}`, `identity:${normalizeEmail(email)}`]);
}

async function createSession(connection, userId, request = null, operatorUserId = userId) {
  const { token, tokenHash } = createSessionToken();
  const [[account]] = await connection.query("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  const sessionDays = account?.role === "admin"
    ? Math.max(1 / 24, Number(process.env.ADMIN_SESSION_HOURS || 12) / 24)
    : Math.max(1, Number(process.env.SESSION_DAYS || 7));
  const { ipHash, userAgentHash } = request ? requestAuditMetadata(request) : { ipHash: null, userAgentHash: null };
  await connection.query("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()");
  await connection.query(
    "INSERT INTO sessions (token_hash, user_id, operator_user_id, expires_at, last_seen_at, ip_hash, user_agent_hash) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP(), ?, ?)",
    [tokenHash, userId, operatorUserId, Math.max(60, Math.round(sessionDays * 86400)), ipHash, userAgentHash],
  );
  return token;
}

function appOrigin() {
  return new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin;
}

function accountActionLink(parameter, token) {
  const url = new URL(appOrigin());
  url.searchParams.set(parameter, token);
  return url.toString();
}

function passwordRecoveryAllowed(request, email) {
  const now = Date.now();
  const client = request.ip || request.socket.remoteAddress || "unknown";
  const keys = [`ip:${client}`, `email:${email}`];
  const buckets = keys.map((key) => {
    const current = passwordRecoveryAttempts.get(key);
    const next = !current || current.resetAt <= now ? { count: 0, resetAt: now + PASSWORD_RECOVERY_WINDOW_MS } : current;
    passwordRecoveryAttempts.set(key, next);
    return next;
  });
  if (buckets.some((bucket) => bucket.count >= PASSWORD_RECOVERY_LIMIT)) return false;
  for (const bucket of buckets) bucket.count += 1;
  return true;
}

async function sendVerificationEmail(email, token, locale = "ru") {
  const link = accountActionLink("verify", token);
  return sendAccountEmail({
    to: email,
    subject: authText(locale, "verificationSubject"),
    text: authText(locale, "verificationText", { link }),
  });
}

async function sendPasswordResetEmail(email, token, locale = "ru") {
  const link = accountActionLink("reset", token);
  return sendAccountEmail({
    to: email,
    subject: authText(locale, "resetSubject"),
    text: authText(locale, "resetText", { link }),
  });
}

async function sendGoogleAccountEmail(email, created = false, locale = "ru") {
  return sendAccountEmail({
    to: email,
    subject: authText(locale, created ? "googleCreatedSubject" : "googleRecoverySubject"),
    text: authText(locale, created ? "googleCreatedText" : "googleRecoveryText"),
  });
}

function googleJwksCachePath() {
  const uploadDirectory = path.resolve(projectRoot, process.env.UPLOAD_DIR || "uploads");
  return {
    directory: uploadDirectory,
    file: path.join(uploadDirectory, ".google-jwks-cache.json"),
  };
}

function validGoogleKeyCache(value) {
  if (!value || !Array.isArray(value.keys) || value.keys.length === 0) return null;
  const keys = value.keys.filter((key) => key && key.kty === "RSA" && key.kid && key.n && key.e);
  if (!keys.length) return null;
  return {
    expiresAt: Number(value.expiresAt) || 0,
    savedAt: Number(value.savedAt) || 0,
    keys,
  };
}

async function readGoogleKeyCache() {
  try {
    const cached = validGoogleKeyCache(JSON.parse(await readFile(googleJwksCachePath().file, "utf8")));
    if (cached) googleJwksCache = cached;
    return cached;
  } catch {
    return null;
  }
}

async function readBundledGoogleKeyCache() {
  try {
    const value = JSON.parse(await readFile(GOOGLE_JWKS_SEED_FILE, "utf8"));
    const cached = validGoogleKeyCache(value);
    if (!cached) return null;
    const seeded = {
      ...cached,
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      savedAt: Number(value.savedAt) || Date.now(),
    };
    googleJwksCache = seeded;
    return seeded;
  } catch {
    return null;
  }
}

async function writeGoogleKeyCache(value) {
  const { directory, file } = googleJwksCachePath();
  const temporaryFile = `${file}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryFile, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryFile, file);
  } catch (error) {
    console.warn("Could not persist Google JWKS cache", error);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestJsonOverIpv4(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      family: 4,
      headers: { accept: "application/json", "user-agent": "BookMeet/1.0" },
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) {
          request.destroy(new Error("Google JWKS response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Google JWKS returned ${response.statusCode || 0}`));
          return;
        }
        try {
          resolve({
            value: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            cacheControl: String(response.headers["cache-control"] || ""),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("Google JWKS IPv4 request timed out"), { name: "TimeoutError" })));
    request.on("error", reject);
  });
}

async function requestGoogleVerificationKeys() {
  let lastError;
  for (const retryDelay of GOOGLE_JWKS_RETRY_DELAYS_MS) {
    if (retryDelay) await delay(retryDelay);
    try {
      const { value, cacheControl } = await requestJsonOverIpv4(GOOGLE_JWKS_URL, GOOGLE_JWKS_FETCH_TIMEOUT_MS);
      const keys = validGoogleKeyCache({ keys: value.keys });
      if (!keys) throw new Error("Google JWKS response has no usable RSA keys");
      const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
      const cached = {
        expiresAt: Date.now() + Math.max(300, maxAge) * 1000,
        savedAt: Date.now(),
        keys: keys.keys,
      };
      googleJwksCache = cached;
      await writeGoogleKeyCache(cached);
      return cached.keys;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Google JWKS request failed");
}

async function googleVerificationKeys(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && googleJwksCache.expiresAt > now && googleJwksCache.keys.length) return googleJwksCache.keys;

  if (!googleJwksCache.keys.length) {
    const persisted = await readGoogleKeyCache();
    if (!persisted) await readBundledGoogleKeyCache();
  }
  if (!forceRefresh && googleJwksCache.expiresAt > Date.now() && googleJwksCache.keys.length) return googleJwksCache.keys;

  if (!googleJwksRefreshPromise) {
    googleJwksRefreshPromise = requestGoogleVerificationKeys().finally(() => {
      googleJwksRefreshPromise = undefined;
    });
  }

  try {
    return await googleJwksRefreshPromise;
  } catch (error) {
    const cached = googleJwksCache.keys.length ? googleJwksCache : await readGoogleKeyCache();
    if (cached?.keys.length && cached.savedAt > Date.now() - GOOGLE_JWKS_STALE_MS) {
      console.warn("Using stale Google JWKS cache after refresh failure", error);
      return cached.keys;
    }
    throw error;
  }
}

async function verifyGoogleIdToken(credential) {
  const parts = String(credential).split(".");
  if (parts.length !== 3) throw new Error("Malformed Google ID token");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported Google token signature");
  let keys = await googleVerificationKeys();
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    keys = await googleVerificationKeys(true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw new Error("Google signing key not found");
  const validSignature = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(parts[2], "base64url"),
  );
  if (!validSignature) throw new Error("Invalid Google token signature");
  const now = Math.floor(Date.now() / 1000);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("Invalid Google token issuer");
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("Invalid Google token audience");
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now) throw new Error("Expired Google token");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("Unverified Google email");
  if (!claims.sub || !claims.email) throw new Error("Incomplete Google identity");
  return claims;
}

function safeProfileName(value, fallback) {
  return String(value || fallback || "Новый читатель").trim().slice(0, 120);
}

async function uniqueInternalUsername(connection, baseValue) {
  const cleaned = usernameStem(baseValue);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix ? `${cleaned.slice(0, 30 - String(suffix).length - 1)}-${suffix}` : cleaned;
    const [[existing]] = await connection.query("SELECT id FROM users WHERE username_key = ? LIMIT 1", [candidate]);
    if (!existing) return candidate;
  }
  return `reader-${Date.now().toString().slice(-12)}`;
}

async function findOrCreateGoogleUser(identity, { legalAcceptance = null, locale = "ru" } = {}) {
  return withTransaction(async (connection) => {
    const subjectColumn = "google_subject";
    const [[bySubject]] = await connection.query(`SELECT id FROM users WHERE ${subjectColumn} = ? LIMIT 1`, [identity.subject]);
    let account = bySubject;
    if (!account && identity.email) {
      [[account]] = await connection.query("SELECT id FROM users WHERE email_key = ? LIMIT 1", [normalizeEmail(identity.email)]);
    }
    if (account) {
      await connection.query(
        `UPDATE users SET ${subjectColumn} = COALESCE(${subjectColumn}, ?), email = COALESCE(email, ?), email_key = COALESCE(email_key, ?) WHERE id = ?`,
        [identity.subject, identity.email || null, identity.email ? normalizeEmail(identity.email) : null, account.id],
      );
      return { userId: Number(account.id), created: false, email: identity.email || "" };
    }
    const legalDocuments = await validateLegalAcceptance(connection, legalAcceptance, locale);
    const displayName = safeProfileName(identity.name, identity.username);
    const username = await uniqueInternalUsername(connection, identity.email?.split("@")[0] || identity.username || "google-reader");
    const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU").slice(0, 4) || "BM";
    const colors = ["navy", "blue", "green", "red", "gold"];
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    const [created] = await connection.query(
      `INSERT INTO users (username, username_key, username_is_temporary, email, email_key, email_verified_at, password_hash, password_login_enabled, ${subjectColumn}, initials, color, role, profile_completed)
       VALUES (?, ?, 1, ?, ?, UTC_TIMESTAMP(), ?, 0, ?, ?, ?, 'user', 0)`,
      [username, username, identity.email || null, identity.email ? normalizeEmail(identity.email) : null, passwordHash, identity.subject, initials, colors[Date.now() % colors.length]],
    );
    const userId = Number(created.insertId);
    await connection.query(
      `INSERT INTO profiles (user_id, display_name, city, city_id, profile_type, gender, bio, author_influences, writing_themes, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres)
       VALUES (?, ?, '', NULL, 'Читатель', 'Не указан', '', '', '', '', '', '', '', '[]', '[]')`,
      [userId, displayName],
    );
    await recordLegalAcceptances(connection, userId, legalDocuments);
    return { userId, created: true, email: identity.email || "" };
  });
}

async function authenticatedUser(request) {
  const token = readCookie(request);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const [[user]] = await getPool().query(
    `SELECT u.id, u.username, u.role, u.preferred_locale, u.suspension_reason, u.suspended_until, u.suspended_permanently, s.operator_user_id,
            u.deleted_at, u.deletion_expires_at, u.purged_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`, [tokenHash],
  );
  if (!user) return null;
  const userId = Number(user.id);
  const now = Date.now();
  if (now - (presenceTouches.get(userId) ?? 0) >= 30_000) {
    await getPool().query("UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [userId]);
    await getPool().query("UPDATE sessions SET last_seen_at = UTC_TIMESTAMP() WHERE token_hash = ?", [tokenHash]);
    presenceTouches.set(userId, now);
  }
  if (!user.suspended_permanently && user.suspended_until && new Date(user.suspended_until).getTime() <= Date.now()) {
    await getPool().query("UPDATE users SET suspension_reason = NULL, suspended_until = NULL WHERE id = ?", [userId]);
    user.suspended_until = null;
    user.suspension_reason = null;
  }
  return {
    id: userId, username: user.username, tokenHash, role: user.role, operatorUserId: Number(user.operator_user_id ?? userId), locale: user.preferred_locale || "ru",
    deletedProfile: Boolean(user.deleted_at && !user.purged_at),
    deletionExpiresAt: user.deletion_expires_at ? new Date(user.deletion_expires_at).toISOString() : null,
    purged: Boolean(user.purged_at),
    suspension: user.suspended_permanently || user.suspended_until ? {
      permanent: Boolean(user.suspended_permanently),
      until: user.suspended_until ? new Date(user.suspended_until).toISOString() : null,
      reason: user.suspension_reason ?? "",
    } : null,
  };
}

async function requireUser(request, response, next) {
  const user = await authenticatedUser(request);
  if (!user) return response.status(401).json({ error: "Требуется вход" });
  if (user.deletedProfile || user.purged) return response.status(410).json({ deletedProfile: true, purged: user.purged, daysRemaining: deletionDaysRemaining(user.deletionExpiresAt) });
  if (user.suspension) return response.status(423).json({ suspended: true, ...user.suspension });
  request.bookMeetUser = user;
  next();
}

function normalizeIsbn(value) {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized.length === 10 || normalized.length === 13 ? normalized : "";
}

export function marketplaceFromUrl(value) {
  const normalizedUrl = cleanUrl(value);
  if (!normalizedUrl) throw Object.assign(new Error("Укажите ссылку Flip.kz"), { statusCode: 400, code: "INVALID_URL" });
  const url = new URL(normalizedUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "flip.kz" || host.endsWith(".flip.kz")) return { name: "Flip", url };
  throw Object.assign(new Error("Поддерживаются только ссылки Flip.kz"), { statusCode: 400 });
}

export function bookSourceFromUrl(value) {
  const normalizedUrl = cleanUrl(value);
  if (!normalizedUrl) throw Object.assign(new Error("Укажите ссылку на книгу"), { statusCode: 400, code: "INVALID_URL" });
  const url = new URL(normalizedUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "flip.kz" || host.endsWith(".flip.kz")) return { name: "Flip", url, suggestedAction: "Купить" };
  if (host === "meloman.kz" || host.endsWith(".meloman.kz") || host === "marwin.kz" || host.endsWith(".marwin.kz")) return { name: "Marwin/Меломан", url, suggestedAction: "Купить" };
  if (host === "books.yandex.kz" || host.endsWith(".books.yandex.kz")) {
    const audio = /(?:audio|audiobook|audiobooks|listen)/i.test(url.pathname + url.search);
    return { name: "Яндекс.Книги", url, suggestedAction: audio ? "Слушать" : "Читать" };
  }
  throw Object.assign(new Error("Поддерживаются ссылки Flip, Marwin/Меломан и Яндекс.Книги"), { statusCode: 400 });
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  const decoded = decodeHtml(value);
  return decodeHtml(decoded.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "));
}

function withoutAuthorPrefix(value, author) {
  const title = decodeHtml(value);
  const match = title.match(/^(.+?)\s*:\s*(.+)$/);
  if (!match || !author) return title;
  const comparable = (part) => decodeHtml(part).normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[\s.,;:()[\]{}'"’`-]+/g, "");
  return comparable(match[1]) === comparable(author) ? match[2].trim() : title;
}

function marwinDescriptionFromHtml(html) {
  return html.match(/class=["']product attribute description["'][^>]*>[\s\S]*?<div[^>]+class=["'][^"']*\bvalue\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]+class=["']product_rate["'])/i)?.[1] ?? "";
}

function productAttributeFromHtml(html, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<td[^>]+data-th=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/td>`, "i"),
      new RegExp(`<th[^>]*>\\s*${escaped}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i"),
      new RegExp(`<div[^>]+class=["'][^"']*\\bcell\\b[^"']*["'][^>]*>\\s*${escaped}\\s*<\\/div>\\s*<div[^>]+class=["'][^"']*\\bcell\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i"),
      new RegExp(`<[^>]+class=["'][^"']*(?:label|name)[^"']*["'][^>]*>\\s*${escaped}\\s*<\\/[^>]+>\\s*<[^>]+class=["'][^"']*(?:value|data)[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
      new RegExp(`["']${escaped}["']\\s*:\\s*["']([^"']+)`, "i"),
    ];
    const value = patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean);
    if (value) return stripHtml(value);
  }
  return "";
}

function structuredName(value) {
  if (Array.isArray(value)) return value.map(structuredName).filter(Boolean).join(", ");
  if (value && typeof value === "object") return decodeHtml(value.name ?? "");
  return decodeHtml(value);
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  return decodeHtml(patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean));
}

function embeddedCoverUrl(html) {
  const raw = html.match(/["'](?:coverUrl|cover_url|coverUri|cover_uri|imageUrl|image_url|thumbnail)["']\s*:\s*["']([^"']+)/i)?.[1] ?? "";
  const decoded = decodeHtml(raw.replace(/\\u002f/gi, "/").replace(/\\\//g, "/"));
  if (decoded.startsWith("//")) return `https:${decoded}`;
  return decoded;
}

function bookProductFromHtml(html, source) {
  let product = null;
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const candidates = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      product = candidates.find((item) => {
        const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
        return types.includes("Product") || types.includes("Book");
      }) ?? product;
    } catch { /* Stores may include unrelated non-product JSON-LD blocks. */ }
  }
  const pageTitle = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const socialTitle = metaContent(html, "og:title");
  const marwinTitleRaw = source.name === "Marwin/Меломан" ? stripHtml(html.match(/<span[^>]+data-ui-id=["']page-title-wrapper["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]) : "";
  const marwinAuthor = source.name === "Marwin/Меломан" ? stripHtml(html.match(/<td[^>]+data-th=["']Автор["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]) : "";
  const rawTitle = marwinTitleRaw || product?.name || socialTitle || pageTitle.split(/\s+[—|]\s+/)[0];
  const titleWithPrefix = decodeHtml(rawTitle)
    .replace(/^(?:Купить|Читать|Слушать)\s+(?:книгу|аудиокнигу)\s+/i, "")
    .replace(/\s+(?:в интернет-магазине.*|[-—|]\s*(?:Flip|Marwin|Меломан|Яндекс(?:\.Книги| Книги)).*)$/i, "");
  const title = withoutAuthorPrefix(titleWithPrefix, marwinAuthor);
  const structuredAuthor = Array.isArray(product?.author) ? product.author[0]?.name ?? product.author[0] : product?.author?.name ?? product?.author;
  const embeddedAuthor = html.match(/["']authors?["']\s*:\s*(?:\[\s*\{\s*)?["'](?:name|title)["']\s*:\s*["']([^"']+)/i)?.[1]
    ?? html.match(/["']author["']\s*:\s*["']([^"']+)/i)?.[1];
  const titleParts = pageTitle.split(/\s+[—|]\s+/).map(decodeHtml);
  const author = decodeHtml(marwinAuthor || structuredAuthor || metaContent(html, "book:author") || embeddedAuthor || (titleParts[0] === title ? titleParts[1] : ""));
  const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  const structuredImage = Array.isArray(product?.image) ? product.image[0] : product?.image;
  const rawImage = (typeof structuredImage === "object" ? structuredImage?.url || structuredImage?.contentUrl : structuredImage)
    || metaContent(html, "og:image:secure_url")
    || metaContent(html, "og:image")
    || metaContent(html, "twitter:image")
    || decodeHtml(html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/i)?.[1])
    || embeddedCoverUrl(html);
  const price = Number(offers?.price);
  const isbn = normalizeIsbn(
    product?.isbn || product?.isbn13 || product?.isbn10 || product?.gtin13 || product?.gtin
    || productAttributeFromHtml(html, ["ISBN", "ISBN-13", "ISBN 13", "Штрихкод"]),
  );
  const publisher = structuredName(product?.publisher)
    || productAttributeFromHtml(html, ["Издательство", "Издатель"]);
  if (!title || !author) throw Object.assign(new Error(`Не удалось определить название и автора книги на ${source.name}`), { statusCode: 422 });
  return {
    marketplace: source.name,
    productUrl: source.url.toString(),
    title,
    author,
    isbn: isbn || undefined,
    publisher: publisher || undefined,
    annotation: stripHtml(product?.description || (source.name === "Marwin/Меломан" ? marwinDescriptionFromHtml(html) : "") || metaContent(html, "description") || metaContent(html, "og:description")),
    coverUrl: rawImage ? cleanUrl(String(rawImage).startsWith("//") ? `https:${rawImage}` : rawImage) : "",
    price: Number.isFinite(price) && price > 0 ? price : null,
    currency: String(offers?.priceCurrency || "KZT"),
    suggestedAction: source.suggestedAction,
  };
}

export async function fetchBookProduct(productUrl, flipOnly = false) {
  const source = flipOnly ? { ...marketplaceFromUrl(productUrl), suggestedAction: "Купить" } : bookSourceFromUrl(productUrl);
  let currentUrl = source.url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8500);
  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const result = await fetch(currentUrl, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 BookMeet/1.0", "accept-language": "ru-KZ,ru;q=0.9" } });
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        const location = result.headers.get("location");
        if (!location || redirect === 3) throw Object.assign(new Error("Слишком много перенаправлений книжного источника"), { statusCode: 502 });
        const redirected = flipOnly ? { ...marketplaceFromUrl(new URL(location, currentUrl)), suggestedAction: "Купить" } : bookSourceFromUrl(new URL(location, currentUrl));
        if (redirected.name !== source.name) throw Object.assign(new Error("Книжный источник перенаправил запрос на другой сайт"), { statusCode: 400 });
        currentUrl = redirected.url;
        continue;
      }
      if (!result.ok) throw Object.assign(new Error(`${source.name} не вернул карточку книги`), { statusCode: 502 });
      const maximumHtmlBytes = 5 * 1024 * 1024;
      if (Number(result.headers.get("content-length") || 0) > maximumHtmlBytes) throw Object.assign(new Error("Карточка книги слишком большая"), { statusCode: 502 });
      const html = await result.text();
      if (Buffer.byteLength(html, "utf8") > maximumHtmlBytes) throw Object.assign(new Error("Карточка книги слишком большая"), { statusCode: 502 });
      return bookProductFromHtml(html, { ...source, url: currentUrl });
    }
    throw Object.assign(new Error("Не удалось получить карточку книги"), { statusCode: 502 });
  } catch (error) {
    if (error?.statusCode) throw error;
    console.warn(`Не удалось получить карточку ${source.name}`, error?.message ?? error);
    throw Object.assign(new Error(`Не удалось получить данные книги с ${source.name}. Проверьте ссылку и попробуйте ещё раз`), { statusCode: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

const fetchFlipProduct = (productUrl) => fetchBookProduct(productUrl, true);

function validatedBookLinks(value, restricted) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 3).filter((link) => link?.label?.trim() && link?.url?.trim()).map((link) => {
    const action = ["Купить", "Читать", "Слушать"].includes(link.action) ? link.action : "Читать";
    const url = cleanUrl(link.url);
    let label = String(link.label).trim();
    if (restricted) {
      const source = bookSourceFromUrl(url);
      if (action === "Купить" && !["Flip", "Marwin/Меломан"].includes(source.name)) {
        throw Object.assign(new Error("Для покупки поддерживаются только Flip и Marwin/Меломан"), { statusCode: 400 });
      }
      if ((action === "Читать" || action === "Слушать") && source.name !== "Яндекс.Книги") {
        throw Object.assign(new Error("Для чтения и прослушивания поддерживаются только Яндекс.Книги"), { statusCode: 400 });
      }
      label = action === "Купить" ? source.name : "Яндекс.Книги";
    }
    return { action, label, url };
  });
}

async function nextNotificationOccurrence(connection, { recipientUserId, actorUserId = null, eventType, materialKind = null, materialId = null }) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS total FROM notification_events
      WHERE recipient_user_id = ? AND actor_user_id <=> ? AND event_type = ?
        AND material_kind <=> ? AND material_id <=> ?`,
    [recipientUserId, actorUserId, eventType, materialKind, materialId],
  );
  return Number(row.total) + 1;
}

async function notifyWriterAboutBook(connection, bookId, actorId, action, occurrenceId = null) {
  const [[book]] = await connection.query("SELECT creator_user_id, title FROM books WHERE id = ?", [bookId]);
  if (!book?.creator_user_id || Number(book.creator_user_id) === Number(actorId)) return;
  const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [actorId]);
  const titles = { library: "Книгу добавили в библиотеку", wishlist: "Книгу хотят прочитать", review: "На книгу написали рецензию" };
  const verbs = { library: "добавил(а) вашу книгу в библиотеку", wishlist: "добавил(а) вашу книгу в список «Хочу почитать!»", review: "написал(а) рецензию на вашу книгу" };
  const baseKey = `author-book:${action}:${bookId}:${actorId}`;
  const occurrence = occurrenceId ?? `g${await nextNotificationOccurrence(connection, {
    recipientUserId: book.creator_user_id,
    actorUserId: actorId,
    eventType: "author_book_activity",
    materialKind: "book",
    materialId: bookId,
  })}`;
  const key = `${baseKey}:${occurrence}`;
  await createNotificationEvent(connection, {
    recipientUserId: book.creator_user_id,
    actorUserId: actorId,
    eventType: "author_book_activity",
    title: titles[action],
    body: `${actor?.display_name ?? "Пользователь"} ${verbs[action]} «${book.title}».`,
    materialKind: "book",
    materialId: bookId,
    dedupeKey: key,
    groupKey: baseKey,
  });
}

async function isAdmin(connection, userId) {
  const [[user]] = await connection.query("SELECT role FROM users WHERE id = ?", [userId]);
  return user?.role === "admin";
}

async function linkedBookPreviews(connection, ids) {
  const cleanIds = Array.from(new Set((ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))).slice(0, 50);
  if (!cleanIds.length) return [];
  const [rows] = await connection.query(
    `SELECT id, title, author, annotation, cover_path, cover_tone
       FROM books WHERE id IN (${cleanIds.map(() => "?").join(",")})`,
    cleanIds,
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  if (byId.size !== cleanIds.length) throw Object.assign(new Error("Одна из выбранных книг не найдена"), { statusCode: 400 });
  return cleanIds.map((id) => { const row = byId.get(id); return { id, title: row.title, author: row.author, annotation: row.annotation ?? "", coverUrl: row.cover_path ?? undefined, coverTone: row.cover_tone ?? "blue" }; });
}

async function syncMaterialBooks(connection, materialKind, materialId, ids) {
  const books = await linkedBookPreviews(connection, ids);
  await connection.query("DELETE FROM material_books WHERE material_kind = ? AND material_id = ?", [materialKind, materialId]);
  for (let position = 0; position < books.length; position += 1) {
    await connection.query("INSERT INTO material_books (material_kind, material_id, book_id, position) VALUES (?, ?, ?, ?)", [materialKind, materialId, books[position].id, position]);
  }
  return books;
}

async function blockExists(connection, firstUserId, secondUserId) {
  const [[row]] = await connection.query(
    `SELECT blocker_user_id, blocked_user_id FROM user_blocks
      WHERE (blocker_user_id = ? AND blocked_user_id = ?)
         OR (blocker_user_id = ? AND blocked_user_id = ?)
      LIMIT 1`,
    [firstUserId, secondUserId, secondUserId, firstUserId],
  );
  return row ?? null;
}

async function hideExists(connection, hiderUserId, hiddenUserId) {
  const [[row]] = await connection.query(
    "SELECT 1 FROM user_hides WHERE hider_user_id = ? AND hidden_user_id = ? LIMIT 1",
    [hiderUserId, hiddenUserId],
  );
  return Boolean(row);
}

async function assertCommentTargetAvailable(connection, viewerId, commentUserId) {
  const targetId = Number(commentUserId);
  const [[target]] = await connection.query(
    "SELECT id, deleted_at, purged_at FROM users WHERE id = ? LIMIT 1",
    [targetId],
  );
  if (!target || target.deleted_at || target.purged_at) {
    throw Object.assign(new Error("Комментарий не найден"), { statusCode: 404 });
  }
  if (targetId !== Number(viewerId) && (await blockExists(connection, viewerId, targetId) || await hideExists(connection, viewerId, targetId))) {
    throw Object.assign(new Error("Комментарий не найден"), { statusCode: 404 });
  }
}

function codePointText(value, maximum, label) {
  const text = String(value ?? "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  const length = Array.from(text).length;
  if (!text || length > maximum) throw Object.assign(new Error(`${label} должен содержать от 1 до ${maximum} символов`), { statusCode: 400 });
  return text;
}

function escapedParagraph(value) {
  const text = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  return validateRichHtml(`<p>${text.replace(/\n/g, "<br>")}</p>`);
}

function mentionIds(value) {
  const raw = Array.isArray(value) ? value : Array.isArray(value?.userIds) ? value.userIds : [];
  return [...new Set(raw.map((entry) => Number(typeof entry === "object" ? entry.userId ?? entry.id : entry)).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 30);
}

function mentionRefs(value) {
  const raw = Array.isArray(value) ? value : Array.isArray(value?.userIds) ? value.userIds : [];
  const seen = new Set();
  return raw.map((entry) => typeof entry === "object" ? entry : { userId: entry }).map((entry) => ({ userId: Number(entry.userId ?? entry.id), token: typeof entry.token === "string" ? entry.token.trim() : "" })).filter((entry) => Number.isInteger(entry.userId) && entry.userId > 0 && !seen.has(entry.userId) && (seen.add(entry.userId), true)).slice(0, 30);
}

const NEUTRAL_MENTION_TOKEN = "@пользователь";

function neutralizeMentionedText(value, mentions = []) {
  let result = String(value ?? "");
  let cursor = 0;
  const replacements = mentions.map((mention) => {
    const sourceToken = String(mention.sourceToken ?? "");
    const replacementToken = String(mention.token ?? NEUTRAL_MENTION_TOKEN);
    return { sourceToken, replacementToken, index: sourceToken ? result.indexOf(sourceToken) : -1 };
  }).filter((entry) => entry.index >= 0 && entry.sourceToken && entry.replacementToken && entry.sourceToken !== entry.replacementToken)
    .sort((left, right) => left.index - right.index);
  for (const { sourceToken, replacementToken } of replacements) {
    const index = result.indexOf(sourceToken, cursor);
    if (index < 0) continue;
    result = `${result.slice(0, index)}${replacementToken}${result.slice(index + sourceToken.length)}`;
    cursor = index + replacementToken.length;
  }
  return result;
}

function normalizeMessageBody(value) {
  const normalized = String(value ?? "").replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "").trim();
  return Array.from(normalized).slice(0, 5000).join("");
}

const DELETED_MESSAGE_TOMBSTONE = "Пользователь удалил это сообщение";

async function syncMentions(connection, { entityType, entityId, authorUserId, mentionUserIds, text = "", publicMaterial = false, materialKind, materialId }) {
  // Structured refs are authoritative, but a stale ref must not create a
  // relation or notification after its token was removed from the content.
  // We only check already-selected tokens; arbitrary @words are never parsed.
  // Callers provide the exact plain fields plus plainTextFromHtml(bodyHtml)
  // for rich materials. Do not parse a composite string here: a literal `<`
  // in a title/preview would otherwise be treated as markup and disappear.
  const mentionableText = String(text ?? "");
  const refs = mentionRefs(mentionUserIds).filter((entry) => entry.userId !== Number(authorUserId) && /^@[\w.-]{1,30}$/u.test(entry.token) && mentionableText.includes(entry.token));
  await connection.query("DELETE FROM content_mentions WHERE entity_type = ? AND entity_id = ?", [entityType, entityId]);
  for (const ref of refs) {
    const targetId = ref.userId;
    const [[target]] = await connection.query("SELECT u.id, u.username, p.profile_type, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ? AND u.deleted_at IS NULL AND u.purged_at IS NULL", [targetId]);
    if (!target || await blockExists(connection, authorUserId, targetId) || await hideExists(connection, authorUserId, targetId)) {
      throw Object.assign(new Error("Упомянутый пользователь недоступен"), { statusCode: 400 });
    }
    const [[author]] = await connection.query("SELECT p.profile_type, p.birth_date FROM profiles p WHERE p.user_id = ?", [authorUserId]);
    if (["Читатель", "Писатель", "Блогер"].includes(author?.profile_type) && ["Читатель", "Писатель", "Блогер"].includes(target.profile_type)) await assertAgeCompatible(connection, authorUserId, targetId);
    const token = /^@[\w.-]{1,30}$/u.test(ref.token) ? ref.token : `@${target.username}`;
    await connection.query("INSERT INTO content_mentions (entity_type, entity_id, author_user_id, mentioned_user_id, mention_token) VALUES (?, ?, ?, ?, ?)", [entityType, entityId, authorUserId, targetId, token]);
    if (publicMaterial) {
      const groupKey = `mention:${entityType}:${entityId}:${targetId}`;
      await createNotificationEvent(connection, {
        recipientUserId: targetId,
        actorUserId: authorUserId,
        eventType: "mention",
        title: "Упоминание",
        body: "Вас упомянули в материале.",
        materialKind,
        materialId,
        dedupeKey: groupKey,
        groupKey,
      });
    }
  }
}

async function mentionDtos(connection, entityType, entityIds, viewerId) {
  const ids = [...new Set((Array.isArray(entityIds) ? entityIds : [entityIds]).map(Number).filter(Number.isInteger))];
  if (!ids.length) return new Map();
  const [[viewer]] = await connection.query(
    "SELECT u.role, p.profile_type, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ? LIMIT 1",
    [viewerId],
  );
  const personalTypes = new Set(["Читатель", "Писатель", "Блогер"]);
  const viewerPersonal = personalTypes.has(viewer?.profile_type);
  const viewerAge = ageFromBirthDate(viewer?.birth_date);
  const [rows] = await connection.query(
    `SELECT m.entity_id, m.mentioned_user_id, m.mention_token, u.username, u.role, p.display_name, p.profile_type, p.birth_date, u.deleted_at, u.purged_at,
            EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = m.mentioned_user_id) OR (b.blocker_user_id = m.mentioned_user_id AND b.blocked_user_id = ?)) AS blocked,
            EXISTS(SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = m.mentioned_user_id) AS hidden
       FROM content_mentions m JOIN users u ON u.id = m.mentioned_user_id JOIN profiles p ON p.user_id = u.id
      WHERE m.entity_type = ? AND m.entity_id IN (${ids.map(() => "?").join(",")})`, [viewerId, viewerId, viewerId, entityType, ...ids],
  );
  const result = new Map();
  for (const row of rows) {
    const targetPersonal = personalTypes.has(row.profile_type);
    const ageCompatible = viewer?.role === "admin" || !viewerPersonal || !targetPersonal
      || viewerAge !== null && ageFromBirthDate(row.birth_date) !== null && (viewerAge < 18) === (ageFromBirthDate(row.birth_date) < 18);
    const visible = !row.deleted_at && !row.purged_at && !row.blocked && !row.hidden && ageCompatible;
    const entry = { userId: Number(row.mentioned_user_id), token: visible ? row.mention_token : NEUTRAL_MENTION_TOKEN, ...(visible ? { username: row.username, displayName: row.display_name } : {}) };
    Object.defineProperty(entry, "sourceToken", { value: String(row.mention_token ?? ""), enumerable: false });
    const list = result.get(Number(row.entity_id)) ?? []; list.push(entry); result.set(Number(row.entity_id), list);
  }
  return result;
}

async function assertUsersCanInteract(connection, firstUserId, secondUserId, { lock = true } = {}) {
  if (lock) await lockInteractionPair(connection, firstUserId, secondUserId);
  const [[inactive]] = await connection.query(
    "SELECT id FROM users WHERE id IN (?, ?) AND (deleted_at IS NOT NULL OR purged_at IS NOT NULL) LIMIT 1",
    [firstUserId, secondUserId],
  );
  if (inactive) {
    throw Object.assign(new Error("Взаимодействие с удалённым профилем недоступно"), { statusCode: 410 });
  }
  if (await blockExists(connection, firstUserId, secondUserId)) {
    throw Object.assign(new Error("Взаимодействие с этим пользователем недоступно"), { statusCode: 403 });
  }
}

async function assertMessagePairAccess(connection, userId, targetId, { lock = true } = {}) {
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === Number(userId)) {
    throw Object.assign(new Error("Некорректный пользователь"), { statusCode: 400 });
  }
  await assertUsersCanInteract(connection, userId, targetId, { lock });
  const low = Math.min(userId, targetId); const high = Math.max(userId, targetId);
  const [[friendship]] = await connection.query("SELECT 1 FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
  const [[membership]] = await connection.query("SELECT 1 FROM community_memberships WHERE (community_user_id = ? AND member_user_id = ?) OR (community_user_id = ? AND member_user_id = ?)", [userId, targetId, targetId, userId]);
  const [participants] = await connection.query("SELECT u.id, u.role, p.profile_type FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id IN (?, ?)", [userId, targetId]);
  if (participants.length !== 2) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
  const hasAdmin = participants.some((participant) => participant.role === "admin");
  const [firstParticipant, secondParticipant] = participants;
  if (!membership && !hasAdmin) await assertAgeCompatible(connection, userId, targetId, { lock });
  if (!canMessagePair({ friends: Boolean(friendship), communityMembers: Boolean(membership), hasAdmin, firstProfileType: firstParticipant?.profile_type, secondProfileType: secondParticipant?.profile_type })) {
    throw Object.assign(new Error("Переписка доступна только друзьям, участникам сообщества, издательствам и службе поддержки"), { statusCode: 403 });
  }
  return { participants };
}

async function canonicalDirectConversation(connection, firstUserId, secondUserId) {
  const low = Math.min(Number(firstUserId), Number(secondUserId));
  const high = Math.max(Number(firstUserId), Number(secondUserId));
  await connection.query(
    "INSERT IGNORE INTO conversations (conversation_type, direct_user_low_id, direct_user_high_id) VALUES ('direct', ?, ?)",
    [low, high],
  );
  const [[conversation]] = await connection.query(
    "SELECT id FROM conversations WHERE conversation_type = 'direct' AND direct_user_low_id = ? AND direct_user_high_id = ? FOR UPDATE",
    [low, high],
  );
  const [liveUsers] = await connection.query(
    "SELECT id FROM users WHERE id IN (?, ?) AND deleted_at IS NULL AND purged_at IS NULL",
    [low, high],
  );
  for (const user of liveUsers) await connection.query("INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)", [conversation.id, user.id]);
  return Number(conversation.id);
}

async function assertMessageReactionAccess(connection, userId, messageId) {
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  }
  const [[candidate]] = await connection.query(
    `SELECT id, sender_user_id, recipient_user_id, is_system
      FROM messages
      WHERE id = ? AND deleted_at IS NULL AND (sender_user_id = ? OR recipient_user_id = ?)
      LIMIT 1`,
    [messageId, userId, userId],
  );
  if (!candidate) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  const peerId = Number(candidate.sender_user_id) === Number(userId) ? Number(candidate.recipient_user_id) : Number(candidate.sender_user_id);
  if (!Number.isInteger(peerId) || peerId <= 0 || peerId === Number(userId)) {
    throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  }
  await assertMessagePairAccess(connection, userId, peerId);
  const [[message]] = await connection.query(
    `SELECT id, sender_user_id, recipient_user_id, is_system
      FROM messages FORCE INDEX (PRIMARY)
      WHERE id = ? AND deleted_at IS NULL AND (sender_user_id = ? OR recipient_user_id = ?)
      LIMIT 1 FOR UPDATE`,
    [messageId, userId, userId],
  );
  if (!message) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  const [[historyClear]] = await connection.query(
    "SELECT cleared_through_message_id FROM chat_history_clears WHERE user_id = ? AND peer_user_id = ? LIMIT 1",
    [userId, peerId],
  );
  if (Number(message.id) <= Number(historyClear?.cleared_through_message_id ?? 0)) {
    throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  }
  if (message.is_system) {
    throw Object.assign(new Error("Системные сообщения не поддерживают реакции"), { statusCode: 409, code: "MESSAGE_REACTION_NOT_ALLOWED" });
  }
  return { message, peerId };
}

async function messageReactionDto(connection, messageId, viewerId) {
  const [rows] = await connection.query(
    "SELECT user_id FROM message_reactions WHERE message_id = ? AND reaction_type = 'like' ORDER BY created_at, user_id",
    [messageId],
  );
  const likedByUserIds = rows.map((row) => Number(row.user_id));
  return {
    messageId: Number(messageId),
    likeCount: likedByUserIds.length,
    likedByViewer: likedByUserIds.includes(Number(viewerId)),
    likedByUserIds,
  };
}

async function assertMessageEditAccess(connection, userId, messageId) {
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  }
  const [[candidate]] = await connection.query(
    `SELECT id, sender_user_id, recipient_user_id, body, attachment_kind, attachment_id, message_kind, sticker_id, is_system, read_at, edited_at, created_at
       FROM messages
      WHERE id = ? AND sender_user_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [messageId, userId],
  );
  if (!candidate) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  const peerId = Number(candidate.recipient_user_id);
  await assertMessagePairAccess(connection, userId, peerId);
  const [[message]] = await connection.query(
    `SELECT id, sender_user_id, recipient_user_id, body, attachment_kind, attachment_id, message_kind, sticker_id, is_system, read_at, edited_at, created_at
       FROM messages FORCE INDEX (PRIMARY)
      WHERE id = ? AND sender_user_id = ? AND deleted_at IS NULL
      LIMIT 1 FOR UPDATE`,
    [messageId, userId],
  );
  if (!message) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  const [[historyClear]] = await connection.query(
    "SELECT cleared_through_message_id FROM chat_history_clears WHERE user_id = ? AND peer_user_id = ? LIMIT 1",
    [userId, peerId],
  );
  if (Number(message.id) <= Number(historyClear?.cleared_through_message_id ?? 0)) {
    throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  }
  if (message.is_system) {
    throw Object.assign(new Error("Системные сообщения нельзя редактировать"), { statusCode: 409, code: "MESSAGE_SYSTEM_NOT_EDITABLE" });
  }
  if (message.message_kind === "sticker") {
    throw Object.assign(new Error("Стикеры нельзя редактировать"), { statusCode: 409, code: "MESSAGE_STICKER_NOT_EDITABLE" });
  }
  if (message.attachment_kind || message.attachment_id) {
    throw Object.assign(new Error("Сообщения с вложениями нельзя редактировать"), { statusCode: 409, code: "MESSAGE_ATTACHMENT_NOT_EDITABLE" });
  }
  return { message, peerId };
}

async function assertMessageDeleteAccess(connection, userId, messageId) {
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  }
  const [[candidate]] = await connection.query(
    `SELECT id, sender_user_id, recipient_user_id, body, attachment_kind, attachment_id, message_kind, sticker_id, is_system, read_at, edited_at, created_at
       FROM messages
      WHERE id = ? AND sender_user_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [messageId, userId],
  );
  if (!candidate) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  const peerId = Number(candidate.recipient_user_id);
  await assertMessagePairAccess(connection, userId, peerId);
  const [[message]] = await connection.query(
    `SELECT id, sender_user_id, recipient_user_id, body, attachment_kind, attachment_id, message_kind, sticker_id, is_system, read_at, edited_at, created_at
       FROM messages FORCE INDEX (PRIMARY)
      WHERE id = ? AND sender_user_id = ? AND deleted_at IS NULL
      LIMIT 1 FOR UPDATE`,
    [messageId, userId],
  );
  if (!message) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  const [[historyClear]] = await connection.query(
    "SELECT cleared_through_message_id FROM chat_history_clears WHERE user_id = ? AND peer_user_id = ? LIMIT 1",
    [userId, peerId],
  );
  if (Number(message.id) <= Number(historyClear?.cleared_through_message_id ?? 0)) {
    throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  }
  if (message.is_system) {
    throw Object.assign(new Error("Системные сообщения нельзя удалять"), { statusCode: 409, code: "MESSAGE_SYSTEM_NOT_DELETABLE" });
  }
  return { message, peerId };
}

async function editableMessageDto(connection, message, viewerId) {
  const messageId = Number(message.id);
  const mentions = (await mentionDtos(connection, "message", messageId, viewerId)).get(messageId) ?? [];
  const { messageId: _messageId, ...reaction } = await messageReactionDto(connection, messageId, viewerId);
  return {
    id: messageId,
    senderId: Number(message.sender_user_id),
    mine: Number(message.sender_user_id) === Number(viewerId),
    text: neutralizeMentionedText(message.body, mentions),
    ...(message.message_kind === "sticker" ? { kind: "sticker", sticker: stickerDto(archivedBookSticker(message.sticker_id)) } : {}),
    mentions,
    read: Boolean(message.read_at),
    editedAt: message.edited_at ? new Date(message.edited_at).toISOString() : undefined,
    createdAt: new Date(message.created_at).toISOString(),
    ...reaction,
  };
}

async function assertMessageSearchPairAccess(connection, userId, peerId) {
  try {
    await assertMessagePairAccess(connection, userId, peerId, { lock: false });
  } catch (error) {
    if ([400, 403, 404, 410].includes(Number(error?.statusCode))) {
      throw Object.assign(new Error("Диалог не найден"), { statusCode: 404, code: "MESSAGE_SEARCH_DIALOG_NOT_FOUND" });
    }
    throw error;
  }
}

function messageSearchResult(row, tokens) {
  return {
    messageId: Number(row.id),
    snippet: messageSearchSnippet(row.body, tokens),
    createdAt: new Date(row.created_at).toISOString(),
    author: {
      id: Number(row.sender_user_id),
      name: row.author_name,
      username: row.author_username,
    },
  };
}

async function conversationMessageSearch(connection, { userId, peerId, search, cursor = null, limit = 20, includeTotal = true }) {
  const cursorSql = cursor ? " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : "";
  const cursorValues = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
  const commonSql = `
      FROM messages m FORCE INDEX (messages_body_fulltext)
      JOIN users author ON author.id = m.sender_user_id
      JOIN profiles author_profile ON author_profile.user_id = author.id
      LEFT JOIN chat_history_clears history_clear
        ON history_clear.user_id = ? AND history_clear.peer_user_id = ?
     WHERE ((m.sender_user_id = ? AND m.recipient_user_id = ?) OR (m.sender_user_id = ? AND m.recipient_user_id = ?))
       AND m.id > COALESCE(history_clear.cleared_through_message_id, 0)
       AND m.deleted_at IS NULL
       AND m.deleted_before_read = 0
       AND MATCH(m.body) AGAINST (? IN BOOLEAN MODE)`;
  const values = [userId, peerId, userId, peerId, peerId, userId, search.booleanQuery];
  const [rows] = await connection.query(
    `SELECT m.id, m.sender_user_id, m.body, m.created_at, author.username AS author_username, author_profile.display_name AS author_name
       ${commonSql}${cursorSql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?`,
    [...values, ...cursorValues, limit + 1],
  );
  let total;
  if (includeTotal) {
    const [[count]] = await connection.query(`SELECT COUNT(*) AS total ${commonSql}`, values);
    total = Number(count.total);
  }
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    matches: page.map((row) => messageSearchResult(row, search.tokens)),
    ...(includeTotal ? { total } : {}),
    nextCursor: rows.length > limit && last ? encodeMessageSearchCursor({ id: Number(last.id), createdAt: new Date(last.created_at).toISOString() }) : null,
  };
}

async function lockInteractionPair(connection, firstUserId, secondUserId) {
  const low = Math.min(Number(firstUserId), Number(secondUserId));
  const high = Math.max(Number(firstUserId), Number(secondUserId));
  await connection.query(
    "SELECT user_id FROM profiles WHERE user_id IN (?, ?) ORDER BY user_id FOR UPDATE",
    [low, high],
  );
}

async function applyPersonalBlock(connection, blockerId, blockedId) {
  if (!blockedId || Number(blockerId) === Number(blockedId)) {
    throw Object.assign(new Error("Некорректный пользователь"), { statusCode: 400 });
  }
  const low = Math.min(Number(blockerId), Number(blockedId));
  const high = Math.max(Number(blockerId), Number(blockedId));
  await lockInteractionPair(connection, blockerId, blockedId);
  await connection.query("INSERT IGNORE INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [blockerId, blockedId]);
  await connection.query("DELETE FROM follows WHERE (follower_user_id = ? AND target_user_id = ?) OR (follower_user_id = ? AND target_user_id = ?)", [blockerId, blockedId, blockedId, blockerId]);
  await connection.query("DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
  await connection.query("DELETE FROM community_memberships WHERE (community_user_id = ? AND member_user_id = ?) OR (community_user_id = ? AND member_user_id = ?)", [blockerId, blockedId, blockedId, blockerId]);
  await connection.query("DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)", [blockerId, blockedId, blockedId, blockerId]);
  await connection.query("DELETE FROM messages WHERE (sender_user_id = ? AND recipient_user_id = ?) OR (sender_user_id = ? AND recipient_user_id = ?)", [blockerId, blockedId, blockedId, blockerId]);
  await connection.query("DELETE FROM notifications WHERE (user_id = ? AND actor_user_id = ?) OR (user_id = ? AND actor_user_id = ?)", [blockerId, blockedId, blockedId, blockerId]);
  await cancelNotificationDeliveries(connection, { userId: blockerId, actorUserId: blockedId });
  await cancelNotificationDeliveries(connection, { userId: blockedId, actorUserId: blockerId });
}

async function reportTarget(connection, kind, id) {
  if (["interface", "admin_action", "partner"].includes(kind) && Number(id)) return { id: Number(id), title: kind, owner_id: null };
  const specs = {
    user: ["SELECT u.id, p.display_name AS title, u.id AS owner_id FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", id],
    book: ["SELECT id, title, creator_user_id AS owner_id FROM books WHERE id = ?", id],
    review: ["SELECT r.id, b.title, r.user_id AS owner_id FROM reviews r JOIN books b ON b.id = r.book_id WHERE r.id = ?", id],
    excerpt: ["SELECT id, COALESCE(NULLIF(book_title, ''), 'Публикация') AS title, user_id AS owner_id FROM excerpts WHERE id = ?", id],
    event: ["SELECT id, title, creator_user_id AS owner_id FROM events WHERE id = ?", id],
    occasion: ["SELECT id, primary_text AS title, creator_user_id AS owner_id FROM occasions WHERE id = ?", id],
    publisher_news: ["SELECT id, title, user_id AS owner_id FROM publisher_news WHERE id = ?", id],
    shelf: ["SELECT id, title, owner_user_id AS owner_id FROM book_shelves WHERE id = ?", id],
    chat: ["SELECT u.id, p.display_name AS title, u.id AS owner_id FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", id],
    comment: ["SELECT mc.id, LEFT(mc.body, 180) AS title, mc.user_id AS owner_id FROM material_comments mc WHERE mc.id = ?", id],
    book_note: ["SELECT n.id, CONCAT('Заметка: ', LEFT(n.body, 180)) AS title, n.user_id AS owner_id FROM book_progress_notes n WHERE n.id = ?", id],
    marketplace_listing: ["SELECT id, book_title AS title, seller_user_id AS owner_id FROM marketplace_listings WHERE id = ?", id],
    marketplace_conversation: ["SELECT c.id, CONCAT('Диалог объявления #', c.marketplace_listing_id) AS title, l.seller_user_id AS owner_id, c.marketplace_buyer_user_id AS buyer_id FROM conversations c JOIN marketplace_listings l ON l.id = c.marketplace_listing_id WHERE c.id = ? AND c.conversation_type = 'marketplace'", id],
  };
  const spec = specs[kind];
  if (!spec || !Number(id)) return null;
  const [[row]] = await connection.query(spec[0], [spec[1]]);
  return row ?? null;
}

function bookNoteVisibilityPredicate(note = "n", author = "author", viewerBook = "viewer_book") {
  return `(
    ${note}.user_id = ? OR (
      ${author}.deleted_at IS NULL AND ${author}.purged_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks block
         WHERE (block.blocker_user_id = ? AND block.blocked_user_id = ${note}.user_id)
            OR (block.blocker_user_id = ${note}.user_id AND block.blocked_user_id = ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_hides hidden
         WHERE hidden.hider_user_id = ? AND hidden.hidden_user_id = ${note}.user_id
      )
      AND ${note}.progress_percent <= CASE
        WHEN ${viewerBook}.reading_status = 'read' THEN 100
        WHEN ${viewerBook}.reading_status IN ('reading', 'abandoned', 'postponed') THEN CASE
          WHEN ${viewerBook}.progress_unit = 'chapters' AND ${viewerBook}.chapters_current IS NOT NULL AND ${viewerBook}.chapters_total > 0 AND ${viewerBook}.chapters_current <= ${viewerBook}.chapters_total THEN FLOOR(${viewerBook}.chapters_current * 100 / ${viewerBook}.chapters_total)
          WHEN ${viewerBook}.progress_unit = 'pages' AND ${viewerBook}.pages_current IS NOT NULL AND ${viewerBook}.pages_total > 0 AND ${viewerBook}.pages_current <= ${viewerBook}.pages_total THEN FLOOR(${viewerBook}.pages_current * 100 / ${viewerBook}.pages_total)
          ELSE 0
        END
        ELSE 0
      END
    )
  )`;
}

async function assertBookNoteReadable(connection, viewerId, noteId) {
  const [[header]] = await connection.query(
    "SELECT n.book_id FROM book_progress_notes n JOIN books b ON b.id = n.book_id WHERE n.id = ?",
    [noteId],
  );
  if (!header) throw Object.assign(new Error("Заметка не найдена"), { statusCode: 404 });
  await assertAdultMaterialReadable(connection, viewerId, "book", Number(header.book_id));
  const [[visible]] = await connection.query(
    `SELECT n.id
       FROM book_progress_notes n
       JOIN users author ON author.id = n.user_id
       LEFT JOIN user_books viewer_book ON viewer_book.user_id = ? AND viewer_book.book_id = n.book_id AND viewer_book.is_author = 0
      WHERE n.id = ? AND ${bookNoteVisibilityPredicate()}`,
    [viewerId, noteId, viewerId, viewerId, viewerId, viewerId],
  );
  if (!visible) throw Object.assign(new Error("Заметка не найдена"), { statusCode: 404 });
}

async function publisherAccess(connection, userId) {
  const [[profile]] = await connection.query(
    "SELECT profile_type, publisher_status FROM profiles WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return {
    isPublisher: ["Издатель", "Сообщество"].includes(profile?.profile_type),
    isCommunity: profile?.profile_type === "Сообщество",
    approved: !["Издатель", "Сообщество"].includes(profile?.profile_type) || profile?.publisher_status === "approved",
    status: profile?.publisher_status ?? "not_required",
  };
}

async function requireApprovedPublisher(connection, userId) {
  const access = await publisherAccess(connection, userId);
  if (access.isPublisher && !access.approved) {
    throw Object.assign(new Error("Профиль организации ожидает официального подтверждения"), { statusCode: 403 });
  }
  return access;
}

export function publisherSalesLinks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((item, index) => ({
    id: Number(item?.id) || Date.now() + index,
    label: String(item?.label ?? "").trim().slice(0, 120),
    url: item?.url ? cleanUrl(item.url) : "",
  })).filter((item) => item.label && item.url);
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function consumeRecoveryCode(userId, code) {
  return withTransaction(async (connection) => {
    const [[account]] = await connection.query("SELECT totp_recovery_codes FROM users WHERE id = ? FOR UPDATE", [userId]);
    const hashes = jsonArray(account?.totp_recovery_codes);
    const index = recoveryCodeIndex(hashes, code);
    if (index < 0) return false;
    hashes.splice(index, 1);
    await connection.query("UPDATE users SET totp_recovery_codes = ? WHERE id = ?", [JSON.stringify(hashes), userId]);
    return true;
  });
}

async function materialInfo(connection, kind, id) {
  if (kind === "shelf") {
    const [[row]] = await connection.query("SELECT s.owner_user_id AS owner_id, s.title FROM book_shelves s JOIN users u ON u.id = s.owner_user_id WHERE s.id = ? AND u.deleted_at IS NULL AND u.purged_at IS NULL", [id]);
    return row;
  }
  if (kind === "review") {
    const [[row]] = await connection.query("SELECT r.user_id AS owner_id, b.title FROM reviews r JOIN books b ON b.id = r.book_id WHERE r.id = ?", [id]);
    return row;
  }
  if (kind === "excerpt") {
    const [[row]] = await connection.query("SELECT user_id AS owner_id, book_title AS title FROM excerpts WHERE id = ?", [id]);
    return row;
  }
  if (kind === "event") {
    const [[row]] = await connection.query("SELECT creator_user_id AS owner_id, title FROM events WHERE id = ? AND status = 'published'", [id]);
    return row;
  }
  if (kind === "occasion") {
    const [[row]] = await connection.query("SELECT creator_user_id AS owner_id, primary_text AS title FROM occasions WHERE id = ? AND status = 'published'", [id]);
    return row;
  }
  if (kind === "publisher_news") {
    const [[row]] = await connection.query(
      "SELECT n.user_id AS owner_id, n.title FROM publisher_news n JOIN profiles p ON p.user_id = n.user_id WHERE n.id = ? AND p.profile_type IN ('Издатель', 'Сообщество') AND p.publisher_status = 'approved'",
      [id],
    );
    return row;
  }
  return null;
}

async function readableMaterialInfo(connection, userId, kind, id) {
  const gate = await profileAccessState(connection, userId);
  if (!gate.complete) throw Object.assign(new Error("Для открытия материала заполните обязательные поля профиля"), { statusCode: 428, code: "PROFILE_COMPLETION_REQUIRED", missing: gate.missing });
  const material = await materialInfo(connection, kind, id);
  if (!material) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
  if (Number(material.owner_id) !== Number(userId) && await hideExists(connection, userId, Number(material.owner_id))) {
    // Deliberately indistinguishable from an unavailable material: callers must
    // not learn whether this was hidden, moderated or removed.
    throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
  }
  if (kind === "shelf") await assertShelfReadable(connection, userId, id, { blockAsForbidden: true });
  await assertAdultMaterialReadable(connection, userId, kind, id);
  if (await blockExists(connection, userId, Number(material.owner_id))) {
    throw Object.assign(new Error("Материал недоступен"), { statusCode: 403 });
  }
  return material;
}

async function interactableMaterialInfo(connection, userId, kind, id) {
  const material = await readableMaterialInfo(connection, userId, kind, id);
  await assertUsersCanInteract(connection, userId, Number(material.owner_id));
  return material;
}

async function validatedChatAttachment(connection, input, senderUserId, recipientUserId) {
  if (!input) return null;
  const kind = String(input.kind ?? "");
  const id = Number(input.id);
  if (!Number.isInteger(id) || id < 1) throw Object.assign(new Error("Некорректное вложение"), { statusCode: 400 });
  const queries = {
    book: "SELECT id, creator_user_id AS owner_id FROM books WHERE id = ? LIMIT 1",
    user: "SELECT id FROM users WHERE id = ? AND role <> 'admin' LIMIT 1",
    event: "SELECT id FROM events WHERE id = ? AND status = 'published' LIMIT 1",
    review: "SELECT id FROM reviews WHERE id = ? LIMIT 1",
    excerpt: "SELECT id FROM excerpts WHERE id = ? LIMIT 1",
    occasion: "SELECT id FROM occasions WHERE id = ? AND status = 'published' LIMIT 1",
    publisher_news: "SELECT n.id, n.user_id AS owner_id FROM publisher_news n JOIN profiles p ON p.user_id = n.user_id WHERE n.id = ? AND p.profile_type IN ('Издатель', 'Сообщество') AND p.publisher_status = 'approved' LIMIT 1",
    shelf: "SELECT s.id, s.owner_user_id AS owner_id FROM book_shelves s JOIN users u ON u.id = s.owner_user_id WHERE s.id = ? AND u.deleted_at IS NULL AND u.purged_at IS NULL LIMIT 1",
  };
  if (!queries[kind]) throw Object.assign(new Error("Неизвестный тип вложения"), { statusCode: 400 });
  const [[item]] = await connection.query(queries[kind], [id]);
  if (!item) throw Object.assign(new Error("Материал для отправки не найден"), { statusCode: 404 });
  let materialOwnerId = Number(item.owner_id) || null;
  if (["review", "excerpt", "event", "occasion", "publisher_news", "shelf"].includes(kind)) {
    // Both participants must be able to read the exact shared material, not
    // merely be permitted to message each other. This preserves block, status
    // and 18+ visibility at the attachment boundary.
    const senderMaterial = await readableMaterialInfo(connection, senderUserId, kind, id);
    const recipientMaterial = await readableMaterialInfo(connection, recipientUserId, kind, id);
    materialOwnerId = Number(senderMaterial.owner_id ?? recipientMaterial.owner_id) || null;
  } else if (kind !== "user") {
    await assertAdultMaterialReadable(connection, senderUserId, kind, id);
    await assertAdultMaterialReadable(connection, recipientUserId, kind, id);
  }
  if (materialOwnerId) {
    for (const participantUserId of [senderUserId, recipientUserId]) {
      if (Number(participantUserId) !== materialOwnerId) await assertUsersCanInteract(connection, participantUserId, materialOwnerId);
    }
  }
  return { kind, id };
}

async function notifyFollowersAboutPublication(connection, userId, kind, materialId, materialTitle) {
  const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
  const publicationName = kind === "review" ? "Новая рецензия" : "Новая публикация блога";
  const body = `${actor.display_name} опубликовал(а) материал «${materialTitle}».`;
  const [followers] = await connection.query("SELECT follower_user_id FROM follows WHERE target_user_id = ? AND follower_user_id <> ?", [userId, userId]);
  for (const follower of followers) {
    const key = `publication:${kind}:${materialId}`;
    await createNotificationEvent(connection, {
      recipientUserId: follower.follower_user_id,
      actorUserId: userId,
      eventType: "publication",
      title: publicationName,
      body,
      materialKind: kind,
      materialId,
      dedupeKey: key,
      groupKey: key,
    });
  }
}

router.get("/health", asyncRoute(async (_request, response) => {
  await getPool().query("SELECT 1");
  response.json({ ok: true, service: "book-meet", database: "mysql" });
}));

router.get("/auth/providers", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID),
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  });
});

router.get("/auth/legal-documents", asyncRoute(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const documents = await activeLegalDocuments(getPool(), requestLocale(request));
  response.json({ required: legalConsentRequired(), configured: REQUIRED_LEGAL_DOCUMENT_TYPES.every((type) => documents.some((document) => document.type === type)), documents });
}));

router.post("/auth/login", asyncRoute(async (request, response) => {
  const locale = requestLocale(request);
  const email = normalizeEmail(request.body?.email);
  const attempt = loginAttemptState(request, email);
  if (attempt.blocked) {
    response.setHeader("Retry-After", String(attempt.retryAfterSeconds));
    return response.status(429).json({ code: "AUTH_TOO_MANY_ATTEMPTS", error: authText(locale, "tooManyAttempts") });
  }
  const password = String(request.body?.password ?? "");
  const totp = String(request.body?.totp ?? "");
  if (!isValidEmail(email) || !password) return response.status(400).json({ error: "Введите e-mail и пароль" });
  const [[account]] = await getPool().query(
    "SELECT id, password_hash, password_login_enabled, totp_secret, totp_enabled, suspension_reason, suspended_until, suspended_permanently, deleted_at, deletion_expires_at, purged_at FROM users WHERE email_key = ? LIMIT 1",
    [email],
  );
  if (!account || !account.password_login_enabled || !(await verifyPassword(password, account.password_hash))) {
    attempt.fail();
    await logSecurityEvent(getPool(), request, { eventType: "login_password", result: "failed", details: "invalid_credentials" });
    return response.status(401).json({ error: "Неверный e-mail или пароль" });
  }
  if (account.totp_enabled && !totp) return response.status(202).json({ requiresTotp: true });
  if (account.totp_enabled && !verifyTotp(account.totp_secret, totp) && !(await consumeRecoveryCode(account.id, totp))) {
    attempt.fail();
    await logSecurityEvent(getPool(), request, { userId: account.id, eventType: "login_totp", result: "failed" });
    return response.status(401).json({ error: "Неверный одноразовый код" });
  }
  if (!account.suspended_permanently && account.suspended_until && new Date(account.suspended_until).getTime() <= Date.now()) {
    await getPool().query("UPDATE users SET suspension_reason = NULL, suspended_until = NULL WHERE id = ?", [account.id]);
  } else if (account.suspended_permanently || account.suspended_until) {
    return response.status(423).json({
      suspended: true,
      permanent: Boolean(account.suspended_permanently),
      until: account.suspended_until ? new Date(account.suspended_until).toISOString() : null,
      reason: account.suspension_reason ?? "",
    });
  }
  attempt.clearIdentity();
  if (account.deleted_at && !account.purged_at) {
    if (!account.deletion_expires_at || new Date(account.deletion_expires_at).getTime() <= Date.now()) {
      await withTransaction((connection) => purgeDeletedProfile(connection, account.id));
      return response.status(410).json({ error: "Срок хранения удалённого профиля истёк. Создайте новый профиль." });
    }
    const token = await createSession(getPool(), account.id, request);
    response.setHeader("Set-Cookie", sessionCookie(token, request));
    return response.status(202).json({ deletedProfile: true, daysRemaining: deletionDaysRemaining(account.deletion_expires_at) });
  }
  const token = await createSession(getPool(), account.id, request);
  await logSecurityEvent(getPool(), request, { userId: account.id, eventType: "login", result: "success" });
  response.setHeader("Set-Cookie", sessionCookie(token, request));
  response.json(await loadBootstrap(account.id));
}));

router.get("/auth/google/start", (request, response) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return response.redirect("/?auth_error=google_not_configured");
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const redirectUri = `${appOrigin()}${GOOGLE_CALLBACK_PATH}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
  }).toString();
  response.setHeader("Set-Cookie", [
    transientCookie("book_meet_google_state", state, request),
    transientCookie("book_meet_google_nonce", nonce, request),
  ]);
  response.redirect(url.toString());
});

const googleCallback = asyncRoute(async (request, response) => {
  const parameters = request.method === "POST" ? request.body : request.query;
  const expectedState = readCookie(request, "book_meet_google_state");
  const expectedNonce = readCookie(request, "book_meet_google_nonce");
  if (parameters.error) return response.redirect("/?auth_error=google_cancelled");
  if (!expectedState || parameters.state !== expectedState || !parameters.code) return response.redirect("/?auth_error=google_state");
  const redirectUri = `${appOrigin()}${GOOGLE_CALLBACK_PATH}`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: String(parameters.code),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.id_token || !tokens.access_token) return response.redirect("/?auth_error=google_exchange");
  const tokenInfoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
  const tokenInfo = await tokenInfoResponse.json();
  if (!tokenInfoResponse.ok || tokenInfo.aud !== process.env.GOOGLE_CLIENT_ID || tokenInfo.nonce !== expectedNonce || tokenInfo.email_verified !== "true") {
    return response.redirect("/?auth_error=google_verify");
  }
  const [[existingGoogleAccount]] = await getPool().query("SELECT id FROM users WHERE google_subject = ? OR email_key = ? LIMIT 1", [tokenInfo.sub, normalizeEmail(tokenInfo.email)]);
  if (!existingGoogleAccount) return response.redirect("/?auth_error=legal_required");
  const identity = await findOrCreateGoogleUser({
    subject: tokenInfo.sub,
    email: normalizeEmail(tokenInfo.email),
    name: tokenInfo.name,
  });
  if (identity.created && identity.email) await sendGoogleAccountEmail(identity.email, true, requestLocale(request));
  const token = await createSession(getPool(), identity.userId, request);
  response.setHeader("Set-Cookie", [
    sessionCookie(token, request),
    clearTransientCookie("book_meet_google_state", request),
    clearTransientCookie("book_meet_google_nonce", request),
  ]);
  response.redirect(`/?auth=success&registered=${identity.created ? "1" : "0"}`);
});

router.get("/auth/google/callback", googleCallback);
router.post("/auth/google/callback", googleCallback);

router.post("/auth/google/credential", asyncRoute(async (request, response) => {
  if (!process.env.GOOGLE_CLIENT_ID) return response.status(503).json({ error: "Google-вход пока не настроен" });
  const credential = String(request.body?.credential || "");
  if (!credential || credential.length > 16_000) return response.status(400).json({ error: "Google не передал данные для входа" });
  let tokenInfo;
  try {
    tokenInfo = await verifyGoogleIdToken(credential);
  } catch (error) {
    console.error("Google credential verification request failed", error);
    const isConnectivityError = error?.name === "TimeoutError"
      || error?.name === "AbortError"
      || /fetch|network|jwks returned|request failed/i.test(String(error?.message || error));
    return response.status(isConnectivityError ? 502 : 401).json({
      error: isConnectivityError
        ? "Google временно не ответил. Повторяем вход — подождите несколько секунд"
        : "Google не подтвердил данные входа. Откройте окно Google ещё раз",
      retryable: isConnectivityError,
    });
  }
  try {
    const identity = await findOrCreateGoogleUser({
      subject: tokenInfo.sub,
      email: normalizeEmail(tokenInfo.email),
      name: tokenInfo.name,
    }, { legalAcceptance: request.body?.legalAcceptance, locale: requestLocale(request) });
    if (identity.created && identity.email) await sendGoogleAccountEmail(identity.email, true, requestLocale(request));
    const token = await createSession(getPool(), identity.userId, request);
    await logSecurityEvent(getPool(), request, { userId: identity.userId, eventType: "login_google", result: "success" });
    response.setHeader("Set-Cookie", sessionCookie(token, request));
    response.json({ ok: true, registered: identity.created });
  } catch (error) {
    console.error("Google credential account linking failed", error);
    response.status(error.statusCode || 500).json({ code: error.code, error: error.statusCode ? error.message : "Не удалось связать Google-аккаунт с профилем Book Meet" });
  }
}));

router.use(createLocationRouter({ asyncRoute }));

router.post("/auth/register", asyncRoute(async (request, response) => {
  const locale = requestLocale(request);
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password ?? "");
  const username = normalizeUsername(request.body?.username);
  if (!isValidEmail(email) || password.length < 8) return response.status(400).json({ code: "AUTH_INVALID_CREDENTIALS", error: authText(locale, "invalidCredentials") });
  const usernameError = usernameValidationError(username);
  if (usernameError) return response.status(400).json({
    code: usernameError,
    error: authText(locale, usernameError === "USERNAME_RESERVED" ? "usernameReserved" : "usernameInvalid"),
  });
  const verificationToken = createOpaqueActionToken();
  const result = await withTransaction(async (connection) => {
    const legalDocuments = await validateLegalAcceptance(connection, request.body?.legalAcceptance, locale);
    const [[duplicate]] = await connection.query("SELECT id FROM users WHERE email_key = ?", [email]);
    if (duplicate) throw Object.assign(new Error("Профиль с таким e-mail уже существует"), { statusCode: 409 });
    const displayName = email.split("@")[0].slice(0, 120);
    const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU").slice(0, 4) || "BM";
    const colors = ["navy", "blue", "green", "red", "gold"];
    const [created] = await connection.query(
      "INSERT INTO users (username, username_key, username_is_temporary, email, email_key, email_verified_at, password_hash, password_login_enabled, initials, color, role, profile_completed, preferred_locale) VALUES (?, ?, 0, ?, ?, NULL, ?, 1, ?, ?, 'user', 0, ?)",
      [username, username, email, email, await hashPassword(password), initials, colors[Number(Date.now()) % colors.length], locale],
    );
    const userId = Number(created.insertId);
    await connection.query(
      `INSERT INTO profiles (user_id, display_name, city, city_id, profile_type, gender, bio, author_influences, writing_themes, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres)
       VALUES (?, ?, '', NULL, 'Читатель', 'Не указан', '', '', '', '', '', '', '', '[]', '[]')`,
      [userId, displayName],
    );
    await recordLegalAcceptances(connection, userId, legalDocuments);
    const token = await createSession(connection, userId, request);
    await logSecurityEvent(connection, request, { userId, eventType: "registration", result: "success", details: "password" });
    await replaceAccountActionToken(connection, { userId, purpose: "email_verify", token: verificationToken, ttlMinutes: EMAIL_VERIFICATION_TTL_MINUTES });
    return { userId, token };
  });
  response.setHeader("Set-Cookie", sessionCookie(result.token, request));
  await sendVerificationEmail(email, verificationToken, locale);
  response.status(201).json(await loadBootstrap(result.userId));
}));

router.post("/auth/email-verification/confirm", asyncRoute(async (request, response) => {
  const locale = requestLocale(request);
  const token = String(request.body?.token ?? "");
  if (token.length < 32 || token.length > 200) return response.status(400).json({ code: "AUTH_VERIFICATION_INVALID", error: authText(locale, "verificationInvalid") });
  const verified = await withTransaction(async (connection) => {
    const userId = await consumeAccountActionToken(connection, { token, purpose: "email_verify" });
    if (!userId) return false;
    const [updated] = await connection.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ? AND purged_at IS NULL", [userId]);
    return Boolean(updated.affectedRows);
  });
  if (!verified) return response.status(400).json({ code: "AUTH_VERIFICATION_INVALID", error: authText(locale, "verificationInvalid") });
  response.json({ verified: true });
}));

router.post("/auth/password-reset/request", asyncRoute(async (request, response) => {
  const locale = requestLocale(request);
  const email = normalizeEmail(request.body?.email);
  const generic = { ok: true, code: "AUTH_RECOVERY_SENT", message: authText(locale, "recoveryGeneric") };
  if (!isValidEmail(email) || !passwordRecoveryAllowed(request, email)) return response.json(generic);
  const [[account]] = await getPool().query("SELECT id, email, google_subject, password_login_enabled, purged_at FROM users WHERE email_key = ? LIMIT 1", [email]);
  if (!account || account.purged_at) return response.json(generic);
  if (account.google_subject && !account.password_login_enabled) {
    await sendGoogleAccountEmail(account.email, false, locale);
    return response.json(generic);
  }
  const resetToken = createOpaqueActionToken();
  await withTransaction(async (connection) => {
    const [[locked]] = await connection.query("SELECT id FROM users WHERE id = ? AND purged_at IS NULL FOR UPDATE", [account.id]);
    if (locked) await replaceAccountActionToken(connection, { userId: Number(locked.id), purpose: "password_reset", token: resetToken, ttlMinutes: PASSWORD_RESET_TTL_MINUTES });
  });
  await sendPasswordResetEmail(account.email, resetToken, locale);
  response.json(generic);
}));

router.post("/auth/password-reset/confirm", asyncRoute(async (request, response) => {
  const locale = requestLocale(request);
  const token = String(request.body?.token ?? "");
  const password = String(request.body?.password ?? "");
  if (token.length < 32 || token.length > 200 || password.length < 8) return response.status(400).json({ code: "AUTH_RESET_INVALID", error: authText(locale, "resetInvalid") });
  const reset = await withTransaction(async (connection) => {
    const userId = await consumeAccountActionToken(connection, { token, purpose: "password_reset" });
    if (!userId) return false;
    const [[account]] = await connection.query("SELECT google_subject, password_login_enabled, purged_at FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!account || account.purged_at || (account.google_subject && !account.password_login_enabled)) return false;
    await connection.query("UPDATE users SET password_hash = ?, password_login_enabled = 1 WHERE id = ?", [await hashPassword(password), userId]);
    await connection.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
    return true;
  });
  if (!reset) return response.status(400).json({ error: "Ссылка восстановления недействительна или истекла" });
  response.json({ reset: true });
}));

router.post("/auth/logout", asyncRoute(async (request, response) => {
  const token = readCookie(request);
  if (token) await getPool().query("DELETE FROM sessions WHERE token_hash = ?", [hashSessionToken(token)]);
  response.setHeader("Set-Cookie", clearSessionCookie(request));
  response.json({ ok: true });
}));

router.post("/auth/deleted-profile/restore", asyncRoute(async (request, response) => {
  const user = await authenticatedUser(request);
  if (!user?.deletedProfile || user.purged) return response.status(409).json({ error: "Профиль уже нельзя восстановить" });
  if (!user.deletionExpiresAt || new Date(user.deletionExpiresAt).getTime() <= Date.now()) {
    await withTransaction((connection) => purgeDeletedProfile(connection, user.id));
    return response.status(410).json({ error: "Срок хранения профиля истёк" });
  }
  await getPool().query("UPDATE users SET deleted_at = NULL, deletion_expires_at = NULL, consent_withdrawn_at = NULL, last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [user.id]);
  response.json(await loadBootstrap(user.id));
}));

router.post("/auth/deleted-profile/new", asyncRoute(async (request, response) => {
  const user = await authenticatedUser(request);
  if (!user?.deletedProfile || user.purged) return response.status(409).json({ error: "Удалённый профиль не найден" });
  const result = await withTransaction(async (connection) => {
    const [[oldAccount]] = await connection.query(
      "SELECT email, email_key, password_hash, google_subject, telegram_subject, deletion_expires_at FROM users WHERE id = ? FOR UPDATE",
      [user.id],
    );
    if (!oldAccount?.email_key || !oldAccount.deletion_expires_at || new Date(oldAccount.deletion_expires_at).getTime() <= Date.now()) {
      await purgeDeletedProfile(connection, user.id);
      throw Object.assign(new Error("Срок хранения профиля истёк"), { statusCode: 410 });
    }
    const email = oldAccount.email;
    const emailKey = oldAccount.email_key;
    const passwordHash = oldAccount.password_hash;
    const googleSubject = oldAccount.google_subject;
    const telegramSubject = oldAccount.telegram_subject;
    await purgeDeletedProfile(connection, user.id);
    const username = await uniqueInternalUsername(connection, emailKey.split("@")[0] || "reader");
    const displayName = safeProfileName(emailKey.split("@")[0], username);
    const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU").slice(0, 4) || "BM";
    const colors = ["navy", "blue", "green", "red", "gold"];
    const [created] = await connection.query(
      `INSERT INTO users (username, username_key, username_is_temporary, email, email_key, password_hash, google_subject, telegram_subject, initials, color, role, profile_completed)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'user', 0)`,
      [username, username, email, emailKey, passwordHash, googleSubject, telegramSubject, initials, colors[Date.now() % colors.length]],
    );
    const newUserId = Number(created.insertId);
    await connection.query(
      `INSERT INTO profiles (user_id, display_name, city, city_id, profile_type, gender, bio, author_influences, writing_themes, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres)
       VALUES (?, ?, '', NULL, 'Читатель', 'Не указан', '', '', '', '', '', '', '', '[]', '[]')`,
      [newUserId, displayName],
    );
    return { userId: newUserId, token: await createSession(connection, newUserId, request) };
  });
  response.setHeader("Set-Cookie", sessionCookie(result.token, request));
  response.status(201).json(await loadBootstrap(result.userId));
}));

router.use(createBootstrapRouter({ authenticatedUser }));

router.get("/search/materials", asyncRoute(async (request, response) => {
  const user = await authenticatedUser(request);
  if (!user) return response.status(401).json({ error: "Требуется вход" });
  if (user.deletedProfile || user.purged) return response.status(410).json({ deletedProfile: true, purged: user.purged, daysRemaining: deletionDaysRemaining(user.deletionExpiresAt) });
  if (user.suspension) return response.status(423).json({ suspended: true, ...user.suspension });
  const result = searchBootstrapMaterials(await loadBootstrap(user.id, { sections: ["catalog"] }), request.query.q, { page: request.query.page, limit: request.query.limit });
  if (result.error) return response.status(400).json({ code: result.error, error: result.error === "SEARCH_QUERY_TOO_LONG" ? "Запрос слишком длинный" : "Введите не менее двух символов" });
  response.json(result);
}));

router.get("/public/catalog", asyncRoute(async (_request, response) => {
  response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  response.json(await loadPublicCatalog());
}));

router.post("/integrations/telegram/webhook", asyncRoute(async (request, response) => {
  if (!telegramWebhookAuthorized(request.get("X-Telegram-Bot-Api-Secret-Token"))) return response.status(403).json({ ok: false });
  const message = request.body?.message;
  const match = String(message?.text ?? "").trim().match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{20,100})$/);
  const telegramUserId = Number(message?.from?.id);
  if (!match || !Number.isSafeInteger(telegramUserId) || telegramUserId < 1) return response.json({ ok: true, linked: false });
  let linked = false;
  try {
    linked = Boolean(await withTransaction((connection) => consumeTelegramLinkToken(connection, {
      token: match[1],
      telegramUserId,
      displayName: safeTelegramDisplayName(message.from),
    })));
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
  }
  response.json({ ok: true, linked });
}));

router.get("/notifications/email/unsubscribe", (request, response) => {
  const token = String(request.query?.token ?? "");
  if (!verifyEmailUnsubscribeToken(token)) return response.status(400).type("html").send("<!doctype html><meta charset=utf-8><title>Book Meet</title><p>Ссылка отписки недействительна или истекла.</p>");
  const escaped = token.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\"/g, "&quot;");
  response.type("html").send(`<!doctype html><meta charset="utf-8"><title>Book Meet</title><main><h1>Отключить email-уведомления?</h1><p>Системные уведомления внутри Book Meet останутся включены.</p><form method="post" action="/api/notifications/email/unsubscribe"><input type="hidden" name="token" value="${escaped}"><button type="submit">Отключить необязательные письма</button></form></main>`);
});

router.post("/notifications/email/unsubscribe", asyncRoute(async (request, response) => {
  const verified = verifyEmailUnsubscribeToken(request.body?.token);
  if (!verified) return response.status(400).json({ code: "EMAIL_UNSUBSCRIBE_INVALID", error: "Ссылка отписки недействительна или истекла" });
  await withTransaction(async (connection) => {
    await connection.query("UPDATE notification_preferences SET email_mode = 'off', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [verified.userId]);
    await cancelNotificationDeliveries(connection, { userId: verified.userId, channel: "email" });
  });
  if (request.is("application/x-www-form-urlencoded")) return response.type("html").send("<!doctype html><meta charset=utf-8><title>Book Meet</title><p>Email-уведомления отключены.</p>");
  response.json({ unsubscribed: true });
}));

router.get("/admin/notification-deliveries/statistics", asyncRoute(async (request, response) => {
  const pool = getPool();
  const user = await authenticatedUser(request);
  if (!user) return response.status(401).json({ error: "Требуется вход" });
  if (!(await isAdmin(pool, user.id))) return response.status(403).json({ error: "Доступно только администратору" });
  const [rows] = await pool.query(
    `SELECT channel, status, COUNT(*) AS total,
            SUM(CASE WHEN status IN ('pending', 'failed') AND next_attempt_at <= UTC_TIMESTAMP() THEN 1 ELSE 0 END) AS due
       FROM notification_deliveries
      GROUP BY channel, status
      ORDER BY channel, status`,
  );
  response.json({ deliveries: rows.map((row) => ({ channel: row.channel, status: row.status, total: Number(row.total), due: Number(row.due) })) });
}));

router.get("/admin/statistics", asyncRoute(async (request, response) => {
  const pool = getPool();
  const user = await authenticatedUser(request);
  if (!user) return response.status(401).json({ error: "Требуется вход" });
  if (!(await isAdmin(pool, user.id))) {
    return response.status(403).json({ error: "Доступно только администратору" });
  }
  const [typeRows] = await pool.query(
    `SELECT p.profile_type AS profile_type, COUNT(*) AS total
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.role <> 'admin' AND u.deleted_at IS NULL AND u.purged_at IS NULL
      GROUP BY p.profile_type
      ORDER BY p.profile_type`,
  );
  const [cityRows] = await pool.query(
    `SELECT TRIM(p.city) AS city, COUNT(*) AS total
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.role <> 'admin' AND u.deleted_at IS NULL AND u.purged_at IS NULL AND TRIM(COALESCE(p.city, '')) <> ''
      GROUP BY TRIM(p.city)
      ORDER BY total DESC, city`,
  );
  const [[metrics]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM books) AS books,
       (SELECT COUNT(*) FROM reviews) AS reviews,
       (SELECT COUNT(*) FROM excerpts) AS publications,
       (SELECT COUNT(*) FROM events) AS events,
       (SELECT COUNT(*) FROM occasions) AS occasions,
       (SELECT COUNT(*) FROM wishlist_items) AS wishlist_books,
       (SELECT COUNT(*) FROM wishlist_items WHERE reserved_by_user_id IS NOT NULL) AS reserved_gifts,
       (SELECT COUNT(*) FROM (
          SELECT user_low_id AS user_id FROM friendships
          UNION
          SELECT user_high_id AS user_id FROM friendships
        ) friendship_people) AS friendship_users`,
  );
  const usersByType = { "Читатель": 0, "Писатель": 0, "Блогер": 0, "Издатель": 0, "Сообщество": 0 };
  for (const row of typeRows) {
    if (Object.prototype.hasOwnProperty.call(usersByType, row.profile_type)) usersByType[row.profile_type] = Number(row.total);
  }
  response.json({
    totalUsers: Object.values(usersByType).reduce((total, value) => total + value, 0),
    usersByType,
    cities: cityRows.map((row) => ({ city: row.city, count: Number(row.total) })),
    books: Number(metrics.books),
    reviews: Number(metrics.reviews),
    publications: Number(metrics.publications),
    events: Number(metrics.events),
    occasions: Number(metrics.occasions),
    wishlistBooks: Number(metrics.wishlist_books),
    reservedGifts: Number(metrics.reserved_gifts),
    friendshipUsers: Number(metrics.friendship_users),
  });
}));

router.use(asyncRoute(requireUser));

router.post("/legal/acceptances", asyncRoute(async (request, response) => {
  const locale = requestLocale(request);
  const documents = await validateLegalAcceptance(getPool(), request.body, locale);
  await withTransaction(async (connection) => {
    await recordLegalAcceptances(connection, request.bookMeetUser.id, documents);
    await logSecurityEvent(connection, request, { userId: request.bookMeetUser.id, eventType: "legal_reacceptance", result: "success", details: documents.map((item) => `${item.type}:${item.version}:${item.language}`).join(",") });
  });
  response.json({ accepted: true });
}));

router.get("/admin/legal-documents", asyncRoute(async (request, response) => {
  if (!(await isAdmin(getPool(), request.bookMeetUser.id))) return response.status(403).json({ error: "Доступно только администратору" });
  const [documents] = await getPool().query(
    `SELECT ld.*,
            (SELECT COUNT(*) FROM legal_acceptances la WHERE la.document_id = ld.id) AS acceptance_count
       FROM legal_documents ld
      ORDER BY ld.document_type, ld.language_code, ld.created_at DESC`,
  );
  response.json({ documents });
}));

router.post("/admin/legal-documents", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const type = String(request.body?.type ?? "");
  const version = String(request.body?.version ?? "").trim().slice(0, 40);
  const language = ["ru", "kk", "en"].includes(request.body?.language) ? request.body.language : "ru";
  const title = String(request.body?.title ?? "").trim().slice(0, 255);
  const content = String(request.body?.content ?? "").trim().slice(0, 2_000_000);
  const fileName = String(request.body?.fileName ?? "").trim().slice(0, 255) || null;
  const activate = request.body?.activate !== false;
  const requiresReacceptance = Boolean(request.body?.requiresReacceptance);
  if (!(await isAdmin(getPool(), adminId))) return response.status(403).json({ error: "Доступно только администратору" });
  if (!LEGAL_DOCUMENT_TYPES.includes(type) || !version || !title || !content) return response.status(400).json({ error: "Заполните тип, версию, заголовок и текст документа" });
  const documentId = await withTransaction(async (connection) => {
    if (activate) await connection.query("UPDATE legal_documents SET is_active = 0 WHERE document_type = ? AND language_code = ?", [type, language]);
    const [created] = await connection.query(
      `INSERT INTO legal_documents (document_type, version, language_code, title, content, file_name, is_active, requires_reacceptance, uploaded_by_user_id, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${activate ? "UTC_TIMESTAMP()" : "NULL"})`,
      [type, version, language, title, content, fileName, activate ? 1 : 0, requiresReacceptance ? 1 : 0, adminId],
    );
    await logModerationAction(connection, { adminUserId: adminId, actionType: "legal_document_publish", objectType: "legal_document", objectId: created.insertId, newStatus: activate ? "active" : "draft", reason: requiresReacceptance ? "requires_reacceptance" : null });
    return Number(created.insertId);
  });
  response.status(201).json({ id: documentId });
}));

router.patch("/admin/legal-documents/:id", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const documentId = Number(request.params.id);
  const version = String(request.body?.version ?? "").trim().slice(0, 40);
  const title = String(request.body?.title ?? "").trim().slice(0, 255);
  const content = String(request.body?.content ?? "").trim().slice(0, 2_000_000);
  const fileName = String(request.body?.fileName ?? "").trim().slice(0, 255) || null;
  const activate = request.body?.activate !== false;
  const requiresReacceptance = Boolean(request.body?.requiresReacceptance);
  if (!(await isAdmin(getPool(), adminId))) return response.status(403).json({ error: "Доступно только администратору" });
  if (!Number.isInteger(documentId) || documentId <= 0) return response.status(400).json({ error: "Некорректный идентификатор документа" });
  if (!version || !title || !content) return response.status(400).json({ error: "Заполните версию, заголовок и текст документа" });
  const result = await withTransaction(async (connection) => {
    const [[current]] = await connection.query("SELECT * FROM legal_documents WHERE id = ? FOR UPDATE", [documentId]);
    if (!current) throw Object.assign(new Error("Документ не найден"), { statusCode: 404 });
    const [[duplicate]] = await connection.query(
      "SELECT id FROM legal_documents WHERE document_type = ? AND language_code = ? AND version = ? AND id <> ? LIMIT 1 FOR UPDATE",
      [current.document_type, current.language_code, version, documentId],
    );
    if (duplicate) throw Object.assign(new Error("Документ этого типа, языка и версии уже существует"), { statusCode: 409, code: "LEGAL_DOCUMENT_VERSION_EXISTS" });
    const [[usage]] = await connection.query("SELECT COUNT(*) AS count FROM legal_acceptances WHERE document_id = ?", [documentId]);
    const acceptanceCount = Number(usage?.count) || 0;
    const writeMode = legalDocumentWriteMode(acceptanceCount, current.version, version);
    if (activate) await connection.query("UPDATE legal_documents SET is_active = 0 WHERE document_type = ? AND language_code = ?", [current.document_type, current.language_code]);
    if (writeMode === "revision") {
      const [created] = await connection.query(
        `INSERT INTO legal_documents (document_type, version, language_code, title, content, file_name, is_active, requires_reacceptance, uploaded_by_user_id, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${activate ? "UTC_TIMESTAMP()" : "NULL"})`,
        [current.document_type, version, current.language_code, title, content, fileName, activate ? 1 : 0, requiresReacceptance ? 1 : 0, adminId],
      );
      await logModerationAction(connection, { adminUserId: adminId, actionType: "legal_document_revise", objectType: "legal_document", objectId: created.insertId, oldStatus: current.is_active ? "active" : "inactive", newStatus: activate ? "active" : "draft", reason: `revised_from:${documentId};acceptances:${acceptanceCount}` });
      return { id: Number(created.insertId), revisedFrom: documentId };
    }
    await connection.query(
      `UPDATE legal_documents
          SET version = ?, title = ?, content = ?, file_name = ?, is_active = ?, requires_reacceptance = ?,
              uploaded_by_user_id = ?, published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, UTC_TIMESTAMP()) ELSE published_at END
        WHERE id = ?`,
      [version, title, content, fileName, activate ? 1 : 0, requiresReacceptance ? 1 : 0, adminId, activate ? 1 : 0, documentId],
    );
    await logModerationAction(connection, { adminUserId: adminId, actionType: "legal_document_update", objectType: "legal_document", objectId: documentId, oldStatus: current.is_active ? "active" : "inactive", newStatus: activate ? "active" : "inactive", reason: requiresReacceptance ? "requires_reacceptance" : null });
    return { id: documentId };
  });
  response.json(result);
}));

router.delete("/admin/legal-documents/:id", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const documentId = Number(request.params.id);
  if (!(await isAdmin(getPool(), adminId))) return response.status(403).json({ error: "Доступно только администратору" });
  if (!Number.isInteger(documentId) || documentId <= 0) return response.status(400).json({ error: "Некорректный идентификатор документа" });
  await withTransaction(async (connection) => {
    const [[document]] = await connection.query("SELECT id, title, is_active FROM legal_documents WHERE id = ? FOR UPDATE", [documentId]);
    if (!document) throw Object.assign(new Error("Документ не найден"), { statusCode: 404 });
    const [[usage]] = await connection.query("SELECT COUNT(*) AS count FROM legal_acceptances WHERE document_id = ?", [documentId]);
    assertLegalDocumentDeletable(usage?.count);
    await connection.query("DELETE FROM legal_documents WHERE id = ?", [documentId]);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "legal_document_delete", objectType: "legal_document", objectId: documentId, oldStatus: document.is_active ? "active" : "inactive", reason: String(document.title).slice(0, 500) });
  });
  response.json({ deleted: true });
}));

router.get("/admin/audit-log", asyncRoute(async (request, response) => {
  if (!(await isAdmin(getPool(), request.bookMeetUser.id))) return response.status(403).json({ error: "Доступно только администратору" });
  const limit = Math.max(1, Math.min(200, Number(request.query.limit) || 100));
  const [actions] = await getPool().query("SELECT * FROM moderation_audit_log ORDER BY created_at DESC LIMIT ?", [limit]);
  response.json({ actions });
}));

router.get("/admin/security-events", asyncRoute(async (request, response) => {
  if (!(await isAdmin(getPool(), request.bookMeetUser.id))) return response.status(403).json({ error: "Доступно только администратору" });
  const [events] = await getPool().query("SELECT id, user_id, event_type, result, details, created_at FROM security_event_log ORDER BY created_at DESC LIMIT 200");
  response.json({ events });
}));

router.delete("/admin/sessions", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  if (!(await isAdmin(getPool(), adminId))) return response.status(403).json({ error: "Доступно только администратору" });
  await withTransaction(async (connection) => {
    await connection.query("DELETE FROM sessions WHERE user_id = ?", [adminId]);
    await logSecurityEvent(connection, request, { userId: adminId, eventType: "admin_sessions_terminate_all", result: "success" });
  });
  response.setHeader("Set-Cookie", clearSessionCookie(request));
  response.json({ terminated: true });
}));

router.post("/admin/age-boundaries/audit", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  if (!(await isAdmin(getPool(), adminId))) return response.status(403).json({ error: "Доступно только администратору" });
  const removed = await withTransaction(async (connection) => {
    const count = await removeCrossAgeRelationships(connection);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "cross_age_relationship_audit", objectType: "friendships", reason: `removed:${count}` });
    return count;
  });
  response.json({ removed });
}));

function legacyTelegramSettings(state) {
  const enabledCanonical = NOTIFICATION_CATEGORIES.filter((category) => state.categories[category].telegramEnabled);
  return {
    connected: state.readiness.telegram.connected,
    available: state.readiness.telegram.available,
    enabled: state.readiness.telegram.available && enabledCanonical.length > 0,
    categories: legacyTelegramCategoriesForPreferences(enabledCanonical),
  };
}

router.post("/users/me/telegram-link", notificationPreferenceRateLimit, asyncRoute(async (request, response) => {
  if (!telegramLinkConfiguration().ready) return response.status(503).json({ code: "TELEGRAM_NOTIFICATIONS_UNAVAILABLE", error: "Подключение Telegram временно недоступно" });
  const link = await withTransaction(async (connection) => {
    const [[account]] = await connection.query("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND purged_at IS NULL FOR UPDATE", [request.bookMeetUser.id]);
    if (!account) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
    return replaceTelegramLinkToken(connection, request.bookMeetUser.id);
  });
  response.status(201).json({ deepLink: telegramDeepLink(link.token), expiresAt: link.expiresAt.toISOString() });
}));

router.post("/users/me/telegram/test", notificationPreferenceRateLimit, asyncRoute(async (request, response) => {
  const [[account]] = await getPool().query(
    "SELECT telegram_user_id, telegram_connected_at FROM users WHERE id = ? AND deleted_at IS NULL AND purged_at IS NULL",
    [request.bookMeetUser.id],
  );
  if (!telegramLinkConfiguration().ready || !account?.telegram_user_id || !account?.telegram_connected_at) return response.status(409).json({ code: "TELEGRAM_NOTIFICATIONS_UNAVAILABLE", error: "Telegram не подключён" });
  try {
    await createTelegramNotificationAdapter()({
      idempotencyKey: `telegram-test:${request.bookMeetUser.id}:${Date.now()}`,
      mode: "immediate",
      recipient: { userId: request.bookMeetUser.id, telegramUserId: Number(account.telegram_user_id), telegramConnected: true },
      payload: { title: "Book Meet", summary: "Тестовое уведомление доставлено.", link: null },
    });
  } catch (error) {
    if (error?.code !== "TELEGRAM_CHANNEL_BLOCKED") throw error;
    await withTransaction((connection) => markTelegramChannelError(connection, request.bookMeetUser.id));
    return response.status(409).json({ code: "TELEGRAM_CHANNEL_BLOCKED", error: "Бот заблокирован. Подключите Telegram повторно после разблокировки" });
  }
  await getPool().query("UPDATE users SET telegram_delivery_error_at = NULL WHERE id = ?", [request.bookMeetUser.id]);
  response.json({ delivered: true });
}));

router.get("/users/me/telegram-notifications", asyncRoute(async (request, response) => {
  const state = await loadNotificationPreferences(getPool(), request.bookMeetUser.id, request.get("X-BookMeet-Timezone"));
  response.json(legacyTelegramSettings(state));
}));

router.patch("/users/me/telegram-notifications", notificationPreferenceRateLimit, asyncRoute(async (request, response) => {
  const requestedCategories = Array.isArray(request.body?.categories) ? request.body.categories.map(String) : [];
  if (requestedCategories.some((category) => !LEGACY_TELEGRAM_NOTIFICATION_CATEGORIES.includes(category))) {
    return response.status(400).json({ code: "INVALID_NOTIFICATION_PREFERENCES", error: "Некорректная категория Telegram-уведомлений" });
  }
  const enabled = request.body?.enabled === true;
  const selectedCanonical = new Set(canonicalCategoriesForLegacyTelegram(requestedCategories));
  if (enabled && selectedCanonical.size === 0) {
    return response.status(400).json({ code: "INVALID_NOTIFICATION_PREFERENCES", error: "Выбранные категории не поддерживаются новым центром уведомлений" });
  }
  const state = await withTransaction(async (connection) => {
    const current = await loadNotificationPreferences(connection, request.bookMeetUser.id, request.get("X-BookMeet-Timezone"));
    if (enabled && !current.readiness.telegram.available) {
      throw Object.assign(new Error("Telegram-уведомления недоступны: подключение аккаунта или доставка не подтверждены"), { statusCode: 409, code: "TELEGRAM_NOTIFICATIONS_UNAVAILABLE" });
    }
    for (const category of NOTIFICATION_CATEGORIES) {
      const preference = current.categories[category];
      await connection.query(
        `INSERT INTO notification_preferences (user_id, category, in_app_enabled, telegram_enabled, email_mode)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE telegram_enabled = VALUES(telegram_enabled), updated_at = CURRENT_TIMESTAMP`,
        [request.bookMeetUser.id, category, preference.inAppEnabled ? 1 : 0, enabled && selectedCanonical.has(category) ? 1 : 0, preference.emailMode],
      );
      if (!enabled || !selectedCanonical.has(category)) {
        await cancelNotificationDeliveries(connection, { userId: request.bookMeetUser.id, channel: "telegram", category });
      }
    }
    await connection.query(
      "UPDATE users SET telegram_notifications_enabled = ?, telegram_notification_categories = ? WHERE id = ?",
      [enabled ? 1 : 0, enabled ? JSON.stringify(requestedCategories) : null, request.bookMeetUser.id],
    );
    return loadNotificationPreferences(connection, request.bookMeetUser.id, request.get("X-BookMeet-Timezone"));
  });
  response.json(legacyTelegramSettings(state));
}));

router.delete("/users/me/telegram", notificationPreferenceRateLimit, asyncRoute(async (request, response) => {
  await withTransaction(async (connection) => {
    // telegram_subject is a legacy social-auth identity and is deliberately
    // retained. It is never proof that the user-notification channel is linked.
    await connection.query("UPDATE users SET telegram_user_id = NULL, telegram_connected_at = NULL, telegram_display_name = NULL, telegram_delivery_error_at = NULL, telegram_notifications_enabled = 0, telegram_notification_categories = NULL WHERE id = ?", [request.bookMeetUser.id]);
    await connection.query("DELETE FROM telegram_link_tokens WHERE user_id = ?", [request.bookMeetUser.id]);
    await connection.query("UPDATE notification_preferences SET telegram_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [request.bookMeetUser.id]);
    await cancelNotificationDeliveries(connection, { userId: request.bookMeetUser.id, channel: "telegram" });
    await logSecurityEvent(connection, request, { userId: request.bookMeetUser.id, eventType: "telegram_disconnect", result: "success" });
  });
  response.json({ disconnected: true });
}));

router.get("/admin/incidents", asyncRoute(async (request, response) => {
  if (!(await isAdmin(getPool(), request.bookMeetUser.id))) return response.status(403).json({ error: "Доступно только администратору" });
  const [incidents] = await getPool().query("SELECT * FROM security_incidents ORDER BY detected_at DESC");
  response.json({ incidents });
}));

router.post("/admin/incidents", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  if (!(await isAdmin(getPool(), adminId))) return response.status(403).json({ error: "Доступно только администратору" });
  const description = String(request.body?.description ?? "").trim().slice(0, 20_000);
  const affectedData = String(request.body?.affectedData ?? "").trim().slice(0, 20_000);
  const cause = String(request.body?.cause ?? "").trim().slice(0, 20_000);
  const measures = String(request.body?.measures ?? "").trim().slice(0, 20_000);
  if (!description || !affectedData || !cause || !measures) return response.status(400).json({ error: "Заполните описание, затронутые данные, причину и меры" });
  const incidentId = await withTransaction(async (connection) => {
    const provisionalCode = `pending-${randomBytes(12).toString("hex")}`;
    const [created] = await connection.query(
      "INSERT INTO security_incidents (incident_code, detected_at, description, affected_data, affected_user_count, cause, measures, resolved_at, authority_notified_at, created_by_user_id) VALUES (?, COALESCE(?, UTC_TIMESTAMP()), ?, ?, ?, ?, ?, ?, ?, ?)",
      [provisionalCode, request.body?.detectedAt || null, description, affectedData, Math.max(0, Number(request.body?.affectedUserCount) || 0), cause, measures, request.body?.resolvedAt || null, request.body?.authorityNotifiedAt || null, adminId],
    );
    const code = `INC-${new Date().getUTCFullYear()}-${String(created.insertId).padStart(6, "0")}`;
    await connection.query("UPDATE security_incidents SET incident_code = ? WHERE id = ?", [code, created.insertId]);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "incident_create", objectType: "security_incident", objectId: created.insertId });
    return { id: Number(created.insertId), code };
  });
  response.status(201).json(incidentId);
}));

const PERSONAL_LINK_TYPES = new Set(["Читатель", "Писатель", "Блогер"]);

async function assertLinkedProfilePair(connection, personalUserId, communityUserId) {
  if (!personalUserId || !communityUserId || Number(personalUserId) === Number(communityUserId)) throw Object.assign(new Error("Нельзя связать этот профиль"), { statusCode: 400 });
  const [rows] = await connection.query(
    `SELECT u.id, u.deleted_at, u.purged_at, u.suspended_permanently, u.suspended_until, p.profile_type
       FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id IN (?, ?) FOR UPDATE`, [personalUserId, communityUserId],
  );
  const personal = rows.find((row) => Number(row.id) === Number(personalUserId));
  const community = rows.find((row) => Number(row.id) === Number(communityUserId));
  if (!personal || !community || !PERSONAL_LINK_TYPES.has(personal.profile_type) || community.profile_type !== "Сообщество") throw Object.assign(new Error("Связать можно только личный профиль и сообщество"), { statusCode: 409 });
  if ([personal, community].some((row) => row.deleted_at || row.purged_at || row.suspended_permanently || row.suspended_until && new Date(row.suspended_until).getTime() > Date.now())) throw Object.assign(new Error("Один из профилей недоступен"), { statusCode: 409 });
  const [[existing]] = await connection.query("SELECT personal_user_id, community_user_id FROM linked_profiles WHERE personal_user_id IN (?, ?) OR community_user_id IN (?, ?) FOR UPDATE", [personalUserId, communityUserId, personalUserId, communityUserId]);
  if (existing) throw Object.assign(new Error("Один из профилей уже связан"), { statusCode: 409 });
}

async function linkedCounterpart(connection, userId) {
  const [[row]] = await connection.query("SELECT CASE WHEN personal_user_id = ? THEN community_user_id ELSE personal_user_id END AS id FROM linked_profiles WHERE personal_user_id = ? OR community_user_id = ? LIMIT 1 FOR UPDATE", [userId, userId, userId]);
  return row ? Number(row.id) : null;
}

router.post("/linked-profiles/create", asyncRoute(async (request, response) => {
  const personalId = request.bookMeetUser.id;
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password ?? "");
  const name = safeProfileName(request.body?.name, "Новое сообщество");
  if (!isValidEmail(email) || password.length < 8) return response.status(400).json({ error: "Укажите e-mail и пароль не короче 8 символов" });
  const verificationToken = createOpaqueActionToken();
  const result = await withTransaction(async (connection) => {
    const [[duplicate]] = await connection.query("SELECT id FROM users WHERE email_key = ? FOR UPDATE", [email]);
    if (duplicate) throw Object.assign(new Error("Этот e-mail уже используется"), { statusCode: 409 });
    const username = await uniqueInternalUsername(connection, email.split("@")[0]);
    const [created] = await connection.query("INSERT INTO users (username, username_key, username_is_temporary, email, email_key, email_verified_at, password_hash, password_login_enabled, initials, color, role, profile_completed) VALUES (?, ?, 1, ?, ?, NULL, ?, 1, ?, 'blue', 'user', 0)", [username, username, email, email, await hashPassword(password), name.slice(0, 4).toLocaleUpperCase("ru") || "BM"]);
    const communityId = Number(created.insertId);
    await connection.query("INSERT INTO profiles (user_id, display_name, city, city_id, profile_type, gender, publisher_status, bio, author_influences, writing_themes, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres) VALUES (?, ?, '', NULL, 'Сообщество', 'Не указан', 'draft', '', '', '', '', '', '', '', '[]', '[]')", [communityId, name]);
    await assertLinkedProfilePair(connection, personalId, communityId);
    await connection.query("INSERT INTO linked_profiles (personal_user_id, community_user_id) VALUES (?, ?)", [personalId, communityId]);
    // A linked community inherits current documents only while consent is mandatory.
    // When the temporary bypass is active, no acceptance is recorded on its behalf.
    const legalDocuments = legalConsentRequired() ? await activeLegalDocuments(connection, requestLocale(request)) : [];
    await recordLegalAcceptances(connection, communityId, legalDocuments);
    await replaceAccountActionToken(connection, { userId: communityId, purpose: "email_verify", token: verificationToken, ttlMinutes: EMAIL_VERIFICATION_TTL_MINUTES });
    return { communityId };
  });
  await sendVerificationEmail(email, verificationToken, requestLocale(request));
  response.status(201).json({ linkedProfile: { id: result.communityId, name, type: "Сообщество", profileCompleted: false }, created: true });
}));

router.post("/linked-profiles/attach", asyncRoute(async (request, response) => {
  const personalId = request.bookMeetUser.id;
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password ?? "");
  const totp = String(request.body?.totp ?? "");
  const result = await withTransaction(async (connection) => {
    const [[target]] = await connection.query("SELECT id, password_hash, password_login_enabled, totp_secret, totp_enabled FROM users WHERE email_key = ? FOR UPDATE", [email]);
    if (!target || !target.password_login_enabled || !(await verifyPassword(password, target.password_hash))) throw Object.assign(new Error("Не удалось подтвердить профиль сообщества"), { statusCode: 401 });
    if (target.totp_enabled && !totp) return { requiresTotp: true };
    if (target.totp_enabled && !verifyTotp(target.totp_secret, totp) && !(await consumeRecoveryCode(target.id, totp))) throw Object.assign(new Error("Неверный одноразовый код"), { statusCode: 401 });
    await assertLinkedProfilePair(connection, personalId, Number(target.id));
    await connection.query("INSERT INTO linked_profiles (personal_user_id, community_user_id) VALUES (?, ?)", [personalId, target.id]);
    return { id: Number(target.id) };
  });
  if (result.requiresTotp) return response.status(202).json(result);
  response.json({ linked: true, communityId: result.id });
}));

router.post("/linked-profiles/google", asyncRoute(async (request, response) => {
  if (!process.env.GOOGLE_CLIENT_ID) return response.status(503).json({ error: "Google-вход пока не настроен" });
  const credential = String(request.body?.credential ?? "");
  const mode = request.body?.mode === "create" ? "create" : "attach";
  if (!credential || credential.length > 16_000) return response.status(400).json({ error: "Google не передал данные для подтверждения" });
  let identity;
  try { identity = await verifyGoogleIdToken(credential); } catch { return response.status(401).json({ error: "Google не подтвердил данные входа" }); }
  const result = await withTransaction(async (connection) => {
    const personalId = request.bookMeetUser.id;
    let [[target]] = await connection.query("SELECT id FROM users WHERE google_subject = ? OR email_key = ? LIMIT 1 FOR UPDATE", [identity.sub, normalizeEmail(identity.email)]);
    if (!target && mode === "attach") throw Object.assign(new Error("Профиль сообщества не найден"), { statusCode: 404 });
    if (target && mode === "create") throw Object.assign(new Error("Этот Google-аккаунт уже зарегистрирован. Выберите привязку существующего профиля"), { statusCode: 409 });
    let created = false;
    if (!target) {
      const name = safeProfileName(request.body?.name || identity.name, "Новое сообщество");
      const username = await uniqueInternalUsername(connection, identity.email?.split("@")[0] || "community");
      const [insertResult] = await connection.query("INSERT INTO users (username, username_key, username_is_temporary, email, email_key, email_verified_at, password_hash, password_login_enabled, google_subject, initials, color, role, profile_completed) VALUES (?, ?, 1, ?, ?, UTC_TIMESTAMP(), ?, 0, ?, ?, 'blue', 'user', 0)", [username, username, normalizeEmail(identity.email), normalizeEmail(identity.email), await hashPassword(randomBytes(32).toString("base64url")), identity.sub, name.slice(0, 4).toLocaleUpperCase("ru") || "BM"]);
      const communityId = Number(insertResult.insertId);
      await connection.query("INSERT INTO profiles (user_id, display_name, city, city_id, profile_type, gender, publisher_status, bio, author_influences, writing_themes, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres) VALUES (?, ?, '', NULL, 'Сообщество', 'Не указан', 'draft', '', '', '', '', '', '', '', '[]', '[]')", [communityId, name]);
      target = { id: communityId };
      created = true;
    }
    await assertLinkedProfilePair(connection, personalId, Number(target.id));
    await connection.query("INSERT INTO linked_profiles (personal_user_id, community_user_id) VALUES (?, ?)", [personalId, target.id]);
    return { communityId: Number(target.id), created };
  });
  if (result.created) await sendGoogleAccountEmail(normalizeEmail(identity.email), true, requestLocale(request)).catch(() => undefined);
  response.json({ linked: true, ...result });
}));

router.post("/linked-profiles/switch", asyncRoute(async (request, response) => {
  const token = await withTransaction(async (connection) => {
    const targetId = await linkedCounterpart(connection, request.bookMeetUser.id);
    if (!targetId) throw Object.assign(new Error("Связанный профиль не найден"), { statusCode: 404 });
    const [[target]] = await connection.query("SELECT deleted_at, purged_at, suspended_permanently, suspended_until FROM users WHERE id = ? FOR UPDATE", [targetId]);
    if (!target || target.deleted_at || target.purged_at || target.suspended_permanently || target.suspended_until && new Date(target.suspended_until).getTime() > Date.now()) {
      throw Object.assign(new Error("Связанный профиль недоступен"), { statusCode: 409 });
    }
    const [[link]] = await connection.query(
      "SELECT personal_user_id FROM linked_profiles WHERE (personal_user_id = ? AND community_user_id = ?) OR (personal_user_id = ? AND community_user_id = ?) FOR UPDATE",
      [request.bookMeetUser.id, targetId, targetId, request.bookMeetUser.id],
    );
    if (!link) throw Object.assign(new Error("Связанный профиль не найден"), { statusCode: 404 });
    await connection.query("DELETE FROM sessions WHERE token_hash = ?", [request.bookMeetUser.tokenHash]);
    return { token: await createSession(connection, targetId, request, Number(link.personal_user_id)), targetId };
  });
  response.setHeader("Set-Cookie", sessionCookie(token.token, request));
  response.json(await loadBootstrap(token.targetId));
}));

router.delete(["/linked-profiles", "/linked-profiles/unlink"], asyncRoute(async (request, response) => {
  const [result] = await getPool().query("DELETE FROM linked_profiles WHERE personal_user_id = ? OR community_user_id = ?", [request.bookMeetUser.id, request.bookMeetUser.id]);
  if (!result.affectedRows) return response.status(404).json({ error: "Связанный профиль не найден" });
  response.json({ unlinked: true });
}));

router.get("/realtime", (request, response) => {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();
  response.write(`event: connected\ndata: ${Date.now()}\n\n`);
  const client = { response, userId: Number(request.bookMeetUser.id) };
  realtimeClients.add(client);
  const heartbeat = setInterval(async () => {
    response.write(": keep-alive\n\n");
    try {
      await getPool().query("UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [request.bookMeetUser.id]);
      presenceTouches.set(request.bookMeetUser.id, Date.now());
    } catch { /* Следующий heartbeat повторит обновление присутствия. */ }
  }, 20_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    realtimeClients.delete(client);
  });
});

router.use((request, response, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    response.once("finish", () => {
      if (response.statusCode >= 400) return;
      if (response.locals.suppressRealtime) return;
      if (response.locals.readingRealtimeUserId) broadcastReadingRealtime(response.locals.readingRealtimeUserId);
      if (response.locals.readingPresenceSignal) void broadcastReadingPresenceRealtime(response.locals.readingPresenceSignal).catch((error) => console.warn("Unable to signal reading presence", error));
      if (!response.locals.readingRealtimeUserId && !response.locals.readingPresenceSignal) {
        if (response.locals.chatRealtime) broadcastChatRealtime(response.locals.chatRealtime);
        else broadcastRealtime();
      }
    });
  }
  next();
});

router.use(createReadingSessionsRouter({ getPool, withTransaction, queueOwnerRealtime: (response, userId, { presenceBookId } = {}) => {
  response.locals.readingRealtimeUserId = Number(userId);
  if (presenceBookId) response.locals.readingPresenceSignal = { readerId: Number(userId), bookId: Number(presenceBookId) };
} }));
router.use(createReadingPresenceRouter({ getPool, withTransaction, queuePresenceRealtime: (response, signal) => {
  response.locals.readingRealtimeUserId = signal.readerId;
  response.locals.readingPresenceSignal = signal;
} }));

router.delete("/users/me/profile", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const [[account]] = await getPool().query("SELECT role, avatar_path, deleted_at FROM users WHERE id = ?", [userId]);
  if (!account || account.role === "admin") return response.status(403).json({ error: "Профиль администратора нельзя удалить этим способом" });
  if (!account.deleted_at) {
    await withTransaction(async (connection) => {
      await connection.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
      await connection.query(
        "UPDATE users SET avatar_path = NULL, deleted_at = UTC_TIMESTAMP(), deletion_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 DAY), consent_withdrawn_at = UTC_TIMESTAMP(), last_seen_at = NULL WHERE id = ?",
        [userId],
      );
      await logSecurityEvent(connection, request, { userId, eventType: "profile_deletion_requested", result: "success", details: "grace_period_days:15" });
    });
    await removeAvatarFile(account.avatar_path);
  }
  response.setHeader("Set-Cookie", clearSessionCookie(request));
  response.json({ ok: true, retentionDays: 15 });
}));

// The database is cleared before the old file is touched, so a failed unlink
// can never leave a profile pointing to an asset it no longer owns.
router.delete("/users/me/avatar", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const previousPath = await withTransaction(async (connection) => {
    const [[account]] = await connection.query("SELECT avatar_path FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!account) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
    await connection.query("UPDATE users SET avatar_path = NULL WHERE id = ?", [userId]);
    return account.avatar_path;
  });
  await removeAvatarFile(previousPath);
  response.json({ ok: true, avatarUrl: null });
}));

router.use(asyncRoute(async (request, response, next) => {
  const alwaysAllowed = request.path === "/users/me/state"
    || request.path === "/users/me/profile-complete"
    || request.path === "/legal/acceptances"
    || request.path === "/auth/logout"
    || request.path.startsWith("/admin/");
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) || alwaysAllowed) return next();
  const legalGate = await legalAccessState(getPool(), request.bookMeetUser.id, requestLocale(request));
  if (legalGate.pending.length) return response.status(428).json({ code: "LEGAL_REACCEPTANCE_REQUIRED", error: "Необходимо принять новую версию юридических документов", documents: legalGate.pending });
  const profileGate = await profileAccessState(getPool(), request.bookMeetUser.id);
  if (!profileGate.complete) return response.status(428).json({ code: "PROFILE_COMPLETION_REQUIRED", error: "Заполните имя, город и дату рождения в профиле", missing: profileGate.missing });
  await withTransaction((connection) => requireApprovedPublisher(connection, request.bookMeetUser.id));
  next();
}));

router.use(createMarketplaceListingsRouter({
  getPool, withTransaction, asyncRoute, saveImage: saveMarketplaceImage, removeImage: removeMarketplaceImage, ageFromBirthDate,
}));
router.use(createMarketplaceConversationsRouter({ getPool, withTransaction, asyncRoute, ageFromBirthDate, queueChatRealtime }));
router.use(createMarketplaceModerationRouter({ getPool, withTransaction, asyncRoute, isAdmin, logModerationAction, queueChatRealtime }));

router.post("/users/:userId/hide", asyncRoute(async (request, response) => {
  const hiderId = request.bookMeetUser.id;
  const hiddenId = Number(request.params.userId);
  if (!Number.isInteger(hiddenId) || hiddenId <= 0 || hiddenId === Number(hiderId)) return response.status(400).json({ error: "Нельзя скрыть этого пользователя" });
  await withTransaction(async (connection) => {
    const [[target]] = await connection.query("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND purged_at IS NULL FOR UPDATE", [hiddenId]);
    if (!target) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
    await connection.query("INSERT IGNORE INTO user_hides (hider_user_id, hidden_user_id) VALUES (?, ?)", [hiderId, hiddenId]);
  });
  response.status(201).json({ ok: true, hiddenUserId: hiddenId });
}));

router.delete("/users/:userId/hide", asyncRoute(async (request, response) => {
  const hiddenId = Number(request.params.userId);
  if (!Number.isInteger(hiddenId) || hiddenId <= 0) return response.status(400).json({ error: "Некорректный пользователь" });
  await getPool().query("DELETE FROM user_hides WHERE hider_user_id = ? AND hidden_user_id = ?", [request.bookMeetUser.id, hiddenId]);
  response.json({ ok: true });
}));

router.get("/users/me/hidden-users", asyncRoute(async (request, response) => {
  const cursor = Math.max(0, Number(request.query.cursor) || 0);
  const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 20));
  const [rows] = await getPool().query(
    `SELECT h.hidden_user_id, h.created_at, p.display_name, u.username, u.initials, u.color, u.avatar_path
       FROM user_hides h JOIN users u ON u.id = h.hidden_user_id JOIN profiles p ON p.user_id = u.id
      WHERE h.hider_user_id = ? AND h.hidden_user_id > ? ORDER BY h.hidden_user_id LIMIT ?`,
    [request.bookMeetUser.id, cursor, limit + 1],
  );
  const page = rows.slice(0, limit);
  response.json({ users: page.map((row) => ({ id: Number(row.hidden_user_id), displayName: row.display_name, username: row.username, initials: row.initials, color: row.color, avatarUrl: row.avatar_path ?? undefined, hiddenAt: new Date(row.created_at).toISOString() })), nextCursor: rows.length > limit ? Number(page.at(-1)?.hidden_user_id) : null });
}));

router.get("/users/mentions", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const query = String(request.query.q ?? "").trim().slice(0, 40);
  if (!query) return response.json({ users: [] });
  const [[viewer]] = await getPool().query(
    "SELECT u.role, p.profile_type, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ? LIMIT 1",
    [userId],
  );
  const personalTypes = new Set(["Читатель", "Писатель", "Блогер"]);
  const viewerPersonal = personalTypes.has(viewer?.profile_type);
  const viewerAge = ageFromBirthDate(viewer?.birth_date);
  const [rows] = await getPool().query(
    `SELECT u.id, u.username, u.initials, u.color, u.avatar_path, u.role, p.display_name, p.profile_type, p.birth_date
       FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE u.id <> ? AND u.deleted_at IS NULL AND u.purged_at IS NULL
        AND (u.username LIKE ? OR p.display_name LIKE ?)
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = u.id) OR (b.blocker_user_id = u.id AND b.blocked_user_id = ?))
        AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = u.id)
      ORDER BY p.display_name, u.id LIMIT 10`, [userId, `%${query}%`, `%${query}%`, userId, userId, userId],
  );
  response.json({ users: rows.filter((row) => {
    if (viewer?.role === "admin") return true;
    const targetPersonal = personalTypes.has(row.profile_type);
    if (!viewerPersonal || !targetPersonal) return true;
    const targetAge = ageFromBirthDate(row.birth_date);
    return viewerAge !== null && targetAge !== null && (viewerAge < 18) === (targetAge < 18);
  }).map((row) => ({ id: Number(row.id), username: row.username, displayName: row.display_name, initials: row.initials, color: row.color, avatarUrl: row.avatar_path ?? undefined })) });
}));

router.get("/auth/totp/status", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const [[account]] = await getPool().query(
    "SELECT role, totp_enabled, totp_pending_expires_at, totp_recovery_codes FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  if (account?.role !== "admin") return response.status(403).json({ error: "Настройка доступна только администратору" });
  const pending = account.totp_pending_expires_at && new Date(account.totp_pending_expires_at).getTime() > Date.now();
  response.json({
    enabled: Boolean(account.totp_enabled),
    pending: Boolean(pending),
    recoveryCodesLeft: jsonArray(account.totp_recovery_codes).length,
  });
}));

router.post("/auth/totp/setup/start", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const password = String(request.body?.password ?? "");
  const [[account]] = await getPool().query(
    "SELECT role, email, password_hash, totp_enabled FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  if (account?.role !== "admin") return response.status(403).json({ error: "Настройка доступна только администратору" });
  if (account.totp_enabled) return response.status(409).json({ error: "Двухэтапная аутентификация уже включена" });
  if (!(await verifyPassword(password, account.password_hash))) return response.status(401).json({ error: "Неверный текущий пароль" });
  const secret = generateTotpSecret();
  const issuer = "Book Meet";
  const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  await getPool().query(
    "UPDATE users SET totp_pending_secret = ?, totp_pending_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) WHERE id = ?",
    [secret, userId],
  );
  const qrDataUrl = await QRCode.toDataURL(otpauth, {
    width: 260,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#153d66", light: "#ffffff" },
  });
  response.json({ secret, qrDataUrl, expiresInSeconds: 600 });
}));

router.post("/auth/totp/setup/confirm", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const code = String(request.body?.code ?? "");
  const result = await withTransaction(async (connection) => {
    const [[account]] = await connection.query(
      "SELECT role, totp_pending_secret, totp_pending_expires_at FROM users WHERE id = ? FOR UPDATE",
      [userId],
    );
    if (account?.role !== "admin") throw Object.assign(new Error("Настройка доступна только администратору"), { statusCode: 403 });
    if (!account.totp_pending_secret || !account.totp_pending_expires_at || new Date(account.totp_pending_expires_at).getTime() <= Date.now()) {
      throw Object.assign(new Error("Время настройки истекло. Создайте новый QR-код"), { statusCode: 410 });
    }
    if (!verifyTotp(account.totp_pending_secret, code)) throw Object.assign(new Error("Код не подошёл. Проверьте время на телефоне и попробуйте ещё раз"), { statusCode: 400 });
    const recoveryCodes = generateRecoveryCodes();
    const recoveryHashes = recoveryCodes.map(hashRecoveryCode);
    await connection.query(
      `UPDATE users
          SET totp_secret = totp_pending_secret,
              totp_pending_secret = NULL,
              totp_pending_expires_at = NULL,
              totp_enabled = 1,
              totp_recovery_codes = ?
        WHERE id = ?`,
      [JSON.stringify(recoveryHashes), userId],
    );
    return recoveryCodes;
  });
  response.json({ enabled: true, recoveryCodes: result });
}));

router.post("/auth/totp/recovery/regenerate", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const password = String(request.body?.password ?? "");
  const code = String(request.body?.code ?? "");
  const [[account]] = await getPool().query(
    "SELECT role, password_hash, totp_secret, totp_enabled FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  if (account?.role !== "admin") return response.status(403).json({ error: "Настройка доступна только администратору" });
  if (!account.totp_enabled) return response.status(409).json({ error: "Двухэтапная аутентификация не включена" });
  if (!(await verifyPassword(password, account.password_hash)) || !verifyTotp(account.totp_secret, code)) {
    return response.status(401).json({ error: "Пароль или одноразовый код не подошёл" });
  }
  const recoveryCodes = generateRecoveryCodes();
  await getPool().query(
    "UPDATE users SET totp_recovery_codes = ? WHERE id = ?",
    [JSON.stringify(recoveryCodes.map(hashRecoveryCode)), userId],
  );
  response.json({ recoveryCodes });
}));

router.post("/auth/totp/disable", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const password = String(request.body?.password ?? "");
  const code = String(request.body?.code ?? "");
  const result = await withTransaction(async (connection) => {
    const [[account]] = await connection.query(
      "SELECT role, password_hash, totp_secret, totp_enabled, totp_recovery_codes FROM users WHERE id = ? FOR UPDATE",
      [userId],
    );
    if (account?.role !== "admin") throw Object.assign(new Error("Настройка доступна только администратору"), { statusCode: 403 });
    if (!account.totp_enabled) throw Object.assign(new Error("Двухэтапная аутентификация не включена"), { statusCode: 409 });
    if (!(await verifyPassword(password, account.password_hash))) throw Object.assign(new Error("Неверный текущий пароль"), { statusCode: 401 });
    const recoveryHashes = jsonArray(account.totp_recovery_codes);
    if (!verifyTotp(account.totp_secret, code) && recoveryCodeIndex(recoveryHashes, code) < 0) {
      throw Object.assign(new Error("Одноразовый или резервный код не подошёл"), { statusCode: 401 });
    }
    await connection.query(
      `UPDATE users
          SET totp_secret = NULL,
              totp_pending_secret = NULL,
              totp_pending_expires_at = NULL,
              totp_enabled = 0,
              totp_recovery_codes = NULL
        WHERE id = ?`,
      [userId],
    );
    return true;
  });
  response.json({ disabled: result });
}));

router.post("/events", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const payload = eventPayload(request.body);
  const event = await withTransaction(async (connection) => {
    await assertAdultMaterialAllowed(connection, userId, payload.isAdult);
    const city = await knownCity(connection, payload.city, request.body?.cityId);
    const linkedBooks = await linkedBookPreviews(connection, payload.linkedBookIds);
    const linkedBook = linkedBooks[0];
    const [created] = await connection.query(
      `INSERT INTO events (creator_user_id, title, summary, description, is_adult, event_date, event_time, city, city_id, address, map_url, details_url, book_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, payload.title, payload.summary, payload.description, payload.isAdult ? 1 : 0, payload.date, payload.time, city.name, city.id, payload.address, payload.mapUrl || null, payload.detailsUrl || null, linkedBook?.id ?? null],
    );
    await syncMaterialBooks(connection, "event", created.insertId, linkedBooks.map((book) => book.id));
    await syncMentions(connection, { entityType: "event", entityId: Number(created.insertId), authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: `${payload.title}\n${payload.summary}\n${payload.description}`, publicMaterial: true, materialKind: "event", materialId: Number(created.insertId) });
    await enqueueTelegramAlert(connection, { eventType: "event_pending", entityId: created.insertId, actorUserId: userId, summary: payload.title });
    await createNotificationEvent(connection, {
      recipientUserId: userId,
      actorUserId: userId,
      eventType: "event_submitted",
      title: "Событие на модерации",
      body: `Событие «${payload.title}» отправлено на модерацию. Вы уже видите его на главной странице.`,
      materialKind: "event",
      materialId: created.insertId,
      dedupeKey: `event-submitted:event:${created.insertId}`,
    });
    return {
      id: Number(created.insertId), creatorId: userId, ...payload, city: city.name, cityId: city.id,
      linkedBookId: linkedBook ? Number(linkedBook.id) : undefined,
      linkedBookIds: linkedBooks.map((book) => book.id), linkedBooks,
      bookTitle: linkedBook?.title, bookAuthor: linkedBook?.author, bookAnnotation: linkedBook?.annotation,
      bookCoverUrl: linkedBook?.coverUrl, bookCoverTone: linkedBook?.coverTone,
      pinned: false, status: "pending", moderationNote: "", createdAt: new Date().toISOString(),
    };
  });
  response.status(201).json({ event });
}));

router.get("/events/:id/attendees", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const eventId = Number(request.params.id);
  const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
  const pageSize = 8;
  if (!eventId) return response.status(400).json({ error: "Некорректное событие" });
  const pool = getPool();
  const [[event]] = await pool.query("SELECT id, creator_user_id, status FROM events WHERE id = ? LIMIT 1", [eventId]);
  if (!event || event.status !== "published" && Number(event.creator_user_id) !== userId && !(await isAdmin(pool, userId))) {
    return response.status(404).json({ error: "Событие не найдено" });
  }
  await assertAdultMaterialReadable(pool, userId, "event", eventId);
  const [[countRow]] = await pool.query("SELECT COUNT(*) AS total FROM event_reminders er JOIN users u ON u.id = er.user_id WHERE er.event_id = ? AND u.deleted_at IS NULL AND u.purged_at IS NULL", [eventId]);
  const total = Number(countRow?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const [rows] = await pool.query(
    `SELECT u.id, u.initials, u.color, u.avatar_path, p.display_name, p.profile_type, p.city
       FROM event_reminders er
       JOIN users u ON u.id = er.user_id
       JOIN profiles p ON p.user_id = u.id
      WHERE er.event_id = ? AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY er.created_at, er.user_id
      LIMIT ? OFFSET ?`,
    [eventId, pageSize, (safePage - 1) * pageSize],
  );
  response.json({
    attendees: rows.map((row) => ({ id: Number(row.id), name: row.display_name, type: row.profile_type, city: row.city ?? "", initials: row.initials, color: row.color, avatarUrl: row.avatar_path ?? undefined })),
    page: safePage,
    pageCount,
    total,
  });
}));

router.post("/events/:id/reminder", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const eventId = Number(request.params.id);
  if (!eventId) return response.status(400).json({ error: "Некорректное событие" });
  await withTransaction(async (connection) => {
    const [[event]] = await connection.query(
      `SELECT id FROM events
        WHERE id = ? AND status = 'published'
          AND TIMESTAMP(event_date, event_time) > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 HOUR)
        LIMIT 1`,
      [eventId],
    );
    if (!event) throw Object.assign(new Error("Событие не найдено или уже завершилось"), { statusCode: 404 });
    await connection.query("INSERT IGNORE INTO event_reminders (user_id, event_id) VALUES (?, ?)", [userId, eventId]);
  });
  response.status(201).json({ ok: true });
}));

router.delete("/events/:id/reminder", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const eventId = Number(request.params.id);
  const deleted = await withTransaction(async (connection) => {
    const [result] = await connection.query("DELETE FROM event_reminders WHERE user_id = ? AND event_id = ?", [userId, eventId]);
    if (!result.affectedRows) return false;
    await cancelNotificationDeliveries(connection, { userId, materialKind: "event", materialId: eventId, eventType: "event_reminder" });
    await connection.query("DELETE FROM notifications WHERE user_id = ? AND material_kind = 'event' AND material_id = ? AND notification_type = 'event_reminder'", [userId, eventId]);
    return true;
  });
  if (!deleted) return response.status(404).json({ error: "Напоминание не найдено" });
  response.json({ ok: true });
}));

router.patch("/events/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const eventId = Number(request.params.id);
  const payload = eventPayload(request.body);
  const event = await withTransaction(async (connection) => {
    await assertAdultMaterialAllowed(connection, userId, payload.isAdult);
    const [[current]] = await connection.query("SELECT status FROM events WHERE id = ? AND creator_user_id = ? FOR UPDATE", [eventId, userId]);
    if (!current) throw Object.assign(new Error("Событие не найдено"), { statusCode: 404 });
    const city = await knownCity(connection, payload.city, request.body?.cityId);
    const linkedBooks = await linkedBookPreviews(connection, payload.linkedBookIds);
    const linkedBook = linkedBooks[0];
    await connection.query(
      `UPDATE events SET title = ?, summary = ?, description = ?, is_adult = ?, event_date = ?, event_time = ?, city = ?, city_id = ?, address = ?, map_url = ?, details_url = ?, book_id = ?, status = 'pending', moderation_note = NULL, is_pinned = 0 WHERE id = ?`,
      [payload.title, payload.summary, payload.description, payload.isAdult ? 1 : 0, payload.date, payload.time, city.name, city.id, payload.address, payload.mapUrl || null, payload.detailsUrl || null, linkedBook?.id ?? null, eventId],
    );
    await syncMaterialBooks(connection, "event", eventId, linkedBooks.map((book) => book.id));
    await syncMentions(connection, { entityType: "event", entityId: eventId, authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: `${payload.title}\n${payload.summary}\n${payload.description}`, publicMaterial: true, materialKind: "event", materialId: eventId });
    await enqueueTelegramAlert(connection, { eventType: "event_pending", entityId: eventId, actorUserId: userId, summary: payload.title, dedupeKey: `event_pending:${eventId}:${randomBytes(8).toString("hex")}` });
    return {
      id: eventId, creatorId: userId, ...payload, city: city.name, cityId: city.id,
      linkedBookId: linkedBook ? Number(linkedBook.id) : undefined,
      linkedBookIds: linkedBooks.map((book) => book.id), linkedBooks,
      bookTitle: linkedBook?.title, bookAuthor: linkedBook?.author, bookAnnotation: linkedBook?.annotation,
      bookCoverUrl: linkedBook?.coverUrl, bookCoverTone: linkedBook?.coverTone,
      pinned: false, status: "pending", moderationNote: "", createdAt: new Date().toISOString(),
    };
  });
  response.json({ event });
}));

router.delete("/events/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const eventId = Number(request.params.id);
  await withTransaction(async (connection) => {
    await cancelNotificationDeliveries(connection, { materialKind: "event", materialId: eventId });
    await connection.query("DELETE FROM notifications WHERE material_kind = 'event' AND material_id = ?", [eventId]);
    await connection.query("DELETE FROM content_mentions WHERE entity_type = 'event' AND entity_id = ?", [eventId]);
    await connection.query("DELETE FROM material_books WHERE material_kind = 'event' AND material_id = ?", [eventId]);
    const [deleted] = await connection.query("DELETE FROM events WHERE id = ? AND creator_user_id = ?", [eventId, userId]);
    if (!deleted.affectedRows) throw Object.assign(new Error("Событие не найдено"), { statusCode: 404 });
  });
  response.json({ ok: true });
}));

router.patch("/admin/events/:id", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const eventId = Number(request.params.id);
  const action = String(request.body?.action ?? "");
  const note = String(request.body?.note ?? "").trim().slice(0, 3000);
  const updated = await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const [[current]] = await connection.query("SELECT * FROM events WHERE id = ? FOR UPDATE", [eventId]);
    if (!current) throw Object.assign(new Error("Событие не найдено"), { statusCode: 404 });
    let moderationStatus = current.status;
    if (action === "edit") {
      const payload = eventPayload(request.body?.event);
      const city = await knownCity(connection, payload.city, request.body?.event?.cityId);
      const linkedBooks = await linkedBookPreviews(connection, payload.linkedBookIds);
      await connection.query(
        `UPDATE events SET title = ?, summary = ?, description = ?, is_adult = ?, event_date = ?, event_time = ?, city = ?, city_id = ?, address = ?, map_url = ?, details_url = ?, book_id = ? WHERE id = ?`,
        [payload.title, payload.summary, payload.description, payload.isAdult ? 1 : 0, payload.date, payload.time, city.name, city.id, payload.address, payload.mapUrl || null, payload.detailsUrl || null, payload.linkedBookId ?? null, eventId],
      );
      await syncMaterialBooks(connection, "event", eventId, linkedBooks.map((book) => book.id));
    } else {
      const statuses = { accept: "published", revision: "needs_changes", reject: "rejected" };
      const status = statuses[action];
      if (!status) throw Object.assign(new Error("Неизвестное действие модерации"), { statusCode: 400 });
      moderationStatus = status;
      const pinned = action === "accept" && Boolean(request.body?.pinned);
      await connection.query("UPDATE events SET status = ?, moderation_note = ?, is_pinned = ? WHERE id = ?", [status, note || null, pinned ? 1 : 0, eventId]);
      if (Number(current.creator_user_id) !== adminId) {
        const titles = { accept: "Событие опубликовано", revision: "Событие требует доработки", reject: "Событие отклонено" };
        const bodies = { accept: `Событие «${current.title}» прошло модерацию и опубликовано.`, revision: `Событие «${current.title}» отправлено на доработку.${note ? ` Комментарий: ${note}` : ""}`, reject: `Событие «${current.title}» отклонено.${note ? ` Причина: ${note}` : ""}` };
        await createNotificationEvent(connection, {
          recipientUserId: current.creator_user_id,
          actorUserId: adminId,
          eventType: "event_moderation",
          title: titles[action],
          body: bodies[action],
          materialKind: "event",
          materialId: eventId,
          dedupeKey: `event-moderation:event:${eventId}:${status}`,
        });
      }
    }
    await logModerationAction(connection, { adminUserId: adminId, actionType: action === "edit" ? "event_edit" : "event_moderate", objectType: "event", objectId: eventId, oldStatus: current.status, newStatus: moderationStatus, reason: note || null });
    return { ok: true };
  });
  response.json(updated);
}));

router.post("/occasions", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const payload = occasionPayload(request.body);
  const occasion = await withTransaction(async (connection) => {
    await assertAdultMaterialAllowed(connection, userId, payload.isAdult);
    const access = await publisherAccess(connection, userId);
    if (access.isPublisher) throw Object.assign(new Error("Организационные профили не могут создавать поводы познакомиться"), { statusCode: 403 });
    const cities = await knownCities(connection, payload.targetCities);
    payload.targetCities = cities.map((city) => city.name);
    if (payload.meetingCity) payload.meetingCityId = cities.find((city) => city.name === payload.meetingCity)?.id;
    if (payload.type === "invite" && cities[0]) { payload.meetingCity = cities[0].name; payload.meetingCityId = cities[0].id; }
    const linkedBooks = payload.linkedBookId ? await linkedBookPreviews(connection, [payload.linkedBookId]) : [];
    const [[creator]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
    const [created] = await connection.query(
      `INSERT INTO occasions (creator_user_id, occasion_type, primary_text, audience_text, is_adult, target_gender, target_cities, target_profile_type, meeting_date, meeting_start_time, meeting_end_time, meeting_city, meeting_city_id, meeting_address, meeting_map_url, book_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, payload.type, payload.primaryText, payload.audienceText, payload.isAdult ? 1 : 0, payload.targetGender, JSON.stringify(payload.targetCities), payload.targetProfileType, payload.meetingDate ?? null, payload.meetingStartTime ?? null, payload.meetingEndTime ?? null, payload.meetingCity ?? null, payload.meetingCityId ?? null, payload.meetingAddress ?? null, payload.meetingMapUrl || null, payload.linkedBookId ?? null],
    );
    await syncMaterialBooks(connection, "occasion", created.insertId, linkedBooks.map((book) => book.id));
    await syncMentions(connection, { entityType: "occasion", entityId: Number(created.insertId), authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: `${payload.primaryText}\n${payload.audienceText}`, publicMaterial: true, materialKind: "occasion", materialId: Number(created.insertId) });
    await enqueueTelegramAlert(connection, { eventType: "occasion_pending", entityId: created.insertId, actorUserId: userId, summary: payload.primaryText });
    await createNotificationEvent(connection, {
      recipientUserId: userId,
      actorUserId: userId,
      eventType: "event_submitted",
      title: "Повод на модерации",
      body: "Повод для знакомства отправлен на модерацию. Вы уже видите его на главной странице.",
      materialKind: "occasion",
      materialId: created.insertId,
      dedupeKey: `event-submitted:occasion:${created.insertId}`,
    });
    return { id: Number(created.insertId), creatorId: userId, ...payload, linkedBooks, status: "pending", moderationNote: "", creatorName: creator?.display_name ?? "", createdAt: new Date().toISOString() };
  });
  response.status(201).json({ occasion });
}));

router.patch("/occasions/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const occasionId = Number(request.params.id);
  const payload = occasionPayload(request.body);
  const occasion = await withTransaction(async (connection) => {
    await assertAdultMaterialAllowed(connection, userId, payload.isAdult);
    const cities = await knownCities(connection, payload.targetCities);
    payload.targetCities = cities.map((city) => city.name);
    if (payload.meetingCity) payload.meetingCityId = cities.find((city) => city.name === payload.meetingCity)?.id;
    if (payload.type === "invite" && cities[0]) { payload.meetingCity = cities[0].name; payload.meetingCityId = cities[0].id; }
    const linkedBooks = payload.linkedBookId ? await linkedBookPreviews(connection, [payload.linkedBookId]) : [];
    const [[current]] = await connection.query("SELECT status, created_at FROM occasions WHERE id = ? AND creator_user_id = ? FOR UPDATE", [occasionId, userId]);
    if (!current) throw Object.assign(new Error("Повод не найден"), { statusCode: 404 });
    await connection.query(
      `UPDATE occasions SET occasion_type = ?, primary_text = ?, audience_text = ?, is_adult = ?, target_gender = ?, target_cities = ?, target_profile_type = ?, meeting_date = ?, meeting_start_time = ?, meeting_end_time = ?, meeting_city = ?, meeting_city_id = ?, meeting_address = ?, meeting_map_url = ?, book_id = ?, status = 'pending', moderation_note = NULL WHERE id = ?`,
      [payload.type, payload.primaryText, payload.audienceText, payload.isAdult ? 1 : 0, payload.targetGender, JSON.stringify(payload.targetCities), payload.targetProfileType, payload.meetingDate ?? null, payload.meetingStartTime ?? null, payload.meetingEndTime ?? null, payload.meetingCity ?? null, payload.meetingCityId ?? null, payload.meetingAddress ?? null, payload.meetingMapUrl || null, payload.linkedBookId ?? null, occasionId],
    );
    await syncMaterialBooks(connection, "occasion", occasionId, linkedBooks.map((book) => book.id));
    await syncMentions(connection, { entityType: "occasion", entityId: occasionId, authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: `${payload.primaryText}\n${payload.audienceText}`, publicMaterial: true, materialKind: "occasion", materialId: occasionId });
    await enqueueTelegramAlert(connection, { eventType: "occasion_pending", entityId: occasionId, actorUserId: userId, summary: payload.primaryText, dedupeKey: `occasion_pending:${occasionId}:${randomBytes(8).toString("hex")}` });
    const [[creator]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
    return { id: occasionId, creatorId: userId, ...payload, linkedBooks, status: "pending", moderationNote: "", creatorName: creator?.display_name ?? "", createdAt: new Date(current.created_at).toISOString() };
  });
  response.json({ occasion });
}));

router.delete("/occasions/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const occasionId = Number(request.params.id);
  await withTransaction(async (connection) => {
    await cancelNotificationDeliveries(connection, { materialKind: "occasion", materialId: occasionId });
    await connection.query("DELETE FROM notifications WHERE material_kind = 'occasion' AND material_id = ?", [occasionId]);
    await connection.query("DELETE FROM content_mentions WHERE entity_type = 'occasion' AND entity_id = ?", [occasionId]);
    await connection.query("DELETE FROM material_books WHERE material_kind = 'occasion' AND material_id = ?", [occasionId]);
    const [deleted] = await connection.query("DELETE FROM occasions WHERE id = ? AND creator_user_id = ?", [occasionId, userId]);
    if (!deleted.affectedRows) throw Object.assign(new Error("Повод не найден"), { statusCode: 404 });
  });
  response.json({ ok: true });
}));

router.patch("/admin/occasions/:id", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const occasionId = Number(request.params.id);
  const action = String(request.body?.action ?? "");
  const note = String(request.body?.note ?? "").trim().slice(0, 3000);
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const [[current]] = await connection.query("SELECT * FROM occasions WHERE id = ? FOR UPDATE", [occasionId]);
    if (!current) throw Object.assign(new Error("Повод не найден"), { statusCode: 404 });
    let moderationStatus = current.status;
    if (action === "edit") {
      const payload = occasionPayload(request.body?.occasion);
      const cities = await knownCities(connection, payload.targetCities);
      payload.targetCities = cities.map((city) => city.name);
      if (payload.meetingCity) payload.meetingCityId = cities.find((city) => city.name === payload.meetingCity)?.id;
      if (payload.type === "invite" && cities[0]) { payload.meetingCity = cities[0].name; payload.meetingCityId = cities[0].id; }
      const linkedBooks = payload.linkedBookId ? await linkedBookPreviews(connection, [payload.linkedBookId]) : [];
      await connection.query(
        `UPDATE occasions SET occasion_type = ?, primary_text = ?, audience_text = ?, is_adult = ?, target_gender = ?, target_cities = ?, target_profile_type = ?, meeting_date = ?, meeting_start_time = ?, meeting_end_time = ?, meeting_city = ?, meeting_city_id = ?, meeting_address = ?, meeting_map_url = ?, book_id = ? WHERE id = ?`,
        [payload.type, payload.primaryText, payload.audienceText, payload.isAdult ? 1 : 0, payload.targetGender, JSON.stringify(payload.targetCities), payload.targetProfileType, payload.meetingDate ?? null, payload.meetingStartTime ?? null, payload.meetingEndTime ?? null, payload.meetingCity ?? null, payload.meetingCityId ?? null, payload.meetingAddress ?? null, payload.meetingMapUrl || null, payload.linkedBookId ?? null, occasionId],
      );
      await syncMaterialBooks(connection, "occasion", occasionId, linkedBooks.map((book) => book.id));
    } else {
      const statuses = { accept: "published", revision: "needs_changes", reject: "rejected" };
      const status = statuses[action];
      if (!status) throw Object.assign(new Error("Неизвестное действие модерации"), { statusCode: 400 });
      moderationStatus = status;
      await connection.query("UPDATE occasions SET status = ?, moderation_note = ? WHERE id = ?", [status, note || null, occasionId]);
      if (Number(current.creator_user_id) !== adminId) {
        const titles = { accept: "Повод опубликован", revision: "Повод требует доработки", reject: "Повод отклонён" };
        await createNotificationEvent(connection, {
          recipientUserId: current.creator_user_id,
          actorUserId: adminId,
          eventType: "event_moderation",
          title: titles[action],
          body: `${titles[action]}.${note ? ` Комментарий: ${note}` : ""}`,
          materialKind: "occasion",
          materialId: occasionId,
          dedupeKey: `event-moderation:occasion:${occasionId}:${status}`,
        });
      }
    }
    await logModerationAction(connection, { adminUserId: adminId, actionType: action === "edit" ? "occasion_edit" : "occasion_moderate", objectType: "occasion", objectId: occasionId, oldStatus: current.status, newStatus: moderationStatus, reason: note || null });
  });
  response.json({ ok: true });
}));

router.patch("/admin/publishers/:id", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const publisherId = Number(request.params.id);
  const action = String(request.body?.action ?? "");
  const note = String(request.body?.note ?? "").trim().slice(0, 3000);
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const [[publisher]] = await connection.query(
      "SELECT p.publisher_status, p.display_name, p.profile_type FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND p.profile_type IN ('Издатель', 'Сообщество') FOR UPDATE",
      [publisherId],
    );
    if (!publisher) throw Object.assign(new Error("Профиль организации не найден"), { statusCode: 404 });
    const statuses = { accept: "approved", revision: "needs_changes", reject: "rejected" };
    const status = statuses[action];
    if (!status) throw Object.assign(new Error("Неизвестное действие модерации"), { statusCode: 400 });
    await connection.query(
      "UPDATE profiles SET publisher_status = ?, publisher_moderation_note = ? WHERE user_id = ?",
      [status, note || null, publisherId],
    );
    await logModerationAction(connection, { adminUserId: adminId, actionType: "organization_moderate", objectType: publisher.profile_type === "Сообщество" ? "community" : "publisher", objectId: publisherId, oldStatus: publisher.publisher_status, newStatus: status, reason: note || null });
    const organizationName = publisher.profile_type === "Сообщество" ? "сообщества" : "издательства";
    const titles = {
      accept: `Профиль ${organizationName} подтверждён`,
      revision: `Профиль ${organizationName} требует доработки`,
      reject: `Профиль ${organizationName} отклонён`,
    };
    await createNotificationEvent(connection, {
      recipientUserId: publisherId,
      actorUserId: adminId,
      eventType: "event_moderation",
      title: titles[action],
      body: `${titles[action]}.${note ? ` Комментарий: ${note}` : ""}`,
      dedupeKey: `organization-moderation:${publisherId}:${action}`,
    });
  });
  response.json({ ok: true });
}));

router.put("/users/me/state", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const { profile, avatarUrl, reviews = [], excerpts = [], publisherNews = [] } = request.body ?? {};
  const existingGate = await profileAccessState(getPool(), userId);
  if (!existingGate.complete && ((Array.isArray(reviews) && reviews.length) || (Array.isArray(excerpts) && excerpts.length) || (Array.isArray(publisherNews) && publisherNews.length))) {
    return response.status(428).json({ code: "PROFILE_COMPLETION_REQUIRED", error: "Сначала заполните обязательные поля профиля", missing: existingGate.missing });
  }
  const locale = requestLocale(request);
  const requestedUsernameValue = profile?.username ?? request.body?.username;
  const hasRequestedUsername = requestedUsernameValue !== undefined;
  const requestedUsername = normalizeUsername(requestedUsernameValue);
  const usernameError = hasRequestedUsername ? usernameValidationError(requestedUsername) : null;
  if (usernameError) return response.status(400).json({ code: usernameError, error: authText(locale, usernameError === "USERNAME_RESERVED" ? "usernameReserved" : "usernameInvalid") });
  const requestedType = profile?.type === "Писатель" ? "Писатель" : profile?.type === "Блогер" ? "Блогер" : profile?.type === "Издатель" ? "Издатель" : profile?.type === "Сообщество" ? "Сообщество" : "Читатель";
  const isOrganization = ["Издатель", "Сообщество"].includes(requestedType);
  if (!String(profile?.name ?? "").trim() || !isOrganization && !Number(profile?.cityId)) return response.status(400).json({ error: "Заполните обязательные поля" });
  const birthDate = isOrganization ? null : String(profile?.birthDate ?? "").trim();
  const birthAge = birthDate ? ageFromBirthDate(birthDate) : null;
  if (!isOrganization && (birthAge === null || birthAge < 0 || birthAge > 120)) {
    return response.status(400).json({ error: "Укажите корректную дату рождения" });
  }
  const tabOrder = Array.isArray(profile?.tabOrder)
    ? [...new Set(profile.tabOrder.filter((tab) => PROFILE_TABS.has(tab)))]
    : [];
  const hiddenProfileTabs = Array.isArray(profile?.hiddenProfileTabs)
    ? [...new Set(profile.hiddenProfileTabs.filter((tab) => PROFILE_TABS.has(tab) && tab !== "main" && tab !== "settings"))]
    : [];
  const socialVisibility = (value) => ["nobody", "friends", "everyone"].includes(value) ? value : "friends";
  await withTransaction(async (connection) => {
    const city = isOrganization && !String(profile.city ?? "").trim() && !profile.cityId
      ? null
      : await knownCity(connection, profile.city, profile.cityId);
    const [[currentProfile]] = await connection.query(
      `SELECT profile_type, publisher_status, publisher_legal_name, publisher_bin, publisher_account,
              publisher_bik, publisher_bank, publisher_legal_address, publisher_postal_address
         FROM profiles WHERE user_id = ? FOR UPDATE`,
      [userId],
    );
    const changesCommunitySemantics = currentProfile?.profile_type !== requestedType
      && (currentProfile?.profile_type === "Сообщество" || requestedType === "Сообщество");
    if (changesCommunitySemantics) {
      const [[friendship]] = await connection.query("SELECT 1 FROM friendships WHERE user_low_id = ? OR user_high_id = ? LIMIT 1", [userId, userId]);
      const [[membership]] = await connection.query("SELECT 1 FROM community_memberships WHERE community_user_id = ? OR member_user_id = ? LIMIT 1", [userId, userId]);
      const [[pendingRequest]] = await connection.query("SELECT 1 FROM friend_requests WHERE status = 'pending' AND (from_user_id = ? OR to_user_id = ?) LIMIT 1", [userId, userId]);
      if (friendship || membership || pendingRequest) {
        throw Object.assign(new Error("Перед сменой типа профиля завершите дружбу, участие в сообществах и ожидающие заявки"), { statusCode: 409 });
      }
    }
    const switchingToPublisher = isOrganization && currentProfile?.profile_type !== requestedType;
    const publisherStatus = isOrganization
      ? switchingToPublisher || currentProfile?.publisher_status !== "approved" ? "pending" : "approved"
      : "not_required";
    const isCommunity = requestedType === "Сообщество";
    const isPublisher = requestedType === "Издатель";
    const salesLinks = isPublisher ? publisherSalesLinks(profile.publisherSalesLinks) : [];
    const publisherLegal = {
      name: String(profile.publisherLegalName ?? "").trim() || String(currentProfile?.publisher_legal_name ?? "").trim(),
      bin: (String(profile.publisherBin ?? "").trim() || String(currentProfile?.publisher_bin ?? "").trim()).replace(/\D/g, "").slice(0, 12),
      account: String(profile.publisherAccount ?? "").trim() || String(currentProfile?.publisher_account ?? "").trim(),
      bik: String(profile.publisherBik ?? "").trim() || String(currentProfile?.publisher_bik ?? "").trim(),
      bank: String(profile.publisherBank ?? "").trim() || String(currentProfile?.publisher_bank ?? "").trim(),
      legalAddress: String(profile.publisherLegalAddress ?? "").trim() || String(currentProfile?.publisher_legal_address ?? "").trim(),
      postalAddress: String(profile.publisherPostalAddress ?? "").trim() || String(currentProfile?.publisher_postal_address ?? "").trim(),
    };
    const followersVisibility = isCommunity ? "everyone" : socialVisibility(profile.followersVisibility);
    const friendsVisibility = isCommunity ? "everyone" : socialVisibility(profile.friendsVisibility);
    const wishlistVisibility = isOrganization ? "nobody" : socialVisibility(profile.wishlistVisibility);
    if (isPublisher && currentProfile?.profile_type !== "Издатель") {
      await connection.query(
        `DELETE notification FROM notifications notification
          JOIN profiles recipient_profile ON recipient_profile.user_id = notification.user_id
         WHERE notification.notification_type = 'friend_request'
           AND (notification.user_id = ? OR notification.actor_user_id = ?)
           AND recipient_profile.profile_type <> 'Сообщество'`,
        [userId, userId],
      );
      await connection.query(
        `DELETE fr FROM friend_requests fr
          JOIN profiles target_profile ON target_profile.user_id = fr.to_user_id
         WHERE fr.status = 'pending'
           AND (fr.from_user_id = ? OR fr.to_user_id = ?)
           AND NOT (fr.from_user_id = ? AND target_profile.profile_type = 'Сообщество')`,
        [userId, userId, userId],
      );
    }
    const [[currentUser]] = await connection.query("SELECT avatar_path FROM users WHERE id = ? FOR UPDATE", [userId]);
    let avatarPath = currentUser?.avatar_path ?? null;
    if (avatarUrl !== undefined) {
      if (!avatarUrl) avatarPath = null;
      else if (String(avatarUrl).startsWith("data:image/")) avatarPath = await saveAvatar(avatarUrl);
      else if (String(avatarUrl).startsWith("/uploads/")) avatarPath = String(avatarUrl);
      else throw Object.assign(new Error("Некорректная фотография профиля"), { statusCode: 400 });
    }
    const initials = profile.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU").slice(0, 4) || "BM";
    if (hasRequestedUsername) {
      const [[existingUsername]] = await connection.query("SELECT id FROM users WHERE username_key = ? FOR UPDATE", [requestedUsername]);
      if (existingUsername && Number(existingUsername.id) !== Number(userId)) {
        throw Object.assign(new Error(authText(locale, "usernameTaken")), { statusCode: 409, code: "USERNAME_TAKEN" });
      }
    }
    await connection.query(
      "UPDATE users SET initials = ?, avatar_path = ?, username = CASE WHEN ? THEN ? ELSE username END, username_key = CASE WHEN ? THEN ? ELSE username_key END, username_is_temporary = CASE WHEN ? THEN 0 ELSE username_is_temporary END WHERE id = ?",
      [initials, avatarPath, hasRequestedUsername ? 1 : 0, requestedUsername, hasRequestedUsername ? 1 : 0, requestedUsername, hasRequestedUsername ? 1 : 0, userId],
    );
    await connection.query(
      `UPDATE profiles SET display_name = ?, city = ?, city_id = ?, profile_type = ?, gender = ?, birth_date = ?, show_birth_date_to_friends = ?, birth_date_visibility = ?, followers_visibility = ?, friends_visibility = ?, wishlist_visibility = ?, profile_tab_order = ?, hidden_profile_tabs = ?, home_view = ?, bio = ?, author_influences = ?, writing_themes = ?, weekend = ?, joy = ?, talk = ?, stranger_message = ?, favorite_genres = ?, disliked_genres = ?,
              publisher_status = ?, publisher_website = ?, publisher_sales_links = ?, publisher_legal_name = ?, publisher_bin = ?, publisher_account = ?, publisher_bik = ?, publisher_bank = ?, publisher_legal_address = ?, publisher_postal_address = ?,
              community_type = ?, community_rules = ?, community_is_closed = ?, publisher_moderation_note = CASE WHEN ? = 'pending' THEN NULL ELSE publisher_moderation_note END
        WHERE user_id = ?`,
      [
        profile.name.trim(), city?.name ?? "", city?.id ?? null, requestedType,
        isOrganization ? "Не указан" : ["Мужской", "Женский", "Не указан"].includes(profile.gender) ? profile.gender : "Не указан",
        birthDate || null,
        isOrganization ? 0 : (profile.birthDateVisibility ?? (profile.showBirthDateToFriends === false ? "nobody" : "friends")) === "friends" ? 1 : 0,
        isOrganization ? "nobody" : ["nobody", "friends", "everyone"].includes(profile.birthDateVisibility) ? profile.birthDateVisibility : profile.showBirthDateToFriends === false ? "nobody" : "friends",
        followersVisibility, friendsVisibility, wishlistVisibility,
        JSON.stringify(tabOrder), JSON.stringify(hiddenProfileTabs), "feed",
        profile.bio ?? "", requestedType === "Писатель" ? profile.authorInfluences ?? "" : "", requestedType === "Писатель" ? profile.writingThemes ?? "" : "",
        isOrganization ? "" : profile.weekend ?? "", isOrganization ? "" : profile.joy ?? "",
        isOrganization ? "" : profile.talk ?? "", isOrganization ? "" : profile.strangerMessage ?? "",
        isOrganization ? "[]" : JSON.stringify(profile.favoriteGenres ?? []), isOrganization ? "[]" : JSON.stringify(profile.dislikedGenres ?? []),
        publisherStatus, isPublisher ? cleanUrl(profile.publisherWebsite) : null,
        isPublisher ? JSON.stringify(salesLinks) : null,
        isPublisher ? publisherLegal.name : null,
        isPublisher ? publisherLegal.bin : null,
        isPublisher ? publisherLegal.account : null,
        isPublisher ? publisherLegal.bik : null,
        isPublisher ? publisherLegal.bank : null,
        isPublisher ? publisherLegal.legalAddress : null,
        isPublisher ? publisherLegal.postalAddress : null,
        isCommunity ? String(profile.communityType ?? "").trim().slice(0, 255) : null,
        isCommunity ? String(profile.communityRules ?? "").trim() : null,
        isCommunity && profile.communityIsClosed ? 1 : 0,
        publisherStatus, userId,
      ],
    );
    if (isOrganization && publisherStatus === "pending" && currentProfile?.publisher_status !== "pending") {
      await enqueueTelegramAlert(connection, { eventType: "organization_pending", entityId: userId, actorUserId: userId, summary: profile.name });
    }
    if (isOrganization) {
      const newsIds = [];
      for (const item of publisherNews) {
        const title = String(item?.title ?? "").trim();
        const previewText = String(item?.previewText ?? "").trim();
        if (!title || !previewText) continue;
        if (Array.from(previewText).length > 500) throw Object.assign(new Error("Краткий текст новости не должен превышать 500 знаков"), { statusCode: 400 });
        const bodyHtml = validateRichHtml(item.bodyHtml);
        const body = plainTextFromHtml(bodyHtml) || String(item.body ?? "").trim();
        await assertAdultMaterialAllowed(connection, userId, Boolean(item.isAdult));
        const desiredId = Number(item.id);
        const [[existing]] = desiredId ? await connection.query("SELECT user_id FROM publisher_news WHERE id = ?", [desiredId]) : [[]];
        if (existing && Number(existing.user_id) !== userId) throw Object.assign(new Error("Нельзя изменить чужую новость"), { statusCode: 403 });
        if (existing) {
          await connection.query("UPDATE publisher_news SET title = ?, preview_text = ?, body_html = ?, body = ?, is_adult = ? WHERE id = ? AND user_id = ?", [title, previewText, bodyHtml, body, item.isAdult ? 1 : 0, desiredId, userId]);
          newsIds.push(desiredId);
          await syncMentions(connection, { entityType: "publisher_news", entityId: desiredId, authorUserId: userId, mentionUserIds: item.mentionUserIds ?? item.mentions, text: `${title}\n${previewText}\n${plainTextFromHtml(bodyHtml)}`, publicMaterial: true, materialKind: "publisher_news", materialId: desiredId });
        } else if (publisherStatus === "approved") {
          const [created] = desiredId
            ? await connection.query("INSERT INTO publisher_news (id, user_id, title, preview_text, body_html, body, is_adult) VALUES (?, ?, ?, ?, ?, ?, ?)", [desiredId, userId, title, previewText, bodyHtml, body, item.isAdult ? 1 : 0])
            : await connection.query("INSERT INTO publisher_news (user_id, title, preview_text, body_html, body, is_adult) VALUES (?, ?, ?, ?, ?, ?)", [userId, title, previewText, bodyHtml, body, item.isAdult ? 1 : 0]);
          const newsId = desiredId || Number(created.insertId);
          newsIds.push(newsId);
          await syncMentions(connection, { entityType: "publisher_news", entityId: newsId, authorUserId: userId, mentionUserIds: item.mentionUserIds ?? item.mentions, text: `${title}\n${previewText}\n${plainTextFromHtml(bodyHtml)}`, publicMaterial: true, materialKind: "publisher_news", materialId: newsId });
        }
      }
      if (newsIds.length) await connection.query(`DELETE FROM publisher_news WHERE user_id = ? AND id NOT IN (${newsIds.map(() => "?").join(",")})`, [userId, ...newsIds]);
      else if (publisherStatus === "approved") await connection.query("DELETE FROM publisher_news WHERE user_id = ?", [userId]);
      await connection.query("DELETE mentions FROM content_mentions mentions LEFT JOIN publisher_news news ON news.id = mentions.entity_id WHERE mentions.entity_type = 'publisher_news' AND news.id IS NULL");
    }
    if (["Читатель", "Писатель", "Блогер"].includes(requestedType)) {
      const reviewIds = [];
      for (const review of reviews) {
      if (!review.bookTitle?.trim() || !review.bookAuthor?.trim() || !review.rating || !review.preview?.trim() || !String(review.bodyHtml ?? review.fullText ?? "").trim()) continue;
      if (!Number.isInteger(Number(review.rating)) || Number(review.rating) < 1 || Number(review.rating) > 5) {
        throw Object.assign(new Error("Оценка в рецензии должна быть от 1 до 5"), { statusCode: 400 });
      }
      if (Array.from(String(review.preview)).length > 500) throw Object.assign(new Error("Краткое описание рецензии не должно превышать 500 знаков"), { statusCode: 400 });
      let book;
      if (Number(review.bookId)) {
        [[book]] = await connection.query("SELECT id, author, title FROM books WHERE id = ? LIMIT 1", [Number(review.bookId)]);
        if (!book) throw Object.assign(new Error("Выбранная книга не найдена"), { statusCode: 400 });
      } else book = await resolveBook(connection, review.bookAuthor, review.bookTitle);
      const reviewBodyHtml = validateRichHtml(review.bodyHtml ?? review.fullText);
      if (!plainTextFromHtml(reviewBodyHtml)) continue;
      await assertAdultMaterialAllowed(connection, userId, Boolean(review.isAdult));
      const desiredId = Number(review.id);
      const [[existing]] = desiredId ? await connection.query("SELECT user_id FROM reviews WHERE id = ?", [desiredId]) : [[]];
      if (existing && Number(existing.user_id) !== userId) throw new Error("Нельзя изменить чужую рецензию");
      if (existing) {
        await connection.query("UPDATE reviews SET book_id = ?, rating = ?, preview = ?, body = ?, is_adult = ? WHERE id = ? AND user_id = ?", [book.id, review.rating, review.preview.trim(), reviewBodyHtml, review.isAdult ? 1 : 0, desiredId, userId]);
        await syncMaterialBooks(connection, "review", desiredId, [book.id]);
        reviewIds.push(desiredId);
      } else {
        const [result] = desiredId
          ? await connection.query("INSERT INTO reviews (id, user_id, book_id, rating, preview, body, is_adult) VALUES (?, ?, ?, ?, ?, ?, ?)", [desiredId, userId, book.id, review.rating, review.preview.trim(), reviewBodyHtml, review.isAdult ? 1 : 0])
          : await connection.query("INSERT INTO reviews (user_id, book_id, rating, preview, body, is_adult) VALUES (?, ?, ?, ?, ?, ?)", [userId, book.id, review.rating, review.preview.trim(), reviewBodyHtml, review.isAdult ? 1 : 0]);
        const savedReviewId = desiredId || Number(result.insertId);
        reviewIds.push(savedReviewId);
        await syncMaterialBooks(connection, "review", savedReviewId, [book.id]);
        await notifyFollowersAboutPublication(connection, userId, "review", desiredId || Number(result.insertId), review.bookTitle.trim());
        await notifyWriterAboutBook(connection, book.id, userId, "review", `review-${savedReviewId}`);
      }
      }
      if (reviewIds.length) await connection.query(`DELETE FROM reviews WHERE user_id = ? AND id NOT IN (${reviewIds.map(() => "?").join(",")})`, [userId, ...reviewIds]);
      else await connection.query("DELETE FROM reviews WHERE user_id = ?", [userId]);
      await connection.query("DELETE mb FROM material_books mb LEFT JOIN reviews r ON r.id = mb.material_id WHERE mb.material_kind = 'review' AND r.id IS NULL");
    }

    if (["Читатель", "Писатель", "Блогер"].includes(requestedType)) {
      const excerptIds = [];
      for (const excerpt of excerpts) {
      const previewText = String(excerpt.previewText ?? excerpt.text ?? "").trim();
      if (!previewText) continue;
      const desiredId = Number(excerpt.id);
      const [[existing]] = desiredId ? await connection.query("SELECT user_id, preview_text FROM excerpts WHERE id = ?", [desiredId]) : [[]];
      if (existing && Number(existing.user_id) !== userId) throw new Error("Нельзя изменить чужой отрывок");
      const unchangedLegacyPublication = Boolean(existing && previewText === String(existing.preview_text ?? "").trim());
      if (Array.from(previewText).length > 500 && !unchangedLegacyPublication) throw Object.assign(new Error("Публикация должна содержать от 1 до 500 знаков"), { statusCode: 400 });
      const excerptBookIds = Array.from(new Set((Array.isArray(excerpt.bookIds) ? excerpt.bookIds : [excerpt.bookId]).map(Number).filter((id) => Number.isInteger(id) && id > 0))).slice(0, 50);
      const linkedBooks = await linkedBookPreviews(connection, excerptBookIds);
      const linkedBook = linkedBooks[0] ?? null;
      const bodyHtml = validateRichHtml(excerpt.bodyHtml);
      const plainBody = plainTextFromHtml(bodyHtml) || previewText;
      await assertAdultMaterialAllowed(connection, userId, Boolean(excerpt.isAdult));
      if (existing) {
        await connection.query("UPDATE excerpts SET book_id = ?, book_title = ?, preview_text = ?, body_html = ?, body = ?, is_adult = ?, read_url = NULL WHERE id = ? AND user_id = ?", [linkedBook?.id ?? null, linkedBook?.title ?? "", previewText, bodyHtml, plainBody, excerpt.isAdult ? 1 : 0, desiredId, userId]);
        await syncMaterialBooks(connection, "excerpt", desiredId, linkedBooks.map((book) => book.id));
        excerptIds.push(desiredId);
      } else {
        const [result] = desiredId
          ? await connection.query("INSERT INTO excerpts (id, user_id, book_id, book_title, preview_text, body_html, body, is_adult, read_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)", [desiredId, userId, linkedBook?.id ?? null, linkedBook?.title ?? "", previewText, bodyHtml, plainBody, excerpt.isAdult ? 1 : 0])
          : await connection.query("INSERT INTO excerpts (user_id, book_id, book_title, preview_text, body_html, body, is_adult, read_url) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)", [userId, linkedBook?.id ?? null, linkedBook?.title ?? "", previewText, bodyHtml, plainBody, excerpt.isAdult ? 1 : 0]);
        const savedExcerptId = desiredId || Number(result.insertId);
        excerptIds.push(savedExcerptId);
        await syncMaterialBooks(connection, "excerpt", savedExcerptId, linkedBooks.map((book) => book.id));
        await notifyFollowersAboutPublication(connection, userId, "excerpt", savedExcerptId, linkedBook?.title ?? "Публикация");
      }
      }
      if (excerptIds.length) await connection.query(`DELETE FROM excerpts WHERE user_id = ? AND id NOT IN (${excerptIds.map(() => "?").join(",")})`, [userId, ...excerptIds]);
      else await connection.query("DELETE FROM excerpts WHERE user_id = ?", [userId]);
      await connection.query("DELETE mb FROM material_books mb LEFT JOIN excerpts e ON e.id = mb.material_id WHERE mb.material_kind = 'excerpt' AND e.id IS NULL");
    }
  });
  response.json({ ok: true });
}));

router.patch("/users/me/home-view", asyncRoute(async (request, response) => {
  const homeView = request.body?.homeView === "classic" ? "classic" : request.body?.homeView === "feed" ? "feed" : null;
  if (!homeView) return response.status(400).json({ error: "Некорректный вид главной страницы" });
  await getPool().query("UPDATE profiles SET home_view = ? WHERE user_id = ?", [homeView, request.bookMeetUser.id]);
  response.json({ ok: true, homeView });
}));

router.patch("/users/me/profile-complete", asyncRoute(async (request, response) => {
  const state = await profileAccessState(getPool(), request.bookMeetUser.id);
  if (!state.complete) return response.status(400).json({ code: "PROFILE_COMPLETION_REQUIRED", error: "Заполните имя, город и дату рождения", missing: state.missing });
  await getPool().query("UPDATE users SET profile_completed = 1 WHERE id = ?", [request.bookMeetUser.id]);
  response.json({ ok: true });
}));

router.get("/books/catalog", asyncRoute(async (request, response) => {
  const [[viewer]] = await getPool().query("SELECT u.role, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", [request.bookMeetUser.id]);
  const adultViewer = viewer?.role === "admin" || Number(ageFromBirthDate(viewer?.birth_date) ?? -1) >= 18;
  const rawQuery = String(request.query.q ?? "");
  const query = rawQuery.normalize("NFKC").trim().replace(/\s+/gu, " ");
  // A one-character remote search has very poor selectivity. An empty query
  // intentionally keeps the established catalogue/sort response.
  if (query.length === 1) return response.json({ books: [] });
  if (query.length > 160) return response.status(400).json({ error: "Слишком длинный поисковый запрос" });
  const needle = query ? `%${query.toLocaleLowerCase("ru")}%` : null;
  const catalogLimit = needle === null ? "" : " LIMIT 100";
  const [rows] = await getPool().query(
    `SELECT b.id, b.creator_user_id AS creatorUserId, b.author, b.title, b.isbn, b.publisher, b.genres, b.annotation,
            b.is_adult AS isAdult, b.cover_path AS coverUrl, b.cover_tone AS coverTone, b.flip_url AS flipUrl,
            b.created_at AS addedAt, COUNT(DISTINCT CASE WHEN ub.is_author = 0 THEN ub.user_id END) AS popularity,
            COUNT(DISTINCT CASE WHEN ub.is_author = 0 AND rating_user.deleted_at IS NULL AND rating_user.purged_at IS NULL AND ub.rating IS NOT NULL AND TRIM(COALESCE(ub.short_review, '')) <> '' THEN ub.user_id END) AS ratingCount,
            AVG(CASE WHEN ub.is_author = 0 AND rating_user.deleted_at IS NULL AND rating_user.purged_at IS NULL AND ub.rating IS NOT NULL AND TRIM(COALESCE(ub.short_review, '')) <> '' THEN ub.rating END) AS averageRating
       FROM books b
       LEFT JOIN user_books ub ON ub.book_id = b.id
       LEFT JOIN users rating_user ON rating_user.id = ub.user_id
       WHERE (? = 1 OR b.is_adult = 0)
        AND NOT EXISTS (SELECT 1 FROM user_blocks block WHERE (block.blocker_user_id = ? AND block.blocked_user_id = b.creator_user_id) OR (block.blocker_user_id = b.creator_user_id AND block.blocked_user_id = ?))
        AND (? IS NULL OR LOWER(CONCAT_WS(' ', b.title, b.author, COALESCE(b.annotation, ''), COALESCE(b.isbn, ''), COALESCE(b.publisher, ''))) LIKE ?)
       GROUP BY b.id
       ORDER BY b.title_key, b.author_key${catalogLimit}`,
    [adultViewer ? 1 : 0, request.bookMeetUser.id, request.bookMeetUser.id, needle, needle],
  );
  response.json({ books: rows.map((row) => ({ ...row, id: Number(row.id), creatorUserId: row.creatorUserId ? Number(row.creatorUserId) : undefined, isAdult: Boolean(row.isAdult), genres: JSON.parse(row.genres || "[]"), popularity: Number(row.popularity || 0), ratingCount: Number(row.ratingCount || 0), averageRating: row.averageRating == null ? undefined : Math.round(Number(row.averageRating) * 10) / 10, addedAt: new Date(row.addedAt).toISOString() })) });
}));

router.get("/books", asyncRoute(async (request, response) => {
  const query = String(request.query.q ?? "").trim();
  if (!query) return response.json({ books: [] });
  const tokens = [...new Set(query.normalize("NFKC").toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean))].slice(0, 8);
  if (!tokens.length) return response.json({ books: [] });
  const [[viewer]] = await getPool().query("SELECT u.role, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", [request.bookMeetUser.id]);
  const adultViewer = viewer?.role === "admin" || Number(ageFromBirthDate(viewer?.birth_date) ?? -1) >= 18;
  const tokenClauses = tokens.map(() => "LOWER(CONCAT_WS(' ', title, author, COALESCE(annotation, ''), COALESCE(isbn, ''), COALESCE(publisher, ''))) LIKE ?").join(" AND ");
  const [rows] = await getPool().query(`SELECT id, author, title, isbn, publisher, genres, annotation, is_adult AS isAdult, cover_path AS coverUrl, cover_tone AS coverTone, flip_url AS flipUrl FROM books WHERE (? = 1 OR is_adult = 0) AND ${tokenClauses} ORDER BY updated_at DESC LIMIT 8`, [adultViewer ? 1 : 0, ...tokens.map((token) => `%${token}%`)]);
  response.json({ books: rows.map((row) => ({ ...row, id: Number(row.id), isAdult: Boolean(row.isAdult), genres: JSON.parse(row.genres || "[]") })) });
}));

function goalDto(row) {
  return { id: Number(row.id), goalKind: row.goal_kind, targetCount: Number(row.target_count), targetMonth: row.target_month == null ? null : Number(row.target_month), targetYear: Number(row.target_year), startMonth: row.start_month == null ? null : Number(row.start_month), createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined, updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined };
}
function goalWriteError(error) {
  if (error?.code === "ER_DUP_ENTRY") return Object.assign(new Error("Такая цель уже есть"), { statusCode: 409, code: "READING_GOAL_DUPLICATE" });
  return error;
}

async function ownerGoalCompletions(connection, userId, year) {
  const [rows] = await connection.query("SELECT completed_month, completed_year FROM reading_cycles WHERE user_id = ? AND status = 'completed' AND completed_year = ?", [userId, year]);
  return rows.map((row) => ({ completedMonth: Number(row.completed_month), completedYear: Number(row.completed_year) }));
}

router.get("/reading-goals", asyncRoute(async (request, response) => {
  const [rows] = await getPool().query("SELECT * FROM reading_goals WHERE user_id = ? ORDER BY target_year, COALESCE(target_month, 0), id", [request.bookMeetUser.id]);
  response.json({ goals: rows.map(goalDto) });
}));

router.post("/reading-goals", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const timezone = validTimezone(request.get("X-BookMeet-Timezone") || "UTC");
  const goal = validateGoalPayload(request.body ?? {}, { timezone });
  let created;
  try { created = await withTransaction(async (connection) => {
    const [result] = await connection.query("INSERT INTO reading_goals (user_id, goal_kind, target_count, target_month, target_year, start_month) VALUES (?, ?, ?, ?, ?, ?)", [userId, goal.goalKind, goal.targetCount, goal.targetMonth, goal.targetYear, goal.startMonth || null]);
    const [[row]] = await connection.query("SELECT * FROM reading_goals WHERE id = ? AND user_id = ?", [result.insertId, userId]);
    return goalDto(row);
  }); } catch (error) { throw goalWriteError(error); }
  response.status(201).json({ goal: created, pace: created.goalKind === "month" ? monthPace(created, timezone) : annualPlan(created, [], timezone) });
}));

router.patch("/reading-goals/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Некорректная цель" });
  const timezone = validTimezone(request.get("X-BookMeet-Timezone") || "UTC");
  let updated;
  try { updated = await withTransaction(async (connection) => {
    const [[existing]] = await connection.query("SELECT * FROM reading_goals WHERE id = ? AND user_id = ? FOR UPDATE", [id, userId]);
    if (!existing) throw Object.assign(new Error("Цель не найдена"), { statusCode: 404 });
    const goal = validateGoalPayload(request.body ?? {}, { timezone, existing });
    await connection.query("UPDATE reading_goals SET goal_kind = ?, target_count = ?, target_month = ?, target_year = ?, start_month = ? WHERE id = ? AND user_id = ?", [goal.goalKind, goal.targetCount, goal.targetMonth, goal.targetYear, goal.startMonth || null, id, userId]);
    const [[row]] = await connection.query("SELECT * FROM reading_goals WHERE id = ? AND user_id = ?", [id, userId]);
    return goalDto(row);
  }); } catch (error) { throw goalWriteError(error); }
  response.json({ goal: updated });
}));

router.delete("/reading-goals/:id", asyncRoute(async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Некорректная цель" });
  const [result] = await getPool().query("DELETE FROM reading_goals WHERE id = ? AND user_id = ?", [id, request.bookMeetUser.id]);
  if (!result.affectedRows) return response.status(404).json({ error: "Цель не найдена" });
  response.json({ ok: true });
}));

router.get("/reading-statistics", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const timezone = validTimezone(request.get("X-BookMeet-Timezone") || "UTC");
  const periods = eligibleGoalPeriods(timezone);
  const year = Number(request.query.year ?? periods.year);
  const month = request.query.month === undefined ? null : Number(request.query.month);
  if (!Number.isInteger(year) || year < 1900 || year > periods.year + 1 || month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return response.status(400).json({ error: "Некорректный период" });
  const connection = getPool();
  const [goals, completions] = await Promise.all([
    connection.query(`SELECT * FROM reading_goals WHERE user_id = ? AND target_year = ?${month === null ? "" : " AND (target_month IS NULL OR target_month = ?)"} ORDER BY goal_kind, id`, month === null ? [userId, year] : [userId, year, month]),
    ownerGoalCompletions(connection, userId, year),
  ]);
  const items = goals[0].map(goalDto).map((goal) => ({ ...goal, projection: goal.goalKind === "month" ? { target: goal.targetCount, actual: completions.filter((item) => item.completedMonth === goal.targetMonth).length, pace: monthPace(goal, timezone) } : annualPlan(goal, completions, timezone) }));
  const legacyCounts = Array.from({ length: 12 }, (_, index) => completions.filter((item) => item.completedMonth === index + 1).length);
  const sessionStatistics = readingSessionsEnabled() ? await loadReadingStatistics(connection, userId, year) : null;
  response.json({ year, month, goals: items, counts: legacyCounts, ...(sessionStatistics ?? {}) });
}));

function adminBookImportInput(value = {}) {
  const linkUrl = String(value.url ?? value.link ?? value.sourceUrl ?? "").trim();
  const links = Array.isArray(value.links) ? value.links : linkUrl ? [{ url: linkUrl, label: "Источник", action: "Читать" }] : [];
  return {
    author: String(value.author ?? "").trim().slice(0, 255),
    title: String(value.title ?? "").trim().slice(0, 255),
    isbn: normalizeIsbn(value.isbn),
    publisher: String(value.publisher ?? "").trim().slice(0, 255),
    annotation: String(value.annotation ?? value.description ?? "").trim().slice(0, 20_000),
    coverUrl: String(value.coverUrl ?? value.cover ?? "").trim(),
    genres: Array.isArray(value.genres) ? value.genres.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20) : String(value.genres ?? "").split(/[,;|]/).map((item) => item.trim()).filter(Boolean).slice(0, 20),
    isAdult: Boolean(value.isAdult),
    sourceUrl: linkUrl,
    links: links.slice(0, 10).map((link) => ({ label: String(link.label ?? "Источник").trim().slice(0, 120), action: ["Купить", "Читать", "Слушать"].includes(link.action) ? link.action : "Читать", url: cleanUrl(link.url) })),
  };
}

async function enrichAdminImportRow(row) {
  if (!row.sourceUrl) return row;
  try {
    const product = await fetchBookProduct(row.sourceUrl);
    return {
      ...row,
      author: row.author || product.author,
      title: row.title || product.title,
      isbn: row.isbn || product.isbn || "",
      publisher: row.publisher || product.publisher || "",
      annotation: row.annotation || product.annotation || "",
      coverUrl: row.coverUrl || product.coverUrl || "",
      links: row.links.length ? row.links : [{ label: product.marketplace, action: product.suggestedAction, url: product.productUrl }],
    };
  } catch (error) {
    console.warn("Не удалось дополнить строку импорта по ссылке", error?.message ?? error);
    return row;
  }
}

async function importedCoverPath(row) {
  if (!row.coverUrl) return null;
  if (row.coverUrl.startsWith("data:image/")) return saveCover(row.coverUrl);
  const preview = await previewRemoteCover(row.coverUrl);
  return preview ? saveCover(preview) : null;
}

async function insertAdminImportedBook(connection, adminId, row) {
  const coverPath = await importedCoverPath(row);
  const [created] = await connection.query(
    `INSERT INTO books (creator_user_id, author, author_key, title, title_key, isbn, isbn_key, publisher, genres, annotation, is_adult, cover_path, cover_tone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'blue')`,
    [adminId, row.author, normalizeIdentity(row.author), row.title, normalizeIdentity(row.title), row.isbn || null, row.isbn || null, row.publisher || null, JSON.stringify(row.genres), row.annotation, row.isAdult ? 1 : 0, coverPath],
  );
  await connection.query("INSERT IGNORE INTO user_books (user_id, book_id, is_author) VALUES (?, ?, 0)", [adminId, created.insertId]);
  for (const link of row.links) await connection.query("INSERT IGNORE INTO book_links (book_id, owner_user_id, action, label, url) VALUES (?, ?, ?, ?, ?)", [created.insertId, adminId, link.action, link.label, link.url]);
  return Number(created.insertId);
}

router.post("/admin/books/import/preview", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const rows = Array.isArray(request.body?.rows) ? request.body.rows.slice(0, 1000) : [];
  if (!rows.length) return response.status(400).json({ error: "В файле не найдены книги" });
  const result = await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const created = [];
    const conflicts = [];
    for (let index = 0; index < rows.length; index += 1) {
      const incoming = await enrichAdminImportRow(adminBookImportInput(rows[index]));
      if (!incoming.author || !incoming.title) continue;
      const [[existing]] = await connection.query(
        `SELECT id, author, title, isbn, publisher, annotation, genres, is_adult, cover_path AS coverUrl, cover_tone AS coverTone
           FROM books WHERE (? <> '' AND isbn_key = ?) OR (author_key = ? AND title_key = ?) ORDER BY id LIMIT 1`,
        [incoming.isbn, incoming.isbn, normalizeIdentity(incoming.author), normalizeIdentity(incoming.title)],
      );
      if (existing) conflicts.push({ key: `${index}-${Date.now()}`, existing: { ...existing, id: Number(existing.id), genres: jsonArray(existing.genres), isAdult: Boolean(existing.is_adult) }, incoming });
      else created.push(await insertAdminImportedBook(connection, adminId, incoming));
    }
    return { createdCount: created.length, conflicts };
  });
  response.json(result);
}));

router.post("/admin/books/import/resolve", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const existingId = Number(request.body?.existingId);
  const action = String(request.body?.action ?? "");
  const incoming = await enrichAdminImportRow(adminBookImportInput(request.body?.incoming));
  if (!existingId || !["replace", "supplement", "duplicate"].includes(action) || !incoming.author || !incoming.title) return response.status(400).json({ error: "Некорректное решение по дубликату" });
  const bookId = await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const [[existing]] = await connection.query("SELECT * FROM books WHERE id = ? FOR UPDATE", [existingId]);
    if (!existing) throw Object.assign(new Error("Исходная книга не найдена"), { statusCode: 404 });
    if (action === "duplicate") return insertAdminImportedBook(connection, adminId, incoming);
    const coverPath = await importedCoverPath(incoming);
    if (action === "replace") {
      await connection.query(
        `UPDATE books SET author = ?, author_key = ?, title = ?, title_key = ?, isbn = ?, isbn_key = ?, publisher = ?, genres = ?, annotation = ?, is_adult = ?, cover_path = COALESCE(?, cover_path) WHERE id = ?`,
        [incoming.author, normalizeIdentity(incoming.author), incoming.title, normalizeIdentity(incoming.title), incoming.isbn || null, incoming.isbn || null, incoming.publisher || null, JSON.stringify(incoming.genres), incoming.annotation, incoming.isAdult ? 1 : 0, coverPath, existingId],
      );
    } else {
      await connection.query(
        `UPDATE books SET isbn = COALESCE(NULLIF(isbn, ''), NULLIF(?, '')), isbn_key = COALESCE(NULLIF(isbn_key, ''), NULLIF(?, '')), publisher = COALESCE(NULLIF(publisher, ''), NULLIF(?, '')), genres = CASE WHEN genres IS NULL OR genres = '' OR genres = '[]' THEN ? ELSE genres END, annotation = COALESCE(NULLIF(annotation, ''), NULLIF(?, '')), cover_path = COALESCE(cover_path, ?) WHERE id = ?`,
        [incoming.isbn, incoming.isbn, incoming.publisher, JSON.stringify(incoming.genres), incoming.annotation, coverPath, existingId],
      );
    }
    for (const link of incoming.links) await connection.query("INSERT IGNORE INTO book_links (book_id, owner_user_id, action, label, url) VALUES (?, ?, ?, ?, ?)", [existingId, adminId, link.action, link.label, link.url]);
    return existingId;
  });
  response.json({ bookId });
}));

router.post("/books", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const payload = request.body ?? {};
  const requestedExistingId = Number(payload.useExistingId || 0);
  const readerUsesExistingCanonical = requestedExistingId > 0 && !payload.isAuthor;
  const author = String(payload.author ?? "").trim();
  const title = String(payload.title ?? "").trim();
  const isbn = readerUsesExistingCanonical ? "" : normalizeIsbn(payload.isbn);
  const publisher = readerUsesExistingCanonical ? "" : String(payload.publisher ?? "").trim();
  const flipUrl = readerUsesExistingCanonical ? "" : String(payload.flipUrl ?? "").trim();
  if (flipUrl) marketplaceFromUrl(flipUrl);
  const links = readerUsesExistingCanonical ? null : validatedBookLinks(payload.links, !payload.isAuthor);
  if (!readerUsesExistingCanonical && (!author || !title)) return response.status(400).json({ error: "Автор и название обязательны" });
  const timezone = validTimezone(request.get("X-BookMeet-Timezone") || "UTC");
  let readerState = payload.isAuthor ? null : { readingStatus: payload.readingStatus ?? "read" };
  let rating = Number(payload.rating);
  let readingStatus = readerState?.readingStatus ?? "read";
  const top3Specified = typeof payload.top3 === "boolean" || payload.topRank !== undefined;
  const top3Requested = payload.top3 === true || Number(payload.topRank) > 0;
  let readMonth = readerState?.readMonth ?? null;
  let readYear = readerState?.readYear ?? null;
  const authorKey = normalizeIdentity(author);
  const titleKey = normalizeIdentity(title);
  const result = await withTransaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!payload.isAuthor) {
      const [[readerProfile]] = await connection.query("SELECT profile_type FROM profiles WHERE user_id = ?", [userId]);
      if (!["Читатель", "Писатель", "Блогер"].includes(readerProfile?.profile_type)) throw Object.assign(new Error("Личное состояние чтения доступно только личному профилю"), { statusCode: 403 });
    }
    await assertAdultMaterialAllowed(connection, userId, Boolean(payload.isAdult));
    const access = await publisherAccess(connection, userId);
    let organizationDates = { featuredMonth: null, featuredYear: null, publicationMonth: null, publicationYear: null };
    if (payload.isAuthor) {
      const [[profile]] = await connection.query("SELECT profile_type, publisher_status FROM profiles WHERE user_id = ?", [userId]);
      const canPublishBook = ["Писатель", "Издатель", "Сообщество"].includes(profile?.profile_type);
      if (!canPublishBook) throw Object.assign(new Error("Добавлять книги могут только писатели и организации"), { statusCode: 403 });
      if (profile.profile_type === "Сообщество") {
        const date = organizationMonthYear(payload, "featured", "книги месяца");
        organizationDates = { ...organizationDates, featuredMonth: date.month, featuredYear: date.year };
      }
      if (profile.profile_type === "Издатель") {
        const date = organizationMonthYear(payload, "publication", "даты издания", 1900);
        organizationDates = { ...organizationDates, publicationMonth: date.month, publicationYear: date.year };
      }
    } else if (access.isPublisher) {
      throw Object.assign(new Error("Книги организации добавляются в специальной вкладке профиля"), { statusCode: 403 });
    }
    let bookId = requestedExistingId;
    let uploadedCoverPath = null;
    let createdCanonical = false;
    let canonicalOwnerId = null;
    if (!bookId) {
      if (isbn) {
        const [[isbnMatch]] = await connection.query("SELECT id FROM books WHERE isbn_key = ? LIMIT 1", [isbn]);
        if (isbnMatch) bookId = Number(isbnMatch.id);
      }
      if (!bookId && links?.length) {
        const urls = links.map((link) => link.url);
        const placeholders = urls.map(() => "?").join(",");
        const [[urlMatch]] = await connection.query(`SELECT book_id AS id FROM book_links WHERE url IN (${placeholders}) LIMIT 1`, urls);
        if (urlMatch) bookId = Number(urlMatch.id);
      }
      if (!bookId && flipUrl) {
        const [[urlMatch]] = await connection.query("SELECT id FROM books WHERE flip_url = ? LIMIT 1", [flipUrl]);
        if (urlMatch) bookId = Number(urlMatch.id);
      }
    }
    if (!bookId) {
      const [[match]] = await connection.query("SELECT id, author, title FROM books WHERE author_key = ? AND title_key = ? LIMIT 1", [authorKey, titleKey]);
      if (match) return { conflict: { id: Number(match.id), author: match.author, title: match.title } };
      uploadedCoverPath = await saveCover(payload.coverUrl);
      const [created] = await connection.query(
        "INSERT INTO books (creator_user_id, author, author_key, title, title_key, isbn, isbn_key, publisher, genres, annotation, is_adult, cover_path, cover_tone, flip_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [payload.isAuthor ? userId : null, author, authorKey, title, titleKey, isbn || null, isbn || null, publisher || null, JSON.stringify(payload.genres ?? []), payload.annotation ?? "", payload.isAdult ? 1 : 0, uploadedCoverPath, payload.coverTone ?? "blue", flipUrl || null],
      );
      bookId = Number(created.insertId);
      createdCanonical = true;
      canonicalOwnerId = payload.isAuthor ? userId : null;
    } else {
      const [[book]] = await connection.query("SELECT id, creator_user_id, annotation, cover_path, isbn, publisher, is_adult FROM books WHERE id = ? FOR UPDATE", [bookId]);
      if (!book) throw Object.assign(new Error("Выбранная книга не найдена"), { statusCode: 404 });
      if (book.is_adult) await assertAdultMaterialAllowed(connection, userId, true);
      canonicalOwnerId = book.creator_user_id ? Number(book.creator_user_id) : null;
      if (payload.isAuthor && !access.isPublisher && book.creator_user_id && Number(book.creator_user_id) !== userId) {
        throw Object.assign(new Error("Эта авторская карточка принадлежит другому писателю"), { statusCode: 409 });
      }
      if (!readerUsesExistingCanonical && !book.cover_path && payload.coverUrl) {
        uploadedCoverPath = await saveCover(payload.coverUrl);
        if (uploadedCoverPath) await connection.query("UPDATE books SET cover_path = ? WHERE id = ? AND cover_path IS NULL", [uploadedCoverPath, bookId]);
      }
      if (!readerUsesExistingCanonical && flipUrl) await connection.query("UPDATE books SET flip_url = ? WHERE id = ?", [flipUrl, bookId]);
      if (!readerUsesExistingCanonical && isbn && !book.isbn) await connection.query("UPDATE books SET isbn = ?, isbn_key = ? WHERE id = ? AND isbn IS NULL", [isbn, isbn, bookId]);
      if (!readerUsesExistingCanonical && publisher && !book.publisher) await connection.query("UPDATE books SET publisher = ? WHERE id = ? AND publisher IS NULL", [publisher, bookId]);
      if (!readerUsesExistingCanonical && !book.annotation && String(payload.annotation ?? "").trim()) {
        await connection.query("UPDATE books SET annotation = ? WHERE id = ? AND (annotation IS NULL OR annotation = '')", [String(payload.annotation).trim(), bookId]);
      }
    }
    const [[existingUserBook]] = await connection.query("SELECT * FROM user_books WHERE user_id = ? AND book_id = ? FOR UPDATE", [userId, bookId]);
    if (!payload.isAuthor) {
      readerState = normalizeReadingState(payload, existingUserBook ?? {}, { timezone, defaultStatus: existingUserBook?.reading_status ?? "read" });
      rating = readerState.rating ?? Number(payload.rating); readingStatus = readerState.readingStatus;
      readMonth = readerState.readMonth ?? null; readYear = readerState.readYear ?? null;
    }
    if (top3Requested && !top3Eligibility({ isAuthor: Boolean(payload.isAuthor || existingUserBook?.is_author), readingStatus }).allowed) {
      throw Object.assign(new Error("В TOP3 можно добавлять только прочитанные книги из своей библиотеки"), { statusCode: 400 });
    }
    const storage = payload.isAuthor ? null : readingStateStorage(readerState, existingUserBook ?? {});
    await connection.query(
      `INSERT INTO user_books (user_id, book_id, rating, short_review, read_month, read_year, reading_status, last_read_chapter, chapters_current, chapters_total, pages_current, pages_total, progress_unit, reading_comment, postponed_month, postponed_year, postponed_timezone, is_author, featured_month, featured_year, publication_month, publication_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), short_review = VALUES(short_review), read_month = VALUES(read_month), read_year = VALUES(read_year), reading_status = VALUES(reading_status), last_read_chapter = VALUES(last_read_chapter), chapters_current = VALUES(chapters_current), chapters_total = VALUES(chapters_total), pages_current = VALUES(pages_current), pages_total = VALUES(pages_total), progress_unit = VALUES(progress_unit), reading_comment = VALUES(reading_comment), postponed_month = VALUES(postponed_month), postponed_year = VALUES(postponed_year), postponed_timezone = VALUES(postponed_timezone), is_author = VALUES(is_author), featured_month = VALUES(featured_month), featured_year = VALUES(featured_year), publication_month = VALUES(publication_month), publication_year = VALUES(publication_year)`,
      [userId, bookId, payload.isAuthor || readingStatus !== "read" ? null : rating, payload.isAuthor || readingStatus === "want" || readingStatus === "reading" || readingStatus === "postponed" ? null : readerState?.shortReview ?? null, payload.isAuthor || readingStatus !== "read" ? null : readMonth, payload.isAuthor || readingStatus !== "read" ? null : readYear, payload.isAuthor ? "read" : readingStatus, payload.isAuthor ? null : storage.lastReadChapter, payload.isAuthor ? null : storage.chaptersCurrent, payload.isAuthor ? null : storage.chaptersTotal, payload.isAuthor ? null : storage.pagesCurrent, payload.isAuthor ? null : storage.pagesTotal, payload.isAuthor ? null : storage.progressUnit, payload.isAuthor ? null : storage.readingComment, payload.isAuthor ? null : storage.postponedMonth, payload.isAuthor ? null : storage.postponedYear, timezone, payload.isAuthor ? 1 : 0, organizationDates.featuredMonth, organizationDates.featuredYear, organizationDates.publicationMonth, organizationDates.publicationYear],
    );
    if (!payload.isAuthor) {
      await syncReadingCycle(connection, { userId, bookId, previousStatus: existingUserBook?.reading_status ?? null, state: readerState, isAuthor: false });
      await syncPostponedReminder(connection, { userId, bookId, state: readerState, previous: existingUserBook ?? {}, timezone });
    }
    let topRank = existingUserBook?.top_rank ? Number(existingUserBook.top_rank) : null;
    if (payload.isAuthor || readingStatus !== "read" || top3Specified && !top3Requested) {
      await connection.query("UPDATE user_books SET top_rank = NULL WHERE user_id = ? AND book_id = ?", [userId, bookId]);
      topRank = null;
    } else if (top3Requested) {
      const [topBooks] = await connection.query(
        "SELECT book_id, top_rank FROM user_books WHERE user_id = ? AND top_rank IS NOT NULL ORDER BY top_rank FOR UPDATE",
        [userId],
      );
      const currentTop = topBooks.find((item) => Number(item.book_id) === bookId);
      if (currentTop) topRank = Number(currentTop.top_rank);
      else {
        const availableRank = nextTopRank(topBooks, bookId);
        if (!availableRank) throw Object.assign(new Error("В TOP3 уже добавлены три книги. Сначала снимите отметку с одной из них."), { statusCode: 409, code: "TOP3_LIMIT" });
        await connection.query("UPDATE user_books SET top_rank = ? WHERE user_id = ? AND book_id = ? AND is_author = 0 AND reading_status = 'read'", [availableRank, userId, bookId]);
        topRank = availableRank;
      }
    }
    if (payload.isAuthor) {
      if (createdCanonical || canonicalOwnerId === userId) {
        const coverPath = uploadedCoverPath ?? (payload.coverUrl ? await saveCover(payload.coverUrl) : null);
        await connection.query("UPDATE books SET creator_user_id = COALESCE(creator_user_id, ?), genres = ?, annotation = ?, is_adult = ?, isbn = COALESCE(isbn, ?), isbn_key = COALESCE(isbn_key, ?), publisher = COALESCE(publisher, ?), cover_path = COALESCE(?, cover_path), cover_tone = ?, flip_url = COALESCE(?, flip_url) WHERE id = ?", [userId, JSON.stringify(payload.genres ?? []), payload.annotation ?? "", payload.isAdult ? 1 : 0, isbn || null, isbn || null, publisher || null, coverPath, payload.coverTone ?? "blue", flipUrl || null, bookId]);
      } else if (!canonicalOwnerId) {
        await connection.query("UPDATE books SET creator_user_id = COALESCE(creator_user_id, ?) WHERE id = ?", [userId, bookId]);
      }
    }
    if (links) {
      const [savedLinks] = await connection.query("SELECT url FROM book_links WHERE book_id = ? ORDER BY id", [bookId]);
      const savedUrls = new Set(savedLinks.map((link) => link.url));
      let totalLinks = savedUrls.size;
      for (const link of links) {
        if (savedUrls.has(link.url) || totalLinks >= 3) continue;
        await connection.query("INSERT INTO book_links (book_id, owner_user_id, action, label, url) VALUES (?, ?, ?, ?, ?)", [bookId, userId, link.action, link.label, link.url]);
        savedUrls.add(link.url);
        totalLinks += 1;
      }
    }
    if (!payload.isAuthor && !existingUserBook) await notifyWriterAboutBook(connection, bookId, userId, "library");
    return { bookId, topRank: topRank ?? undefined };
  });
  if (result.conflict) return response.status(409).json({ match: result.conflict });
  const owner = await ownerBookResponse(userId, result.bookId);
  response.status(201).json({ ...result, ...owner });
}));

function organizationMonthYear(payload, prefix, label, minYear = 2000) {
  const month = payload[`${prefix}Month`] == null || payload[`${prefix}Month`] === "" ? null : Number(payload[`${prefix}Month`]);
  const year = payload[`${prefix}Year`] == null || payload[`${prefix}Year`] === "" ? null : Number(payload[`${prefix}Year`]);
  if (month === null && year === null) return { month: null, year: null };
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < minYear || year > 2100) {
    throw Object.assign(new Error(`Укажите корректные месяц и год ${label}`), { statusCode: 400 });
  }
  return { month, year };
}

async function syncReadingCycle(connection, { userId, bookId, previousStatus, state, isAuthor }) {
  if (isAuthor) return;
  const [activeRows] = await connection.query("SELECT id, status FROM reading_cycles WHERE user_id = ? AND book_id = ? AND status = 'active' FOR UPDATE", [userId, bookId]);
  const active = activeRows[0];
  if (state.readingStatus === "reading") {
    if (!active) await connection.query("INSERT INTO reading_cycles (user_id, book_id, status) VALUES (?, ?, 'active')", [userId, bookId]);
    return;
  }
  if (state.readingStatus === "read") {
    if (active) {
      await connection.query("UPDATE reading_cycles SET status = 'completed', completed_month = ?, completed_year = ?, completed_at = UTC_TIMESTAMP() WHERE id = ?", [state.readMonth, state.readYear, active.id]);
    } else if (previousStatus === "read") {
      const [[latest]] = await connection.query("SELECT id FROM reading_cycles WHERE user_id = ? AND book_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1 FOR UPDATE", [userId, bookId]);
      if (latest) await connection.query("UPDATE reading_cycles SET completed_month = ?, completed_year = ? WHERE id = ?", [state.readMonth, state.readYear, latest.id]);
      else await connection.query("INSERT INTO reading_cycles (user_id, book_id, completed_month, completed_year, completed_at, status) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), 'completed')", [userId, bookId, state.readMonth, state.readYear]);
    } else await connection.query("INSERT INTO reading_cycles (user_id, book_id, completed_month, completed_year, completed_at, status) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), 'completed')", [userId, bookId, state.readMonth, state.readYear]);
    return;
  }
  if (active) await connection.query("UPDATE reading_cycles SET status = ? WHERE id = ?", [state.readingStatus === "postponed" ? "postponed" : "abandoned", active.id]);
  if (state.readingStatus === "want") await connection.query("UPDATE reading_cycles SET status = 'abandoned' WHERE user_id = ? AND book_id = ? AND status IN ('active', 'postponed')", [userId, bookId]);
}

async function syncPostponedReminder(connection, { userId, bookId, state, previous, timezone = "UTC" }) {
  if (state.readingStatus !== "postponed") return;
  const changed = previous.reading_status !== "postponed" || Number(previous.postponed_month ?? 0) !== Number(state.postponedMonth ?? 0) || Number(previous.postponed_year ?? 0) !== Number(state.postponedYear ?? 0);
  if (changed) await connection.query("UPDATE user_books SET postponed_notified_at = NULL WHERE user_id = ? AND book_id = ?", [userId, bookId]);
  if (!state.postponedYear) return;
  const due = postponedOverdue(state.postponedMonth, state.postponedYear, timezone);
  if (!due) return;
  const [[locked]] = await connection.query("SELECT postponed_notified_at FROM user_books WHERE user_id = ? AND book_id = ? FOR UPDATE", [userId, bookId]);
  if (locked?.postponed_notified_at) return;
  const [[generation]] = await connection.query("SELECT COUNT(*) AS total FROM notification_events WHERE recipient_user_id = ? AND event_type = 'postponed_book' AND material_kind = 'book' AND material_id = ?", [userId, bookId]);
  await createNotificationEvent(connection, {
    recipientUserId: userId,
    eventType: "postponed_book",
    title: "Пора вернуться к книге",
    body: "Срок отложенной книги уже наступил.",
    materialKind: "book",
    materialId: bookId,
    dedupeKey: `postponed-book:${userId}:${bookId}:generation-${Number(generation.total) + 1}`,
  });
  await connection.query("UPDATE user_books SET postponed_notified_at = UTC_TIMESTAMP() WHERE user_id = ? AND book_id = ? AND postponed_notified_at IS NULL", [userId, bookId]);
}

async function ownerBookResponse(userId, bookId) {
  const users = await loadUsers(getPool(), userId);
  const owner = users.find((user) => user.id === Number(userId));
  const book = owner?.books?.find((item) => item.id === Number(bookId));
  // Reuse the same age-filtered owner history as bootstrap. A second raw
  // query here would bypass the privacy projection after an age change.
  return { book, readingHistory: owner?.readingHistory ?? [] };
}

function communityFeaturedDate(payload) {
  return organizationMonthYear(payload, "featured", "подборки");
}

async function assertCommunityOwner(connection, userId) {
  const [[profile]] = await connection.query("SELECT profile_type FROM profiles WHERE user_id = ? FOR UPDATE", [userId]);
  if (profile?.profile_type !== "Сообщество") throw Object.assign(new Error("Раздел книг доступен только сообществу"), { statusCode: 403 });
}

router.post("/community-books", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const bookId = Number(request.body?.bookId);
  if (!bookId) return response.status(400).json({ error: "Выберите книгу из каталога" });
  const featured = communityFeaturedDate(request.body ?? {});
  await withTransaction(async (connection) => {
    await assertCommunityOwner(connection, userId);
    const [[book]] = await connection.query("SELECT id FROM books WHERE id = ?", [bookId]);
    if (!book) throw Object.assign(new Error("Выбранная книга не найдена в каталоге"), { statusCode: 404 });
    await connection.query(
      `INSERT INTO user_books (user_id, book_id, rating, short_review, reading_status, reading_comment, is_author, featured_month, featured_year)
       VALUES (?, ?, NULL, NULL, 'read', '', 0, ?, ?)
       ON DUPLICATE KEY UPDATE is_author = 0, featured_month = VALUES(featured_month), featured_year = VALUES(featured_year)`,
      [userId, bookId, featured.month, featured.year],
    );
  });
  response.status(201).json({ bookId, featuredMonth: featured.month, featuredYear: featured.year });
}));

router.patch("/community-books/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const bookId = Number(request.params.id);
  if (!bookId) return response.status(400).json({ error: "Некорректная книга" });
  const featured = communityFeaturedDate(request.body ?? {});
  await withTransaction(async (connection) => {
    await assertCommunityOwner(connection, userId);
    const [updated] = await connection.query("UPDATE user_books SET featured_month = ?, featured_year = ?, is_author = 0 WHERE user_id = ? AND book_id = ?", [featured.month, featured.year, userId, bookId]);
    if (!updated.affectedRows) throw Object.assign(new Error("Книга не добавлена в сообщество"), { statusCode: 404 });
  });
  response.json({ bookId, featuredMonth: featured.month, featuredYear: featured.year });
}));

router.delete("/community-books/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const bookId = Number(request.params.id);
  await withTransaction(async (connection) => {
    await assertCommunityOwner(connection, userId);
    await connection.query("DELETE FROM user_books WHERE user_id = ? AND book_id = ? AND is_author = 0", [userId, bookId]);
  });
  response.json({ ok: true });
}));

router.delete("/books/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const bookId = Number(request.params.id);
  if (!bookId) return response.status(400).json({ error: "Некорректная книга" });
  await withTransaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [[owned]] = await connection.query("SELECT is_author FROM user_books WHERE user_id = ? AND book_id = ? FOR UPDATE", [userId, bookId]);
    if (!owned) throw Object.assign(new Error("Книга не найдена в вашем профиле"), { statusCode: 404 });
    await connection.query("DELETE FROM user_books WHERE user_id = ? AND book_id = ?", [userId, bookId]);
    await connection.query("DELETE FROM reading_cycles WHERE user_id = ? AND book_id = ? AND status <> 'completed'", [userId, bookId]);
    if (owned.is_author) {
      await connection.query("DELETE FROM book_links WHERE owner_user_id = ? AND book_id = ?", [userId, bookId]);
      await connection.query("UPDATE books SET creator_user_id = NULL WHERE id = ? AND creator_user_id = ?", [bookId, userId]);
    }
  });
  response.json({ ok: true });
}));

router.patch("/books/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const bookId = Number(request.params.id); const payload = request.body ?? {};
  if (!bookId) return response.status(400).json({ error: "Некорректная книга" });
  const timezone = validTimezone(request.get("X-BookMeet-Timezone") || "UTC");
  const result = await withTransaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [[owned]] = await connection.query("SELECT * FROM user_books WHERE user_id = ? AND book_id = ? FOR UPDATE", [userId, bookId]);
    if (!owned) throw Object.assign(new Error("Книга не найдена в вашей библиотеке"), { statusCode: 404 });
    const [[canonical]] = await connection.query("SELECT is_adult FROM books WHERE id = ?", [bookId]);
    await assertAdultMaterialAllowed(connection, userId, Boolean(canonical?.is_adult));
    if (owned.is_author) throw Object.assign(new Error("Авторские книги редактируются в авторском разделе"), { statusCode: 409 });
    const [[readerProfile]] = await connection.query("SELECT profile_type FROM profiles WHERE user_id = ?", [userId]);
    if (!["Читатель", "Писатель", "Блогер"].includes(readerProfile?.profile_type)) throw Object.assign(new Error("Личное состояние чтения доступно только личному профилю"), { statusCode: 403 });
    const state = normalizeReadingState(payload, owned, { timezone, defaultStatus: owned.reading_status });
    const readingStatus = state.readingStatus;
    const top3Specified = Object.hasOwn(payload, "top3") || Object.hasOwn(payload, "topRank");
    const top3Requested = payload.top3 === true || Number(payload.topRank) > 0;
    if (top3Requested && !top3Eligibility({ isAuthor: false, readingStatus }).allowed) throw Object.assign(new Error("В TOP3 можно добавлять только прочитанные книги из своей библиотеки"), { statusCode: 400 });
    let topRank = owned.top_rank ? Number(owned.top_rank) : null;
    if (top3Requested) {
      const [topBooks] = await connection.query(
        "SELECT book_id, top_rank FROM user_books WHERE user_id = ? AND top_rank IS NOT NULL ORDER BY top_rank FOR UPDATE",
        [userId],
      );
      topRank = nextTopRank(topBooks, bookId);
      if (!topRank) throw Object.assign(new Error("В TOP3 уже добавлены три книги. Сначала снимите отметку с одной из них."), { statusCode: 409, code: "TOP3_LIMIT" });
    }
    if (readingStatus !== "read" || top3Specified && !top3Requested) topRank = null;
    const storage = readingStateStorage(state, owned);
    const next = {
      rating: readingStatus === "read" ? state.rating : null,
      shortReview: readingStatus === "read" || readingStatus === "abandoned" ? state.shortReview : null,
      readMonth: readingStatus === "read" ? state.readMonth : null,
      readYear: readingStatus === "read" ? state.readYear : null,
      ...storage,
    };
    await connection.query("UPDATE user_books SET rating = ?, short_review = ?, read_month = ?, read_year = ?, reading_status = ?, last_read_chapter = ?, chapters_current = ?, chapters_total = ?, pages_current = ?, pages_total = ?, progress_unit = ?, reading_comment = ?, postponed_month = ?, postponed_year = ?, postponed_timezone = ?, top_rank = ? WHERE user_id = ? AND book_id = ?", [next.rating, next.shortReview, next.readMonth, next.readYear, readingStatus, next.chaptersCurrent, next.chaptersCurrent, next.chaptersTotal, next.pagesCurrent, next.pagesTotal, next.progressUnit, next.readingComment, next.postponedMonth, next.postponedYear, timezone, topRank, userId, bookId]);
    await syncReadingCycle(connection, { userId, bookId, previousStatus: owned.reading_status, state, isAuthor: false });
    await syncPostponedReminder(connection, { userId, bookId, state, previous: owned, timezone });
    return { bookId, topRank: topRank ?? undefined };
  });
  const owner = await ownerBookResponse(userId, bookId);
  response.json({ ...result, ...owner });
}));

async function noteBookAccess(connection, userId, bookId) {
  const [[book]] = await connection.query("SELECT id FROM books WHERE id = ?", [bookId]);
  if (!book) throw Object.assign(new Error("Книга не найдена"), { statusCode: 404 });
  await assertAdultMaterialReadable(connection, userId, "book", bookId);
}

function requireOnlyNoteFields(payload, allowed) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => !allowed.has(key))) {
    throw Object.assign(new Error("Некорректные поля заметки"), { statusCode: 400, code: "INVALID_BOOK_PROGRESS_NOTE" });
  }
}

async function selectedBookNote(connection, noteId) {
  const [[row]] = await connection.query(
    `SELECT n.*, p.display_name AS author_name, u.initials AS author_initials, u.avatar_path AS author_avatar_url
       FROM book_progress_notes n
       JOIN users u ON u.id = n.user_id
       JOIN profiles p ON p.user_id = n.user_id
      WHERE n.id = ?`,
    [noteId],
  );
  return row;
}

router.get("/books/:id/notes", asyncRoute(async (request, response) => {
  const viewerId = request.bookMeetUser.id;
  const bookId = Number(request.params.id);
  const scope = String(request.query.scope ?? "mine");
  if (!Number.isSafeInteger(bookId) || bookId <= 0 || !["mine", "all"].includes(scope)) return response.status(400).json({ error: "Некорректный запрос заметок" });
  const cursor = noteCursor(request.query.cursor);
  const pool = getPool();
  await noteBookAccess(pool, viewerId, bookId);
  const visibility = scope === "mine" ? "n.user_id = ?" : bookNoteVisibilityPredicate("n", "u", "viewer_book");
  const parameters = [viewerId, bookId];
  if (cursor !== null) parameters.push(cursor);
  parameters.push(viewerId);
  if (scope === "all") parameters.push(viewerId, viewerId, viewerId);
  const [rows] = await pool.query(
    `SELECT n.*, p.display_name AS author_name, u.initials AS author_initials, u.avatar_path AS author_avatar_url
       FROM book_progress_notes n
       JOIN users u ON u.id = n.user_id
       JOIN profiles p ON p.user_id = n.user_id
       LEFT JOIN user_books viewer_book ON viewer_book.user_id = ? AND viewer_book.book_id = n.book_id AND viewer_book.is_author = 0
      WHERE n.book_id = ? ${cursor === null ? "" : "AND n.id < ?"}
        AND ${visibility}
      ORDER BY n.id DESC
      LIMIT 21`,
    parameters,
  );
  const page = rows.slice(0, 20);
  response.json({ notes: page.map(noteDto), nextCursor: rows.length > 20 ? Number(page.at(-1).id) : null });
}));

router.post("/books/:id/notes", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const bookId = Number(request.params.id);
  if (!Number.isSafeInteger(bookId) || bookId <= 0) return response.status(400).json({ error: "Некорректная книга" });
  requireOnlyNoteFields(request.body, new Set(["body", "expectedProgress"]));
  const body = noteBody(request.body.body);
  const expected = expectedProgress(request.body.expectedProgress);
  const note = await withTransaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    await noteBookAccess(connection, userId, bookId);
    const [[profile]] = await connection.query("SELECT profile_type FROM profiles WHERE user_id = ?", [userId]);
    if (!["Читатель", "Писатель", "Блогер"].includes(profile?.profile_type)) throw Object.assign(new Error("Личные заметки доступны только личному профилю"), { statusCode: 403 });
    const [[library]] = await connection.query("SELECT * FROM user_books WHERE user_id = ? AND book_id = ? FOR UPDATE", [userId, bookId]);
    if (!library || library.is_author || library.reading_status !== "reading") throw Object.assign(new Error("Заметку можно сохранить только во время чтения книги"), { statusCode: 409 });
    const snapshot = progressSnapshot({
      unit: library.progress_unit,
      current: library.progress_unit === "chapters" ? library.chapters_current : library.pages_current,
      total: library.progress_unit === "chapters" ? library.chapters_total : library.pages_total,
    });
    if (!snapshot) throw Object.assign(new Error("Укажите корректный прогресс чтения перед сохранением заметки"), { statusCode: 409 });
    if (expected && !sameProgress(expected, snapshot)) throw Object.assign(new Error("Прогресс чтения изменился; подтвердите заметку ещё раз"), { statusCode: 409, code: "BOOK_NOTE_PROGRESS_CHANGED" });
    const [[cycle]] = await connection.query("SELECT id FROM reading_cycles WHERE user_id = ? AND book_id = ? AND status = 'active' FOR UPDATE", [userId, bookId]);
    if (!cycle) throw Object.assign(new Error("Активный цикл чтения не найден"), { statusCode: 409 });
    const [created] = await connection.query(
      "INSERT INTO book_progress_notes (user_id, book_id, reading_cycle_id, body, progress_unit, progress_current, progress_total, progress_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [userId, bookId, cycle.id, body, snapshot.unit, snapshot.current, snapshot.total, snapshot.percent],
    );
    return selectedBookNote(connection, Number(created.insertId));
  });
  response.status(201).json({ note: noteDto(note) });
}));

router.patch("/book-notes/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const noteId = Number(request.params.id);
  if (!Number.isSafeInteger(noteId) || noteId <= 0) return response.status(400).json({ error: "Некорректная заметка" });
  requireOnlyNoteFields(request.body, new Set(["body"]));
  const body = noteBody(request.body.body);
  const note = await withTransaction(async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [[owned]] = await connection.query("SELECT id, book_id FROM book_progress_notes WHERE id = ? AND user_id = ? FOR UPDATE", [noteId, userId]);
    if (!owned) throw Object.assign(new Error("Заметка не найдена"), { statusCode: 404 });
    await noteBookAccess(connection, userId, Number(owned.book_id));
    await connection.query("UPDATE book_progress_notes SET body = ? WHERE id = ?", [body, noteId]);
    return selectedBookNote(connection, noteId);
  });
  response.json({ note: noteDto(note) });
}));

router.delete("/book-notes/:id", asyncRoute(async (request, response) => {
  const noteId = Number(request.params.id);
  if (!Number.isSafeInteger(noteId) || noteId <= 0) return response.status(400).json({ error: "Некорректная заметка" });
  const [deleted] = await getPool().query("DELETE FROM book_progress_notes WHERE id = ? AND user_id = ?", [noteId, request.bookMeetUser.id]);
  if (!deleted.affectedRows) return response.status(404).json({ error: "Заметка не найдена" });
  response.json({ ok: true });
}));

function shelfId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error("Некорректная полка"), { statusCode: 400, code: "INVALID_SHELF" });
  return id;
}

async function deleteShelfMaterialRelations(connection, id) {
  await connection.query("DELETE FROM material_likes WHERE material_kind = 'shelf' AND material_id = ?", [id]);
  await connection.query("DELETE FROM material_saves WHERE material_kind = 'shelf' AND material_id = ?", [id]);
  await connection.query("DELETE FROM material_comments WHERE material_kind = 'shelf' AND material_id = ?", [id]);
  await cancelNotificationDeliveries(connection, { materialKind: "shelf", materialId: id });
  await connection.query("DELETE FROM notifications WHERE material_kind = 'shelf' AND material_id = ?", [id]);
}

async function persistShelf(connection, ownerId, payload, existingId = null) {
  const input = shelfPayload(payload);
  await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [ownerId]);
  const [[profile]] = await connection.query("SELECT profile_type FROM profiles WHERE user_id = ? FOR UPDATE", [ownerId]);
  if (!profile || !["Читатель", "Писатель", "Блогер"].includes(profile.profile_type)) throw Object.assign(new Error("Полки доступны только личным профилям"), { statusCode: 403 });
  if (existingId) {
    const [[owned]] = await connection.query("SELECT id FROM book_shelves WHERE id = ? AND owner_user_id = ? FOR UPDATE", [existingId, ownerId]);
    if (!owned) throw Object.assign(new Error("Полка не найдена"), { statusCode: 404 });
  }
  const ids = input.items.map((item) => item.bookId);
  const [library] = await connection.query(
    `SELECT book_id FROM user_books WHERE user_id = ? AND is_author = 0 AND book_id IN (${ids.map(() => "?").join(",")}) FOR UPDATE`, [ownerId, ...ids],
  );
  if (library.length !== ids.length) throw Object.assign(new Error("В полку можно добавлять только книги из своей библиотеки"), { statusCode: 409, code: "SHELF_BOOK_NOT_IN_LIBRARY" });
  let id = existingId;
  if (id) await connection.query("UPDATE book_shelves SET title = ?, description = ? WHERE id = ?", [input.title, input.description, id]);
  else {
    const [created] = await connection.query("INSERT INTO book_shelves (owner_user_id, title, description) VALUES (?, ?, ?)", [ownerId, input.title, input.description]);
    id = Number(created.insertId);
  }
  await connection.query("DELETE FROM book_shelf_items WHERE shelf_id = ?", [id]);
  for (const item of input.items) await connection.query("INSERT INTO book_shelf_items (shelf_id, book_id, position, description) VALUES (?, ?, ?, ?)", [id, item.bookId, item.position, item.description]);
  return id;
}

router.get("/users/:id/shelves", asyncRoute(async (request, response) => {
  const ownerId = shelfId(request.params.id);
  const result = await shelvesForUser(getPool(), request.bookMeetUser.id, ownerId, shelfCursor(request.query.cursor));
  response.json(result);
}));

router.get("/shelves/:id", asyncRoute(async (request, response) => {
  response.json({ shelf: await shelfDto(getPool(), request.bookMeetUser.id, shelfId(request.params.id)) });
}));

router.post("/shelves", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const shelf = await withTransaction(async (connection) => {
    const id = await persistShelf(connection, userId, request.body);
    return shelfDto(connection, userId, id);
  });
  response.status(201).json({ shelf });
}));

router.patch("/shelves/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const shelf = await withTransaction(async (connection) => {
    const id = await persistShelf(connection, userId, request.body, shelfId(request.params.id));
    return shelfDto(connection, userId, id);
  });
  response.json({ shelf });
}));

router.delete("/shelves/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const id = shelfId(request.params.id);
  await withTransaction(async (connection) => {
    const [[owned]] = await connection.query("SELECT id FROM book_shelves WHERE id = ? AND owner_user_id = ? FOR UPDATE", [id, userId]);
    if (!owned) throw Object.assign(new Error("Полка не найдена"), { statusCode: 404 });
    await deleteShelfMaterialRelations(connection, id);
    await connection.query("DELETE FROM book_shelves WHERE id = ?", [id]);
  });
  response.json({ ok: true });
}));

router.post("/shelves/:id/add-to-library", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const id = shelfId(request.params.id);
  const result = await withTransaction(async (connection) => {
    await assertShelfReadable(connection, userId, id);
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const canReadAdult = await (async () => {
      const [[row]] = await connection.query("SELECT u.role, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", [userId]);
      return row?.role === "admin" || Number(ageFromBirthDate(row?.birth_date) ?? -1) >= 18;
    })();
    const [items] = await connection.query("SELECT i.book_id, b.is_adult FROM book_shelf_items i LEFT JOIN books b ON b.id = i.book_id WHERE i.shelf_id = ? ORDER BY i.position FOR UPDATE", [id]);
    const ids = items.map((item) => item.book_id ? Number(item.book_id) : null).filter(Boolean);
    const [existing] = ids.length ? await connection.query(`SELECT book_id FROM user_books WHERE user_id = ? AND book_id IN (${ids.map(() => "?").join(",")}) FOR UPDATE`, [userId, ...ids]) : [[]];
    const existingIds = new Set(existing.map((item) => Number(item.book_id)));
    let addedCount = 0; let skippedExistingCount = 0; let skippedUnavailableCount = 0; const addedIds = [];
    for (const item of items) {
      const bookId = item.book_id ? Number(item.book_id) : null;
      if (!bookId || !canReadAdult && item.is_adult) { skippedUnavailableCount += 1; continue; }
      if (existingIds.has(bookId)) { skippedExistingCount += 1; continue; }
      try {
        await connection.query("INSERT INTO user_books (user_id, book_id, reading_status, is_author) VALUES (?, ?, 'want', 0)", [userId, bookId]);
        existingIds.add(bookId); addedIds.push(bookId); addedCount += 1;
      } catch (error) {
        if (error?.code !== "ER_DUP_ENTRY") throw error;
        existingIds.add(bookId); skippedExistingCount += 1;
      }
    }
    const [addedRows] = addedIds.length ? await connection.query(
      `SELECT b.id, b.creator_user_id, b.author, b.title, b.isbn, b.publisher, b.genres, b.annotation, b.is_adult, b.cover_path, b.cover_tone, b.flip_url
         FROM books b WHERE b.id IN (${addedIds.map(() => "?").join(",")})`, addedIds,
    ) : [[]];
    const byId = new Map(addedRows.map((row) => [Number(row.id), row]));
    const addedBooks = addedIds.map((bookId) => {
      const book = byId.get(bookId);
      return { id: bookId, catalogBookId: bookId, creatorUserId: book.creator_user_id ? Number(book.creator_user_id) : undefined, author: book.author, title: book.title, isbn: book.isbn ?? undefined, publisher: book.publisher ?? undefined, genres: jsonArray(book.genres), annotation: book.annotation ?? "", pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", readingStatus: "want", isAdult: Boolean(book.is_adult), coverUrl: book.cover_path ?? undefined, coverTone: book.cover_tone ?? "blue", flipUrl: book.flip_url ?? undefined, links: [] };
    });
    return { addedCount, skippedExistingCount, skippedUnavailableCount, addedBooks };
  });
  response.json(result);
}));

// Editors use these owner-scoped routes instead of replacing an entire profile
// snapshot.  In particular PATCH keeps the existing material id intact.
async function saveOwnedReadingMaterial(request, response, kind, id = null) {
  const userId = request.bookMeetUser.id;
  const payload = request.body ?? {};
  const bodyHtml = validateRichHtml(payload.bodyHtml ?? payload.fullText ?? payload.body ?? "");
  if (!bodyHtml) return response.status(400).json({ error: "Заполните текст материала" });
  const result = await withTransaction(async (connection) => {
    const [[owner]] = await connection.query("SELECT profile_type FROM profiles WHERE user_id = ? FOR UPDATE", [userId]);
    if (!["Читатель", "Писатель", "Блогер"].includes(owner?.profile_type)) {
      throw Object.assign(new Error("Рецензии и публикации доступны только личным профилям"), { statusCode: 403 });
    }
    if (kind === "review") {
      const bookId = Number(payload.bookId);
      const rating = Number(payload.rating);
      if (!bookId || !Number.isInteger(rating * 2) || rating < .5 || rating > 5 || !String(payload.preview ?? "").trim()) throw Object.assign(new Error("Заполните книгу, оценку и краткий отзыв"), { statusCode: 400 });
      const [[book]] = await connection.query("SELECT id, title, author FROM books WHERE id = ?", [bookId]);
      if (!book) throw Object.assign(new Error("Выбранная книга не найдена"), { statusCode: 404 });
      await assertAdultMaterialAllowed(connection, userId, Boolean(payload.isAdult));
      if (id) {
        const [updated] = await connection.query("UPDATE reviews SET book_id = ?, rating = ?, preview = ?, body = ?, is_adult = ? WHERE id = ? AND user_id = ?", [bookId, rating, String(payload.preview).trim(), bodyHtml, payload.isAdult ? 1 : 0, id, userId]);
        if (!updated.affectedRows) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
        await syncMaterialBooks(connection, "review", id, [bookId]);
        await syncMentions(connection, { entityType: "review", entityId: id, authorUserId: userId, mentionUserIds: payload.mentionUserIds ?? payload.mentions, text: `${String(payload.preview ?? "")}\n${plainTextFromHtml(bodyHtml)}`, publicMaterial: true, materialKind: "review", materialId: id });
        return { id, bookTitle: book.title, bookAuthor: book.author };
      }
      const [created] = await connection.query("INSERT INTO reviews (user_id, book_id, rating, preview, body, is_adult) VALUES (?, ?, ?, ?, ?, ?)", [userId, bookId, rating, String(payload.preview).trim(), bodyHtml, payload.isAdult ? 1 : 0]);
      const materialId = Number(created.insertId);
      await syncMaterialBooks(connection, "review", materialId, [bookId]);
      await syncMentions(connection, { entityType: "review", entityId: materialId, authorUserId: userId, mentionUserIds: payload.mentionUserIds ?? payload.mentions, text: `${String(payload.preview ?? "")}\n${plainTextFromHtml(bodyHtml)}`, publicMaterial: true, materialKind: "review", materialId });
      return { id: materialId, bookTitle: book.title, bookAuthor: book.author };
    }
    const bookIds = [...new Set((Array.isArray(payload.bookIds) ? payload.bookIds : [payload.bookId]).map(Number).filter(Number.isInteger))].slice(0, 50);
    const books = await linkedBookPreviews(connection, bookIds);
    const preview = String(payload.previewText ?? payload.text ?? "").trim();
    if (!preview) throw Object.assign(new Error("Добавьте краткое описание публикации"), { statusCode: 400 });
    await assertAdultMaterialAllowed(connection, userId, Boolean(payload.isAdult));
    if (id) {
      const [updated] = await connection.query("UPDATE excerpts SET book_id = ?, book_title = ?, preview_text = ?, body_html = ?, body = ?, is_adult = ? WHERE id = ? AND user_id = ?", [books[0]?.id ?? null, books[0]?.title ?? "", preview, bodyHtml, plainTextFromHtml(bodyHtml), payload.isAdult ? 1 : 0, id, userId]);
      if (!updated.affectedRows) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
      await syncMaterialBooks(connection, "excerpt", id, books.map((book) => book.id));
      await syncMentions(connection, { entityType: "excerpt", entityId: id, authorUserId: userId, mentionUserIds: payload.mentionUserIds ?? payload.mentions, text: `${preview}\n${plainTextFromHtml(bodyHtml)}`, publicMaterial: true, materialKind: "excerpt", materialId: id });
      return { id, bookTitle: books[0]?.title ?? "", bookIds: books.map((book) => book.id) };
    }
    const [created] = await connection.query("INSERT INTO excerpts (user_id, book_id, book_title, preview_text, body_html, body, is_adult, read_url) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)", [userId, books[0]?.id ?? null, books[0]?.title ?? "", preview, bodyHtml, plainTextFromHtml(bodyHtml), payload.isAdult ? 1 : 0]);
    const materialId = Number(created.insertId);
    await syncMaterialBooks(connection, "excerpt", materialId, books.map((book) => book.id));
    await syncMentions(connection, { entityType: "excerpt", entityId: materialId, authorUserId: userId, mentionUserIds: payload.mentionUserIds ?? payload.mentions, text: `${preview}\n${plainTextFromHtml(bodyHtml)}`, publicMaterial: true, materialKind: "excerpt", materialId });
    return { id: materialId, bookTitle: books[0]?.title ?? "", bookIds: books.map((book) => book.id) };
  });
  response.status(id ? 200 : 201).json(result);
}
router.post("/reviews", asyncRoute((request, response) => saveOwnedReadingMaterial(request, response, "review")));
router.patch("/reviews/:id", asyncRoute((request, response) => saveOwnedReadingMaterial(request, response, "review", Number(request.params.id))));
router.post("/excerpts", asyncRoute((request, response) => saveOwnedReadingMaterial(request, response, "excerpt")));
router.patch("/excerpts/:id", asyncRoute((request, response) => saveOwnedReadingMaterial(request, response, "excerpt", Number(request.params.id))));

router.post("/materials/:type/:id/repost", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const sourceType = String(request.params.type); const sourceId = Number(request.params.id);
  if (!['review', 'excerpt', 'publication', 'publisher_news', 'event', 'occasion', 'shelf'].includes(sourceType) || !sourceId) return response.status(400).json({ error: "Этот материал нельзя репостнуть" });
  const kind = sourceType === 'publication' ? 'excerpt' : sourceType;
  const rawText = String(request.body?.text ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  if (rawText && Array.from(rawText).length > 3000) return response.status(400).json({ error: "Текст репоста слишком длинный" });
  const repost = await withTransaction(async (connection) => {
    const source = await readableMaterialInfo(connection, userId, kind, sourceId);
    let rootType = kind; let rootId = sourceId;
    let sourceExcerpt = null;
    if (kind === 'excerpt') {
      [[sourceExcerpt]] = await connection.query("SELECT provenance_repost_id FROM excerpts WHERE id = ?", [sourceId]);
      if (sourceExcerpt?.provenance_repost_id) {
        const [[origin]] = await connection.query("SELECT source_root_type, source_root_id FROM reposts WHERE id = ?", [sourceExcerpt.provenance_repost_id]);
        if (origin) { rootType = origin.source_root_type; rootId = Number(origin.source_root_id); }
      }
    }
    const isOwnTextRepost = kind === "excerpt" && Boolean(sourceExcerpt?.provenance_repost_id);
    if (Number(source.owner_id) === userId && (isOwnTextRepost || rootType === kind && rootId === sourceId)) throw Object.assign(new Error("Нельзя репостнуть собственный материал"), { statusCode: 409 });
    let created;
    try {
      [created] = await connection.query("INSERT INTO reposts (user_id, source_material_type, source_material_id, source_root_type, source_root_id, clean_source_root_id) VALUES (?, ?, ?, ?, ?, ?)", [userId, kind, sourceId, rootType, rootId, rawText ? null : rootId]);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY' && !rawText) throw Object.assign(new Error("Такой репост уже есть"), { statusCode: 409 });
      throw error;
    }
    const repostId = Number(created.insertId);
    if (!rawText) return { id: repostId, clean: true, source: { kind: rootType, id: rootId } };
    const bodyHtml = escapedParagraph(rawText);
    const [excerpt] = await connection.query("INSERT INTO excerpts (user_id, book_id, book_title, preview_text, body_html, body, is_adult, read_url, provenance_repost_id) VALUES (?, NULL, '', ?, ?, ?, 0, NULL, ?)", [userId, rawText.slice(0, 500), bodyHtml, plainTextFromHtml(bodyHtml), repostId]);
    await syncMentions(connection, { entityType: 'excerpt', entityId: Number(excerpt.insertId), authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: rawText, publicMaterial: true, materialKind: 'excerpt', materialId: Number(excerpt.insertId) });
    return { id: repostId, clean: false, material: { id: Number(excerpt.insertId), kind: 'excerpt', text: rawText } };
  });
  response.status(201).json({ repost });
}));

router.delete("/reposts/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const repostId = Number(request.params.id);
  await withTransaction(async (connection) => {
    const [[repost]] = await connection.query("SELECT id FROM reposts WHERE id = ? AND user_id = ? FOR UPDATE", [repostId, userId]);
    if (!repost) throw Object.assign(new Error("Репост не найден"), { statusCode: 404 });
    // Text repost stays a normal publication; only private provenance is removed.
    await connection.query("UPDATE excerpts SET provenance_repost_id = NULL WHERE provenance_repost_id = ?", [repostId]);
    await connection.query("DELETE FROM reposts WHERE id = ?", [repostId]);
  }); response.json({ ok: true });
}));

router.delete("/materials/:kind/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const kind = String(request.params.kind ?? "");
  const materialId = Number(request.params.id);
  const tables = { review: "reviews", excerpt: "excerpts", shelf: "book_shelves" };
  const table = tables[kind];
  if (!table || !materialId) return response.status(400).json({ error: "Некорректный материал" });
  await withTransaction(async (connection) => {
    if (kind === "shelf") {
      const [[owned]] = await connection.query("SELECT id FROM book_shelves WHERE id = ? AND owner_user_id = ? FOR UPDATE", [materialId, userId]);
      if (!owned) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
      await deleteShelfMaterialRelations(connection, materialId);
      await connection.query("DELETE FROM book_shelves WHERE id = ?", [materialId]);
      return;
    }
    let provenanceRepostId = null;
    if (kind === "excerpt") {
      const [[ownedExcerpt]] = await connection.query("SELECT provenance_repost_id FROM excerpts WHERE id = ? AND user_id = ? FOR UPDATE", [materialId, userId]);
      provenanceRepostId = ownedExcerpt?.provenance_repost_id ? Number(ownedExcerpt.provenance_repost_id) : null;
    }
    await connection.query("DELETE FROM material_books WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM content_mentions WHERE entity_type = ? AND entity_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_likes WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_saves WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_comments WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await cancelNotificationDeliveries(connection, { materialKind: kind, materialId });
    await connection.query("DELETE FROM notifications WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    const [deleted] = await connection.query(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [materialId, userId]);
    if (!deleted.affectedRows) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
    if (provenanceRepostId) await connection.query("DELETE FROM reposts WHERE id = ? AND user_id = ?", [provenanceRepostId, userId]);
  });
  response.json({ ok: true });
}));

router.patch("/admin/materials/:kind/:id", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const kind = String(request.params.kind ?? "");
  const materialId = Number(request.params.id);
  const payload = request.body ?? {};
  const title = String(payload.title ?? payload.bookTitle ?? (kind === "excerpt" ? "Публикация" : "")).trim();
  const text = String(payload.text ?? payload.preview ?? payload.previewText ?? "").trim();
  if (!["book", "review", "excerpt", "publisher_news"].includes(kind) || !materialId || !title) return response.status(400).json({ error: "Некорректные данные материала" });
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    let updated;
    if (kind === "book") {
      const [[book]] = await connection.query("SELECT author, cover_path FROM books WHERE id = ? FOR UPDATE", [materialId]);
      if (!book) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
      const author = String(payload.author ?? book.author).trim();
      const flipUrl = String(payload.flipUrl ?? "").trim();
      if (flipUrl) marketplaceFromUrl(flipUrl);
      const coverPath = payload.coverUrl ? await saveCover(payload.coverUrl) : null;
      [updated] = await connection.query(
        "UPDATE books SET author = ?, author_key = ?, title = ?, title_key = ?, genres = ?, annotation = ?, is_adult = ?, cover_path = COALESCE(?, cover_path), cover_tone = ?, flip_url = COALESCE(?, flip_url) WHERE id = ?",
        [author, normalizeIdentity(author), title, normalizeIdentity(title), JSON.stringify(payload.genres ?? []), String(payload.annotation ?? text), payload.isAdult ? 1 : 0, coverPath, String(payload.coverTone ?? "blue"), flipUrl || null, materialId],
      );
      if (Array.isArray(payload.links)) {
        await connection.query("DELETE FROM book_links WHERE book_id = ?", [materialId]);
        const ownerId = Number(payload.ownerId) || adminId;
        for (const link of payload.links.slice(0, 3)) {
          if (!link.label?.trim() || !link.url?.trim()) continue;
          await connection.query("INSERT INTO book_links (book_id, owner_user_id, action, label, url) VALUES (?, ?, ?, ?, ?)", [materialId, ownerId, ["Купить", "Читать", "Слушать"].includes(link.action) ? link.action : "Читать", link.label.trim(), cleanUrl(link.url)]);
        }
      }
    } else if (kind === "review") {
      const requestedBookId = Number(payload.bookId) || null;
      const [[existingBook]] = requestedBookId ? await connection.query("SELECT id FROM books WHERE id = ?", [requestedBookId]) : [[]];
      const book = existingBook ?? await resolveBook(connection, String(payload.bookAuthor ?? "").trim(), title);
      const bodyHtml = validateRichHtml(payload.bodyHtml ?? payload.fullText ?? payload.body ?? "");
      [updated] = await connection.query("UPDATE reviews SET book_id = ?, rating = ?, preview = ?, body = ?, is_adult = ? WHERE id = ?", [book.id, Number(payload.rating) || 0, String(payload.preview ?? text).trim(), bodyHtml, payload.isAdult ? 1 : 0, materialId]);
      await syncMaterialBooks(connection, "review", materialId, [book.id]);
    } else if (kind === "excerpt") {
      const linkedBookIds = [...new Set((Array.isArray(payload.bookIds) ? payload.bookIds : [payload.bookId]).map(Number).filter(Number.isInteger))].slice(0, 50);
      const linkedBooks = await linkedBookPreviews(connection, linkedBookIds);
      const linkedBookId = linkedBooks[0]?.id ?? null;
      const bodyHtml = validateRichHtml(payload.bodyHtml);
      [updated] = await connection.query("UPDATE excerpts SET book_id = ?, book_title = ?, preview_text = ?, body_html = ?, body = ?, is_adult = ? WHERE id = ?", [linkedBookId, linkedBooks[0]?.title ?? (title === "Публикация" ? "" : title), String(payload.previewText ?? text).trim(), bodyHtml, plainTextFromHtml(bodyHtml) || String(payload.body ?? payload.text ?? text).trim(), payload.isAdult ? 1 : 0, materialId]);
      await syncMaterialBooks(connection, "excerpt", materialId, linkedBooks.map((book) => book.id));
    } else {
      const bodyHtml = validateRichHtml(payload.bodyHtml ?? payload.body ?? "");
      [updated] = await connection.query(
        "UPDATE publisher_news SET title = ?, preview_text = ?, body_html = ?, body = ?, is_adult = ? WHERE id = ?",
        [title, String(payload.previewText ?? text).trim(), bodyHtml, plainTextFromHtml(bodyHtml) || String(payload.body ?? text).trim(), payload.isAdult ? 1 : 0, materialId],
      );
    }
    if (!updated.affectedRows) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
  });
  response.json({ ok: true });
}));

router.delete("/admin/materials/:kind/:id", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const kind = String(request.params.kind ?? "");
  const materialId = Number(request.params.id);
  const tables = { book: "books", review: "reviews", excerpt: "excerpts", event: "events", occasion: "occasions", publisher_news: "publisher_news", shelf: "book_shelves" };
  const table = tables[kind];
  if (!table || !materialId) return response.status(400).json({ error: "Некорректный материал" });
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    if (kind === "book") {
      const [reviewRows] = await connection.query("SELECT id FROM reviews WHERE book_id = ?", [materialId]);
      const reviewIds = reviewRows.map((row) => Number(row.id));
      if (reviewIds.length) {
        const placeholders = reviewIds.map(() => "?").join(",");
        await connection.query(`DELETE FROM material_likes WHERE material_kind = 'review' AND material_id IN (${placeholders})`, reviewIds);
        await connection.query(`DELETE FROM material_saves WHERE material_kind = 'review' AND material_id IN (${placeholders})`, reviewIds);
        await connection.query(`DELETE FROM material_comments WHERE material_kind = 'review' AND material_id IN (${placeholders})`, reviewIds);
        for (const reviewId of reviewIds) await cancelNotificationDeliveries(connection, { materialKind: "review", materialId: reviewId });
        await connection.query(`DELETE FROM notifications WHERE material_kind = 'review' AND material_id IN (${placeholders})`, reviewIds);
      }
      await connection.query("UPDATE wishlist_items SET catalog_book_id = NULL WHERE catalog_book_id = ?", [materialId]);
    }
    let provenanceRepostId = null;
    if (kind === "excerpt") {
      const [[sourceExcerpt]] = await connection.query("SELECT provenance_repost_id FROM excerpts WHERE id = ? FOR UPDATE", [materialId]);
      provenanceRepostId = sourceExcerpt?.provenance_repost_id ? Number(sourceExcerpt.provenance_repost_id) : null;
    }
    if (kind !== "book") {
      await connection.query("DELETE FROM material_books WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_likes WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_saves WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
      await connection.query("DELETE FROM material_comments WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    }
    await cancelNotificationDeliveries(connection, { materialKind: kind, materialId });
    await connection.query("DELETE FROM notifications WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    const [deleted] = await connection.query(`DELETE FROM ${table} WHERE id = ?`, [materialId]);
    if (!deleted.affectedRows) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
    if (provenanceRepostId) await connection.query("DELETE FROM reposts WHERE id = ?", [provenanceRepostId]);
  });
  response.json({ ok: true });
}));

router.post("/wishlist/preview", asyncRoute(async (request, response) => {
  const product = await fetchFlipProduct(request.body?.productUrl);
  response.json({ product: { ...product, coverUrl: await previewRemoteCover(product.coverUrl) } });
}));

router.post("/books/preview", asyncRoute(async (request, response) => {
  const product = await fetchBookProduct(request.body?.productUrl);
  const sourceUrl = cleanUrl(product.productUrl);
  let match = null;
  if (product.isbn) {
    [[match]] = await getPool().query(
      "SELECT id, author, title, isbn, publisher, annotation, cover_path AS coverUrl, cover_tone AS coverTone, flip_url AS flipUrl FROM books WHERE isbn_key = ? LIMIT 1",
      [normalizeIsbn(product.isbn)],
    );
  }
  if (!match) {
    [[match]] = await getPool().query(
      `SELECT b.id, b.author, b.title, b.isbn, b.publisher, b.annotation, b.cover_path AS coverUrl, b.cover_tone AS coverTone, b.flip_url AS flipUrl
         FROM books b
         LEFT JOIN book_links bl ON bl.book_id = b.id
        WHERE bl.url = ? OR b.flip_url = ?
        LIMIT 1`,
      [sourceUrl, sourceUrl],
    );
  }
  const remoteCover = await previewRemoteCover(product.coverUrl);
  response.json({
    product: match ? {
      ...product,
      catalogBookId: Number(match.id),
      author: match.author,
      title: match.title,
      isbn: match.isbn || product.isbn,
      publisher: match.publisher || product.publisher,
      annotation: match.annotation || product.annotation,
      coverUrl: match.coverUrl || remoteCover,
    } : { ...product, coverUrl: remoteCover },
  });
}));

router.post("/wishlist", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const payload = request.body ?? {};
  const marketplace = marketplaceFromUrl(payload.productUrl);
  const pickupAddress = String(payload.pickupAddress ?? "").trim();
  const recipientName = String(payload.recipientName ?? "").trim();
  const phone = String(payload.phone ?? "").trim();
  if (!pickupAddress || !recipientName || !phone) return response.status(400).json({ error: "Укажите имя, адрес пункта выдачи и телефон получателя" });
  if (!/^7\d{10}$/.test(phone.replace(/\D/g, ""))) return response.status(400).json({ error: "Укажите полный номер телефона получателя" });
  const flipProduct = await fetchFlipProduct(marketplace.url.toString());
  const item = await withTransaction(async (connection) => {
    const [[profile]] = await connection.query("SELECT profile_type FROM profiles WHERE user_id = ?", [userId]);
    if (!["Читатель", "Писатель", "Блогер"].includes(profile?.profile_type)) throw Object.assign(new Error("Список «Хочу почитать!» доступен личным профилям"), { statusCode: 403 });
    let catalogBookId = Number(payload.catalogBookId || 0) || null;
    let book = null;
    if (catalogBookId) {
      [[book]] = await connection.query("SELECT id, author, title, genres, annotation, cover_path, cover_tone FROM books WHERE id = ?", [catalogBookId]);
      if (!book) throw Object.assign(new Error("Книга из каталога не найдена"), { statusCode: 404 });
    } else {
      [[book]] = await connection.query("SELECT id, author, title, genres, annotation, cover_path, cover_tone FROM books WHERE author_key = ? AND title_key = ? LIMIT 1", [normalizeIdentity(flipProduct.author), normalizeIdentity(flipProduct.title)]);
      if (book) catalogBookId = Number(book.id);
    }
    const author = flipProduct.author;
    const title = flipProduct.title;
    const flipCoverPath = await saveRemoteCover(flipProduct.coverUrl);
    const coverPath = flipCoverPath ?? book?.cover_path ?? null;
    const annotation = flipProduct.annotation || book?.annotation || "";
    if (book && (!book.cover_path || !String(book.annotation ?? "").trim())) {
      await connection.query("UPDATE books SET cover_path = COALESCE(cover_path, ?), annotation = CASE WHEN annotation IS NULL OR annotation = '' THEN ? ELSE annotation END WHERE id = ?", [flipCoverPath, flipProduct.annotation, book.id]);
    }
    const [created] = await connection.query(
      `INSERT INTO wishlist_items (user_id, catalog_book_id, author, title, genres, annotation, cover_path, cover_tone, marketplace, product_url, pickup_address, recipient_name, recipient_phone, price_amount, price_currency, price_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [userId, catalogBookId, author, title, book?.genres ?? "[]", annotation, coverPath, book?.cover_tone ?? "blue", marketplace.name, marketplace.url.toString(), pickupAddress, recipientName, phone, flipProduct.price, flipProduct.currency],
    );
    if (catalogBookId) await notifyWriterAboutBook(connection, catalogBookId, userId, "wishlist", `wishlist-${created.insertId}`);
    return { id: Number(created.insertId), ownerId: userId, catalogBookId: catalogBookId ?? undefined, author, title, genres: book ? JSON.parse(book.genres || "[]") : [], annotation, coverUrl: coverPath ?? undefined, coverTone: book?.cover_tone ?? "blue", marketplace: marketplace.name, productUrl: marketplace.url.toString(), pickupAddress, recipientName, phone, price: flipProduct.price ?? undefined, priceCurrency: flipProduct.currency, priceCheckedAt: new Date().toISOString(), privateVisible: true };
  });
  response.status(201).json({ item });
}));

router.delete("/wishlist/:id", asyncRoute(async (request, response) => {
  const [result] = await getPool().query("DELETE FROM wishlist_items WHERE id = ? AND user_id = ?", [Number(request.params.id), request.bookMeetUser.id]);
  if (!result.affectedRows) return response.status(404).json({ error: "Книга не найдена" });
  response.json({ ok: true });
}));

router.get("/wishlist/:id/price", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const itemId = Number(request.params.id);
  const [[item]] = await getPool().query(
    `SELECT w.user_id, w.product_url
       FROM wishlist_items w
      WHERE w.id = ? AND (w.user_id = ? OR EXISTS (
        SELECT 1 FROM friendships f WHERE (f.user_low_id = w.user_id AND f.user_high_id = ?) OR (f.user_high_id = w.user_id AND f.user_low_id = ?)
      ))`, [itemId, userId, userId, userId],
  );
  if (!item) return response.status(404).json({ error: "Карточка недоступна" });
  const product = await fetchFlipProduct(item.product_url);
  await getPool().query("UPDATE wishlist_items SET price_amount = ?, price_currency = ?, price_checked_at = UTC_TIMESTAMP() WHERE id = ?", [product.price, product.currency, itemId]);
  response.json({ price: product.price, currency: product.currency, checkedAt: new Date().toISOString(), marketplace: product.marketplace });
}));

router.post("/wishlist/:id/reserve", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const itemId = Number(request.params.id);
  const result = await withTransaction(async (connection) => {
    const [[item]] = await connection.query("SELECT user_id, title, product_url, reserved_by_user_id FROM wishlist_items WHERE id = ? FOR UPDATE", [itemId]);
    if (!item) throw Object.assign(new Error("Книга не найдена"), { statusCode: 404 });
    if (Number(item.user_id) === userId) throw Object.assign(new Error("Нельзя забронировать собственный подарок"), { statusCode: 400 });
    const low = Math.min(userId, Number(item.user_id)); const high = Math.max(userId, Number(item.user_id));
    const [[friendship]] = await connection.query("SELECT 1 AS ok FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
    if (!friendship) throw Object.assign(new Error("Список доступен только друзьям"), { statusCode: 403 });
    if (item.reserved_by_user_id && Number(item.reserved_by_user_id) !== userId) throw Object.assign(new Error("Подарок уже забронирован"), { statusCode: 409 });
    if (!item.reserved_by_user_id) {
      await connection.query("UPDATE wishlist_items SET reserved_by_user_id = ?, reserved_at = UTC_TIMESTAMP() WHERE id = ?", [userId, itemId]);
      const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
      const occurrence = await nextNotificationOccurrence(connection, {
        recipientUserId: item.user_id,
        actorUserId: userId,
        eventType: "gift_reserved",
        materialKind: "wishlist",
        materialId: itemId,
      });
      await createNotificationEvent(connection, {
        recipientUserId: item.user_id,
        actorUserId: userId,
        eventType: "gift_reserved",
        title: "Подарок забронирован",
        body: `${actor?.display_name ?? "Друг"} забронировал(а) подарок «${item.title}».`,
        materialKind: "wishlist",
        materialId: itemId,
        dedupeKey: `gift-reserved:${itemId}:${userId}:g${occurrence}`,
        groupKey: `gift-reserved:${itemId}`,
      });
    }
    return { checkoutUrl: item.product_url, reservedByUserId: userId };
  });
  response.json(result);
}));

router.delete("/wishlist/:id/reservation", asyncRoute(async (request, response) => {
  const itemId = Number(request.params.id);
  const removed = await withTransaction(async (connection) => {
    const [[item]] = await connection.query("SELECT reserved_by_user_id FROM wishlist_items WHERE id = ? AND user_id = ? FOR UPDATE", [itemId, request.bookMeetUser.id]);
    if (!item) return false;
    await connection.query("UPDATE wishlist_items SET reserved_by_user_id = NULL, reserved_at = NULL WHERE id = ?", [itemId]);
    if (item.reserved_by_user_id) {
      await cancelNotificationDeliveries(connection, { actorUserId: item.reserved_by_user_id, eventType: "gift_reserved", materialKind: "wishlist", materialId: itemId });
    }
    return true;
  });
  if (!removed) return response.status(404).json({ error: "Карточка не найдена" });
  response.json({ ok: true });
}));

router.post("/reports", asyncRoute(async (request, response) => {
  const reporterId = request.bookMeetUser.id;
  const targetKind = String(request.body?.targetKind ?? "");
  const targetId = Number(request.body?.targetId);
  const reason = String(request.body?.reason ?? "").trim().slice(0, 5000);
  const shouldBlock = Boolean(request.body?.blockUser);
  if (!reason) return response.status(400).json({ error: "Опишите причину жалобы" });
  if (!REPORT_TARGET_KINDS.has(targetKind) || !targetId) return response.status(400).json({ error: "Некорректный объект жалобы" });
  const result = await withTransaction(async (connection) => {
    if (targetKind === "book_note") await assertBookNoteReadable(connection, reporterId, targetId);
    if (targetKind === "shelf") await readableMaterialInfo(connection, reporterId, "shelf", targetId);
    if (targetKind === "marketplace_listing" || targetKind === "marketplace_conversation") {
      await assertMarketplaceAdult(connection, reporterId, ageFromBirthDate);
      if (targetKind === "marketplace_listing") {
        const [[visible]] = await connection.query(`SELECT l.id FROM marketplace_listings l
          WHERE l.id = ? AND l.seller_user_id IS NOT NULL AND
            (l.status = 'active' OR EXISTS (SELECT 1 FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
              WHERE c.marketplace_listing_id = l.id AND cm.user_id = ? AND cm.left_at IS NULL))`, [targetId, reporterId]);
        if (!visible) throw Object.assign(new Error("Объявление не найдено"), { statusCode: 404 });
      } else {
        const [[member]] = await connection.query("SELECT cm.user_id FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ? AND cm.left_at IS NULL WHERE c.id = ? AND c.conversation_type = 'marketplace'", [reporterId, targetId]);
        if (!member) throw Object.assign(new Error("Диалог не найден"), { statusCode: 404 });
      }
    }
    const target = await reportTarget(connection, targetKind, targetId);
    if (!target) throw Object.assign(new Error("Материал или пользователь не найден"), { statusCode: 404 });
    if (targetKind === "marketplace_conversation" && Number(target.owner_id) === reporterId) target.owner_id = target.buyer_id;
    if (Number(target.owner_id) === reporterId) throw Object.assign(new Error("Нельзя пожаловаться на собственный материал"), { statusCode: 400 });
    const provisionalReference = `pending-${randomBytes(12).toString("hex")}`;
    const [created] = await connection.query(
      "INSERT INTO reports (reference_code, reporter_user_id, target_kind, target_id, target_user_id, reason, status, due_at) VALUES (?, ?, ?, ?, ?, ?, 'new', DATE_ADD(DATE(UTC_TIMESTAMP()), INTERVAL 21 DAY))",
      [provisionalReference, reporterId, targetKind, targetId, target.owner_id || null, reason],
    );
    const reference = `BMC-${new Date().getUTCFullYear()}-${String(created.insertId).padStart(6, "0")}`;
    await connection.query("UPDATE reports SET reference_code = ? WHERE id = ?", [reference, created.insertId]);
    await connection.query("INSERT INTO report_status_history (report_id, actor_user_id, old_status, new_status, note) VALUES (?, ?, NULL, 'new', ?)", [created.insertId, reporterId, reason]);
    await enqueueTelegramAlert(connection, { eventType: "report_created", entityId: created.insertId, actorUserId: reporterId, summary: targetKind });
    if (targetKind === "user" && shouldBlock) await applyPersonalBlock(connection, reporterId, targetId);
    return { id: Number(created.insertId), reference, status: "new", blocked: targetKind === "user" && shouldBlock };
  });
  response.status(201).json(result);
}));

router.get("/reports/mine", asyncRoute(async (request, response) => {
  const [reports] = await getPool().query(
    `SELECT id, reference_code, target_kind, target_id, target_user_id, reason, status, created_at, due_at,
            motivated_response, response_at, appealed_at, appeal_text
       FROM reports WHERE reporter_user_id = ? ORDER BY created_at DESC`,
    [request.bookMeetUser.id],
  );
  response.json({ reports: reports.map((row) => ({
    id: Number(row.id), reference: row.reference_code, targetKind: row.target_kind, targetId: Number(row.target_id),
    targetUserId: row.target_user_id ? Number(row.target_user_id) : undefined, reason: row.reason, status: row.status,
    createdAt: new Date(row.created_at).toISOString(), dueAt: row.due_at ? new Date(row.due_at).toISOString() : undefined,
    motivatedResponse: row.motivated_response ?? undefined, responseAt: row.response_at ? new Date(row.response_at).toISOString() : undefined,
    appealedAt: row.appealed_at ? new Date(row.appealed_at).toISOString() : undefined, appealText: row.appeal_text ?? undefined,
  })) });
}));

router.post("/reports/:id/appeal", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const reportId = Number(request.params.id);
  const text = String(request.body?.text ?? "").trim().slice(0, 5000);
  if (!text) return response.status(400).json({ error: "Опишите причину обжалования" });
  await withTransaction(async (connection) => {
    const [[report]] = await connection.query("SELECT reporter_user_id, status, appealed_at FROM reports WHERE id = ? FOR UPDATE", [reportId]);
    if (!report || Number(report.reporter_user_id) !== userId) throw Object.assign(new Error("Жалоба не найдена"), { statusCode: 404 });
    if (!["satisfied", "rejected"].includes(report.status) || report.appealed_at) throw Object.assign(new Error("Это решение нельзя обжаловать"), { statusCode: 409 });
    await connection.query("INSERT INTO report_appeals (report_id, appellant_user_id, appeal_text) VALUES (?, ?, ?)", [reportId, userId, text]);
    await connection.query("UPDATE reports SET appealed_at = UTC_TIMESTAMP(), appeal_text = ? WHERE id = ?", [text, reportId]);
    await connection.query("INSERT INTO report_status_history (report_id, actor_user_id, old_status, new_status, note) VALUES (?, ?, ?, ?, ?)", [reportId, userId, report.status, report.status, `appeal:${text}`]);
  });
  response.status(201).json({ appealed: true });
}));

router.patch("/admin/reports/:id", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const reportId = Number(request.params.id);
  const status = String(request.body?.status ?? "");
  const responseText = String(request.body?.response ?? "").trim().slice(0, 10_000);
  if (!(await isAdmin(getPool(), adminId))) return response.status(403).json({ error: "Доступно только администратору" });
  if (!REPORT_STATUSES.has(status)) return response.status(400).json({ error: "Некорректный статус жалобы" });
  if (["satisfied", "rejected"].includes(status) && !responseText) return response.status(400).json({ error: "Перед закрытием укажите мотивированный ответ" });
  await withTransaction(async (connection) => {
    const [[report]] = await connection.query("SELECT status FROM reports WHERE id = ? FOR UPDATE", [reportId]);
    if (!report) throw Object.assign(new Error("Жалоба не найдена"), { statusCode: 404 });
    await connection.query(
      `UPDATE reports SET status = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(),
              motivated_response = ?, response_at = ${["satisfied", "rejected"].includes(status) ? "UTC_TIMESTAMP()" : "NULL"}
        WHERE id = ?`,
      [status, adminId, responseText || null, reportId],
    );
    await connection.query("INSERT INTO report_status_history (report_id, actor_user_id, old_status, new_status, note) VALUES (?, ?, ?, ?, ?)", [reportId, adminId, report.status, status, responseText || null]);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "report_status_change", objectType: "report", objectId: reportId, oldStatus: report.status, newStatus: status, reason: responseText || null, reportId });
  });
  response.json({ ok: true });
}));

router.post("/social/blocks", asyncRoute(async (request, response) => {
  const blockerId = request.bookMeetUser.id;
  const blockedId = Number(request.body?.targetId);
  await withTransaction((connection) => applyPersonalBlock(connection, blockerId, blockedId));
  response.status(201).json({ ok: true });
}));

router.delete("/social/blocks/:targetId", asyncRoute(async (request, response) => {
  const [deleted] = await getPool().query(
    "DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?",
    [request.bookMeetUser.id, Number(request.params.targetId)],
  );
  if (!deleted.affectedRows) return response.status(404).json({ error: "Пользователь не был заблокирован" });
  response.json({ ok: true });
}));

router.patch("/admin/reports/:id/processed", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const responseText = String(request.body?.response ?? request.body?.reason ?? "").trim().slice(0, 10000);
    if (!responseText) throw Object.assign(new Error("Перед закрытием укажите мотивированный ответ"), { statusCode: 400 });
    const [[current]] = await connection.query("SELECT status FROM reports WHERE id = ? FOR UPDATE", [Number(request.params.id)]);
    const [updated] = await connection.query(
      "UPDATE reports SET status = 'satisfied', reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(), motivated_response = ?, response_at = UTC_TIMESTAMP() WHERE id = ?",
      [adminId, responseText, Number(request.params.id)],
    );
    if (!updated.affectedRows) throw Object.assign(new Error("Жалоба не найдена"), { statusCode: 404 });
    await connection.query("INSERT INTO report_status_history (report_id, actor_user_id, old_status, new_status, note) VALUES (?, ?, ?, 'satisfied', ?)", [Number(request.params.id), adminId, current?.status ?? null, responseText]);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "report_close", objectType: "report", objectId: Number(request.params.id), oldStatus: current?.status, newStatus: "satisfied", reason: responseText, reportId: Number(request.params.id) });
  });
  response.json({ ok: true });
}));

router.post("/admin/reports/:id/delete-material", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const reason = String(request.body?.reason ?? "").trim().slice(0, 5000);
  if (!reason) return response.status(400).json({ error: "Укажите причину удаления" });
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const [[report]] = await connection.query("SELECT * FROM reports WHERE id = ? FOR UPDATE", [Number(request.params.id)]);
    if (!report) throw Object.assign(new Error("Жалоба не найдена"), { statusCode: 404 });
    const tables = { book: "books", review: "reviews", excerpt: "excerpts", event: "events", occasion: "occasions", publisher_news: "publisher_news", book_note: "book_progress_notes", shelf: "book_shelves" };
    const table = tables[report.target_kind];
    if (!table) throw Object.assign(new Error("Жалоба не относится к материалу"), { statusCode: 400 });
    await connection.query("DELETE FROM material_likes WHERE material_kind = ? AND material_id = ?", [report.target_kind, report.target_id]);
    await connection.query("DELETE FROM material_saves WHERE material_kind = ? AND material_id = ?", [report.target_kind, report.target_id]);
    await connection.query("DELETE FROM material_comments WHERE material_kind = ? AND material_id = ?", [report.target_kind, report.target_id]);
    await cancelNotificationDeliveries(connection, { materialKind: report.target_kind, materialId: report.target_id });
    await connection.query("DELETE FROM notifications WHERE material_kind = ? AND material_id = ?", [report.target_kind, report.target_id]);
    await connection.query(`DELETE FROM ${table} WHERE id = ?`, [report.target_id]);
    if (report.target_user_id) {
      await connection.query(
        "INSERT INTO messages (sender_user_id, recipient_user_id, body) VALUES (?, ?, ?)",
        [adminId, report.target_user_id, `Служба поддержки удалила ваш материал. Причина: ${reason}`],
      );
    }
    await connection.query("UPDATE reports SET status = 'satisfied', reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(), motivated_response = ?, response_at = UTC_TIMESTAMP() WHERE id = ?", [adminId, reason, report.id]);
    await connection.query("INSERT INTO report_status_history (report_id, actor_user_id, old_status, new_status, note) VALUES (?, ?, ?, 'satisfied', ?)", [report.id, adminId, report.status, reason]);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "delete_reported_material", objectType: report.target_kind, objectId: report.target_id, oldStatus: report.status, newStatus: "satisfied", reason, reportId: report.id });
  });
  response.json({ ok: true });
}));

router.post("/admin/users/:id/suspension", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const targetId = Number(request.params.id);
  const permanent = Boolean(request.body?.permanent);
  const days = Math.max(1, Math.min(3650, Number(request.body?.days) || 1));
  const reason = String(request.body?.reason ?? "").trim().slice(0, 5000);
  const reportId = Number(request.body?.reportId) || null;
  if (!reason) return response.status(400).json({ error: "Укажите причину блокировки" });
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const [[target]] = await connection.query("SELECT role FROM users WHERE id = ?", [targetId]);
    if (!target || target.role === "admin") throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
    await connection.query(
      `UPDATE users SET suspension_reason = ?, suspended_permanently = ?,
              suspended_until = ${permanent ? "NULL" : "DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)"}
        WHERE id = ?`,
      permanent ? [reason, 1, targetId] : [reason, 0, days, targetId],
    );
    if (reportId) {
      const [[report]] = await connection.query("SELECT status FROM reports WHERE id = ? FOR UPDATE", [reportId]);
      await connection.query("UPDATE reports SET status = 'satisfied', reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(), motivated_response = ?, response_at = UTC_TIMESTAMP() WHERE id = ?", [adminId, reason, reportId]);
      await connection.query("INSERT INTO report_status_history (report_id, actor_user_id, old_status, new_status, note) VALUES (?, ?, ?, 'satisfied', ?)", [reportId, adminId, report?.status ?? null, reason]);
    }
    await logModerationAction(connection, { adminUserId: adminId, actionType: "user_suspend", objectType: "user", objectId: targetId, newStatus: permanent ? "suspended_permanently" : "suspended", reason, reportId });
  });
  response.json({ ok: true });
}));

router.delete("/admin/users/:id/suspension", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    await connection.query("UPDATE users SET suspension_reason = NULL, suspended_until = NULL, suspended_permanently = 0 WHERE id = ?", [Number(request.params.id)]);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "user_unsuspend", objectType: "user", objectId: Number(request.params.id), newStatus: "active" });
  });
  response.json({ ok: true });
}));

router.post("/admin/users/:id/restore", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const targetId = Number(request.params.id);
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const [[target]] = await connection.query("SELECT role, deleted_at, purged_at FROM users WHERE id = ? FOR UPDATE", [targetId]);
    if (!target || target.role === "admin" || !target.deleted_at || target.purged_at) throw Object.assign(new Error("Удалённый профиль не найден или уже удалён окончательно"), { statusCode: 404 });
    await connection.query("UPDATE users SET deleted_at = NULL, deletion_expires_at = NULL, consent_withdrawn_at = NULL WHERE id = ?", [targetId]);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "profile_restore", objectType: "user", objectId: targetId, oldStatus: "deleted", newStatus: "active" });
  });
  response.json({ ok: true });
}));

router.delete("/admin/users/:id/permanent", asyncRoute(async (request, response) => {
  const adminId = request.bookMeetUser.id;
  const targetId = Number(request.params.id);
  await withTransaction(async (connection) => {
    if (!(await isAdmin(connection, adminId))) throw Object.assign(new Error("Доступно только администратору"), { statusCode: 403 });
    const [[target]] = await connection.query("SELECT role, deleted_at, purged_at FROM users WHERE id = ? FOR UPDATE", [targetId]);
    if (!target || target.role === "admin" || !target.deleted_at || target.purged_at) throw Object.assign(new Error("Удалённый профиль не найден или уже удалён окончательно"), { statusCode: 404 });
    await purgeDeletedProfile(connection, targetId);
    await logModerationAction(connection, { adminUserId: adminId, actionType: "profile_finalize_deletion", objectType: "user", objectId: targetId, oldStatus: "deleted", newStatus: "purged" });
  });
  response.json({ ok: true, irreversible: true });
}));

router.get("/reactions", asyncRoute(async (request, response) => {
  const kind = String(request.query.kind ?? "");
  const id = Number(request.query.id);
  const pool = getPool();
  await readableMaterialInfo(pool, request.bookMeetUser.id, kind, id);
  const [rows] = await pool.query(
    `SELECT ml.user_id FROM material_likes ml
      WHERE ml.material_kind = ? AND ml.material_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
           WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = ml.user_id)
              OR (ub.blocker_user_id = ml.user_id AND ub.blocked_user_id = ?)
        ) AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = ml.user_id)`,
    [kind, id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id],
  );
  response.json({ userIds: rows.map((row) => Number(row.user_id)) });
}));

router.post("/reactions", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const kind = String(request.body?.materialKind ?? "");
  const materialId = Number(request.body?.materialId);
  await withTransaction(async (connection) => {
    const material = await interactableMaterialInfo(connection, userId, kind, materialId);
    if (Number(material.owner_id) === userId) return;
    const [created] = await connection.query("INSERT IGNORE INTO material_likes (user_id, material_kind, material_id) VALUES (?, ?, ?)", [userId, kind, materialId]);
    if (!created.affectedRows) return;
    const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
    const [[countRow]] = await connection.query("SELECT COUNT(*) AS total FROM material_likes WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    const total = Number(countRow.total);
    const text = total > 1 ? `${actor.display_name} и ещё ${total - 1} поставили «Нравится»: ${material.title}.` : `${actor.display_name} поставил(а) «Нравится»: ${material.title}.`;
    const groupKey = `like:${kind}:${materialId}`;
    const occurrence = await nextNotificationOccurrence(connection, {
      recipientUserId: material.owner_id,
      actorUserId: userId,
      eventType: "like",
      materialKind: kind,
      materialId,
    });
    await createNotificationEvent(connection, {
      recipientUserId: material.owner_id,
      actorUserId: userId,
      eventType: "like",
      title: "Нравится",
      body: text,
      materialKind: kind,
      materialId,
      dedupeKey: `like:${kind}:${materialId}:${userId}:g${occurrence}`,
      groupKey,
    });
  });
  response.status(201).json({ ok: true });
}));

router.delete("/reactions", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const kind = String(request.body?.materialKind ?? "");
  const materialId = Number(request.body?.materialId);
  await withTransaction(async (connection) => {
    await readableMaterialInfo(connection, userId, kind, materialId);
    const [deleted] = await connection.query("DELETE FROM material_likes WHERE user_id = ? AND material_kind = ? AND material_id = ?", [userId, kind, materialId]);
    if (deleted.affectedRows) await cancelNotificationDeliveries(connection, { actorUserId: userId, eventType: "like", materialKind: kind, materialId });
  });
  response.json({ ok: true });
}));

router.get("/saves", asyncRoute(async (request, response) => {
  const kind = String(request.query.kind ?? "");
  const id = Number(request.query.id);
  const pool = getPool();
  await readableMaterialInfo(pool, request.bookMeetUser.id, kind, id);
  const [[saved]] = await pool.query("SELECT 1 FROM material_saves WHERE user_id = ? AND material_kind = ? AND material_id = ?", [request.bookMeetUser.id, kind, id]);
  response.json({ saved: Boolean(saved) });
}));

router.post("/saves", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const kind = String(request.body?.materialKind ?? "");
  const materialId = Number(request.body?.materialId);
  await withTransaction(async (connection) => {
    await readableMaterialInfo(connection, userId, kind, materialId);
    await connection.query("INSERT IGNORE INTO material_saves (user_id, material_kind, material_id) VALUES (?, ?, ?)", [userId, kind, materialId]);
  });
  response.status(201).json({ ok: true });
}));

router.delete("/saves", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const kind = String(request.body?.materialKind ?? "");
  const materialId = Number(request.body?.materialId);
  const pool = getPool();
  await readableMaterialInfo(pool, userId, kind, materialId);
  await pool.query("DELETE FROM material_saves WHERE user_id = ? AND material_kind = ? AND material_id = ?", [userId, kind, materialId]);
  response.json({ ok: true });
}));

router.get("/comments", asyncRoute(async (request, response) => {
  const kind = String(request.query.kind ?? "");
  const materialId = Number(request.query.id);
  const pool = getPool();
  await readableMaterialInfo(pool, request.bookMeetUser.id, kind, materialId);
  const rootId = Number(request.query.rootId);
  const cursor = Math.max(0, Number(request.query.cursor) || 0);
  const limit = 3;
  const [rows] = await pool.query(
    `SELECT mc.id, mc.user_id, mc.body, mc.created_at, mc.updated_at, mc.deleted_at, mc.parent_comment_id, mc.reply_to_comment_id,
            p.display_name, u.username, u.initials, u.color, u.avatar_path,
            (SELECT COUNT(*) FROM material_comment_likes mcl WHERE mcl.comment_id = mc.id
              AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = mcl.user_id) OR (b.blocker_user_id = mcl.user_id AND b.blocked_user_id = ?))
              AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = mcl.user_id)) AS like_count,
            EXISTS(SELECT 1 FROM material_comment_likes mine WHERE mine.comment_id = mc.id AND mine.user_id = ?) AS liked_by_viewer,
            (SELECT COUNT(*) FROM material_comments reply WHERE reply.parent_comment_id = mc.id AND reply.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = reply.user_id) OR (b.blocker_user_id = reply.user_id AND b.blocked_user_id = ?))
              AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = reply.user_id)) AS reply_count,
            (EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = mc.user_id) OR (b.blocker_user_id = mc.user_id AND b.blocked_user_id = ?))
              OR EXISTS(SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = mc.user_id)) AS redacted
       FROM material_comments mc JOIN users u ON u.id = mc.user_id JOIN profiles p ON p.user_id = mc.user_id
      WHERE mc.material_kind = ? AND mc.material_id = ?
        AND ${rootId ? "mc.parent_comment_id = ?" : "mc.parent_comment_id IS NULL"}
        AND mc.id > ?
        AND ((NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = mc.user_id) OR (ub.blocker_user_id = mc.user_id AND ub.blocked_user_id = ?))
          AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = mc.user_id))
          OR (mc.parent_comment_id IS NULL AND EXISTS (SELECT 1 FROM material_comments reply WHERE reply.parent_comment_id = mc.id AND reply.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = reply.user_id) OR (b.blocker_user_id = reply.user_id AND b.blocked_user_id = ?))
            AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = reply.user_id))))
      ORDER BY mc.id LIMIT ?`,
    [request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, kind, materialId, ...(rootId ? [rootId] : []), cursor, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, limit + 1],
  );
  const page = rows.slice(0, limit);
  const rootIds = !rootId ? page.map((row) => Number(row.id)) : [];
  const [replyRows] = rootIds.length ? await pool.query(
    `SELECT mc.id, mc.user_id, mc.body, mc.created_at, mc.updated_at, mc.deleted_at, mc.parent_comment_id, mc.reply_to_comment_id,
            p.display_name, u.username, u.initials, u.color, u.avatar_path,
            (SELECT COUNT(*) FROM material_comment_likes likes WHERE likes.comment_id = mc.id) AS like_count,
            EXISTS(SELECT 1 FROM material_comment_likes likes WHERE likes.comment_id = mc.id AND likes.user_id = ?) AS liked_by_viewer
       FROM material_comments mc JOIN users u ON u.id = mc.user_id JOIN profiles p ON p.user_id = mc.user_id
      WHERE mc.parent_comment_id IN (${rootIds.map(() => "?").join(",")})
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = mc.user_id) OR (b.blocker_user_id = mc.user_id AND b.blocked_user_id = ?))
        AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = mc.user_id)
        AND (SELECT COUNT(*) FROM material_comments earlier WHERE earlier.parent_comment_id = mc.parent_comment_id AND earlier.id < mc.id
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = earlier.user_id) OR (b.blocker_user_id = earlier.user_id AND b.blocked_user_id = ?))
          AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = earlier.user_id)) < 3
      ORDER BY mc.parent_comment_id, mc.id`,
    [request.bookMeetUser.id, ...rootIds, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id],
  ) : [[]];
  const mentionsByComment = await mentionDtos(pool, "comment", [...page, ...replyRows].map((row) => Number(row.id)), request.bookMeetUser.id);
  const dto = (row) => {
    const mentions = row.deleted_at || row.redacted ? [] : mentionsByComment.get(Number(row.id)) ?? [];
    return { id: Number(row.id), userId: Number(row.user_id), text: row.deleted_at || row.redacted ? "Комментарий скрыт" : neutralizeMentionedText(row.body, mentions), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), deleted: Boolean(row.deleted_at || row.redacted), parentCommentId: row.parent_comment_id ? Number(row.parent_comment_id) : undefined, replyToCommentId: row.reply_to_comment_id ? Number(row.reply_to_comment_id) : undefined, author: row.deleted_at || row.redacted ? undefined : row.display_name ? { displayName: row.display_name, username: row.username, initials: row.initials, color: row.color, avatarUrl: row.avatar_path ?? undefined } : undefined, mentions, likeCount: Number(row.like_count ?? 0), likedByViewer: Boolean(row.liked_by_viewer), replyCount: Number(row.reply_count ?? 0), nextRepliesCursor: Number(row.reply_count ?? 0) > 3 ? 3 : null };
  };
  const comments = [...page.map(dto), ...replyRows.map(dto)];
  response.json({ comments, nextCursor: rows.length > limit ? Number(page.at(-1)?.id) : null });
}));

router.get("/material-stats", asyncRoute(async (request, response) => {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT material_kind, material_id, user_id, COUNT(*) AS total
       FROM material_comments mc
      WHERE NOT EXISTS (
        SELECT 1 FROM user_blocks ub
         WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = mc.user_id)
            OR (ub.blocker_user_id = mc.user_id AND ub.blocked_user_id = ?)
      ) AND NOT EXISTS (SELECT 1 FROM user_hides h WHERE h.hider_user_id = ? AND h.hidden_user_id = mc.user_id)
      GROUP BY material_kind, material_id, user_id`,
    [request.bookMeetUser.id, request.bookMeetUser.id, request.bookMeetUser.id],
  );
  const readableMaterialCache = new Map();
  const getReadableMaterial = async (kind, id) => {
    const materialId = Number(id);
    const key = `${kind}-${materialId}`;
    if (!readableMaterialCache.has(key)) {
      readableMaterialCache.set(key, readableMaterialInfo(pool, request.bookMeetUser.id, kind, materialId).catch(() => null));
    }
    return readableMaterialCache.get(key);
  };
  const readableKeys = new Set();
  const materials = [...new Map(rows.map((row) => [`${row.material_kind}-${row.material_id}`, row])).values()];
  for (const row of materials) {
    const material = await getReadableMaterial(row.material_kind, row.material_id);
    if (material) readableKeys.add(`${row.material_kind}-${row.material_id}`);
  }
  const commenters = {};
  const commentCounts = {};
  for (const row of rows) {
    const key = `${row.material_kind}-${row.material_id}`;
    if (!readableKeys.has(key)) continue;
    commenters[key] ??= [];
    commenters[key].push(Number(row.user_id));
    commentCounts[key] = (commentCounts[key] ?? 0) + Number(row.total ?? 0);
  }
  const [saveRows] = await pool.query(
    "SELECT material_kind, material_id, created_at FROM material_saves WHERE user_id = ? ORDER BY created_at DESC, material_kind, material_id",
    [request.bookMeetUser.id],
  );
  const [saveCountRows] = await pool.query("SELECT material_kind, material_id, COUNT(*) AS total FROM material_saves GROUP BY material_kind, material_id");
  const [repostRows] = await pool.query("SELECT source_root_type, source_root_id, COUNT(*) AS total FROM reposts GROUP BY source_root_type, source_root_id");
  const savedMaterialRefs = [];
  const saveCounts = {};
  const repostCounts = {};
  for (const row of saveRows) {
    const material = await getReadableMaterial(row.material_kind, row.material_id);
    if (material) savedMaterialRefs.push({ kind: row.material_kind, id: Number(row.material_id), createdAt: new Date(row.created_at).toISOString() });
  }
  for (const row of saveCountRows) {
    const key = `${row.material_kind}-${row.material_id}`;
    const material = await getReadableMaterial(row.material_kind, row.material_id);
    if (material) saveCounts[key] = Number(row.total);
  }
  for (const row of repostRows) {
    const material = await getReadableMaterial(row.source_root_type, row.source_root_id);
    if (material) repostCounts[`${row.source_root_type}-${row.source_root_id}`] = Number(row.total);
  }
  response.json({ commenters, commentCounts, savedMaterialRefs, saveCounts, repostCounts });
}));

router.post("/comments", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  let body = codePointText(request.body?.body, 3000, "Комментарий");
  const kind = String(request.body?.materialKind ?? "");
  const materialId = Number(request.body?.materialId);
  const comment = await withTransaction(async (connection) => {
    const material = await interactableMaterialInfo(connection, userId, kind, materialId);
    let parentCommentId = Number(request.body?.parentCommentId) || null;
    let replyToCommentId = Number(request.body?.replyToCommentId) || null;
    let addressedUserId = null;
    if (parentCommentId || replyToCommentId) {
      const targetId = replyToCommentId || parentCommentId;
      const [[target]] = await connection.query("SELECT id, user_id, material_kind, material_id, parent_comment_id, deleted_at FROM material_comments WHERE id = ? FOR UPDATE", [targetId]);
      if (!target || target.deleted_at || target.material_kind !== kind || Number(target.material_id) !== materialId) throw Object.assign(new Error("Комментарий не найден"), { statusCode: 404 });
      await assertCommentTargetAvailable(connection, userId, target.user_id);
      parentCommentId = target.parent_comment_id ? Number(target.parent_comment_id) : Number(target.id);
      replyToCommentId = Number(target.id);
      addressedUserId = Number(target.user_id);
      let addressedToken = "";
      if (target.parent_comment_id) {
        const [[profile]] = await connection.query("SELECT username FROM users WHERE id = ?", [target.user_id]);
        addressedToken = `@${profile?.username ?? "user"}`;
        const hasAddressedToken = body === addressedToken || body.startsWith(`${addressedToken} `) || body.startsWith(`${addressedToken}\n`);
        if (!hasAddressedToken) body = `${addressedToken} ${body}`;
      }
    }
    const [created] = await connection.query("INSERT INTO material_comments (user_id, material_kind, material_id, parent_comment_id, reply_to_comment_id, body) VALUES (?, ?, ?, ?, ?, ?)", [userId, kind, materialId, parentCommentId, replyToCommentId, body]);
    const requestedMentions = mentionRefs(request.body?.mentionUserIds ?? request.body?.mentions);
    if (addressedUserId && addressedUserId !== userId) {
      const [[addressed]] = await connection.query("SELECT username FROM users WHERE id = ?", [addressedUserId]);
      requestedMentions.push({ userId: addressedUserId, token: `@${addressed?.username ?? "user"}` });
    }
    await syncMentions(connection, { entityType: "comment", entityId: Number(created.insertId), authorUserId: userId, mentionUserIds: requestedMentions, text: body, publicMaterial: true, materialKind: kind, materialId });
    if (Number(material.owner_id) !== userId) {
      const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
      await createNotificationEvent(connection, {
        recipientUserId: material.owner_id,
        actorUserId: userId,
        eventType: "comment",
        title: "Новый комментарий",
        body: `${actor.display_name} прокомментировал(а) материал «${material.title}»: ${body}`,
        materialKind: kind,
        materialId,
        dedupeKey: `comment:${created.insertId}:${material.owner_id}`,
      });
    }
    return { id: Number(created.insertId), userId, text: body, createdAt: new Date().toISOString(), parentCommentId: parentCommentId ?? undefined, replyToCommentId: replyToCommentId ?? undefined, likeCount: 0, likedByViewer: false, replyCount: 0 };
  });
  response.status(201).json({ comment });
}));

router.patch("/comments/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const commentId = Number(request.params.id); const body = codePointText(request.body?.body, 3000, "Комментарий");
  const comment = await withTransaction(async (connection) => {
    const [[existing]] = await connection.query("SELECT user_id, material_kind, material_id, deleted_at FROM material_comments WHERE id = ? FOR UPDATE", [commentId]);
    if (!existing || existing.deleted_at) throw Object.assign(new Error("Комментарий не найден"), { statusCode: 404 });
    if (Number(existing.user_id) !== userId && !(await isAdmin(connection, userId))) throw Object.assign(new Error("Недостаточно прав"), { statusCode: 403 });
    await interactableMaterialInfo(connection, userId, existing.material_kind, Number(existing.material_id));
    await connection.query("UPDATE material_comments SET body = ? WHERE id = ?", [body, commentId]);
    await syncMentions(connection, { entityType: "comment", entityId: commentId, authorUserId: Number(existing.user_id), mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: body, publicMaterial: true, materialKind: existing.material_kind, materialId: Number(existing.material_id) });
    return { id: commentId, text: body, updatedAt: new Date().toISOString() };
  }); response.json({ comment });
}));

router.delete("/comments/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const commentId = Number(request.params.id);
  if (!commentId) return response.status(400).json({ error: "Некорректный комментарий" });
  const result = await withTransaction(async (connection) => {
    const [[comment]] = await connection.query("SELECT user_id, parent_comment_id FROM material_comments WHERE id = ? FOR UPDATE", [commentId]);
    if (!comment) throw Object.assign(new Error("Комментарий не найден"), { statusCode: 404 });
    if (Number(comment.user_id) !== userId && !(await isAdmin(connection, userId))) {
      throw Object.assign(new Error("Удалить комментарий может только его автор или администратор"), { statusCode: 403 });
    }
    const [[reply]] = await connection.query("SELECT 1 FROM material_comments WHERE parent_comment_id = ? AND deleted_at IS NULL LIMIT 1", [commentId]);
    await connection.query("DELETE FROM content_mentions WHERE entity_type = 'comment' AND entity_id = ?", [commentId]);
    if (reply) {
      await connection.query("UPDATE material_comments SET body = '', deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [commentId]);
      return { id: commentId, deleted: true, parentCommentId: comment.parent_comment_id ? Number(comment.parent_comment_id) : undefined, text: "Комментарий скрыт" };
    }
    await connection.query("DELETE FROM material_comments WHERE id = ?", [commentId]);
    return { id: commentId, deleted: false, removed: true };
  });
  response.json({ ok: true, comment: result });
}));

router.post("/comments/:id/like", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const commentId = Number(request.params.id);
  await withTransaction(async (connection) => {
    const [[comment]] = await connection.query("SELECT user_id, material_kind, material_id, deleted_at FROM material_comments WHERE id = ?", [commentId]);
    if (!comment || comment.deleted_at) throw Object.assign(new Error("Комментарий не найден"), { statusCode: 404 });
    await assertCommentTargetAvailable(connection, userId, comment.user_id);
    await interactableMaterialInfo(connection, userId, comment.material_kind, Number(comment.material_id));
    await connection.query("INSERT IGNORE INTO material_comment_likes (comment_id, user_id) VALUES (?, ?)", [commentId, userId]);
  }); response.status(201).json({ ok: true });
}));

router.delete("/comments/:id/like", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id; const commentId = Number(request.params.id);
  await withTransaction(async (connection) => {
    const [[comment]] = await connection.query("SELECT material_kind, material_id, deleted_at FROM material_comments WHERE id = ?", [commentId]);
    if (!comment || comment.deleted_at) throw Object.assign(new Error("Комментарий не найден"), { statusCode: 404 });
    await readableMaterialInfo(connection, userId, comment.material_kind, Number(comment.material_id));
    await connection.query("DELETE FROM material_comment_likes WHERE comment_id = ? AND user_id = ?", [commentId, userId]);
  });
  response.json({ ok: true });
}));

router.post("/social/friend-requests", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.body?.targetId);
  const message = String(request.body?.message ?? "").trim().slice(0, 2000);
  if (!targetId || targetId === userId) return response.status(400).json({ error: "Некорректный пользователь" });
  await withTransaction(async (connection) => {
    await assertUsersCanInteract(connection, userId, targetId);
    const [profiles] = await connection.query(
      "SELECT u.id, u.role, p.profile_type, p.display_name, p.community_is_closed FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id IN (?, ?) ORDER BY u.id FOR UPDATE",
      [userId, targetId],
    );
    const source = profiles.find((item) => Number(item.id) === userId);
    const target = profiles.find((item) => Number(item.id) === targetId);
    if (!target) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
    if (target.role === "admin") throw Object.assign(new Error("Службу поддержки нельзя добавить в друзья"), { statusCode: 403 });
    if (!canCreateFriendRequest(source?.profile_type, target.profile_type, { communityMembership: target.profile_type === "Сообщество" })) throw Object.assign(new Error("Издательствам недоступны запросы дружбы"), { statusCode: 403 });
    if (source?.profile_type === "Сообщество") throw Object.assign(new Error("Сообщество не может отправлять запросы дружбы"), { statusCode: 403 });
    const membership = target.profile_type === "Сообщество";
    if (!membership) await assertAgeCompatible(connection, userId, targetId);
    const low = Math.min(userId, targetId); const high = Math.max(userId, targetId);
    const [[relationship]] = target.profile_type === "Сообщество"
      ? await connection.query("SELECT 1 FROM community_memberships WHERE community_user_id = ? AND member_user_id = ?", [targetId, userId])
      : await connection.query("SELECT 1 FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
    if (relationship) throw Object.assign(new Error(membership ? "Вы уже состоите в сообществе" : "Вы уже друзья"), { statusCode: 409 });
    if (membership && !target.community_is_closed) {
      await connection.query("DELETE FROM friend_requests WHERE status = 'pending' AND from_user_id = ? AND to_user_id = ?", [userId, targetId]);
      await cancelNotificationDeliveries(connection, { userId: targetId, actorUserId: userId, eventType: "friend_request" });
      await connection.query("DELETE FROM notifications WHERE user_id = ? AND actor_user_id = ? AND notification_type = 'friend_request'", [targetId, userId]);
      const [created] = await connection.query("INSERT IGNORE INTO community_memberships (community_user_id, member_user_id) VALUES (?, ?)", [targetId, userId]);
      if (created.affectedRows) {
        const systemText = "Вы стали участником открытого сообщества и можете начать переписку";
        await connection.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, is_system) VALUES (?, ?, ?, 1)", [userId, targetId, systemText]);
        const communityOccurrence = await nextNotificationOccurrence(connection, { recipientUserId: targetId, actorUserId: userId, eventType: "friendship_started" });
        const memberOccurrence = await nextNotificationOccurrence(connection, { recipientUserId: userId, actorUserId: targetId, eventType: "friendship_started" });
        await createNotificationEvent(connection, { recipientUserId: targetId, actorUserId: userId, eventType: "friendship_started", title: "Новый участник", body: `${source.display_name} присоединился(ась) к открытому сообществу.`, dedupeKey: `community-joined:${targetId}:${userId}:community:g${communityOccurrence}` });
        await createNotificationEvent(connection, { recipientUserId: userId, actorUserId: targetId, eventType: "friendship_started", title: "Вы вступили в сообщество", body: `Вы вступили в сообщество ${target.display_name}`, dedupeKey: `community-joined:${targetId}:${userId}:member:g${memberOccurrence}` });
      }
      return;
    }
    const [[pending]] = await connection.query("SELECT id FROM friend_requests WHERE status = 'pending' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) LIMIT 1", [userId, targetId, targetId, userId]);
    if (pending) throw Object.assign(new Error(membership ? "Заявка на вступление уже отправлена" : "Предложение уже отправлено"), { statusCode: 409 });
    const [createdRequest] = await connection.query("INSERT INTO friend_requests (from_user_id, to_user_id, message) VALUES (?, ?, ?)", [userId, targetId, message || null]);
    await createNotificationEvent(connection, {
      recipientUserId: targetId,
      actorUserId: userId,
      eventType: "friend_request",
      title: membership ? "Новая заявка" : "Новый друг",
      body: membership ? `${source.display_name} хочет присоединиться к сообществу.` : `${source.display_name} хочет добавить вас в друзья.`,
      dedupeKey: `friend-request:${createdRequest.insertId}:${targetId}`,
    });
  });
  response.status(201).json({ ok: true });
}));

router.delete("/social/friend-requests/:targetId", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  await withTransaction(async (connection) => {
    const [deleted] = await connection.query(
      "DELETE FROM friend_requests WHERE status = 'pending' AND from_user_id = ? AND to_user_id = ?",
      [userId, targetId],
    );
    if (!deleted.affectedRows) throw Object.assign(new Error("Предложение дружбы не найдено"), { statusCode: 404 });
    await connection.query(
      "DELETE FROM notifications WHERE user_id = ? AND actor_user_id = ? AND notification_type = 'friend_request'",
      [targetId, userId],
    );
    await cancelNotificationDeliveries(connection, { userId: targetId, actorUserId: userId, eventType: "friend_request" });
  });
  response.json({ ok: true });
}));

router.post("/social/friends/:targetId/accept", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  await withTransaction(async (connection) => {
    const [profiles] = await connection.query("SELECT user_id, profile_type, display_name FROM profiles WHERE user_id IN (?, ?) ORDER BY user_id FOR UPDATE", [userId, targetId]);
    const currentProfile = profiles.find((item) => Number(item.user_id) === userId);
    const sourceProfile = profiles.find((item) => Number(item.user_id) === targetId);
    const membership = currentProfile?.profile_type === "Сообщество";
    await assertUsersCanInteract(connection, userId, targetId);
    if (!membership) await assertAgeCompatible(connection, userId, targetId);
    if (!canCreateFriendRequest(currentProfile?.profile_type, sourceProfile?.profile_type, { communityMembership: membership })) throw Object.assign(new Error("Издательствам недоступны запросы дружбы"), { statusCode: 403 });
    if (sourceProfile?.profile_type === "Сообщество") throw Object.assign(new Error("Сообщество не может отправлять запросы дружбы"), { statusCode: 403 });
    const [[friendRequest]] = await connection.query("SELECT id FROM friend_requests WHERE status = 'pending' AND from_user_id = ? AND to_user_id = ? FOR UPDATE", [targetId, userId]);
    if (!friendRequest) throw Object.assign(new Error("Предложение дружбы не найдено"), { statusCode: 404 });
    await connection.query("UPDATE friend_requests SET status = 'accepted' WHERE id = ? AND status = 'pending'", [friendRequest.id]);
    const low = Math.min(userId, targetId); const high = Math.max(userId, targetId);
    if (membership) {
      await connection.query("INSERT IGNORE INTO community_memberships (community_user_id, member_user_id) VALUES (?, ?)", [userId, targetId]);
    } else {
      await connection.query("INSERT IGNORE INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [low, high]);
      await connection.query("INSERT IGNORE INTO follows (follower_user_id, target_user_id) VALUES (?, ?), (?, ?)", [userId, targetId, targetId, userId]);
    }
    const systemText = membership ? "Заявка принята. Теперь вы участник сообщества и можете начать переписку" : "Теперь вы друзья и можете начать переписку";
    await connection.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, is_system) VALUES (?, ?, ?, 1)", [targetId, userId, systemText]);
    const title = membership ? "Заявка принята" : "Теперь вы друзья";
    const currentText = membership ? `${sourceProfile.display_name} вступил(а) в сообщество.` : `Теперь вы друзья с ${sourceProfile.display_name}`;
    const sourceText = membership ? `Вы вступили в сообщество ${currentProfile.display_name}` : `Теперь вы друзья с ${currentProfile.display_name}`;
    await createNotificationEvent(connection, { recipientUserId: userId, actorUserId: targetId, eventType: "friendship_started", title, body: currentText, dedupeKey: `friendship-started:request-${friendRequest.id}:${userId}` });
    await createNotificationEvent(connection, { recipientUserId: targetId, actorUserId: userId, eventType: "friendship_started", title, body: sourceText, dedupeKey: `friendship-started:request-${friendRequest.id}:${targetId}` });
  });
  response.json({ ok: true });
}));

router.post("/social/friends/:targetId/reject", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  const comment = String(request.body?.comment ?? "").trim().slice(0, 2000);
  await withTransaction(async (connection) => {
    const [profiles] = await connection.query("SELECT user_id, profile_type FROM profiles WHERE user_id IN (?, ?) ORDER BY user_id FOR UPDATE", [userId, targetId]);
    const currentProfile = profiles.find((item) => Number(item.user_id) === userId);
    const membership = currentProfile?.profile_type === "Сообщество";
    const [[friendRequest]] = await connection.query("SELECT id FROM friend_requests WHERE status = 'pending' AND from_user_id = ? AND to_user_id = ? FOR UPDATE", [targetId, userId]);
    if (!friendRequest) throw Object.assign(new Error("Предложение дружбы не найдено"), { statusCode: 404 });
    await connection.query("UPDATE friend_requests SET status = 'rejected', rejection_comment = ? WHERE id = ? AND status = 'pending'", [comment || null, friendRequest.id]);
    const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
    const text = membership ? `${actor.display_name} отклонило заявку на вступление.${comment ? ` Комментарий: ${comment}` : ""}` : `${actor.display_name} отклонил(а) предложение дружбы.${comment ? ` Комментарий: ${comment}` : ""} Вы можете подписаться на пользователя и следить за обновлениями.`;
    await createNotificationEvent(connection, { recipientUserId: targetId, actorUserId: userId, eventType: "friend_rejected", title: membership ? "Заявка отклонена" : "Предложение дружбы отклонено", body: text, dedupeKey: `friend-rejected:request-${friendRequest.id}:${targetId}` });
  });
  response.json({ ok: true });
}));

router.delete("/social/friends/:targetId", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  await withTransaction(async (connection) => {
    const [[actor]] = await connection.query("SELECT display_name, profile_type FROM profiles WHERE user_id = ?", [userId]);
    const [[target]] = await connection.query("SELECT profile_type FROM profiles WHERE user_id = ?", [targetId]);
    const membership = actor?.profile_type === "Сообщество" || target?.profile_type === "Сообщество";
    let deleted;
    if (membership) {
      const communityId = actor?.profile_type === "Сообщество" ? userId : targetId;
      const memberId = communityId === userId ? targetId : userId;
      [deleted] = await connection.query("DELETE FROM community_memberships WHERE community_user_id = ? AND member_user_id = ?", [communityId, memberId]);
    } else {
      const low = Math.min(userId, targetId); const high = Math.max(userId, targetId);
      [deleted] = await connection.query("DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
    }
    if (!deleted.affectedRows) return;
    const occurrence = await nextNotificationOccurrence(connection, { recipientUserId: targetId, actorUserId: userId, eventType: "friendship_ended" });
    await createNotificationEvent(connection, { recipientUserId: targetId, actorUserId: userId, eventType: "friendship_ended", title: membership ? "Участие завершено" : "Дружба завершена", body: membership ? `${actor.display_name} завершило участие в сообществе.` : `${actor.display_name} перестал(а) дружить с вами.`, dedupeKey: `friendship-ended:${Math.min(userId, targetId)}:${Math.max(userId, targetId)}:${targetId}:g${occurrence}` });
  });
  response.json({ ok: true });
}));

router.post("/social/follows", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.body?.targetId);
  if (!targetId || targetId === userId) return response.status(400).json({ error: "Некорректный пользователь" });
  await withTransaction(async (connection) => {
    await assertUsersCanInteract(connection, userId, targetId);
    const [[target]] = await connection.query("SELECT role FROM users WHERE id = ?", [targetId]);
    if (!target) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
    if (target.role === "admin") throw Object.assign(new Error("На службу поддержки нельзя подписаться"), { statusCode: 403 });
    const [created] = await connection.query("INSERT IGNORE INTO follows (follower_user_id, target_user_id) VALUES (?, ?)", [userId, targetId]);
    if (created.affectedRows) {
      const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
      const occurrence = await nextNotificationOccurrence(connection, { recipientUserId: targetId, actorUserId: userId, eventType: "new_follower" });
      await createNotificationEvent(connection, { recipientUserId: targetId, actorUserId: userId, eventType: "new_follower", title: "Новый подписчик", body: `${actor.display_name} подписался(ась) на ваши обновления.`, dedupeKey: `new-follower:${targetId}:${userId}:g${occurrence}` });
    }
  });
  response.status(201).json({ ok: true });
}));

router.delete("/social/follows/:targetId", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  await withTransaction(async (connection) => {
    const [deleted] = await connection.query(
      "DELETE FROM follows WHERE follower_user_id = ? AND target_user_id = ?",
      [userId, targetId],
    );
    if (!deleted.affectedRows) throw Object.assign(new Error("Подписка не найдена"), { statusCode: 404 });
    await connection.query(
      "DELETE FROM notifications WHERE user_id = ? AND actor_user_id = ? AND notification_type = 'new_follower'",
      [targetId, userId],
    );
    await cancelNotificationDeliveries(connection, { userId: targetId, actorUserId: userId, eventType: "new_follower" });
  });
  response.json({ ok: true });
}));

function requireGroupChats() {
  if (!groupChatsEnabled()) throw Object.assign(new Error("Не найдено"), { statusCode: 404 });
}

function groupName(value) {
  const name = String(value ?? "").trim();
  if (!name || [...name].length > 160) throw Object.assign(new Error("Укажите название группы до 160 символов"), { statusCode: 422 });
  return name;
}

function groupParticipantIds(value, ownerId) {
  if (!Array.isArray(value)) throw Object.assign(new Error("Укажите участников группы"), { statusCode: 422 });
  const ids = [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0 && id !== Number(ownerId)))];
  if (ids.length > 100) throw Object.assign(new Error("Слишком много участников"), { statusCode: 422 });
  return ids;
}

async function groupActor(connection, selectedUserId, operatorUserId) {
  const [[selected]] = await connection.query(
    `SELECT u.id, u.deleted_at, u.purged_at, p.profile_type, p.publisher_status
       FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ? FOR UPDATE`, [selectedUserId],
  );
  if (!selected || selected.deleted_at || selected.purged_at) throw Object.assign(new Error("Профиль недоступен"), { statusCode: 404 });
  if (["Читатель", "Писатель", "Блогер"].includes(selected.profile_type)) return { type: "user", id: Number(selected.id), createdBy: Number(selectedUserId) };
  if (selected.profile_type === "Сообщество") {
    const [[operator]] = await connection.query(
      `SELECT p.profile_type FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE u.id = ? AND u.deleted_at IS NULL AND u.purged_at IS NULL`, [operatorUserId],
    );
    const [[linked]] = await connection.query(
      "SELECT 1 FROM linked_profiles WHERE personal_user_id = ? AND community_user_id = ? FOR UPDATE",
      [operatorUserId, selectedUserId],
    );
    if (!linked || !["Читатель", "Писатель", "Блогер"].includes(operator?.profile_type) || Number(operatorUserId) === Number(selectedUserId)) throw Object.assign(new Error("Для сообщества требуется сессия, переключённая уполномоченным личным профилем"), { statusCode: 403 });
    return { type: "community", id: Number(selected.id), createdBy: Number(operatorUserId) };
  }
  if (selected.profile_type === "Издатель" && selected.publisher_status === "approved" && Number(operatorUserId) === Number(selectedUserId)) return { type: "publisher", id: Number(selected.id), createdBy: Number(selectedUserId) };
  throw Object.assign(new Error("Создание группы для этого профиля недоступно"), { statusCode: 403 });
}

async function assertGroupMember(connection, userId, conversationId, { lock = false, owner = false, moderator = false } = {}) {
  const [[row]] = await connection.query(
    `SELECT c.id, c.name, c.avatar_path, c.state, c.add_members_policy, c.remove_members_policy, c.history_cleared_message_id,
            cm.role, cm.left_at, cm.last_read_message_id
       FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE c.id = ? AND c.conversation_type = 'group' AND cm.user_id = ?${lock ? " FOR UPDATE" : ""}`,
    [conversationId, userId],
  );
  if (!row || row.state !== "active" || row.left_at) throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
  const [[blocked]] = await connection.query(
    `SELECT 1
       FROM user_blocks block JOIN conversation_members other ON other.user_id IN (block.blocker_user_id, block.blocked_user_id)
      WHERE other.conversation_id = ? AND other.left_at IS NULL AND other.user_id <> ?
        AND ((block.blocker_user_id = ? AND block.blocked_user_id = other.user_id)
          OR (block.blocked_user_id = ? AND block.blocker_user_id = other.user_id))
      LIMIT 1`,
    [conversationId, userId, userId, userId],
  );
  if (blocked) throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
  const members = await groupAccessProfiles(connection, conversationId);
  const viewer = members.find((member) => Number(member.user_id) === Number(userId));
  if (!viewer || members.some((member) => !groupAgePairAllowed(viewer, member))) throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
  if (owner && row.role !== "owner") throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
  if (moderator && !["owner", "moderator"].includes(row.role)) throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
  return row;
}

function groupAgePairAllowed(first, second) {
  if (first.role === "admin" || second.role === "admin" || first.profile_type === "Сообщество" || second.profile_type === "Сообщество") return true;
  const firstAge = first.profile_type === "Издатель" ? 18 : ageFromBirthDate(first.birth_date);
  const secondAge = second.profile_type === "Издатель" ? 18 : ageFromBirthDate(second.birth_date);
  return firstAge !== null && secondAge !== null && (firstAge < 18) === (secondAge < 18);
}

async function groupAccessProfiles(connection, conversationId) {
  const [rows] = await connection.query(
    `SELECT member.user_id, u.role, p.profile_type, p.birth_date
       FROM conversation_members member JOIN users u ON u.id = member.user_id JOIN profiles p ON p.user_id = u.id
      WHERE member.conversation_id = ? AND member.left_at IS NULL`, [conversationId],
  );
  return rows;
}

async function assertGroupCandidate(connection, actorId, candidateId, { lock = true } = {}) {
  try {
    await assertMessagePairAccess(connection, actorId, candidateId, { lock });
    await assertAgeCompatible(connection, actorId, candidateId, { lock });
  } catch (error) {
    throw Object.assign(new Error("Участник недоступен"), { statusCode: 404 });
  }
}

async function assertGroupCompatibility(connection, firstUserId, secondUserId) {
  try {
    await assertUsersCanInteract(connection, firstUserId, secondUserId);
    await assertAgeCompatible(connection, firstUserId, secondUserId);
  } catch {
    throw Object.assign(new Error("Участник недоступен"), { statusCode: 404 });
  }
}

async function groupMemberIds(connection, conversationId) {
  const [rows] = await connection.query("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL", [conversationId]);
  return rows.map((row) => Number(row.user_id));
}

async function groupSignalMemberIds(connection, conversationId) {
  const [rows] = await connection.query(
    `SELECT member.user_id FROM conversation_members member
      WHERE member.conversation_id = ? AND member.left_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM conversation_members peer JOIN user_blocks b
            ON (b.blocker_user_id = member.user_id AND b.blocked_user_id = peer.user_id)
            OR (b.blocked_user_id = member.user_id AND b.blocker_user_id = peer.user_id)
           WHERE peer.conversation_id = member.conversation_id AND peer.left_at IS NULL AND peer.user_id <> member.user_id
        )`, [conversationId],
  );
  const members = await groupAccessProfiles(connection, conversationId);
  return rows.map((row) => Number(row.user_id)).filter((id) => {
    const viewer = members.find((member) => Number(member.user_id) === id);
    return viewer && members.every((member) => groupAgePairAllowed(viewer, member));
  });
}

async function assertGroupJoinCandidate(connection, inviterId, candidateId, conversationId) {
  await assertGroupCandidate(connection, inviterId, candidateId);
  const members = await groupMemberIds(connection, conversationId);
  for (const memberId of members) {
    if (memberId === candidateId) continue;
    try {
      await assertUsersCanInteract(connection, memberId, candidateId);
      await assertAgeCompatible(connection, memberId, candidateId);
    } catch {
      throw Object.assign(new Error("Участник недоступен"), { statusCode: 404 });
    }
  }
}

async function groupSystemRow(connection, conversationId, body) {
  const [created] = await connection.query("INSERT INTO messages (conversation_id, sender_user_id, recipient_user_id, body, is_system) VALUES (?, NULL, NULL, ?, 1)", [conversationId, body]);
  return Number(created.insertId);
}

async function validatedGroupChatAttachment(connection, input, senderUserId, conversationId) {
  if (!input) return null;
  const members = await groupMemberIds(connection, conversationId);
  for (const memberId of members) {
    if (memberId !== Number(senderUserId)) await validatedChatAttachment(connection, input, senderUserId, memberId);
  }
  return { kind: String(input.kind ?? ""), id: Number(input.id) };
}

async function syncGroupMentions(connection, { conversationId, messageId, authorUserId, mentionUserIds, text }) {
  const refs = mentionRefs(mentionUserIds).filter((entry) => entry.userId !== Number(authorUserId) && String(text).includes(entry.token));
  if (refs.length) {
    const ids = [...new Set(refs.map((entry) => entry.userId))];
    const [active] = await connection.query(
      `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL AND user_id IN (${ids.map(() => "?").join(",")})`,
      [conversationId, ...ids],
    );
    if (active.length !== ids.length) throw Object.assign(new Error("Упомянутый пользователь не состоит в группе"), { statusCode: 422 });
  }
  await syncMentions(connection, { entityType: "message", entityId: messageId, authorUserId, mentionUserIds, text });
}

function groupDeletedText(row) {
  if (!row.deleted_at) return row.body;
  if (row.group_deleted_by_role === "owner") return "Сообщение удалено администратором";
  if (row.group_deleted_by_role === "moderator") return "Сообщение удалено модератором";
  return DELETED_MESSAGE_TOMBSTONE;
}

function pollText(value, maximum, field) {
  const text = String(value ?? "").trim();
  if (!text || Array.from(text).length > maximum) throw Object.assign(new Error(`Некорректный ${field}`), { statusCode: 422 });
  return text;
}

function pollBoolean(value, field) {
  if (typeof value !== "boolean") throw Object.assign(new Error(`Поле ${field} должно быть boolean`), { statusCode: 422 });
  return value;
}

function pollClosesAt(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw Object.assign(new Error("Некорректное время закрытия опроса"), { statusCode: 422 });
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) throw Object.assign(new Error("Время закрытия опроса должно быть в будущем"), { statusCode: 422 });
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function pollOptions(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10) throw Object.assign(new Error("Опрос должен содержать от 2 до 10 вариантов"), { statusCode: 422 });
  const options = value.map((entry) => pollText(entry, 300, "вариант опроса"));
  if (new Set(options.map((entry) => entry.normalize("NFKC").toLocaleLowerCase("ru-RU"))).size !== options.length) throw Object.assign(new Error("Варианты опроса должны быть уникальны"), { statusCode: 422 });
  return options;
}

async function pollDtosForMessages(connection, messageIds, viewerId) {
  const ids = [...new Set(messageIds.map(Number).filter(Number.isInteger))];
  const result = new Map();
  if (!ids.length) return result;
  const [rows] = await connection.query(
    `SELECT poll.id AS poll_id, poll.message_id, poll.question, poll.allows_multiple, poll.may_change_vote, poll.closes_at, poll.closed_at,
            (poll.closed_at IS NOT NULL OR (poll.closes_at IS NOT NULL AND poll.closes_at <= UTC_TIMESTAMP())) AS is_closed,
            option_row.id AS option_id, option_row.option_order, option_row.body AS option_body, COUNT(vote.user_id) AS vote_count,
            MAX(vote.user_id = ?) AS viewer_selected
       FROM conversation_polls poll JOIN conversation_poll_options option_row ON option_row.poll_id = poll.id
       LEFT JOIN conversation_poll_votes vote ON vote.poll_id = option_row.poll_id AND vote.option_id = option_row.id
      WHERE poll.message_id IN (${ids.map(() => "?").join(",")})
      GROUP BY poll.id, poll.message_id, poll.question, poll.allows_multiple, poll.may_change_vote, poll.closes_at, poll.closed_at, option_row.id, option_row.option_order, option_row.body
      ORDER BY poll.message_id, option_row.option_order, option_row.id`,
    [viewerId, ...ids],
  );
  for (const row of rows) {
    const messageId = Number(row.message_id); let poll = result.get(messageId);
    if (!poll) {
      poll = { id: Number(row.poll_id), question: row.question, allowsMultiple: Boolean(row.allows_multiple), mayChangeVote: Boolean(row.may_change_vote), closesAt: row.closes_at ? new Date(row.closes_at).toISOString() : undefined, closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : undefined, closed: Boolean(row.is_closed), options: [] };
      result.set(messageId, poll);
    }
    poll.options.push({ id: Number(row.option_id), text: row.option_body, order: Number(row.option_order), voteCount: Number(row.vote_count), viewerSelected: Boolean(row.viewer_selected) });
  }
  return result;
}

async function pollDto(connection, pollId, viewerId) {
  const [[poll]] = await connection.query("SELECT message_id FROM conversation_polls WHERE id = ?", [pollId]);
  if (!poll) throw Object.assign(new Error("Опрос не найден"), { statusCode: 404 });
  return (await pollDtosForMessages(connection, [Number(poll.message_id)], viewerId)).get(Number(poll.message_id));
}

async function groupMessageDtos(connection, rows, viewerId, readThrough, locale) {
  const ids = rows.map((row) => Number(row.id));
  const mentionsByMessage = await mentionDtos(connection, "message", ids, viewerId);
  const pollsByMessage = await pollDtosForMessages(connection, ids, viewerId);
  const reactionsByMessage = new Map(ids.map((id) => [id, []]));
  if (ids.length) {
    const [reactions] = await connection.query(
      `SELECT reaction.message_id, reaction.user_id
         FROM message_reactions reaction JOIN conversation_members member ON member.user_id = reaction.user_id
        WHERE reaction.message_id IN (${ids.map(() => "?").join(",")}) AND reaction.reaction_type = 'like'
          AND member.conversation_id = ? AND member.left_at IS NULL
        ORDER BY reaction.created_at, reaction.user_id`,
      [...ids, rows[0]?.conversation_id],
    );
    for (const reaction of reactions) reactionsByMessage.get(Number(reaction.message_id))?.push(Number(reaction.user_id));
  }
  return rows.map((row) => {
    const id = Number(row.id); const deleted = Boolean(row.deleted_at); const mentions = deleted ? [] : mentionsByMessage.get(id) ?? [];
    const likedByUserIds = deleted ? [] : reactionsByMessage.get(id) ?? [];
    const senderId = row.sender_user_id ? Number(row.sender_user_id) : undefined;
    const author = senderId && !row.author_deleted_at && !row.author_purged_at
      ? { id: senderId, name: row.author_name, username: row.author_username, avatarUrl: row.author_avatar_path ?? undefined }
      : senderId ? { name: "Удалённый пользователь" } : undefined;
    return {
      id, senderId, author, mine: senderId === Number(viewerId), text: groupDeletedText(row), system: Boolean(row.is_system), deleted,
      ...(row.edited_at && !deleted ? { editedAt: new Date(row.edited_at).toISOString(), edited: true } : {}),
      ...(row.attachment_kind && row.attachment_id && !deleted ? { attachment: { kind: row.attachment_kind, id: Number(row.attachment_id) } } : {}),
      ...(row.message_kind === "sticker" && !deleted ? { kind: "sticker", sticker: stickerDto(archivedBookSticker(row.sticker_id), locale) } : {}),
      ...(pollsByMessage.has(id) && !deleted ? { poll: pollsByMessage.get(id) } : {}),
      mentions, read: id <= readThrough || senderId === Number(viewerId), createdAt: new Date(row.created_at).toISOString(),
      likeCount: likedByUserIds.length, likedByViewer: likedByUserIds.includes(Number(viewerId)), likedByUserIds,
    };
  });
}

async function groupMessageForMutation(connection, userId, conversationId, messageId, { lock = true } = {}) {
  const group = await assertGroupMember(connection, userId, conversationId, { lock });
  if (!Number.isInteger(messageId) || messageId <= 0) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404 });
  const [[message]] = await connection.query(
    `SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND id > COALESCE(?, 0)${lock ? " FOR UPDATE" : ""}`,
    [messageId, conversationId, group.history_cleared_message_id],
  );
  if (!message) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404 });
  return { group, message };
}

router.get("/group-conversations", asyncRoute(async (request, response) => {
  requireGroupChats();
  const userId = Number(request.bookMeetUser.id);
  const [rows] = await getPool().query(
    `SELECT c.id, c.name, c.avatar_path, c.state, c.updated_at, cm.role,
            (SELECT COUNT(*) FROM conversation_members active_member WHERE active_member.conversation_id = c.id AND active_member.left_at IS NULL) AS member_count,
            (SELECT m.id FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE(c.history_cleared_message_id, 0) AND m.deleted_before_read = 0 ORDER BY m.id DESC LIMIT 1) AS last_message_id,
            (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE(c.history_cleared_message_id, 0) AND m.deleted_before_read = 0 ORDER BY m.id DESC LIMIT 1) AS last_message_body,
            (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE(c.history_cleared_message_id, 0) AND m.deleted_before_read = 0 ORDER BY m.id DESC LIMIT 1) AS last_message_at,
            (SELECT m.is_system FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE(c.history_cleared_message_id, 0) AND m.deleted_before_read = 0 ORDER BY m.id DESC LIMIT 1) AS last_message_system,
            (SELECT m.deleted_at FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE(c.history_cleared_message_id, 0) AND m.deleted_before_read = 0 ORDER BY m.id DESC LIMIT 1) AS last_message_deleted_at,
            (SELECT m.group_deleted_by_role FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE(c.history_cleared_message_id, 0) AND m.deleted_before_read = 0 ORDER BY m.id DESC LIMIT 1) AS last_message_deleted_by_role,
            (SELECT m.message_kind FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE(c.history_cleared_message_id, 0) AND m.deleted_before_read = 0 ORDER BY m.id DESC LIMIT 1) AS last_message_kind,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
              AND m.id > GREATEST(COALESCE(cm.last_read_message_id, 0), COALESCE(c.history_cleared_message_id, 0))
              AND m.sender_user_id <> ? AND m.is_system = 0 AND m.deleted_at IS NULL AND m.deleted_before_read = 0) AS unread_count
      FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE c.conversation_type = 'group' AND c.state = 'active' AND cm.user_id = ? AND cm.left_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM conversation_members peer JOIN user_blocks b
            ON (b.blocker_user_id = ? AND b.blocked_user_id = peer.user_id)
            OR (b.blocked_user_id = ? AND b.blocker_user_id = peer.user_id)
           WHERE peer.conversation_id = c.id AND peer.left_at IS NULL AND peer.user_id <> ?
        )
      ORDER BY c.updated_at DESC, c.id DESC`, [userId, userId, userId, userId, userId],
  );
  const membersByGroup = new Map();
  if (rows.length) {
    const [accessRows] = await getPool().query(
      `SELECT member.conversation_id, member.user_id, u.role, p.profile_type, p.birth_date
         FROM conversation_members member JOIN users u ON u.id = member.user_id JOIN profiles p ON p.user_id = u.id
        WHERE member.left_at IS NULL AND member.conversation_id IN (${rows.map(() => "?").join(",")})`, rows.map((row) => row.id),
    );
    for (const member of accessRows) {
      const members = membersByGroup.get(Number(member.conversation_id)) ?? [];
      members.push(member); membersByGroup.set(Number(member.conversation_id), members);
    }
  }
  response.json({ conversations: rows.filter((row) => {
    const members = membersByGroup.get(Number(row.id)) ?? [];
    const viewer = members.find((member) => Number(member.user_id) === userId);
    return viewer && members.every((member) => groupAgePairAllowed(viewer, member));
  }).map((row) => {
    const lastMessage = !row.last_message_id ? undefined : row.last_message_deleted_at
      ? row.last_message_deleted_by_role === "owner" ? "Сообщение удалено администратором" : row.last_message_deleted_by_role === "moderator" ? "Сообщение удалено модератором" : DELETED_MESSAGE_TOMBSTONE
      : row.last_message_kind === "sticker" ? "Стикер" : row.last_message_system ? row.last_message_body : row.last_message_body;
    return { id: Number(row.id), name: row.name, avatarUrl: row.avatar_path ?? undefined, role: row.role, memberCount: Number(row.member_count), lastMessage, lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : undefined, unreadCount: Number(row.unread_count) };
  }) });
}));

router.get("/group-conversations/candidates", asyncRoute(async (request, response) => {
  requireGroupChats();
  const userId = Number(request.bookMeetUser.id);
  const query = String(request.query.q ?? "").trim().slice(0, 40);
  if (!query) return response.json({ users: [] });
  const users = await withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT u.id, u.username, u.avatar_path, p.display_name
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE u.id <> ? AND u.deleted_at IS NULL AND u.purged_at IS NULL
          AND (u.username LIKE ? OR p.display_name LIKE ?)
        ORDER BY p.display_name, u.id LIMIT 50`,
      [userId, `%${query}%`, `%${query}%`],
    );
    const available = [];
    for (const row of rows) {
      try { await assertGroupCandidate(connection, userId, Number(row.id), { lock: false }); }
      catch { continue; }
      available.push({ id: Number(row.id), name: row.display_name, username: row.username, avatarUrl: row.avatar_path ?? undefined });
      if (available.length >= 20) break;
    }
    return available;
  });
  response.json({ users });
}));

router.post("/group-conversations", asyncRoute(async (request, response) => {
  requireGroupChats();
  const userId = Number(request.bookMeetUser.id);
  const name = groupName(request.body?.name);
  const participants = groupParticipantIds(request.body?.participantIds, userId);
  const avatarUrl = request.body?.avatarUrl;
  if (Object.hasOwn(request.body ?? {}, "avatarPath") || (avatarUrl !== undefined && avatarUrl !== null && (typeof avatarUrl !== "string" || (avatarUrl !== "" && !avatarUrl.startsWith("data:image/"))))) throw Object.assign(new Error("Некорректный аватар группы"), { statusCode: 422 });
  let savedAvatarPath = null;
  let result;
  try {
    result = await withTransaction(async (connection) => {
      const actor = await groupActor(connection, userId, Number(request.bookMeetUser.operatorUserId));
      for (const participantId of participants) await assertGroupCandidate(connection, userId, participantId);
      for (let index = 0; index < participants.length; index += 1) {
        for (const previousParticipantId of participants.slice(0, index)) await assertGroupCompatibility(connection, previousParticipantId, participants[index]);
      }
      if (avatarUrl) savedAvatarPath = await saveAvatar(avatarUrl);
      const [created] = await connection.query(
        "INSERT INTO conversations (conversation_type, name, avatar_path, created_actor_type, created_actor_id, created_by_user_id) VALUES ('group', ?, ?, ?, ?, ?)",
        [name, savedAvatarPath, actor.type, actor.id, actor.createdBy],
      );
      const conversationId = Number(created.insertId);
      await connection.query("INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'owner')", [conversationId, userId]);
      for (const participantId of participants) await connection.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)", [conversationId, participantId]);
      return { conversationId, recipients: [userId, ...participants] };
    });
  } catch (error) {
    if (savedAvatarPath) await removeAvatarFile(savedAvatarPath);
    throw error;
  }
  queueChatRealtime(response, result.recipients, { type: "group.created", conversationId: result.conversationId });
  response.status(201).json({ id: result.conversationId, name, avatarUrl: savedAvatarPath ?? undefined });
}));

router.get("/group-conversations/:conversationId", asyncRoute(async (request, response) => {
  requireGroupChats();
  const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId);
  const detail = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId);
    const [members] = await connection.query(
      `SELECT cm.user_id, cm.role, cm.joined_at, p.display_name, u.username, u.avatar_path
         FROM conversation_members cm JOIN users u ON u.id = cm.user_id JOIN profiles p ON p.user_id = u.id
        WHERE cm.conversation_id = ? AND cm.left_at IS NULL ORDER BY FIELD(cm.role, 'owner', 'moderator', 'member'), p.display_name, cm.user_id`, [conversationId],
    );
    return { id: conversationId, name: group.name, avatarUrl: group.avatar_path ?? undefined, historyClearedMessageId: Number(group.history_cleared_message_id ?? 0), addMembersPolicy: group.add_members_policy, removeMembersPolicy: group.remove_members_policy, currentRole: group.role, members: members.map((member) => ({ userId: Number(member.user_id), role: member.role, name: member.display_name, username: member.username, avatarUrl: member.avatar_path ?? undefined })) };
  });
  response.json(detail);
}));

router.patch("/group-conversations/:conversationId", asyncRoute(async (request, response) => {
  requireGroupChats();
  const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId);
  const allowedAdd = new Set(["owner_only", "owner_or_moderators", "members"]); const allowedRemove = new Set(["owner_only", "owner_or_moderators"]);
  const avatarUpdated = Object.hasOwn(request.body ?? {}, "avatarUrl");
  const avatarUrl = request.body?.avatarUrl;
  if (Object.hasOwn(request.body ?? {}, "avatarPath") || (avatarUpdated && avatarUrl !== null && (typeof avatarUrl !== "string" || (avatarUrl !== "" && !avatarUrl.startsWith("data:image/"))))) throw Object.assign(new Error("Некорректный аватар группы"), { statusCode: 422 });
  let savedAvatarPath = null; let previousAvatarPath = null; let result;
  try {
    result = await withTransaction(async (connection) => {
      const group = await assertGroupMember(connection, userId, conversationId, { lock: true, owner: true });
      const changes = []; const values = [];
      if (Object.hasOwn(request.body ?? {}, "name")) { changes.push("name = ?"); values.push(groupName(request.body.name)); }
      if (Object.hasOwn(request.body ?? {}, "addMembersPolicy")) { if (!allowedAdd.has(request.body.addMembersPolicy)) throw Object.assign(new Error("Некорректная политика добавления"), { statusCode: 422 }); changes.push("add_members_policy = ?"); values.push(request.body.addMembersPolicy); }
      if (Object.hasOwn(request.body ?? {}, "removeMembersPolicy")) { if (!allowedRemove.has(request.body.removeMembersPolicy)) throw Object.assign(new Error("Некорректная политика удаления"), { statusCode: 422 }); changes.push("remove_members_policy = ?"); values.push(request.body.removeMembersPolicy); }
      if (avatarUpdated) { previousAvatarPath = group.avatar_path; if (avatarUrl) savedAvatarPath = await saveAvatar(avatarUrl); changes.push("avatar_path = ?"); values.push(savedAvatarPath); }
      if (!changes.length) throw Object.assign(new Error("Нет изменений"), { statusCode: 422 });
      await connection.query(`UPDATE conversations SET ${changes.join(", ")} WHERE id = ?`, [...values, conversationId]);
      return { recipients: await groupSignalMemberIds(connection, conversationId) };
    });
  } catch (error) {
    if (savedAvatarPath) await removeAvatarFile(savedAvatarPath);
    throw error;
  }
  if (avatarUpdated && previousAvatarPath && previousAvatarPath !== savedAvatarPath) await removeAvatarFile(previousAvatarPath);
  queueChatRealtime(response, result.recipients, { type: "group.updated", conversationId }); response.json({ ok: true });
}));

router.post("/group-conversations/:conversationId/members", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const candidateId = Number(request.body?.userId);
  const result = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId, { lock: true });
    const canAdd = group.add_members_policy === "members" || group.add_members_policy === "owner_or_moderators" && ["owner", "moderator"].includes(group.role) || group.add_members_policy === "owner_only" && group.role === "owner";
    if (!canAdd) throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
    await assertGroupJoinCandidate(connection, userId, candidateId, conversationId);
    await connection.query("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, left_at, last_read_message_id, last_read_at) VALUES (?, ?, 'member', UTC_TIMESTAMP(), NULL, NULL, NULL) ON DUPLICATE KEY UPDATE role = 'member', joined_at = UTC_TIMESTAMP(), left_at = NULL, last_read_message_id = NULL, last_read_at = NULL", [conversationId, candidateId]);
    await groupSystemRow(connection, conversationId, "Участник добавлен в группу"); return { recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, result.recipients, { type: "group.members.changed", conversationId }); response.status(201).json({ ok: true });
}));

router.delete("/group-conversations/:conversationId/members/:userId", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const targetId = Number(request.params.userId);
  const result = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId, { lock: true });
    const canRemove = group.remove_members_policy === "owner_or_moderators" && ["owner", "moderator"].includes(group.role) || group.remove_members_policy === "owner_only" && group.role === "owner";
    if (!canRemove || targetId === userId) throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
    const [[target]] = await connection.query("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL FOR UPDATE", [conversationId, targetId]);
    if (!target || target.role === "owner" && group.role !== "owner") throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
    if (target.role === "owner") { const [[owners]] = await connection.query("SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ? AND role = 'owner' AND left_at IS NULL", [conversationId]); if (Number(owners.count) <= 1) throw Object.assign(new Error("Последнего владельца нельзя удалить без передачи роли или удаления группы"), { statusCode: 409 }); }
    await connection.query("UPDATE conversation_members SET left_at = UTC_TIMESTAMP() WHERE conversation_id = ? AND user_id = ?", [conversationId, targetId]);
    await groupSystemRow(connection, conversationId, "Участник удалён из группы"); return { recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, [...result.recipients, targetId], { type: "group.members.changed", conversationId }); response.json({ ok: true });
}));

router.patch("/group-conversations/:conversationId/members/:userId/role", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const targetId = Number(request.params.userId); const role = request.body?.role;
  if (!["owner", "moderator", "member"].includes(role)) throw Object.assign(new Error("Некорректная роль"), { statusCode: 422 });
  const result = await withTransaction(async (connection) => {
    await assertGroupMember(connection, userId, conversationId, { lock: true, owner: true });
    const [[target]] = await connection.query("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL FOR UPDATE", [conversationId, targetId]);
    if (!target) throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
    if (target.role === "owner" && role !== "owner") { const [[owners]] = await connection.query("SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ? AND role = 'owner' AND left_at IS NULL", [conversationId]); if (Number(owners.count) <= 1) throw Object.assign(new Error("Последнего владельца нельзя понизить"), { statusCode: 409 }); }
    await connection.query("UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?", [role, conversationId, targetId]);
    return { recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, result.recipients, { type: "group.members.changed", conversationId }); response.json({ ok: true });
}));

router.post("/group-conversations/:conversationId/owner-transfer", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const targetId = Number(request.body?.userId);
  const result = await withTransaction(async (connection) => {
    await assertGroupMember(connection, userId, conversationId, { lock: true, owner: true });
    if (!Number.isSafeInteger(targetId) || targetId === userId) throw Object.assign(new Error("Укажите другого активного участника"), { statusCode: 422 });
    const [[target]] = await connection.query("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL FOR UPDATE", [conversationId, targetId]);
    if (!target) throw Object.assign(new Error("Группа не найдена"), { statusCode: 404 });
    await connection.query("UPDATE conversation_members SET role = CASE WHEN user_id = ? THEN 'owner' WHEN user_id = ? THEN 'member' ELSE role END WHERE conversation_id = ? AND user_id IN (?, ?)", [targetId, userId, conversationId, targetId, userId]);
    await groupSystemRow(connection, conversationId, "Владелец группы передан");
    return { recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, result.recipients, { type: "group.members.changed", conversationId }); response.json({ ok: true });
}));

router.post("/group-conversations/:conversationId/leave", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId);
  const result = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId, { lock: true });
    if (group.role === "owner") { const [[owners]] = await connection.query("SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ? AND role = 'owner' AND left_at IS NULL", [conversationId]); if (Number(owners.count) <= 1) throw Object.assign(new Error("Последний владелец должен передать роль или удалить группу"), { statusCode: 409 }); }
    await connection.query("UPDATE conversation_members SET left_at = UTC_TIMESTAMP() WHERE conversation_id = ? AND user_id = ?", [conversationId, userId]);
    await groupSystemRow(connection, conversationId, "Участник покинул группу"); return { recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, [...result.recipients, userId], { type: "group.members.changed", conversationId }); response.json({ ok: true });
}));

router.post("/group-conversations/:conversationId/history/clear", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId);
  const result = await withTransaction(async (connection) => {
    await assertGroupMember(connection, userId, conversationId, { lock: true, moderator: true });
    const [[cursor]] = await connection.query("SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE conversation_id = ? FOR UPDATE", [conversationId]);
    await connection.query("UPDATE conversations SET history_cleared_message_id = GREATEST(COALESCE(history_cleared_message_id, 0), ?), history_cleared_at = UTC_TIMESTAMP() WHERE id = ?", [cursor.id, conversationId]);
    return { clearedThroughMessageId: Number(cursor.id), recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, result.recipients, { type: "group.history.cleared", conversationId }); response.json({ ok: true, clearedThroughMessageId: result.clearedThroughMessageId });
}));

router.patch("/group-conversations/:conversationId/read", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const messageId = Number(request.body?.messageId);
  const result = await withTransaction(async (connection) => {
    const member = await assertGroupMember(connection, userId, conversationId, { lock: true });
    const [[message]] = await connection.query("SELECT id FROM messages WHERE id = ? AND conversation_id = ? FOR UPDATE", [messageId, conversationId]);
    if (!message) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404 });
    const currentCursor = Math.max(Number(member.last_read_message_id ?? 0), Number(member.history_cleared_message_id ?? 0));
    if (messageId <= currentCursor) return { advanced: false, recipients: [] };
    await connection.query("UPDATE conversation_members SET last_read_message_id = ?, last_read_at = UTC_TIMESTAMP() WHERE conversation_id = ? AND user_id = ?", [messageId, conversationId, userId]);
    return { advanced: true, recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  if (result.advanced) queueChatRealtime(response, result.recipients, { type: "group.messages.read", conversationId });
  response.json({ ok: true, advanced: result.advanced });
}));

router.delete("/group-conversations/:conversationId", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId);
  const deleted = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId, { lock: true, owner: true });
    const active = await groupMemberIds(connection, conversationId);
    await connection.query("UPDATE conversations SET state = 'deleted', avatar_path = NULL WHERE id = ?", [conversationId]);
    await connection.query("UPDATE conversation_members SET left_at = COALESCE(left_at, UTC_TIMESTAMP()) WHERE conversation_id = ?", [conversationId]);
    await connection.query("UPDATE conversation_polls SET closed_at = COALESCE(closed_at, UTC_TIMESTAMP()) WHERE conversation_id = ?", [conversationId]);
    return { formerRecipients: active, avatarPath: group.avatar_path };
  });
  if (deleted.avatarPath) await removeAvatarFile(deleted.avatarPath);
  // The one exception to current-members-only delivery: the committed delete
  // invalidates every active member, so former members receive one empty
  // invalidator to remove the group from an already-open client.
  queueChatRealtime(response, deleted.formerRecipients, { type: "group.deleted", conversationId });
  response.json({ ok: true });
}));

router.get("/group-conversations/:conversationId/messages", asyncRoute(async (request, response) => {
  requireGroupChats();
  const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId);
  const before = request.query.before === undefined ? null : Number(request.query.before);
  if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) throw Object.assign(new Error("Некорректный курсор истории"), { statusCode: 422 });
  const page = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId);
    const [rows] = await connection.query(
      `SELECT m.*, author.username AS author_username, author.avatar_path AS author_avatar_path, author.deleted_at AS author_deleted_at,
              author.purged_at AS author_purged_at, author_profile.display_name AS author_name
         FROM messages m LEFT JOIN users author ON author.id = m.sender_user_id LEFT JOIN profiles author_profile ON author_profile.user_id = author.id
        WHERE m.conversation_id = ? AND m.id > COALESCE(?, 0) AND m.deleted_before_read = 0
          ${before === null ? "" : "AND m.id < ?"}
        ORDER BY m.id DESC LIMIT 201`, before === null ? [conversationId, group.history_cleared_message_id] : [conversationId, group.history_cleared_message_id, before],
    );
    const readThrough = Math.max(Number(group.last_read_message_id ?? 0), Number(group.history_cleared_message_id ?? 0));
    const selected = rows.slice(0, 200);
    return { messages: await groupMessageDtos(connection, selected.reverse(), userId, readThrough, requestLocale(request)), nextCursor: rows.length > 200 ? Number(selected[0].id) : null };
  });
  response.json(page);
}));

router.post("/group-conversations/:conversationId/messages", asyncRoute(async (request, response) => {
  requireGroupChats();
  const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const body = normalizeMessageBody(request.body?.body);
  const stickerId = typeof request.body?.stickerId === "string" ? request.body.stickerId.trim() : "";
  const sticker = stickerId ? activeBookSticker(stickerId) : undefined;
  if (stickerId && !sticker) return response.status(422).json({ code: "MESSAGE_STICKER_UNKNOWN", error: "Неизвестный или отключённый стикер" });
  if (sticker && (body || request.body?.attachment || request.body?.mentions || request.body?.mentionUserIds)) return response.status(422).json({ code: "MESSAGE_STICKER_MUST_BE_STANDALONE", error: "Стикер отправляется отдельным сообщением" });
  if (!body && !request.body?.attachment && !sticker) throw Object.assign(new Error("Сообщение пусто"), { statusCode: 422 });
  const result = await withTransaction(async (connection) => {
    await assertGroupMember(connection, userId, conversationId, { lock: true });
    const attachment = sticker ? null : await validatedGroupChatAttachment(connection, request.body?.attachment, userId, conversationId);
    const [created] = await connection.query("INSERT INTO messages (conversation_id, sender_user_id, recipient_user_id, body, attachment_kind, attachment_id, message_kind, sticker_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)", [conversationId, userId, sticker ? "" : body, attachment?.kind ?? null, attachment?.id ?? null, sticker ? "sticker" : "text", sticker?.id ?? null]);
    if (!sticker) await syncGroupMentions(connection, { conversationId, messageId: Number(created.insertId), authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: body });
    return { messageId: Number(created.insertId), recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, result.recipients, { type: "group.message.created", conversationId, messageId: result.messageId });
  response.status(201).json({ id: result.messageId });
}));

router.get("/group-conversations/:conversationId/polls", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId);
  const polls = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId);
    const [rows] = await connection.query("SELECT message_id FROM conversation_polls WHERE conversation_id = ? AND message_id > COALESCE(?, 0) ORDER BY message_id ASC", [conversationId, group.history_cleared_message_id]);
    const byMessage = await pollDtosForMessages(connection, rows.map((row) => Number(row.message_id)), userId);
    return rows.map((row) => ({ messageId: Number(row.message_id), ...byMessage.get(Number(row.message_id)) }));
  });
  response.json({ polls });
}));

router.post("/group-conversations/:conversationId/polls", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId);
  const question = pollText(request.body?.question, 500, "вопрос опроса"); const options = pollOptions(request.body?.options);
  const allowsMultiple = pollBoolean(request.body?.allowsMultiple, "allowsMultiple"); const mayChangeVote = pollBoolean(request.body?.mayChangeVote, "mayChangeVote"); const closesAt = pollClosesAt(request.body?.closesAt);
  const result = await withTransaction(async (connection) => {
    await assertGroupMember(connection, userId, conversationId, { lock: true });
    const messageId = await groupSystemRow(connection, conversationId, "Опрос");
    const [created] = await connection.query("INSERT INTO conversation_polls (conversation_id, message_id, creator_user_id, question, allows_multiple, may_change_vote, closes_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [conversationId, messageId, userId, question, allowsMultiple ? 1 : 0, mayChangeVote ? 1 : 0, closesAt]);
    const pollId = Number(created.insertId);
    for (const [index, option] of options.entries()) await connection.query("INSERT INTO conversation_poll_options (poll_id, option_order, body) VALUES (?, ?, ?)", [pollId, index + 1, option]);
    return { messageId, poll: await pollDto(connection, pollId, userId), recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, result.recipients, { type: "group.poll.created", conversationId, messageId: result.messageId, pollId: result.poll.id });
  response.status(201).json({ messageId: result.messageId, poll: result.poll });
}));

router.post("/group-conversations/:conversationId/polls/:pollId/vote", asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const pollId = Number(request.params.pollId);
  const rawOptionIds = Array.isArray(request.body?.optionIds) ? request.body.optionIds.map(Number) : null;
  if (!rawOptionIds?.length || rawOptionIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(rawOptionIds).size !== rawOptionIds.length) throw Object.assign(new Error("Выберите уникальные варианты опроса"), { statusCode: 422 });
  const optionIds = rawOptionIds;
  const result = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId, { lock: true });
    const [[poll]] = await connection.query(
      "SELECT id, message_id, allows_multiple, may_change_vote, closes_at, closed_at FROM conversation_polls WHERE id = ? AND conversation_id = ? AND message_id > COALESCE(?, 0) FOR UPDATE",
      [pollId, conversationId, group.history_cleared_message_id],
    );
    if (!poll) throw Object.assign(new Error("Опрос не найден"), { statusCode: 404 });
    if (poll.closed_at || poll.closes_at && new Date(poll.closes_at).getTime() <= Date.now()) throw Object.assign(new Error("Опрос закрыт"), { statusCode: 409, code: "POLL_CLOSED" });
    const [options] = await connection.query(`SELECT id FROM conversation_poll_options WHERE poll_id = ? AND id IN (${optionIds.map(() => "?").join(",")}) ORDER BY id`, [pollId, ...optionIds]);
    if (options.length !== optionIds.length) throw Object.assign(new Error("Вариант опроса не найден"), { statusCode: 422 });
    const [[optionCount]] = await connection.query("SELECT COUNT(*) AS count FROM conversation_poll_options WHERE poll_id = ?", [pollId]);
    if (poll.allows_multiple ? optionIds.length > Number(optionCount.count) : optionIds.length !== 1) throw Object.assign(new Error("Некорректное число вариантов"), { statusCode: 422 });
    const [previous] = await connection.query("SELECT option_id FROM conversation_poll_votes WHERE poll_id = ? AND user_id = ? ORDER BY option_id FOR UPDATE", [pollId, userId]);
    const selected = optionIds.slice().sort((left, right) => left - right); const old = previous.map((row) => Number(row.option_id)); const identical = selected.length === old.length && selected.every((id, index) => id === old[index]);
    if (!poll.may_change_vote && previous.length && !identical) throw Object.assign(new Error("Изменение голоса отключено"), { statusCode: 409, code: "POLL_VOTE_LOCKED" });
    if (!identical) {
      await connection.query("DELETE FROM conversation_poll_votes WHERE poll_id = ? AND user_id = ?", [pollId, userId]);
      for (const optionId of selected) await connection.query("INSERT INTO conversation_poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)", [pollId, optionId, userId]);
    }
    return { poll: await pollDto(connection, pollId, userId), recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, result.recipients, { type: "group.poll.voted", conversationId, pollId }); response.json({ poll: result.poll });
}));

router.patch("/group-conversations/:conversationId/messages/:messageId", messageEditRateLimit, asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const messageId = Number(request.params.messageId); const body = normalizeMessageBody(request.body?.body);
  if (!body) throw Object.assign(new Error("Сообщение не может быть пустым. Для удаления используйте отдельное действие"), { statusCode: 422, code: "MESSAGE_BODY_REQUIRED" });
  const result = await withTransaction(async (connection) => {
    const { group, message } = await groupMessageForMutation(connection, userId, conversationId, messageId);
    if (Number(message.sender_user_id) !== userId) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404 });
    if (message.is_system) throw Object.assign(new Error("Системные сообщения нельзя редактировать"), { statusCode: 409, code: "MESSAGE_SYSTEM_NOT_EDITABLE" });
    if (message.deleted_at) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404 });
    if (message.message_kind === "sticker") throw Object.assign(new Error("Стикеры нельзя редактировать"), { statusCode: 409, code: "MESSAGE_STICKER_NOT_EDITABLE" });
    if (message.attachment_kind || message.attachment_id) throw Object.assign(new Error("Сообщения с вложениями нельзя редактировать"), { statusCode: 409, code: "MESSAGE_ATTACHMENT_NOT_EDITABLE" });
    await connection.query("INSERT INTO message_edit_history (message_id, message_reference_id, editor_user_id, previous_body) VALUES (?, ?, ?, ?)", [messageId, messageId, userId, message.body]);
    await connection.query("UPDATE messages SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ?", [body, messageId]);
    await syncGroupMentions(connection, { conversationId, messageId, authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: body });
    const [rows] = await connection.query("SELECT m.*, author.username AS author_username, author.avatar_path AS author_avatar_path, author.deleted_at AS author_deleted_at, author.purged_at AS author_purged_at, author_profile.display_name AS author_name FROM messages m LEFT JOIN users author ON author.id = m.sender_user_id LEFT JOIN profiles author_profile ON author_profile.user_id = author.id WHERE m.id = ?", [messageId]);
    const [dto] = await groupMessageDtos(connection, rows, userId, Math.max(Number(group.last_read_message_id ?? 0), Number(group.history_cleared_message_id ?? 0)), requestLocale(request));
    return { message: dto, recipients: await groupSignalMemberIds(connection, conversationId) };
  });
  queueChatRealtime(response, result.recipients, { type: "group.message.edited", conversationId, messageId }); response.json({ ok: true, message: result.message });
}));

router.delete("/group-conversations/:conversationId/messages/:messageId", messageEditRateLimit, asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const messageId = Number(request.params.messageId);
  const result = await withTransaction(async (connection) => {
    const { group, message } = await groupMessageForMutation(connection, userId, conversationId, messageId);
    if (message.is_system) throw Object.assign(new Error("Системные сообщения нельзя удалять"), { statusCode: 409, code: "MESSAGE_SYSTEM_NOT_DELETABLE" });
    if (message.deleted_at) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404 });
    const authorDelete = Number(message.sender_user_id) === userId;
    if (!authorDelete && !["owner", "moderator"].includes(group.role)) throw Object.assign(new Error("Сообщение не найдено"), { statusCode: 404 });
    const [[clock]] = await connection.query("SELECT UTC_TIMESTAMP() AS deleted_at");
    if (authorDelete) {
      await connection.query("INSERT INTO message_deletion_evidence (message_id, message_reference_id, sender_user_id, sender_reference_id, recipient_user_id, recipient_reference_id, original_body, message_kind, sticker_id, attachment_kind, attachment_id, was_read, original_read_at, deleted_before_read, deleted_at, moderation_retained_until) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 1, NULL, 0, ?, NULL)", [messageId, messageId, userId, userId, message.body, message.message_kind, message.sticker_id, message.attachment_kind, message.attachment_id, clock.deleted_at]);
    } else {
      await connection.query("INSERT INTO group_message_moderation_evidence (message_reference_id, message_id, conversation_id, author_reference_id, author_user_id, deleter_reference_id, deleted_by_user_id, deleted_by_role, original_body, original_message_kind, original_sticker_id, original_attachment_kind, original_attachment_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [messageId, messageId, conversationId, message.sender_user_id, message.sender_user_id, userId, userId, group.role, message.body, message.message_kind, message.sticker_id, message.attachment_kind, message.attachment_id, clock.deleted_at]);
    }
    await connection.query("UPDATE messages SET body = '', attachment_kind = NULL, attachment_id = NULL, sticker_id = NULL, message_kind = 'text', deleted_at = ?, deleted_by_sender_at = ?, deleted_before_read = 0, moderation_retained_until = NULL, group_deleted_by_role = ? WHERE id = ?", [clock.deleted_at, authorDelete ? clock.deleted_at : null, authorDelete ? null : group.role, messageId]);
    await connection.query("DELETE FROM message_reactions WHERE message_id = ?", [messageId]);
    await connection.query("DELETE FROM content_mentions WHERE entity_type = 'message' AND entity_id = ?", [messageId]);
    return { recipients: await groupSignalMemberIds(connection, conversationId), moderated: !authorDelete };
  });
  queueChatRealtime(response, result.recipients, { type: result.moderated ? "group.message.moderated" : "group.message.deleted", conversationId, messageId }); response.json({ ok: true, messageId });
}));

async function groupReactionDto(connection, conversationId, messageId, viewerId) {
  const [rows] = await connection.query("SELECT reaction.user_id FROM message_reactions reaction JOIN conversation_members member ON member.user_id = reaction.user_id WHERE reaction.message_id = ? AND reaction.reaction_type = 'like' AND member.conversation_id = ? AND member.left_at IS NULL ORDER BY reaction.created_at, reaction.user_id", [messageId, conversationId]);
  const likedByUserIds = rows.map((row) => Number(row.user_id));
  return { messageId, likeCount: likedByUserIds.length, likedByViewer: likedByUserIds.includes(viewerId), likedByUserIds };
}

for (const [method, path, sql] of [["post", "/group-conversations/:conversationId/messages/:messageId/reactions/like", "INSERT IGNORE INTO message_reactions (message_id, user_id, reaction_type) VALUES (?, ?, 'like')"], ["delete", "/group-conversations/:conversationId/messages/:messageId/reactions/like", "DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND reaction_type = 'like'"]]) {
  router[method](path, messageReactionRateLimit, asyncRoute(async (request, response) => {
    requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const messageId = Number(request.params.messageId);
    const result = await withTransaction(async (connection) => {
      const { message } = await groupMessageForMutation(connection, userId, conversationId, messageId);
      if (message.is_system || message.deleted_at) throw Object.assign(new Error("Реакция для этого сообщения недоступна"), { statusCode: 409, code: "MESSAGE_REACTION_NOT_ALLOWED" });
      await connection.query(sql, [messageId, userId]);
      return { reaction: await groupReactionDto(connection, conversationId, messageId, userId), recipients: await groupSignalMemberIds(connection, conversationId) };
    });
    queueChatRealtime(response, result.recipients, { type: "group.message.reaction.changed", conversationId, messageId }); response.json(result.reaction);
  }));
}

router.get("/group-conversations/:conversationId/messages/search", messageSearchRateLimit, asyncRoute(async (request, response) => {
  requireGroupChats(); const userId = Number(request.bookMeetUser.id); const conversationId = Number(request.params.conversationId); const search = normalizeMessageSearchQuery(request.query.q); const cursor = decodeMessageSearchCursor(request.query.cursor); const limit = messageSearchLimit(request.query.limit);
  const result = await withTransaction(async (connection) => {
    const group = await assertGroupMember(connection, userId, conversationId);
    const cursorSql = cursor ? " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : "";
    const values = [conversationId, group.history_cleared_message_id, search.booleanQuery]; const cursorValues = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
    const commonSql = "FROM messages m FORCE INDEX (messages_body_fulltext) LEFT JOIN users author ON author.id = m.sender_user_id LEFT JOIN profiles author_profile ON author_profile.user_id = author.id WHERE m.conversation_id = ? AND m.id > COALESCE(?, 0) AND m.is_system = 0 AND m.message_kind <> 'sticker' AND m.deleted_at IS NULL AND m.deleted_before_read = 0 AND MATCH(m.body) AGAINST (? IN BOOLEAN MODE)";
    const [rows] = await connection.query(`SELECT m.id, m.sender_user_id, m.body, m.created_at, author.username AS author_username, author_profile.display_name AS author_name, author.deleted_at AS author_deleted_at, author.purged_at AS author_purged_at ${commonSql}${cursorSql} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`, [...values, ...cursorValues, limit + 1]);
    const [[count]] = await connection.query(`SELECT COUNT(*) AS total ${commonSql}`, values);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return { total: Number(count.total), matches: page.map((row) => ({ messageId: Number(row.id), snippet: messageSearchSnippet(row.body, search.tokens), createdAt: new Date(row.created_at).toISOString(), author: row.sender_user_id && !row.author_deleted_at && !row.author_purged_at ? { id: Number(row.sender_user_id), name: row.author_name, username: row.author_username } : { name: "Удалённый пользователь" } })), nextCursor: rows.length > limit && last ? encodeMessageSearchCursor({ id: Number(last.id), createdAt: new Date(last.created_at).toISOString() }) : null };
  });
  response.json({ query: search.text, ...result });
}));

router.get("/conversations/:id/messages/search", messageSearchRateLimit, asyncRoute(async (request, response) => {
  const userId = Number(request.bookMeetUser.id);
  const peerId = Number(request.params.id);
  const search = normalizeMessageSearchQuery(request.query.q);
  const cursor = decodeMessageSearchCursor(request.query.cursor);
  const limit = messageSearchLimit(request.query.limit);
  const result = await withTransaction(async (connection) => {
    await assertMessageSearchPairAccess(connection, userId, peerId);
    return conversationMessageSearch(connection, { userId, peerId, search, cursor, limit });
  });
  response.json({ query: search.text, peerId, ...result });
}));

router.get("/messages/search", messageSearchRateLimit, asyncRoute(async (request, response) => {
  const userId = Number(request.bookMeetUser.id);
  const search = normalizeMessageSearchQuery(request.query.q);
  const cursor = decodeMessageSearchCursor(request.query.cursor);
  const limit = messageSearchLimit(request.query.limit, MESSAGE_SEARCH_GROUP_LIMIT, 20);
  const result = await withTransaction(async (connection) => {
    const peerExpression = "CASE WHEN m.sender_user_id = ? THEN m.recipient_user_id ELSE m.sender_user_id END";
    const cursorHaving = cursor ? " AND (MAX(m.created_at) < ? OR (MAX(m.created_at) = ? AND MAX(m.id) < ?))" : "";
    const [candidateGroups] = await connection.query(
      `SELECT grouped.peer_user_id, COUNT(*) AS match_count,
              MAX(grouped.created_at) AS newest_at, MAX(grouped.id) AS newest_message_id
         FROM (
           SELECT m.id, m.created_at, ${peerExpression} AS peer_user_id
             FROM messages m FORCE INDEX (messages_body_fulltext)
             LEFT JOIN chat_history_clears history_clear
               ON history_clear.user_id = ? AND history_clear.peer_user_id = ${peerExpression}
            WHERE (m.sender_user_id = ? OR m.recipient_user_id = ?)
              AND m.sender_user_id IS NOT NULL
              AND m.id > COALESCE(history_clear.cleared_through_message_id, 0)
              AND m.deleted_at IS NULL
              AND m.deleted_before_read = 0
              AND MATCH(m.body) AGAINST (? IN BOOLEAN MODE)
         ) grouped
        GROUP BY grouped.peer_user_id
       HAVING grouped.peer_user_id IS NOT NULL${cursorHaving.replaceAll("m.", "grouped.")}
        ORDER BY newest_at DESC, newest_message_id DESC
        LIMIT 101`,
      [userId, userId, userId, userId, userId, search.booleanQuery, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [])],
    );
    const accessible = [];
    for (const group of candidateGroups) {
      const peerId = Number(group.peer_user_id);
      try {
        await assertMessageSearchPairAccess(connection, userId, peerId);
      } catch (error) {
        if (error?.code === "MESSAGE_SEARCH_DIALOG_NOT_FOUND") continue;
        throw error;
      }
      const [[peer]] = await connection.query(
        `SELECT u.id, u.username, u.initials, u.color, u.avatar_path, p.display_name, p.profile_type
           FROM users u JOIN profiles p ON p.user_id = u.id
          WHERE u.id = ? AND u.deleted_at IS NULL AND u.purged_at IS NULL LIMIT 1`,
        [peerId],
      );
      if (!peer) continue;
      const matches = await conversationMessageSearch(connection, { userId, peerId, search, limit: MESSAGE_SEARCH_GROUP_MATCH_LIMIT, includeTotal: false });
      accessible.push({
        peer: { id: peerId, name: peer.display_name, username: peer.username, type: peer.profile_type, initials: peer.initials, color: peer.color, avatarUrl: peer.avatar_path ?? undefined },
        count: Number(group.match_count),
        newestAt: new Date(group.newest_at).toISOString(),
        matches: matches.matches,
        matchesNextCursor: matches.nextCursor,
        newestMessageId: Number(group.newest_message_id),
      });
      if (accessible.length > limit) break;
    }
    const page = accessible.slice(0, limit);
    const last = page[page.length - 1];
    const rawLast = candidateGroups[candidateGroups.length - 1];
    return {
      groups: page.map(({ newestMessageId: _newestMessageId, ...group }) => group),
      // An inaccessible candidate must not make the remaining permitted
      // dialogs unreachable.  When this bounded FULLTEXT batch contains no
      // extra returned group, continue after its raw tail; the opaque cursor
      // discloses neither the skipped peer nor its content.
      nextCursor: accessible.length > limit && last
        ? encodeMessageSearchCursor({ id: last.newestMessageId, createdAt: last.newestAt })
        : candidateGroups.length > 100 && rawLast
          ? encodeMessageSearchCursor({ id: Number(rawLast.newest_message_id), createdAt: new Date(rawLast.newest_at).toISOString() })
          : null,
    };
  });
  response.json({ query: search.text, ...result });
}));

router.get("/stickers", (request, response) => {
  response.json(bookStickerCatalog(requestLocale(request), { pickerOnly: true }));
});

router.post("/social/messages", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.body?.targetId);
  const body = normalizeMessageBody(request.body?.body);
  const stickerId = typeof request.body?.stickerId === "string" ? request.body.stickerId.trim() : "";
  const sticker = stickerId ? activeBookSticker(stickerId) : undefined;
  if (stickerId && !sticker) return response.status(422).json({ code: "MESSAGE_STICKER_UNKNOWN", error: "Неизвестный или отключённый стикер" });
  if (sticker && (body || request.body?.attachment || request.body?.mentions || request.body?.mentionUserIds)) return response.status(422).json({ code: "MESSAGE_STICKER_MUST_BE_STANDALONE", error: "Стикер отправляется отдельным сообщением" });
  if (!targetId || (!body && !request.body?.attachment && !sticker)) return response.status(400).json({ error: "Сообщение пусто" });
  const createdMessage = await withTransaction(async (connection) => {
    const { participants } = await assertMessagePairAccess(connection, userId, targetId);
    const attachment = sticker ? undefined : await validatedChatAttachment(connection, request.body?.attachment, userId, targetId);
    const conversationId = await canonicalDirectConversation(connection, userId, targetId);
    const [created] = await connection.query("INSERT INTO messages (conversation_id, sender_user_id, recipient_user_id, body, attachment_kind, attachment_id, message_kind, sticker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [conversationId, userId, targetId, sticker ? "" : body, attachment?.kind ?? null, attachment?.id ?? null, sticker ? "sticker" : "text", sticker?.id ?? null]);
    // Messages retain stable mention links but deliberately do not create a
    // second general notification: chat delivery already covers this event.
    if (!sticker) await syncMentions(connection, { entityType: "message", entityId: Number(created.insertId), authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: body });
    if (shouldEnqueueSupportAlert(participants, userId, targetId)) {
      await enqueueTelegramAlert(connection, { eventType: "support_message", entityId: created.insertId, actorUserId: userId, summary: "Новое сообщение пользователя" });
    }
    const [[savedMessage]] = await connection.query("SELECT created_at FROM messages WHERE id = ?", [created.insertId]);
    const mentions = (await mentionDtos(connection, "message", Number(created.insertId), userId)).get(Number(created.insertId)) ?? [];
    return { id: Number(created.insertId), createdAt: new Date(savedMessage.created_at).toISOString(), attachment, text: sticker ? "" : neutralizeMentionedText(body, mentions), mentions, ...(sticker ? { kind: "sticker", sticker: stickerDto(sticker, requestLocale(request)) } : {}) };
  });
  queueChatRealtime(response, [userId, targetId], { type: "message.created", messageId: createdMessage.id });
  response.status(201).json({ ok: true, message: { ...createdMessage, senderId: userId, mine: true, read: false, likeCount: 0, likedByViewer: false, likedByUserIds: [] } });
}));

router.patch("/messages/:id", messageEditRateLimit, asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const messageId = Number(request.params.id);
  const body = normalizeMessageBody(request.body?.body);
  const result = await withTransaction(async (connection) => {
    const { message: current, peerId } = await assertMessageEditAccess(connection, userId, messageId);
    if (!body) {
      throw Object.assign(new Error("Сообщение не может быть пустым. Для удаления используйте отдельное действие"), { statusCode: 422, code: "MESSAGE_BODY_REQUIRED" });
    }
    await connection.query(
      `INSERT INTO message_edit_history (message_id, message_reference_id, editor_user_id, previous_body)
       VALUES (?, ?, ?, ?)`,
      [messageId, messageId, userId, current.body],
    );
    await connection.query("UPDATE messages SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ?", [body, messageId]);
    await syncMentions(connection, { entityType: "message", entityId: messageId, authorUserId: userId, mentionUserIds: request.body?.mentionUserIds ?? request.body?.mentions, text: body });
    const [[updated]] = await connection.query(
      "SELECT id, sender_user_id, recipient_user_id, body, message_kind, sticker_id, read_at, edited_at, created_at FROM messages WHERE id = ?",
      [messageId],
    );
    return { message: await editableMessageDto(connection, updated, userId), peerId };
  });
  queueChatRealtime(response, [userId, result.peerId], { type: "message.edited", messageId });
  response.json({ ok: true, message: result.message });
}));

router.delete("/messages/:id", messageEditRateLimit, asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const messageId = Number(request.params.id);
  const result = await withTransaction(async (connection) => {
    const { message, peerId } = await assertMessageDeleteAccess(connection, userId, messageId);
    const deletedBeforeRead = !message.read_at;
    const [[clock]] = await connection.query("SELECT UTC_TIMESTAMP() AS deleted_at");
    await connection.query(
      `INSERT INTO message_deletion_evidence
         (message_id, message_reference_id, sender_user_id, sender_reference_id, recipient_user_id, recipient_reference_id,
          original_body, message_kind, sticker_id, attachment_kind, attachment_id, was_read, original_read_at, deleted_before_read, deleted_at, moderation_retained_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [messageId, messageId, userId, userId, peerId, peerId, message.body, message.message_kind, message.sticker_id, message.attachment_kind, message.attachment_id, deletedBeforeRead ? 0 : 1, message.read_at, deletedBeforeRead ? 1 : 0, clock.deleted_at],
    );
    await connection.query(
      `UPDATE messages
          SET body = '', attachment_kind = NULL, attachment_id = NULL, sticker_id = NULL, message_kind = 'text', deleted_at = ?, deleted_by_sender_at = ?,
              deleted_before_read = ?, moderation_retained_until = NULL
        WHERE id = ? AND sender_user_id = ? AND deleted_at IS NULL`,
      [clock.deleted_at, clock.deleted_at, deletedBeforeRead ? 1 : 0, messageId, userId],
    );
    await connection.query("DELETE FROM message_reactions WHERE message_id = ?", [messageId]);
    await connection.query("DELETE FROM content_mentions WHERE entity_type = 'message' AND entity_id = ?", [messageId]);
    await connection.query(
      `DELETE FROM notifications
        WHERE notification_type = 'new_message' AND user_id = ? AND actor_user_id = ?
          AND material_kind = 'message' AND material_id = ?`,
      [peerId, userId, messageId],
    );
    await cancelNotificationDeliveries(connection, {
      userId: peerId,
      actorUserId: userId,
      eventType: "new_message",
      materialKind: "message",
      materialId: messageId,
    });
    await connection.query("DELETE FROM telegram_alert_outbox WHERE event_type = 'support_message' AND entity_id = ? AND delivered_at IS NULL", [messageId]);
    return { deletedBeforeRead, peerId };
  });
  queueChatRealtime(response, [userId, result.peerId], { type: "message.deleted", messageId });
  response.json({ ok: true, messageId, deletedBeforeRead: result.deletedBeforeRead, ...(result.deletedBeforeRead ? {} : { tombstone: DELETED_MESSAGE_TOMBSTONE }) });
}));

router.post("/messages/:id/reactions/like", messageReactionRateLimit, asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const messageId = Number(request.params.id);
  const result = await withTransaction(async (connection) => {
    const { peerId } = await assertMessageReactionAccess(connection, userId, messageId);
    await connection.query(
      "INSERT IGNORE INTO message_reactions (message_id, user_id, reaction_type) VALUES (?, ?, 'like')",
      [messageId, userId],
    );
    return { reaction: await messageReactionDto(connection, messageId, userId), peerId };
  });
  queueChatRealtime(response, [userId, result.peerId], { type: "message.reaction.changed", messageId });
  response.json(result.reaction);
}));

router.delete("/messages/:id/reactions/like", messageReactionRateLimit, asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const messageId = Number(request.params.id);
  const result = await withTransaction(async (connection) => {
    const { peerId } = await assertMessageReactionAccess(connection, userId, messageId);
    await connection.query(
      "DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND reaction_type = 'like'",
      [messageId, userId],
    );
    return { reaction: await messageReactionDto(connection, messageId, userId), peerId };
  });
  queueChatRealtime(response, [userId, result.peerId], { type: "message.reaction.changed", messageId });
  response.json(result.reaction);
}));

router.patch("/social/messages/:targetId/read", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  await withTransaction(async (connection) => {
    await assertMessagePairAccess(connection, userId, targetId);
    const [candidates] = await connection.query(
      `SELECT id FROM messages
        WHERE sender_user_id = ? AND recipient_user_id = ? AND read_at IS NULL
          AND deleted_at IS NULL AND deleted_before_read = 0
        ORDER BY id`,
      [targetId, userId],
    );
    const [rows] = candidates.length ? await connection.query(
      `SELECT id FROM messages FORCE INDEX (PRIMARY)
        WHERE id IN (${candidates.map(() => "?").join(",")})
          AND sender_user_id = ? AND recipient_user_id = ? AND read_at IS NULL
          AND deleted_at IS NULL AND deleted_before_read = 0
        ORDER BY id FOR UPDATE`,
      [...candidates.map((row) => row.id), targetId, userId],
    ) : [[]];
    if (rows.length) {
      await connection.query(
        `UPDATE messages FORCE INDEX (PRIMARY) SET read_at = UTC_TIMESTAMP()
          WHERE id IN (${rows.map(() => "?").join(",")}) AND read_at IS NULL AND deleted_at IS NULL AND deleted_before_read = 0`,
        rows.map((row) => row.id),
      );
    }
  });
  queueChatRealtime(response, [userId, targetId], { type: "messages.read" });
  response.json({ ok: true });
}));

router.delete("/social/messages/:targetId/history", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  const clearedThroughMessageId = await withTransaction(async (connection) => {
    await assertMessagePairAccess(connection, userId, targetId);
    const [[cursor]] = await connection.query(
      `SELECT COALESCE(MAX(id), 0) AS message_id
         FROM messages
        WHERE (sender_user_id = ? AND recipient_user_id = ?)
           OR (sender_user_id = ? AND recipient_user_id = ?)`,
      [userId, targetId, targetId, userId],
    );
    const messageId = Number(cursor.message_id);
    await connection.query(
      `INSERT INTO chat_history_clears (user_id, peer_user_id, cleared_through_message_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE cleared_through_message_id = GREATEST(cleared_through_message_id, VALUES(cleared_through_message_id)), cleared_at = CURRENT_TIMESTAMP`,
      [userId, targetId, messageId],
    );
    return messageId;
  });
  queueChatRealtime(response, [userId], { type: "history.cleared" });
  response.json({ ok: true, clearedThroughMessageId });
}));

async function loadNotificationPreferences(connection, userId, requestTimezone) {
  const [accountResult, preferenceResult] = await Promise.all([
    connection.query(
      `SELECT email, email_verified_at, notification_timezone, telegram_user_id, telegram_connected_at, telegram_display_name, telegram_delivery_error_at
         FROM users
        WHERE id = ?
        LIMIT 1`,
      [userId],
    ),
    connection.query(
      `SELECT category, in_app_enabled, telegram_enabled, email_mode
         FROM notification_preferences
        WHERE user_id = ?`,
      [userId],
    ),
  ]);
  const [accountRows] = accountResult;
  const [rows] = preferenceResult;
  const account = accountRows[0];
  if (!account) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
  return notificationPreferencesState({ rows, account, requestTimezone });
}

router.get("/users/me/notification-preferences", asyncRoute(async (request, response) => {
  const state = await loadNotificationPreferences(getPool(), request.bookMeetUser.id, request.get("X-BookMeet-Timezone"));
  response.json(state);
}));

router.put("/users/me/notification-preferences", notificationPreferenceRateLimit, asyncRoute(async (request, response) => {
  const payload = validateNotificationPreferencesPayload(request.body);
  const userId = request.bookMeetUser.id;
  const state = await withTransaction(async (connection) => {
    const current = await loadNotificationPreferences(connection, userId, request.get("X-BookMeet-Timezone"));
    for (const [category, changes] of Object.entries(payload.categories ?? {})) {
      if (changes.telegramEnabled === true && !current.readiness.telegram.available) {
        throw Object.assign(new Error("Telegram-уведомления недоступны: подключение аккаунта или доставка не подтверждены"), { statusCode: 409, code: "TELEGRAM_NOTIFICATIONS_UNAVAILABLE" });
      }
      if (changes.emailMode && changes.emailMode !== "off" && !current.readiness.email.available) {
        throw Object.assign(new Error("Email-уведомления недоступны: адрес или доставка не подтверждены"), { statusCode: 409, code: "EMAIL_NOTIFICATIONS_UNAVAILABLE" });
      }
      const merged = { ...current.categories[category], ...changes };
      await connection.query(
        `INSERT INTO notification_preferences (user_id, category, in_app_enabled, telegram_enabled, email_mode)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           in_app_enabled = VALUES(in_app_enabled),
           telegram_enabled = VALUES(telegram_enabled),
           email_mode = VALUES(email_mode),
           updated_at = CURRENT_TIMESTAMP`,
        [userId, category, merged.inAppEnabled ? 1 : 0, merged.telegramEnabled ? 1 : 0, merged.emailMode],
      );
      if (changes.telegramEnabled === false) await cancelNotificationDeliveries(connection, { userId, channel: "telegram", category });
      if (changes.emailMode === "off") await cancelNotificationDeliveries(connection, { userId, channel: "email", category });
    }
    if (Object.hasOwn(payload, "timezone")) {
      await connection.query("UPDATE users SET notification_timezone = ? WHERE id = ?", [payload.timezone, userId]);
    }
    return loadNotificationPreferences(connection, userId, request.get("X-BookMeet-Timezone"));
  });
  response.json(state);
}));

router.patch("/notifications/read-all", notificationReadRateLimit, asyncRoute(async (request, response) => {
  const category = String(request.body?.category ?? "");
  if (category !== "all" && !NOTIFICATION_CATEGORIES.includes(category)) {
    return response.status(400).json({ code: "INVALID_NOTIFICATION_CATEGORY", error: "Укажите диапазон уведомлений" });
  }
  if (request.body?.confirmed !== undefined && typeof request.body.confirmed !== "boolean") {
    return response.status(400).json({ code: "INVALID_NOTIFICATION_CONFIRMATION", error: "Некорректное подтверждение" });
  }
  const result = await withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT id, notification_type AS type
         FROM notifications
        WHERE user_id = ? AND is_unread = 1
        ORDER BY id
        FOR UPDATE`,
      [request.bookMeetUser.id],
    );
    const selected = category === "all" ? rows : rows.filter((row) => notificationCategoryFor(row.type) === category);
    if (selected.length > NOTIFICATION_READ_CONFIRMATION_THRESHOLD && request.body?.confirmed !== true) {
      return { confirmationRequired: true, affectedCount: selected.length };
    }
    const changedIds = selected.map((row) => Number(row.id));
    if (changedIds.length) {
      await connection.query("UPDATE notifications SET is_unread = 0 WHERE user_id = ? AND id IN (?)", [request.bookMeetUser.id, changedIds]);
    }
    return { confirmationRequired: false, affectedCount: changedIds.length, changedIds };
  });
  if (result.confirmationRequired) {
    return response.status(409).json({
      code: "NOTIFICATION_READ_CONFIRMATION_REQUIRED",
      error: "Требуется подтверждение массового прочтения",
      category,
      affectedCount: result.affectedCount,
      threshold: NOTIFICATION_READ_CONFIRMATION_THRESHOLD,
    });
  }
  response.json({ ok: true, category, affectedCount: result.affectedCount, changedIds: result.changedIds });
}));

router.patch("/notifications/:id/read", asyncRoute(async (request, response) => {
  await getPool().query("UPDATE notifications SET is_unread = 0 WHERE id = ? AND user_id = ?", [Number(request.params.id), request.bookMeetUser.id]);
  response.json({ ok: true });
}));

export default router;
