export const NOTIFICATION_CATEGORIES = Object.freeze([
  "friendships_follows",
  "likes",
  "comments_replies",
  "mentions",
  "reposts",
  "events_communities",
  "reading_reminders",
  "system_security",
]);

export const NOTIFICATION_EMAIL_MODES = Object.freeze(["off", "immediate", "daily"]);
export const NOTIFICATION_READ_CONFIRMATION_THRESHOLD = 20;
export const LEGACY_TELEGRAM_NOTIFICATION_CATEGORIES = Object.freeze(["messages", "moderation", "complaints", "events", "social"]);

const canonicalByLegacyTelegramCategory = Object.freeze({
  messages: [],
  moderation: ["system_security"],
  complaints: ["system_security"],
  events: ["events_communities"],
  social: ["friendships_follows", "likes", "comments_replies", "mentions", "reposts"],
});

export function canonicalCategoriesForLegacyTelegram(categories) {
  return [...new Set((Array.isArray(categories) ? categories : []).flatMap((category) => canonicalByLegacyTelegramCategory[category] ?? []))];
}

export function legacyTelegramCategoriesForPreferences(categories) {
  const enabled = new Set(categories);
  return LEGACY_TELEGRAM_NOTIFICATION_CATEGORIES.filter((legacy) => {
    const canonical = canonicalByLegacyTelegramCategory[legacy];
    return canonical.length > 0 && canonical.some((category) => enabled.has(category));
  });
}

const categoryByType = new Map([
  ["friend_request", "friendships_follows"],
  ["friendship_started", "friendships_follows"],
  ["friend_rejected", "friendships_follows"],
  ["new_follower", "friendships_follows"],
  ["friendship_ended", "friendships_follows"],
  ["gift_reserved", "friendships_follows"],
  ["like", "likes"],
  ["comment", "comments_replies"],
  ["mention", "mentions"],
  ["repost", "reposts"],
  ["publication", "events_communities"],
  ["event_submitted", "events_communities"],
  ["event_moderation", "events_communities"],
  ["event_reminder", "events_communities"],
  ["author_book_activity", "reading_reminders"],
  ["postponed_book", "reading_reminders"],
  ["new_message", "system_security"],
  ["system", "system_security"],
  ["security", "system_security"],
]);

export function notificationCategoryFor(type) {
  return categoryByType.get(String(type ?? "")) ?? "system_security";
}

export function defaultNotificationPreference(category) {
  return {
    inAppEnabled: true,
    telegramEnabled: false,
    emailMode: "off",
    mandatoryInApp: category === "system_security",
  };
}

export function validNotificationTimezone(value) {
  if (value === null) return null;
  const timezone = String(value ?? "").trim();
  if (!timezone || timezone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return null;
  }
}

export function notificationChannelReadiness(account = {}, environment = process.env) {
  const telegramServiceReady = environment.USER_TELEGRAM_NOTIFICATIONS_READY === "1";
  const emailServiceReady = environment.USER_EMAIL_NOTIFICATIONS_READY === "1";
  const telegramConnected = Boolean(account.telegram_user_id && account.telegram_connected_at);
  const telegramDeliveryError = Boolean(account.telegram_delivery_error_at);
  const emailVerified = Boolean(account.email && account.email_verified_at);
  return {
    telegram: {
      available: telegramServiceReady && telegramConnected && !telegramDeliveryError,
      serviceReady: telegramServiceReady,
      connected: telegramConnected,
      displayName: telegramConnected ? String(account.telegram_display_name || "Telegram").slice(0, 120) : null,
      reason: !telegramServiceReady ? "service_unavailable" : !telegramConnected ? "account_not_connected" : telegramDeliveryError ? "delivery_error" : null,
    },
    email: {
      available: emailServiceReady && emailVerified,
      serviceReady: emailServiceReady,
      verified: emailVerified,
      reason: !emailServiceReady ? "service_unavailable" : !emailVerified ? "email_not_verified" : null,
    },
  };
}

export function notificationPreferencesState({ rows = [], account = {}, requestTimezone = "UTC", environment = process.env } = {}) {
  const rowByCategory = new Map(rows.map((row) => [row.category, row]));
  const categories = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => {
    const row = rowByCategory.get(category);
    return [category, {
      ...defaultNotificationPreference(category),
      inAppEnabled: category === "system_security" ? true : row ? Boolean(row.in_app_enabled) : true,
      telegramEnabled: row ? Boolean(row.telegram_enabled) : false,
      emailMode: NOTIFICATION_EMAIL_MODES.includes(row?.email_mode) ? row.email_mode : "off",
    }];
  }));
  const timezone = validNotificationTimezone(account.notification_timezone);
  return {
    categories,
    timezone,
    effectiveTimezone: timezone ?? validNotificationTimezone(requestTimezone) ?? "UTC",
    readiness: notificationChannelReadiness(account, environment),
  };
}

function invalidPreferences(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: "INVALID_NOTIFICATION_PREFERENCES" });
}

export function validateNotificationPreferencesPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw invalidPreferences("Некорректные настройки уведомлений");
  const allowedRoot = new Set(["categories", "timezone"]);
  for (const key of Object.keys(payload)) if (!allowedRoot.has(key)) throw invalidPreferences("Некорректные настройки уведомлений");
  const result = {};
  if (Object.hasOwn(payload, "timezone")) {
    if (payload.timezone === null) result.timezone = null;
    else {
      const timezone = validNotificationTimezone(payload.timezone);
      if (!timezone) throw invalidPreferences("Укажите корректный часовой пояс IANA");
      result.timezone = timezone;
    }
  }
  if (Object.hasOwn(payload, "categories")) {
    if (!payload.categories || typeof payload.categories !== "object" || Array.isArray(payload.categories)) throw invalidPreferences("Некорректные категории уведомлений");
    result.categories = {};
    for (const [category, settings] of Object.entries(payload.categories)) {
      if (!NOTIFICATION_CATEGORIES.includes(category) || !settings || typeof settings !== "object" || Array.isArray(settings)) throw invalidPreferences("Некорректная категория уведомлений");
      const allowedSettings = new Set(["inAppEnabled", "telegramEnabled", "emailMode"]);
      for (const key of Object.keys(settings)) if (!allowedSettings.has(key)) throw invalidPreferences("Некорректный параметр уведомлений");
      const clean = {};
      if (Object.hasOwn(settings, "inAppEnabled")) {
        if (typeof settings.inAppEnabled !== "boolean") throw invalidPreferences("Некорректное значение внутренних уведомлений");
        if (category === "system_security" && settings.inAppEnabled === false) {
          throw Object.assign(new Error("Системные уведомления и уведомления безопасности нельзя отключить"), { statusCode: 409, code: "SYSTEM_NOTIFICATION_REQUIRED" });
        }
        clean.inAppEnabled = settings.inAppEnabled;
      }
      if (Object.hasOwn(settings, "telegramEnabled")) {
        if (typeof settings.telegramEnabled !== "boolean") throw invalidPreferences("Некорректное значение Telegram");
        clean.telegramEnabled = settings.telegramEnabled;
      }
      if (Object.hasOwn(settings, "emailMode")) {
        if (!NOTIFICATION_EMAIL_MODES.includes(settings.emailMode)) throw invalidPreferences("Некорректный режим email-уведомлений");
        clean.emailMode = settings.emailMode;
      }
      if (Object.keys(clean).length) result.categories[category] = clean;
    }
  }
  if (!Object.hasOwn(result, "timezone") && !Object.keys(result.categories ?? {}).length) throw invalidPreferences("Не указаны изменения настроек уведомлений");
  return result;
}
