import { getPool } from "./db.js";
import { readingStateDto } from "./modules/reading-state.js";
import { legalAccessState, profileAccessState } from "./modules/compliance.js";
import { archivedBookSticker, stickerDto } from "./modules/book-stickers.js";
import { normalizeIdentity } from "./security.js";

const NEUTRAL_MENTION_TOKEN = "@пользователь";

function neutralizeMentionedText(value, mentions = []) {
  let result = String(value ?? "");
  let cursor = 0;
  const replacements = mentions.map((mention) => {
    const sourceToken = String(mention.sourceToken ?? "");
    const replacementToken = String(mention.token ?? NEUTRAL_MENTION_TOKEN);
    return { sourceToken, replacementToken, index: sourceToken ? result.indexOf(sourceToken) : -1 };
  }).filter((entry) => entry.index >= 0 && entry.sourceToken && entry.replacementToken && entry.sourceToken !== entry.replacementToken)
    .sort((left, right) => left.index - right.index);
  for (const { sourceToken, replacementToken } of replacements) {
    const index = result.indexOf(sourceToken, cursor);
    if (index < 0) continue;
    result = `${result.slice(0, index)}${replacementToken}${result.slice(index + sourceToken.length)}`;
    cursor = index + replacementToken.length;
  }
  return result;
}

export function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value ?? "null") ?? fallback; } catch { return fallback; }
}

