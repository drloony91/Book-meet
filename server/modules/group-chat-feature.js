export function groupChatsEnabled(environment = process.env) {
  const value = String(environment.BOOK_MEET_GROUP_CHATS_ENABLED ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}
