import { getPool } from "../db.js";
import { parseJson } from "../data.js";

function iso(value) {
  return value ? new Date(value).toISOString() : undefined;
}

export function sqlDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function isPublicUpcomingEvent(event, now = new Date()) {
  if (event.status && event.status !== "published" || event.is_adult || event.isAdult) return false;
  const date = sqlDate(event.event_date ?? event.date);
  const time = String(event.event_time ?? event.time ?? "").slice(0, 5) || "23:59";
  const timestamp = Date.parse(`${date}T${time}:00`);
  return Number.isFinite(timestamp) && timestamp >= now.getTime();
}

export function isPublicOccasion(occasion) {
  const targetGender = String(occasion.target_gender ?? occasion.targetGender ?? "").trim();
  const targetProfileType = String(occasion.target_profile_type ?? occasion.targetProfileType ?? "").trim();
  return (!occasion.status || occasion.status === "published")
    && !occasion.is_adult && !occasion.isAdult
    && (!targetGender || targetGender === "Все")
    && (!targetProfileType || targetProfileType === "Все");
}

export async function loadPublicCatalog(pool = getPool(), { now = new Date() } = {}) {
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
    `SELECT r.id, 'review' AS kind, b.title, r.preview, r.user_id AS owner_id,
            p.display_name AS owner_name, u.initials AS owner_initials, u.color AS owner_color,
            u.avatar_path AS owner_avatar_path, r.created_at
       FROM reviews r JOIN books b ON b.id = r.book_id JOIN profiles p ON p.user_id = r.user_id
       JOIN users u ON u.id = r.user_id
      WHERE r.is_adult = 0 AND b.is_adult = 0 AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY r.created_at DESC LIMIT 100`,
  );
  const [excerptRows] = await pool.query(
    `SELECT e.id, 'excerpt' AS kind, COALESCE(NULLIF(e.book_title, ''), 'Публикация') AS title,
            e.preview_text AS preview, e.user_id AS owner_id, p.display_name AS owner_name,
            u.initials AS owner_initials, u.color AS owner_color, u.avatar_path AS owner_avatar_path, e.created_at
       FROM excerpts e JOIN profiles p ON p.user_id = e.user_id JOIN users u ON u.id = e.user_id
      WHERE e.is_adult = 0 AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY e.created_at DESC LIMIT 100`,
  );
  const [newsRows] = await pool.query(
    `SELECT n.id, 'publisher_news' AS kind, n.title, n.preview_text AS preview,
            n.user_id AS owner_id, p.display_name AS owner_name, u.initials AS owner_initials,
            u.color AS owner_color, u.avatar_path AS owner_avatar_path, n.created_at
       FROM publisher_news n JOIN profiles p ON p.user_id = n.user_id JOIN users u ON u.id = n.user_id
      WHERE n.is_adult = 0 AND p.profile_type IN ('Издатель', 'Сообщество') AND p.publisher_status = 'approved'
        AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY n.created_at DESC LIMIT 100`,
  );
  const [eventRows] = await pool.query(
    `SELECT e.id, e.title, e.summary, e.event_date, e.event_time, e.city, e.address, e.created_at
       FROM events e JOIN users u ON u.id = e.creator_user_id
      WHERE e.status = 'published' AND e.is_adult = 0 AND u.deleted_at IS NULL AND u.purged_at IS NULL
        AND TIMESTAMP(e.event_date, e.event_time) >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 HOUR)
      ORDER BY e.event_date, e.event_time, e.id LIMIT 200`,
  );
  const [occasionRows] = await pool.query(
    `SELECT o.id, o.occasion_type, o.primary_text, o.audience_text, o.target_cities,
            o.meeting_date, o.meeting_start_time, o.meeting_end_time, o.meeting_city,
            o.meeting_address, o.created_at, o.target_gender, o.target_profile_type, o.status, o.is_adult
       FROM occasions o JOIN users u ON u.id = o.creator_user_id
      WHERE o.status = 'published' AND o.is_adult = 0 AND u.deleted_at IS NULL AND u.purged_at IS NULL
        AND (o.target_gender IS NULL OR TRIM(o.target_gender) = '' OR o.target_gender = 'Все')
        AND (o.target_profile_type IS NULL OR TRIM(o.target_profile_type) = '' OR o.target_profile_type = 'Все')
      ORDER BY o.created_at DESC, o.id DESC LIMIT 100`,
  );
  const [organizationRows] = await pool.query(
    `SELECT u.id, u.initials, u.color, u.avatar_path, p.display_name, p.city, p.profile_type, p.bio, p.community_type, p.community_is_closed
       FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE p.profile_type IN ('Издатель', 'Сообщество') AND p.publisher_status = 'approved'
        AND u.deleted_at IS NULL AND u.purged_at IS NULL
      ORDER BY p.display_name, u.id`,
  );
  return {
    books: bookRows.map((row) => ({ id: Number(row.id), author: row.author, title: row.title, isbn: row.isbn ?? undefined, publisher: row.publisher ?? undefined, genres: parseJson(row.genres), annotation: row.annotation ?? "", coverUrl: row.cover_path ?? undefined, coverTone: row.cover_tone ?? "blue", addedAt: iso(row.created_at), popularity: Number(row.popularity ?? 0) })),
    materials: [...reviewRows, ...excerptRows, ...newsRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 150).map((row) => ({ id: Number(row.id), kind: row.kind, title: row.title, preview: row.preview ?? "", ownerName: row.owner_name, owner: { id: Number(row.owner_id), name: row.owner_name, initials: row.owner_initials ?? "", color: row.owner_color ?? "blue", avatarUrl: row.owner_avatar_path ?? undefined }, createdAt: iso(row.created_at) })),
    events: eventRows.filter((row) => isPublicUpcomingEvent(row, now)).map((row) => ({ id: Number(row.id), title: row.title, summary: row.summary ?? "", date: sqlDate(row.event_date), time: String(row.event_time).slice(0, 5), city: row.city, address: row.address ?? "", createdAt: iso(row.created_at) })),
    occasions: occasionRows.filter(isPublicOccasion).map((row) => ({ id: Number(row.id), type: row.occasion_type, primaryText: row.primary_text, audienceText: row.audience_text, targetCities: parseJson(row.target_cities), meetingDate: sqlDate(row.meeting_date) || undefined, meetingStartTime: row.meeting_start_time ? String(row.meeting_start_time).slice(0, 5) : undefined, meetingEndTime: row.meeting_end_time ? String(row.meeting_end_time).slice(0, 5) : undefined, meetingCity: row.meeting_city ?? undefined, meetingAddress: row.meeting_address ?? undefined, createdAt: iso(row.created_at) })),
    organizations: organizationRows.map((row) => ({ id: Number(row.id), name: row.display_name, city: row.city ?? "", type: row.profile_type, bio: row.bio ?? "", communityType: row.community_type ?? undefined, communityIsClosed: row.profile_type === "Сообщество" ? Boolean(row.community_is_closed) : false, initials: row.initials, color: row.color, avatarUrl: row.avatar_path ?? undefined })),
  };
}
