export const notificationCategoryKeys = ["friendships_follows", "likes", "comments_replies", "mentions", "reposts", "events_communities", "reading_reminders", "system_security"];
export const notificationFilterKeys = ["all", ...notificationCategoryKeys];

export function notificationCategoryFor(type) {
  if (["friend_request", "friendship_started", "friend_rejected", "new_follower", "friendship_ended", "gift_reserved"].includes(type)) return "friendships_follows";
  if (type === "like") return "likes";
  if (type === "comment") return "comments_replies";
  if (type === "mention") return "mentions";
  if (type === "repost") return "reposts";
  if (["publication", "event_submitted", "event_moderation", "event_reminder"].includes(type)) return "events_communities";
  if (["author_book_activity", "postponed_book"].includes(type)) return "reading_reminders";
  return "system_security";
}
