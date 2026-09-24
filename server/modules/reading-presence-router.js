import { Router } from "express";
import { ageFromBirthDate } from "../data.js";
import { canSeeReadingPresence, readingPresenceVisibility } from "./reading-presence.js";
import { readingSessionsEnabled } from "./reading-sessions.js";

function idParam(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error("Некорректная книга"), { statusCode: 400 });
  return id;
}

function pairAgeCompatible(viewerAge, readerAge) {
  return viewerAge !== null && readerAge !== null && (viewerAge < 18) === (readerAge < 18);
}

function pairKey(first, second) { return `${Math.min(Number(first), Number(second))}:${Math.max(Number(first), Number(second))}`; }

export async function authorizedReadingPresenceRecipients(connection, { readerId, bookId, visibilities, connectedUserIds }) {
  const candidates = [...new Set(connectedUserIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0 && id !== Number(readerId)))];
  const modes = [...new Set(visibilities.map(readingPresenceVisibility))].filter((mode) => mode !== "nobody");
  if (!candidates.length || !modes.length) return [];
  const [[reader]] = await connection.query("SELECT birth_date FROM profiles WHERE user_id = ?", [readerId]);
  if (!reader) return [];
  const readerAge = ageFromBirthDate(reader.birth_date);
  if (readerAge === null) return [];
  const [rows] = await connection.query(
    `SELECT viewer.id, viewer_profile.birth_date, book.is_adult,
            EXISTS (SELECT 1 FROM user_blocks block WHERE (block.blocker_user_id = viewer.id AND block.blocked_user_id = ?) OR (block.blocker_user_id = ? AND block.blocked_user_id = viewer.id)) AS blocked,
            EXISTS (SELECT 1 FROM friendships friend WHERE friend.user_low_id = LEAST(viewer.id, ?) AND friend.user_high_id = GREATEST(viewer.id, ?)) AS friends,
            EXISTS (SELECT 1 FROM follows follow WHERE follow.follower_user_id = viewer.id AND follow.target_user_id = ?) AS follower
       FROM users viewer
       JOIN profiles viewer_profile ON viewer_profile.user_id = viewer.id AND viewer_profile.profile_type IN ('Читатель', 'Писатель', 'Блогер')
       JOIN user_books own_book ON own_book.user_id = viewer.id AND own_book.book_id = ? AND own_book.is_author = 0
       JOIN books book ON book.id = own_book.book_id
      WHERE viewer.id IN (?) AND viewer.deleted_at IS NULL AND viewer.purged_at IS NULL
        AND viewer.suspended_permanently = 0 AND (viewer.suspended_until IS NULL OR viewer.suspended_until <= UTC_TIMESTAMP())`,
    [readerId, readerId, readerId, readerId, readerId, bookId, candidates],
  );
  return rows.filter((row) => {
    const viewerAge = ageFromBirthDate(row.birth_date);
    const common = { viewerId: Number(row.id), readerId, running: true, leaseActive: true, bookReadable: !row.is_adult || viewerAge !== null && viewerAge >= 18, blocked: Boolean(row.blocked), ageCompatible: pairAgeCompatible(viewerAge, readerAge), friends: Boolean(row.friends), follower: Boolean(row.follower) };
    return modes.some((visibility) => canSeeReadingPresence({ ...common, visibility }));
  }).map((row) => Number(row.id));
}

