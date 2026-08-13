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
      formatDate: (input, options) => new Intl.DateTimeFormat(intlLocale[locale], options ?? { dateStyle: "medium" }).format(toDate(input)),
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
};

export function localizedNotificationTitle(locale: Locale, type: string, fallback: string) {
  const key = notificationKeys[type];
  return key ? translate(locale, key) : fallback;
}
