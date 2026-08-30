const localeTags = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };

export function localCalendarDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function chatDayLabel(value, now, locale, todayLabel, yesterdayLabel) {
  const date = value instanceof Date ? value : new Date(value);
  const today = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return "";
  if (localCalendarDayKey(date) === localCalendarDayKey(today)) return todayLabel;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (localCalendarDayKey(date) === localCalendarDayKey(yesterday)) return yesterdayLabel;
  const dayMonth = new Intl.DateTimeFormat(localeTags[locale] ?? localeTags.ru, { day: "numeric", month: "long" }).format(date);
  if (date.getFullYear() === today.getFullYear()) return dayMonth;
  if (locale === "ru") return `${dayMonth} ${date.getFullYear()} года`;
  if (locale === "kk") return `${dayMonth} ${date.getFullYear()} жыл`;
  return `${dayMonth}, ${date.getFullYear()}`;
}

export function sortChatFriends(friends) {
  return friends.map((friend, index) => ({ friend, index })).sort((left, right) => {
    if (left.friend.support !== right.friend.support) return left.friend.support ? 1 : -1;
    const leftActivity = left.friend.lastActivityAt ? Date.parse(left.friend.lastActivityAt) : Number.NaN;
    const rightActivity = right.friend.lastActivityAt ? Date.parse(right.friend.lastActivityAt) : Number.NaN;
    const leftActive = Number.isFinite(leftActivity);
    const rightActive = Number.isFinite(rightActivity);
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    if (leftActive && rightActive && leftActivity !== rightActivity) return rightActivity - leftActivity;
    return left.index - right.index;
  }).map(({ friend }) => friend);
}
