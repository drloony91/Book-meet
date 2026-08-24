import { Router } from "express";
import QRCode from "qrcode";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { getPool, withTransaction } from "./db.js";
import { ageFromBirthDate, loadBootstrap, resolveBook } from "./data.js";
import { createBootstrapRouter } from "./modules/bootstrap-router.js";
import { searchBootstrapMaterials } from "./modules/material-search.js";
import { plainTextFromHtml, validateRichHtml } from "./modules/content-security.js";
import { previewRemoteCover, saveAvatar, saveCover, saveRemoteCover } from "./modules/image-storage.js";
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
import { LEGAL_DOCUMENT_TYPES, REQUIRED_LEGAL_DOCUMENT_TYPES, REPORT_STATUSES, REPORT_TARGET_KINDS, activeLegalDocuments, assertAgeCompatible, assertLegalDocumentDeletable, legalAccessState, legalConsentRequired, legalDocumentWriteMode, logModerationAction, logSecurityEvent, profileAccessState, recordLegalAcceptances, removeCrossAgeRelationships, requestAuditMetadata, validateLegalAcceptance } from "./modules/compliance.js";
import { clearSessionCookie, clearTransientCookie, createSessionToken, generateRecoveryCodes, generateTotpSecret, hashPassword, hashRecoveryCode, hashSessionToken, isValidEmail, normalizeEmail, normalizeIdentity, readCookie, recoveryCodeIndex, sessionCookie, transientCookie, verifyPassword, verifyTotp } from "./security.js";

const router = Router();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;
const loginAttempts = new LoginAttemptTracker({ limit: LOGIN_ATTEMPT_LIMIT, windowMs: LOGIN_WINDOW_MS });
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
  await connection.query("DELETE FROM user_books WHERE user_id = ? AND is_author = 0", [userId]);
  await connection.query("DELETE FROM material_likes WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM material_saves WHERE user_id = ?", [userId]);
  await connection.query("DELETE FROM notifications WHERE user_id = ? OR actor_user_id = ?", [userId, userId]);
  await connection.query("DELETE FROM linked_profiles WHERE personal_user_id = ? OR community_user_id = ?", [userId, userId]);
  await connection.query("UPDATE reports SET reporter_user_id = NULL, reporter_anonymized = 1 WHERE reporter_user_id = ?", [userId]);
  await connection.query("UPDATE report_appeals SET appellant_user_id = NULL WHERE appellant_user_id = ?", [userId]);
  await connection.query(
    `UPDATE profiles SET display_name = 'Удалённый пользователь', city = '', city_id = NULL, gender = 'Не указан', birth_date = NULL,
            show_birth_date_to_friends = 0, birth_date_visibility = 'nobody', profile_tab_order = NULL, hidden_profile_tabs = NULL, bio = '', author_influences = '', writing_themes = '', weekend = '', joy = '', talk = '',
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
    try { client.write(payload); } catch { realtimeClients.delete(client); }
  }
}

async function deliverDueEventReminders() {
  try {
    const delivered = await withTransaction(async (connection) => {
      const [created] = await connection.query(
        `INSERT IGNORE INTO notifications
           (user_id, actor_user_id, notification_type, title, body, material_kind, material_id, group_key)
         SELECT er.user_id, e.creator_user_id, 'event_reminder', 'Событие уже завтра',
                CONCAT('Через 24 часа начнётся событие «', e.title, '».'),
                'event', e.id, CONCAT('event-reminder:', er.user_id, ':', e.id)
           FROM event_reminders er
           JOIN events e ON e.id = er.event_id
          WHERE er.reminded_at IS NULL
            AND e.status = 'published'
            AND TIMESTAMP(e.event_date, e.event_time) > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 HOUR)
            AND TIMESTAMP(e.event_date, e.event_time) <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 29 HOUR)`,
      );
      await connection.query(
        `UPDATE event_reminders er
           JOIN events e ON e.id = er.event_id
            SET er.reminded_at = UTC_TIMESTAMP()
          WHERE er.reminded_at IS NULL
            AND e.status = 'published'
            AND TIMESTAMP(e.event_date, e.event_time) > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 HOUR)
            AND TIMESTAMP(e.event_date, e.event_time) <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 29 HOUR)`,
      );
      return Number(created.affectedRows || 0);
    });
    if (delivered) broadcastRealtime();
  } catch (error) {
    console.warn("Не удалось проверить напоминания о событиях:", error.message);
  }
}

const reminderTimer = setInterval(deliverDueEventReminders, 5 * 60 * 1000);
reminderTimer.unref?.();
setTimeout(deliverDueEventReminders, 15_000).unref?.();

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

function loginAttemptState(request, email) {
  const client = request.ip || request.socket.remoteAddress || "unknown";
  return loginAttempts.state([`ip:${client}`, `identity:${normalizeEmail(email)}`]);
}

async function createSession(connection, userId, request = null) {
  const { token, tokenHash } = createSessionToken();
  const [[account]] = await connection.query("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  const sessionDays = account?.role === "admin"
    ? Math.max(1 / 24, Number(process.env.ADMIN_SESSION_HOURS || 12) / 24)
    : Math.max(1, Number(process.env.SESSION_DAYS || 7));
  const { ipHash, userAgentHash } = request ? requestAuditMetadata(request) : { ipHash: null, userAgentHash: null };
  await connection.query("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()");
  await connection.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at, last_seen_at, ip_hash, user_agent_hash) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP(), ?, ?)",
    [tokenHash, userId, Math.max(60, Math.round(sessionDays * 86400)), ipHash, userAgentHash],
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
    `SELECT u.id, u.username, u.role, u.preferred_locale, u.suspension_reason, u.suspended_until, u.suspended_permanently,
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
    id: userId, username: user.username, tokenHash, role: user.role, locale: user.preferred_locale || "ru",
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

