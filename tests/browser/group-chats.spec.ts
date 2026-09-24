import { expect, loginAs, test } from "./fixtures";

test.beforeEach(async ({ resetDemo }) => {
  await resetDemo();
});

test.afterEach(async ({ browserDiagnostics }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) return;
  await browserDiagnostics.assertNoErrors();
});

test("group chat lifecycle, search and poll work on desktop and mobile", async ({ page }) => {
  await loginAs(page, 3, "/chat");

  await page.getByRole("button", { name: "Создать группу", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "Создать группу" });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel("Название группы").fill("Клуб браузерной проверки");
  await createDialog.getByLabel("Найти людей по имени или имени пользователя").fill("Издательство");
  await createDialog.getByRole("checkbox", { name: /Издательство «Тест»/ }).check();
  await createDialog.getByLabel("Фотография группы").setInputFiles("tests/browser/fixtures/avatar-valid.png");
  await expect(createDialog.locator(".group-avatar")).toHaveClass(/has-photo/);
  await createDialog.getByRole("button", { name: "Создать группу", exact: true }).click();

  await expect(page).toHaveURL(/\/chat\/groups\/\d+$/);
  const chat = page.locator(".group-chat-view:visible");
  await expect(chat.getByRole("heading", { name: "Клуб браузерной проверки" })).toBeVisible();
  await expect(chat.locator("header .group-avatar")).toHaveClass(/has-photo/);

  const composer = chat.getByRole("textbox", { name: "Напишите сообщение" });
  await composer.fill("Сообщение для поиска в группе");
  await composer.press("Enter");
  await expect(chat.getByText("Сообщение для поиска в группе", { exact: true })).toBeVisible();

  await chat.getByRole("textbox", { name: "Поиск в группе" }).fill("для поиска");
  await chat.getByRole("button", { name: "Поиск в группе" }).click();
  await expect(chat.locator(".group-search-results").getByText("Сообщение для поиска в группе", { exact: true })).toBeVisible();

  await chat.getByRole("button", { name: "Выбрать emoji" }).click();
  await chat.getByRole("button", { name: "📚", exact: true }).click();
  await expect(composer).toHaveValue("📚");
  await composer.press("Enter");
  await expect(chat.getByText("📚", { exact: true })).toBeVisible();

  await chat.getByRole("button", { name: "Книжные стикеры" }).click();
  const sticker = chat.locator(".chat-sticker-picker button").first();
  await expect(sticker).toBeVisible();
  await sticker.click();
  await expect(chat.locator("img.group-sticker").last()).toBeVisible();

  await chat.getByRole("button", { name: "Создать опрос", exact: true }).click();
  await chat.getByRole("textbox", { name: "Вопрос" }).fill("Что читаем дальше?");
  const pollOptions = chat.locator(".group-poll-form > span input");
  await pollOptions.nth(0).fill("Роман");
  await pollOptions.nth(1).fill("Рассказы");
  await chat.locator(".group-poll-form").getByRole("button", { name: "Создать опрос", exact: true }).click();
  const poll = chat.locator(".group-poll-card", { hasText: "Что читаем дальше?" });
  await expect(poll).toBeVisible();
  await poll.getByLabel(/Роман/).check();
  await poll.getByRole("button", { name: "Голосовать" }).click();
  await expect(poll.getByText(/Роман \(1\)/)).toBeVisible();

  await chat.getByRole("button", { name: "Настройки группы" }).click();
  const settings = page.getByRole("dialog", { name: "Настройки группы" });
  await expect(settings).toBeVisible();
  await expect(settings.getByText(/Издательство «Тест»/)).toBeVisible();
  const nameInput = settings.getByLabel("Название группы");
  await nameInput.fill("Обновлённый книжный клуб");
  await nameInput.blur();
  await expect(chat.getByRole("heading", { name: "Обновлённый книжный клуб" })).toBeVisible();

  let confirmations = 0;
  page.on("dialog", async (dialog) => { confirmations += 1; await dialog.accept(); });
  await page.getByRole("dialog", { name: "Настройки группы" }).getByRole("button", { name: "Удалить группу" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  expect(confirmations).toBe(2);
  await expect(page.getByText("Обновлённый книжный клуб", { exact: true })).toHaveCount(0);
});
