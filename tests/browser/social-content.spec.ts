import { expect, loginAs, test } from "./fixtures";

test.beforeEach(async ({ resetDemo }) => {
  await resetDemo();
});

test.afterEach(async ({ browserDiagnostics }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) await browserDiagnostics.assertNoErrors();
});

test("queue 4 comments, mentions, reposts and one-way hide work end to end", async ({ page }, testInfo) => {
  await loginAs(page, 3);
  const rootResponse = await page.context().request.post("/api/comments", { data: { materialKind: "review", materialId: 51, body: "Корневой комментарий" } });
  expect(rootResponse.status()).toBe(201);
  const root = (await rootResponse.json()).comment as { id: number };
  const firstReplyResponse = await page.context().request.post("/api/comments", { data: { materialKind: "review", materialId: 51, body: "Первый ответ", parentCommentId: root.id, replyToCommentId: root.id } });
  const firstReply = (await firstReplyResponse.json()).comment as { id: number };

  await loginAs(page, 2);
  const nestedResponse = await page.context().request.post("/api/comments", { data: { materialKind: "review", materialId: 51, body: "Ответ на ответ", parentCommentId: root.id, replyToCommentId: firstReply.id } });
  expect((await nestedResponse.json()).comment.text).toMatch(/^@test-reader /);
  for (const body of ["Третий ответ", "Четвёртый ответ", "Пятый ответ"]) {
    expect((await page.context().request.post("/api/comments", { data: { materialKind: "review", materialId: 51, body, parentCommentId: root.id, replyToCommentId: root.id } })).status()).toBe(201);
  }

  await page.goto("/");
  await page.locator(".review-preview-card").first().click();
  const modal = page.locator(".reading-modal");
  await expect(modal).toBeVisible();
  const rootCard = modal.locator(".comment-root").filter({ hasText: "Корневой комментарий" });
  await expect(rootCard).toBeVisible();
  await expect(modal.getByText("@test-reader Ответ на ответ", { exact: true })).toBeVisible();
  await expect(modal.getByText("Пятый ответ", { exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "Показать ещё" }).click();
  await expect(modal.getByText("Пятый ответ", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Свернуть ответы" }).click();
  await expect(modal.getByText("Пятый ответ", { exact: true })).toHaveCount(0);

  const rootLike = rootCard.getByRole("button", { name: /^Нравится/ });
  await rootLike.click();
  await expect(rootLike).toHaveText(/Нравится · 1/);

  const commentInput = modal.getByPlaceholder("Написать комментарий");
  await commentInput.fill("@test");
  await modal.getByRole("option", { name: /Тестовый читатель @test-reader/ }).getByRole("button").click();
  await commentInput.pressSequentially("проверка");
  await modal.getByRole("button", { name: "Эмодзи" }).click();
  await modal.getByRole("dialog", { name: "Эмодзи" }).getByRole("button", { name: "📚" }).click();
  await modal.getByRole("button", { name: /^Отправить$/ }).click();
  await expect(modal.getByText("@test-reader проверка📚", { exact: true })).toBeVisible();

  await modal.getByRole("button", { name: "Репост", exact: true }).click();
  await page.getByRole("dialog", { name: "Создать репост" }).getByRole("button", { name: "Репостнуть" }).click();
  await expect(page.getByRole("dialog", { name: "Создать репост" })).toHaveCount(0);

  await modal.getByRole("button", { name: "Репост", exact: true }).click();
  const repostDialog = page.getByRole("dialog", { name: "Создать репост" });
  await repostDialog.getByRole("button", { name: "С текстом" }).click();
  await repostDialog.getByLabel("Ваш текст").fill("Текстовый репост без публичной ссылки на источник");
  await repostDialog.getByRole("button", { name: "Репостнуть" }).click();
  await expect(repostDialog).toHaveCount(0);

  await page.goto("/profile");
  await expect(page.locator(".clean-repost-card:visible").getByText("Город между строк", { exact: true })).toBeVisible();
  await expect(page.getByText("Текстовый репост без публичной ссылки на источник", { exact: true })).toBeVisible();

  await page.goto("/");
  await page.locator(".review-preview-card").first().click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".reading-modal").getByTitle("Скрыть материалы пользователя").click();
  await expect(page.locator(".reading-modal")).toHaveCount(0);
  const hiddenBootstrap = await (await page.context().request.get("/api/bootstrap/catalog")).json();
  expect(hiddenBootstrap.users.find((user: { id: number }) => user.id === 1).reviews).toHaveLength(0);

  await page.goto("/profile");
  await expect(page.locator(".clean-repost-card:visible").getByText("Материал недоступен", { exact: true })).toBeVisible();
  if (testInfo.project.name === "mobile") await page.goto("/profile/settings");
  else await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const hiddenUsers = page.locator(".hidden-users-settings");
  await expect(hiddenUsers.getByText("Тест 1", { exact: true })).toBeVisible();
  await hiddenUsers.getByRole("button", { name: "Вернуть материалы" }).click();
  await expect(hiddenUsers.getByText("Тест 1", { exact: true })).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator(".review-preview-card").first()).toBeVisible();
});