function marketplaceFromUrl(value) {
  const url = new URL(cleanUrl(value));
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "flip.kz" || host.endsWith(".flip.kz")) return { name: "Flip", url };
  throw Object.assign(new Error("Поддерживаются только ссылки Flip.kz"), { statusCode: 400 });
}

function bookSourceFromUrl(value) {
  const url = new URL(cleanUrl(value));
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

async function fetchBookProduct(productUrl, flipOnly = false) {
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

async function notifyWriterAboutBook(connection, bookId, actorId, action) {
  const [[book]] = await connection.query("SELECT creator_user_id, title FROM books WHERE id = ?", [bookId]);
  if (!book?.creator_user_id || Number(book.creator_user_id) === Number(actorId)) return;
  const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [actorId]);
  const titles = { library: "Книгу добавили в библиотеку", wishlist: "Книгу хотят прочитать", review: "На книгу написали рецензию" };
  const verbs = { library: "добавил(а) вашу книгу в библиотеку", wishlist: "добавил(а) вашу книгу в список «Хочу почитать!»", review: "написал(а) рецензию на вашу книгу" };
  await connection.query(
    `INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id, group_key)
     VALUES (?, ?, 'author_book_activity', ?, ?, 'book', ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body), is_unread = 1, created_at = CURRENT_TIMESTAMP`,
    [book.creator_user_id, actorId, titles[action], `${actor?.display_name ?? "Пользователь"} ${verbs[action]} «${book.title}».`, bookId, `author-book:${action}:${bookId}:${actorId}`],
  );
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

async function assertUsersCanInteract(connection, firstUserId, secondUserId) {
  await lockInteractionPair(connection, firstUserId, secondUserId);
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
    chat: ["SELECT u.id, p.display_name AS title, u.id AS owner_id FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", id],
    comment: ["SELECT mc.id, LEFT(mc.body, 180) AS title, mc.user_id AS owner_id FROM material_comments mc WHERE mc.id = ?", id],
  };
  const spec = specs[kind];
  if (!spec || !Number(id)) return null;
  const [[row]] = await connection.query(spec[0], [spec[1]]);
  return row ?? null;
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

function publisherSalesLinks(value) {
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
  const material = await materialInfo(connection, kind, id);
  if (!material) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
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
    book: "SELECT id FROM books WHERE id = ? LIMIT 1",
    user: "SELECT id FROM users WHERE id = ? AND role <> 'admin' LIMIT 1",
    event: "SELECT id FROM events WHERE id = ? AND status = 'published' LIMIT 1",
    review: "SELECT id FROM reviews WHERE id = ? LIMIT 1",
    excerpt: "SELECT id FROM excerpts WHERE id = ? LIMIT 1",
    occasion: "SELECT id FROM occasions WHERE id = ? AND status = 'published' LIMIT 1",
  };
  if (!queries[kind]) throw Object.assign(new Error("Неизвестный тип вложения"), { statusCode: 400 });
  const [[item]] = await connection.query(queries[kind], [id]);
  if (!item) throw Object.assign(new Error("Материал для отправки не найден"), { statusCode: 404 });
  if (kind !== "user") {
    await assertAdultMaterialReadable(connection, senderUserId, kind, id);
    await assertAdultMaterialReadable(connection, recipientUserId, kind, id);
  }
  return { kind, id };
}

async function notifyFollowersAboutPublication(connection, userId, kind, materialId, materialTitle) {
  const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
  const publicationName = kind === "review" ? "Новая рецензия" : "Новая публикация блога";
  const body = `${actor.display_name} опубликовал(а) материал «${materialTitle}».`;
  await connection.query(
    `INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id, group_key)
     SELECT follower_user_id, ?, 'publication', ?, ?, ?, ?, ?
       FROM follows
      WHERE target_user_id = ? AND follower_user_id <> ?`,
    [userId, publicationName, body, kind, materialId, `publication:${kind}:${materialId}`, userId, userId],
  );
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

router.get("/users/me/telegram-notifications", asyncRoute(async (request, response) => {
  const [[account]] = await getPool().query("SELECT telegram_subject, telegram_notifications_enabled, telegram_notification_categories FROM users WHERE id = ?", [request.bookMeetUser.id]);
  response.json({ connected: Boolean(account?.telegram_subject), enabled: Boolean(account?.telegram_notifications_enabled), categories: jsonArray(account?.telegram_notification_categories) });
}));

router.patch("/users/me/telegram-notifications", asyncRoute(async (request, response) => {
  const allowed = new Set(["messages", "moderation", "complaints", "events", "social"]);
  const categories = (Array.isArray(request.body?.categories) ? request.body.categories : []).map(String).filter((item) => allowed.has(item));
  const enabled = Boolean(request.body?.enabled);
  const [[account]] = await getPool().query("SELECT telegram_subject FROM users WHERE id = ?", [request.bookMeetUser.id]);
  if (enabled && !account?.telegram_subject) return response.status(409).json({ error: "Сначала подключите Telegram" });
  await getPool().query("UPDATE users SET telegram_notifications_enabled = ?, telegram_notification_categories = ? WHERE id = ?", [enabled ? 1 : 0, JSON.stringify(categories), request.bookMeetUser.id]);
  response.json({ enabled, categories });
}));

router.delete("/users/me/telegram", asyncRoute(async (request, response) => {
  await withTransaction(async (connection) => {
    await connection.query("UPDATE users SET telegram_subject = NULL, telegram_notifications_enabled = 0, telegram_notification_categories = NULL WHERE id = ?", [request.bookMeetUser.id]);
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
    await connection.query("DELETE FROM sessions WHERE token_hash = ?", [request.bookMeetUser.tokenHash]);
    return { token: await createSession(connection, targetId, request), targetId };
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
  realtimeClients.add(response);
  const heartbeat = setInterval(async () => {
    response.write(": keep-alive\n\n");
    try {
      await getPool().query("UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [request.bookMeetUser.id]);
      presenceTouches.set(request.bookMeetUser.id, Date.now());
    } catch { /* Следующий heartbeat повторит обновление присутствия. */ }
  }, 20_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    realtimeClients.delete(response);
  });
});

router.use((request, response, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    response.once("finish", () => {
      if (response.statusCode < 400) broadcastRealtime();
    });
  }
  next();
});

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
    await enqueueTelegramAlert(connection, { eventType: "event_pending", entityId: created.insertId, actorUserId: userId, summary: payload.title });
    await connection.query(
      `INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id)
       VALUES (?, ?, 'event_submitted', 'Событие на модерации', ?, 'event', ?)`,
      [userId, userId, `Событие «${payload.title}» отправлено на модерацию. Вы уже видите его на главной странице.`, created.insertId],
    );
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
  const [deleted] = await getPool().query(
    "DELETE FROM event_reminders WHERE user_id = ? AND event_id = ?",
    [userId, eventId],
  );
  if (!deleted.affectedRows) return response.status(404).json({ error: "Напоминание не найдено" });
  await getPool().query(
    "DELETE FROM notifications WHERE user_id = ? AND material_kind = 'event' AND material_id = ? AND notification_type = 'event_reminder'",
    [userId, eventId],
  );
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
    await connection.query("DELETE FROM notifications WHERE material_kind = 'event' AND material_id = ?", [eventId]);
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
        await connection.query(
          `INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id)
           VALUES (?, ?, 'event_moderation', ?, ?, 'event', ?)`,
          [current.creator_user_id, adminId, titles[action], bodies[action], eventId],
        );
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
    await enqueueTelegramAlert(connection, { eventType: "occasion_pending", entityId: created.insertId, actorUserId: userId, summary: payload.primaryText });
    await connection.query(
      `INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id)
       VALUES (?, ?, 'event_submitted', 'Повод на модерации', ?, 'occasion', ?)`,
      [userId, userId, "Повод для знакомства отправлен на модерацию. Вы уже видите его на главной странице.", created.insertId],
    );
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
    await connection.query("DELETE FROM notifications WHERE material_kind = 'occasion' AND material_id = ?", [occasionId]);
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
        await connection.query(
          `INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id)
           VALUES (?, ?, 'event_moderation', ?, ?, 'occasion', ?)`,
          [current.creator_user_id, adminId, titles[action], `${titles[action]}.${note ? ` Комментарий: ${note}` : ""}`, occasionId],
        );
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
    await connection.query(
      `INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body)
       VALUES (?, ?, 'event_moderation', ?, ?)`,
      [publisherId, adminId, titles[action], `${titles[action]}.${note ? ` Комментарий: ${note}` : ""}`],
    );
  });
  response.json({ ok: true });
}));

