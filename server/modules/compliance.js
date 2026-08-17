import { createHmac } from "node:crypto";
function ageFromBirthDate(value, now = new Date()) {
  if (!value) return null;
  const normalized = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const birth = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth > now) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed = now.getUTCMonth() > birth.getUTCMonth()
    || now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate();
  if (!birthdayPassed) age -= 1;
  return age;
}

export const LEGAL_DOCUMENT_TYPES = ["user_agreement", "privacy_policy", "personal_data_consent"];
export const REPORT_TARGET_KINDS = new Set(["user", "book", "review", "excerpt", "event", "occasion", "publisher_news", "chat", "comment", "partner", "admin_action", "interface"]);
export const REPORT_STATUSES = new Set(["new", "reviewing", "satisfied", "rejected"]);

export function legalConsentRequired(environment = process.env) {
  const value = String(environment.LEGAL_CONSENT_REQUIRED ?? "1").trim().toLocaleLowerCase("en");
  return !["0", "false", "off", "no"].includes(value);
}

export function metadataHash(value) {
  const secret = process.env.AUDIT_HASH_SECRET || (process.env.NODE_ENV === "production" ? "" : "book-meet-development-only");
  if (!secret) throw new Error("AUDIT_HASH_SECRET is required");
  return value ? createHmac("sha256", secret).update(String(value)).digest("hex") : null;
}

export function requestAuditMetadata(request) {
  return {
    ipHash: metadataHash(request.ip || request.socket?.remoteAddress || ""),
    userAgentHash: metadataHash(request.headers?.["user-agent"] || ""),
  };
}

export async function logSecurityEvent(connection, request, { userId = null, eventType, result, details = null }) {
  const { ipHash, userAgentHash } = requestAuditMetadata(request);
  await connection.query(
    "INSERT INTO security_event_log (user_id, event_type, result, ip_hash, user_agent_hash, details) VALUES (?, ?, ?, ?, ?, ?)",
    [userId || null, String(eventType).slice(0, 80), String(result).slice(0, 32), ipHash, userAgentHash, details ? String(details).slice(0, 5000) : null],
  );
}

export async function logModerationAction(connection, { adminUserId, actionType, objectType, objectId = null, oldStatus = null, newStatus = null, reason = null, reportId = null }) {
  await connection.query(
    `INSERT INTO moderation_audit_log
       (admin_user_id, action_type, object_type, object_id, old_status, new_status, reason, report_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [adminUserId || null, String(actionType).slice(0, 80), String(objectType).slice(0, 40), objectId || null, oldStatus || null, newStatus || null, reason || null, reportId || null],
  );
}

export async function activeLegalDocuments(connection, locale = "ru") {
  const language = ["ru", "kk", "en"].includes(locale) ? locale : "ru";
  const [rows] = await connection.query(
    `SELECT id, document_type, version, language_code, title, content, file_name, requires_reacceptance, published_at
       FROM legal_documents
      WHERE is_active = 1 AND language_code IN (?, 'ru')
      ORDER BY document_type, language_code = ? DESC, published_at DESC, id DESC`,
    [language, language],
  );
  const selected = new Map();
  for (const row of rows) if (!selected.has(row.document_type)) selected.set(row.document_type, row);
  return LEGAL_DOCUMENT_TYPES.map((type) => selected.get(type)).filter(Boolean).map((row) => ({
    id: Number(row.id),
    type: row.document_type,
    version: row.version,
    language: row.language_code,
    title: row.title,
    content: row.content,
    fileName: row.file_name ?? undefined,
    requiresReacceptance: Boolean(row.requires_reacceptance),
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
  }));
}

export async function requiredLegalDocuments(connection, locale = "ru") {
  const documents = await activeLegalDocuments(connection, locale);
  if (documents.length !== LEGAL_DOCUMENT_TYPES.length) {
    throw Object.assign(new Error("Юридические документы ещё не опубликованы администратором"), { statusCode: 503, code: "LEGAL_DOCUMENTS_NOT_CONFIGURED" });
  }
  return documents;
}

export async function validateLegalAcceptance(connection, payload, locale = "ru", environment = process.env) {
  if (!legalConsentRequired(environment)) return [];
  const documents = await requiredLegalDocuments(connection, locale);
  const ids = new Set((Array.isArray(payload?.documentIds) ? payload.documentIds : []).map(Number));
  if (!payload?.agreementAccepted || !payload?.personalDataAccepted || documents.some((document) => !ids.has(document.id))) {
    throw Object.assign(new Error("Для регистрации необходимо принять пользовательское соглашение и согласие на обработку персональных данных"), { statusCode: 400, code: "LEGAL_ACCEPTANCE_REQUIRED" });
  }
  return documents;
}

export async function recordLegalAcceptances(connection, userId, documents) {
  for (const document of documents) {
    await connection.query(
      `INSERT IGNORE INTO legal_acceptances
         (user_id, document_id, document_type, document_version, language_code, accepted_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [userId, document.id, document.type, document.version, document.language],
    );
  }
}

