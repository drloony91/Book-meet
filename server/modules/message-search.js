export const MESSAGE_SEARCH_MIN_TOKEN_LENGTH = 3;
export const MESSAGE_SEARCH_MAX_QUERY_LENGTH = 100;
export const MESSAGE_SEARCH_MAX_TOKENS = 8;
export const MESSAGE_SEARCH_DEFAULT_LIMIT = 20;
export const MESSAGE_SEARCH_MAX_LIMIT = 50;
export const MESSAGE_SEARCH_GROUP_LIMIT = 10;
export const MESSAGE_SEARCH_GROUP_MATCH_LIMIT = 5;

function searchError(message, code = "MESSAGE_SEARCH_QUERY_INVALID") {
  return Object.assign(new Error(message), { statusCode: 422, code });
}

export function normalizeMessageSearchQuery(value) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/gu, " ").trim();
  if (!normalized) throw searchError("Введите запрос для поиска сообщений", "MESSAGE_SEARCH_QUERY_REQUIRED");
  if (Array.from(normalized).length > MESSAGE_SEARCH_MAX_QUERY_LENGTH) throw searchError("Поисковый запрос слишком длинный");
  const tokens = normalized.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!tokens.length) throw searchError("Введите буквы или цифры для поиска сообщений");
  if (tokens.length > MESSAGE_SEARCH_MAX_TOKENS) throw searchError(`Используйте не более ${MESSAGE_SEARCH_MAX_TOKENS} слов`);
  if (tokens.some((token) => Array.from(token).length < MESSAGE_SEARCH_MIN_TOKEN_LENGTH)) {
    throw searchError(`Каждое слово должно содержать не менее ${MESSAGE_SEARCH_MIN_TOKEN_LENGTH} символов`, "MESSAGE_SEARCH_QUERY_TOO_SHORT");
  }
  return { text: normalized, tokens, booleanQuery: tokens.map((token) => `+${token}*`).join(" ") };
}

export function messageSearchLimit(value, fallback = MESSAGE_SEARCH_DEFAULT_LIMIT, maximum = MESSAGE_SEARCH_MAX_LIMIT) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function encodeMessageSearchCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeMessageSearchCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const id = Number(decoded?.id);
    const createdAt = String(decoded?.createdAt ?? "");
    if (!Number.isInteger(id) || id <= 0 || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || Number.isNaN(Date.parse(createdAt))) throw new Error("invalid cursor");
    return { id, createdAt: new Date(createdAt) };
  } catch {
    throw searchError("Некорректный курсор поиска", "MESSAGE_SEARCH_CURSOR_INVALID");
  }
}

export function messageSearchSnippet(body, tokens, maximum = 180) {
  const text = String(body ?? "").replace(/\s+/gu, " ").trim();
  if (text.length <= maximum) return text;
  const lower = text.toLocaleLowerCase("ru");
  const positions = tokens.map((token) => lower.indexOf(token)).filter((position) => position >= 0);
  const matchAt = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, matchAt - Math.floor(maximum / 3));
  const end = Math.min(text.length, start + maximum);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function messageMatchesSearch(body, tokens) {
  const searchable = String(body ?? "").normalize("NFKC").toLocaleLowerCase("ru");
  return tokens.every((token) => searchable.includes(token));
}