router.put("/users/me/state", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const { profile, avatarUrl, reviews = [], excerpts = [], publisherNews = [] } = request.body ?? {};
  const locale = requestLocale(request);
  const requestedUsernameValue = profile?.username ?? request.body?.username;
  const hasRequestedUsername = requestedUsernameValue !== undefined;
  const requestedUsername = normalizeUsername(requestedUsernameValue);
  const usernameError = hasRequestedUsername ? usernameValidationError(requestedUsername) : null;
  if (usernameError) return response.status(400).json({ code: usernameError, error: authText(locale, usernameError === "USERNAME_RESERVED" ? "usernameReserved" : "usernameInvalid") });
  const requestedType = profile?.type === "Писатель" ? "Писатель" : profile?.type === "Блогер" ? "Блогер" : profile?.type === "Издатель" ? "Издатель" : profile?.type === "Сообщество" ? "Сообщество" : "Читатель";
  const isOrganization = ["Издатель", "Сообщество"].includes(requestedType);
  if (!String(profile?.name ?? "").trim() || !Number(profile?.cityId)) return response.status(400).json({ error: "Заполните обязательные поля" });
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
  await withTransaction(async (connection) => {
    const city = await knownCity(connection, profile.city, profile.cityId);
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
    if (isPublisher) {
      const requiredPublisherFields = [
        profile.publisherWebsite, profile.bio, publisherLegal.name, publisherLegal.bin,
        publisherLegal.account, publisherLegal.bik, publisherLegal.bank,
        publisherLegal.legalAddress, publisherLegal.postalAddress,
      ];
      if (requiredPublisherFields.some((value) => !String(value ?? "").trim())) {
        throw Object.assign(new Error(`Заполните обязательные поля ${requestedType === "Сообщество" ? "сообщества" : "издательства"}`), { statusCode: 400 });
      }
    }
    if (isCommunity && [profile.communityType, profile.bio, profile.communityRules].some((value) => !String(value ?? "").trim())) {
      throw Object.assign(new Error("Заполните обязательные поля сообщества"), { statusCode: 400 });
    }
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
      `UPDATE profiles SET display_name = ?, city = ?, city_id = ?, profile_type = ?, gender = ?, birth_date = ?, show_birth_date_to_friends = ?, birth_date_visibility = ?, profile_tab_order = ?, hidden_profile_tabs = ?, home_view = ?, bio = ?, author_influences = ?, writing_themes = ?, weekend = ?, joy = ?, talk = ?, stranger_message = ?, favorite_genres = ?, disliked_genres = ?,
              publisher_status = ?, publisher_website = ?, publisher_sales_links = ?, publisher_legal_name = ?, publisher_bin = ?, publisher_account = ?, publisher_bik = ?, publisher_bank = ?, publisher_legal_address = ?, publisher_postal_address = ?,
              community_type = ?, community_rules = ?, community_is_closed = ?, publisher_moderation_note = CASE WHEN ? = 'pending' THEN NULL ELSE publisher_moderation_note END
        WHERE user_id = ?`,
      [
        profile.name.trim(), city?.name ?? "", city?.id ?? null, requestedType,
        isOrganization ? "Не указан" : ["Мужской", "Женский", "Не указан"].includes(profile.gender) ? profile.gender : "Не указан",
        birthDate || null,
        isOrganization ? 0 : (profile.birthDateVisibility ?? (profile.showBirthDateToFriends ? "friends" : "nobody")) === "friends" ? 1 : 0,
        isOrganization ? "nobody" : ["nobody", "friends", "everyone"].includes(profile.birthDateVisibility) ? profile.birthDateVisibility : profile.showBirthDateToFriends ? "friends" : "nobody",
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
        isCommunity ? String(profile.communityType).trim().slice(0, 255) : null,
        isCommunity ? String(profile.communityRules).trim() : null,
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
        } else if (publisherStatus === "approved") {
          const [created] = desiredId
            ? await connection.query("INSERT INTO publisher_news (id, user_id, title, preview_text, body_html, body, is_adult) VALUES (?, ?, ?, ?, ?, ?, ?)", [desiredId, userId, title, previewText, bodyHtml, body, item.isAdult ? 1 : 0])
            : await connection.query("INSERT INTO publisher_news (user_id, title, preview_text, body_html, body, is_adult) VALUES (?, ?, ?, ?, ?, ?)", [userId, title, previewText, bodyHtml, body, item.isAdult ? 1 : 0]);
          newsIds.push(desiredId || Number(created.insertId));
        }
      }
      if (newsIds.length) await connection.query(`DELETE FROM publisher_news WHERE user_id = ? AND id NOT IN (${newsIds.map(() => "?").join(",")})`, [userId, ...newsIds]);
      else if (publisherStatus === "approved") await connection.query("DELETE FROM publisher_news WHERE user_id = ?", [userId]);
    }
    if (requestedType === "Читатель" || requestedType === "Блогер") {
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
        await notifyWriterAboutBook(connection, book.id, userId, "review");
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
  const [rows] = await getPool().query(
    `SELECT b.id, b.creator_user_id AS creatorUserId, b.author, b.title, b.isbn, b.publisher, b.genres, b.annotation,
            b.is_adult AS isAdult, b.cover_path AS coverUrl, b.cover_tone AS coverTone, b.flip_url AS flipUrl,
            b.created_at AS addedAt, COUNT(DISTINCT CASE WHEN ub.is_author = 0 THEN ub.user_id END) AS popularity
       FROM books b
       LEFT JOIN user_books ub ON ub.book_id = b.id
      WHERE (? = 1 OR b.is_adult = 0)
      GROUP BY b.id
      ORDER BY b.title_key, b.author_key`,
    [adultViewer ? 1 : 0],
  );
  response.json({ books: rows.map((row) => ({ ...row, id: Number(row.id), creatorUserId: row.creatorUserId ? Number(row.creatorUserId) : undefined, isAdult: Boolean(row.isAdult), genres: JSON.parse(row.genres || "[]"), popularity: Number(row.popularity || 0), addedAt: new Date(row.addedAt).toISOString() })) });
}));

