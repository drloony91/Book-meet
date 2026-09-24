import { allowGuestBootstrap401, expect, loginAs, test } from "./fixtures";

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;
const nextYear = currentYear + 1;

test.beforeEach(async ({ resetDemo }) => { await resetDemo(); });
test.afterEach(async ({ browserDiagnostics }) => { await browserDiagnostics.assertNoErrors(); });

async function openGoals(page: import("@playwright/test").Page) {
  await loginAs(page, 3, "/profile/library");
  await page.getByRole("button", { name: "Цели", exact: true }).click();
  const dialog = page.locator(".reading-goals-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  return dialog;
}

test("goal creation keeps fields hidden until a kind is chosen, preserves invalid input, and shows pace", async ({ page }) => {
  const dialog = await openGoals(page);
  await expect(dialog.locator(".reading-goal-form")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Цель на месяц", exact: true }).click();
  const count = dialog.getByRole("textbox", { name: "Количество книг", exact: true });
  const place = dialog.getByRole("button", { name: "Поставить цель", exact: true });
  await count.fill("-1");
  await expect(count).toHaveValue("-1");
  await expect(place).toBeDisabled();
  await count.fill("1.5");
  await expect(count).toHaveValue("1.5");
  await expect(place).toBeDisabled();
  await count.fill("2");
  await expect(place).toBeEnabled();
  await expect(dialog.locator(".reading-goal-form p")).toContainText(/дн|day|күн/i);
  await dialog.getByRole("button", { name: "Цель на год", exact: true }).click();
  const goalYear = dialog.getByRole("combobox", { name: "Цель на год", exact: true });
  await goalYear.selectOption(String(nextYear));
  await expect(goalYear).toHaveValue(String(nextYear));
  await count.fill("3");
  await expect(dialog.locator(".reading-goal-form p")).toContainText(/книг в месяц|books per month|кітап/i);
});

test("a delayed initial goals response cannot overwrite a goal created while it is in flight", async ({ page }) => {
  await loginAs(page, 3, "/profile/library");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/reading-goals", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Цели", exact: true }).click();
    const dialog = page.locator(".reading-goals-modal");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Цель на месяц", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Количество книг", exact: true }).fill("2");
    await dialog.getByRole("button", { name: "Поставить цель", exact: true }).click();
    release();
    await expect(dialog.locator(".reading-goal-row")).toHaveCount(1);
    await expect(dialog.locator(".reading-goal-row")).toContainText("2");
  } finally {
    release();
    await page.unroute("**/api/reading-goals");
  }
});

