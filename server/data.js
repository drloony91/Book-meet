import { getPool } from "./db.js";
import { normalizeIdentity } from "./security.js";

export function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value ?? "null") ?? fallback; } catch { return fallback; }
}

export function formatDate(value) {
  if (!value) return "сегодня";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "сегодня";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function sqlDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function ageFromBirthDate(value, now = new Date()) {
  if (!value) return null;
  const normalized = sqlDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const birth = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth > now) return null;
  if (sqlDate(birth) !== normalized) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed = now.getUTCMonth() > birth.getUTCMonth()
    || now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate();
  if (!birthdayPassed) age -= 1;
  return age;
}

export async function loadUsers(connection = getPool(), viewerId = null) {
  const [blockRows] = viewerId ? await connection.query(
    "SELECT blocker_user_id, blocked_user_id FROM user_blocks WHERE blocker_user_id = ? OR blocked_user_id = ?",
    [viewerId, viewerId],
  ) : [[]];
  const [viewerFriendRows] = viewerId ? await connection.query(
    "SELECT user_low_id, user_high_id FROM friendships WHERE user_low_id = ? OR user_high_id = ?",
    [viewerId, viewerId],
  ) : [[]];
  const [userRows] = await connection.query(
    `SELECT u.id, u.username, u.initials, u.color, u.avatar_path, u.role, u.created_at, u.last_seen_at,
            u.deleted_at, u.deletion_expires_at, u.purged_at,
            u.suspension_reason, u.suspended_until, u.suspended_permanently,
            p.display_name, p.city, p.city_id, c.country_name, p.profile_type, p.gender, p.birth_date, p.show_birth_date_to_friends, p.profile_tab_order,
            p.bio, p.author_influences, p.writing_themes, p.weekend, p.joy, p.talk,
            p.stranger_message, p.favorite_genres, p.disliked_genres,
            p.publisher_status, p.publisher_website, p.publisher_sales_links, p.publisher_legal_name,
            p.publisher_bin, p.publisher_account, p.publisher_bik, p.publisher_bank,
            p.publisher_legal_address, p.publisher_postal_address, p.publisher_moderation_note
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN cities c ON c.id = p.city_id
      ORDER BY u.id`,
  );
  const [bookRows] = await connection.query(
    `SELECT ub.user_id, ub.rating, ub.short_review, ub.read_month, ub.read_year, ub.reading_status, ub.last_read_chapter, ub.reading_comment, ub.is_author,
             b.id, b.creator_user_id, b.author, b.title, b.isbn, b.publisher, b.genres, b.annotation, b.is_adult, b.cover_path, b.cover_tone, b.flip_url
       FROM user_books ub
       JOIN books b ON b.id = ub.book_id
      ORDER BY ub.created_at DESC`,
  );
  const [linkRows] = await connection.query(
    `SELECT id, book_id, owner_user_id, action, label, url
       FROM book_links
      ORDER BY id`,
  );
  const [reviewRows] = await connection.query(
    `SELECT r.id, r.user_id, r.rating, r.preview, r.body, r.is_adult, r.created_at,
            b.id AS book_id, b.title AS book_title, b.author AS book_author
       FROM reviews r
       JOIN books b ON b.id = r.book_id
      ORDER BY r.created_at DESC`,
  );
  const [excerptRows] = await connection.query(
    `SELECT e.id, e.user_id, e.book_id, e.book_title, e.preview_text, e.body_html, e.body, e.is_adult, e.read_url, e.created_at
       FROM excerpts e
      ORDER BY e.created_at DESC`,
  );
  const [publisherNewsRows] = await connection.query(
    `SELECT id, user_id, title, preview_text, body_html, body, is_adult, created_at
       FROM publisher_news
      ORDER BY created_at DESC`,
  );

  const viewerIsAdmin = userRows.some((row) => Number(row.id) === Number(viewerId) && row.role === "admin");
  const viewerRow = userRows.find((row) => Number(row.id) === Number(viewerId));
  const viewerAge = ageFromBirthDate(viewerRow?.birth_date);
  const hideAdultMaterials = !viewerIsAdmin && (viewerAge === null || viewerAge < 18);
  const isViewerFriend = (targetId) => viewerFriendRows.some((friendship) => (
    Number(friendship.user_low_id) === Number(viewerId) && Number(friendship.user_high_id) === Number(targetId)
  ) || (
    Number(friendship.user_high_id) === Number(viewerId) && Number(friendship.user_low_id) === Number(targetId)
  ));
  return userRows.filter((row) => row.role === "admin"
    || row.profile_type !== "Издатель"
    || row.publisher_status === "approved"
    || Number(row.id) === Number(viewerId)
    || viewerIsAdmin).filter((row) => viewerIsAdmin
      || Number(row.id) === Number(viewerId)
      || !blockRows.some((block) => Number(block.blocker_user_id) === Number(row.id) && Number(block.blocked_user_id) === Number(viewerId)))
    .map((row) => {
    const userBooks = bookRows.filter((book) => Number(book.user_id) === Number(row.id) && (!hideAdultMaterials || !book.is_adult));
    const library = userBooks.filter((book) => !book.is_author).map((book) => ({
      id: Number(book.id),
      creatorUserId: book.creator_user_id ? Number(book.creator_user_id) : undefined,
      author: book.author,
      title: book.title,
      isbn: book.isbn ?? undefined,
      publisher: book.publisher ?? undefined,
      genres: parseJson(book.genres),
      annotation: book.annotation ?? "",
      pages: "",
      durationHours: "",
      durationMinutes: "",
      format: "Бумажная",
      rating: Number(book.rating ?? 0),
      review: book.short_review ?? "",
      readMonth: book.read_month ? Number(book.read_month) : undefined,
      readYear: book.read_year ? Number(book.read_year) : undefined,
      readingStatus: book.reading_status || "read",
      lastReadChapter: book.last_read_chapter ? Number(book.last_read_chapter) : undefined,
      readingComment: book.reading_comment ?? "",
      isAdult: Boolean(book.is_adult),
      coverUrl: book.cover_path ?? undefined,
      coverTone: book.cover_tone ?? "blue",
      flipUrl: book.flip_url ?? undefined,
      links: linkRows.filter((link) => Number(link.book_id) === Number(book.id)).filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index).map((link) => ({
        id: Number(link.id), label: link.label, url: link.url, action: link.action,
      })),
    }));
    const authorBooks = userBooks.filter((book) => book.is_author).map((book) => ({
      id: Number(book.id),
      creatorUserId: book.creator_user_id ? Number(book.creator_user_id) : undefined,
      author: book.author,
      title: book.title,
      isbn: book.isbn ?? undefined,
      publisher: book.publisher ?? undefined,
      genres: parseJson(book.genres),
      annotation: book.annotation ?? "",
      pages: "",
      durationHours: "",
      durationMinutes: "",
      format: "Электронная",
      coverUrl: book.cover_path ?? undefined,
      coverTone: book.cover_tone ?? "blue",
      flipUrl: book.flip_url ?? undefined,
      isAdult: Boolean(book.is_adult),
      links: linkRows.filter((link) => Number(link.book_id) === Number(book.id)).filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index).map((link) => ({
        id: Number(link.id), label: link.label, url: link.url, action: link.action,
      })),
    }));
    return {
      id: Number(row.id),
      username: row.username,
      initials: row.initials,
      color: row.color,
      avatarUrl: row.deleted_at || row.purged_at ? undefined : row.avatar_path ?? undefined,
      isAdmin: row.role === "admin",
      blockedByMe: blockRows.some((block) => Number(block.blocker_user_id) === Number(viewerId) && Number(block.blocked_user_id) === Number(row.id)),
      suspension: viewerIsAdmin && (row.suspended_permanently || row.suspended_until) ? {
        permanent: Boolean(row.suspended_permanently),
        until: row.suspended_until ? new Date(row.suspended_until).toISOString() : undefined,
        reason: row.suspension_reason ?? "",
      } : undefined,
      joined: formatDate(row.created_at),
      joinedAt: new Date(row.created_at).toISOString(),
      online: Boolean(!row.deleted_at && !row.purged_at && row.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < 90_000),
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : undefined,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : undefined,
      deletionExpiresAt: row.deletion_expires_at ? new Date(row.deletion_expires_at).toISOString() : undefined,
      purged: Boolean(row.purged_at),
      profile: {
        name: row.display_name,
        city: row.city,
        cityId: row.city_id ? Number(row.city_id) : undefined,
        country: row.country_name ?? undefined,
        type: row.profile_type,
        gender: row.gender ?? "Не указан",
        birthDate: Number(row.id) === Number(viewerId) || viewerIsAdmin || row.show_birth_date_to_friends && isViewerFriend(row.id) ? sqlDate(row.birth_date) || undefined : undefined,
        age: Number(row.id) === Number(viewerId) || viewerIsAdmin ? ageFromBirthDate(row.birth_date) ?? undefined : undefined,
        showBirthDateToFriends: Number(row.id) === Number(viewerId) || viewerIsAdmin ? Boolean(row.show_birth_date_to_friends) : undefined,
        tabOrder: parseJson(row.profile_tab_order),
        bio: row.bio ?? "",
        authorInfluences: row.author_influences ?? "",
        writingThemes: row.writing_themes ?? "",
        weekend: row.weekend ?? "",
        joy: row.joy ?? "",
        talk: row.talk ?? "",
        strangerMessage: row.stranger_message ?? "",
        favoriteGenres: parseJson(row.favorite_genres),
        dislikedGenres: parseJson(row.disliked_genres),
        publisherStatus: row.publisher_status ?? (row.profile_type === "Издатель" ? "pending" : "not_required"),
        publisherWebsite: row.publisher_website ?? "",
        publisherSalesLinks: parseJson(row.publisher_sales_links),
        publisherLegalName: viewerIsAdmin || Number(row.id) === Number(viewerId) ? row.publisher_legal_name ?? "" : "",
        publisherBin: viewerIsAdmin || Number(row.id) === Number(viewerId) ? row.publisher_bin ?? "" : "",
        publisherAccount: viewerIsAdmin || Number(row.id) === Number(viewerId) ? row.publisher_account ?? "" : "",
        publisherBik: viewerIsAdmin || Number(row.id) === Number(viewerId) ? row.publisher_bik ?? "" : "",
        publisherBank: viewerIsAdmin || Number(row.id) === Number(viewerId) ? row.publisher_bank ?? "" : "",
        publisherLegalAddress: viewerIsAdmin || Number(row.id) === Number(viewerId) ? row.publisher_legal_address ?? "" : "",
        publisherPostalAddress: viewerIsAdmin || Number(row.id) === Number(viewerId) ? row.publisher_postal_address ?? "" : "",
        publisherModerationNote: viewerIsAdmin || Number(row.id) === Number(viewerId) ? row.publisher_moderation_note ?? "" : "",
      },
      books: library,
      authorBooks,
      reviews: reviewRows.filter((review) => Number(review.user_id) === Number(row.id) && (!hideAdultMaterials || !review.is_adult)).map((review) => ({
        id: Number(review.id),
        bookId: Number(review.book_id),
        bookTitle: review.book_title,
        bookAuthor: review.book_author,
        rating: Number(review.rating),
        preview: review.preview,
        fullText: review.body,
        isAdult: Boolean(review.is_adult),
        createdAt: formatDate(review.created_at),
        createdAtValue: new Date(review.created_at).toISOString(),
      })),
      excerpts: excerptRows.filter((excerpt) => Number(excerpt.user_id) === Number(row.id) && (!hideAdultMaterials || !excerpt.is_adult)).map((excerpt) => ({
        id: Number(excerpt.id),
        bookId: excerpt.book_id ? Number(excerpt.book_id) : undefined,
        bookTitle: excerpt.book_title ?? "",
        previewText: excerpt.preview_text ?? excerpt.body?.slice(0, 500) ?? "",
        bodyHtml: excerpt.body_html ?? "",
        text: excerpt.body ?? "",
        isAdult: Boolean(excerpt.is_adult),
        link: excerpt.read_url ?? "",
        createdAt: formatDate(excerpt.created_at),
        createdAtValue: new Date(excerpt.created_at).toISOString(),
      })),
      publisherNews: publisherNewsRows.filter((item) => Number(item.user_id) === Number(row.id) && (!hideAdultMaterials || !item.is_adult)).map((item) => ({
        id: Number(item.id),
        ownerId: Number(item.user_id),
        title: item.title,
        previewText: item.preview_text,
        bodyHtml: item.body_html,
        body: item.body,
        isAdult: Boolean(item.is_adult),
        createdAt: formatDate(item.created_at),
        createdAtValue: new Date(item.created_at).toISOString(),
      })),
    };
  });
}