router.get("/books", asyncRoute(async (request, response) => {
  const query = String(request.query.q ?? "").trim();
  if (!query) return response.json({ books: [] });
  const tokens = [...new Set(query.normalize("NFKC").toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean))].slice(0, 8);
  if (!tokens.length) return response.json({ books: [] });
  const [[viewer]] = await getPool().query("SELECT u.role, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", [request.bookMeetUser.id]);
  const adultViewer = viewer?.role === "admin" || Number(ageFromBirthDate(viewer?.birth_date) ?? -1) >= 18;
  const tokenClauses = tokens.map(() => "LOWER(CONCAT_WS(' ', title, author, COALESCE(isbn, ''), COALESCE(publisher, ''))) LIKE ?").join(" AND ");
  const [rows] = await getPool().query(`SELECT id, author, title, isbn, publisher, genres, annotation, is_adult AS isAdult, cover_path AS coverUrl, cover_tone AS coverTone, flip_url AS flipUrl FROM books WHERE (? = 1 OR is_adult = 0) AND ${tokenClauses} ORDER BY updated_at DESC LIMIT 8`, [adultViewer ? 1 : 0, ...tokens.map((token) => `%${token}%`)]);
  response.json({ books: rows.map((row) => ({ ...row, id: Number(row.id), isAdult: Boolean(row.isAdult), genres: JSON.parse(row.genres || "[]") })) });
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
  const rating = Number(payload.rating);
  const readingStatus = ["want", "reading", "read"].includes(payload.readingStatus) ? payload.readingStatus : "read";
  const top3Specified = typeof payload.top3 === "boolean" || payload.topRank !== undefined;
  const top3Requested = payload.top3 === true || Number(payload.topRank) > 0;
  const readMonth = Number(payload.readMonth) || null;
  const readYear = Number(payload.readYear) || null;
  const lastReadChapter = readingStatus === "reading" && Number(payload.lastReadChapter) > 0 ? Math.floor(Number(payload.lastReadChapter)) : null;
  const readingComment = readingStatus === "reading" ? String(payload.readingComment ?? "").trim().slice(0, 3000) : null;
  if (!payload.isAuthor && ((readMonth && (readMonth < 1 || readMonth > 12)) || (readYear && (readYear < 1900 || readYear > new Date().getFullYear())))) {
    return response.status(400).json({ error: "Укажите корректную дату прочтения" });
  }
  if (!payload.isAuthor && readingStatus === "read" && (!Number.isInteger(rating * 2) || rating < 0.5 || rating > 5 || !String(payload.shortReview ?? "").trim())) {
    return response.status(400).json({ error: "Для книги в библиотеке обязательны оценка от 0,5 до 5 с шагом 0,5 и краткий отзыв" });
  }
  const authorKey = normalizeIdentity(author);
  const titleKey = normalizeIdentity(title);
  const result = await withTransaction(async (connection) => {
    await assertAdultMaterialAllowed(connection, userId, Boolean(payload.isAdult));
    const access = await publisherAccess(connection, userId);
    if (payload.isAuthor) {
      const [[profile]] = await connection.query("SELECT profile_type, publisher_status FROM profiles WHERE user_id = ?", [userId]);
      const canPublishBook = profile?.profile_type === "Писатель"
        || ["Издатель", "Сообщество"].includes(profile?.profile_type) && profile?.publisher_status === "approved";
      if (!canPublishBook) throw Object.assign(new Error("Добавлять книги могут только писатели и подтверждённые организации"), { statusCode: 403 });
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
    const [[existingUserBook]] = await connection.query("SELECT user_id, is_author, top_rank FROM user_books WHERE user_id = ? AND book_id = ? FOR UPDATE", [userId, bookId]);
    if (top3Requested && !top3Eligibility({ isAuthor: Boolean(payload.isAuthor || existingUserBook?.is_author), readingStatus }).allowed) {
      throw Object.assign(new Error("В TOP3 можно добавлять только прочитанные книги из своей библиотеки"), { statusCode: 400 });
    }
    await connection.query(
      `INSERT INTO user_books (user_id, book_id, rating, short_review, read_month, read_year, reading_status, last_read_chapter, reading_comment, is_author)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), short_review = VALUES(short_review), read_month = VALUES(read_month), read_year = VALUES(read_year), reading_status = VALUES(reading_status), last_read_chapter = VALUES(last_read_chapter), reading_comment = VALUES(reading_comment), is_author = VALUES(is_author)`,
      [userId, bookId, payload.isAuthor || readingStatus !== "read" ? null : rating, payload.isAuthor || readingStatus !== "read" ? null : String(payload.shortReview ?? "").trim(), payload.isAuthor || readingStatus !== "read" ? null : readMonth, payload.isAuthor || readingStatus !== "read" ? null : readYear, payload.isAuthor ? "read" : readingStatus, payload.isAuthor ? null : lastReadChapter, payload.isAuthor ? null : readingComment, payload.isAuthor ? 1 : 0],
    );
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
  response.status(201).json(result);
}));

router.delete("/books/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const bookId = Number(request.params.id);
  if (!bookId) return response.status(400).json({ error: "Некорректная книга" });
  await withTransaction(async (connection) => {
    const [[owned]] = await connection.query("SELECT is_author FROM user_books WHERE user_id = ? AND book_id = ? FOR UPDATE", [userId, bookId]);
    if (!owned) throw Object.assign(new Error("Книга не найдена в вашем профиле"), { statusCode: 404 });
    await connection.query("DELETE FROM user_books WHERE user_id = ? AND book_id = ?", [userId, bookId]);
    if (owned.is_author) {
      await connection.query("DELETE FROM book_links WHERE owner_user_id = ? AND book_id = ?", [userId, bookId]);
      await connection.query("UPDATE books SET creator_user_id = NULL WHERE id = ? AND creator_user_id = ?", [bookId, userId]);
    }
  });
  response.json({ ok: true });
}));

