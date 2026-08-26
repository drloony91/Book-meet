import { createOversizedAvatarFixture, expect, loginAs, test } from "./fixtures";

const validAvatar = "tests/browser/fixtures/avatar-valid.png";
const validAvatarJpeg = "tests/browser/fixtures/avatar-valid.jpg";
const invalidAvatar = "tests/browser/fixtures/invalid-avatar.txt";

test.beforeEach(async ({ resetDemo, allowExpectedHttpError }) => {
  await resetDemo();
  // The unauthenticated bootstrap call is the documented guest branch. Each
  // guest test opts into this expected negative response explicitly.
  void allowExpectedHttpError;
});

test.afterEach(async ({ browserDiagnostics }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) return;
  await browserDiagnostics.assertNoErrors();
});

test("guest is redirected to authentication from home and direct SPA routes", async ({ page, allowExpectedHttpError }) => {
  allowExpectedHttpError({ path: /^\/api\/bootstrap(?:\/|$)/, status: 401 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Войти$/ })).toBeVisible();
  await page.goto("/events");
  await expect(page.getByRole("button", { name: /^Войти$/ })).toBeVisible();
  await page.goto("/books");
  await expect(page.getByRole("button", { name: /^Войти$/ })).toBeVisible();
  await expect(page.locator(".all-books-grid")).toHaveCount(0);
});

