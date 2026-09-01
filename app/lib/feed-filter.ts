export type FeedOwner = { kind: "review" | "excerpt" | "publisher-news"; item: { ownerId: number } } | { kind: "event" | "occasion"; item: { creatorId: number } };

export function feedEntryOwnerId(entry: FeedOwner) {
  return "creatorId" in entry.item ? entry.item.creatorId : entry.item.ownerId;
}

export function includesFollowingFeed(entry: FeedOwner, viewerId: number, isFriend: (userId: number) => boolean, isFollowing: (userId: number) => boolean) {
  const ownerId = feedEntryOwnerId(entry);
  return ownerId === viewerId || isFriend(ownerId) || isFollowing(ownerId);
}
