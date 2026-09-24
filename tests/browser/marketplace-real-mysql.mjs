// Opt-in rendered release acceptance. Run only after migrations and seed on the guarded disposable MySQL DB.
import assert from "node:assert/strict";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { assertSafeIntegrationEnvironment, composeFile, composeProject, createTestEnvironment, testDatabaseEnvironment } = await import("../../scripts/db-test.mjs");
Object.assign(process.env, testDatabaseEnvironment, {
  BOOK_MEET_MARKETPLACE_ENABLED: "1",
  BOOK_MEET_GROUP_CHATS_ENABLED: "1",
});
assertSafeIntegrationEnvironment();

const docker = spawnSync("docker", ["compose", "--project-name", composeProject, "--file", composeFile, "ps", "--status", "running", "--services"], { cwd: root, encoding: "utf8", shell: false });
assert.equal(docker.status, 0, `Could not inspect the dedicated Book Meet test container: ${docker.stderr || docker.error?.message || "unknown error"}`);
assert.ok(docker.stdout.split(/\r?\n/).includes("mysql"), "Start the dedicated DB with pnpm db:test:up before this acceptance");

const mysqlCheck = mysql.createPool({ host: testDatabaseEnvironment.DB_HOST, port: Number(testDatabaseEnvironment.DB_PORT), database: testDatabaseEnvironment.DB_NAME, user: testDatabaseEnvironment.MYSQL_TEST_ROOT_USER, password: testDatabaseEnvironment.MYSQL_TEST_ROOT_PASSWORD, connectionLimit: 1, timezone: "Z" });
const migrationNames = (await readdir(path.join(root, "mysql", "migrations"))).filter((name) => name.endsWith(".sql")).sort();
try {
  const [[metadata]] = await mysqlCheck.query("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ? AND table_name = 'schema_migrations'", [testDatabaseEnvironment.DB_NAME]);
  if (Number(metadata.total) === 0) {
    const [[existingTables]] = await mysqlCheck.query("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?", [testDatabaseEnvironment.DB_NAME]);
    assert.equal(Number(existingTables.total), 0, "Refusing to initialize a database with tables but no migration ledger; reset only the dedicated test DB first");
    console.log("Fresh dedicated test database detected; applying active migrations and test seed.");
    for (const script of ["scripts/migrate.js", "scripts/seed.js"]) {
      const result = spawnSync(process.execPath, [script], { cwd: root, env: createTestEnvironment(), encoding: "utf8", shell: false });
      assert.equal(result.status, 0, `${script} failed: ${result.stderr || result.error?.message || result.stdout || "unknown error"}`);
      if (result.stdout.trim()) console.log(result.stdout.trim());
    }
  }
  const [appliedRows] = await mysqlCheck.query("SELECT migration_name FROM schema_migrations ORDER BY migration_name");
  assert.deepEqual(appliedRows.map((row) => row.migration_name), migrationNames, "The disposable database must have every current migration applied before the browser run");
  const [[attempts]] = await mysqlCheck.query("SELECT COUNT(*) AS total FROM schema_migration_attempts WHERE status <> 'succeeded'");
  assert.equal(Number(attempts.total), 0, "The disposable database must have no unresolved migration attempts");
  const [[cities]] = await mysqlCheck.query("SELECT COUNT(*) AS total FROM cities WHERE country_code = 'KZ'");
  assert.ok(Number(cities.total) > 0, "The seeded Kazakh city catalog is required for the rendered create flow");
} finally {
  await mysqlCheck.end();
}

const { queue3HttpFixture } = await import("../helpers/queue3-http.mjs");
const artifactDir = path.join(root, "test-results", "marketplace-real-mysql");
const listingIds = [];
const conversations = [];
let primaryFailure;
let fixture;
let browser;

function sessionCookie(actor) {
  const separator = actor.cookie.indexOf("=");
  return { name: actor.cookie.slice(0, separator), value: actor.cookie.slice(separator + 1), url: fixture.origin, httpOnly: true, sameSite: "Lax" };
}