export function createReadingPresenceRouter({ getPool, withTransaction, queuePresenceRealtime }) {
  const router = Router();
  const asyncRoute = (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
  const gate = (_request, response, next) => readingSessionsEnabled() ? next() : response.status(404).json({ error: "Не найдено" });
  router.use("/reading-presence", gate);
  router.use("/books/:bookId/reading-presence", gate);

  router.get("/reading-presence/preferences", asyncRoute(async (request, response) => {
    const [[profile]] = await getPool().query("SELECT reading_presence_visibility FROM profiles WHERE user_id = ? AND profile_type IN ('Читатель', 'Писатель', 'Блогер')", [request.bookMeetUser.id]);
    if (!profile) return response.status(404).json({ error: "Настройка недоступна" });
    response.json({ visibility: readingPresenceVisibility(profile.reading_presence_visibility) });
  }));

  router.patch("/reading-presence/preferences", asyncRoute(async (request, response) => {
    const value = request.body?.visibility;
    if (value !== readingPresenceVisibility(value)) return response.status(422).json({ error: "Некорректная настройка присутствия" });
    const userId = request.bookMeetUser.id;
    const result = await withTransaction(async (connection) => {
      const [[profile]] = await connection.query("SELECT reading_presence_visibility FROM profiles WHERE user_id = ? AND profile_type IN ('Читатель', 'Писатель', 'Блогер') FOR UPDATE", [userId]);
      if (!profile) return null;
      const previousVisibility = readingPresenceVisibility(profile.reading_presence_visibility);
      if (previousVisibility !== value) await connection.query("UPDATE profiles SET reading_presence_visibility = ? WHERE user_id = ?", [value, userId]);
      const [[session]] = await connection.query("SELECT book_id FROM reading_sessions WHERE user_id = ? AND state = 'running' AND lease_expires_at > UTC_TIMESTAMP() LIMIT 1", [userId]);
      return { previousVisibility, bookId: session ? Number(session.book_id) : null };
    });
    if (!result) return response.status(404).json({ error: "Настройка недоступна" });
    if (result.previousVisibility !== value && result.bookId) queuePresenceRealtime(response, { readerId: userId, bookId: result.bookId, visibilities: [result.previousVisibility, value] });
    else response.locals.suppressRealtime = true;
    response.json({ visibility: value });
  }));

  router.get("/books/:bookId/reading-presence", asyncRoute(async (request, response) => {
    const userId = request.bookMeetUser.id; const bookId = idParam(request.params.bookId);
    const connection = getPool();
    const [[viewer]] = await connection.query(
      `SELECT p.birth_date, b.is_adult FROM user_books ub JOIN profiles p ON p.user_id = ub.user_id
         JOIN books b ON b.id = ub.book_id
        WHERE ub.user_id = ? AND ub.book_id = ? AND ub.is_author = 0 AND p.profile_type IN ('Читатель', 'Писатель', 'Блогер')`,
      [userId, bookId],
    );
    const viewerAge = ageFromBirthDate(viewer?.birth_date);
    if (!viewer || viewer.is_adult && (viewerAge === null || viewerAge < 18)) return response.status(404).json({ error: "Книга не найдена" });
    const [sessions] = await connection.query(
      `SELECT s.user_id, p.birth_date, p.reading_presence_visibility, u.initials, u.color, u.avatar_path
         FROM reading_sessions s JOIN users u ON u.id = s.user_id JOIN profiles p ON p.user_id = s.user_id
         JOIN user_books reader_book ON reader_book.user_id = s.user_id AND reader_book.book_id = s.book_id AND reader_book.is_author = 0
        WHERE s.book_id = ? AND s.state = 'running' AND s.lease_expires_at > UTC_TIMESTAMP()
          AND u.deleted_at IS NULL AND u.purged_at IS NULL AND u.suspended_permanently = 0
          AND (u.suspended_until IS NULL OR u.suspended_until <= UTC_TIMESTAMP())
        ORDER BY s.id DESC LIMIT 200`, [bookId],
    );
    if (!sessions.length) return response.json({ readers: [] });
    const ids = sessions.map((row) => Number(row.user_id));
    const [[blocks], [friends], [follows]] = await Promise.all([
      connection.query("SELECT blocker_user_id, blocked_user_id FROM user_blocks WHERE (blocker_user_id = ? AND blocked_user_id IN (?)) OR (blocked_user_id = ? AND blocker_user_id IN (?))", [userId, ids, userId, ids]),
      connection.query("SELECT user_low_id, user_high_id FROM friendships WHERE (user_low_id = ? AND user_high_id IN (?)) OR (user_high_id = ? AND user_low_id IN (?))", [userId, ids, userId, ids]),
      connection.query("SELECT follower_user_id, target_user_id FROM follows WHERE follower_user_id = ? AND target_user_id IN (?)", [userId, ids]),
    ]);
    const blockedPairs = new Set(blocks.map((row) => pairKey(row.blocker_user_id, row.blocked_user_id)));
    const friendPairs = new Set(friends.map((row) => pairKey(row.user_low_id, row.user_high_id)));
    const followedIds = new Set(follows.map((row) => Number(row.target_user_id)));
    const readers = sessions.filter((row) => {
      const readerId = Number(row.user_id);
      return canSeeReadingPresence({ viewerId: userId, readerId, visibility: row.reading_presence_visibility, running: true, leaseActive: true, bookReadable: true, blocked: blockedPairs.has(pairKey(userId, readerId)), ageCompatible: readerId === userId || pairAgeCompatible(viewerAge, ageFromBirthDate(row.birth_date)), friends: friendPairs.has(pairKey(userId, readerId)), follower: followedIds.has(readerId) });
    }).map((row) => ({ userId: Number(row.user_id), initials: row.initials || "·", color: row.color || "blue", avatarUrl: row.avatar_path ?? null }));
    response.json({ readers });
  }));

  return router;
}
