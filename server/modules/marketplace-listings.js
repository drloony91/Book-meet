import { Router } from "express";
import { LoginAttemptTracker } from "./login-attempts.js";
import { marketplaceEnabled } from "./marketplace-feature.js";
import { marketplaceImageFile } from "./image-storage.js";

const LISTING_STATUSES = new Set(["active", "reserved", "sold", "exchanged", "closed"]);
const MAX_LISTINGS_PER_PAGE = 40;
const rateLimits = new Map();

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function positiveId(value, field = "id") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw fail(400, `INVALID_${field.toUpperCase()}`, "Некорректный идентификатор");
  return number;
}

function text(value, field, maximum, { required = false } = {}) {
  if (typeof value !== "string") {
    if (!required && value == null) return "";
    throw fail(400, `INVALID_${field.toUpperCase()}`, "Некорректные данные объявления");
  }
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > maximum) throw fail(400, `INVALID_${field.toUpperCase()}`, "Проверьте заполнение объявления");
  return cleaned;
}

function listingType(value) {
  if (value !== "sale" && value !== "exchange") throw fail(400, "INVALID_LISTING_TYPE", "Выберите продажу или обмен");
  return value;
}

function currency(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(normalized)) throw fail(400, "INVALID_CURRENCY", "Укажите код валюты из трёх букв");
  return normalized;
}

function price(value) {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 99_999_999.99 || Math.abs(Math.round(parsed * 100) - parsed * 100) > 1e-7) throw fail(400, "INVALID_PRICE", "Укажите цену больше нуля с точностью до тиына");
  return parsed.toFixed(2);
}

function filterPrice(value) {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99_999_999.99 || Math.abs(Math.round(parsed * 100) - parsed * 100) > 1e-7) throw fail(400, "INVALID_PRICE_FILTER", "Некорректная граница цены");
  return parsed.toFixed(2);
}

function imageInputs(value, field = "images") {
  if (!Array.isArray(value) || value.length > 6) throw fail(400, "INVALID_LISTING_IMAGES", "Можно добавить не более 6 изображений");
  for (const image of value) {
    if (typeof image !== "string" || !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(image)) throw fail(400, "INVALID_LISTING_IMAGE", "Изображения должны быть загружены как файлы PNG, JPEG или WebP");
  }
  return value;
}

