import { Router } from "express";

function fail(statusCode, code, message) { return Object.assign(new Error(message), { statusCode, code }); }
function id(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw fail(400, "INVALID_MARKETPLACE_ID", "Некорректный идентификатор");
  return parsed;
}
function reason(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2000) throw fail(400, "MARKETPLACE_MODERATION_REASON_REQUIRED", "Укажите причину длиной до 2000 символов");
  return value.trim();
}
function until(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d{1,3})?Z$/.test(value)) throw fail(400, "INVALID_MARKETPLACE_RESTRICTION_UNTIL", "Укажите дату окончания в UTC");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || date.getTime() > Date.now() + 366 * 24 * 60 * 60_000) throw fail(400, "INVALID_MARKETPLACE_RESTRICTION_UNTIL", "Дата окончания должна быть в пределах года");
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function createMarketplaceModerationRouter({ getPool, withTransaction, asyncRoute, isAdmin, logModerationAction, queueChatRealtime }) {
  const router = Router();

  router.get("/admin/marketplace/sellers/:sellerId/restriction", asyncRoute(async (request, response) => {
    const adminId = Number(request.bookMeetUser.id); const sellerId = id(request.params.sellerId);
    const pool = getPool();
    if (!(await isAdmin(pool, adminId))) throw fail(403, "ADMIN_REQUIRED", "Доступно только администратору");
    const [[seller]] = await pool.query("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND purged_at IS NULL", [sellerId]);
    if (!seller) throw fail(404, "MARKETPLACE_SELLER_NOT_FOUND", "Пользователь не найден");
    const [[row]] = await pool.query("SELECT reason, restricted_until FROM marketplace_seller_restrictions WHERE seller_user_id = ? AND (restricted_until IS NULL OR restricted_until > UTC_TIMESTAMP())", [sellerId]);
    response.json({ restriction: row ? { reason: row.reason, until: row.restricted_until ? new Date(row.restricted_until).toISOString() : null } : null });
  }));

  router.patch("/admin/marketplace/listings/:listingId/moderation", asyncRoute(async (request, response) => {
    const adminId = Number(request.bookMeetUser.id); const listingId = id(request.params.listingId); const note = reason(request.body?.reason);
    const recipients = await withTransaction(async (connection) => {
      if (!(await isAdmin(connection, adminId))) throw fail(403, "ADMIN_REQUIRED", "Доступно только администратору");
      const [[listing]] = await connection.query("SELECT status, seller_user_id FROM marketplace_listings WHERE id = ? FOR UPDATE", [listingId]);
      if (!listing) throw fail(404, "MARKETPLACE_LISTING_NOT_FOUND", "Объявление не найдено");
      if (listing.status === "removed") throw fail(409, "MARKETPLACE_LISTING_ALREADY_REMOVED", "Объявление уже снято");
      await connection.query("UPDATE marketplace_listings SET status = 'removed', moderation_note = ? WHERE id = ?", [note, listingId]);
      await logModerationAction(connection, { adminUserId: adminId, actionType: "marketplace_listing_removed", objectType: "marketplace_listing", objectId: listingId, oldStatus: listing.status, newStatus: "removed", reason: note });
      const [rows] = await connection.query("SELECT DISTINCT cm.user_id FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id WHERE c.marketplace_listing_id = ? AND cm.left_at IS NULL", [listingId]);
      return [...new Set([listing.seller_user_id, ...rows.map((row) => row.user_id)].map(Number).filter(Number.isSafeInteger))];
    });
    queueChatRealtime(response, recipients, { type: "marketplace.listing.changed", listingId });
    response.json({ ok: true, status: "removed" });
  }));

  router.post("/admin/marketplace/sellers/:sellerId/restriction", asyncRoute(async (request, response) => {
    const adminId = Number(request.bookMeetUser.id); const sellerId = id(request.params.sellerId);
    const note = reason(request.body?.reason); const restrictedUntil = until(request.body?.until);
    await withTransaction(async (connection) => {
      if (!(await isAdmin(connection, adminId))) throw fail(403, "ADMIN_REQUIRED", "Доступно только администратору");
      const [[seller]] = await connection.query("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND purged_at IS NULL FOR UPDATE", [sellerId]);
      if (!seller) throw fail(404, "MARKETPLACE_SELLER_NOT_FOUND", "Пользователь не найден");
      const [[current]] = await connection.query("SELECT restricted_until FROM marketplace_seller_restrictions WHERE seller_user_id = ? FOR UPDATE", [sellerId]);
      await connection.query("INSERT INTO marketplace_seller_restrictions (seller_user_id, restricted_until, reason, moderator_user_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE restricted_until = VALUES(restricted_until), reason = VALUES(reason), moderator_user_id = VALUES(moderator_user_id)", [sellerId, restrictedUntil, note, adminId]);
      await logModerationAction(connection, { adminUserId: adminId, actionType: "marketplace_seller_restricted", objectType: "user", objectId: sellerId, oldStatus: current ? "restricted" : "allowed", newStatus: "restricted", reason: note });
    });
    response.json({ ok: true, restrictedUntil });
  }));

  router.delete("/admin/marketplace/sellers/:sellerId/restriction", asyncRoute(async (request, response) => {
    const adminId = Number(request.bookMeetUser.id); const sellerId = id(request.params.sellerId); const note = reason(request.body?.reason);
    await withTransaction(async (connection) => {
      if (!(await isAdmin(connection, adminId))) throw fail(403, "ADMIN_REQUIRED", "Доступно только администратору");
      const [[seller]] = await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [sellerId]);
      if (!seller) throw fail(404, "MARKETPLACE_SELLER_NOT_FOUND", "Пользователь не найден");
      const [deleted] = await connection.query("DELETE FROM marketplace_seller_restrictions WHERE seller_user_id = ?", [sellerId]);
      if (!deleted.affectedRows) throw fail(404, "MARKETPLACE_RESTRICTION_NOT_FOUND", "Ограничение не найдено");
      await logModerationAction(connection, { adminUserId: adminId, actionType: "marketplace_seller_unrestricted", objectType: "user", objectId: sellerId, oldStatus: "restricted", newStatus: "allowed", reason: note });
    });
    response.json({ ok: true });
  }));

  return router;
}
