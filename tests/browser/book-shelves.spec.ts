import { allowGuestBootstrap401, expect, loginAs, test } from "./fixtures";

test.beforeEach(async ({ resetDemo }) => { await resetDemo(); });
test.afterEach(async ({ browserDiagnostics }) => { await browserDiagnostics.assertNoErrors(); });

type DemoBook = { id: number; catalogBookId?: number; title: string; author: string; isAdult?: boolean };
type DemoUser = { id: number; books: DemoBook[] };

function canonicalId(book: Pick<DemoBook, "id" | "catalogBookId">) { return book.catalogBookId ?? book.id; }

test("an owner creates, reorders and edits a shelf while routes preserve the shelf library mode", async ({ page }, testInfo) => {
  await loginAs(page, 3, "/profile/library?mode=shelves&origin=queue3");
  const extraBookResponse = await page.request.post("/api/books", { data: { author: "Автор дополнительной книги", title: "Дополнительная книга для полки", readingStatus: "want" } });
  expect(extraBookResponse.status()).toBe(201);
  await page.reload();
  const bootstrap = await (await page.request.get("/api/bootstrap")).json() as { users: DemoUser[] };
  const books = bootstrap.users.find((user) => user.id === 3)?.books.filter((book) => !book.isAdult) ?? [];
  expect(books.length).toBeGreaterThanOrEqual(2);

  const mode = page.getByRole("group", { name: "Книги или полки" });
  await expect(mode.getByRole("button", { name: "Полки", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Статус чтения" })).toHaveCount(0);
  await page.getByRole("button", { name: "Создать полку", exact: true }).click();
  if (testInfo.project.name === "mobile") await expect(page).toHaveURL(/\/create\/shelf$/);

  const editor = page.getByRole("dialog", { name: "Создать полку", exact: true });
  await editor.getByLabel("Название полки").fill("Осенние маршруты");
  await editor.getByLabel("Описание полки").fill("Две книги для длинных вечеров");
  for (const book of books.slice(0, 2)) {
    await editor.getByLabel("Поиск по автору или названию").fill(book.title);
    await editor.locator(".shelf-book-options button").filter({ hasText: book.title }).first().click();
  }
  const selected = editor.locator(".shelf-selected-books li");
  await selected.nth(0).getByLabel("Описание книги на полке").fill("Сначала медленно");
  await selected.nth(1).getByLabel("Описание книги на полке").fill("Потом без остановки");
  await selected.nth(1).getByRole("button", { name: "Переместить выше" }).click();
  await editor.getByRole("button", { name: "Опубликовать", exact: true }).click();

  await expect(page).toHaveURL(/\/profile\/library\?mode=shelves&origin=queue3$/);
  const card = page.locator(".book-shelf-card").filter({ hasText: "Осенние маршруты" });
  await expect(card).toBeVisible();
  await expect(card.locator(".shelf-book-cover")).toHaveCount(2);
  await card.click();
  await expect(page).toHaveURL(/\/shelves\/\d+$/);
  let detail = page.locator(".book-shelf-dialog");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".shelf-detail-books li").first()).toContainText(books[1].title);
  await expect(detail.locator(".shelf-detail-books li").first()).toContainText("Потом без остановки");
  await page.reload();
  detail = page.locator(".book-shelf-dialog");
  await expect(detail.getByRole("heading", { name: "Осенние маршруты" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`shelf-owner-${testInfo.project.name}.png`), fullPage: true });

  await detail.getByRole("button", { name: "Редактировать", exact: true }).click();
  if (testInfo.project.name === "mobile") await expect(page).toHaveURL(/\/edit\/shelf\/\d+$/);
  const edit = page.getByRole("dialog", { name: "Редактировать полку", exact: true });
  await edit.getByLabel("Название полки").fill("Осенние маршруты — обновлено");
  await edit.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page).toHaveURL(/\/shelves\/\d+$/);
  await expect(page.locator(".book-shelf-dialog").getByRole("heading", { name: "Осенние маршруты — обновлено" })).toBeVisible();
  await page.locator(".book-shelf-dialog .shelf-close").click();
  await expect(page).toHaveURL(/\/profile\/library\?mode=shelves&origin=queue3$/);
});