test("login opens the authenticated shell and logout returns to guest", async ({ page, allowExpectedHttpError }, testInfo) => {
  allowExpectedHttpError({ path: /^\/api\/bootstrap(?:\/|$)/, status: 401 });
  await page.goto("/");
  // Demo has Google disabled; keep the optional third-party loader deterministic
  // so the strict network fixture reports real application failures only.
  await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await expect(page.getByRole("button", { name: /^Войти$/ })).toBeVisible();
  await page.getByLabel("E-mail").fill("dr.loony91@gmail.com");
  await page.getByLabel(/Пароль/).fill("testtest1");
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-book-meet-user-id", "1");
  await expect(page.locator(".app-shell")).toBeVisible();
  if (testInfo.project.name === "mobile") await page.goto("/profile");
  else await page.locator("button.user-button").click();
  await page.locator(".admin-profile-top-actions").getByRole("button", { name: /^Выйти$/ }).click();
  await expect(page.getByRole("button", { name: /^Войти$/ })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-book-meet-user-id", "1");
});

test("profile settings persist through the demo API", async ({ page }, testInfo) => {
  await loginAs(page, 3);
  if (testInfo.project.name === "mobile") {
    await page.goto("/profile/settings");
  } else {
    await page.locator("button.user-button").click();
    await page.locator(".profile-top-actions .profile-edit-button").click();
  }
  const bio = `Browser regression profile ${testInfo.project.name}`;
  const about = page.locator(".profile-form textarea").first();
  await about.fill(bio);
  await page.locator(".profile-form button.primary-button[type=submit]").click();
  await expect(page.getByText(bio, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(bio, { exact: true })).toBeVisible();
});

test("books directory and personal library are reachable", async ({ page }) => {
  await loginAs(page, 3, "/books");
  await expect(page.getByPlaceholder("Название книги или автор")).toBeVisible();
  await expect(page.locator(".all-books-grid .library-book").first()).toBeVisible();
  await page.goto("/profile/library");
  await expect(page.getByRole("button", { name: /Библиотека/ }).last()).toBeVisible();
  await expect(page.getByText("Точки на карте", { exact: true }).first()).toBeVisible();
});

test("feed material opens and supports like, save and comment state", async ({ page }) => {
  // User 2 is the publisher fixture, so the review owned by user 1 is a
  // deterministic material that user 2 may react to.
  await loginAs(page, 2);
  const review = page.locator(".review-preview-card").first();
  await expect(review).toBeVisible();
  const feedSave = review.getByRole("button", { name: "Сохранить" });
  const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/saves") && response.request().method() === "POST");
  await feedSave.click();
  await expect((await saveResponse).status()).toBe(201);
  await expect(feedSave).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  const persistedFeedSave = page.locator(".review-preview-card").first().getByRole("button", { name: "Сохранить" });
  await expect(persistedFeedSave).toHaveAttribute("aria-pressed", "true");
  const persistedReview = page.locator(".review-preview-card").first();
  await persistedReview.click();
  const modal = page.locator(".reading-modal");
  await expect(modal).toBeVisible();
  const like = modal.getByRole("button", { name: "Нравится" });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await modal.getByPlaceholder("Написать комментарий").fill("Browser regression comment");
  await modal.getByRole("button", { name: /^Отправить$/ }).click();
  await expect(modal.getByText("Browser regression comment", { exact: true })).toBeVisible();
});

test("search works on desktop and mobile uses its routed search workflow", async ({ page }, testInfo) => {
  await loginAs(page, 3);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Поиск" }).first().click();
    await expect(page).toHaveURL(/\/search$/);
    const input = page.getByRole("searchbox", { name: "Поиск материалов" });
    await input.fill("Город");
    await expect(page.getByText("Тёплый городской роман о памяти, случайных встречах и внимании к деталям.", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Назад" }).click();
    await expect(page).toHaveURL(/\/$/);
  } else {
    const input = page.locator(".desktop-feed-search input[type=search]");
    await expect(input).toBeVisible();
    await input.fill("Город");
    await expect(page.getByText("Город между строк", { exact: true }).first()).toBeVisible();
  }
});

test("publisher profile supports follow and permission-dependent messaging", async ({ page }) => {
  await loginAs(page, 3, "/users/2");
  await expect(page.getByRole("heading", { name: "Издательство «Тест»" }).last()).toBeVisible();
  const follow = page.getByRole("button", { name: "Подписаться" });
  await follow.click();
  await expect(page.getByRole("button", { name: "Отписаться" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Написать" })).toBeVisible();
});

test("chat opens, sends text and shares a supported book attachment", async ({ page }) => {
  await loginAs(page, 3, "/chat");
  await page.getByRole("button", { name: /Издательство «Тест».*сейчас/i }).click();
  const message = page.getByRole("textbox", { name: "Сообщение" });
  await expect(message).toBeVisible();
  await message.fill("Browser regression message");
  await message.press("Enter");
  await expect(page.locator(".message-area:visible").getByText("Browser regression message", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Поделиться" }).press("Enter");
  await page.getByRole("button", { name: "Книгой" }).press("Enter");
  await page.getByPlaceholder(/книг/i).fill("Город");
  await page.getByRole("button", { name: "Город между строк" }).press("Enter");
  await message.fill("Shared book");
  await message.press("Enter");
  await expect(page.locator(".message-area:visible").getByText("Город между строк", { exact: true }).last()).toBeVisible();
});

test("admin profile exposes read-only statistics", async ({ page }) => {
  await loginAs(page, 1, "/profile");
  await expect(page.locator(".admin-statistics-panel")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Статистика сообщества" })).toBeVisible();
  await expect(page.locator(".admin-statistics-panel button")).toHaveCount(0);
});

test("avatar upload validates fixtures and persists a valid result", async ({ page, allowExpectedHttpError }) => {
  await loginAs(page, 3, "/profile");
  await page.locator(".profile-avatar-edit-button").click();
  const input = page.locator('.profile-avatar-editor input[type="file"]');
  await input.setInputFiles(validAvatar);
  await expect(page.locator(".profile-avatar-editor .avatar.has-photo")).toBeVisible();
  await page.reload();
  await expect(page.locator(".profile-avatar-editor .avatar.has-photo")).toBeVisible();

  await input.setInputFiles(validAvatarJpeg);
  await expect(page.locator(".profile-avatar-editor .avatar.has-photo")).toBeVisible();
  await page.reload();
  await expect(page.locator(".profile-avatar-editor .avatar.has-photo")).toBeVisible();

  await input.setInputFiles([]);
  await expect(page.locator(".profile-avatar-editor .avatar.has-photo")).toBeVisible();
  let dialogMessage = "";
  page.once("dialog", async (dialog) => { dialogMessage = dialog.message(); await dialog.dismiss(); });
  await input.setInputFiles(invalidAvatar);
  await expect.poll(() => dialogMessage).toMatch(/фото|изображ|image|photo/i);

  let oversizedMessage = "";
  page.once("dialog", async (dialog) => { oversizedMessage = dialog.message(); await dialog.dismiss(); });
  await input.setInputFiles(await createOversizedAvatarFixture());
  await expect.poll(() => oversizedMessage).toMatch(/фото|изображ|image|photo/i);

  await page.route("**/api/users/me/state", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Демо-ошибка сохранения аватара" }) }));
  allowExpectedHttpError({ path: "/api/users/me/state", status: 500, warning: /Демо-ошибка сохранения аватара/ });
  let serverErrorMessage = "";
  page.once("dialog", async (dialog) => { serverErrorMessage = dialog.message(); await dialog.dismiss(); });
  await input.setInputFiles(validAvatar);
  await expect.poll(() => serverErrorMessage).toMatch(/сохран|ошиб|save|error/i);
  await expect(page.locator(".profile-avatar-editor .avatar.has-photo")).toBeVisible();
  await page.unroute("**/api/users/me/state");
});

test("published event opens and can set a reminder", async ({ page }) => {
  await loginAs(page, 3, "/events");
  const event = page.locator(".event-card").first();
  await expect(event).toBeVisible();
  await event.click();
  await expect(page.locator(".event-modal")).toBeVisible();
  const reminder = page.getByRole("button", { name: /Иду! Установить напоминание|Барамын! Еске салғыш орнату/ });
  await reminder.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("alertdialog").getByRole("heading", { name: /напоминание установлено|Еске салғыш орнатылды/i })).toBeVisible();
});

test("mobile header mechanics keep navigation usable and avoid horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile mechanics are covered by the mobile project only");
  await loginAs(page, 1);
  const menu = page.getByRole("button", { name: "Открыть меню" });
  await menu.click();
  await expect(page.locator(".mobile-navigation-drawer")).toBeVisible();
  await page.locator(".mobile-navigation-overlay").click();
  await expect(page.locator(".mobile-navigation-drawer")).toHaveCount(0);
  await menu.click();
  await page.getByRole("button", { name: "Книги" }).last().click();
  await expect(page).toHaveURL(/\/books$/);
  await expect(page.locator(".mobile-navigation-drawer")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(overflow).toBeTruthy();
  for (const locator of [page.locator(".mobile-menu-toggle"), page.locator(".mobile-search-button"), page.locator(".mobile-bottom-navigation button").first()]) {
    const box = await locator.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(36);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
  }
});
