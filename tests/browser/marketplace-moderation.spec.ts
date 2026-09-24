import { expect, loginAs, test } from "./fixtures";

test.beforeEach(async ({ resetDemo }) => { await resetDemo(); });
test.afterEach(async ({ browserDiagnostics }) => { await browserDiagnostics.assertNoErrors(); });

test("marketplace reports expose evidence and use audited marketplace moderation actions", async ({ page }) => {
  const createdAt = new Date().toISOString();
  const listingReport = { id: 42, reference: "BMC-2026-000042", reporterId: 3, reporterName: "Покупатель", targetKind: "marketplace_listing", targetId: 77, targetUserId: 2, targetUserName: "Продавец", targetTitle: "Бумажная книга", reason: "Подозрительная цена", status: "new", createdAt };
  const conversationReport = { ...listingReport, id: 43, reference: "BMC-2026-000043", targetKind: "marketplace_conversation", targetId: 15, targetTitle: "Диалог: Бумажная книга", reason: "Подозрительный диалог", conversationMessages: [{ id: 100, senderId: 3, text: "Прошу предоплату", createdAt }] };
  let restrictionReason = "";
  let liftReason = "";
  let restricted = false;
  let removalReason = "";
  await page.route("**/api/bootstrap/moderation", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, reports: [listingReport, conversationReport] } });
  });
  await page.route("**/api/admin/marketplace/sellers/2/restriction", async (route) => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: { restriction: restricted ? { reason: restrictionReason, until: null } : null } });
    if (method === "POST") { restrictionReason = (route.request().postDataJSON() as { reason: string }).reason; restricted = true; }
    if (method === "DELETE") { liftReason = (route.request().postDataJSON() as { reason: string }).reason; restricted = false; }
    await route.fulfill({ json: { ok: true, restrictedUntil: null } });
  });
  await page.route("**/api/admin/marketplace/listings/77/moderation", async (route) => {
    removalReason = (route.request().postDataJSON() as { reason: string }).reason;
    await route.fulfill({ json: { ok: true, status: "removed" } });
  });
  await loginAs(page, 1, "/profile");
  await page.getByRole("button", { name: /Новые жалобы/ }).click();
  await page.locator(".admin-report-list button").filter({ hasText: "Бумажная книга" }).first().click();
  await expect(page.locator(".admin-report-modal").getByText("Бумажная книга", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ограничить новые объявления" }).click();
  const restriction = page.locator(".safety-action-modal");
  await restriction.getByLabel("Причина").fill("Повторяющийся спам");
  await restriction.getByRole("button", { name: "Применить ограничение" }).click();
  await expect(page.locator(".safety-action-modal")).toHaveCount(0);
  expect(restrictionReason).toBe("Повторяющийся спам");

  await page.locator(".admin-report-list button").filter({ hasText: "Бумажная книга" }).first().click();
  await page.getByRole("button", { name: "Снять ограничение" }).click();
  const lift = page.locator(".safety-action-modal");
  await lift.getByLabel("Причина").fill("Проверка завершена");
  await lift.getByRole("button", { name: "Снять ограничение" }).click();
  await expect(page.locator(".safety-action-modal")).toHaveCount(0);
  expect(liftReason).toBe("Проверка завершена");

  await page.locator(".admin-report-list button").filter({ hasText: "Бумажная книга" }).first().click();
  await page.locator(".admin-report-modal").getByRole("button", { name: "Снять объявление" }).click();
  const removal = page.locator(".safety-action-modal");
  await removal.getByLabel("Причина удаления").fill("Нарушение правил торговли");
  await removal.getByRole("button", { name: "Снять объявление" }).click();
  await expect(page.locator(".safety-action-modal")).toHaveCount(0);
  expect(removalReason).toBe("Нарушение правил торговли");

  await page.locator(".admin-report-list button").filter({ hasText: "Диалог: Бумажная книга" }).click();
  const conversation = page.locator(".admin-report-modal");
  await expect(conversation.getByText("Прошу предоплату")).toBeVisible();
  await expect(conversation.getByRole("button", { name: "Снять объявление" })).toHaveCount(0);
});
