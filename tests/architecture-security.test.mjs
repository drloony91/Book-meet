import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { plainTextFromHtml, validateRichHtml } from "../server/modules/content-security.js";
import { imageType } from "../server/modules/image-storage.js";
import { requestLimitPolicy } from "../server/modules/request-limits.js";
import { ageFromBirthDate } from "../server/data.js";

const root = path.resolve(import.meta.dirname, "..");

test("сервер удаляет опасный HTML, обработчики событий и запрещенные стили", () => {
  const cleaned = validateRichHtml('<p onclick="steal()" style="text-align:center;color:red">Текст<script>alert(1)</script></p><img src=x onerror=steal()>');
  assert.equal(cleaned, '<p style="text-align:center">Текст</p>');
  assert.equal(plainTextFromHtml(cleaned), "Текст");
});

test("дата рождения, спойлеры и материалы 18+ защищены общими контрактами", async () => {
  assert.equal(ageFromBirthDate("2000-08-03", new Date("2026-08-02T12:00:00Z")), 25);
  assert.equal(ageFromBirthDate("2000-08-02", new Date("2026-08-02T12:00:00Z")), 26);
  assert.equal(ageFromBirthDate("2025-02-31"), null);
  assert.equal(validateRichHtml('<span class="spoiler" onclick="steal()">секрет</span>'), '<span class="spoiler">секрет</span>');
  const migration = await readFile(path.join(root, "mysql", "migrations", "019_profile_age_material_controls.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  assert.match(migration, /birth_date DATE/);
  assert.match(migration, /profile_tab_order LONGTEXT/);
  assert.match(migration, /last_read_chapter INT/);
  assert.match(migration, /ADD COLUMN is_adult/);
  assert.match(api, /assertAdultMaterialAllowed/);
  assert.match(data, /hideAdultMaterials/);
  assert.match(data, /show_birth_date_to_friends && isViewerFriend/);
  assert.match(profile, /Показывать дату рождения друзьям/);
  assert.match(profile, /Изменить порядок пунктов меню профиля/);
  assert.match(content, /Скрыть под спойлер/);
  assert.match(content, /Прочитано глав/);
});

test("тип загруженного изображения определяется по содержимому, а не по расширению", () => {
  assert.deepEqual(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { mime: "image/png", extension: "png" });
  assert.deepEqual(imageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), { mime: "image/jpeg", extension: "jpg" });
  assert.equal(imageType(Buffer.from("<script>alert(1)</script>")), null);
});

test("изменяющие API-запросы имеют отдельные лимиты", () => {
  assert.equal(requestLimitPolicy("GET", "/bootstrap"), null);
  assert.deepEqual(requestLimitPolicy("POST", "/auth/register"), { name: "auth", limit: 30, windowMs: 900_000 });
  assert.deepEqual(requestLimitPolicy("POST", "/social/messages"), { name: "messages", limit: 60, windowMs: 60_000 });
});

test("bootstrap разделен на независимые серверные и клиентские секции", async () => {
  const router = await readFile(path.join(root, "server", "modules", "bootstrap-router.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const client = await readFile(path.join(root, "app", "services", "bootstrap.ts"), "utf8");
  for (const section of ["session", "catalog", "social", "moderation"]) {
    assert.match(router, new RegExp(`${section}:`));
    assert.match(client, new RegExp(`"${section}"`));
  }
  assert.match(data, /options\.sections/);
  assert.match(data, /includeCatalog/);
  assert.match(data, /includeSocial/);
  assert.match(data, /includeModeration/);
});

test("маршрутизируемые поп-апы используют единый стек истории", async () => {
  const routes = await readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8");
  assert.match(routes, /APP_NAVIGATION_EVENT/);
  assert.match(routes, /openOverlayRoute/);
  assert.match(routes, /closeOverlayRoute/);
  assert.match(routes, /return \{ active, close:/);
  assert.match(routes, /notifications/);
  assert.match(routes, /reportTargetFromPathname/);
});

test("локальные правки этапа 1 закреплены контрактами интерфейса и данных", async () => {
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const users = await readFile(path.join(root, "app", "screens", "UsersDirectoryScreen.tsx"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const cityFixes = await readFile(path.join(root, "mysql", "migrations", "018_city_catalog_corrections.sql"), "utf8");
  assert.match(content, /Рецензия\$\{item\.rating/);
  assert.match(content, /Иду! Установить напоминание/);
  assert.match(content, /event-attendees/);
  assert.match(users, /Кого вы ищете\?/);
  assert.match(users, /material-clickable-card/);
  assert.match(data, /reminder_user_ids/);
  assert.match(cityFixes, /Тюмень/);
  assert.match(cityFixes, /Москва/);
});

test("внешние изображения и книжные страницы проверяют каждый редирект", async () => {
  const images = await readFile(path.join(root, "server", "modules", "image-storage.js"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  assert.match(images, /redirect: "manual"/);
  assert.match(images, /Перенаправление изображения ведет на запрещенный адрес/);
  assert.match(api, /redirect: "manual"/);
  assert.match(api, /Книжный источник перенаправил запрос на другой сайт/);
});
