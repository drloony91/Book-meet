import { Router } from "express";
import { LoginAttemptTracker } from "./login-attempts.js";
import { assertMarketplaceAdult, marketplaceAdultBirthDateCutoff } from "./marketplace-listings.js";
import { marketplaceEnabled } from "./marketplace-feature.js";

const WARNING = "Book Meet не принимает оплату и не участвует в сделке. Не переводите предоплату незнакомым людям и выбирайте безопасное место встречи.";
const trackers = new Map();

function fail(statusCode, code, message) { return Object.assign(new Error(message), { statusCode, code }); }
function id(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw fail(400, "INVALID_MARKETPLACE_ID", "Некорректный идентификатор");
  return parsed;
}
function messageBody(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 4000) throw fail(422, "INVALID_MARKETPLACE_MESSAGE", "Введите сообщение длиной до 4000 символов");
  return value.trim();
}
function rateLimit(limit, label) {
  return (request, response, next) => {
    const tracker = trackers.get(label) ?? new LoginAttemptTracker({ limit, windowMs: 60 * 60_000 });
    trackers.set(label, tracker);
    const userId = Number(request.bookMeetUser.id);
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    const state = tracker.state([`marketplace:${label}:ip:${ip}`, `marketplace:${label}:user:${userId}`]);
    if (state.blocked) {
      response.setHeader("Retry-After", String(state.retryAfterSeconds));
      return response.status(429).json({ code: "MARKETPLACE_RATE_LIMITED", error: "Слишком много действий. Попробуйте позже" });
    }
    state.fail();
    return next();
  };
}
function card(row) {
  if (["removed", "closed"].includes(row.status) || !row.seller_user_id) return { id: Number(row.marketplace_listing_id), unavailable: true, label: "Объявление недоступно" };
  return {
    id: Number(row.marketplace_listing_id), unavailable: false,
    title: row.book_title, author: row.book_author, type: row.listing_type,
    cityName: row.city_name, price: row.price_amount == null ? null : Number(row.price_amount),
    currency: row.price_currency, status: row.status,
  };
}
function dto(row, viewerId) {
  return {
    id: Number(row.id), buyerId: Number(row.marketplace_buyer_user_id), sellerId: Number(row.seller_user_id),
    mine: Number(row.marketplace_buyer_user_id) === viewerId ? "buyer" : "seller",
    listing: card(row), safetyWarning: WARNING, createdAt: new Date(row.created_at).toISOString(),
  };
}
const conversationSelect = `SELECT c.id, c.marketplace_listing_id, c.marketplace_buyer_user_id, c.marketplace_buyer_reference_id, c.state, c.created_at,
  l.seller_user_id, l.book_title, l.book_author, l.listing_type, l.city_name, l.price_amount, l.price_currency, l.status
  FROM conversations c JOIN marketplace_listings l ON l.id = c.marketplace_listing_id`;

async function blocked(connection, buyerId, sellerId, { lock = false } = {}) {
  const [[row]] = await connection.query(`SELECT 1 AS blocked FROM user_blocks WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1${lock ? " FOR UPDATE" : ""}`, [buyerId, sellerId, sellerId, buyerId]);
  return Boolean(row);
}