router.delete("/materials/:kind/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const kind = String(request.params.kind ?? "");
  const materialId = Number(request.params.id);
  const tables = { review: "reviews", excerpt: "excerpts" };
  const table = tables[kind];
  if (!table || !materialId) return response.status(400).json({ error: "Некорректный материал" });
  await withTransaction(async (connection) => {
    await connection.query("DELETE FROM material_books WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_likes WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_saves WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_comments WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM notifications WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    const [deleted] = await connection.query(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [materialId, userId]);
    if (!deleted.affectedRows) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
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
  const tables = { book: "books", review: "reviews", excerpt: "excerpts", event: "events", occasion: "occasions", publisher_news: "publisher_news" };
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
        await connection.query(`DELETE FROM notifications WHERE material_kind = 'review' AND material_id IN (${placeholders})`, reviewIds);
      }
      await connection.query("UPDATE wishlist_items SET catalog_book_id = NULL WHERE catalog_book_id = ?", [materialId]);
    }
    if (kind !== "book") {
      await connection.query("DELETE FROM material_books WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_likes WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    await connection.query("DELETE FROM material_saves WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
      await connection.query("DELETE FROM material_comments WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    }
    await connection.query("DELETE FROM notifications WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    const [deleted] = await connection.query(`DELETE FROM ${table} WHERE id = ?`, [materialId]);
    if (!deleted.affectedRows) throw Object.assign(new Error("Материал не найден"), { statusCode: 404 });
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
    if (profile?.profile_type !== "Читатель" && profile?.profile_type !== "Блогер") throw Object.assign(new Error("Список «Хочу почитать!» доступен профилям читателей и блогеров"), { statusCode: 403 });
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
    if (catalogBookId) await notifyWriterAboutBook(connection, catalogBookId, userId, "wishlist");
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
      await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id, group_key) VALUES (?, ?, 'gift_reserved', 'Подарок забронирован', ?, 'wishlist', ?, ?) ON DUPLICATE KEY UPDATE actor_user_id = VALUES(actor_user_id), body = VALUES(body), is_unread = 1, created_at = CURRENT_TIMESTAMP", [item.user_id, userId, `${actor?.display_name ?? "Друг"} забронировал(а) подарок «${item.title}».`, itemId, `gift-reserved:${itemId}`]);
    }
    return { checkoutUrl: item.product_url, reservedByUserId: userId };
  });
  response.json(result);
}));