async function inspectPage(page, label) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") failures.push(`console.error: ${message.text()}`); });
  page.on("requestfailed", (request) => {
    if (request.resourceType() === "eventsource" && request.failure()?.errorText === "net::ERR_ABORTED") return;
    failures.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", (response) => { if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`); });
  return {
    async assertClean() { assert.deepEqual(failures, [], `${label} browser diagnostics`); },
  };
}

try {
  fixture = await queue3HttpFixture(`mk${process.pid.toString(36)}`, { serveClient: true });
  await mkdir(artifactDir, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const cityRows = await fixture.db.query("SELECT id, COALESCE((SELECT name FROM city_aliases WHERE city_id = cities.id AND language_code = 'ru' LIMIT 1), name) AS name FROM cities WHERE country_code = 'KZ' AND (name_key LIKE '%алма%' OR name_key LIKE '%астан%') ORDER BY population DESC, id LIMIT 1");
  assert.ok(cityRows[0][0], "A real city row must exist for listing creation");
  const acceptanceCityId = Number(cityRows[0][0].id);

  async function completeFixtureProfile(actor) {
    await fixture.db.query("UPDATE users SET username_is_temporary = 0, profile_completed = 1 WHERE id = ?", [actor.id]);
    await fixture.db.query("UPDATE profiles SET city = 'Алматы', city_id = ? WHERE user_id = ?", [acceptanceCityId, actor.id]);
  }

  const [headRows] = await fixture.db.query("SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 1");
  console.log(`Database migration head: ${headRows[0]?.migration_name}; active migrations: ${migrationNames.length}`);
  const viewportCases = [
    { name: "desktop", width: 1440, height: 900, mobile: false },
    { name: "mobile", width: 390, height: 844, mobile: true },
  ];

  for (const viewport of viewportCases) {
    const seller = await fixture.user(`${viewport.name}-seller`);
    const buyer = await fixture.user(`${viewport.name}-buyer`);
    const minor = await fixture.user(`${viewport.name}-minor`, { minor: true });
    await Promise.all([seller, buyer, minor].map(completeFixtureProfile));
    const listingTitle = `Проверочная книга ${viewport.name}`;
    const author = `Автор ${viewport.name}`;
    const listingRequest = await fixture.call(minor, "GET", "/marketplace/listings", undefined, 403);
    assert.match(String(listingRequest.code ?? listingRequest.error), /MARKETPLACE_ADULTS_ONLY|несовершеннолет|совершеннолет/i, "The production router must deny minor listing reads");

    const sellerContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    await sellerContext.addCookies([sessionCookie(seller)]);
    const sellerPage = await sellerContext.newPage();
    const sellerDiagnostics = await inspectPage(sellerPage, `${viewport.name} seller`);
    await sellerPage.goto(`${fixture.origin}/marketplace`);
    await expect(sellerPage.getByRole("heading", { name: "Книжный маркетплейс" })).toBeVisible();
    await sellerPage.getByRole("tab", { name: "Мои объявления" }).click();
    await sellerPage.getByRole("button", { name: /Разместить объявление/ }).click();
    const form = sellerPage.locator(".marketplace-form");
    await form.getByLabel("Название книги").fill(listingTitle);
    await form.getByLabel("Автор").fill(author);
    await form.getByLabel("Состояние").fill("Хорошее");
    await form.getByLabel("Описание").fill("Реальная проверка интерфейса с production API router и disposable MySQL.");
    await form.getByRole("textbox", { name: "Город", exact: true }).fill("Алма");
    await form.getByRole("option", { name: /Алматы/ }).click();
    await form.getByLabel("Цена", { exact: true }).fill("1200");
    const createdResponsePromise = sellerPage.waitForResponse((response) => response.url().endsWith("/api/marketplace/listings") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Сохранить" }).click();
    const createdResponse = await createdResponsePromise;
    assert.equal(createdResponse.status(), 201, `Rendered create should call the production router: ${createdResponse.status()} ${JSON.stringify(await createdResponse.json())}`);
    const createdBody = await createdResponse.json();
    const listingId = Number(createdBody.listing.id);
    listingIds.push(listingId);
    assert.equal(createdBody.listing.title, listingTitle);
    assert.equal(createdBody.listing.cityId, acceptanceCityId);
    await expect(sellerPage.locator(".marketplace-card")).toContainText(listingTitle);
    const [[persistedListing]] = await fixture.db.query("SELECT seller_user_id, book_title, book_author, city_id, status FROM marketplace_listings WHERE id = ?", [listingId]);
    assert.deepEqual({ sellerId: Number(persistedListing.seller_user_id), title: persistedListing.book_title, author: persistedListing.book_author, cityId: Number(persistedListing.city_id), status: persistedListing.status }, { sellerId: seller.id, title: listingTitle, author, cityId: acceptanceCityId, status: "active" });
    await sellerDiagnostics.assertClean();
    await sellerContext.close();

    const buyerContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    await buyerContext.addCookies([sessionCookie(buyer)]);
    const buyerPage = await buyerContext.newPage();
    const buyerDiagnostics = await inspectPage(buyerPage, `${viewport.name} buyer`);
    await buyerPage.goto(`${fixture.origin}/marketplace`);
    await expect(buyerPage.getByRole("button", { name: `${listingTitle} — ${author}` })).toBeVisible();
    await buyerPage.getByRole("button", { name: `${listingTitle} — ${author}` }).click();
    const detail = buyerPage.getByRole("dialog", { name: listingTitle });
    await expect(detail.getByText("Book Meet не принимает оплату", { exact: false })).toBeVisible();
    await detail.getByRole("button", { name: "Написать продавцу" }).click();
    const conversationsDialog = buyerPage.getByRole("dialog", { name: "Диалоги по объявлениям" });
    await expect(conversationsDialog.getByText(listingTitle)).toBeVisible();
    await conversationsDialog.getByRole("button", { name: "Начать диалог" }).click();
    await expect(conversationsDialog.getByLabel("Сообщение")).toBeVisible();
    const conversationMessage = `Проверка диалога ${viewport.name}`;
    await conversationsDialog.getByLabel("Сообщение").fill(conversationMessage);
    const sentMessagePromise = buyerPage.waitForResponse((response) => response.url().includes("/api/marketplace/conversations/") && response.url().endsWith("/messages") && response.request().method() === "POST");
    await conversationsDialog.getByRole("button", { name: "Отправить" }).click();
    const sentMessageResponse = await sentMessagePromise;
    assert.equal(sentMessageResponse.status(), 201, "Buyer conversation message should persist");
    await expect(conversationsDialog.getByText(conversationMessage)).toBeVisible();
    const [[conversationRow]] = await fixture.db.query("SELECT id FROM conversations WHERE marketplace_listing_id = ? AND marketplace_buyer_reference_id = ?", [listingId, buyer.id]);
    assert.ok(conversationRow?.id, "A real conversation row must be stored for the buyer/listing pair");
    conversations.push(Number(conversationRow.id));

    const screenshotPath = path.join(artifactDir, `marketplace-real-mysql-${viewport.name}.png`);
    await buyerPage.screenshot({ path: screenshotPath, fullPage: true });
    const layout = await buyerPage.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, listingPresent: document.body.innerText.includes("Книжный маркетплейс"), conversationPresent: document.body.innerText.includes("Диалоги по объявлениям") }));
    assert.equal(layout.listingPresent, true, `${viewport.name} rendered listing screen text`);
    assert.equal(layout.conversationPresent, true, `${viewport.name} rendered conversation screen text`);
    assert.ok(layout.documentWidth <= layout.viewportWidth + 1, `${viewport.name} page overflow: ${layout.documentWidth}px > ${layout.viewportWidth}px`);
    await buyerDiagnostics.assertClean();
    await buyerContext.close();

    const minorContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    await minorContext.addCookies([sessionCookie(minor)]);
    const minorPage = await minorContext.newPage();
    const minorDiagnostics = await inspectPage(minorPage, `${viewport.name} minor`);
    let attemptedMarketplaceRead = false;
    minorPage.on("request", (request) => { if (request.method() === "GET" && new URL(request.url()).pathname === "/api/marketplace/listings") attemptedMarketplaceRead = true; });
    await minorPage.goto(`${fixture.origin}/marketplace`);
    await expect(minorPage.getByText("Раздел доступен только совершеннолетним пользователям личных профилей.")).toBeVisible();
    assert.equal(attemptedMarketplaceRead, false, "The rendered minor gate must not request the listing feed");
    await minorDiagnostics.assertClean();
    await minorContext.close();
    console.log(`${viewport.name}: rendered create/view/conversation, minor gate; screenshot=${path.relative(root, screenshotPath)}`);
  }
  console.log("Real-router marketplace browser acceptance passed for desktop (1440x900) and touch mobile (390x844).");
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  try {
    if (browser) await browser.close();
    if (fixture) {
      if (conversations.length) await fixture.db.query("DELETE FROM messages WHERE conversation_id IN (?)", [conversations]);
      if (listingIds.length) {
        await fixture.db.query("DELETE FROM conversations WHERE marketplace_listing_id IN (?)", [listingIds]);
        await fixture.db.query("DELETE FROM marketplace_listings WHERE id IN (?)", [listingIds]);
      }
    }
  } finally {
    if (fixture) {
      try { await fixture.close(); }
      catch (error) { if (primaryFailure) console.error(`Fixture cleanup also failed: ${error.message}`); else throw error; }
    }
  }
}