export function formatDate(value) {
  const date = value ? new Date(value) : new Date();
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
  const [hideRows] = viewerId ? await connection.query(
    "SELECT hidden_user_id FROM user_hides WHERE hider_user_id = ?",
    [viewerId],
  ) : [[]];
  const hiddenOwnerIds = new Set(hideRows.map((row) => Number(row.hidden_user_id)));
  const [viewerFriendRows] = viewerId ? await connection.query(
    "SELECT user_low_id, user_high_id FROM friendships WHERE user_low_id = ? OR user_high_id = ?",
    [viewerId, viewerId],
  ) : [[]];
  const [userRows] = await connection.query(
    `SELECT u.id, u.username, u.username_is_temporary, u.initials, u.color, u.avatar_path, u.role, u.created_at, u.last_seen_at,
            u.deleted_at, u.deletion_expires_at, u.purged_at,
            u.suspension_reason, u.suspended_until, u.suspended_permanently,
            p.display_name, p.city, p.city_id, c.country_name, p.profile_type, p.gender, p.birth_date, p.show_birth_date_to_friends, p.birth_date_visibility, p.followers_visibility, p.friends_visibility, p.wishlist_visibility, p.profile_tab_order, p.hidden_profile_tabs, p.home_view,
            p.bio, p.author_influences, p.writing_themes, p.weekend, p.joy, p.talk,
            p.stranger_message, p.favorite_genres, p.disliked_genres,
            p.publisher_status, p.publisher_website, p.publisher_sales_links, p.publisher_legal_name,
            p.publisher_bin, p.publisher_account, p.publisher_bik, p.publisher_bank,
            p.publisher_legal_address, p.publisher_postal_address, p.publisher_moderation_note, p.community_type, p.community_rules, p.community_is_closed
            , (SELECT COUNT(*) FROM friendships f WHERE f.user_low_id = u.id OR f.user_high_id = u.id) AS friend_count
            , (SELECT COUNT(*) FROM follows fl WHERE fl.target_user_id = u.id
                 AND NOT EXISTS (SELECT 1 FROM friendships f2 WHERE (f2.user_low_id = u.id AND f2.user_high_id = fl.follower_user_id) OR (f2.user_high_id = u.id AND f2.user_low_id = fl.follower_user_id))) AS follower_count
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN cities c ON c.id = p.city_id
      ORDER BY u.id`,
  );
  const [allFriendshipRows] = await connection.query("SELECT user_low_id, user_high_id FROM friendships");
  const [allFollowRows] = await connection.query("SELECT follower_user_id, target_user_id FROM follows");
  const [allCommunityMembershipRows] = await connection.query("SELECT community_user_id, member_user_id FROM community_memberships");
  const [bookRows] = await connection.query(
    `SELECT ub.user_id, ub.rating, ub.short_review, ub.read_month, ub.read_year, ub.reading_status, ub.top_rank, ub.last_read_chapter, ub.chapters_current, ub.chapters_total, ub.pages_current, ub.pages_total, ub.progress_unit, ub.reading_comment, ub.postponed_month, ub.postponed_year, ub.postponed_timezone, ub.featured_month, ub.featured_year, ub.publication_month, ub.publication_year, ub.is_author,
             b.id, b.creator_user_id, b.author, b.title, b.isbn, b.publisher, b.genres, b.annotation, b.is_adult, b.cover_path, b.cover_tone, b.flip_url, b.created_at AS book_created_at
       FROM user_books ub
       JOIN books b ON b.id = ub.book_id
      ORDER BY (ub.top_rank IS NULL), ub.top_rank, ub.created_at DESC, ub.book_id`,
  );
  const [cycleRows] = await connection.query(
    `SELECT c.id, c.user_id, c.book_id, c.completed_month, c.completed_year, c.completed_at, c.status,
            b.author, b.title, b.cover_path, b.cover_tone, b.is_adult
       FROM reading_cycles c JOIN books b ON b.id = c.book_id
      WHERE c.status = 'completed' ORDER BY c.completed_at DESC, c.id DESC`,
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
  const [materialBookRows] = await connection.query(
    `SELECT mb.material_kind, mb.material_id, mb.book_id, mb.position,
            b.title, b.author, b.annotation, b.cover_path, b.cover_tone
       FROM material_books mb
       JOIN books b ON b.id = mb.book_id
      WHERE mb.material_kind IN ('review', 'excerpt')
      ORDER BY mb.material_kind, mb.material_id, mb.position`,
  );
  const [publisherNewsRows] = await connection.query(
    `SELECT id, user_id, title, preview_text, body_html, body, is_adult, created_at
       FROM publisher_news
      ORDER BY created_at DESC`,
  );
  const [contentMentionRows] = await connection.query(
    `SELECT m.entity_type, m.entity_id, m.mentioned_user_id, m.mention_token, u.username, u.role, p.display_name, p.profile_type, p.birth_date, u.deleted_at, u.purged_at
       FROM content_mentions m JOIN users u ON u.id = m.mentioned_user_id JOIN profiles p ON p.user_id = u.id
      WHERE m.entity_type IN ('review', 'excerpt', 'publisher_news', 'event', 'occasion')`,
  );
  const [cleanRepostRows] = await connection.query(
    `SELECT r.id, r.user_id, r.source_root_type, r.source_root_id, r.created_at,
            COALESCE(rv.user_id, ex.user_id, pn.user_id, ev.creator_user_id, oc.creator_user_id, sh.owner_user_id) AS source_owner_id,
            source_user.deleted_at AS source_owner_deleted_at, source_user.purged_at AS source_owner_purged_at,
            source_profile.publisher_status AS source_owner_publisher_status,
            COALESCE(b.title, NULLIF(ex.book_title, ''), pn.title, ev.title, oc.primary_text, sh.title, 'Материал') AS source_title,
            COALESCE(rv.is_adult, ex.is_adult, pn.is_adult, ev.is_adult, oc.is_adult, 0) AS source_is_adult,
            CASE WHEN r.source_root_type = 'review' THEN rv.id WHEN r.source_root_type = 'excerpt' THEN ex.id WHEN r.source_root_type = 'publisher_news' THEN pn.id WHEN r.source_root_type = 'event' AND ev.status = 'published' THEN ev.id WHEN r.source_root_type = 'occasion' AND oc.status = 'published' THEN oc.id WHEN r.source_root_type = 'shelf' THEN sh.id END AS source_exists
       FROM reposts r
       LEFT JOIN reviews rv ON r.source_root_type = 'review' AND rv.id = r.source_root_id
       LEFT JOIN books b ON b.id = rv.book_id
       LEFT JOIN excerpts ex ON r.source_root_type = 'excerpt' AND ex.id = r.source_root_id
       LEFT JOIN publisher_news pn ON r.source_root_type = 'publisher_news' AND pn.id = r.source_root_id
       LEFT JOIN events ev ON r.source_root_type = 'event' AND ev.id = r.source_root_id
       LEFT JOIN occasions oc ON r.source_root_type = 'occasion' AND oc.id = r.source_root_id
       LEFT JOIN book_shelves sh ON r.source_root_type = 'shelf' AND sh.id = r.source_root_id
       LEFT JOIN users source_user ON source_user.id = COALESCE(rv.user_id, ex.user_id, pn.user_id, ev.creator_user_id, oc.creator_user_id, sh.owner_user_id)
       LEFT JOIN profiles source_profile ON source_profile.user_id = source_user.id
      WHERE r.clean_source_root_id IS NOT NULL ORDER BY r.created_at DESC`,
  );
  const [shelfRows] = await connection.query(
    `SELECT s.id, s.owner_user_id, s.title, s.description, s.created_at, s.updated_at,
            i.book_id, i.position, i.description AS item_description,
            b.author, b.title AS book_title, b.annotation, b.cover_path, b.cover_tone, b.is_adult, ub.rating
       FROM book_shelves s
       LEFT JOIN book_shelf_items i ON i.shelf_id = s.id
       LEFT JOIN books b ON b.id = i.book_id
       LEFT JOIN user_books ub ON ub.user_id = s.owner_user_id AND ub.book_id = i.book_id AND ub.is_author = 0
      ORDER BY s.id DESC, i.position`,
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
  const personalTypes = new Set(["Читатель", "Писатель", "Блогер"]);
  const viewerPersonal = personalTypes.has(viewerRow?.profile_type);
  const mentionsFor = (entityType, entityId) => contentMentionRows.filter((mention) => mention.entity_type === entityType && Number(mention.entity_id) === Number(entityId)).map((mention) => {
    const targetId = Number(mention.mentioned_user_id);
    const targetPersonal = personalTypes.has(mention.profile_type);
    const ageCompatible = viewerIsAdmin || !viewerPersonal || !targetPersonal
      || viewerAge !== null && ageFromBirthDate(mention.birth_date) !== null && (viewerAge < 18) === (ageFromBirthDate(mention.birth_date) < 18);
    const unavailable = mention.deleted_at || mention.purged_at || hiddenOwnerIds.has(targetId) || !ageCompatible || blockRows.some((block) => (Number(block.blocker_user_id) === Number(viewerId) && Number(block.blocked_user_id) === targetId) || (Number(block.blocked_user_id) === Number(viewerId) && Number(block.blocker_user_id) === targetId));
    const entry = { userId: targetId, token: unavailable ? NEUTRAL_MENTION_TOKEN : mention.mention_token, ...(unavailable ? {} : { username: mention.username, displayName: mention.display_name }) };
    Object.defineProperty(entry, "sourceToken", { value: String(mention.mention_token ?? ""), enumerable: false });
    return entry;
  });
  return userRows.filter((row) => row.role === "admin"
    || !["Издатель", "Сообщество"].includes(row.profile_type)
    || row.publisher_status === "approved"
    || Number(row.id) === Number(viewerId)
    || viewerIsAdmin).filter((row) => viewerIsAdmin
      || Number(row.id) === Number(viewerId)
      || !blockRows.some((block) => Number(block.blocker_user_id) === Number(row.id) && Number(block.blocked_user_id) === Number(viewerId)))
    .map((row) => {
    const isOwner = Number(row.id) === Number(viewerId);
    const blockedPair = !isOwner && blockRows.some((block) => (Number(block.blocker_user_id) === Number(viewerId) && Number(block.blocked_user_id) === Number(row.id)) || (Number(block.blocked_user_id) === Number(viewerId) && Number(block.blocker_user_id) === Number(row.id)));
    const targetAge = ageFromBirthDate(row.birth_date);
    const crossAge = !isOwner && viewerAge !== null && targetAge !== null && (viewerAge < 18) !== (targetAge < 18);
    const userBooks = bookRows.filter((book) => Number(book.user_id) === Number(row.id) && (!hideAdultMaterials || !book.is_adult));
    const visibleUserBooks = blockedPair || crossAge ? [] : userBooks;
    const library = visibleUserBooks.filter((book) => !book.is_author).map((book) => ({
      id: Number(book.id),
      catalogBookId: Number(book.id),
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
      ...readingStateDto(book, { owner: Number(row.id) === Number(viewerId) }),
      hasCompletedReading: cycleRows.some((cycle) => Number(cycle.user_id) === Number(row.id) && Number(cycle.book_id) === Number(book.id)),
      topRank: book.top_rank ? Number(book.top_rank) : undefined,
      isAdult: Boolean(book.is_adult),
      coverUrl: book.cover_path ?? undefined,
      coverTone: book.cover_tone ?? "blue",
      flipUrl: book.flip_url ?? undefined,
      links: linkRows.filter((link) => Number(link.book_id) === Number(book.id)).filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index).map((link) => ({
        id: Number(link.id), label: link.label, url: link.url, action: link.action,
      })),
      createdAtValue: book.book_created_at ? new Date(book.book_created_at).toISOString() : undefined,
    }));
    const authorBooks = visibleUserBooks.filter((book) => book.is_author).map((book) => ({
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
      featuredMonth: book.featured_month ? Number(book.featured_month) : undefined,
      featuredYear: book.featured_year ? Number(book.featured_year) : undefined,
      publicationMonth: book.publication_month ? Number(book.publication_month) : undefined,
      publicationYear: book.publication_year ? Number(book.publication_year) : undefined,
      createdAtValue: book.book_created_at ? new Date(book.book_created_at).toISOString() : undefined,
    }));
    const communityBooks = row.profile_type === "Сообщество" ? [...library, ...authorBooks].map((book) => {
      const association = visibleUserBooks.find((entry) => Number(entry.id) === Number(book.id));
      return { ...book, rating: Number("rating" in book ? book.rating ?? 0 : 0), review: "review" in book ? book.review ?? "" : "", featuredMonth: association?.featured_month ? Number(association.featured_month) : undefined, featuredYear: association?.featured_year ? Number(association.featured_year) : undefined };
    }) : undefined;
    const deletedView = Boolean(row.deleted_at || row.purged_at);
    // Memberships never grant friendship-scoped visibility.
    const isCommunity = row.profile_type === "Сообщество";
    const isPublisher = row.profile_type === "Издатель";
    const isPersonal = ["Читатель", "Писатель", "Блогер"].includes(row.profile_type);
    const canView = (visibility) => viewerIsAdmin || isOwner || visibility === "everyone" || visibility === "friends" && isViewerFriend(row.id);
    const canViewFollowers = !deletedView && (isCommunity || canView(row.followers_visibility ?? "friends"));
    const canViewFriends = !deletedView && (isCommunity || canView(row.friends_visibility ?? "friends"));
    const canViewWishlist = !deletedView && isPersonal && canView(row.wishlist_visibility ?? "friends");
    const profileCompleted = row.role === "admin" || !isPersonal || Boolean(String(row.display_name ?? "").trim() && !row.username_is_temporary && /^[a-z0-9][a-z0-9._-]{2,29}$/i.test(String(row.username ?? "")) && (String(row.city ?? "").trim() || row.city_id) && ageFromBirthDate(row.birth_date) !== null && ["Мужской", "Женский"].includes(row.gender));
    return {
      id: Number(row.id),
      username: deletedView ? "deleted-user" : row.username,
      usernameIsTemporary: !deletedView && Boolean(row.username_is_temporary),
      profileCompleted,
      initials: deletedView ? "—" : row.initials,
      color: row.color,
      avatarUrl: row.deleted_at || row.purged_at ? undefined : row.avatar_path ?? undefined,
      isAdmin: row.role === "admin",
      blockedByMe: blockRows.some((block) => Number(block.blocker_user_id) === Number(viewerId) && Number(block.blocked_user_id) === Number(row.id)),
      // Hiding is deliberately one-way: profile identity remains readable, while
      // social material is projected out below for this particular viewer.
      hiddenByMe: hiddenOwnerIds.has(Number(row.id)),
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
      friendCount: canViewFriends ? Number(row.friend_count ?? 0) : undefined,
      followerCount: canViewFollowers ? Number(row.follower_count ?? 0) : undefined,
      friendIds: canViewFriends ? allFriendshipRows.filter((item) => Number(item.user_low_id) === Number(row.id) || Number(item.user_high_id) === Number(row.id)).map((item) => Number(item.user_low_id) === Number(row.id) ? Number(item.user_high_id) : Number(item.user_low_id)) : undefined,
      followerIds: canViewFollowers ? allFollowRows.filter((item) => Number(item.target_user_id) === Number(row.id)).map((item) => Number(item.follower_user_id)) : undefined,
      memberIds: row.profile_type === "Сообщество" ? allCommunityMembershipRows.filter((item) => Number(item.community_user_id) === Number(row.id)).map((item) => Number(item.member_user_id)) : undefined,
      memberCount: row.profile_type === "Сообщество" ? allCommunityMembershipRows.filter((item) => Number(item.community_user_id) === Number(row.id)).length : undefined,
      profile: {
        name: deletedView ? "Удалённый пользователь" : row.display_name,
        city: deletedView ? "" : row.city,
        cityId: !deletedView && row.city_id ? Number(row.city_id) : undefined,
        country: deletedView ? undefined : row.country_name ?? undefined,
        type: String(row.profile_type ?? "Читатель").trim() || "Читатель",
        gender: deletedView ? "Не указан" : row.gender ?? "Не указан",
        birthDate: !deletedView && (Number(row.id) === Number(viewerId) || viewerIsAdmin || row.birth_date_visibility === "everyone" || row.birth_date_visibility === "friends" && isViewerFriend(row.id)) ? sqlDate(row.birth_date) || undefined : undefined,
        age: !deletedView && (Number(row.id) === Number(viewerId) || viewerIsAdmin) ? ageFromBirthDate(row.birth_date) ?? undefined : undefined,
        ageGroup: deletedView || ageFromBirthDate(row.birth_date) === null ? "missing" : ageFromBirthDate(row.birth_date) < 18 ? "minor" : "adult",
        birthDateVisibility: deletedView ? undefined : Number(row.id) === Number(viewerId) || viewerIsAdmin ? row.birth_date_visibility ?? "friends" : undefined,
        followersVisibility: deletedView || isCommunity || !(isOwner || viewerIsAdmin) ? undefined : row.followers_visibility ?? "friends",
        friendsVisibility: deletedView || isCommunity || !(isOwner || viewerIsAdmin) ? undefined : row.friends_visibility ?? "friends",
        wishlistVisibility: deletedView || isPublisher || isCommunity || !(isOwner || viewerIsAdmin) ? undefined : row.wishlist_visibility ?? "friends",
        canViewFollowers,
        canViewFriends,
        canViewWishlist,
        showBirthDateToFriends: deletedView ? undefined : Number(row.id) === Number(viewerId) || viewerIsAdmin ? Boolean(row.show_birth_date_to_friends) : undefined,
        tabOrder: deletedView ? [] : parseJson(row.profile_tab_order),
        hiddenProfileTabs: deletedView ? [] : parseJson(row.hidden_profile_tabs),
        homeView: row.home_view === "classic" ? "classic" : "feed",
        bio: deletedView ? "" : row.bio ?? "",
        authorInfluences: deletedView ? "" : row.author_influences ?? "",
        writingThemes: deletedView ? "" : row.writing_themes ?? "",
        weekend: deletedView ? "" : row.weekend ?? "",
        joy: deletedView ? "" : row.joy ?? "",
        talk: deletedView ? "" : row.talk ?? "",
        strangerMessage: deletedView ? "" : row.stranger_message ?? "",
        favoriteGenres: deletedView ? [] : parseJson(row.favorite_genres),
        dislikedGenres: deletedView ? [] : parseJson(row.disliked_genres),
        publisherStatus: row.publisher_status ?? (["Издатель", "Сообщество"].includes(row.profile_type) ? "pending" : "not_required"),
        publisherWebsite: deletedView ? "" : row.publisher_website ?? "",
        publisherSalesLinks: deletedView ? [] : parseJson(row.publisher_sales_links),
        publisherLegalName: viewerIsAdmin && !deletedView ? row.publisher_legal_name ?? "" : "",
        publisherBin: viewerIsAdmin && !deletedView ? row.publisher_bin ?? "" : "",
        publisherAccount: viewerIsAdmin && !deletedView ? row.publisher_account ?? "" : "",
        publisherBik: viewerIsAdmin && !deletedView ? row.publisher_bik ?? "" : "",
        publisherBank: viewerIsAdmin && !deletedView ? row.publisher_bank ?? "" : "",
        publisherLegalAddress: viewerIsAdmin && !deletedView ? row.publisher_legal_address ?? "" : "",
        publisherPostalAddress: viewerIsAdmin && !deletedView ? row.publisher_postal_address ?? "" : "",
        publisherModerationNote: viewerIsAdmin && !deletedView ? row.publisher_moderation_note ?? "" : "",
        communityType: deletedView ? "" : row.community_type ?? "",
        communityRules: deletedView ? "" : row.community_rules ?? "",
        communityIsClosed: !deletedView && row.profile_type === "Сообщество" ? Boolean(row.community_is_closed) : false,
      },
      books: row.profile_type === "Сообщество" ? [] : library,
      readingHistory: isOwner ? cycleRows.filter((cycle) => Number(cycle.user_id) === Number(row.id) && (!hideAdultMaterials || !cycle.is_adult)).map((cycle) => ({ id: Number(cycle.id), bookId: Number(cycle.book_id), completedMonth: cycle.completed_month ?? undefined, completedYear: cycle.completed_year ?? undefined, book: { id: Number(cycle.book_id), author: cycle.author, title: cycle.title, coverUrl: cycle.cover_path ?? undefined, coverTone: cycle.cover_tone ?? "blue" } })) : undefined,
      authorBooks,
      communityBooks,
      reviews: hiddenOwnerIds.has(Number(row.id)) ? [] : reviewRows.filter((review) => Number(review.user_id) === Number(row.id) && (!hideAdultMaterials || !review.is_adult)).map((review) => ({
        id: Number(review.id),
        bookId: Number(review.book_id),
        bookTitle: review.book_title,
        bookAuthor: review.book_author,
        rating: Number(review.rating),
        preview: neutralizeMentionedText(review.preview, mentionsFor("review", review.id)),
        fullText: neutralizeMentionedText(review.body, mentionsFor("review", review.id)),
        bodyHtml: neutralizeMentionedText(review.body, mentionsFor("review", review.id)),
        mentions: mentionsFor("review", review.id),
        bookIds: materialBookRows.filter((item) => item.material_kind === "review" && Number(item.material_id) === Number(review.id)).map((item) => Number(item.book_id)),
        isAdult: Boolean(review.is_adult),
        createdAt: formatDate(review.created_at),
        createdAtValue: new Date(review.created_at).toISOString(),
      })),
      excerpts: hiddenOwnerIds.has(Number(row.id)) ? [] : excerptRows.filter((excerpt) => Number(excerpt.user_id) === Number(row.id) && (!hideAdultMaterials || !excerpt.is_adult)).map((excerpt) => ({
        ...(() => { const mentions = mentionsFor("excerpt", excerpt.id); return { mentions, previewText: neutralizeMentionedText(excerpt.preview_text ?? excerpt.body?.slice(0, 500) ?? "", mentions), bodyHtml: neutralizeMentionedText(excerpt.body_html ?? "", mentions), text: neutralizeMentionedText(excerpt.body ?? "", mentions) }; })(),
        id: Number(excerpt.id),
        bookId: excerpt.book_id ? Number(excerpt.book_id) : undefined,
        bookTitle: excerpt.book_title ?? "",
        bookIds: materialBookRows.filter((item) => item.material_kind === "excerpt" && Number(item.material_id) === Number(excerpt.id)).map((item) => Number(item.book_id)),
        isAdult: Boolean(excerpt.is_adult),
        link: excerpt.read_url ?? "",
        createdAt: formatDate(excerpt.created_at),
        createdAtValue: new Date(excerpt.created_at).toISOString(),
      })),
      publisherNews: hiddenOwnerIds.has(Number(row.id)) ? [] : publisherNewsRows.filter((item) => Number(item.user_id) === Number(row.id) && (!hideAdultMaterials || !item.is_adult)).map((item) => ({
        ...(() => { const mentions = mentionsFor("publisher_news", item.id); return { mentions, title: neutralizeMentionedText(item.title, mentions), previewText: neutralizeMentionedText(item.preview_text, mentions), bodyHtml: neutralizeMentionedText(item.body_html, mentions), body: neutralizeMentionedText(item.body, mentions) }; })(),
        id: Number(item.id),
        ownerId: Number(item.user_id),
        isAdult: Boolean(item.is_adult),
        createdAt: formatDate(item.created_at),
        createdAtValue: new Date(item.created_at).toISOString(),
      })),
      cleanReposts: hiddenOwnerIds.has(Number(row.id)) ? [] : cleanRepostRows.filter((repost) => Number(repost.user_id) === Number(row.id)).map((repost) => {
        const sourceOwnerId = Number(repost.source_owner_id);
        const unavailable = !repost.source_exists || !sourceOwnerId || repost.source_owner_deleted_at || repost.source_owner_purged_at || (repost.source_root_type === "publisher_news" && repost.source_owner_publisher_status !== "approved") || hiddenOwnerIds.has(sourceOwnerId) || (!viewerIsAdmin && hideAdultMaterials && repost.source_is_adult) || blockRows.some((block) => (Number(block.blocker_user_id) === Number(viewerId) && Number(block.blocked_user_id) === sourceOwnerId) || (Number(block.blocked_user_id) === Number(viewerId) && Number(block.blocker_user_id) === sourceOwnerId));
        return unavailable ? { id: Number(repost.id), createdAt: new Date(repost.created_at).toISOString(), source: { available: false, label: "Материал недоступен" } } : { id: Number(repost.id), createdAt: new Date(repost.created_at).toISOString(), source: { available: true, kind: repost.source_root_type, id: Number(repost.source_root_id), title: repost.source_title } };
      }),
      shelves: blockedPair || crossAge || deletedView || hiddenOwnerIds.has(Number(row.id)) ? [] : [...new Map(shelfRows.filter((item) => Number(item.owner_user_id) === Number(row.id)).map((item) => [Number(item.id), item])).values()].map((shelf) => {
        const allItems = shelfRows.filter((item) => Number(item.id) === Number(shelf.id));
        return {
          id: Number(shelf.id), ownerId: Number(shelf.owner_user_id), title: shelf.title, description: shelf.description ?? "",
          createdAt: new Date(shelf.created_at).toISOString(), updatedAt: new Date(shelf.updated_at).toISOString(),
          owner: { id: Number(row.id), name: row.display_name, initials: row.initials, avatarUrl: row.avatar_path ?? undefined },
          bookCount: allItems.length,
          items: allItems.map((item) => { const available = item.book_id && (!hideAdultMaterials || !item.is_adult); return { bookId: available ? Number(item.book_id) : null, position: Number(item.position), description: available ? item.item_description ?? "" : "", book: available ? { id: Number(item.book_id), title: item.book_title, author: item.author, annotation: item.annotation ?? "", coverUrl: item.cover_path ?? undefined, coverTone: item.cover_tone ?? "blue", rating: item.rating == null ? undefined : Number(item.rating) } : null }; }),
        };
      }),
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
    `SELECT u.profile_completed, u.role, u.preferred_locale, p.gender, p.profile_type, p.birth_date
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
  const [profileGate, legalGate] = await Promise.all([
    profileAccessState(pool, userId),
    legalAccessState(pool, userId, accountState?.preferred_locale || "ru"),
  ]);
  const [blockRows] = includeCatalog || includeSocial ? await pool.query(
    "SELECT blocker_user_id, blocked_user_id, created_at FROM user_blocks WHERE blocker_user_id = ? OR blocked_user_id = ?",
    [userId, userId],
  ) : [[]];
  const hiddenUserIds = new Set(blockRows.flatMap((row) => [Number(row.blocker_user_id), Number(row.blocked_user_id)]).filter((id) => id !== Number(userId)));
  const [hideRows] = includeCatalog ? await pool.query(
    "SELECT hidden_user_id FROM user_hides WHERE hider_user_id = ?", [userId],
  ) : [[]];
  const hiddenContentOwnerIds = new Set(hideRows.map((row) => Number(row.hidden_user_id)));
  const users = includeCatalog ? await loadUsers(pool, userId) : [];
  const currentUser = users.find((user) => user.id === Number(userId)) ?? account;
  const [[linkedProfileRow]] = await pool.query(
    `SELECT target.id, target.profile_completed, target.avatar_path, profile.display_name, profile.profile_type
       FROM linked_profiles links
       JOIN users target ON target.id = CASE WHEN links.personal_user_id = ? THEN links.community_user_id ELSE links.personal_user_id END
       JOIN profiles profile ON profile.user_id = target.id
      WHERE links.personal_user_id = ? OR links.community_user_id = ?
      LIMIT 1`, [userId, userId, userId],
  );
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
  // Memberships are public (for community participant tabs), but deliberately
  // travel separately from friendships so no friend-only consumer can use them.
  const [communityMembershipRows] = includeCatalog || includeSocial ? await pool.query(
    "SELECT community_user_id, member_user_id FROM community_memberships",
  ) : [[]];
  const [activeOrganizationRows] = includeCatalog ? await pool.query(
    `SELECT u.id
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.deleted_at IS NULL
        AND u.purged_at IS NULL
        AND p.profile_type IN ('Издатель', 'Сообщество')
        AND p.publisher_status = 'approved'`,
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
       FROM notifications
      WHERE user_id = ? AND notification_type <> 'new_message'
      ORDER BY created_at DESC LIMIT 200`, [userId],
  ) : [[]];
  const [chatHistoryClearRows] = includeSocial ? await pool.query(
    "SELECT peer_user_id, cleared_through_message_id FROM chat_history_clears WHERE user_id = ?",
    [userId],
  ) : [[]];
  const [messageRows] = includeSocial ? await pool.query(
    `SELECT id, sender_user_id, recipient_user_id, body, attachment_kind, attachment_id, message_kind, sticker_id, is_system, read_at, edited_at,
            deleted_at, deleted_before_read, created_at
      FROM messages
      WHERE sender_user_id = ? OR recipient_user_id = ?
      ORDER BY created_at, id`, [userId, userId],
  ) : [[]];
  const clearedThroughByPeer = new Map(chatHistoryClearRows.map((row) => [Number(row.peer_user_id), Number(row.cleared_through_message_id)]));
  const selectedMessageRows = messageRows.filter((row) => {
    if (row.deleted_before_read) return false;
    const peerId = Number(row.sender_user_id) === Number(userId) ? Number(row.recipient_user_id) : Number(row.sender_user_id ?? row.recipient_user_id);
    return Number(row.id) > (clearedThroughByPeer.get(peerId) ?? 0);
  });
  const messageIds = selectedMessageRows.map((row) => Number(row.id));
  const [messageMentionRows] = messageIds.length ? await pool.query(
    `SELECT m.entity_id, m.mentioned_user_id, m.mention_token, u.username, u.role, p.display_name, p.profile_type, p.birth_date, u.deleted_at, u.purged_at
       FROM content_mentions m JOIN users u ON u.id = m.mentioned_user_id JOIN profiles p ON p.user_id = u.id
      WHERE m.entity_type = 'message' AND m.entity_id IN (${messageIds.map(() => "?").join(",")})`, messageIds,
  ) : [[]];
  const [messageReactionRows] = messageIds.length ? await pool.query(
    `SELECT message_id, user_id
       FROM message_reactions
      WHERE reaction_type = 'like' AND message_id IN (${messageIds.map(() => "?").join(",")})
      ORDER BY message_id, created_at, user_id`, messageIds,
  ) : [[]];
  const [likeRows] = includeSocial ? await pool.query("SELECT user_id, material_kind, material_id, created_at FROM material_likes") : [[]];
  // Saves are deliberately private: the viewer gets only their own action history.
  const [saveRows] = includeSocial ? await pool.query(
    "SELECT material_kind, material_id, created_at FROM material_saves WHERE user_id = ? ORDER BY created_at DESC, material_kind, material_id",
    [userId],
  ) : [[]];
  const [eventRows] = includeCatalog ? await pool.query(
    `SELECT e.id, e.creator_user_id, e.title, e.summary, e.description, e.event_date, e.event_time,
            e.city, e.city_id, ec.country_name AS city_country, e.address, e.map_url, e.details_url, e.book_id, e.is_pinned, e.is_adult,
            e.status, e.moderation_note, e.created_at, p.display_name AS creator_name,
            b.title AS book_title, b.author AS book_author, b.annotation AS book_annotation,
            b.cover_path AS book_cover_path, b.cover_tone AS book_cover_tone,
            er.user_id AS reminder_user_id,
            reminder_users.user_ids AS reminder_user_ids,
            reminder_users.reminder_count
       FROM events e
       JOIN profiles p ON p.user_id = e.creator_user_id
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
            o.meeting_start_time, o.meeting_end_time, o.meeting_city, o.meeting_city_id,
            o.meeting_address, o.meeting_map_url, o.book_id, o.status, o.is_adult,
            o.moderation_note, o.created_at, p.display_name AS creator_name
       FROM occasions o
       JOIN profiles p ON p.user_id = o.creator_user_id
      WHERE ? = 1 OR o.status = 'published' OR o.creator_user_id = ?
      ORDER BY o.created_at DESC`,
    [currentUser?.isAdmin ? 1 : 0, userId],
  ) : [[]];
  const eventOccasionIds = [...eventRows.map((row) => ["event", Number(row.id)]), ...occasionRows.map((row) => ["occasion", Number(row.id)])];
  const [eventOccasionMentionRows] = includeCatalog && eventOccasionIds.length ? await pool.query(
    `SELECT m.entity_type, m.entity_id, m.mentioned_user_id, m.mention_token, u.username, p.display_name, p.profile_type, p.birth_date, u.deleted_at, u.purged_at
       FROM content_mentions m JOIN users u ON u.id = m.mentioned_user_id JOIN profiles p ON p.user_id = u.id
      WHERE (${eventOccasionIds.map(() => "(m.entity_type = ? AND m.entity_id = ?)").join(" OR ")})`,
    eventOccasionIds.flat(),
  ) : [[]];
  const catalogMentionTypes = new Set(["Читатель", "Писатель", "Блогер"]);
  const catalogViewerPersonal = catalogMentionTypes.has(accountState?.profile_type);
  const mentionForCatalog = (entityType, entityId) => eventOccasionMentionRows.filter((mention) => mention.entity_type === entityType && Number(mention.entity_id) === Number(entityId)).map((mention) => {
    const targetId = Number(mention.mentioned_user_id);
    const targetPersonal = catalogMentionTypes.has(mention.profile_type);
    const ageCompatible = currentUser?.isAdmin || !catalogViewerPersonal || !targetPersonal
      || viewerAge !== null && ageFromBirthDate(mention.birth_date) !== null && (viewerAge < 18) === (ageFromBirthDate(mention.birth_date) < 18);
    const unavailable = mention.deleted_at || mention.purged_at || hiddenUserIds.has(targetId) || hiddenContentOwnerIds.has(targetId) || !ageCompatible;
    const entry = { userId: targetId, token: unavailable ? NEUTRAL_MENTION_TOKEN : mention.mention_token, ...(unavailable ? {} : { username: mention.username, displayName: mention.display_name }) };
    Object.defineProperty(entry, "sourceToken", { value: String(mention.mention_token ?? ""), enumerable: false });
    return entry;
  });
  const [materialBookRows] = includeCatalog ? await pool.query(
    `SELECT mb.material_kind, mb.material_id, mb.book_id, mb.position,
            b.title, b.author, b.annotation, b.cover_path, b.cover_tone
       FROM material_books mb
       JOIN books b ON b.id = mb.book_id
      WHERE mb.material_kind IN ('event', 'occasion')
      ORDER BY mb.material_kind, mb.material_id, mb.position`,
  ) : [[]];
  const linkedBooksFor = (kind, id) => materialBookRows
    .filter((row) => row.material_kind === kind && Number(row.material_id) === Number(id))
    .map((row) => ({ id: Number(row.book_id), title: row.title, author: row.author, annotation: row.annotation ?? "", coverUrl: row.cover_path ?? undefined, coverTone: row.cover_tone ?? "blue" }));
  const [reportRows] = includeModeration && currentUser?.isAdmin ? await pool.query(
    `SELECT r.id, r.reference_code, r.reporter_user_id, r.reporter_anonymized, r.target_kind, r.target_id, r.target_user_id, r.reason,
            r.status, r.created_at, r.due_at, r.motivated_response, r.response_at, r.appealed_at, r.appeal_text,
            reporter.display_name AS reporter_name, target.display_name AS target_user_name,
            COALESCE(
              CASE WHEN r.target_kind = 'user' THEN target.display_name END,
              CASE WHEN r.target_kind = 'book' THEN (SELECT title FROM books WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'review' THEN (SELECT b.title FROM reviews rv JOIN books b ON b.id = rv.book_id WHERE rv.id = r.target_id) END,
              CASE WHEN r.target_kind = 'excerpt' THEN (SELECT COALESCE(NULLIF(book_title, ''), 'Публикация') FROM excerpts WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'event' THEN (SELECT title FROM events WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'occasion' THEN (SELECT primary_text FROM occasions WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'publisher_news' THEN (SELECT title FROM publisher_news WHERE id = r.target_id) END,
              CASE WHEN r.target_kind = 'book_note' THEN CONCAT('Заметка: ', (SELECT LEFT(body, 180) FROM book_progress_notes WHERE id = r.target_id)) END,
              CASE WHEN r.target_kind = 'chat' THEN CONCAT('Диалог с ', target.display_name) END,
              CASE WHEN r.target_kind = 'comment' THEN CONCAT('Комментарий: ', (SELECT LEFT(body, 180) FROM material_comments WHERE id = r.target_id)) END,
              'Удалённый материал'
            ) AS target_title,
            CASE WHEN r.target_kind = 'comment' THEN (SELECT body FROM material_comments WHERE id = r.target_id) END AS comment_text,
            CASE WHEN r.target_kind = 'comment' THEN (SELECT material_kind FROM material_comments WHERE id = r.target_id) END AS comment_material_kind,
            CASE WHEN r.target_kind = 'comment' THEN (SELECT material_id FROM material_comments WHERE id = r.target_id) END AS comment_material_id,
            CASE WHEN r.target_kind = 'book_note' THEN (SELECT body FROM book_progress_notes WHERE id = r.target_id) END AS note_text,
            CASE WHEN r.target_kind = 'book_note' THEN (SELECT book_id FROM book_progress_notes WHERE id = r.target_id) END AS note_book_id
       FROM reports r
       LEFT JOIN profiles reporter ON reporter.user_id = r.reporter_user_id
       LEFT JOIN profiles target ON target.user_id = r.target_user_id
      ORDER BY r.created_at DESC`,
  ) : [[]];
  const [reportedConversationRows] = includeModeration && currentUser?.isAdmin ? await pool.query(
    `SELECT r.id AS report_id, m.id, m.sender_user_id, m.recipient_user_id, m.body,
            m.attachment_kind, m.attachment_id, m.message_kind, m.sticker_id, m.is_system, m.read_at, m.edited_at, m.deleted_at, m.deleted_before_read, m.created_at
       FROM reports r
       JOIN messages m ON r.target_kind = 'chat' AND (
         (m.sender_user_id = r.reporter_user_id AND m.recipient_user_id = r.target_user_id)
         OR (m.sender_user_id = r.target_user_id AND m.recipient_user_id = r.reporter_user_id)
       ) AND m.deleted_before_read = 0
      ORDER BY r.id, m.created_at, m.id`,
  ) : [[]];
  const conversationByReport = new Map();
  for (const row of reportedConversationRows) {
    const reportId = Number(row.report_id);
    if (!conversationByReport.has(reportId)) conversationByReport.set(reportId, []);
    const deleted = Boolean(row.deleted_at);
    conversationByReport.get(reportId).push({
      id: Number(row.id),
      mine: false,
      senderId: row.sender_user_id ? Number(row.sender_user_id) : undefined,
      text: deleted ? "Пользователь удалил это сообщение" : row.body,
      attachment: !deleted && row.attachment_kind && row.attachment_id ? { kind: row.attachment_kind, id: Number(row.attachment_id) } : undefined,
      ...(!deleted && row.message_kind === "sticker" ? { kind: "sticker", sticker: stickerDto(archivedBookSticker(row.sticker_id)) } : {}),
      system: Boolean(row.is_system),
      read: deleted || Boolean(row.read_at),
      deleted: deleted || undefined,
      editedAt: !deleted && row.edited_at ? new Date(row.edited_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      time: new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(row.created_at)),
    });
  }
  const messages = {};
  const messageMentions = new Map();
  const messageLikes = new Map();
  for (const row of messageReactionRows) {
    const items = messageLikes.get(Number(row.message_id)) ?? [];
    items.push(Number(row.user_id));
    messageLikes.set(Number(row.message_id), items);
  }
  const personalMentionTypes = new Set(["Читатель", "Писатель", "Блогер"]);
  const viewerIsPersonal = personalMentionTypes.has(accountState?.profile_type);
  const viewerMentionAge = ageFromBirthDate(accountState?.birth_date);
  for (const row of messageMentionRows) {
    const targetIsPersonal = personalMentionTypes.has(row.profile_type);
    const ageCompatible = currentUser?.isAdmin || !viewerIsPersonal || !targetIsPersonal
      || viewerMentionAge !== null && ageFromBirthDate(row.birth_date) !== null && (viewerMentionAge < 18) === (ageFromBirthDate(row.birth_date) < 18);
    const unavailable = row.deleted_at || row.purged_at || hiddenUserIds.has(Number(row.mentioned_user_id)) || hiddenContentOwnerIds.has(Number(row.mentioned_user_id)) || !ageCompatible;
    const items = messageMentions.get(Number(row.entity_id)) ?? [];
    const item = { userId: Number(row.mentioned_user_id), token: unavailable ? NEUTRAL_MENTION_TOKEN : row.mention_token, ...(unavailable ? {} : { username: row.username, displayName: row.display_name }) };
    Object.defineProperty(item, "sourceToken", { value: String(row.mention_token ?? ""), enumerable: false });
    items.push(item);
    messageMentions.set(Number(row.entity_id), items);
  }
  for (const row of selectedMessageRows) {
    const otherId = Number(row.sender_user_id) === Number(userId) ? Number(row.recipient_user_id) : Number(row.sender_user_id ?? row.recipient_user_id);
    if (!currentUser?.isAdmin && hiddenUserIds.has(otherId)) continue;
    const key = [Number(userId), otherId].sort((a, b) => a - b).join("-");
    const deleted = Boolean(row.deleted_at);
    const likedByUserIds = deleted ? [] : messageLikes.get(Number(row.id)) ?? [];
    messages[key] ??= [];
    messages[key].push({
      id: Number(row.id),
      mine: Number(row.sender_user_id) === Number(userId),
      senderId: row.sender_user_id ? Number(row.sender_user_id) : undefined,
      text: deleted ? "Пользователь удалил это сообщение" : neutralizeMentionedText(row.body, messageMentions.get(Number(row.id)) ?? []),
      mentions: deleted ? [] : messageMentions.get(Number(row.id)) ?? [],
      attachment: !deleted && row.attachment_kind && row.attachment_id ? { kind: row.attachment_kind, id: Number(row.attachment_id) } : undefined,
      ...(!deleted && row.message_kind === "sticker" ? { kind: "sticker", sticker: stickerDto(archivedBookSticker(row.sticker_id)) } : {}),
      system: Boolean(row.is_system),
      unread: !deleted && Number(row.recipient_user_id) === Number(userId) && !row.read_at && !row.is_system,
      read: deleted || Boolean(row.read_at),
      deleted: deleted || undefined,
      editedAt: !deleted && row.edited_at ? new Date(row.edited_at).toISOString() : undefined,
      likeCount: likedByUserIds.length,
      likedByViewer: likedByUserIds.includes(Number(userId)),
      likedByUserIds,
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
  const saves = {};
  const savedMaterialRefs = [];
  for (const row of saveRows) {
    const key = `${row.material_kind}-${row.material_id}`;
    saves[key] = [Number(userId)];
    savedMaterialRefs.push({ kind: row.material_kind, id: Number(row.material_id), createdAt: new Date(row.created_at).toISOString() });
  }
  const likedMaterialRefs = likeRows
    .filter((row) => Number(row.user_id) === Number(userId))
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .map((row) => ({ kind: row.material_kind, id: Number(row.material_id), createdAt: new Date(row.created_at).toISOString() }));
  const visibleWishlistOwnerIds = new Set([Number(userId)]);
  for (const row of friendshipRows) {
    visibleWishlistOwnerIds.add(Number(row.user_low_id) === Number(userId) ? Number(row.user_high_id) : Number(row.user_low_id));
  }
  const usersWithWishlists = users.map((user) => ({
    ...user,
    // Hidden wishlists are omitted rather than redacted, so their contents and
    // count cannot be recovered from a bootstrap response.
    wishBooks: user.profile.canViewWishlist ? wishlistRows.filter((row) => Number(row.user_id) === user.id).map((row) => {
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
    }) : undefined,
  }));
  const previewOnlyUsers = !profileGate.complete ? usersWithWishlists.map((user) => ({
    ...user,
    reviews: user.reviews.map((review) => ({ ...review, fullText: "", bodyHtml: "" })),
    excerpts: (user.excerpts ?? []).map((excerpt) => ({ ...excerpt, text: "", bodyHtml: "" })),
    publisherNews: (user.publisherNews ?? []).map((news) => ({ ...news, body: "", bodyHtml: "" })),
  })) : usersWithWishlists;
  const visibleOccasionRows = occasionRows.filter((row) => {
    if (currentUser?.isAdmin) return true;
    if (row.is_adult && adultStatus !== "adult") return false;
    if (Number(row.creator_user_id) === Number(userId)) return true;
    if (row.status !== "published") return false;
    const genderMatch = row.target_gender === "Все" || row.target_gender === currentUser?.profile.gender;
    const typeMatch = row.target_profile_type === "Все" || row.target_profile_type === currentUser?.profile.type;
    return genderMatch && typeMatch;
  });
  // Keep the canonical catalogue independent from user_books: a linked material
  // must still resolve after its last library relation has been removed.
  const [catalogRows] = includeCatalog ? await pool.query(
    `SELECT b.id, b.creator_user_id, b.author, b.title, b.isbn, b.publisher, b.genres,
            b.annotation, b.is_adult, b.cover_path, b.cover_tone, b.flip_url,
            ratings.rating_count, ratings.average_rating
       FROM books b
       LEFT JOIN (
         SELECT ub.book_id, COUNT(*) AS rating_count, AVG(ub.rating) AS average_rating
           FROM user_books ub
           JOIN users rating_user ON rating_user.id = ub.user_id
          WHERE ub.is_author = 0
            AND ub.rating IS NOT NULL
            AND TRIM(COALESCE(ub.short_review, '')) <> ''
            AND rating_user.deleted_at IS NULL
            AND rating_user.purged_at IS NULL
          GROUP BY ub.book_id
       ) ratings ON ratings.book_id = b.id
      WHERE (? = 1 OR b.is_adult = 0)
      ORDER BY b.title_key, b.author_key`,
    [adultStatus === "adult" ? 1 : 0],
  ) : [[]];
  const catalogIds = catalogRows.map((row) => Number(row.id));
  const [catalogLinkRows] = catalogIds.length ? await pool.query(
    `SELECT id, book_id, action, label, url FROM book_links
      WHERE book_id IN (${catalogIds.map(() => "?").join(",")})
      ORDER BY id`,
    catalogIds,
  ) : [[]];
  const catalogBooks = catalogRows.filter((row) => currentUser?.isAdmin || !row.creator_user_id || !hiddenUserIds.has(Number(row.creator_user_id))).map((row) => ({
    id: Number(row.id), creatorUserId: row.creator_user_id ? Number(row.creator_user_id) : undefined,
    catalogBookId: Number(row.id), author: row.author, title: row.title, isbn: row.isbn ?? undefined,
    publisher: row.publisher ?? undefined, genres: parseJson(row.genres), annotation: row.annotation ?? "",
    pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "",
    ratingCount: Number(row.rating_count ?? 0), averageRating: row.average_rating == null ? undefined : Math.round(Number(row.average_rating) * 10) / 10,
    isAdult: Boolean(row.is_adult), coverUrl: row.cover_path ?? undefined, coverTone: row.cover_tone ?? "blue",
    flipUrl: row.flip_url ?? undefined,
    links: catalogLinkRows.filter((link) => Number(link.book_id) === Number(row.id)).map((link) => ({ id: Number(link.id), action: link.action, label: link.label, url: link.url })),
  }));
  return {
    activeUserId: Number(userId),
    profileCompleted: profileGate.complete,
    accessGate: {
      profileComplete: profileGate.complete,
      missingProfileFields: profileGate.missing,
      legalConfigured: legalGate.configured,
      pendingLegalDocuments: legalGate.pending,
      legalDocuments: legalGate.documents ?? [],
    },
    adultAccess: { status: adultStatus, restricted: restrictedAdultMaterials },
    users: previewOnlyUsers,
    activeOrganizationIds: activeOrganizationRows.map((row) => Number(row.id)),
    linkedProfile: linkedProfileRow ? { id: Number(linkedProfileRow.id), name: linkedProfileRow.display_name, type: linkedProfileRow.profile_type, avatarUrl: linkedProfileRow.avatar_path ?? undefined, profileCompleted: Boolean(linkedProfileRow.profile_completed) } : undefined,
    books: profileGate.complete ? catalogBooks : catalogBooks.map((book) => ({ ...book, annotation: "", isbn: undefined, publisher: undefined, links: [], flipUrl: undefined })),
    shelves: users.flatMap((user) => user.shelves ?? []),
    blocks: blockRows.map((row) => ({ blockerId: Number(row.blocker_user_id), blockedId: Number(row.blocked_user_id), createdAt: new Date(row.created_at).toISOString() })),
    blockedByUserIds: blockRows.filter((row) => Number(row.blocked_user_id) === Number(userId)).map((row) => Number(row.blocker_user_id)),
    reports: reportRows.map((row) => ({ id: Number(row.id), reference: row.reference_code, reporterId: row.reporter_user_id ? Number(row.reporter_user_id) : undefined, reporterName: row.reporter_anonymized ? "Удалённый пользователь" : row.reporter_name, targetKind: row.target_kind, targetId: Number(row.target_id), targetUserId: row.target_user_id ? Number(row.target_user_id) : undefined, targetUserName: row.target_user_name ?? undefined, targetTitle: row.target_title, reason: row.reason, status: row.status, createdAt: new Date(row.created_at).toISOString(), dueAt: row.due_at ? new Date(row.due_at).toISOString() : undefined, motivatedResponse: row.motivated_response ?? undefined, responseAt: row.response_at ? new Date(row.response_at).toISOString() : undefined, appealedAt: row.appealed_at ? new Date(row.appealed_at).toISOString() : undefined, appealText: row.appeal_text ?? undefined, commentText: row.comment_text ?? undefined, materialKind: row.comment_material_kind ?? undefined, materialId: row.comment_material_id ? Number(row.comment_material_id) : undefined, noteText: row.note_text ?? undefined, noteBookId: row.note_book_id ? Number(row.note_book_id) : undefined, conversationMessages: conversationByReport.get(Number(row.id)) })),
    friendRequests: requestRows.filter((row) => currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.from_user_id)) && !hiddenUserIds.has(Number(row.to_user_id)))).map((row) => ({ id: Number(row.id), fromId: Number(row.from_user_id), toId: Number(row.to_user_id), status: row.status, message: row.message ?? undefined, comment: row.rejection_comment ?? undefined })),
    friendships: friendshipRows.filter((row) => currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.user_low_id)) && !hiddenUserIds.has(Number(row.user_high_id)))).map((row) => ({ userA: Number(row.user_low_id), userB: Number(row.user_high_id) })),
    communityMemberships: communityMembershipRows.filter((row) => currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.community_user_id)) && !hiddenUserIds.has(Number(row.member_user_id)))).map((row) => ({ communityId: Number(row.community_user_id), memberId: Number(row.member_user_id) })),
    follows: followRows.filter((row) => currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.follower_user_id)) && !hiddenUserIds.has(Number(row.target_user_id)))).map((row) => ({ followerId: Number(row.follower_user_id), targetId: Number(row.target_user_id) })),
    notifications: notificationRows.filter((row) => currentUser?.isAdmin || !hiddenUserIds.has(Number(row.actor_user_id))).map((row) => ({ id: Number(row.id), userId: Number(row.user_id), actorId: Number(row.actor_user_id ?? row.user_id), type: row.notification_type, title: row.title, text: row.body, unread: Boolean(row.is_unread), createdAt: formatDate(row.created_at), materialId: row.material_id ? Number(row.material_id) : undefined, materialKind: row.material_kind ?? undefined })),
    messages,
    likes,
    saves,
    likedMaterialRefs,
    savedMaterialRefs,
    events: eventRows.filter((row) => (currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.creator_user_id)) && !hiddenContentOwnerIds.has(Number(row.creator_user_id)))) && (currentUser?.isAdmin || !row.is_adult || Number(currentUser?.profile.age ?? -1) >= 18)).map((row) => ({
      ...(() => { const mentions = mentionForCatalog("event", row.id); return { mentions, title: neutralizeMentionedText(row.title, mentions), summary: neutralizeMentionedText(row.summary, mentions), description: profileGate.complete ? neutralizeMentionedText(row.description, mentions) : "" }; })(),
      id: Number(row.id), creatorId: Number(row.creator_user_id), creatorName: row.creator_name,
      date: sqlDate(row.event_date),
      isAdult: Boolean(row.is_adult),
      time: String(row.event_time).slice(0, 5), city: row.city, country: row.city_country ?? undefined,
      cityId: row.city_id ? Number(row.city_id) : undefined, address: profileGate.complete ? row.address : "",
      mapUrl: profileGate.complete ? row.map_url ?? "" : "", detailsUrl: profileGate.complete ? row.details_url ?? "" : "", status: row.status,
      moderationNote: row.moderation_note ?? "",
      linkedBookId: row.book_id ? Number(row.book_id) : undefined,
      linkedBookIds: linkedBooksFor("event", row.id).map((book) => book.id),
      linkedBooks: linkedBooksFor("event", row.id),
      bookTitle: row.book_title ?? undefined, bookAuthor: row.book_author ?? undefined,
      bookAnnotation: row.book_annotation ?? undefined, bookCoverUrl: row.book_cover_path ?? undefined,
      bookCoverTone: row.book_cover_tone ?? undefined, pinned: Boolean(row.is_pinned),
      reminderSet: Boolean(row.reminder_user_id),
      reminderUserIds: String(row.reminder_user_ids ?? "").split(",").map(Number).filter(Boolean),
      reminderCount: Number(row.reminder_count ?? 0),
      createdAt: new Date(row.created_at).toISOString(),
    })),
    occasions: visibleOccasionRows.filter((row) => currentUser?.isAdmin || (!hiddenUserIds.has(Number(row.creator_user_id)) && !hiddenContentOwnerIds.has(Number(row.creator_user_id)))).map((row) => ({
      ...(() => { const mentions = mentionForCatalog("occasion", row.id); return { mentions, primaryText: neutralizeMentionedText(row.primary_text, mentions), audienceText: profileGate.complete ? neutralizeMentionedText(row.audience_text, mentions) : "" }; })(),
      id: Number(row.id), creatorId: Number(row.creator_user_id), type: row.occasion_type,
      isAdult: Boolean(row.is_adult),
      targetGender: row.target_gender, targetCities: parseJson(row.target_cities),
      targetProfileType: row.target_profile_type,
      meetingDate: profileGate.complete ? sqlDate(row.meeting_date) || undefined : undefined,
      meetingStartTime: profileGate.complete && row.meeting_start_time ? String(row.meeting_start_time).slice(0, 5) : undefined,
      meetingEndTime: profileGate.complete && row.meeting_end_time ? String(row.meeting_end_time).slice(0, 5) : undefined,
      meetingCity: profileGate.complete ? row.meeting_city ?? undefined : undefined,
      meetingCityId: profileGate.complete && row.meeting_city_id ? Number(row.meeting_city_id) : undefined,
      meetingAddress: profileGate.complete ? row.meeting_address ?? undefined : undefined,
      meetingMapUrl: profileGate.complete ? row.meeting_map_url ?? undefined : undefined,
      linkedBookId: row.book_id ? Number(row.book_id) : undefined,
      linkedBooks: linkedBooksFor("occasion", row.id),
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
