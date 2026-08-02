import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const readFrontendSource = async () => (await Promise.all([
  ["app", "BookMeetApp.tsx"],
  ["app", "hooks", "useBookMeetController.tsx"],
  ["app", "screens", "ContentScreens.tsx"],
  ["app", "screens", "AuthScreens.tsx"],
  ["app", "screens", "ProfileScreens.tsx"],
  ["app", "components", "content", "ContentComponents.tsx"],
].map((segments) => readFile(path.join(root, ...segments), "utf8")))).join("\n");

test("production SPA собрана", async () => {
  await access(path.join(root, "dist", "client", "index.html"));
  const html = await readFile(path.join(root, "dist", "client", "index.html"), "utf8");
  assert.match(html, /Book Meet/);
  assert.match(html, /assets\/index-/);
});

test("MySQL-схема содержит все MVP-сущности", async () => {
  const sql = await readFile(path.join(root, "mysql", "migrations", "001_initial.sql"), "utf8");
  for (const table of ["users", "profiles", "sessions", "books", "user_books", "reviews", "excerpts", "friend_requests", "friendships", "follows", "messages", "material_likes", "material_comments", "notifications"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
  }
  assert.match(sql, /ENGINE=InnoDB/);
  assert.match(sql, /CHARSET=utf8mb4/);
});

test("события, роли и модерация описаны отдельной миграцией", async () => {
  const sql = await readFile(path.join(root, "mysql", "migrations", "002_events_admin_support.sql"), "utf8");
  assert.match(sql, /ADD COLUMN role/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS events \(/);
  assert.match(sql, /status VARCHAR\(30\)/);
  assert.match(sql, /moderation_note TEXT/);
});

test("поводы и справочник городов СНГ готовы для production", async () => {
  const initialSql = await readFile(path.join(root, "mysql", "migrations", "001_initial.sql"), "utf8");
  const sql = await readFile(path.join(root, "mysql", "migrations", "006_occasions_cities.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS occasions \(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS cities \(/);
  assert.match(initialSql, /gender VARCHAR\(20\)/);
  assert.match(initialSql, /city_id BIGINT UNSIGNED/);
  assert.match(sql, /'Астана', 'астана', 'KZ', 'Казахстан'/);
  assert.ok((sql.match(/\),\n\(/g) ?? []).length > 7000, "в справочнике должно быть больше 7000 городов");
});

test("обложка существующей книги и внешние книжные источники защищены серверным контрактом", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  assert.match(api, /WHERE id = \? AND cover_path IS NULL/);
  assert.match(api, /Поддерживаются только ссылки Flip\.kz/);
  assert.match(api, /router\.post\("\/wishlist\/preview"/);
  assert.match(api, /router\.post\("\/books\/preview"/);
  assert.match(api, /bookProductFromHtml/);
  assert.match(api, /Marwin\/Меломан/);
  assert.match(api, /Яндекс\.Книги/);
});

test("источник Flip, получатель подарка и статистика чтения сохраняются в MySQL", async () => {
  const sql = await readFile(path.join(root, "mysql", "migrations", "007_book_sources_reading_stats.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const page = await readFrontendSource();
  assert.match(sql, /ADD COLUMN flip_url/);
  assert.match(sql, /ADD COLUMN read_month/);
  assert.match(sql, /ADD COLUMN read_year/);
  assert.match(sql, /ADD COLUMN recipient_name/);
  assert.match(api, /recipient_name, recipient_phone/);
  assert.match(api, /read_month, read_year/);
  assert.match(page, /function ReadingStatsModal/);
  assert.match(page, /Телефон получателя/);
  assert.match(page, /Вставьте ссылку на книгу на Flip, Marwin\/Меломан или Яндекс\.Книгах/);
});

test("ISBN и издательство входят в единую карточку, а точные совпадения применяются автоматически", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "014_book_isbn_publisher.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  assert.match(migration, /ADD COLUMN isbn/);
  assert.match(migration, /ADD COLUMN publisher/);
  assert.match(migration, /UNIQUE KEY books_isbn_key_unique/);
  assert.match(api, /WHERE isbn_key = \?/);
  assert.match(api, /WHERE bl\.url = \? OR b\.flip_url = \?/);
  assert.match(api, /catalogBookId: Number\(match\.id\)/);
  assert.match(api, /replace\(\/\\D\/g, ""\)/);
  assert.match(api, /class=\["'\]\[\^"'\]\*\\\\bcell\\\\b/);
  assert.match(api, /annotation IS NULL OR annotation = ''/);
  assert.match(content, /queryIsbn=\{form\.isbn\}/);
  assert.match(content, /inputMode="numeric"/);
  assert.match(content, /lockedUrls=\{lockedLinkUrls\}/);
  assert.match(content, /fieldLocked\(selectedCatalogBook\?\.publisher/);
  assert.match(content, /function updateRestrictedAction/);
  assert.match(content, /function purchaseStoreFromUrl/);
  assert.match(content, /detectedStore \|\|/);
  assert.match(content, /\["Flip", "Marwin\/Меломан"\]\.map/);
  assert.match(content, /restricted \? "Яндекс\.Книги" : link\.label/);
  assert.match(api, /label = action === "Купить" \? source\.name : "Яндекс\.Книги"/);
  assert.match(content, /<BookLinksEditor links=\{form\.links\} lockedUrls=\{lockedLinkUrls\}/);
  assert.match(content, /<dt>ISBN<\/dt>/);
  assert.match(content, /или заполните данные вручную/);
});

test("оценки книг поддерживают шаг 0,5 и сохраняются без округления", async () => {
  const initialSql = await readFile(path.join(root, "mysql", "migrations", "001_initial.sql"), "utf8");
  const migration = await readFile(path.join(root, "mysql", "migrations", "013_half_step_book_ratings.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const page = await readFrontendSource();
  assert.match(initialSql, /rating DECIMAL\(2,1\)/);
  assert.match(migration, /MODIFY COLUMN rating DECIMAL\(2,1\)/);
  assert.match(api, /Number\.isInteger\(rating \* 2\)/);
  assert.match(page, /star - 0\.5/);
});

test("админка изолирована, а удаление материалов защищено ролью", async () => {
  const page = await readFrontendSource();
  const chat = await readFile(path.join(root, "app", "components", "chat", "ChatComponents.tsx"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  assert.match(page, /function AdminProfile/);
  assert.match(chat, /adminMode \? "Запросы" : "Друзья"/);
  assert.match(page, /user\.id === profileUserId && !user\.isAdmin/);
  assert.match(api, /router\.delete\("\/admin\/materials\/:kind\/:id"/);
  assert.match(api, /if \(!\(await isAdmin\(connection, adminId\)\)\)/);
  assert.match(api, /Службу поддержки нельзя добавить в друзья/);
  assert.match(api, /На службу поддержки нельзя подписаться/);
});

test("двухэтапная защита подключается через подтверждение и хранит только хэши резервных кодов", async () => {
  const sql = await readFile(path.join(root, "mysql", "migrations", "009_totp_safe_setup.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const page = await readFrontendSource();
  assert.match(sql, /totp_pending_secret/);
  assert.match(sql, /totp_pending_expires_at/);
  assert.match(sql, /totp_recovery_codes JSON/);
  assert.match(api, /router\.post\("\/auth\/totp\/setup\/start"/);
  assert.match(api, /router\.post\("\/auth\/totp\/setup\/confirm"/);
  assert.match(api, /recoveryCodes\.map\(hashRecoveryCode\)/);
  assert.match(page, /function AdminSecurityPanel/);
  assert.match(page, /QR-код для Google Authenticator/);
});

test("Google-вход переживает холодный запуск и временную недоступность Google", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const page = await readFrontendSource();
  const bundledKeys = JSON.parse(await readFile(path.join(root, "server", "google-jwks.json"), "utf8"));
  assert.match(api, /\.google-jwks-cache\.json/);
  assert.match(api, /GOOGLE_JWKS_RETRY_DELAYS_MS/);
  assert.match(api, /requestJsonOverIpv4/);
  assert.match(api, /family: 4/);
  assert.match(api, /readBundledGoogleKeyCache/);
  assert.match(api, /Using stale Google JWKS cache after refresh failure/);
  assert.match(api, /retryable: isConnectivityError/);
  assert.ok(Array.isArray(bundledKeys.keys) && bundledKeys.keys.length > 0);
  assert.ok(bundledKeys.keys.every((key) => key.kty === "RSA" && key.kid && key.n && key.e));
  assert.match(page, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(page, /Google отвечает дольше обычного/);
});

test("главная страница ограничивает события и использует единые действия", async () => {
  const page = await readFrontendSource();
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(page, /scopedEvents\.slice\(0, 2\)/);
  assert.match(page, /eventTimestamp\(item\) > eventClock/);
  assert.match(page, />Написать рецензию</);
  assert.match(page, />Создать публикацию</);
  assert.match(page, /className="secondary-action-button"[^\n]*Смотреть всё/);
  assert.match(page, /HomeScopeSwitch city=\{currentCity\}/);
  assert.match(css, /\.home-content > \.content-section \+ \.content-section/);
  assert.match(css, /\.creation-action-button/);
});

test("каталоги Book Meet имеют постоянные SPA-маршруты", async () => {
  const page = await readFrontendSource();
  const routes = await readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8");
  const server = await readFile(path.join(root, "server", "index.js"), "utf8");
  assert.match(routes, /users: "\/users"/);
  assert.match(routes, /events: "\/events"/);
  assert.match(routes, /reviews: "\/reviews"/);
  assert.match(routes, /publications: "\/blog"/);
  assert.match(routes, /occasions: "\/meet"/);
  assert.match(routes, /chat: "\/chat"/);
  assert.match(page, /window\.addEventListener\("popstate", restoreRoute\)/);
  assert.match(page, /window\.history\[options\?\.replace \? "replaceState" : "pushState"\]/);
  assert.match(server, /app\.get\("\*", \(_request, response\) => response\.sendFile/);
});

test("профили и единые карточки материалов имеют адреса и сохраняют фоновую страницу", async () => {
  const page = await readFrontendSource();
  const routes = await readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8");
  assert.match(routes, /normalized === "\/profile"/);
  assert.match(routes, /\^\\\/users\\\/\(\\d\+\)\$/);
  assert.match(routes, /\^\\\/books\\\/\(\\d\+\)\$/);
  assert.match(routes, /\^\\\/events\\\/\(\\d\+\)\$/);
  assert.match(routes, /\^\\\/reviews\\\/\(\\d\+\)\$/);
  assert.match(routes, /\^\\\/blog\\\/\(\\d\+\)\$/);
  assert.match(routes, /\^\\\/meet\\\/\(\\d\+\)\$/);
  assert.match(routes, /function useRoutedPopup/);
  assert.match(routes, /bookMeetOverlay: true, backgroundPath: currentPath/);
  assert.match(routes, /window\.history\.back\(\)/);
  assert.match(routes, /window\.history\.replaceState\(\{ bookMeetView:/);
  assert.match(page, /useRoutedPopup\(`\/users\/\$\{user\.id\}`/);
  assert.match(page, /useRoutedPopup\(`\/books\/\$\{book\.id\}`/);
});

test("диалоги маршрутизируются и сохраняют размер при переключении собеседника", async () => {
  const page = await readFrontendSource();
  const routes = await readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8");
  const chat = await readFile(path.join(root, "app", "components", "chat", "ChatComponents.tsx"), "utf8");
  assert.match(routes, /\^\\\/chat\\\/\(\\d\+\)\$/);
  assert.match(routes, /chatMode\?: "compact" \| "expanded"/);
  assert.match(page, /const expanded = selectedFriend \? chatExpanded : false/);
  assert.match(page, /window\.history\[isSwitchingChat \? "replaceState" : "pushState"\]/);
  assert.match(page, /chatMode: nextExpanded \? "expanded" : "compact"/);
  assert.match(page, /view === "chat" \? <ChatScreen \/>/);
  assert.match(chat, /expanded \? "chat-expanded" : "chat-compact"/);
});

test("Cloudflare/D1 больше не входят в production-конфигурацию", async () => {
  const packageJson = await readFile(path.join(root, "package.json"), "utf8");
  assert.doesNotMatch(packageJson, /wrangler|drizzle|cloudflare/i);
});

test("presence, linked event books and pinned moderation are persisted", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "011_presence_event_books_pinning.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  assert.match(migration, /last_seen_at DATETIME/);
  assert.match(migration, /book_id BIGINT UNSIGNED/);
  assert.match(migration, /is_pinned TINYINT/);
  assert.match(api, /UPDATE users SET last_seen_at = UTC_TIMESTAMP\(\)/);
  assert.match(api, /is_pinned = \?/);
  assert.match(data, /ORDER BY e\.is_pinned DESC, e\.event_date/);
});

test("event books, strict cities and private event management are wired into the UI", async () => {
  const page = await readFrontendSource();
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const header = await readFile(path.join(root, "app", "components", "layout", "AppLayout.tsx"), "utf8");
  assert.match(page, /const MIN_LOADING_MS = 3_000/);
  assert.match(content, />Событие связано с книгой</);
  assert.match(content, />Сначала создать книгу</);
  assert.match(content, /function PublicProfileDetails/);
  assert.match(content, /className="my-events-tab"/);
  assert.match(header, /Твоё книжное пространство/);
  assert.match(header, />Новинки издательств</);
});

test("профиль, фотографии и вложения сообщений сохраняются как production-данные", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "012_profile_photos_message_attachments.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const chat = await readFile(path.join(root, "app", "components", "chat", "ChatComponents.tsx"), "utf8");
  const auth = await readFile(path.join(root, "app", "screens", "AuthScreens.tsx"), "utf8");
  assert.match(migration, /avatar_path VARCHAR\(500\)/);
  assert.match(migration, /attachment_kind VARCHAR\(20\)/);
  assert.match(migration, /attachment_id BIGINT UNSIGNED/);
  assert.match(api, /validatedChatAttachment/);
  assert.match(api, /INSERT INTO messages \(sender_user_id, recipient_user_id, body, attachment_kind, attachment_id\)/);
  assert.match(data, /attachment: row\.attachment_kind/);
  assert.match(profile, /Заполните обязательные поля/);
  assert.match(profile, /!profile\.cityId/);
  assert.match(profile, /canvas\.toDataURL\("image\/webp", 0\.82\)/);
  assert.match(chat, /Профилем пользователя/);
  assert.match(chat, /itemFromUrl/);
  assert.match(auth, /const visibleMode = mode/);
  assert.match(auth, /auth-switch-placeholder/);
});

test("library reading status stays in the library and drives book audiences", async () => {
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  assert.match(content, /aria-label="Статус книги в библиотеке"/);
  assert.match(content, /readingStatus \?\? "read"\) === "read" && form\.rating === 0/);
  assert.match(content, /item\.readingStatus \?\? "read"\) !== "want"/);
  assert.match(content, /item\.readingStatus === "want"/);
  assert.doesNotMatch(content, /onReadingStatusChange/);
  assert.match(api, /readingStatus === "read" && \(!Number\.isInteger\(rating \* 2\)/);
  assert.match(api, /readingStatus !== "read" \? null : rating/);
});

test("chat attachments keep the composer visible and profile cards are fully clickable", async () => {
  const chat = await readFile(path.join(root, "app", "components", "chat", "ChatComponents.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(chat, /className="chat-attachment-card"[\s\S]*?<strong>\{item\.title\}<\/strong><em>/);
  assert.doesNotMatch(chat, /chat-attachment-card"[\s\S]{0,500}<small>\{shareTypes/);
  assert.match(css, /grid-template-rows: 78px minmax\(0, 1fr\) auto/);
  assert.match(css, /\.chat-composer \{[^}]*background: #fff/);
  assert.match(content, /className="profile-friend-card"[\s\S]*?onClick=\{\(\) => onOpenUser\(friend\.id\)\}/);
  assert.match(css, /\.profile-friend-groups details \{[^}]*border: 0/);
  assert.match(css, /\.profile-friends-grid \{[^}]*gap: 12px/);
});

test("publisher profiles are moderated, private and separated from writer publications", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "015_publishers.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const routes = await readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const directory = await readFile(path.join(root, "app", "screens", "UsersDirectoryScreen.tsx"), "utf8");
  assert.match(migration, /publisher_status VARCHAR\(30\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS publisher_news/);
  assert.match(api, /router\.patch\("\/admin\/publishers\/:id"/);
  assert.match(api, /Профиль издательства ожидает официального подтверждения/);
  assert.match(data, /viewerIsAdmin \|\| Number\(row\.id\) === Number\(viewerId\) \? row\.publisher_bin/);
  assert.match(routes, /publishing: "\/publishing"/);
  assert.match(profile, /Книги издательства/);
  assert.match(profile, /Новости издательства/);
  assert.match(directory, /export function PublishingDirectoryPage/);
});