export async function legalAccessState(connection, userId, locale = "ru", environment = process.env) {
  const documents = await activeLegalDocuments(connection, locale);
  if (!legalConsentRequired(environment)) return { configured: documents.length === LEGAL_DOCUMENT_TYPES.length, pending: [], documents };
  if (!documents.length) return { configured: false, pending: [] };
  const [acceptedRows] = await connection.query("SELECT document_id FROM legal_acceptances WHERE user_id = ?", [userId]);
  const accepted = new Set(acceptedRows.map((row) => Number(row.document_id)));
  const pending = documents.filter((document) => document.requiresReacceptance && !accepted.has(document.id));
  return { configured: documents.length === LEGAL_DOCUMENT_TYPES.length, pending, documents };
}

export async function profileAccessState(connection, userId) {
  const [[row]] = await connection.query(
    `SELECT u.role, p.profile_type, p.display_name, p.city, p.city_id, p.birth_date
       FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE u.id = ? LIMIT 1`,
    [userId],
  );
  if (!row) return { complete: false, missing: ["profile"] };
  if (row.role === "admin") return { complete: true, missing: [] };
  const missing = [];
  if (!String(row.display_name ?? "").trim() || row.display_name === "Удалённый пользователь") missing.push("name");
  if (!String(row.city ?? "").trim() && !row.city_id) missing.push("city");
  if (!["Издатель", "Сообщество"].includes(row.profile_type) && ageFromBirthDate(row.birth_date) === null) missing.push("birthDate");
  return { complete: missing.length === 0, missing };
}

export async function assertAgeCompatible(connection, firstUserId, secondUserId) {
  const [rows] = await connection.query(
    `SELECT u.id, u.role, p.profile_type, p.birth_date
       FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE u.id IN (?, ?) ORDER BY u.id FOR UPDATE`,
    [firstUserId, secondUserId],
  );
  if (rows.length !== 2 || rows.some((row) => row.role === "admin" || row.profile_type === "Сообщество")) return;
  const ages = rows.map((row) => row.profile_type === "Издатель" ? 18 : ageFromBirthDate(row.birth_date));
  if (ages.some((age) => age === null)) {
    throw Object.assign(new Error("Для взаимодействия оба пользователя должны указать дату рождения"), { statusCode: 403, code: "AGE_REQUIRED" });
  }
  if ((ages[0] < 18) !== (ages[1] < 18)) {
    throw Object.assign(new Error("Прямое взаимодействие между совершеннолетними и несовершеннолетними пользователями недоступно"), { statusCode: 403, code: "CROSS_AGE_INTERACTION_FORBIDDEN" });
  }
}

export async function removeCrossAgeRelationships(connection) {
  const [friendships] = await connection.query(
    `SELECT f.user_low_id, f.user_high_id
       FROM friendships f
       JOIN profiles low_profile ON low_profile.user_id = f.user_low_id
       JOIN profiles high_profile ON high_profile.user_id = f.user_high_id
      WHERE low_profile.birth_date IS NULL OR high_profile.birth_date IS NULL
         OR (TIMESTAMPDIFF(YEAR, low_profile.birth_date, UTC_DATE()) < 18) <> (TIMESTAMPDIFF(YEAR, high_profile.birth_date, UTC_DATE()) < 18)`,
  );
  for (const row of friendships) {
    await connection.query("DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [row.user_low_id, row.user_high_id]);
    await connection.query("DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)", [row.user_low_id, row.user_high_id, row.user_high_id, row.user_low_id]);
  }
  return friendships.length;
}
