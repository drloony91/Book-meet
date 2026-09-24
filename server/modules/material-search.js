const MAX_QUERY_LENGTH = 120;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 20;

function text(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeMaterialSearchQuery(value) {
  const query = String(value ?? "").trim();
  if (query.length > MAX_QUERY_LENGTH) return { error: "SEARCH_QUERY_TOO_LONG" };
  const words = text(query).split(/\s+/).filter(Boolean);
  if (!words.length || text(query).length < 2) return { error: "SEARCH_QUERY_TOO_SHORT" };
  return { query, words };
}

function timestamp(value) {
  const result = Date.parse(String(value ?? ""));
  return Number.isFinite(result) ? result : 0;
}

function ownerSummary(user) {
  return {
    id: Number(user.id),
    initials: user.initials,
    username: user.username,
    avatarUrl: user.avatarUrl,
    profile: { name: user.profile?.name ?? "" },
  };
}

function matches(words, fields) {
  const haystack = text(fields.join(" "));
  return words.every((word) => haystack.includes(word));
}

/**
 * Search only material objects already exposed by loadBootstrap.  This keeps
 * visibility, adult, moderation, approval and occasion targeting decisions in
 * their single existing source of truth.
 */
export function searchBootstrapMaterials(bootstrap, rawQuery, options = {}) {
  const parsed = normalizeMaterialSearchQuery(rawQuery);
  if (parsed.error) return { error: parsed.error };
  const page = Math.max(1, Number.parseInt(String(options.page ?? 1), 10) || 1);
  const requestedLimit = Number.parseInt(String(options.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit));
  const activeUserId = Number(bootstrap?.activeUserId);
  const viewerIsAdmin = Boolean((bootstrap?.users ?? []).find((user) => Number(user.id) === activeUserId)?.isAdmin);
  const entries = [];

  for (const user of bootstrap?.users ?? []) {
    if (!viewerIsAdmin && user.blockedByMe) continue;
    const owner = ownerSummary(user);
    for (const review of user.reviews ?? []) {
      if (!matches(parsed.words, [review.bookTitle, review.bookAuthor, review.preview, review.fullText, review.bodyHtml])) continue;
      entries.push({
        kind: "review", id: Number(review.id), ownerId: Number(user.id), owner, createdAt: review.createdAtValue ?? review.createdAt,
        item: { id: Number(review.id), kind: "review", title: review.bookTitle, author: user.profile?.name ?? "", text: review.fullText, preview: review.preview, bodyHtml: review.bodyHtml, ownerId: Number(user.id), createdAt: review.createdAtValue ?? review.createdAt, linkedBookId: review.bookId, linkedBookIds: review.bookIds, bookAuthor: review.bookAuthor, rating: review.rating, isAdult: Boolean(review.isAdult) },
      });
    }
    for (const excerpt of user.excerpts ?? []) {
      if (!matches(parsed.words, [excerpt.bookTitle, excerpt.previewText, excerpt.text, excerpt.bodyHtml])) continue;
      entries.push({
        kind: "excerpt", id: Number(excerpt.id), ownerId: Number(user.id), owner, createdAt: excerpt.createdAtValue ?? excerpt.createdAt,
        item: { id: Number(excerpt.id), kind: "excerpt", title: excerpt.bookTitle, author: user.profile?.name ?? "", text: excerpt.text, preview: excerpt.previewText, bodyHtml: excerpt.bodyHtml, ownerId: Number(user.id), createdAt: excerpt.createdAtValue ?? excerpt.createdAt, linkedBookId: excerpt.bookId, linkedBookIds: excerpt.bookIds, isAdult: Boolean(excerpt.isAdult) },
      });
    }
  }

  for (const shelf of bootstrap?.shelves ?? []) {
    if (!matches(parsed.words, [shelf.title, shelf.description, ...(shelf.items ?? []).flatMap((item) => [item.book?.title, item.book?.author])])) continue;
    entries.push({ kind: "shelf", id: Number(shelf.id), ownerId: Number(shelf.ownerId), owner: ownerSummary({ ...shelf.owner, profile: { name: shelf.owner?.name ?? "" } }), createdAt: shelf.createdAt, item: { ...shelf, kind: "shelf", author: shelf.owner?.name ?? "", linkedBookIds: (shelf.items ?? []).map((item) => item.bookId).filter(Boolean) } });
  }

  for (const event of bootstrap?.events ?? []) {
    if (!(event.status === "published" || Number(event.creatorId) === activeUserId)) continue;
    if (!matches(parsed.words, [event.title, event.summary, event.description, event.city, event.address])) continue;
    const owner = (bootstrap?.users ?? []).find((user) => Number(user.id) === Number(event.creatorId));
    entries.push({ kind: "event", id: Number(event.id), ownerId: Number(event.creatorId), owner: owner ? ownerSummary(owner) : { id: Number(event.creatorId), initials: "", profile: { name: event.creatorName ?? "" } }, createdAt: event.createdAt, item: event });
  }
  for (const occasion of bootstrap?.occasions ?? []) {
    if (!(occasion.status === "published" || Number(occasion.creatorId) === activeUserId)) continue;
    if (!matches(parsed.words, [occasion.primaryText, occasion.audienceText, ...(occasion.targetCities ?? []), occasion.meetingCity, occasion.meetingAddress])) continue;
    const owner = (bootstrap?.users ?? []).find((user) => Number(user.id) === Number(occasion.creatorId));
    entries.push({ kind: "occasion", id: Number(occasion.id), ownerId: Number(occasion.creatorId), owner: owner ? ownerSummary(owner) : { id: Number(occasion.creatorId), initials: "", profile: { name: occasion.creatorName ?? "" } }, createdAt: occasion.createdAt, item: occasion });
  }

  entries.sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt) || right.id - left.id);
  const start = (page - 1) * limit;
  return { query: parsed.query, page, limit, total: entries.length, hasMore: start + limit < entries.length, items: entries.slice(start, start + limit) };
}

export const materialSearchLimits = { MAX_QUERY_LENGTH, DEFAULT_LIMIT, MAX_LIMIT };
