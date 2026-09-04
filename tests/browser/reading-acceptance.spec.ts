import type { Page } from "@playwright/test";
import { expect, loginAs, test } from "./fixtures";

const year = new Date().getFullYear();
const completed = { readingStatus: "read", rating: 4.5, shortReview: "Первое завершение", readMonth: 1, readYear: year };
const statusLabels: Record<string, string> = { want: "Хочу прочитать", reading: "Читаю", read: "Прочитано", abandoned: "Брошено", postponed: "Отложено" };

async function state(page: Page) {
  const response = await page.request.get("/api/bootstrap/catalog");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.users.find((user: { id: number }) => user.id === 3);
}

async function savedBook(page: Page) {
  return (await state(page)).books.find((book: { id: number }) => book.id === 24);
}

async function prepare(page: Page, payload: Record<string, unknown> = {}) {
  await loginAs(page, 3, "/profile/library");
  const response = await page.request.patch("/api/books/24", { data: { readingStatus: "reading", chaptersCurrent: 2, chaptersTotal: 10, readingComment: "", ...payload } });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto("/books/24");
  await expect(page.getByTestId("book-personal-state")).toBeVisible();
}

async function chooseStatus(page: Page, status: string) {
  await page.getByTestId("book-status-action").click();
  const dialog = page.getByTestId("book-status-dialog");
  await expect(dialog).toBeVisible();
  const control = dialog.getByRole("combobox", { name: /Статус/ });
  await control.click();
  await dialog.getByRole("option", { name: statusLabels[status], exact: true }).click();
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  return dialog;
}

test.beforeEach(async ({ resetDemo }) => { await resetDemo(); });
test.afterEach(async ({ browserDiagnostics }) => { await browserDiagnostics.assertNoErrors(); });

test("five reading statuses require explicit Save, read fields are required, Cancel is inert", async ({ page }) => {
  await prepare(page);
  let dialog = await chooseStatus(page, "postponed");
  await dialog.getByLabel(/Комментарий/).fill("Не сохранять");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await savedBook(page)).readingStatus).toBe("reading");
  expect((await savedBook(page)).readingComment).toBe("");

  dialog = await chooseStatus(page, "read");
  const save = dialog.getByRole("button", { name: /^Сохранить/ });
  await expect(save).toBeDisabled();
  await dialog.getByLabel(/Оценка/).fill("4.5");
  await dialog.getByLabel(/Краткий отзыв/).fill("Завершение через карточку");
  await dialog.getByLabel(/^Месяц/).fill("2");
  await dialog.getByLabel(/^Год/).fill(String(year));
  await expect(save).toBeEnabled();
  await dialog.getByLabel(/Оценка/).fill("4.7");
  await expect(save).toBeDisabled();
  await dialog.getByLabel(/Оценка/).fill("4.5");
  await dialog.getByLabel(/^Год/).fill(String(year + 1));
  await expect(save).toBeDisabled();
  await dialog.getByLabel(/^Год/).fill(String(year));
  await dialog.getByLabel(/^Месяц/).fill("13");
  await expect(save).toBeDisabled();
  await dialog.getByLabel(/^Месяц/).fill("2");
  await save.click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await savedBook(page)).readingStatus).toBe("read");

  for (const [status, label] of [["abandoned", "Брошено"], ["postponed", "Отложено"], ["want", "Хочу прочитать"], ["reading", "Читаю"]]) {
    dialog = await chooseStatus(page, status);
    await dialog.getByRole("button", { name: /^Сохранить/ }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("book-status-action")).toHaveText(label);
    if (status === "want") await expect(page.getByTestId("book-personal-state")).toHaveCount(0);
    expect((await savedBook(page)).readingStatus).toBe(status);
  }
  expect((await state(page)).readingHistory.length).toBe(2);
});

