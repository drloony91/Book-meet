export const USERNAME_RESERVED = new Set([
  "admin", "api", "auth", "profile", "users", "books", "events", "reviews", "blog", "meet", "chat",
  "publishing", "communities", "notifications", "login", "register", "settings", "support", "book-meet-return",
]);

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/;

export function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function usernameValidationError(value) {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) return "USERNAME_INVALID";
  if (USERNAME_RESERVED.has(username)) return "USERNAME_RESERVED";
  return null;
}

export function isValidUsername(value) {
  return usernameValidationError(value) === null;
}

// Used only for internal/SSO placeholders. It always returns a route-safe stem.
export function usernameStem(value, fallback = "reader") {
  const stem = normalizeUsername(value).replace(/[^a-z0-9._-]/g, "").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const fallbackStem = normalizeUsername(fallback).replace(/[^a-z0-9._-]/g, "").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || "reader";
  const normalized = (stem || fallbackStem).slice(0, 24).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || "reader";
  const candidate = normalized.length < 3 ? `${normalized}user`.slice(0, 24) : normalized;
  return USERNAME_RESERVED.has(candidate) ? "reader" : candidate;
}