router.delete("/wishlist/:id/reservation", asyncRoute(async (request, response) => {
  const [result] = await getPool().query("UPDATE wishlist_items SET reserved_by_user_id = NULL, reserved_at = NULL WHERE id = ? AND user_id = ?", [Number(request.params.id), request.bookMeetUser.id]);
  if (!result.affectedRows) return response.status(404).json({ error: "Карточка не найдена" });
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
    const target = await reportTarget(connection, targetKind, targetId);
    if (!target) throw Object.assign(new Error("Материал или пользователь не найден"), { statusCode: 404 });
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
    const tables = { book: "books", review: "reviews", excerpt: "excerpts", event: "events", occasion: "occasions", publisher_news: "publisher_news" };
    const table = tables[report.target_kind];
    if (!table) throw Object.assign(new Error("Жалоба не относится к материалу"), { statusCode: 400 });
    await connection.query("DELETE FROM material_likes WHERE material_kind = ? AND material_id = ?", [report.target_kind, report.target_id]);
    await connection.query("DELETE FROM material_saves WHERE material_kind = ? AND material_id = ?", [report.target_kind, report.target_id]);
    await connection.query("DELETE FROM material_comments WHERE material_kind = ? AND material_id = ?", [report.target_kind, report.target_id]);
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
        )`,
    [kind, id, request.bookMeetUser.id, request.bookMeetUser.id],
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
    await connection.query("INSERT IGNORE INTO material_likes (user_id, material_kind, material_id) VALUES (?, ?, ?)", [userId, kind, materialId]);
    const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
    const [[countRow]] = await connection.query("SELECT COUNT(*) AS total FROM material_likes WHERE material_kind = ? AND material_id = ?", [kind, materialId]);
    const total = Number(countRow.total);
    const text = total > 1 ? `${actor.display_name} и ещё ${total - 1} поставили «Нравится»: ${material.title}.` : `${actor.display_name} поставил(а) «Нравится»: ${material.title}.`;
    const groupKey = `like:${kind}:${materialId}`;
    await connection.query(
      `INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id, group_key)
       VALUES (?, ?, 'like', 'Нравится', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE actor_user_id = VALUES(actor_user_id), body = VALUES(body), is_unread = 1, created_at = CURRENT_TIMESTAMP`,
      [material.owner_id, userId, text, kind, materialId, groupKey],
    );
  });
  response.status(201).json({ ok: true });
}));

router.delete("/reactions", asyncRoute(async (request, response) => {
  const pool = getPool();
  await readableMaterialInfo(pool, request.bookMeetUser.id, String(request.body?.materialKind ?? ""), Number(request.body?.materialId));
  await pool.query("DELETE FROM material_likes WHERE user_id = ? AND material_kind = ? AND material_id = ?", [request.bookMeetUser.id, request.body?.materialKind, Number(request.body?.materialId)]);
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
  const [rows] = await pool.query(
    `SELECT mc.id, mc.user_id, mc.body, mc.created_at FROM material_comments mc
      WHERE mc.material_kind = ? AND mc.material_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
           WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = mc.user_id)
              OR (ub.blocker_user_id = mc.user_id AND ub.blocked_user_id = ?)
        )
      ORDER BY mc.created_at`,
    [kind, materialId, request.bookMeetUser.id, request.bookMeetUser.id],
  );
  response.json({ comments: rows.map((row) => ({ id: Number(row.id), userId: Number(row.user_id), text: row.body, createdAt: new Date(row.created_at).toISOString() })) });
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
      )
      GROUP BY material_kind, material_id, user_id`,
    [request.bookMeetUser.id, request.bookMeetUser.id],
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
  const savedMaterialRefs = [];
  const saveCounts = {};
  for (const row of saveRows) {
    const material = await getReadableMaterial(row.material_kind, row.material_id);
    if (material) savedMaterialRefs.push({ kind: row.material_kind, id: Number(row.material_id), createdAt: new Date(row.created_at).toISOString() });
  }
  for (const row of saveCountRows) {
    const key = `${row.material_kind}-${row.material_id}`;
    const material = await getReadableMaterial(row.material_kind, row.material_id);
    if (material) saveCounts[key] = Number(row.total);
  }
  response.json({ commenters, commentCounts, savedMaterialRefs, saveCounts });
}));

