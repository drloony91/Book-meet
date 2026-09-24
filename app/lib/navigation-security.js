export function safeReturnTo(value, origin) {
  const baseOrigin = origin || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  try {
    const url = new URL(String(value || "/"), baseOrigin);
    if (url.origin !== baseOrigin || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}
