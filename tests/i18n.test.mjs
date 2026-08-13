import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en, kk, localizedApiErrorForLocale, localizedNotificationDate, localizedNotificationText, ru } from "../app/i18n/messages.ts";
import { authText, normalizeLocale, requestLocale } from "../server/modules/i18n.js";

test("all locale dictionaries have identical non-empty keys", () => {
  const keys = Object.keys(ru).sort();
  assert.deepEqual(Object.keys(kk).sort(), keys);
  assert.deepEqual(Object.keys(en).sort(), keys);
  for (const locale of [ru, kk, en]) for (const key of keys) assert.ok(locale[key].trim(), `${key} must not be empty`);
});

test("occasion and profile setting copy stays aligned in every locale", () => {
  assert.equal(ru["occasion.invite"], "Хочу пригласить");
  assert.equal(kk["occasion.invite"], "Шақырғым келеді");
  assert.equal(en["occasion.invite"], "I want to invite");
  assert.equal(ru["occasion.cityOptional"], "Город (не обязательно)");
  assert.equal(kk["occasion.cityOptional"], "Қала (міндетті емес)");
  assert.equal(en["occasion.cityOptional"], "City (optional)");
  for (const locale of [ru, kk, en]) {
    assert.ok(locale["occasion.offerPlaceholder"].length > 40);
    assert.match(locale["linked.title"], /сообщества|қауымдастық|community/i);
  }
  assert.equal(ru["settings.defaultHome"], "Вид главной страницы");
});

test("locale resolution is whitelist-only and defaults to Russian", () => {
  assert.equal(normalizeLocale(undefined), "ru");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("kk-KZ"), "kk");
  assert.equal(normalizeLocale("de"), "ru");
  assert.equal(requestLocale({ body: {}, headers: { cookie: "bookmeet_locale=en" } }), "en");
  assert.equal(requestLocale({ body: { locale: "kk" }, headers: { cookie: "bookmeet_locale=en" } }), "kk");
});

test("the persisted locale becomes active before child effects can make requests", async () => {
  const source = await readFile(new URL("../app/i18n/index.tsx", import.meta.url), "utf8");
  assert.match(source, /const initialLocale = persistedLocale\(\);\s*activeLocale = initialLocale;\s*return initialLocale;/);
});

test("API errors preserve server detail only for Russian and use localized fallbacks otherwise", () => {
  assert.equal(localizedApiErrorForLocale("ru", "Подробная ошибка", "Общая ошибка"), "Подробная ошибка");
  assert.equal(localizedApiErrorForLocale("ru", "", "Общая ошибка"), "Общая ошибка");
  assert.equal(localizedApiErrorForLocale("kk", "Подробная ошибка", "Жалпы қате"), "Жалпы қате");
  assert.equal(localizedApiErrorForLocale("en", "Подробная ошибка", "Generic error"), "Generic error");
});

test("stored notification bodies and relative dates are safe in every locale", () => {
  const types = ["friend_request", "friendship_started", "friend_rejected", "new_message", "new_follower", "publication", "friendship_ended", "like", "comment", "event_submitted", "event_moderation", "event_reminder", "author_book_activity", "gift_reserved"];
  const fallback = "Подробный сохранённый текст с названием материала";
  for (const type of types) {
    assert.equal(localizedNotificationText("ru", type, fallback, { name: "Alex" }), fallback);
    for (const locale of ["kk", "en"]) {
      const localized = localizedNotificationText(locale, type, fallback, { name: "Alex" });
      assert.notEqual(localized, fallback, `${type} must not leak the stored Russian body in ${locale}`);
      assert.ok(localized.trim(), `${type} must have a non-empty ${locale} body`);
    }
  }
  assert.equal(localizedNotificationText("en", "unknown", fallback, { name: "Alex" }), fallback);
  assert.equal(localizedNotificationDate("ru", "сейчас"), ru["common.now"]);
  assert.equal(localizedNotificationDate("kk", "сейчас"), kk["common.now"]);
  assert.equal(localizedNotificationDate("en", "сегодня"), en["date.today"]);
  assert.equal(localizedNotificationDate("kk", "13.08.2026"), "13.08.2026");
});

test("canonical values remain values while their UI labels are localized", async () => {
  const source = await readFile(new URL("../app/i18n/index.tsx", import.meta.url), "utf8");
  for (const value of ["Читатель", "Писатель", "Блогер", "Издатель", "Сообщество", "Мужской", "Женский", "Не указан", "Бумажная", "Электронная", "Аудио", "Купить", "Читать", "Слушать", "Казахстан", "Онлайн"]) {
    assert.match(source, new RegExp(`"${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`));
  }
  assert.equal(ru["domain.reader"], "Читатель");
  assert.equal(en["domain.reader"], "Reader");
  assert.equal(kk["domain.reader"], "Оқырман");
  assert.doesNotMatch(source, /MutationObserver|createTreeWalker|translateKnownRussianText/);
});

test("header and auth expose locale controls and Google locale is dynamic", async () => {
  const header = await readFile(new URL("../app/components/layout/AppLayout.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../app/screens/AuthScreens.tsx", import.meta.url), "utf8");
  assert.match(header, /<LocaleSwitcher\s*\/>/);
  assert.match(auth, /<AuthLocaleRow\s*\/>/);
  assert.match(auth, /locale,\s*t/);
  assert.doesNotMatch(auth, /locale:\s*["']ru["']/);
});

test("server auth e-mail templates are localized without changing links", () => {
  const link = "https://bookmeet.club/?verify=secret";
  assert.match(authText("en", "verificationText", { link }), /Confirm your e-mail/);
  assert.match(authText("kk", "verificationText", { link }), /растаңыз/);
  assert.match(authText("ru", "verificationText", { link }), /Подтвердите e-mail/);
  for (const locale of ["ru", "kk", "en"]) assert.ok(authText(locale, "verificationText", { link }).includes(link));
});