router.post("/comments", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const body = String(request.body?.body ?? "").trim();
  const kind = String(request.body?.materialKind ?? "");
  const materialId = Number(request.body?.materialId);
  if (!body) return response.status(400).json({ error: "Комментарий пуст" });
  const comment = await withTransaction(async (connection) => {
    const material = await interactableMaterialInfo(connection, userId, kind, materialId);
    const [created] = await connection.query("INSERT INTO material_comments (user_id, material_kind, material_id, body) VALUES (?, ?, ?, ?)", [userId, kind, materialId, body]);
    if (Number(material.owner_id) !== userId) {
      const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
      await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id) VALUES (?, ?, 'comment', 'Новый комментарий', ?, ?, ?)", [material.owner_id, userId, `${actor.display_name} прокомментировал(а) материал «${material.title}»: ${body}`, kind, materialId]);
    }
    return { id: Number(created.insertId), userId, text: body, createdAt: new Date().toISOString() };
  });
  response.status(201).json({ comment });
}));

router.delete("/comments/:id", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const commentId = Number(request.params.id);
  if (!commentId) return response.status(400).json({ error: "Некорректный комментарий" });
  await withTransaction(async (connection) => {
    const [[comment]] = await connection.query("SELECT user_id FROM material_comments WHERE id = ? FOR UPDATE", [commentId]);
    if (!comment) throw Object.assign(new Error("Комментарий не найден"), { statusCode: 404 });
    if (Number(comment.user_id) !== userId && !(await isAdmin(connection, userId))) {
      throw Object.assign(new Error("Удалить комментарий может только его автор или администратор"), { statusCode: 403 });
    }
    await connection.query("DELETE FROM material_comments WHERE id = ?", [commentId]);
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
      await connection.query("DELETE FROM notifications WHERE user_id = ? AND actor_user_id = ? AND notification_type = 'friend_request'", [targetId, userId]);
      const [created] = await connection.query("INSERT IGNORE INTO community_memberships (community_user_id, member_user_id) VALUES (?, ?)", [targetId, userId]);
      if (created.affectedRows) {
        const systemText = "Вы стали участником открытого сообщества и можете начать переписку";
        await connection.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, is_system) VALUES (?, ?, ?, 1), (?, ?, ?, 1)", [userId, targetId, systemText, targetId, userId, systemText]);
        await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body) VALUES (?, ?, 'friendship_started', ?, ?), (?, ?, 'friendship_started', ?, ?)", [targetId, userId, "Новый участник", `${source.display_name} присоединился(ась) к открытому сообществу.`, userId, targetId, "Вы вступили в сообщество", systemText]);
      }
      return;
    }
    const [[pending]] = await connection.query("SELECT id FROM friend_requests WHERE status = 'pending' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) LIMIT 1", [userId, targetId, targetId, userId]);
    if (pending) throw Object.assign(new Error(membership ? "Заявка на вступление уже отправлена" : "Предложение уже отправлено"), { statusCode: 409 });
    await connection.query("INSERT INTO friend_requests (from_user_id, to_user_id, message) VALUES (?, ?, ?)", [userId, targetId, message || null]);
    await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body) VALUES (?, ?, 'friend_request', ?, ?)", [targetId, userId, membership ? "Новая заявка" : "Новый друг", membership ? `${source.display_name} хочет присоединиться к сообществу.` : `${source.display_name} хочет добавить вас в друзья.`]);
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
  });
  response.json({ ok: true });
}));

router.post("/social/friends/:targetId/accept", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  await withTransaction(async (connection) => {
    const [profiles] = await connection.query("SELECT user_id, profile_type FROM profiles WHERE user_id IN (?, ?) ORDER BY user_id FOR UPDATE", [userId, targetId]);
    const currentProfile = profiles.find((item) => Number(item.user_id) === userId);
    const sourceProfile = profiles.find((item) => Number(item.user_id) === targetId);
    const membership = currentProfile?.profile_type === "Сообщество";
    await assertUsersCanInteract(connection, userId, targetId);
    if (!membership) await assertAgeCompatible(connection, userId, targetId);
    if (!canCreateFriendRequest(currentProfile?.profile_type, sourceProfile?.profile_type, { communityMembership: membership })) throw Object.assign(new Error("Издательствам недоступны запросы дружбы"), { statusCode: 403 });
    if (sourceProfile?.profile_type === "Сообщество") throw Object.assign(new Error("Сообщество не может отправлять запросы дружбы"), { statusCode: 403 });
    const [updated] = await connection.query("UPDATE friend_requests SET status = 'accepted' WHERE status = 'pending' AND from_user_id = ? AND to_user_id = ?", [targetId, userId]);
    if (!updated.affectedRows) throw Object.assign(new Error("Предложение дружбы не найдено"), { statusCode: 404 });
    const low = Math.min(userId, targetId); const high = Math.max(userId, targetId);
    if (membership) {
      await connection.query("INSERT IGNORE INTO community_memberships (community_user_id, member_user_id) VALUES (?, ?)", [userId, targetId]);
    } else {
      await connection.query("INSERT IGNORE INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [low, high]);
      await connection.query("INSERT IGNORE INTO follows (follower_user_id, target_user_id) VALUES (?, ?), (?, ?)", [userId, targetId, targetId, userId]);
    }
    const systemText = membership ? "Заявка принята. Теперь вы участник сообщества и можете начать переписку" : "Теперь вы друзья и можете начать переписку";
    await connection.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, is_system) VALUES (?, ?, ?, 1), (?, ?, ?, 1)", [targetId, userId, systemText, userId, targetId, systemText]);
    const title = membership ? "Заявка принята" : "Теперь вы друзья";
    await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body) VALUES (?, ?, 'friendship_started', ?, ?), (?, ?, 'friendship_started', ?, ?)", [userId, targetId, title, systemText, targetId, userId, title, systemText]);
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
    const [updated] = await connection.query("UPDATE friend_requests SET status = 'rejected', rejection_comment = ? WHERE status = 'pending' AND from_user_id = ? AND to_user_id = ?", [comment || null, targetId, userId]);
    if (!updated.affectedRows) throw Object.assign(new Error("Предложение дружбы не найдено"), { statusCode: 404 });
    const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
    const text = membership ? `${actor.display_name} отклонило заявку на вступление.${comment ? ` Комментарий: ${comment}` : ""}` : `${actor.display_name} отклонил(а) предложение дружбы.${comment ? ` Комментарий: ${comment}` : ""} Вы можете подписаться на пользователя и следить за обновлениями.`;
    await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body) VALUES (?, ?, 'friend_rejected', ?, ?)", [targetId, userId, membership ? "Заявка отклонена" : "Предложение дружбы отклонено", text]);
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
    if (membership) {
      const communityId = actor?.profile_type === "Сообщество" ? userId : targetId;
      const memberId = communityId === userId ? targetId : userId;
      await connection.query("DELETE FROM community_memberships WHERE community_user_id = ? AND member_user_id = ?", [communityId, memberId]);
    } else {
      const low = Math.min(userId, targetId); const high = Math.max(userId, targetId);
      await connection.query("DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
    }
    await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body) VALUES (?, ?, 'friendship_ended', ?, ?)", [targetId, userId, membership ? "Участие завершено" : "Дружба завершена", membership ? `${actor.display_name} завершило участие в сообществе.` : `${actor.display_name} перестал(а) дружить с вами.`]);
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
      await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body) VALUES (?, ?, 'new_follower', 'Новый подписчик', ?)", [targetId, userId, `${actor.display_name} подписался(ась) на ваши обновления.`]);
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
  });
  response.json({ ok: true });
}));

