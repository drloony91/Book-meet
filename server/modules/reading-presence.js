const VISIBILITY = new Set(["nobody", "friends", "followers", "everyone"]);

export function readingPresenceVisibility(value) {
  return VISIBILITY.has(value) ? value : "nobody";
}

export function canSeeReadingPresence({ viewerId, readerId, visibility, running, leaseActive, bookReadable, blocked, ageCompatible, friends, follower }) {
  if (!running || !leaseActive || !bookReadable) return false;
  if (Number(viewerId) === Number(readerId)) return true;
  if (blocked || !ageCompatible) return false;
  switch (readingPresenceVisibility(visibility)) {
    case "everyone": return true;
    case "friends": return Boolean(friends);
    case "followers": return Boolean(follower);
    default: return false;
  }
}