export function parseMarketplaceListingPayload(payload, { partial = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fail(400, "INVALID_MARKETPLACE_LISTING", "Укажите данные объявления");
  const result = {};
  const owns = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  if (!partial || owns("catalogBookId") || owns("title") || owns("author")) {
    const hasCatalogId = payload.catalogBookId != null && payload.catalogBookId !== "";
    if (hasCatalogId && (owns("title") || owns("author"))) throw fail(400, "AMBIGUOUS_LISTING_BOOK", "Выберите книгу из каталога или укажите название и автора");
    if (hasCatalogId) result.catalogBookId = positiveId(payload.catalogBookId, "catalog_book_id");
    else {
      result.catalogBookId = null;
      result.bookTitle = text(payload.title, "title", 255, { required: true });
      result.bookAuthor = text(payload.author, "author", 255, { required: true });
    }
  }
  if (!partial || owns("type")) result.type = listingType(payload.type);
  if (!partial || owns("condition")) result.condition = text(payload.condition, "condition", 80, { required: true });
  if (!partial || owns("description")) result.description = text(payload.description, "description", 5000, { required: true });
  if (!partial || owns("cityId")) result.cityId = positiveId(payload.cityId, "city");
  if (!partial || owns("price") || owns("currency") || owns("exchangeWishes")) {
    const effectiveType = result.type ?? (owns("exchangeWishes") ? "exchange" : "sale");
    if (effectiveType === "sale") {
      if (owns("exchangeWishes") && payload.exchangeWishes != null && payload.exchangeWishes !== "") throw fail(400, "INVALID_LISTING_TERMS", "Для продажи не указывайте условия обмена");
      if (!partial || owns("type") || owns("price")) result.priceAmount = price(payload.price);
      if (!partial || owns("type") || owns("currency")) result.priceCurrency = currency(payload.currency);
      if (!partial || owns("type")) result.exchangeWishes = null;
    } else {
      if (owns("price") && payload.price != null && payload.price !== "" || owns("currency") && payload.currency != null && payload.currency !== "") throw fail(400, "INVALID_LISTING_TERMS", "Для обмена не указывайте цену");
      if (!partial || owns("type")) { result.priceAmount = null; result.priceCurrency = null; }
      if (!partial || owns("type") || owns("exchangeWishes")) result.exchangeWishes = text(payload.exchangeWishes, "exchange_wishes", 1000, { required: true });
    }
  }
  if (owns("images")) result.images = imageInputs(payload.images);
  if (!partial && !owns("images")) result.images = [];
  if (owns("status")) {
    if (!LISTING_STATUSES.has(payload.status)) throw fail(400, "INVALID_LISTING_STATUS", "Недопустимый статус объявления");
    result.status = payload.status;
  }
  return result;
}

function listingDto(row, images = []) {
  return {
    id: Number(row.id), sellerId: row.seller_user_id == null ? null : Number(row.seller_user_id),
    sellerName: row.seller_name ?? "Пользователь", sellerUsername: row.seller_username ?? "",
    catalogBookId: row.catalog_book_id == null ? null : Number(row.catalog_book_id),
    title: row.book_title, author: row.book_author, type: row.listing_type,
    condition: row.item_condition, description: row.description, cityId: row.city_id == null ? null : Number(row.city_id),
    cityName: row.city_name, price: row.price_amount == null ? null : Number(row.price_amount),
    currency: row.price_currency, exchangeWishes: row.exchange_wishes, status: row.status,
    images, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function imageDto(image) { return { id: Number(image.id), url: `/api/marketplace/images/${image.id}` }; }

const listingSelect = `SELECT l.*, p.display_name AS seller_name, u.username AS seller_username
  FROM marketplace_listings l JOIN users u ON u.id = l.seller_user_id
  JOIN profiles p ON p.user_id = u.id`;

export async function assertMarketplaceAdult(connection, userId, ageFromBirthDate) {
  const [[row]] = await connection.query("SELECT u.role, u.deleted_at, u.purged_at, p.profile_type, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", [userId]);
  const age = row?.birth_date ? ageFromBirthDate(row.birth_date) : null;
  if (!row || row.deleted_at || row.purged_at || !["Читатель", "Писатель", "Блогер"].includes(row.profile_type) || !Number.isFinite(age) || age < 18) throw fail(403, "MARKETPLACE_ADULTS_ONLY", "Маркетплейс доступен совершеннолетним пользователям личных профилей");
  return row;
}

async function assertCanCreateListing(connection, userId, { lock = false } = {}) {
  const [[restriction]] = await connection.query(`SELECT seller_user_id FROM marketplace_seller_restrictions WHERE seller_user_id = ? AND (restricted_until IS NULL OR restricted_until > UTC_TIMESTAMP()) LIMIT 1${lock ? " FOR UPDATE" : ""}`, [userId]);
  if (restriction) throw fail(403, "MARKETPLACE_SELLER_RESTRICTED", "Создание объявлений временно недоступно");
}

function blockedPairSql(viewerId, sellerColumn = "l.seller_user_id") {
  return `NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = ${sellerColumn}) OR (b.blocker_user_id = ${sellerColumn} AND b.blocked_user_id = ?))`;
}

export function marketplaceAdultBirthDateCutoff(now = new Date()) {
  const year = now.getUTCFullYear() - 18;
  const month = now.getUTCMonth();
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const eligibleSellerSql = "p.profile_type IN ('Читатель', 'Писатель', 'Блогер') AND p.birth_date IS NOT NULL AND p.birth_date <= ?";

function queryEscape(value) { return value.replace(/[!%_]/g, (match) => `!${match}`); }

export function createMarketplaceListingsRouter({ getPool, withTransaction, asyncRoute, saveImage, removeImage, ageFromBirthDate }) {
  const router = Router();
  const rejectIfDisabled = (_request, response, next) => marketplaceEnabled() ? next() : response.status(404).json({ error: "Не найдено" });
  router.use("/marketplace", rejectIfDisabled);
  const attempts = (limit, label) => (request, response, next) => {
    const userId = Number(request.bookMeetUser.id);
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    const tracker = rateLimits.get(label) ?? new LoginAttemptTracker({ limit, windowMs: 60 * 60_000 });
    rateLimits.set(label, tracker);
    const state = tracker.state([`marketplace:${label}:ip:${ip}`, `marketplace:${label}:user:${userId}`]);
    if (state.blocked) {
      response.setHeader("Retry-After", String(state.retryAfterSeconds));
      return response.status(429).json({ code: "MARKETPLACE_RATE_LIMITED", error: "Слишком много действий. Попробуйте позже" });
    }
    state.fail();
    return next();
  };

  router.get("/marketplace/images/:imageId", attempts(3000, "image-read"), asyncRoute(async (request, response) => {
    const viewerId = Number(request.bookMeetUser.id);
    const imageId = positiveId(request.params.imageId, "image");
    const pool = getPool();
    await assertMarketplaceAdult(pool, viewerId, ageFromBirthDate);
    const [[image]] = await pool.query(`SELECT i.image_path, l.seller_user_id, l.status FROM marketplace_listing_images i
      JOIN marketplace_listings l ON l.id = i.listing_id
      JOIN users seller ON seller.id = l.seller_user_id AND seller.deleted_at IS NULL AND seller.purged_at IS NULL
      JOIN profiles p ON p.user_id = seller.id
      WHERE i.id = ? AND l.status <> 'removed' AND (l.status = 'active' OR l.seller_user_id = ?) AND ${eligibleSellerSql}`, [imageId, viewerId, marketplaceAdultBirthDateCutoff()]);
    if (!image) throw fail(404, "MARKETPLACE_IMAGE_NOT_FOUND", "Изображение не найдено");
    const [[block]] = await pool.query("SELECT 1 FROM user_blocks WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1", [viewerId, image.seller_user_id, image.seller_user_id, viewerId]);
    if (block) throw fail(404, "MARKETPLACE_IMAGE_NOT_FOUND", "Изображение не найдено");
    const file = marketplaceImageFile(image.image_path);
    if (!file) throw fail(404, "MARKETPLACE_IMAGE_NOT_FOUND", "Изображение не найдено");
    response.setHeader("Cache-Control", "private, no-store");
    response.sendFile(file, { cacheControl: false });
  }));

  router.get("/marketplace/listings", attempts(240, "read"), asyncRoute(async (request, response) => {
    const viewerId = Number(request.bookMeetUser.id);
    const pool = getPool();
    await assertMarketplaceAdult(pool, viewerId, ageFromBirthDate);
    const where = ["l.status = 'active'", "u.deleted_at IS NULL", "u.purged_at IS NULL", blockedPairSql(viewerId), eligibleSellerSql];
    const params = [viewerId, viewerId, marketplaceAdultBirthDateCutoff()];
    const q = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 120) : "";
    if (q) { where.push("(l.book_title LIKE ? ESCAPE '!' OR l.book_author LIKE ? ESCAPE '!' OR l.description LIKE ? ESCAPE '!')"); const pattern = `%${queryEscape(q)}%`; params.push(pattern, pattern, pattern); }
    if (request.query.cityId != null && request.query.cityId !== "") { where.push("l.city_id = ?"); params.push(positiveId(request.query.cityId, "city")); }
    if (request.query.type != null && request.query.type !== "") { where.push("l.listing_type = ?"); params.push(listingType(request.query.type)); }
    if (request.query.condition != null && request.query.condition !== "") { where.push("l.item_condition = ?"); params.push(text(request.query.condition, "condition", 80, { required: true })); }
    if (request.query.minPrice != null && request.query.minPrice !== "") { where.push("l.listing_type = 'sale' AND l.price_amount >= ?"); params.push(filterPrice(request.query.minPrice)); }
    if (request.query.maxPrice != null && request.query.maxPrice !== "") { where.push("l.listing_type = 'sale' AND l.price_amount <= ?"); params.push(filterPrice(request.query.maxPrice)); }
    if (request.query.beforeId != null && request.query.beforeId !== "") { where.push("l.id < ?"); params.push(positiveId(request.query.beforeId, "before_id")); }
    const parsedLimit = Number(request.query.limit ?? 20);
    const limit = Number.isInteger(parsedLimit) ? Math.max(1, Math.min(MAX_LISTINGS_PER_PAGE, parsedLimit)) : 20;
    const [page] = await pool.query(`${listingSelect} WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`, [...params, limit + 1]);
    const rows = page.slice(0, limit);
    const ids = rows.map((row) => Number(row.id));
    const [images] = ids.length ? await pool.query(`SELECT listing_id, id, image_path FROM marketplace_listing_images WHERE listing_id IN (${ids.map(() => "?").join(",")}) ORDER BY listing_id, image_order`, ids) : [[]];
    const grouped = new Map();
    for (const image of images) grouped.set(Number(image.listing_id), [...(grouped.get(Number(image.listing_id)) ?? []), imageDto(image)]);
    response.json({ listings: rows.map((row) => listingDto(row, grouped.get(Number(row.id)) ?? [])), nextBeforeId: page.length > limit ? Number(rows.at(-1).id) : null });
  }));

  router.get("/marketplace/listings/mine", attempts(240, "read"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const pool = getPool();
    await assertMarketplaceAdult(pool, userId, ageFromBirthDate);
    const [rows] = await pool.query(`${listingSelect} WHERE l.seller_user_id = ? AND l.status <> 'removed' ORDER BY l.updated_at DESC, l.id DESC LIMIT 100`, [userId]);
    const ids = rows.map((row) => Number(row.id));
    const [images] = ids.length ? await pool.query(`SELECT listing_id, id, image_path FROM marketplace_listing_images WHERE listing_id IN (${ids.map(() => "?").join(",")}) ORDER BY listing_id, image_order`, ids) : [[]];
    const grouped = new Map();
    for (const image of images) grouped.set(Number(image.listing_id), [...(grouped.get(Number(image.listing_id)) ?? []), imageDto(image)]);
    response.json({ listings: rows.map((row) => listingDto(row, grouped.get(Number(row.id)) ?? [])) });
  }));

  router.get("/marketplace/listings/:id", attempts(240, "read"), asyncRoute(async (request, response) => {
    const viewerId = Number(request.bookMeetUser.id); const id = positiveId(request.params.id, "listing"); const pool = getPool();
    await assertMarketplaceAdult(pool, viewerId, ageFromBirthDate);
    const [[row]] = await pool.query(`${listingSelect} WHERE l.id = ? AND (l.status = 'active' OR l.seller_reference_id = ?) AND u.deleted_at IS NULL AND u.purged_at IS NULL AND ${eligibleSellerSql} AND ${blockedPairSql(viewerId)}`, [id, viewerId, marketplaceAdultBirthDateCutoff(), viewerId, viewerId]);
    if (!row) throw fail(404, "MARKETPLACE_LISTING_NOT_FOUND", "Объявление не найдено");
    const [images] = await pool.query("SELECT id, image_path FROM marketplace_listing_images WHERE listing_id = ? ORDER BY image_order", [id]);
    response.json({ listing: listingDto(row, images.map(imageDto)) });
  }));

  router.post("/marketplace/listings", attempts(8, "create"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const input = parseMarketplaceListingPayload(request.body);
    if (input.status !== undefined) throw fail(400, "INVALID_LISTING_STATUS", "Статус можно менять после создания объявления");
    await assertMarketplaceAdult(getPool(), userId, ageFromBirthDate);
    await assertCanCreateListing(getPool(), userId);
    const saved = [];
    let committed = false;
    try {
      for (const image of input.images) saved.push(await saveImage(image));
      const createdId = await withTransaction(async (connection) => {
        await assertMarketplaceAdult(connection, userId, ageFromBirthDate);
        let book;
        if (input.catalogBookId) {
          [[book]] = await connection.query("SELECT id, title, author FROM books WHERE id = ?", [input.catalogBookId]);
          if (!book) throw fail(404, "MARKETPLACE_BOOK_NOT_FOUND", "Книга каталога не найдена");
        }
        const [[city]] = await connection.query("SELECT id, name FROM cities WHERE id = ?", [input.cityId]);
        if (!city) throw fail(400, "INVALID_CITY", "Выберите существующий город");
        // Serializing creates per seller closes the concurrent duplicate-post gap.
        await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
        await assertCanCreateListing(connection, userId, { lock: true });
        const [[duplicate]] = await connection.query("SELECT id FROM marketplace_listings WHERE seller_user_id = ? AND listing_type = ? AND book_title = ? AND book_author = ? AND status IN ('active', 'reserved') AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) LIMIT 1", [userId, input.type, book?.title ?? input.bookTitle, book?.author ?? input.bookAuthor]);
        if (duplicate) throw fail(409, "MARKETPLACE_DUPLICATE_LISTING", "Похожее объявление уже размещено");
        const [created] = await connection.query(
          "INSERT INTO marketplace_listings (seller_user_id, seller_reference_id, catalog_book_id, book_title, book_author, listing_type, item_condition, description, city_id, city_name, price_amount, price_currency, exchange_wishes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [userId, userId, book?.id ?? null, book?.title ?? input.bookTitle, book?.author ?? input.bookAuthor, input.type, input.condition, input.description, city.id, city.name, input.priceAmount, input.priceCurrency, input.exchangeWishes],
        );
        for (const [order, imagePath] of saved.entries()) await connection.query("INSERT INTO marketplace_listing_images (listing_id, image_order, image_path) VALUES (?, ?, ?)", [created.insertId, order, imagePath]);
        return Number(created.insertId);
      });
      committed = true;
      const [[row]] = await getPool().query(`${listingSelect} WHERE l.id = ?`, [createdId]);
      const [images] = await getPool().query("SELECT id, image_path FROM marketplace_listing_images WHERE listing_id = ? ORDER BY image_order", [createdId]);
      response.status(201).json({ listing: listingDto(row, images.map(imageDto)) });
    } catch (error) {
      if (!committed) await Promise.all(saved.map((imagePath) => removeImage(imagePath).catch(() => {})));
      throw error;
    }
  }));

  router.patch("/marketplace/listings/:id", attempts(20, "edit"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const id = positiveId(request.params.id, "listing"); const input = parseMarketplaceListingPayload(request.body, { partial: true });
    if (!Object.keys(input).length) throw fail(400, "EMPTY_MARKETPLACE_LISTING_UPDATE", "Нет изменений для сохранения");
    if (input.status === "removed") throw fail(400, "INVALID_LISTING_STATUS", "Для удаления используйте DELETE");
    await assertMarketplaceAdult(getPool(), userId, ageFromBirthDate);
    const [[owned]] = await getPool().query("SELECT id FROM marketplace_listings WHERE id = ? AND seller_user_id = ? AND status <> 'removed'", [id, userId]);
    if (!owned) throw fail(404, "MARKETPLACE_LISTING_NOT_FOUND", "Объявление не найдено");
    const saved = [];
    let committed = false;
    try {
      for (const image of input.images ?? []) saved.push(await saveImage(image));
      const removed = await withTransaction(async (connection) => {
        await assertMarketplaceAdult(connection, userId, ageFromBirthDate);
        const [[current]] = await connection.query("SELECT * FROM marketplace_listings WHERE id = ? AND seller_reference_id = ? FOR UPDATE", [id, userId]);
        if (!current || current.status === "removed") throw fail(404, "MARKETPLACE_LISTING_NOT_FOUND", "Объявление не найдено");
        const type = input.type ?? current.listing_type;
        const status = input.status ?? current.status;
        if ((status === "sold" && type !== "sale") || (status === "exchanged" && type !== "exchange")) throw fail(400, "INVALID_LISTING_STATUS", "Статус завершённой сделки должен соответствовать типу объявления");
        if (type === "sale" && input.exchangeWishes != null || type === "exchange" && (input.priceAmount != null || input.priceCurrency != null)) throw fail(400, "INVALID_LISTING_TERMS", "Условия объявления не соответствуют его типу");
        let bookId = input.catalogBookId === undefined ? current.catalog_book_id : input.catalogBookId;
        let title = input.bookTitle ?? current.book_title; let author = input.bookAuthor ?? current.book_author;
        if (input.catalogBookId) {
          const [[book]] = await connection.query("SELECT id, title, author FROM books WHERE id = ?", [input.catalogBookId]);
          if (!book) throw fail(404, "MARKETPLACE_BOOK_NOT_FOUND", "Книга каталога не найдена");
          bookId = book.id; title = book.title; author = book.author;
        }
        let cityId = current.city_id; let cityName = current.city_name;
        if (input.cityId !== undefined) {
          const [[city]] = await connection.query("SELECT id, name FROM cities WHERE id = ?", [input.cityId]);
          if (!city) throw fail(400, "INVALID_CITY", "Выберите существующий город");
          cityId = city.id; cityName = city.name;
        }
        const next = { type, title, author, bookId, condition: input.condition ?? current.item_condition, description: input.description ?? current.description, cityId, cityName,
          priceAmount: input.priceAmount !== undefined ? input.priceAmount : type === "sale" ? current.price_amount : null,
          priceCurrency: input.priceCurrency !== undefined ? input.priceCurrency : type === "sale" ? current.price_currency : null,
          exchangeWishes: input.exchangeWishes !== undefined ? input.exchangeWishes : type === "exchange" ? current.exchange_wishes : null, status };
        if (type === "sale" && (next.priceAmount == null || next.priceCurrency == null)) throw fail(400, "INVALID_PRICE", "Для продажи укажите цену и валюту");
        if (type === "exchange" && !next.exchangeWishes) throw fail(400, "INVALID_EXCHANGE_WISHES", "Для обмена укажите пожелания");
        await connection.query("UPDATE marketplace_listings SET catalog_book_id = ?, book_title = ?, book_author = ?, listing_type = ?, item_condition = ?, description = ?, city_id = ?, city_name = ?, price_amount = ?, price_currency = ?, exchange_wishes = ?, status = ? WHERE id = ?",
          [next.bookId, next.title, next.author, next.type, next.condition, next.description, next.cityId, next.cityName, next.priceAmount, next.priceCurrency, next.exchangeWishes, next.status, id]);
        let oldImages = [];
        if (input.images !== undefined) {
          const [rows] = await connection.query("SELECT image_path FROM marketplace_listing_images WHERE listing_id = ? FOR UPDATE", [id]); oldImages = rows.map((row) => row.image_path);
          await connection.query("DELETE FROM marketplace_listing_images WHERE listing_id = ?", [id]);
          for (const [order, imagePath] of saved.entries()) await connection.query("INSERT INTO marketplace_listing_images (listing_id, image_order, image_path) VALUES (?, ?, ?)", [id, order, imagePath]);
        }
        return oldImages;
      });
      committed = true;
      await Promise.all(removed.map((imagePath) => removeImage(imagePath).catch(() => {})));
      const [[row]] = await getPool().query(`${listingSelect} WHERE l.id = ?`, [id]);
      const [images] = await getPool().query("SELECT id, image_path FROM marketplace_listing_images WHERE listing_id = ? ORDER BY image_order", [id]);
      response.json({ listing: listingDto(row, images.map(imageDto)) });
    } catch (error) {
      if (!committed) await Promise.all(saved.map((imagePath) => removeImage(imagePath).catch(() => {})));
      throw error;
    }
  }));

  router.delete("/marketplace/listings/:id", attempts(10, "delete"), asyncRoute(async (request, response) => {
    const userId = Number(request.bookMeetUser.id); const id = positiveId(request.params.id, "listing");
    await withTransaction(async (connection) => {
      await assertMarketplaceAdult(connection, userId, ageFromBirthDate);
      const [result] = await connection.query("UPDATE marketplace_listings SET status = 'removed' WHERE id = ? AND seller_reference_id = ? AND status <> 'removed'", [id, userId]);
      if (!result.affectedRows) throw fail(404, "MARKETPLACE_LISTING_NOT_FOUND", "Объявление не найдено");
    });
    response.json({ ok: true });
  }));

  return router;
}