router.post("/social/messages", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.body?.targetId);
  const body = String(request.body?.body ?? "").trim().slice(0, 5000);
  if (!targetId || (!body && !request.body?.attachment)) return response.status(400).json({ error: "Сообщение пусто" });
  const low = Math.min(userId, targetId); const high = Math.max(userId, targetId);
  const createdMessage = await withTransaction(async (connection) => {
    await assertUsersCanInteract(connection, userId, targetId);
    const [[friendship]] = await connection.query("SELECT 1 FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [low, high]);
    const [[membership]] = await connection.query("SELECT 1 FROM community_memberships WHERE (community_user_id = ? AND member_user_id = ?) OR (community_user_id = ? AND member_user_id = ?)", [userId, targetId, targetId, userId]);
    const [participants] = await connection.query("SELECT u.id, u.role, p.profile_type FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id IN (?, ?)", [userId, targetId]);
    const hasAdmin = participants.some((participant) => participant.role === "admin");
    const [firstParticipant, secondParticipant] = participants;
    if (!membership && !hasAdmin) await assertAgeCompatible(connection, userId, targetId);
    if (!canMessagePair({ friends: Boolean(friendship), communityMembers: Boolean(membership), hasAdmin, firstProfileType: firstParticipant?.profile_type, secondProfileType: secondParticipant?.profile_type })) throw Object.assign(new Error("Переписка доступна только друзьям, участникам сообщества, издательствам и службе поддержки"), { statusCode: 403 });
    const attachment = await validatedChatAttachment(connection, request.body?.attachment, userId, targetId);
    const [created] = await connection.query("INSERT INTO messages (sender_user_id, recipient_user_id, body, attachment_kind, attachment_id) VALUES (?, ?, ?, ?, ?)", [userId, targetId, body, attachment?.kind ?? null, attachment?.id ?? null]);
    if (shouldEnqueueSupportAlert(participants, userId, targetId)) {
      await enqueueTelegramAlert(connection, { eventType: "support_message", entityId: created.insertId, actorUserId: userId, summary: "Новое сообщение пользователя" });
    }
    const [[actor]] = await connection.query("SELECT display_name FROM profiles WHERE user_id = ?", [userId]);
    const notificationPreview = body || "Поделился(ась) материалом";
    await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, group_key) VALUES (?, ?, 'new_message', 'Новое сообщение', ?, ?) ON DUPLICATE KEY UPDATE actor_user_id = VALUES(actor_user_id), body = VALUES(body), is_unread = 1, created_at = CURRENT_TIMESTAMP", [targetId, userId, `${actor.display_name}: ${notificationPreview}`, `message:${userId}`]);
    return { id: Number(created.insertId), createdAt: new Date().toISOString(), attachment };
  });
  response.status(201).json({ ok: true, message: { ...createdMessage, senderId: userId, mine: true, text: body, read: false } });
}));

router.patch("/social/messages/:targetId/read", asyncRoute(async (request, response) => {
  const userId = request.bookMeetUser.id;
  const targetId = Number(request.params.targetId);
  await withTransaction(async (connection) => {
    await connection.query("UPDATE messages SET read_at = UTC_TIMESTAMP() WHERE sender_user_id = ? AND recipient_user_id = ? AND read_at IS NULL", [targetId, userId]);
    await connection.query("UPDATE notifications SET is_unread = 0 WHERE user_id = ? AND actor_user_id = ? AND notification_type = 'new_message'", [userId, targetId]);
  });
  response.json({ ok: true });
}));

router.patch("/notifications/read-all", asyncRoute(async (request, response) => {
  await getPool().query("UPDATE notifications SET is_unread = 0 WHERE user_id = ?", [request.bookMeetUser.id]);
  response.json({ ok: true });
}));

router.patch("/notifications/:id/read", asyncRoute(async (request, response) => {
  await getPool().query("UPDATE notifications SET is_unread = 0 WHERE id = ? AND user_id = ?", [Number(request.params.id), request.bookMeetUser.id]);
  response.json({ ok: true });
}));

export default router;
