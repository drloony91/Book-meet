import { expect, loginAs, test } from "./fixtures";

test.beforeEach(async ({ resetDemo }) => { await resetDemo(); });
test.afterEach(async ({ browserDiagnostics }) => { await browserDiagnostics.assertNoErrors(); });

test("adult marketplace shows listings and listing-bound conversation on desktop and mobile", async ({ page }) => {
  const listing = { id: 1, sellerId: 2, sellerName: "Продавец", sellerUsername: "seller", catalogBookId: null, title: "Бумажная книга", author: "Автор", type: "sale", condition: "Хорошее", description: "Чистый экземпляр", cityId: 1, cityName: "Алматы", price: 2500, currency: "KZT", exchangeWishes: null, status: "active", images: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const conversation = { id: 14, buyerId: 3, sellerId: 2, mine: "buyer", listing: { id: 1, unavailable: false, title: listing.title, author: listing.author, price: 2500, currency: "KZT", status: "active" }, safetyWarning: "Book Meet не принимает оплату и не участвует в сделке." };
  let started = false;
  let message = "";
  const reports: Array<Record<string, unknown>> = [];
  await page.route("**/api/bootstrap/session", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, features: { ...data.features, marketplace: true } } });
  });
  await page.route(/\/api\/marketplace\/listings(?:\?.*)?$/, async (route) => { await route.fulfill({ json: { listings: [listing], nextBeforeId: null } }); });
  await page.route("**/api/marketplace/listings/1", async (route) => { await route.fulfill({ json: { listing } }); });
  await page.route("**/api/marketplace/listings/1/conversations", async (route) => { started = true; await route.fulfill({ status: 201, json: { conversation } }); });
  await page.route("**/api/marketplace/conversations", async (route) => { await route.fulfill({ json: { conversations: started ? [conversation] : [] } }); });
  await page.route("**/api/marketplace/conversations/14/messages", async (route) => {
    if (route.request().method() === "POST") { message = (route.request().postDataJSON() as { body: string }).body; await route.fulfill({ status: 201, json: { message: { id: 1, senderId: 3, mine: true, body: message, createdAt: new Date().toISOString() } } }); }
    else await route.fulfill({ json: { messages: [], nextBeforeId: null } });
  });
  await page.route("**/api/reports", async (route) => {
    reports.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, json: { id: reports.length, reference: `BMC-2026-${String(reports.length).padStart(6, "0")}`, status: "new" } });
  });
  await loginAs(page, 3, "/marketplace");
  await expect(page.getByRole("heading", { name: "Книжный маркетплейс" })).toBeVisible();
  await expect(page.locator(".marketplace-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Бумажная книга — Автор" }).click();
  await expect(page.getByRole("dialog", { name: "Бумажная книга" })).toBeVisible();
  await page.getByRole("button", { name: "Пожаловаться на продавца" }).click();
  const sellerReport = page.getByRole("form", { name: "Жалоба на продавца" });
  await sellerReport.getByLabel("Причина").fill("Продавец просит оплату вне платформы");
  await sellerReport.getByRole("button", { name: "Отправить жалобу на продавца" }).click();
  await expect(page.getByRole("alert")).toContainText("Жалоба на продавца отправлена");
  expect(reports[0]).toEqual({ targetKind: "user", targetId: 2, reason: "Продавец просит оплату вне платформы" });
  await page.getByRole("button", { name: "Бумажная книга — Автор" }).click();
  await page.getByRole("button", { name: "Пожаловаться на объявление" }).click();
  const listingReport = page.getByRole("form", { name: "Жалоба на объявление" });
  await listingReport.getByLabel("Причина").fill("Подозрительное объявление");
  await listingReport.getByRole("button", { name: "Отправить жалобу" }).click();
  await expect(page.getByRole("alert")).toContainText("Жалоба на объявление отправлена");
  expect(reports[1]).toEqual({ targetKind: "marketplace_listing", targetId: 1, reason: "Подозрительное объявление" });
  await page.getByRole("button", { name: "Бумажная книга — Автор" }).click();
  await page.getByRole("button", { name: "Написать продавцу" }).click();
  const conversations = page.getByRole("dialog", { name: "Диалоги по объявлениям" });
  await expect(conversations.getByText("Book Meet не принимает оплату", { exact: false })).toBeVisible();
  await conversations.getByRole("button", { name: "Начать диалог" }).click();
  await expect(conversations.getByLabel("Сообщение")).toBeVisible();
  await conversations.getByLabel("Сообщение").fill("Здравствуйте, книга ещё доступна?");
  await conversations.getByRole("button", { name: "Отправить" }).click();
  await expect(conversations.getByText("Здравствуйте, книга ещё доступна?")).toBeVisible();
  expect(message).toBe("Здравствуйте, книга ещё доступна?");
});

