import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { en, kk, ru } from "../app/i18n/messages.ts";
import { authText } from "../server/modules/i18n.js";

const root = path.resolve(import.meta.dirname, "..");
const assertLocalized = (source, key) => {
  assert.match(source, new RegExp(`(?:t\\(|translate\\(currentLocale\\(\\),\\s*)["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  for (const messages of [ru, kk, en]) assert.equal(typeof messages[key], "string", `${key} must exist in every locale`);
};
const readFrontendSource = async () => (await Promise.all([
  ["app", "BookMeetApp.tsx"],
  ["app", "hooks", "useBookMeetController.tsx"],
  ["app", "screens", "ContentScreens.tsx"],
  ["app", "screens", "AuthScreens.tsx"],
  ["app", "screens", "ProfileScreens.tsx"],
  ["app", "components", "content", "ContentComponents.tsx"],
].map((segments) => readFile(path.join(root, ...segments), "utf8")))).join("\n");

test("production canonical origin does not depend on the retired legacy domain", async () => {
  const server = await readFile(path.join(root, "server", "index.js"), "utf8");
  const environment = await readFile(path.join(root, ".env.example"), "utf8");
  const deployRunbook = await readFile(path.join(root, "PLESK_DEPLOY.md"), "utf8");
  assert.doesNotMatch(server, /LEGACY_ORIGIN|configuredOrigin|legacyHostname|response\.redirect\(301/);
  assert.match(environment, /APP_ORIGIN=http:\/\/localhost:3000/);
  assert.doesNotMatch(environment, /LEGACY_ORIGIN/);
  assert.match(deployRunbook, /APP_ORIGIN=https:\/\/bookmeet\.club/);
  assert.doesNotMatch(deployRunbook, /LEGACY_ORIGIN=https?:\/\//);
  assert.match(deployRunbook, /retired/i);
});

test("deployment contract separates production, staging, demo and disposable MySQL", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const integrations = await readFile(path.join(root, "docs", "codex", "INTEGRATIONS.md"), "utf8");
  const testing = await readFile(path.join(root, "docs", "codex", "TESTING.md"), "utf8");
  const deployRunbook = await readFile(path.join(root, "PLESK_DEPLOY.md"), "utf8");
  const readiness = await readFile(path.join(root, "docs", "codex", "PRODUCTION_READINESS.md"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const stagingSmoke = await readFile(path.join(root, "scripts", "staging-smoke.mjs"), "utf8");
  for (const document of [readme, integrations, deployRunbook]) {
    assert.match(document, /bookmeet\.club/);
    assert.match(document, /staging\.bookmeet\.club/);
    assert.match(document, /DEMO_MODE=1/);
    assert.match(document, /127\.0\.0\.1:3307/);
    assert.match(document, /book_meet_test/);
  }
  assert.match(deployRunbook, /book_meet_staging/);
  assert.match(deployRunbook, /book-meet-staging-uploads/);
  assert.match(deployRunbook, /install --frozen-lockfile/);
  assert.match(deployRunbook, /db:migrate:status/);
  assert.match(deployRunbook, /второй migration run будет no-op/is);
  assert.match(deployRunbook, /Basic Auth/i);
  assert.match(deployRunbook, /X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(deployRunbook, /HSTS.*CSP.*X-Content-Type-Options/is);
  assert.match(deployRunbook, /Google, SMTP и Telegram.*выключены/is);
  assert.match(deployRunbook, /malformed publisher website.*400.*500/is);
  assert.match(deployRunbook, /malformed publisher sales links.*400.*500/is);
  assert.match(deployRunbook, /пустые optional URLs.*валидными/is);
  assert.match(deployRunbook, /malformed\/incomplete URL в `\/api\/books\/preview`.*400.*500/is);
  assert.match(deployRunbook, /корректные URL Flip, Marwin\/Меломан и Яндекс\.Книги.*успешно/is);
  for (const profileType of ["Читатель", "Писатель", "Блогер", "Издатель", "Сообщество"]) {
    assert.match(deployRunbook, new RegExp(profileType));
  }
  assert.match(deployRunbook, /PUT `?\/api\/users\/me\/state/);
  assert.match(deployRunbook, /После этих URL\/profile сценариев.*HTTP 500/is);
  assert.match(testing, /Staging smoke contract/);
  assert.match(testing, /STAGING_SMOKE=1.*staging:smoke/is);
  assert.equal(packageJson.scripts["staging:smoke"], "node scripts/staging-smoke.mjs");
  assert.match(stagingSmoke, /origin\.hostname !== "staging\.bookmeet\.club"/);
  assert.match(stagingSmoke, /staging DB_NAME/);
  assert.match(stagingSmoke, /staging UPLOAD_DIR/);
  assert.match(stagingSmoke, /Telegram alerts disabled/);
  assert.match(stagingSmoke, /Google OAuth disabled/);
  assert.match(stagingSmoke, /SMTP disabled/);
  assert.match(stagingSmoke, /--cleanup-upload-marker requires --verify-upload-marker/);
  assert.match(readiness, /Staging verification status — \d{4}-\d{2}-\d{2}/);
  assert.match(readiness, /Domain\/access.*PASS/is);
  assert.match(readiness, /Isolation.*PASS/is);
  assert.match(readiness, /Runtime.*pnpm `11\.9\.0`.*install --frozen-lockfile.*PASS/is);
  assert.match(readiness, /Migrations.*PASS/is);
  assert.match(readiness, /Production `bookmeet\.club`.*не изменя/is);
  assert.match(readiness, /Staging URL\/profile regression checklist/);
  assert.match(readiness, /malformed publisher website.*400 INVALID_URL.*PASS/is);
  assert.match(readiness, /malformed publisher sales links.*400 INVALID_URL.*PASS/is);
  assert.match(readiness, /empty optional URLs.*200.*PASS/is);
  assert.match(readiness, /malformed\/incomplete URL.*`\/api\/books\/preview`.*400.*PASS/is);
  assert.match(readiness, /Flip, Marwin\/Меломан и Яндекс\.Книги.*200.*PASS/is);
  assert.match(readiness, /`PUT \/api\/users\/me\/state`/);
  assert.match(readiness, /Читатель.*Писатель.*Блогер.*Издатель.*Сообщество/is);
  assert.match(readiness, /новых HTTP 500.*нет.*PASS/is);
});