test("creating two goals edits and deletes only the selected row", async ({ page }) => {
  const dialog = await openGoals(page);
  await dialog.getByRole("button", { name: "Цель на месяц", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Количество книг", exact: true }).fill("2");
  await dialog.getByRole("button", { name: "Поставить цель", exact: true }).click();
  await expect(dialog.locator(".reading-goal-row")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Цель на год", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Количество книг", exact: true }).fill("3");
  await dialog.getByRole("button", { name: "Поставить цель", exact: true }).click();
  await expect(dialog.locator(".reading-goal-row")).toHaveCount(2);

  const rows = dialog.locator(".reading-goal-row");
  await rows.first().getByRole("button", { name: /Изменить цель на/ }).click();
  await expect(rows.first().locator(".reading-goal-inline-edit input")).toHaveCount(1);
  await expect(rows.nth(1).locator(".reading-goal-inline-edit input")).toHaveCount(0);
  await rows.first().locator(".reading-goal-inline-edit input").fill("1.5");
  await expect(rows.first().locator(".reading-goal-inline-edit button")).toBeDisabled();
  await rows.first().locator(".reading-goal-inline-edit input").fill("5");
  await rows.first().locator(".reading-goal-inline-edit button").click();
  await expect(rows.first()).toContainText("5");
  await expect(rows.nth(1)).toContainText("3");

  page.once("dialog", (dialogEvent) => dialogEvent.accept());
  await rows.first().getByRole("button", { name: /Удалить цель/ }).click();
  await expect(dialog.locator(".reading-goal-row")).toHaveCount(1);
  await expect(dialog.locator(".reading-goal-row")).toContainText("3");
});

test("goal statistics request the selected period and render API actuals, plan outlines, zero and goal colors", async ({ page }, testInfo) => {
  const dialog = await openGoals(page);
  await dialog.getByRole("button", { name: "Цель на месяц", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Количество книг", exact: true }).fill("100");
  await dialog.getByRole("button", { name: "Поставить цель", exact: true }).click();
  await dialog.getByRole("button", { name: "Цель на год", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Цель на год", exact: true }).selectOption(String(nextYear));
  await dialog.getByRole("textbox", { name: "Количество книг", exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Поставить цель", exact: true }).click();
  const rows = dialog.locator(".reading-goal-row");
  const monthlyRow = rows.filter({ hasText: String(currentYear) }).first();
  const monthlyRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET" && url.pathname === "/api/reading-statistics" && url.searchParams.get("year") === String(currentYear) && url.searchParams.get("month") === String(currentMonth);
  });
  await monthlyRow.getByRole("button", { name: /Цель на/ }).click();
  await monthlyRequest;
  const stats = page.locator(".reading-stats-modal");
  await expect(stats).toBeVisible();
  await expect(stats.locator(".chart-plan-outline")).toHaveCount(1);
  expect(await stats.locator(".chart-value").evaluateAll((nodes) => nodes.some((node) => node.textContent?.trim() === "0"))).toBe(true);
  if (testInfo.project.name === "mobile") {
    await expect(stats.locator(".reading-stats-mobile-row .has-plan")).toHaveCount(1);
    await expect(stats.locator(".reading-stats-mobile-row .has-plan u")).toHaveCount(1);
    await expect(stats.locator(".reading-stats-mobile-row small")).toHaveCount(1);
    await expect(stats.locator(".reading-stats-mobile-row .mobile-actual-muted-red")).toHaveCount(1);
  } else {
    await expect(stats.locator(".chart-bar.goal-muted-red")).toHaveCount(1);
    await expect(stats.locator(".chart-plan-label")).toHaveCount(1);
  }
  await stats.getByRole("button", { name: /Закрыть|Close|Жабу/ }).click();
  await expect(stats).toBeHidden();
  if (testInfo.project.name === "mobile") await expect(page).toHaveURL(/\/profile\/library$/);

  await page.getByRole("button", { name: "Цели", exact: true }).click();
  const annualRows = page.locator(".reading-goals-modal .reading-goal-row");
  const annualRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET" && url.pathname === "/api/reading-statistics" && url.searchParams.get("year") === String(nextYear) && !url.searchParams.has("month");
  });
  await annualRows.filter({ hasText: String(nextYear) }).first().getByRole("button", { name: /Цель на/ }).click();
  await annualRequest;
  await expect(page.locator(".reading-stats-modal")).toBeVisible();
  const annualStats = page.locator(".reading-stats-modal");
  await expect(annualStats.locator(".chart-plan-outline")).toHaveCount(12);
  await expect(annualStats.locator(".chart-plan-label")).toHaveCount(12);
  expect(await annualStats.locator(".chart-value").evaluateAll((nodes) => nodes.some((node) => node.textContent?.trim() === "0"))).toBe(true);
  if (testInfo.project.name === "mobile") {
    await expect(annualStats.locator(".reading-stats-mobile-row .has-plan")).toHaveCount(12);
    await expect(annualStats.locator(".reading-stats-mobile-row .mobile-actual-green")).toHaveCount(11);
  } else {
    await expect(annualStats.locator(".chart-bar.goal-green")).toHaveCount(11);
  }
  await page.screenshot({ path: testInfo.outputPath(`goals-annual-${testInfo.project.name}.png`), fullPage: true });
  await annualStats.getByRole("button", { name: /Закрыть|Close|Жабу/ }).click();
  await expect(annualStats).toBeHidden();
});

test("mobile goal workflow survives refresh and closes back to the exact background query", async ({ page, browserDiagnostics }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile route contract");
  await loginAs(page, 3, "/profile/library?from=goal-check");
  await page.getByRole("button", { name: "Цели", exact: true }).click();
  await expect(page).toHaveURL(/\/create\/reading-goal$/);
  await expect(page.locator(".reading-goals-modal")).toBeVisible();
  await page.reload();
  await expect(page.locator(".reading-goals-modal")).toBeVisible();
  await page.locator(".reading-goals-modal .modal-close").click();
  await expect(page).toHaveURL(/\/profile\/library\?from=goal-check$/);
  await expect(page.locator(".reading-goals-modal")).toHaveCount(0);
  await page.context().clearCookies();
  allowGuestBootstrap401(browserDiagnostics.allowExpectedHttpError);
  await page.goto("/create/reading-goal");
  await expect(page).toHaveURL(/\/create\/reading-goal$/);
  await expect(page.getByRole("heading", { name: /С возвращением|Welcome back|Қайта қош келдіңіз/ })).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill("reader.test@bookmeet.kz");
  await page.getByLabel(/Пароль|Password|Құпия сөз/).fill("reader2026");
  await page.getByRole("button", { name: /Войти|Log in|Кіру/ }).click();
  await expect(page.locator(".reading-goals-modal")).toBeVisible();
  await page.locator(".reading-goals-modal .reading-goals-mobile-back").click();
  await expect(page).toHaveURL(/\/profile\/library$/);
});