test("minor access projection prevents marketplace listing requests", async ({ page }) => {
  let listingRequests = 0;
  await page.route("**/api/bootstrap/session", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, features: { ...data.features, marketplace: true } } });
  });
  await page.route("**/api/bootstrap/catalog", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, adultAccess: { status: "minor", restricted: {} } } });
  });
  await page.route("**/api/marketplace/listings?*", async (route) => { listingRequests += 1; await route.fulfill({ json: { listings: [], nextBeforeId: null } }); });
  await loginAs(page, 3, "/marketplace");
  await expect(page.getByText("Раздел доступен только совершеннолетним пользователям личных профилей.")).toBeVisible();
  expect(listingRequests).toBe(0);
});

test("owner creates, reserves and removes a listing with a selected city", async ({ page }) => {
  let listing: Record<string, unknown> | null = null;
  let createdPayload: Record<string, unknown> | null = null;
  await page.route("**/api/bootstrap/session", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, features: { ...data.features, marketplace: true } } });
  });
  await page.route("**/api/cities?*", async (route) => { await route.fulfill({ json: { cities: [{ id: 5, name: "Алматы", country: "Казахстан", countryCode: "KZ" }] } }); });
  await page.route("**/api/marketplace/listings/mine", async (route) => { await route.fulfill({ json: { listings: listing ? [listing] : [] } }); });
  await page.route("**/api/marketplace/listings/81", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { listing } });
    if (route.request().method() === "PATCH") { listing = { ...listing, ...(route.request().postDataJSON() as object) }; return route.fulfill({ json: { listing } }); }
    listing = null;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(/\/api\/marketplace\/listings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      createdPayload = route.request().postDataJSON() as Record<string, unknown>;
      listing = { id: 81, sellerId: 3, sellerName: "Читатель", sellerUsername: "reader", catalogBookId: null, title: createdPayload.title, author: createdPayload.author, type: createdPayload.type, condition: createdPayload.condition, description: createdPayload.description, cityId: 5, cityName: "Алматы", price: createdPayload.price, currency: "KZT", exchangeWishes: null, status: "active", images: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      return route.fulfill({ status: 201, json: { listing } });
    }
    await route.fulfill({ json: { listings: [], nextBeforeId: null } });
  });
  await loginAs(page, 3, "/marketplace");
  await page.getByRole("tab", { name: "Мои объявления" }).click();
  await page.getByRole("button", { name: /Разместить объявление/ }).click();
  const form = page.locator(".marketplace-form");
  await form.getByLabel("Название книги").fill("Старый переплёт");
  await form.getByLabel("Автор").fill("М. Автор");
  await form.getByLabel("Состояние").fill("Хорошее");
  await form.getByLabel("Описание").fill("Экземпляр без пометок");
  await form.getByRole("textbox", { name: "Город", exact: true }).fill("Ал");
  await form.getByRole("option", { name: /Алматы/ }).click();
  await form.getByLabel("Цена", { exact: true }).fill("1200");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator(".marketplace-card")).toHaveCount(1);
  expect(createdPayload).toMatchObject({ title: "Старый переплёт", author: "М. Автор", cityId: 5, type: "sale", price: 1200 });
  await page.getByRole("button", { name: "Старый переплёт — М. Автор" }).click();
  const detail = page.getByRole("dialog", { name: "Старый переплёт" });
  await expect(detail.getByRole("button", { name: "Пожаловаться на продавца" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Пожаловаться на объявление" })).toHaveCount(0);
  await detail.getByRole("button", { name: "Зарезервировать" }).click();
  await expect(detail.getByRole("button", { name: "Снять резерв" })).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await detail.getByRole("button", { name: "Удалить" }).click();
  await expect(page.locator(".marketplace-card")).toHaveCount(0);
  expect(listing).toBeNull();
});