export async function loadBootstrap(userId, options = {}) {
  const pool = getPool();
  const sections = new Set(options.sections ?? ["catalog", "social", "moderation"]);
  const includeCatalog = sections.has("catalog");
  const includeSocial = sections.has("social");
  const includeModeration = sections.has("moderation");
  const [[accountState]] = await pool.query(
    `SELECT u.profile_completed, u.role, p.gender, p.profile_type, p.birth_date
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.id = ?
      LIMIT 1`,
    [userId],
  );
  const account = {
    isAdmin: accountState?.role === "admin",
    profile: { gender: accountState?.gender, type: accountState?.profile_type, age: ageFromBirthDate(accountState?.birth_date) ?? undefined },
  };
  const [blockRows] = includeCatalog || includeSocial ? await pool.query(
    "SELECT blocker_user_id, blocked_user_id, created_at FROM user_blocks WHERE blocker_user_id = ? OR blocked_user_id = ?",
    [userId, userId],
  ) : [[]];
  const hiddenUserIds = new Set(blockRows.flatMap((row) => [Number(row.blocker_user_id), Number(row.blocked_user_id)]).filter((id) => id !== Number(userId)));
  const users = includeCatalog ? await loadUsers(pool, userId) : [];
  const currentUser = users.find((user) => user.id === Number(userId)) ?? account;
  const viewerAge = ageFromBirthDate(accountState?.birth_date);
  const adultStatus = currentUser?.isAdmin || Number(viewerAge ?? -1) >= 18 ? "adult" : viewerAge === null ? "missing" : "minor";
  const [adultRestrictedRows] = includeCatalog && adultStatus !== "adult" ? await pool.query(
    `SELECT 'book' AS material_kind, id FROM books WHERE is_adult = 1
     UNION ALL SELECT 'review', id FROM reviews WHERE is_adult = 1
     UNION ALL SELECT 'excerpt', id FROM excerpts WHERE is_adult = 1
     UNION ALL SELECT 'event', id FROM events WHERE is_adult = 1 AND status = 'published'
     UNION ALL SELECT 'occasion', id FROM occasions WHERE is_adult = 1 AND status = 'published'`,
  ) : [[]];
  const restrictedAdultMaterials = adultRestrictedRows.reduce((result, row) => {
    result[row.material_kind] ??= [];
    result[row.material_kind].push(Number(row.id));
    return result;
  }, {});
  const [requestRows] = includeSocial ? await pool.query(
    `SELECT id, from_user_id, to_user_id, status, message, rejection_comment
       FROM friend_requests
      WHERE from_user_id = ? OR to_user_id = ?
      ORDER BY created_at`, [userId, userId],
  ) : [[]];
  const [friendshipRows] = includeCatalog || includeSocial ? await pool.query(
    `SELECT user_low_id, user_high_id FROM friendships
      WHERE user_low_id = ? OR user_high_id = ?`, [userId, userId],
  ) : [[]];
  const [wishlistRows] = includeCatalog ? await pool.query(
    `SELECT w.id, w.user_id, w.catalog_book_id, w.author, w.title, w.genres,
            COALESCE(NULLIF(w.annotation, ''), b.annotation, '') AS annotation,
            COALESCE(w.cover_path, b.cover_path) AS cover_path,
            COALESCE(b.cover_tone, w.cover_tone) AS cover_tone,
            w.marketplace, w.product_url, w.pickup_address, w.recipient_name, w.recipient_phone,
            w.price_amount, w.price_currency, w.price_checked_at,
            w.reserved_by_user_id, w.reserved_at, w.created_at
       FROM wishlist_items w
       LEFT JOIN books b ON b.id = w.catalog_book_id
      ORDER BY w.created_at DESC`,
  ) : [[]];
  const [followRows] = includeSocial ? await pool.query(
    `SELECT follower_user_id, target_user_id FROM follows
      WHERE follower_user_id = ? OR target_user_id = ?`, [userId, userId],
  ) : [[]];
  const [notificationRows] = includeSocial ? await pool.query(
    `SELECT id, user_id, actor_user_id, notification_type, title, body, material_kind, material_id, is_unread, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`, [userId],
  ) : [[]];
  const [messageRows] = includeSocial ? await pool.query(
    `SELECT id, sender_user_id, recipient_user_id, body, attachment_kind, attachment_id, is_system, read_at, created_at
       FROM messages
      WHERE sender_user_id = ? OR recipient_user_id = ?
      ORDER BY created_at`, [userId, userId],
  ) : [[]];
  const [likeRows] = includeSocial ? await pool.query("SELECT user_id, material_kind, material_id FROM material_likes") : [[]];
  const [eventRows] = includeCatalog ? await pool.query(
    `SELECT e.id, e.creator_user_id, e.title, e.summary, e.description, e.event_date, e.event_time,
            e.city, e.city_id, ec.country_name AS city_country, e.address, e.map_url, e.details_url, e.book_id, e.is_pinned, e.is_adult,
            e.status, e.moderation_note, e.created_at,
            b.title AS book_title, b.author AS book_author, b.annotation AS book_annotation,
            b.cover_path AS book_cover_path, b.cover_tone AS book_cover_tone,
            er.user_id AS reminder_user_id,
            reminder_users.user_ids AS reminder_user_ids,
            reminder_users.reminder_count
       FROM events e
       LEFT JOIN cities ec ON ec.id = e.city_id
       LEFT JOIN books b ON b.id = e.book_id
       LEFT JOIN event_reminders er ON er.event_id = e.id AND er.user_id = ?
       LEFT JOIN (
         SELECT event_id,
                SUBSTRING_INDEX(GROUP_CONCAT(user_id ORDER BY created_at, user_id), ',', 4) AS user_ids,
                COUNT(*) AS reminder_count
           FROM event_reminders
          GROUP BY event_id
       ) reminder_users ON reminder_users.event_id = e.id
      WHERE ? = 1 OR e.status = 'published' OR e.creator_user_id = ?
      ORDER BY e.is_pinned DESC, e.event_date, e.event_time, e.created_at`,
    [userId, currentUser?.isAdmin ? 1 : 0, userId],
  ) : [[]];
  const [occasionRows] = includeCatalog ? await pool.query(
    `SELECT o.id, o.creator_user_id, o.occasion_type, o.primary_text, o.audience_text,
            o.target_gender, o.target_cities, o.target_profile_type, o.meeting_date,
            o.meeting_start_time, o.meeting_end_time, o.status, o.is_adult,
            o.moderation_note, o.created_at, p.display_name AS creator_name
       FROM occasions o
       JOIN profiles p ON p.user_id = o.creator_user_id
      WHERE ? = 1 OR o.status = 'published' OR o.creator_user_id = ?
      ORDER BY o.created_at DESC`,
    [currentUser?.isAdmin ? 1 : 0, userId],
  ) : [[]];
  const [reportRows] = includeModeration && currentUser?.isAdmin ? await pool.query(
    `SELECT r.id, r.reporter_user_id, r.target_kind, r.target_id, r.target_user_id, r.reason,
            r.status, r.created_at, reporter.display_name AS reporter_name, target.display_name AS target_user_name,
            COALESCE(
              CASE WHEN r.target_kind = 'user' THEN target.display_name END,
              CASE WHEN r.target_kind = 'book' THEN (SELECT title FROM books WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'review' THEN (SELECT b.title FROM reviews rv JOIN books b ON b.id = rv.book_id WHERE rv.id = r.target_id) END,
              CASE WHEN r.target_kind = 'excerpt' THEN (SELECT COALESCE(NULLIF(book_title, ''), 'Публикация') FROM excerpts WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'event' THEN (SELECT title FROM events WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'occasion' THEN (SELECT primary_text FROM occasions WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'publisher_news' THEN (SELECT title FROM publisher_news WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'chat' THEN CONCAT('Диалог с ', target.display_name) END,
              CASE WHEN r.target_kind = 'comment' THEN CONCAT('Комментарий: ', (SELECT LEFT(body, 180) FROM material_comments WHERE id = r.target_id)) END,
              'Удалённый материал'
            ) AS target_title,
            CASE WHEN r.target_kind = 'comment' THEN (SELECT body FROM material_comments WHERE id = r.target_id) END AS comment_text,
            CASE WHEN r.target_kind = 'comment' THEN (SELECT material_kind FROM material_comments WHERE id = r.target_id) END AS comment_material_kind,
            CASE WHEN r.target_kind = 'comment' THEN (SELECT material_id FROM material_comments WHERE id = r.target_id) END AS comment_material_id
       FROM reports r
       JOIN profiles reporter ON reporter.user_id = r.reporter_user_id
       LEFT JOIN profiles target ON target.user_id = r.target_user_id
      ORDER BY r.created_at DESC`,
  ) : [[]];
  const [reportedConversationRows] = includeModeration && currentUser?.isAdmin ? await pool.query(
    `SELECT r.id AS report_id, m.id, m.sender_user_id, m.recipient_user_id, m.body,
            m.attachment_kind, m.attachment_id, m.is_system, m.read_at, m.created_at
       FROM reports r
       JOIN messages m ON r.target_kind = 'chat' AND (
         (m.sender_user_id = r.reporter_user_id AND m.recipient_user_id = r.target_user_id)
         OR (m.sender_user_id = r.target_user_id AND m.recipient_user_id = r.reporter_user_id)
       )
      ORDER BY r.id, m.created_at`,
  ) : [[]];
  const conversationByReport = new Map();
  for (const row of reportedConversationRows) {
    const reportId = Number(row.report_id);
    if (!conversationByReport.has(reportId)) conversationByReport.set(reportId, []);
    conversationByReport.get(reportId).push({
      id: Number(row.id),
      mine: false,
      senderId: row.sender_user_id ? Number(row.sender_user_id) : undefined,
      text: row.body,
      attachment: row.attachment_kind && row.attachment_id ? { kind: row.attachment_kind, id: Number(row.attachment_id) } : undefined,
      system: Boolean(row.is_system),
      read: Boolean(row.read_at),
      createdAt: new Date(row.created_at).toISOString(),
      time: new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(row.created_at)),
    });
  }
  const messages = {};
  for (const row of messageRows) {
    const otherId = Number(row.sender_user_id) === Number(userId) ? Number(row.recipient_user_id) : Number(row.sender_user_id ?? row.recipient_user_id);
    if (!currentUser?.isAdmin && hiddenUserIds.has(otherId)) continue;
    const key = [Number(userId), otherId].sort((a, b) => a - b).join("-");
    messages[key] ??= [];
    messages[key].push({
      id: Number(row.id),
      mine: Number(row.sender_user_id) === Number(userId),
      senderId: row.sender_user_id ? Number(row.sender_user_id) : undefined,
      text: row.body,
      attachment: row.attachment_kind && row.attachment_id ? { kind: row.attachment_kind, id: Number(row.attachment_id) } : undefined,
      system: Boolean(row.is_system),
      unread: Number(row.recipient_user_id) === Number(userId) && !row.read_at && !row.is_system,
      read: Boolean(row.read_at),
      createdAt: new Date(row.created_at).toISOString(),
      time: new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(row.created_at)),
    });
  }
  const likes = {};
  for (const row of likeRows) {
    if (!currentUser?.isAdmin && hiddenUserIds.has(Number(row.user_id))) continue;
    const key = `${row.material_kind}-${row.material_id}`;
    likes[key] ??= [];
    likes[key].push(Number(row.user_id));
  }
  const visibleWishlistOwnerIds = new Set([Number(userId)]);
  for (const row of friendshipRows) {
    visibleWishlistOwnerIds.add(Number(row.user_low_id) === Number(userId) ? Number(row.user_high_id) : Number(row.user_low_id));
  }
  const usersWithWishlists = users.map((user) => ({
    ...user,
    wishBooks: wishlistRows.filter((row) => Number(row.user_id) === user.id).map((row) => {
      const privateVisible = visibleWishlistOwnerIds.has(user.id);
      return {
        id: Number(row.id), ownerId: user.id,
        catalogBookId: row.catalog_book_id ? Number(row.catalog_book_id) : undefined,
        author: row.author, title: row.title, genres: parseJson(row.genres), annotation: row.annotation ?? "",
        coverUrl: row.cover_path ?? undefined, coverTone: row.cover_tone ?? "blue",
        marketplace: row.marketplace, privateVisible,
        productUrl: privateVisible && user.id === Number(userId) ? row.product_url : undefined,
        pickupAddress: privateVisible ? row.pickup_address : undefined,
        recipientName: privateVisible ? row.recipient_name : undefined,
        phone: privateVisible ? row.recipient_phone : undefined,
        price: privateVisible && row.price_amount != null ? Number(row.price_amount) : undefined,
        priceCurrency: privateVisible ? row.price_currency : undefined,
        priceCheckedAt: privateVisible && row.price_checked_at ? new Date(row.price_checked_at).toISOString() : undefined,
        reservedByUserId: privateVisible && row.reserved_by_user_id ? Number(row.reserved_by_user_id) : undefined,
        reservedAt: privateVisible && row.reserved_at ? new Date(row.reserved_at).toISOString() : undefined,
      };
    }),
  }));
  const visibleOccasionRows = occasionRows.filter((row) => {
    if (currentUser?.isAdmin) return true;
    if (row.is_adult && adultStatus !== "adult") return false;
    if (Number(row.creator_user_id) === Number(userId)) return true;
    if (row.status !== "published") return false;
    const genderMatch = row.target_gender === "Все" || row.target_gender === currentUser?.profile.gender;
    const typeMatch = row.target_profile_type === "Все" || row.target_profile_type === currentUser?.profile.type;
    return genderMatch && typeMatch;
  });
  return {
    activeUserId: Number(userId),
    profileCompleted: Boolean(accountState?.profile_completed),
    adultAccess: { status: adultStatus, restricted: restrictedAdultMaterials },
    users: usersWithWishlists,
    blocks: blockRows.map((row) => ({ blockerId: Number(row.blocker_user_id), blockedId: Number(row.blocked_user_id), createdAt: new Date(row.created_at).toISOString() })),
    blockedByUserIds: blockRows.filter((row) => Number(row.blocked_user_id) === Number(userId)).map((row) => Number(row.blocker_user_id)),
    reports: reportRows.map((row) => ({ id: Number(row.id), reporterId: Number(row.reporter_user_id), reporterName: row.reporter_name, targetKind: row.target_kind, targetId: Number(row.target_id), targetUserId: row.target_user_id ? Number(row.target_user_id) : undefined, targetUserName: row.target_user_name ?? undefined, targetTitle: row.target_title, reason: row.reason, status: row.status, createdAt: new Date(row.created_at).toISOString(), commentText: row.comment_text ?? undefined, materialKind: row.comment_material_kind ?? undefined, materialId: row.comment_material_id ? Number(row.comment_material_id) : undefined, conversationMessages: conversationByReport.get(Number(row.id)) })),
    friendRequests: requestRows.filter((row) => currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.from_user_id)) && !hiddenUserIds.has(Number(row.to_user_id)))).map((row) => ({ id: Number(row.id), fromId: Number(row.from_user_id), toId: Number(row.to_user_id), status: row.status, message: row.message ?? undefined, comment: row.rejection_comment ?? undefined })),
    friendships: friendshipRows.filter((row) => currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.user_low_id)) && !hiddenUserIds.has(Number(row.user_high_id)))).map((row) => ({ userA: Number(row.user_low_id), userB: Number(row.user_high_id) })),
    follows: followRows.filter((row) => currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.follower_user_id)) && !hiddenUserIds.has(Number(row.target_user_id)))).map((row) => ({ followerId: Number(row.follower_user_id), targetId: Number(row.target_user_id) })),
    notifications: notificationRows.filter((row) => currentUser?.isAdmin || !hiddenUserIds.has(Number(row.actor_user_id))).map((row) => ({ id: Number(row.id), userId: Number(row.user_id), actorId: Number(row.actor_user_id ?? row.user_id), type: row.notification_type, title: row.title, text: row.body, unread: Boolean(row.is_unread), createdAt: formatDate(row.created_at), materialId: row.material_id ? Number(row.material_id) : undefined, materialKind: row.material_kind ?? undefined })),
    messages,
    likes,
    events: eventRows.filter((row) => (currentUser?.isAdmin || !hiddenUserIds.has(Number(row.creator_user_id))) && (currentUser?.isAdmin || !row.is_adult || Number(currentUser?.profile.age ?? -1) >= 18)).map((row) => ({
      id: Number(row.id), creatorId: Number(row.creator_user_id), title: row.title,
      summary: row.summary, description: row.description, date: sqlDate(row.event_date),
      isAdult: Boolean(row.is_adult),
      time: String(row.event_time).slice(0, 5), city: row.city, country: row.city_country ?? undefined,
      cityId: row.city_id ? Number(row.city_id) : undefined, address: row.address,
      mapUrl: row.map_url ?? "", detailsUrl: row.details_url ?? "", status: row.status,
      moderationNote: row.moderation_note ?? "",
      linkedBookId: row.book_id ? Number(row.book_id) : undefined,
      bookTitle: row.book_title ?? undefined, bookAuthor: row.book_author ?? undefined,
      bookAnnotation: row.book_annotation ?? undefined, bookCoverUrl: row.book_cover_path ?? undefined,
      bookCoverTone: row.book_cover_tone ?? undefined, pinned: Boolean(row.is_pinned),
      reminderSet: Boolean(row.reminder_user_id),
      reminderUserIds: String(row.reminder_user_ids ?? "").split(",").map(Number).filter(Boolean),
      reminderCount: Number(row.reminder_count ?? 0),
      createdAt: new Date(row.created_at).toISOString(),
    })),
    occasions: visibleOccasionRows.filter((row) => currentUser?.isAdmin || !hiddenUserIds.has(Number(row.creator_user_id))).map((row) => ({
      id: Number(row.id), creatorId: Number(row.creator_user_id), type: row.occasion_type,
      primaryText: row.primary_text, audienceText: row.audience_text,
      isAdult: Boolean(row.is_adult),
      targetGender: row.target_gender, targetCities: parseJson(row.target_cities),
      targetProfileType: row.target_profile_type,
      meetingDate: sqlDate(row.meeting_date) || undefined,
      meetingStartTime: row.meeting_start_time ? String(row.meeting_start_time).slice(0, 5) : undefined,
      meetingEndTime: row.meeting_end_time ? String(row.meeting_end_time).slice(0, 5) : undefined,
      status: row.status,
      moderationNote: row.moderation_note ?? "", creatorName: row.creator_name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}

export async function resolveBook(connection, author, title, creatorUserId = null) {
  const cleanAuthor = String(author ?? "").trim();
  const cleanTitle = String(title ?? "").trim();
  const authorKey = normalizeIdentity(cleanAuthor);
  const titleKey = normalizeIdentity(cleanTitle);
  const [[existing]] = await connection.query("SELECT id, author, title FROM books WHERE author_key = ? AND title_key = ? LIMIT 1", [authorKey, titleKey]);
  if (existing) return existing;
  const [result] = await connection.query(
    "INSERT INTO books (creator_user_id, author, author_key, title, title_key, genres, annotation) VALUES (?, ?, ?, ?, ?, '[]', '')",
    [creatorUserId, cleanAuthor, authorKey, cleanTitle, titleKey],
  );
  return { id: result.insertId, author: cleanAuthor, title: cleanTitle };
}
