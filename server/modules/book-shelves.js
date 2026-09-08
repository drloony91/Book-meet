import { ageFromBirthDate } from "../data.js";

function failure(message, statusCode = 400, code = "INVALID_SHELF") {
  return Object.assign(new Error(message), { statusCode, code });
}

function text(value, limit, label, required = false) {
  if (typeof value !== "string") throw failure(`Некорректное поле «${label}»`);
  const result = value.trim();
  if (Array.from(result).length > limit || required && !result.length) throw failure(`Некорректное поле «${label}»`);
  return result;
}

export function shelfPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).some((key) => !["title", "description", "items"].includes(key))) throw failure("Некорректные поля полки");
  const title = text(payload.title, 120, "Название", true);
  const description = text(payload.description ?? "", 500, "Описание");
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) throw failure("Добавьте хотя бы одну книгу");
  const ids = new Set();
  const items = payload.items.map((item, position) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !["bookId", "description"].includes(key))) throw failure("Некорректная книга полки");
    const bookId = Number(item.bookId);
    if (!Number.isSafeInteger(bookId) || bookId < 1 || ids.has(bookId)) throw failure("Книги в полке не должны повторяться");
    ids.add(bookId);
    return { bookId, position, description: text(item.description ?? "", 500, "Описание книги") };
  });
  return { title, description, items };
}

export async function shelfHeader(connection, shelfId) {
  const [[row]] = await connection.query(
    `SELECT s.id, s.owner_user_id, s.title, s.description, s.created_at, s.updated_at,
            u.deleted_at, u.purged_at, u.initials, u.avatar_path, p.display_name
       FROM book_shelves s JOIN users u ON u.id = s.owner_user_id JOIN profiles p ON p.user_id = u.id
      WHERE s.id = ?`, [shelfId],
  );
  return row ?? null;
}

export async function assertShelfReadable(connection, viewerId, shelfId, { blockAsForbidden = false } = {}) {
  const shelf = await shelfHeader(connection, shelfId);
  if (!shelf || shelf.deleted_at || shelf.purged_at) throw failure("Полка не найдена", 404, "SHELF_NOT_FOUND");
  if (Number(shelf.owner_user_id) !== Number(viewerId)) {
    const [[blocked]] = await connection.query(
      "SELECT 1 FROM user_blocks WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1",
      [viewerId, shelf.owner_user_id, shelf.owner_user_id, viewerId],
    );
    if (blocked) {
      if (blockAsForbidden) throw failure("Взаимодействие с пользователем недоступно", 403, "USER_INTERACTION_BLOCKED");
      throw failure("Полка не найдена", 404, "SHELF_NOT_FOUND");
    }
    const [[hidden]] = await connection.query("SELECT 1 FROM user_hides WHERE hider_user_id = ? AND hidden_user_id = ? LIMIT 1", [viewerId, shelf.owner_user_id]);
    if (hidden) throw failure("Полка не найдена", 404, "SHELF_NOT_FOUND");
  }
  return shelf;
}

async function viewerCanReadAdult(connection, viewerId) {
  const [[viewer]] = await connection.query("SELECT u.role, p.birth_date FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", [viewerId]);
  return viewer?.role === "admin" || Number(ageFromBirthDate(viewer?.birth_date) ?? -1) >= 18;
}

function dto(header, rows, allowAdult) {
  const items = rows.map((row) => {
    const available = row.book_id && (!row.is_adult || allowAdult);
    return {
      bookId: available ? Number(row.book_id) : null,
      position: Number(row.position), description: available ? row.item_description ?? "" : "",
      book: available ? { id: Number(row.book_id), title: row.title, author: row.author, annotation: row.annotation ?? "", coverUrl: row.cover_path ?? undefined, coverTone: row.cover_tone ?? "blue", rating: row.rating == null ? undefined : Number(row.rating) } : null,
    };
  });
  return {
    id: Number(header.id), ownerId: Number(header.owner_user_id), title: header.title, description: header.description ?? "",
    createdAt: new Date(header.created_at).toISOString(), updatedAt: new Date(header.updated_at).toISOString(),
    owner: { id: Number(header.owner_user_id), name: header.display_name, initials: header.initials, avatarUrl: header.avatar_path ?? undefined },
    bookCount: rows.length, items,
  };
}

export async function shelfDto(connection, viewerId, shelfId, { verify = true } = {}) {
  const header = verify ? await assertShelfReadable(connection, viewerId, shelfId) : await shelfHeader(connection, shelfId);
  if (!header) throw failure("Полка не найдена", 404, "SHELF_NOT_FOUND");
  const [rows] = await connection.query(
    `SELECT i.book_id, i.position, i.description AS item_description, b.title, b.author, b.annotation, b.cover_path, b.cover_tone, b.is_adult, ub.rating
       FROM book_shelf_items i
       LEFT JOIN books b ON b.id = i.book_id
       LEFT JOIN user_books ub ON ub.user_id = ? AND ub.book_id = i.book_id AND ub.is_author = 0
      WHERE i.shelf_id = ? ORDER BY i.position`, [header.owner_user_id, shelfId],
  );
  return dto(header, rows, await viewerCanReadAdult(connection, viewerId));
}

export async function shelvesForUser(connection, viewerId, ownerId, cursor = null) {
  const owner = await assertShelfOwnerReadable(connection, viewerId, ownerId);
  if (!owner) throw failure("Пользователь не найден", 404, "SHELF_OWNER_NOT_FOUND");
  const params = [ownerId];
  let cursorSql = "";
  if (cursor !== null) { cursorSql = " AND s.id < ?"; params.push(cursor); }
  const [headers] = await connection.query(
    `SELECT s.id FROM book_shelves s WHERE s.owner_user_id = ?${cursorSql} ORDER BY s.id DESC LIMIT 21`, params,
  );
  const page = headers.slice(0, 20);
  const shelves = await Promise.all(page.map((row) => shelfDto(connection, viewerId, Number(row.id), { verify: false })));
  return { shelves, nextCursor: headers.length > 20 ? Number(page.at(-1).id) : null };
}

async function assertShelfOwnerReadable(connection, viewerId, ownerId) {
  const [[owner]] = await connection.query("SELECT u.id, u.deleted_at, u.purged_at FROM users u WHERE u.id = ?", [ownerId]);
  if (!owner || owner.deleted_at || owner.purged_at) return null;
  if (Number(ownerId) === Number(viewerId)) return owner;
  const [[hidden]] = await connection.query(
    `SELECT 1 FROM user_blocks WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?)
     UNION ALL SELECT 1 FROM user_hides WHERE hider_user_id = ? AND hidden_user_id = ? LIMIT 1`, [viewerId, ownerId, ownerId, viewerId, viewerId, ownerId],
  );
  return hidden ? null : owner;
}

export function shelfCursor(value) {
  if (value === undefined) return null;
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 1) throw failure("Некорректный курсор", 400, "INVALID_SHELF_CURSOR");
  return cursor;
}