test("inline progress autosaves, computes zero, changes units only on edits and clears totals", async ({ page }) => {
  await prepare(page);
  const personal = page.getByTestId("book-personal-state");
  const chapters = personal.getByLabel("Главы: прочитано", { exact: true });
  await chapters.fill("0");
  await expect.poll(async () => (await savedBook(page)).progressPercent).toBe(0);
  await expect(page.getByTestId("reading-autosave-status")).toContainText("Сохранено");
  await personal.getByRole("button", { name: "Страницы", exact: true }).click();
  expect((await savedBook(page)).progressUnit).toBe("chapters");
  await personal.getByLabel("Страницы: всего", { exact: true }).fill("100");
  await personal.getByLabel("Страницы: прочитано", { exact: true }).fill("25");
  await expect.poll(async () => (await savedBook(page)).progressPercent).toBe(25);
  expect((await savedBook(page)).progressUnit).toBe("pages");
  await personal.getByRole("button", { name: "Главы", exact: true }).click();
  expect((await savedBook(page)).progressUnit).toBe("pages");
  await personal.getByRole("button", { name: "Страницы", exact: true }).click();
  await personal.getByLabel("Страницы: всего", { exact: true }).fill("");
  await expect.poll(async () => (await savedBook(page)).progressPercent).toBeNull();
  expect((await savedBook(page)).pagesTotal ?? null).toBeNull();
  await page.reload();
  await expect(personal.getByLabel("Страницы: всего", { exact: true })).toHaveValue("");
});

test("read, abandoned and postponed inline fields autosave and overdue reminders do not duplicate", async ({ page }) => {
  await prepare(page, completed);
  const personal = page.getByTestId("book-personal-state");
  await personal.getByLabel(/Краткий отзыв/).fill("Исправленный краткий отзыв");
  await expect.poll(async () => (await savedBook(page)).review).toBe("Исправленный краткий отзыв");
  expect((await state(page)).readingHistory.length).toBe(1);
  let dialog = await chooseStatus(page, "abandoned");
  await dialog.getByRole("button", { name: /^Сохранить/ }).click();
  await expect(dialog).toBeHidden();
  await personal.getByLabel(/Краткий отзыв/).fill("Причина остановки");
  await expect.poll(async () => (await savedBook(page)).review).toBe("Причина остановки");
  await expect(personal.getByLabel(/Оценка/)).toHaveCount(0);
  dialog = await chooseStatus(page, "postponed");
  await dialog.getByLabel(/^Год/).fill(String(year - 1));
  await dialog.getByRole("button", { name: /^Сохранить/ }).click();
  await expect(dialog).toBeHidden();
  await personal.getByLabel(/Комментарий/).fill("Вернусь позже");
  await expect.poll(async () => (await savedBook(page)).readingComment).toBe("Вернусь позже");
  expect((await savedBook(page)).postponedOverdue).toBe(true);
  await expect(personal.locator(".postponed-overdue")).toBeVisible();
  await page.reload();
  await page.reload();
  const response = await page.request.get("/api/bootstrap/social");
  expect(response.ok()).toBeTruthy();
  const social = await response.json();
  expect(social.notifications.filter((entry: { type: string }) => entry.type === "postponed_book")).toHaveLength(1);
});

test("autosave failure keeps the draft and Retry persists it", async ({ page, allowExpectedHttpError }) => {
  await prepare(page);
  allowExpectedHttpError({ path: "/api/books/24", status: 500 });
  let reject = true;
  await page.route("**/api/books/24", async (route) => {
    if (route.request().method() === "PATCH" && reject) {
      reject = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Контрольная ошибка сохранения" }) });
    } else await route.continue();
  });
  const personal = page.getByTestId("book-personal-state");
  const comment = personal.getByLabel(/Мысли, цитаты, впечатления|Комментарий/);
  await comment.fill("Черновик после ошибки");
  await expect(page.getByTestId("reading-autosave-status")).toContainText("Не удалось сохранить");
  await expect(comment).toHaveValue("Черновик после ошибки");
  expect((await savedBook(page)).readingComment).toBe("");
  await personal.getByRole("button", { name: /Повтор/ }).click();
  await expect.poll(async () => (await savedBook(page)).readingComment).toBe("Черновик после ошибки");
  await expect(page.getByTestId("reading-autosave-status")).toContainText("Сохранено");
  await page.reload();
  await expect(comment).toHaveValue("Черновик после ошибки");
});

