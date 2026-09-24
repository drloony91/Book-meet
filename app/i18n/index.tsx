import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { localizedApiErrorForLocale, messages, type MessageKey } from "./messages";
export { localizedNotificationDate, localizedNotificationText } from "./messages";

export type Locale = "ru" | "kk" | "en";
export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_STORAGE_KEY = "bookmeet:locale";
export const LOCALE_COOKIE = "bookmeet_locale";
const locales = new Set<Locale>(["ru", "kk", "en"]);
let activeLocale: Locale = DEFAULT_LOCALE;

export function isLocale(value: unknown): value is Locale { return typeof value === "string" && locales.has(value as Locale); }
export function resolveLocale(stored?: string | null, cookie?: string | null): Locale {
  if (isLocale(stored)) return stored;
  return isLocale(cookie) ? cookie : DEFAULT_LOCALE;
}
export function persistedLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${LOCALE_COOKIE}=`))?.split("=")[1];
  return resolveLocale(stored, cookie);
}
export function currentLocale() { return activeLocale; }
export function localizedApiError(error: unknown, fallback: string) { return localizedApiErrorForLocale(currentLocale(), error, fallback); }
export function persistLocale(locale: Locale) {
  activeLocale = locale;
  if (typeof document === "undefined") return;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.lang = locale;
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;
function interpolate(value: string, params?: Record<string, string | number>) {
  return params ? value.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`)) : value;
}
export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>) { return interpolate(messages[locale][key], params); }

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatRelative: (value: number, unit?: Intl.RelativeTimeFormatUnit) => string;
  plural: (value: number, forms: Partial<Record<Intl.LDMLPluralRule, string>>) => string;
  domainLabel: (value: string) => string;
};

const I18nContext = createContext<I18nValue | null>(null);
const intlLocale: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };
const kazakhMonthsLong = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];
const kazakhMonthsShort = ["қаң.", "ақп.", "нау.", "сәу.", "мам.", "мау.", "шіл.", "там.", "қыр.", "қаз.", "қар.", "жел."];
const kazakhWeekdays = ["жексенбі", "дүйсенбі", "сейсенбі", "сәрсенбі", "бейсенбі", "жұма", "сенбі"];

function formatKazakhDate(date: Date, options?: Intl.DateTimeFormatOptions) {
  const requested = options ?? { dateStyle: "medium" };
  const utc = requested.timeZone === "UTC";
  const day = utc ? date.getUTCDate() : date.getDate();
  const monthIndex = utc ? date.getUTCMonth() : date.getMonth();
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const weekdayIndex = utc ? date.getUTCDay() : date.getDay();
  const hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  const dateStyle = requested.dateStyle;
  const includeDay = Boolean(dateStyle || requested.day);
  const includeMonth = Boolean(dateStyle || requested.month);
  const includeYear = Boolean(dateStyle || requested.year);
  const monthStyle = requested.month ?? (dateStyle === "short" ? "2-digit" : "long");
  const month = monthStyle === "2-digit" ? String(monthIndex + 1).padStart(2, "0")
    : monthStyle === "numeric" ? String(monthIndex + 1)
      : monthStyle === "short" ? kazakhMonthsShort[monthIndex] : kazakhMonthsLong[monthIndex];
  const dateParts = [includeDay ? String(day).padStart(requested.day === "2-digit" ? 2 : 1, "0") : "", includeMonth ? month : "", includeYear ? `${year}${dateStyle && dateStyle !== "short" ? " ж." : ""}` : ""].filter(Boolean);
  let result = dateParts.join(monthStyle === "2-digit" && includeDay && includeYear ? "." : " ");
  if ((dateStyle === "full" || requested.weekday) && result) result = `${kazakhWeekdays[weekdayIndex]}, ${result}`;
  if (requested.timeStyle || requested.hour || requested.minute) {
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    result = result ? `${result}, ${time}` : time;
  }
  return result;
}

export function formatDateForLocale(locale: Locale, input: Date | string | number, options?: Intl.DateTimeFormatOptions) {
  const date = input instanceof Date ? input : new Date(input);
  return locale === "kk" ? formatKazakhDate(date, options) : new Intl.DateTimeFormat(intlLocale[locale], options ?? { dateStyle: "medium" }).format(date);
}
const domainKeys: Record<string, MessageKey> = {
  "Читатель": "domain.reader", "Писатель": "domain.writer", "Блогер": "domain.blogger", "Издатель": "domain.publisher", "Сообщество": "domain.community",
  "Мужской": "domain.male", "Женский": "domain.female", "Не указан": "domain.unspecified", "Все": "domain.all",
  "Бумажная": "domain.paper", "Электронная": "domain.electronic", "Аудио": "domain.audio", "Купить": "content.buy", "Читать": "content.read", "Слушать": "content.listen",
  "Казахстан": "domain.kazakhstan", "Онлайн": "domain.online", "Хочу прочитать": "content.want", "Читаю": "content.reading", "Прочитано": "content.readDone",
};

export function domainLabelFor(locale: Locale, value: string) {
  return domainKeys[value] ? translate(locale, domainKeys[value]) : value;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initialLocale = persistedLocale();
    activeLocale = initialLocale;
    return initialLocale;
  });
  const setLocale = useCallback((next: Locale) => { persistLocale(next); setLocaleState(next); }, []);
  useEffect(() => { persistLocale(locale); }, [locale]);
  const value = useMemo<I18nValue>(() => {
    const t: Translate = (key, params) => translate(locale, key, params);
    const toDate = (input: Date | string | number) => input instanceof Date ? input : new Date(input);
    return {
      locale, setLocale, t,
      formatDate: (input, options) => formatDateForLocale(locale, toDate(input), options),
      formatTime: (input, options) => new Intl.DateTimeFormat(intlLocale[locale], options ?? { hour: "2-digit", minute: "2-digit" }).format(toDate(input)),
      formatNumber: (input, options) => new Intl.NumberFormat(intlLocale[locale], options).format(input),
      formatRelative: (input, unit = "day") => new Intl.RelativeTimeFormat(intlLocale[locale], { numeric: "auto" }).format(input, unit),
      plural: (input, forms) => forms[new Intl.PluralRules(intlLocale[locale]).select(input)] ?? forms.other ?? String(input),
      domainLabel: (input) => domainLabelFor(locale, input),
    };
  }, [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

const notificationKeys: Record<string, MessageKey> = {
  friend_request: "notification.friendRequest", friendship_started: "notification.friendshipStarted", friend_rejected: "notification.friendRejected",
  new_message: "notification.newMessage", new_follower: "notification.newFollower", publication: "notification.publication", friendship_ended: "notification.friendshipEnded",
  like: "notification.like", comment: "notification.comment", event_submitted: "notification.eventSubmitted", event_moderation: "notification.eventModeration",
  event_reminder: "notification.eventReminder", author_book_activity: "notification.authorBookActivity", gift_reserved: "notification.giftReserved",
  mention: "notification.mention", repost: "notification.repost", postponed_book: "notification.postponedBook", system: "notification.system", security: "notification.security",
};

export function localizedNotificationTitle(locale: Locale, type: string, fallback: string) {
  const key = notificationKeys[type];
  return key ? translate(locale, key) : fallback;
}
