import { expect, loginAs, test } from "./fixtures";

test.beforeEach(async ({ resetDemo }) => { await resetDemo(); });
test.afterEach(async ({ browserDiagnostics }) => { await browserDiagnostics.assertNoErrors(); });

test("book and time statistics switch, show exact durations, and remember the selected view", async ({ page }, testInfo) => {
  await loginAs(page, 3);
  const date = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const added = await page.request.post("/api/books/24/reading-sessions", {
    headers: { "X-BookMeet-Timezone": "Asia/Qyzylorda" },
    data: { date, hours: 1, minutes: 2, seconds: 3 },
  });
  expect(added.ok(), await added.text()).toBeTruthy();

  await page.goto("/profile/library");
  await page.getByRole("button", { name: "Статистика чтения", exact: true }).click();
  const stats = page.locator(".reading-stats-modal");
  await expect(stats).toBeVisible();
  await expect(stats.getByRole("button", { name: "Книги", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(stats.locator(".reading-stats-mode")).toBeVisible();
  await stats.getByRole("button", { name: "Время", exact: true }).click();
  const month = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Qyzylorda", month: "long" }).format(new Date()).replace(/^./, (letter) => letter.toLocaleUpperCase("ru-RU"));
  const exactDuration = `${month}: 01:02:03`;
  await expect(stats.locator(".reading-stats-chart .chart-bar").filter({ has: page.locator("title", { hasText: exactDuration }) })).toHaveCount(1);
  if (testInfo.project.name === "mobile") {
    await expect(stats.locator(".reading-stats-mobile-chart")).toBeVisible();
    await expect(stats.locator(`.reading-stats-mobile-row[title="${exactDuration}"]`)).toHaveCount(1);
  }
  await expect(stats.locator(".reading-month-group").filter({ hasText: month }).getByText("Прочитано за 01:02:03")).toBeVisible();
  await stats.getByRole("button", { name: "Закрыть" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Статистика чтения", exact: true }).click();
  await expect(page.locator(".reading-stats-modal .reading-stats-mode button[aria-pressed='true']")).toHaveText("Время");
});