test("edits made during a delayed save survive its response and requests stay serialized", async ({ page }) => {
  await prepare(page);
  let releaseFirst: (() => void) | undefined;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  let active = 0;
  let maxActive = 0;
  await page.route("**/api/books/24", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const index = ++requests;
    maxActive = Math.max(maxActive, ++active);
    try {
      const response = await route.fetch();
      if (index === 1) await firstResponse;
      await route.fulfill({ response });
    } finally { active -= 1; }
  });
  const comment = page.getByTestId("book-personal-state").getByLabel(/Мысли, цитаты, впечатления|Комментарий/);
  try {
    await comment.fill("Первая версия");
    await expect.poll(() => requests).toBe(1);
    await comment.fill("Последняя версия во время запроса");
    releaseFirst!();
    await expect.poll(async () => (await savedBook(page)).readingComment).toBe("Последняя версия во время запроса");
    await expect(comment).toHaveValue("Последняя версия во время запроса");
    expect(maxActive).toBe(1);
    expect(requests).toBe(2);
  } finally { releaseFirst?.(); }
});

test("status workflow supports direct mobile entry and Back cancels without changing state", async ({ page }, testInfo) => {
  await prepare(page);
  await page.getByTestId("book-status-action").click();
  const dialog = page.getByTestId("book-status-dialog");
  await expect(dialog).toBeVisible();
  const control = dialog.getByRole("combobox", { name: /Статус/ });
  await control.click();
  await dialog.getByRole("option", { name: statusLabels.want, exact: true }).click();
  if (testInfo.project.name === "mobile") {
    await expect(page).toHaveURL(/\/edit\/book-status\/24$/);
    await page.goBack();
  } else await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await savedBook(page)).readingStatus).toBe("reading");
  if (testInfo.project.name === "mobile") {
    await page.goto("/edit/book-status/24");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: /Статус/ })).toHaveText(statusLabels.reading);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await savedBook(page)).readingStatus).toBe("reading");
  }
});

test("Back during a failed autosave keeps the draft when the user declines to discard it", async ({ page, allowExpectedHttpError }) => {
  await prepare(page);
  const title = (await savedBook(page)).title;
  await page.goto("/profile/library");
  await page.locator(".library-status-filter").getByRole("button", { name: "Читаю", exact: true }).click();
  await page.locator(".library-book").filter({ hasText: title }).click();
  const personal = page.getByTestId("book-personal-state");
  await expect(personal).toBeVisible();
  allowExpectedHttpError({ path: "/api/books/24", status: 500 });
  let requested = false;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/books/24", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    requested = true;
    await pending;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Контрольная ошибка" }) });
  });
  page.on("dialog", (dialog) => dialog.dismiss());
  const comment = personal.getByLabel(/Мысли, цитаты, впечатления|Комментарий/);
  try {
    await comment.fill("Не потерять при возврате");
    await expect.poll(() => requested).toBe(true);
    await page.goBack();
    release!();
    await expect(personal).toBeVisible();
    await expect(comment).toHaveValue("Не потерять при возврате");
    await expect(page.getByTestId("reading-autosave-status")).toContainText("Не удалось сохранить");
    expect((await savedBook(page)).readingComment).toBe("");
  } finally { release?.(); }
});

