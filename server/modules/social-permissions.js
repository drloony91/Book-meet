export function includesPublisher(firstProfileType, secondProfileType) {
  return firstProfileType === "Издатель" || secondProfileType === "Издатель";
}

export function canCreateFriendRequest(firstProfileType, secondProfileType, { communityMembership = false } = {}) {
  return communityMembership || !includesPublisher(firstProfileType, secondProfileType);
}

export function canMessagePair({ friends = false, communityMembers = false, hasAdmin = false, firstProfileType, secondProfileType }) {
  return friends || communityMembers || hasAdmin || includesPublisher(firstProfileType, secondProfileType);
}