test("a foreign shelf supports public mode, batch add and every current material action", async ({ page }, testInfo) => {
  expect((await page.request.post("/api/__test__/chat-scenario")).status()).toBe(201);
  await loginAs(page, 4);
  const uniqueBookResponse = await page.request.post("/api/books", { data: { author: "Автор публичной подборки", title: "Книга только у автора полки", readingStatus: "want" } });
  expect(uniqueBookResponse.status()).toBe(201);
  const uniqueBook = (await uniqueBookResponse.json()) as { book: DemoBook };
  const missing = uniqueBook.book;
  const createdResponse = await page.request.post("/api/shelves", { data: { title: "Полка для друзей", description: "Публичная подборка", items: [{ bookId: canonicalId(missing), description: "Совет автора полки" }] } });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as { shelf: { id: number } };

  await loginAs(page, 3, "/users/4?tab=library&mode=shelves&origin=foreign");
  const profile = page.locator(".public-profile-modal");
  await expect(profile).toBeVisible();
  await expect(profile.getByRole("group", { name: "Книги или полки" }).getByRole("button", { name: "Полки", exact: true })).toHaveAttribute("aria-pressed", "true");
  const card = profile.locator(".book-shelf-card").filter({ hasText: "Полка для друзей" });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/shelves/${created.shelf.id}$`));
  const detail = page.locator(".book-shelf-dialog");
  await expect(detail.getByRole("button", { name: "Пожаловаться", exact: true })).toBeVisible();

  const actions = detail.getByLabel("Действия с материалом");
  const like = actions.getByRole("button", { name: "Нравится", exact: true });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  const save = actions.getByRole("button", { name: "Сохранить", exact: true });
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await detail.getByPlaceholder("Написать комментарий").fill("Полезная подборка");
  await detail.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(detail.locator(".comments-block article").filter({ hasText: "Полезная подборка" })).toBeVisible();
  await actions.getByRole("button", { name: "Отправить другу", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Отправить материал", exact: true });
  await expect(share.locator(".material-share-recipients button").first()).toBeVisible();
  await share.locator(".material-share-recipients button").first().click();
  await expect(share.getByRole("heading", { name: "Отправлено", exact: true })).toBeVisible();
  await share.getByRole("button", { name: "Закрыть", exact: true }).click();

  await detail.getByRole("button", { name: "Добавить книги в библиотеку", exact: true }).click();
  const confirm = detail.locator(".shelf-add-confirm");
  await expect(confirm).toContainText("Хочу прочитать");
  await confirm.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(detail.getByRole("status")).toContainText("Добавлено: 1");
  const addedBootstrap = await (await page.request.get("/api/bootstrap")).json() as { users: Array<{ id: number; books: Array<{ id: number; catalogBookId?: number; readingStatus: string }> }> };
  const added = addedBootstrap.users.find((user) => user.id === 3)?.books.find((book) => canonicalId(book) === canonicalId(missing));
  expect(added?.readingStatus).toBe("want");
  await page.screenshot({ path: testInfo.outputPath(`shelf-foreign-${testInfo.project.name}.png`), fullPage: true });
});

test("a direct mobile shelf route survives sign-in and closes to the shelves library", async ({ page, browserDiagnostics }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile route contract");
  await loginAs(page, 3);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json() as { users: DemoUser[] };
  const book = bootstrap.users.find((user) => user.id === 3)!.books[0];
  const response = await page.request.post("/api/shelves", { data: { title: "Полка после входа", description: "", items: [{ bookId: canonicalId(book), description: "" }] } });
  const shelfId = ((await response.json()) as { shelf: { id: number } }).shelf.id;
  await page.context().clearCookies();
  allowGuestBootstrap401(browserDiagnostics.allowExpectedHttpError);
  await page.goto(`/shelves/${shelfId}`);
  await expect(page.getByRole("heading", { name: /С возвращением|Welcome back|Қайта қош келдіңіз/ })).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill("reader.test@bookmeet.kz");
  await page.getByLabel(/Пароль|Password|Құпия сөз/).fill("reader2026");
  await page.getByRole("button", { name: /Войти|Log in|Кіру/ }).click();
  await expect(page).toHaveURL(new RegExp(`/shelves/${shelfId}$`));
  await expect(page.locator(".book-shelf-dialog").getByRole("heading", { name: "Полка после входа" })).toBeVisible();
  await page.locator(".book-shelf-dialog .shelf-mobile-back").click();
  await expect(page).toHaveURL(/\/profile\/library\?mode=shelves$/);
});