test("Block 1 фиксирует fail-fast verify и production-safe seed", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const seed = await readFile(path.join(root, "scripts", "seed.js"), "utf8");
  const environment = await readFile(path.join(root, ".env.example"), "utf8");
  assert.equal(packageJson.scripts.verify, "pnpm run check && pnpm test");
  assert.doesNotMatch(packageJson.scripts.verify, /build/);
  assert.match(seed, /process\.env\.ADMIN_EMAIL/);
  assert.match(seed, /process\.env\.TEST1_PASSWORD/);
  assert.match(seed, /production && \(!configuredAdminEmail \|\| !hasConfiguredTest1Password\)/);
  assert.match(seed, /email: adminEmail/);
  assert.match(seed, /password: test1Password/);
  assert.doesNotMatch(seed, /email:\s*["']dr\.loony91@gmail\.com/);
  assert.doesNotMatch(seed, /process\.env\.TEST1_PASSWORD\s*\|\|\s*["']testtest1/);
  assert.doesNotMatch(environment, /dr\.loony91@gmail\.com|testtest1|testtest2/);
  assert.match(environment, /ADMIN_EMAIL=admin@example\.com/);
  assert.match(environment, /TEST1_PASSWORD=replace-with-a-strong-unique-password/);
});

test("Block 1 документация использует canonical domain, один seed и frozen pnpm", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const plesk = await readFile(path.join(root, "PLESK_DEPLOY.md"), "utf8");
  for (const document of [readme, plesk]) {
    assert.match(document, /bookmeet\.club/);
    assert.doesNotMatch(document, /LEGACY_ORIGIN=https?:\/\//);
    assert.doesNotMatch(document, /\bnpm\s+(?:install|ci)\b/i);
    assert.doesNotMatch(document, /TEST2_PASSWORD|Тест 2|обоими тестовыми аккаунтами|Из Тест 1/);
  }
  assert.match(readme, /реальному MySQL.*не входит/is);
  assert.match(plesk, /не поднимает отдельную реальную MySQL-базу/is);
});

test("Block 4b запрещает publisher fixture в production до DB или hash вызовов", async () => {
  const seed = await readFile(path.join(root, "scripts", "seed-publisher.js"), "utf8");
  const guardIndex = seed.indexOf('if (process.env.NODE_ENV === "production")');
  const dbImportIndex = seed.indexOf('await import("../server/db.js")');
  const securityImportIndex = seed.indexOf('await import("../server/security.js")');
  assert.ok(guardIndex >= 0, "publisher seed must have an exact production guard");
  assert.ok(guardIndex < dbImportIndex, "production guard must precede DB module loading");
  assert.ok(guardIndex < securityImportIndex, "production guard must precede hash module loading");
  assert.match(seed, /PUBLISHER_TEST_EMAIL/);
  assert.match(seed, /PUBLISHER_TEST_PASSWORD/);
  assert.match(seed, /local-only fixture and is prohibited in production/);
});

test("production SPA собрана", async () => {
  await access(path.join(root, "dist", "client", "index.html"));
  const html = await readFile(path.join(root, "dist", "client", "index.html"), "utf8");
  assert.match(html, /Book Meet/);
  assert.match(html, /assets\/index-/);
});

test("production branding uses active assets and keeps obsolete files out", async () => {
  const index = await readFile(path.join(root, "index.html"), "utf8");
  const layout = await readFile(path.join(root, "app", "components", "layout", "AppLayout.tsx"), "utf8");
  for (const asset of ["public/book-meet-favicon-v3.png", "public/book-meet-brand-v4.png"]) await access(path.join(root, asset));
  for (const asset of [
    "public/book-meet-favicon.png",
    "public/book-meet-header-logo.png",
    "public/book-meet-header-logo-v2.png",
    "public/favicon.svg",
    "public/file.svg",
    "public/globe.svg",
    "public/window.svg",
  ]) await assert.rejects(access(path.join(root, asset)), { code: "ENOENT" });
  assert.match(index, /book-meet-favicon-v3\.png/);
  assert.match(layout, /book-meet-brand-v4\.png/);
});

test("MySQL-схема содержит все MVP-сущности", async () => {
  const sql = await readFile(path.join(root, "mysql", "migrations", "001_initial.sql"), "utf8");
  for (const table of ["users", "profiles", "sessions", "books", "user_books", "reviews", "excerpts", "friend_requests", "friendships", "follows", "messages", "material_likes", "material_comments", "notifications"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
  }
  assert.match(sql, /ENGINE=InnoDB/);
  assert.match(sql, /CHARSET=utf8mb4/);
});

test("email verification and password recovery use hashed, scoped action tokens", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "028_account_email_tokens.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  const mailer = await readFile(path.join(root, "server", "modules", "mailer.js"), "utf8");
  const security = await readFile(path.join(root, "server", "modules", "account-tokens.js"), "utf8");
  const auth = await readFile(path.join(root, "app", "screens", "AuthScreens.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(migration, /email_verified_at DATETIME NULL/);
  assert.match(migration, /CREATE TABLE(?: IF NOT EXISTS)? account_action_tokens/);
  assert.match(migration, /token_hash CHAR\(64\) NOT NULL/);
  assert.match(migration, /ENUM\('email_verify', 'password_reset'\)/);
  assert.match(security, /createHash\("sha256"\)/);
  assert.match(security, /consumed_at IS NULL AND expires_at > UTC_TIMESTAMP\(\)/);
  assert.match(api, /router\.post\("\/auth\/password-reset\/request"/);
  assert.match(api, /router\.post\("\/auth\/password-reset\/confirm"/);
  assert.match(api, /router\.post\("\/auth\/email-verification\/confirm"/);
  assert.match(api, /DELETE FROM sessions WHERE user_id = \?/);
  assert.match(api, /passwordRecoveryAllowed/);
  assert.match(api, /authText\(locale, "recoveryGeneric"\)/);
  assert.match(authText("ru", "verificationText", { link: "https://example.test" }), /Пароли не отправляются по e-mail/);
  assert.match(mailer, /SMTP_HOST/);
  assert.match(mailer, /SMTP_PASS/);
  assert.doesNotMatch(mailer, /console\.warn\([^)]*error/);
  assert.match(demo, /demoAccountActionTokens/);
  assertLocalized(auth, "auth.recover");
  assert.match(auth, /password-reset\/request/);
  assert.match(auth, /password-reset\/confirm/);
  assert.match(auth, /email-verification\/confirm/);
  assert.match(styles, /\.auth-recovery-link/);
});

test("linked community profiles have a strict one-to-one, session-safe contract", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "029_linked_profiles.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  assert.match(migration, /PRIMARY KEY \(personal_user_id\)/);
  assert.match(migration, /UNIQUE KEY uq_linked_profiles_community \(community_user_id\)/);
  assert.match(migration, /CHECK \(personal_user_id <> community_user_id\)/);
  for (const route of ["/linked-profiles/create", "/linked-profiles/attach", "/linked-profiles/google", "/linked-profiles/switch"]) assert.match(api, new RegExp(`router\\.post\\("${route.replaceAll("/", "\\/")}`));
  assert.match(api, /DELETE FROM sessions WHERE token_hash = \?/);
  assert.match(api, /verifyGoogleIdToken\(credential\)/);
  assert.match(api, /PERSONAL_LINK_TYPES/);
  assert.match(api, /const legalDocuments = legalConsentRequired\(\) \? await activeLegalDocuments/);
  assert.match(api, /recordLegalAcceptances\(connection, communityId, legalDocuments\)/);
  assert.match(data, /linkedProfile: linkedProfileRow/);
  assert.match(demo, /const \{ linkedProfiles: _linkedProfiles, saves: saveEntries,[^\n]+\.\.\.publicState \} = state/);
  assert.match(demo, /router\.post\("\/linked-profiles\/switch"/);
  assertLocalized(profile, "linked.attachCommunity");
  assertLocalized(profile, "linked.title");
  assert.match(profile, /linked-profiles\/google/);
});

test("event forms, ContentHub glyph and community filters keep their scoped UI contracts", async () => {
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(content, /EventForm[\s\S]*className="modal-close"[\s\S]*onClick=\{onCancel\}/);
  assert.match(content, /OccasionForm[\s\S]*className="modal-close"[\s\S]*onClick=\{onCancel\}/);
  assert.match(styles, /\.floating-create-toggle span,[\s\S]*width: 70%;[\s\S]*height: 70%;[\s\S]*font-size: 0;/);
  assert.match(styles, /\.floating-create-toggle span::before,[\s\S]*\.floating-create-toggle span::after[\s\S]*background: currentColor/);
  assert.match(styles, /\.floating-create\.is-open \.floating-create-toggle \{ width: 31px; height: 31px; \}/);
  assert.match(styles, /\.floating-create\.is-open \.floating-create-toggle span \{ transform: rotate\(135deg\); \}/);
  assert.match(styles, /@media \(max-width:800px\)[\s\S]*\.floating-create\.is-open \.floating-create-toggle \{ width: 28px; height: 28px; \}/);
  assert.match(styles, /\.organization-directory-filters\.has-community-type \{ grid-template-columns: minmax\(0,180px\) minmax\(160px,1fr\); width: min\(440px,100%\); \}/);
  assert.match(styles, /@media \(max-width:800px\) \{\s*\.organization-directory-filters\.has-community-type \{ grid-template-columns: minmax\(0,1fr\); width: 100%; \}/);
});

test("TOP3 хранится отдельным ранжированным слотом и обновляется атомарно", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "026_user_books_top3.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  assert.match(migration, /ADD COLUMN top_rank TINYINT UNSIGNED NULL/);
  assert.match(migration, /UNIQUE KEY uq_user_books_user_top_rank \(user_id, top_rank\)/);
  assert.match(api, /SELECT book_id, top_rank FROM user_books WHERE user_id = \? AND top_rank IS NOT NULL ORDER BY top_rank FOR UPDATE/);
  assert.match(api, /UPDATE user_books SET top_rank = NULL WHERE user_id = \? AND book_id = \?/);
  assert.match(api, /code: "TOP3_LIMIT"/);
  assert.match(data, /topRank: book\.top_rank \? Number\(book\.top_rank\) : undefined/);
  assert.match(demo, /topRank = nextTopRank\(topBooks, id\)/);
  assertLocalized(content, "content.top3");
  assert.match(content, /top3-crown/);
  assert.match(content, /sortLibraryBooks/);
});

test("каталожная книга открывает единый BookEditor без дублирования canonical book", async () => {
  const controller = await readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  assertLocalized(content, "content.addLibrary");
  assert.match(content, /bookmeet:add-catalog-book/);
  assert.match(controller, /catalogBookToAdd && <BookEditor/);
  assert.match(controller, /useExistingId: catalogBookId/);
  assert.match(controller, /user\.books\.some\(\(item\) => \(item\.catalogBookId \?\? item\.id\) === catalogBookId\)/);
  assert.match(api, /ON DUPLICATE KEY UPDATE rating = VALUES\(rating\)/);
});

test("zero-owner canonical books stay available across routes, profiles and safe library CTA", async () => {
  const controller = await readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  assert.match(controller, /routeDataRef = useRef\(\{ users, catalog,/);
  assert.match(controller, /routeData\.catalog\.find\(\(book\) => book\.id === route\.overlay!\.id\)/);
  assert.match(controller, /setCatalogBooks\(data\.books \?\? \[\]\)/);
  assert.match(controller, /<MyProfile[^>]*catalog=\{catalog\}/);
  assert.match(controller, /<UserProfileModal[^>]*catalog=\{catalog\}/);
  assert.match(controller, /<AdminCatalogEditor[^>]*catalog=\{catalog\}/);
  assert.match(profile, /<LibraryTab[^>]*catalog=\{catalog\}/);
  assert.match(profile, /<ReviewsTab[^>]*catalog=\{catalog\}/);
  assert.match(profile, /<MyEventsTab[\s\S]{0,500}catalog=\{catalog\}/);
  assert.match(controller, /const payload = \{ rating: book\.rating,[^}]*useExistingId: catalogBookId \}/);
  assert.doesNotMatch(controller.match(/const payload = \{ rating: book\.rating,[^;]+;/)?.[0] ?? "", /author:|title:|links:|coverUrl:/);
  assert.match(api, /readerUsesExistingCanonical/);
  assert.match(api, /const links = readerUsesExistingCanonical \? null : validatedBookLinks/);
  assert.match(demo, /readerUsesExistingCanonical[\s\S]*?\{ \.\.\.canonical, \.\.\.ownerFields, id, catalogBookId: id \}/);
  assert.match(demo, /if \(catalogIndex >= 0\) \{\s+if \(!readerUsesExistingCanonical\)/);
});

test("book search and chat report icon keep shared production contracts", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const chat = await readFile(path.join(root, "app", "components", "chat", "ChatComponents.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(content, /matchesBookQuery\(book, query\)/);
  assert.match(api, /tokens\.map\(\(\) => "LOWER\(CONCAT_WS\(' ', title, author, COALESCE\(isbn, ''\), COALESCE\(publisher, ''\)\)\) LIKE \?"\)\.join\(" AND "\)/);
  assert.match(demo, /tokens\.every\(\(token\) => searchable\.includes\(token\)\)/);
  assert.match(chat, /M12 3 2\.8 20h18\.4L12 3Z/);
  assert.match(chat, /M12 9v5m0 3h\.01/);
  assert.doesNotMatch(chat, /M12 8v6/);
  assert.match(chat, /className="modal-tool-button modal-report-button"/);
  assert.match(styles, /\.modal-tool-button\.modal-report-button \{ color: #c43d3d; border-color: #efbcbc; \}/);
  assert.match(styles, /\.modal-tool-button\.modal-report-button:hover \{ color: #fff; border-color: #c43d3d; background: #c43d3d; \}/);
  assert.doesNotMatch(chat, /chat-report-button/);
});

test("unauthenticated users receive only the authentication screen", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  const controller = await readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8");
  assert.match(api, /router\.use\(asyncRoute\(requireUser\)\)/);
  assert.match(demo, /router\.use\(requireUser\)/);
  assert.match(controller, /if \(!currentUser\) return <LoginScreen/);
  assert.doesNotMatch(controller, /loadPublicCatalog/);
  assert.match(controller, /bookmeet:returnTo/);
});

test("Telegram alerts use a transactional outbox and environment-only credentials", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "027_telegram_alert_outbox.sql"), "utf8");
  const outbox = await readFile(path.join(root, "server", "modules", "telegram-outbox.js"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const server = await readFile(path.join(root, "server", "index.js"), "utf8");
  const environment = await readFile(path.join(root, ".env.example"), "utf8");
  assert.match(migration, /CREATE TABLE telegram_alert_outbox/);
  assert.match(migration, /UNIQUE KEY uq_telegram_alert_outbox_dedupe/);
  assert.match(migration, /delivered_at DATETIME NULL/);
  assert.match(outbox, /available_at <= UTC_TIMESTAMP\(\)/);
  assert.match(outbox, /delivered_at = UTC_TIMESTAMP\(\)/);
  assert.match(outbox, /retryDelaySeconds/);
  assert.match(outbox, /wake\(\)/);
  assert.match(server, /response\.once\("finish"/);
  assert.match(server, /telegramDispatcher\.wake\(\)/);
  for (const eventType of ["support_message", "event_pending", "occasion_pending", "organization_pending", "report_created"]) assert.match(api, new RegExp(`eventType: "${eventType}"`));
  assert.match(server, /telegramDispatcher\?\.stop\(\)/);
  assert.match(environment, /TELEGRAM_ALERTS_ENABLED=0/);
  assert.match(environment, /TELEGRAM_BOT_TOKEN=/);
  assert.match(environment, /TELEGRAM_CHAT_ID=/);
  assert.doesNotMatch(`${api}\n${server}\n${outbox}`, /\d{8,}:[A-Za-z0-9_-]{20,}/);
});

test("occasion preview and modal render primary and audience fields as label-value rows", async () => {
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  assert.match(content, /occasion-audience-row/);
  assert.match(content, /<strong>\{t\(labels\.primary\)\}:<\/strong> <span data-i18n-skip>\{item\.primaryText\}<\/span>/);
  assert.match(content, /<strong>\{t\(labels\.audience\)\}:<\/strong> <span data-i18n-skip>\{item\.audienceText\}<\/span>/);
  assert.doesNotMatch(content, /<h[23]>\{labels\.primary\}: \{item\.primaryText\}<\/h[23]>/);
  assert.match(content, /CityAutocomplete label=\{t\("occasion\.cityOptional"\)\} value=\{targetCityDraft\}/);
  assert.match(content, /targetCities: \[name\]/);
  assert.match(content, /placeholder=\{value\.type === "invite" \? t\("occasion\.offerPlaceholder"\) : undefined\}/);
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
  assertLocalized(page, "wishlist.recipientPhone");
  assertLocalized(page, "book.autofillHint");
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
  assertLocalized(content, "book.manualFill");
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
  assert.match(chat, /adminMode \? t\("chat\.requests"\) : t\("chat\.friends"\)/);
  assertLocalized(chat, "chat.requests");
  assertLocalized(chat, "chat.friends");
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
  assertLocalized(page, "security.qrAlt");
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
  assertLocalized(page, "auth.googleSlow");
});

test("главная страница использует единую ленту и единое меню создания", async () => {
  const page = await readFrontendSource();
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(page, /scopedEvents\.slice\(0, 2\)/);
  assert.match(page, /eventTimestamp\(item\) > eventClock/);
  assert.match(page, /profile\.homeView \?\? "feed"/);
  assert.match(page, /ContentHubControls/);
  assert.match(page, /showSwitch=\{false\}/);
  assert.match(api, /router\.patch\("\/users\/me\/home-view"/);
  assert.match(page, /const homeMode = "feed"/);
  assert.doesNotMatch(page, /className="secondary-action-button"[^\n]*Смотреть всё/);
  assert.match(page, /HomeScopeSwitch city=\{currentCity\}/);
  assert.match(css, /\.home-content > \.content-section \+ \.content-section/);
  assert.match(css, /\.floating-create/);
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

test("диалоги маршрутизируются, а чат открывается отдельной страницей", async () => {
  const page = await readFrontendSource();
  const routes = await readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8");
  const chat = await readFile(path.join(root, "app", "components", "chat", "ChatComponents.tsx"), "utf8");
  assert.match(routes, /\^\\\/chat\\\/\(\\d\+\)\$/);
  assert.match(routes, /chatMode\?: "compact" \| "expanded"/);
  assert.match(page, /chatMode: "compact"/);
  assert.match(page, /setChatExpanded\(false\)/);
  assert.match(page, /closest\("\.chat-popup, \.friends-panel"\)/);
  assert.match(page, /window\.history\[isSwitchingChat \? "replaceState" : "pushState"\]/);
  assert.match(page, /chatMode: nextExpanded \? "expanded" : "compact"/);
  assert.match(page, /const chatPage = selectedFriend \? <ChatView/);
  assert.match(page, /fullPage \/>/);
  assert.match(chat, /fullPage \? "chat-full-page" : ""/);
});

test("профили сообществ, видимость меню и издательские разрешения имеют сквозной контракт", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "025_community_profile_settings.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const demo = await readFile(path.join(root, "server", "demo-api.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const directory = await readFile(path.join(root, "app", "screens", "UsersDirectoryScreen.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  assert.match(migration, /community_type VARCHAR\(255\)/);
  assert.match(migration, /community_rules TEXT/);
  assert.match(migration, /hidden_profile_tabs LONGTEXT/);
  assert.match(migration, /DELETE fr[\s\S]+target_profile\.profile_type <> 'Сообщество'/);
  assert.match(data, /hiddenProfileTabs: deletedView \? \[\] : parseJson\(row\.hidden_profile_tabs\)/);
  assert.match(data, /communityType: deletedView \? "" : row\.community_type \?\? ""/);
  assert.match(api, /tab !== "main" && tab !== "settings"/);
  assert.match(api, /communityMembership: target\.profile_type === "Сообщество"/);
  assert.match(api, /canMessagePair\(\{ friends: Boolean\(friendship\)/);
  assert.match(demo, /canMessagePair\(\{ friends, communityMembers: membership/);
  assert.match(demo, /const blockedPair = state\.blocks\.some/);
  assert.match(profile, /placeholder=\{t\("linked\.communityPlaceholder"\)\}/);
  assertLocalized(profile, "linked.communityPlaceholder");
  assert.doesNotMatch(profile, /t\("settings\.showMenu"\)/);
  assert.doesNotMatch(profile, /profile-menu-visibility-settings/);
  assertLocalized(directory, "directory.communityType");
  assert.match(content, /const publisherPair =/);
  assert.match(content, /publisherMode \? \[/);
});

test("адаптивный редактор, обложки и мобильная статистика закреплены интерфейсом", async () => {
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const screens = await readFile(path.join(root, "app", "screens", "ContentScreens.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app", "globals.css"), "utf8");
  const controls = await readFile(path.join(root, "app", "components", "content", "ContentHubControls.tsx"), "utf8");
  assert.match(content, /closest\("\.rich-book-search, \.rich-book-tool"\)/);
  assert.match(content, /window\.addEventListener\("keydown", close\)/);
  assert.match(content, /reading-stats-mobile-chart/);
  assert.match(controls, /const reader = normalizedProfileType === "Читатель"/);
  assert.match(controls, /data-material-action="event"/);
  assert.match(controls, /data-material-action="review"/);
  assert.match(styles, /all-books-grid \{ grid-template-columns: repeat\(6,minmax\(0,1fr\)\); grid-auto-rows: 1fr/);
  assert.match(styles, /all-books-grid \.library-book \{ display: flex; flex-direction: column; align-items: stretch/);
  assert.match(screens, /className="all-books-cover-frame"/);
  assert.match(styles, /all-books-cover-frame \{ position: relative; flex: 0 0 auto; width: auto; min-width: 0; max-width: 100%; height: 0; overflow: hidden; padding-top: 150%/);
  assert.match(styles, /all-books-grid \.all-books-cover-frame > \.library-book-cover \{ background-size: cover/);
  assert.match(styles, /organization-directory-filters\.has-community-type \{ grid-template-columns:/);
  assert.match(styles, /reading-stats-mobile-row/);
  assert.match(styles, /publishing-card-intro > \.avatar/);
  assert.match(styles, /chat-popup \.chat-close-action/);
  assert.match(styles, /\.mobile-friends-backdrop \{ display: none; \}/);
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

test("несколько книг, строгие города и управление событиями подключены к интерфейсу", async () => {
  const page = await readFrontendSource();
  const controllerUtils = await readFile(path.join(root, "app", "hooks", "controller-utils.ts"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const header = await readFile(path.join(root, "app", "components", "layout", "AppLayout.tsx"), "utf8");
  assert.match(controllerUtils, /const MIN_LOADING_MS = 3_000/);
  assert.match(content, /linkedBookIds: number\[\]/);
  assert.match(content, />＋ \{t\("event\.addBook"\)\}<\/button>/);
  assertLocalized(content, "event.addBook");
  assert.match(content, /className="material-books-field"/);
  assertLocalized(content, "content.createBookFirst");
  assert.match(content, /function PublicProfileDetails/);
  assert.match(content, /className="my-events-tab"/);
  assert.doesNotMatch(header, /Твоё книжное пространство/);
  for (const key of ["nav.books", "nav.communities", "nav.partners", "nav.publishing"]) assertLocalized(header, key);
});

test("импорт, редакторы, поводы и адаптивный интерфейс закреплены production-контрактами", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "023_material_books_occasions_home_view.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  const packageJson = await readFile(path.join(root, "package.json"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS material_books/);
  assert.match(migration, /ADD COLUMN home_view/);
  assert.match(migration, /meeting_address/);
  assert.match(api, /\/admin\/books\/import\/preview/);
  assert.match(api, /\/admin\/books\/import\/resolve/);
  assert.match(api, /syncMaterialBooks/);
  assertLocalized(content, "editor.insertImage");
  assertLocalized(content, "editor.insertBook");
  assert.match(content, /rich-media-tool-button/);
  assertLocalized(content, "occasion.discuss");
  assert.match(content, /MaterialEngagement kind="occasion"/);
  assertLocalized(profile, "admin.importCatalog");
  assertLocalized(profile, "profile.occasions");
  assert.match(profile, /activeTab === "occasions"/);
  assert.match(profile, /className="profile-nav"/);
  assert.match(css, /Mobile is a dedicated layout layer/);
  assert.match(css, /\.excerpt-card\.review-preview-card/);
  assert.match(packageJson, /xlsx-0\.20\.3/);
});

test("полный каталог админки, издательские материалы, реакции и обновлённая авторизация закреплены контрактами", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const screens = await readFile(path.join(root, "app", "screens", "ContentScreens.tsx"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const auth = await readFile(path.join(root, "app", "screens", "AuthScreens.tsx"), "utf8");
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(profile, /apiFetch\("\/api\/books\/catalog"/);
  assert.match(profile, /kind: "publisher_news" as const/);
  assertLocalized(profile, "admin.publisherEvent");
  assert.match(api, /\["book", "review", "excerpt", "publisher_news"\]/);
  assert.match(api, /publisher_news: "publisher_news"/);
  assert.match(content, /MaterialEngagement kind="event"/);
  assert.match(content, /MaterialEngagement kind="occasion"/);
  assert.match(content, /MaterialEngagement kind="publisher_news"/);
  assert.match(content, /export function PublisherNewsEditor/);
  assert.doesNotMatch(screens, /Каталог Book Meet/);
  assert.match(screens, /<EmptyContentState \/>/);
  assert.match(auth, /book-meet-brand-v4\.png/);
  assert.match(auth, /setMode\(nextMode\)/);
  assert.match(auth, /login-turning-back">\{invitation/);
  assert.match(auth, /className="mobile-auth-invitation"/);
  assert.match(auth, /formMode === "login" \? t\("auth\.firstTime"\) : t\("auth\.hasProfile"\)/);
  assertLocalized(auth, "auth.firstTime");
  assertLocalized(auth, "auth.hasProfile");
  assert.doesNotMatch(auth, /className="auth-invitation-mark"/);
  assert.doesNotMatch(auth, /className="outline-button mobile-auth-mode-switch"/);
  assert.doesNotMatch(css, /workspace\.workspace-content-hub > \.friends-panel \{ display: none/);
  assert.match(css, /\.content-hub-switch \{ position: sticky; z-index: 22; top: 158px/);
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
  assertLocalized(profile, "form.requiredFields");
  assert.match(profile, /!profile\.cityId/);
  assert.match(profile, /canvas\.toDataURL\("image\/webp", 0\.82\)/);
  assertLocalized(chat, "chat.shareUser");
  assert.match(chat, /itemFromUrl/);
  assert.match(auth, /const visibleMode = mode/);
  assert.match(auth, /auth-switch-placeholder/);
});

test("library reading status stays in the library and drives book audiences", async () => {
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  assert.match(content, /aria-label=\{t\("library\.bookStatus"\)\}/);
  assertLocalized(content, "library.bookStatus");
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
  assert.match(api, /Профиль организации ожидает официального подтверждения/);
  assert.match(data, /publisherBin: viewerIsAdmin && !deletedView \? row\.publisher_bin/);
  assert.doesNotMatch(data, /viewerIsAdmin \|\| Number\(row\.id\) === Number\(viewerId\) \? row\.publisher_bin/);
  assert.match(routes, /publishing: "\/publishing"/);
  assertLocalized(profile, "profile.publisherBooks");
  assertLocalized(profile, "profile.publisherNews");
  assert.match(directory, /export function PublishingDirectoryPage/);
});

test("communities, membership chats and responsive conversation panels share production contracts", async () => {
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const profile = await readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8");
  const content = await readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8");
  const directory = await readFile(path.join(root, "app", "screens", "UsersDirectoryScreen.tsx"), "utf8");
  const layout = await readFile(path.join(root, "app", "components", "layout", "AppLayout.tsx"), "utf8");
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  assert.match(api, /profile_type IN \('Издатель', 'Сообщество'\)/);
  assert.match(api, /Сообщество не может отправлять запросы дружбы/);
  assert.match(api, /хочет присоединиться к сообществу/);
  assert.match(api, /creator_user_id AS owner_id, title FROM events/);
  assert.match(api, /creator_user_id AS owner_id, primary_text AS title FROM occasions/);
  assert.match(api, /publisher_news n JOIN profiles p/);
  assert.doesNotMatch(profile, /t\("communities\.memberOf"\)/);
  assertLocalized(content, "profile.joinCommunity");
  assert.match(content, /profileFriends/);
  assert.match(directory, /export function CommunitiesDirectoryPage/);
  assertLocalized(directory, "directory.communityName");
  assert.match(layout, /mobile-chat-button/);
  assert.match(css, /workspace\.mobile-friends-closed > \.friends-panel/);
  assert.match(css, /grid-template-columns: repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css, /\.rich-editor-toolbar \{ flex-wrap: nowrap/);
});

test("legal, complaint, age and deletion compliance is enforced beyond the frontend", async () => {
  const migration = await readFile(path.join(root, "mysql", "migrations", "030_legal_safety_compliance.sql"), "utf8");
  const legalDocumentMigration = await readFile(path.join(root, "mysql", "migrations", "031_community_moderation_legal_document.sql"), "utf8");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const compliance = await readFile(path.join(root, "server", "modules", "compliance.js"), "utf8");
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const auth = await readFile(path.join(root, "app", "screens", "AuthScreens.tsx"), "utf8");
  const adminCompliance = await readFile(path.join(root, "app", "components", "admin", "AdminCompliancePanel.tsx"), "utf8");
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  const audit = await readFile(path.join(root, "DATA-PROCESSING-AUDIT.md"), "utf8");

  for (const table of ["legal_documents", "legal_acceptances", "report_status_history", "report_appeals", "moderation_audit_log", "security_event_log", "security_incidents", "finalized_profile_deletions"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(legalDocumentMigration, /community_moderation_rules/);
  assert.match(legalDocumentMigration, /Согласие на сбор и обработку персональных данных/);
  assert.match(legalDocumentMigration, /WHERE document_type = 'personal_data_consent'/);
  assert.match(api, /router\.get\("\/auth\/legal-documents"/);
  assert.match(api, /required: legalConsentRequired\(\)/);
  assert.match(api, /LEGAL_DOCUMENT_TYPES\.includes\(type\)/);
  assert.match(compliance, /REQUIRED_LEGAL_DOCUMENT_TYPES/);
  assert.match(api, /router\.post\("\/legal\/acceptances"/);
  assert.match(api, /router\.patch\("\/admin\/legal-documents\/:id"/);
  assert.match(api, /router\.delete\("\/admin\/legal-documents\/:id"/);
  assert.match(api, /legalDocumentWriteMode\(acceptanceCount, current\.version, version\)/);
  assert.match(api, /assertLegalDocumentDeletable\(usage\?\.count\)/);
  assert.match(compliance, /LEGAL_DOCUMENT_NEW_VERSION_REQUIRED/);
  assert.match(compliance, /LEGAL_DOCUMENT_IN_USE/);
  assert.match(api, /acceptance_count/);
  assert.match(api, /LEGAL_REACCEPTANCE_REQUIRED/);
  assert.match(api, /PROFILE_COMPLETION_REQUIRED/);
  assert.match(api, /await assertAgeCompatible\(connection, userId, targetId\)/);
  assert.match(api, /await assertAdultMaterialReadable\(connection, senderUserId/);
  assert.match(api, /await assertAdultMaterialReadable\(connection, recipientUserId/);
  assert.match(api, /reference = `BMC-/);
  assert.match(api, /INTERVAL 21 DAY/);
  assert.match(api, /(?:укажите|заполните) мотивированный ответ/i);
  assert.match(api, /UPDATE reports SET reporter_user_id = NULL, reporter_anonymized = 1/);
  assert.doesNotMatch(api, /DELETE FROM reports WHERE reporter_user_id/);
  assert.doesNotMatch(api, /DELETE FROM messages WHERE sender_user_id/);
  assert.match(compliance, /CROSS_AGE_INTERACTION_FORBIDDEN/);
  assert.match(compliance, /INSERT INTO moderation_audit_log/);
  assert.match(compliance, /LEGAL_CONSENT_REQUIRED/);
  assert.match(auth, /legalConfig\.required/);
  assert.match(data, /publisherBin: viewerIsAdmin && !deletedView \? row\.publisher_bin/);
  assert.match(auth, /agreementAccepted/);
  assert.match(auth, /personalDataAccepted/);
  assert.match(adminCompliance, /jsonRequest\("\/api\/admin\/legal-documents"\)/);
  assert.match(adminCompliance, /method: editingDocumentId \? "PATCH" : "POST"/);
  assert.match(adminCompliance, /method: "DELETE"/);
  assert.match(adminCompliance, /admin\.legalOverview/);
  assert.match(adminCompliance, /legal\.communityModerationRules/);
  assert.match(adminCompliance, /admin\.incidentFormTitle/);
  assert.match(css, /\.admin-compliance-form input:not\(\[type="checkbox"\]\)/);
  assert.match(audit, /openid email profile/);
  assert.match(audit, /finalized_profile_deletions/);
});
