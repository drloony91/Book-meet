import { expect, loginAs, test } from "./fixtures";

test.beforeEach(async ({ resetDemo }) => { await resetDemo(); });
test.afterEach(async ({ browserDiagnostics }) => {
  await browserDiagnostics.assertNoErrors();
});

test("five reading states and the transactional status dialog keep the library card unchanged until save", async ({ page }, testInfo) => {
  await loginAs(page, 3, "/profile/library");
  const filter = page.locator(".library-status-filter");
  await expect(filter.getByRole("button")).toHaveCount(5);
  for (const name of ["Хочу прочитать", "Читаю", "Прочитано", "Брошено", "Отложено"]) await expect(filter.getByRole("button", { name })).toBeVisible();
  if (testInfo.project.name === "mobile") {
    const layout = await filter.getByRole("button").evaluateAll((buttons) => {
      const rows = new Map<number, number>();
      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        const row = Math.round(rect.top);
        rows.set(row, (rows.get(row) ?? 0) + 1);
      }
      return { display: getComputedStyle(buttons[0].parentElement!).display, rows: [...rows.values()] };
    });
    expect(layout.display).toBe("grid");
    expect(layout.rows.sort((a, b) => a - b)).toEqual([2, 3]);
    const bootstrap = await page.request.get("/api/bootstrap");
    const data = await bootstrap.json() as { users: Array<{ id: number; books: Array<{ id: number; catalogBookId?: number }> }> };
    const item = data.users.find((user) => user.id === 3)?.books[0];
    expect(item).toBeTruthy();
    await page.goto(`/edit/book-status/${item!.catalogBookId ?? item!.id}`);
    await expect(page).toHaveURL(/\/edit\/book-status\/\d+$/);
    await expect(page.locator(".book-status-dialog")).toBeVisible();
    return;
  }
  await page.locator(".library-book").first().click();
  await expect(page.locator(".unified-book-modal")).toBeVisible();
  const previous = await page.locator(".book-status-action").textContent();
  await page.locator(".book-status-action").click();
  await expect(page.locator(".book-status-dialog")).toBeVisible();
  const status = page.locator(".book-status-dialog .reading-status-select").getByRole("combobox");
  await status.click();
  await page.getByRole("option", { name: "Читаю", exact: true }).click();
  await expect(page.getByRole("button", { name: "Главы", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Страницы", exact: true })).toBeVisible();
  await page.locator(".book-status-dialog").getByRole("button", { name: "Отмена" }).click();
  await expect(page.locator(".book-status-dialog")).toHaveCount(0);
  await expect(page.locator(".book-status-action")).toHaveText(previous ?? "");
});

test("reading progress rejects a current value beyond total before autosave", async ({ page }) => {
  await loginAs(page, 3, "/profile/library");
  await page.locator(".library-book").first().click();
  await page.locator(".book-status-action").click();
  const status = page.locator(".book-status-dialog .reading-status-select").getByRole("combobox");
  await status.click();
  await page.getByRole("option", { name: "Читаю", exact: true }).click();
  const inputs = page.locator('.book-status-dialog input[type="number"]');
  await inputs.nth(0).fill("10");
  await inputs.nth(1).fill("5");
  await expect(inputs.nth(0)).toHaveValue("10");
  await expect(inputs.nth(1)).toHaveValue("5");
  await expect(page.locator(".book-status-dialog").getByRole("button", { name: /^Сохранить/ })).toBeDisabled();
});