test("an unrelated SSE refresh cannot replace an unsaved status dialog draft", async ({ page }) => {
  await prepare(page);
  const dialog = await chooseStatus(page, "abandoned");
  await dialog.getByLabel(/Краткий отзыв/).fill("Несохранённое решение");
  const catalogResponse = await page.request.get("/api/bootstrap/catalog");
  expect(catalogResponse.ok()).toBeTruthy();
  const catalog = await catalogResponse.json();
  const other = catalog.books.find((book: { id: number; isAdult?: boolean }) => book.id !== 24 && !book.isAdult);
  expect(other).toBeTruthy();
  const refreshed = page.waitForResponse((response) => /\/api\/bootstrap\/(?:catalog|core)$/.test(new URL(response.url()).pathname) && response.ok());
  const mutation = await page.request.post("/api/books", { data: { useExistingId: other.id, readingStatus: "want" } });
  expect(mutation.ok()).toBeTruthy();
  await refreshed;
  await expect(dialog.getByRole("combobox", { name: /Статус/ })).toHaveText(statusLabels.abandoned);
  await expect(dialog.getByLabel(/Краткий отзыв/)).toHaveValue("Несохранённое решение");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect((await savedBook(page)).readingStatus).toBe("reading");
});

test("statistics retain separate reread completions after removing the book from the library", async ({ page }) => {
  await prepare(page, completed);
  const title = (await savedBook(page)).title;
  for (const data of [{ readingStatus: "reading" }, { ...completed, shortReview: "Второе завершение" }]) {
    const response = await page.request.patch("/api/books/24", { data });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  expect((await state(page)).readingHistory.filter((entry: { bookId: number }) => entry.bookId === 24)).toHaveLength(2);
  const removed = await page.request.delete("/api/books/24");
  expect(removed.ok()).toBeTruthy();
  await page.goto("/profile/library");
  await page.getByRole("button", { name: "Статистика чтения", exact: true }).click();
  const stats = page.locator(".reading-stats-modal");
  await expect(stats).toBeVisible();
  await expect(stats.locator(".reading-month-book").filter({ hasText: title })).toHaveCount(2);
  await stats.locator(".reading-month-book").filter({ hasText: title }).first().click();
  await expect(page.locator(".unified-book-modal")).toBeVisible();
  await expect(page.getByTestId("book-personal-state")).toHaveCount(0);
});

test("invalid inline progress stays a local draft and never clears saved values", async ({ page }) => {
  await prepare(page);
  let patches = 0;
  page.on("request", (request) => { if (request.method() === "PATCH" && new URL(request.url()).pathname === "/api/books/24") patches += 1; });
  const personal = page.getByTestId("book-personal-state");
  const total = personal.getByLabel("Главы: всего", { exact: true });
  for (const invalid of ["0", "-1", "1.5", "1", "4294967296"]) {
    await total.fill(invalid);
    await expect(total).toHaveValue(invalid);
    // Longer than the production debounce: no malformed or implicit-null PATCH.
    await page.waitForTimeout(1100);
    expect(patches).toBe(0);
    expect((await savedBook(page)).chaptersTotal).toBe(10);
  }
  await total.fill("20");
  await expect.poll(async () => (await savedBook(page)).chaptersTotal).toBe(20);
});

test("inline values and the full editor use the same authoritative owner state", async ({ page }) => {
  await prepare(page);
  const personal = page.getByTestId("book-personal-state");
  await personal.getByLabel(/Мысли, цитаты, впечатления|Комментарий/).fill("Из личного блока");
  await expect.poll(async () => (await savedBook(page)).readingComment).toBe("Из личного блока");
  await expect(page.getByTestId("reading-autosave-status")).toContainText("Сохранено");
  await page.locator(".unified-book-modal").getByRole("button", { name: "Редактировать", exact: true }).click();
  const editor = page.locator(".book-editor");
  await expect(editor).toBeVisible();
  const comment = editor.getByLabel(/Мысли, цитаты, впечатления|Комментарий/);
  await expect(comment).toHaveValue("Из личного блока");
  await comment.fill("Из полного редактора");
  await editor.getByRole("button", { name: /^Сохранить/ }).click();
  await expect(editor).toBeHidden();
  await page.goto("/books/24");
  await expect(personal.getByLabel(/Мысли, цитаты, впечатления|Комментарий/)).toHaveValue("Из полного редактора");
  expect((await savedBook(page)).readingComment).toBe("Из полного редактора");
});
