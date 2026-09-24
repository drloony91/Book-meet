export function marketplaceEnabled(environment = process.env) {
  const value = String(environment.BOOK_MEET_MARKETPLACE_ENABLED ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}