async function assertConversation(connection, conversationId, viewerId, { lock = false, ageFromBirthDate } = {}) {
  const [[row]] = await connection.query(`${conversationSelect} WHERE c.id = ? AND c.conversation_type = 'marketplace' AND c.state = 'active'${lock ? " FOR UPDATE" : ""}`, [conversationId]);
  if (!row || !row.seller_user_id || !row.marketplace_buyer_user_id || ![Number(row.seller_user_id), Number(row.marketplace_buyer_user_id)].includes(viewerId)) throw fail(404, "MARKETPLACE_CONVERSATION_NOT_FOUND", "Диалог не найден");
  const [[member]] = await connection.query("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL", [conversationId, viewerId]);
  if (!member || await blocked(connection, Number(row.marketplace_buyer_user_id), Number(row.seller_user_id), { lock })) throw fail(404, "MARKETPLACE_CONVERSATION_NOT_FOUND", "Диалог не найден");
  const otherUserId = viewerId === Number(row.seller_user_id) ? Number(row.marketplace_buyer_user_id) : Number(row.seller_user_id);
  try { await assertMarketplaceAdult(connection, otherUserId, ageFromBirthDate); }
  catch (error) {
    if (error.code === "MARKETPLACE_ADULTS_ONLY") throw fail(404, "MARKETPLACE_CONVERSATION_NOT_FOUND", "Диалог не найден");
    throw error;
  }
  const [[sellerReply]] = await connection.query(`SELECT id FROM messages WHERE conversation_id = ? AND sender_user_id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [conversationId, row.seller_user_id]);
  if (["removed", "closed"].includes(row.status) && viewerId === Number(row.marketplace_buyer_user_id) && !sellerReply) throw fail(404, "MARKETPLACE_CONVERSATION_NOT_FOUND", "Диалог не найден");
  return { row, sellerReplied: Boolean(sellerReply) };
}

export function createMarketplaceConversationsRouter({ getPool, withTransaction, asyncRoute, ageFromBirthDate, queueChatRealtime }) {
  const router = Router();
  router.use("/marketplace", (_request, response, next) => marketplaceEnabled() ? next() : response.status(404).json({ error: "Не найдено" }));

  router.get("/marketplace/conversations", rateLimit(240, "conversation-read"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const pool = getPool();
    await assertMarketplaceAdult(pool, userId, ageFromBirthDate);
    const [rows] = await pool.query(`${conversationSelect}
      JOIN users seller_account ON seller_account.id = l.seller_user_id AND seller_account.deleted_at IS NULL AND seller_account.purged_at IS NULL
      JOIN profiles seller_profile ON seller_profile.user_id = seller_account.id AND seller_profile.profile_type IN ('Читатель', 'Писатель', 'Блогер') AND seller_profile.birth_date <= ?
      JOIN users buyer_account ON buyer_account.id = c.marketplace_buyer_user_id AND buyer_account.deleted_at IS NULL AND buyer_account.purged_at IS NULL
      JOIN profiles buyer_profile ON buyer_profile.user_id = buyer_account.id AND buyer_profile.profile_type IN ('Читатель', 'Писатель', 'Блогер') AND buyer_profile.birth_date <= ?
      JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ? AND cm.left_at IS NULL
      LEFT JOIN marketplace_conversation_hidden hidden ON hidden.conversation_id = c.id AND hidden.user_id = ?
      WHERE c.conversation_type = 'marketplace' AND c.state = 'active' AND hidden.conversation_id IS NULL
        AND l.seller_user_id IS NOT NULL AND c.marketplace_buyer_user_id IS NOT NULL
        AND (l.seller_user_id = ? OR c.marketplace_buyer_user_id = ?)
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
          (b.blocker_user_id = l.seller_user_id AND b.blocked_user_id = c.marketplace_buyer_user_id)
          OR (b.blocker_user_id = c.marketplace_buyer_user_id AND b.blocked_user_id = l.seller_user_id))
        AND (l.status NOT IN ('removed', 'closed') OR l.seller_user_id = ? OR EXISTS
          (SELECT 1 FROM messages reply WHERE reply.conversation_id = c.id AND reply.sender_user_id = l.seller_user_id))
      ORDER BY c.updated_at DESC, c.id DESC LIMIT 100`, [marketplaceAdultBirthDateCutoff(), marketplaceAdultBirthDateCutoff(), userId, userId, userId, userId, userId]);
    response.json({ conversations: rows.map((row) => dto(row, userId)) });
  }));

  router.post("/marketplace/listings/:listingId/conversations", rateLimit(12, "conversation-create"), asyncRoute(async (request, response) => {
    const buyerId = Number(request.bookMeetUser.id); const listingId = id(request.params.listingId);
    const result = await withTransaction(async (connection) => {
      await assertMarketplaceAdult(connection, buyerId, ageFromBirthDate);
      const [[listing]] = await connection.query("SELECT l.id, l.seller_user_id, l.status FROM marketplace_listings l WHERE l.id = ? FOR UPDATE", [listingId]);
      if (!listing || listing.status !== "active" || !listing.seller_user_id || Number(listing.seller_user_id) === buyerId) throw fail(404, "MARKETPLACE_LISTING_NOT_FOUND", "Объявление не найдено");
      const sellerId = Number(listing.seller_user_id);
      await assertMarketplaceAdult(connection, sellerId, ageFromBirthDate);
      if (await blocked(connection, buyerId, sellerId, { lock: true })) throw fail(404, "MARKETPLACE_LISTING_NOT_FOUND", "Объявление не найдено");
      const [[existing]] = await connection.query("SELECT id FROM conversations WHERE conversation_type = 'marketplace' AND marketplace_listing_id = ? AND marketplace_buyer_reference_id = ? FOR UPDATE", [listingId, buyerId]);
      let conversationId = Number(existing?.id);
      if (!conversationId) {
        const [created] = await connection.query("INSERT INTO conversations (conversation_type, marketplace_listing_id, marketplace_buyer_user_id, marketplace_buyer_reference_id, created_actor_type, created_actor_id, created_by_user_id) VALUES ('marketplace', ?, ?, ?, 'user', ?, ?)", [listingId, buyerId, buyerId, buyerId, buyerId]);
        conversationId = Number(created.insertId);
        await connection.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)", [conversationId, buyerId, conversationId, sellerId]);
      }
      await connection.query("DELETE FROM marketplace_conversation_hidden WHERE conversation_id = ? AND user_id = ?", [conversationId, buyerId]);
      const [[row]] = await connection.query(`${conversationSelect} WHERE c.id = ?`, [conversationId]);
      return { conversationId, sellerId, conversation: dto(row, buyerId), created: !existing };
    });
    if (result.created) queueChatRealtime(response, [buyerId, result.sellerId], { type: "marketplace.conversation.created", conversationId: result.conversationId, listingId });
    response.status(result.created ? 201 : 200).json({ conversation: result.conversation });
  }));

  router.get("/marketplace/conversations/:conversationId", rateLimit(240, "conversation-read"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const conversationId = id(request.params.conversationId); const pool = getPool();
    await assertMarketplaceAdult(pool, userId, ageFromBirthDate);
    const { row } = await assertConversation(pool, conversationId, userId, { ageFromBirthDate });
    response.json({ conversation: dto(row, userId) });
  }));

  router.get("/marketplace/conversations/:conversationId/messages", rateLimit(240, "conversation-read"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const conversationId = id(request.params.conversationId); const pool = getPool();
    await assertMarketplaceAdult(pool, userId, ageFromBirthDate);
    await assertConversation(pool, conversationId, userId, { ageFromBirthDate });
    const before = request.query.beforeId == null ? null : id(request.query.beforeId);
    const [page] = await pool.query("SELECT id, sender_user_id, body, created_at FROM messages WHERE conversation_id = ? AND deleted_before_read = 0 AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT 51", [conversationId, before, before]);
    const rows = page.slice(0, 50);
    response.json({ messages: rows.reverse().map((row) => ({ id: Number(row.id), senderId: row.sender_user_id == null ? null : Number(row.sender_user_id), mine: Number(row.sender_user_id) === userId, body: row.body, createdAt: new Date(row.created_at).toISOString() })), nextBeforeId: page.length > 50 ? Number(rows[0].id) : null });
  }));

  router.post("/marketplace/conversations/:conversationId/messages", rateLimit(120, "conversation-message"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const conversationId = id(request.params.conversationId); const body = messageBody(request.body?.body);
    const result = await withTransaction(async (connection) => {
      await assertMarketplaceAdult(connection, userId, ageFromBirthDate);
      const { row, sellerReplied } = await assertConversation(connection, conversationId, userId, { lock: true, ageFromBirthDate });
      if (!["active", "reserved"].includes(row.status)) throw fail(409, "MARKETPLACE_LISTING_UNAVAILABLE", "Объявление больше не принимает сообщения");
      const sellerId = Number(row.seller_user_id); const buyerId = Number(row.marketplace_buyer_user_id);
      await assertMarketplaceAdult(connection, userId === buyerId ? sellerId : buyerId, ageFromBirthDate);
      if (userId === buyerId && !sellerReplied) {
        // A locking read sees rows committed by a sender that held this
        // conversation lock immediately before us, even under REPEATABLE READ.
        const [firstMessages] = await connection.query("SELECT id FROM messages WHERE conversation_id = ? AND sender_user_id = ? FOR UPDATE", [conversationId, buyerId]);
        if (firstMessages.length >= 3) throw fail(429, "MARKETPLACE_FIRST_MESSAGE_LIMIT", "До ответа продавца можно отправить не более трёх сообщений");
      }
      const recipientId = userId === buyerId ? sellerId : buyerId;
      const [created] = await connection.query("INSERT INTO messages (conversation_id, sender_user_id, recipient_user_id, body) VALUES (?, ?, ?, ?)", [conversationId, userId, recipientId, body]);
      await connection.query("DELETE FROM marketplace_conversation_hidden WHERE conversation_id = ? AND user_id IN (?, ?)", [conversationId, buyerId, sellerId]);
      await connection.query("UPDATE conversations SET updated_at = UTC_TIMESTAMP() WHERE id = ?", [conversationId]);
      const [[saved]] = await connection.query("SELECT created_at FROM messages WHERE id = ?", [created.insertId]);
      return { recipients: [buyerId, sellerId], message: { id: Number(created.insertId), senderId: userId, mine: true, body, createdAt: new Date(saved.created_at).toISOString() } };
    });
    queueChatRealtime(response, result.recipients, { type: "marketplace.message.created", conversationId, messageId: result.message.id });
    response.status(201).json({ message: result.message });
  }));

  router.delete("/marketplace/conversations/:conversationId", rateLimit(20, "conversation-hide"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const conversationId = id(request.params.conversationId);
    await withTransaction(async (connection) => {
      await assertMarketplaceAdult(connection, userId, ageFromBirthDate);
      await assertConversation(connection, conversationId, userId, { lock: true, ageFromBirthDate });
      await connection.query("INSERT IGNORE INTO marketplace_conversation_hidden (conversation_id, user_id) VALUES (?, ?)", [conversationId, userId]);
    });
    response.json({ ok: true });
  }));
  return router;
}
