import { getPool } from "../db.js";
import { parseJson } from "../data.js";

function iso(value) {
  return value ? new Date(value).toISOString() : undefined;
}

export async function loadPublicCatalog(pool = getPool()) {
  const [bookRows] = await pool.query(
    `SELECT b.id, b.author, b.title, b.isbn, b.publisher, b.genres, b.annotation, b.cover_path, b.cover_tone, b.created_at,
            COUNT(DISTINCT CASE WHEN ub.is_author = 0 THEN ub.user_id END) AS popularity
       FROM books b
       LEFT JOIN user_books ub ON ub.book_id = b.id
      WHERE b.is_adult = 0
      GROUP BY b.id
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT 500`,
  );
  const [reviewRows] = await pool.query(
    `SELECT r.id, 'review' AS kind, b.title, r.preview, p.display_name AS owner_name, r.created_at
       FROM reviews r JOIN books b ON b.id = r.book_id JOIN profiles p ON p.user_id = r.user_id
       JOIN users u ON u.id = r.user_id
      WHERE r.is_adult = 0 AND b.is_adult = 0 AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY r.created_at DESC LIMIT 100`,
  );
  const [excerptRows] = await pool.query(
    `SELECT e.id, 'excerpt' AS kind, COALESCE(NULLIF(e.book_title, ''), 'Публикация') AS title,
            e.preview_text AS preview, p.display_name AS owner_name, e.created_at
       FROM excerpts e JOIN profiles p ON p.user_id = e.user_id JOIN users u ON u.id = e.user_id
      WHERE e.is_adult = 0 AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY e.created_at DESC LIMIT 100`,
  );
  const [newsRows] = await pool.query(
    `SELECT n.id, 'publisher_news' AS kind, n.title, n.preview_text AS preview,
            p.display_name AS owner_name, n.created_at
       FROM publisher_news n JOIN profiles p ON p.user_id = n.user_id JOIN users u ON u.id = n.user_id
      WHERE n.is_adult = 0 AND p.profile_type IN ('Издатель', 'Сообщество') AND p.publisher_status = 'approved'
        AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY n.created_at DESC LIMIT 100`,
  );
  const [eventRows] = await pool.query(
    `SELECT e.id, e.title, e.summary, e.event_date, e.event_time, e.city, e.address, e.created_at
       FROM events e JOIN users u ON u.id = e.creator_user_id
      WHERE e.status = 'published' AND e.is_adult = 0 AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY e.event_date, e.event_time, e.id LIMIT 200`,
  );
  const [organizationRows] = await pool.query(
    `SELECT u.id, u.initials, u.color, u.avatar_path, p.display_name, p.city, p.profile_type, p.bio, p.community_type
       FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE p.profile_type IN ('Издатель', 'Сообщество') AND p.publisher_status = 'approved'
        AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY p.display_name, u.id`,
  );
  return {
    books: bookRows.map((row) => ({ id: Number(row.id), author: row.author, title: row.title, isbn: row.isbn ?? undefined, publisher: row.publisher ?? undefined, genres: parseJson(row.genres), annotation: row.annotation ?? "", coverUrl: row.cover_path ?? undefined, coverTone: row.cover_tone ?? "blue", addedAt: iso(row.created_at), popularity: Number(row.popularity ?? 0) })),
    materials: [...reviewRows, ...excerptRows, ...newsRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 150).map((row) => ({ id: Number(row.id), kind: row.kind, title: row.title, preview: row.preview ?? "", ownerName: row.owner_name, createdAt: iso(row.created_at) })),
    events: eventRows.map((row) => ({ id: Number(row.id), title: row.title, summary: row.summary ?? "", date: String(row.event_date).slice(0, 10), time: String(row.event_time).slice(0, 5), city: row.city, address: row.address ?? "", createdAt: iso(row.created_at) })),
    organizations: organizationRows.map((row) => ({ id: Number(row.id), name: row.display_name, city: row.city ?? "", type: row.profile_type, bio: row.bio ?? "", communityType: row.community_type ?? undefined, initials: row.initials, color: row.color, avatarUrl: row.avatar_path ?? undefined })),
  };
}
