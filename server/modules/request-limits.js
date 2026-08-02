const buckets = new Map();

export function requestLimitPolicy(method, path) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (path.startsWith("/auth/")) return { name: "auth", limit: 30, windowMs: 15 * 60_000 };
  if (path === "/social/messages") return { name: "messages", limit: 60, windowMs: 60_000 };
  if (path === "/books" || path === "/users/me/state") return { name: "uploads", limit: 30, windowMs: 60_000 };
  return { name: "writes", limit: 180, windowMs: 60_000 };
}

export function apiRateLimit(request, response, next) {
  const policy = requestLimitPolicy(request.method, request.path);
  if (!policy) return next();
  const now = Date.now();
  const client = request.ip || request.socket.remoteAddress || "unknown";
  const key = `${client}:${policy.name}`;
  const previous = buckets.get(key);
  const bucket = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + policy.windowMs } : previous;
  bucket.count += 1;
  buckets.set(key, bucket);
  response.setHeader("RateLimit-Limit", String(policy.limit));
  response.setHeader("RateLimit-Remaining", String(Math.max(0, policy.limit - bucket.count)));
  if (bucket.count <= policy.limit) return next();
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  response.setHeader("Retry-After", String(retryAfter));
  return response.status(429).json({ error: "Слишком много запросов. Попробуйте немного позже" });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, 10 * 60_000).unref?.();
