export const notificationCategoryKeys = ["all", "reactions", "comments", "reposts", "mentions", "events", "friends"];

export function notificationCategoryFor(type) {
  if (type === "like") return "reactions";
  if (type === "comment") return "comments";
  if (["event_submitted", "event_moderation", "event_reminder"].includes(type)) return "events";
  if (["friend_request", "friendship_started", "friend_rejected", "new_follower", "friendship_ended", "publication", "author_book_activity", "gift_reserved"].includes(type)) return "friends";
  return null;
}
