import { createOversizedAvatarFixture, expect, loginAs, test } from "./fixtures";

const validAvatar = "tests/browser/fixtures/avatar-valid.png";
const validAvatarJpeg = "tests/browser/fixtures/avatar-valid.jpg";
const invalidAvatar = "tests/browser/fixtures/invalid-avatar.txt";

async function seedChatScenario(page: import("@playwright/test").Page) {
  const response = await page.context().request.post("/api/__test__/chat-scenario");
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ peerId: number; minorPeerId: number; deletedCommunityId: number; deletedPublisherId: number }>;
}

function chatRows(page: import("@playwright/test").Page, mobile: boolean) {
  return page.locator(mobile ? ".mobile-message-row" : ".friend-row");
}

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
  await expect(page.getByPlaceholder("Поиск книги")).toBeVisible();
  await expect(page.locator(".all-books-grid .library-book").first()).toBeVisible();
  await page.goto("/profile/library");
  await expect(page.getByRole("button", { name: /Библиотека/ }).last()).toBeVisible();
  await expect(page.getByText("Точки на карте", { exact: true }).first()).toBeVisible();
});

test("library add-book CTA is full-width on mobile boundaries and does not regress desktop", async ({ page }, testInfo) => {
  await loginAs(page, 3, "/profile/library");
  const addBook = page.getByRole("button", { name: /Добавить книгу/ });
  const stats = page.getByRole("button", { name: "Статистика чтения", exact: true });
  await expect(addBook).toBeVisible();
  await expect(stats).toBeVisible();
  await expect(page.getByRole("button", { name: /Импорт CSV \/ Excel/ })).toHaveCount(0);
  await expect(page.locator(".library-status-summary")).not.toContainText("книг");
  if (testInfo.project.name === "mobile") {
    for (const width of [390, 800]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await addBook.boundingBox();
      const wrapper = await page.locator(".library-import-actions").boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual((wrapper?.width ?? 0) - 1);
    }
  } else {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect((await addBook.boundingBox())?.width ?? 0).toBeLessThan(700);
    const addBookBox = await addBook.boundingBox();
    const statsBox = await stats.boundingBox();
    expect(Math.abs((addBookBox?.y ?? 0) - (statsBox?.y ?? 0))).toBeLessThanOrEqual(2);
  }
});

test("feed tabs, notification tabs and material share keep local viewer state", async ({ page }) => {
  await loginAs(page, 3);
  await page.getByRole("tab", { name: "Подписки" }).click();
  await expect(page.getByRole("tab", { name: "Подписки" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Все" }).click();
  await expect(page.getByRole("tab", { name: "Все" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/notifications");
  const notificationCategory = page.getByRole("combobox", { name: "Категория" });
  await notificationCategory.click();
  await page.getByRole("option", { name: "Комментарии" }).click();
  await expect(notificationCategory).toContainText("Комментарии");
  await page.goto("/");
  const share = page.getByRole("button", { name: "Отправить другу" }).first();
  await expect(share).toBeVisible();
  await expect(share.locator("svg")).toBeVisible();
  await expect(share).not.toContainText("✈");
  const response = page.waitForResponse((item) => item.url().endsWith("/api/social/messages") && item.request().method() === "POST");
  await share.click();
  await page.locator(".material-share-picker").getByRole("button", { name: /Издательство «Тест»/, exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText("Отправлено", { exact: true })).toBeVisible();
  const social = await (await page.context().request.get("/api/bootstrap/social")).json();
  expect(social.notifications.some((item: { type: string }) => item.type === "new_message")).toBeFalsy();
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

test("chat opens, sends text and shares a supported book attachment", async ({ page }, testInfo) => {
  await loginAs(page, 3, "/chat");
  await chatRows(page, testInfo.project.name === "mobile").filter({ hasText: "Издательство «Тест»" }).click();
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

test("friend acceptance keeps one persistent system timestamp and rolls the open date label at local midnight", async ({ page }, testInfo) => {
  const { peerId, minorPeerId } = await seedChatScenario(page);
  const actualNow = new Date();
  const beforeMidnight = new Date(actualNow.getFullYear(), actualNow.getMonth(), actualNow.getDate(), 23, 59);
  await page.clock.install({ time: beforeMidnight });
  await loginAs(page, 3, "/chat");

  const selfRead = await page.context().request.patch("/api/social/messages/3/read");
  expect(selfRead.status()).toBe(400);
  const forbiddenRead = await page.context().request.patch(`/api/social/messages/${peerId}/read`);
  expect(forbiddenRead.status()).toBe(403);
  const crossAgeSend = await page.context().request.post("/api/social/messages", { data: { targetId: minorPeerId, body: "Недопустимая возрастная пара" } });
  expect(crossAgeSend.status()).toBe(403);
  expect((await crossAgeSend.json()).code).toBe("CROSS_AGE_INTERACTION_FORBIDDEN");
  const accepted = await page.context().request.post(`/api/social/friends/${peerId}/accept`);
  expect(accepted.ok()).toBeTruthy();

  const socialResponse = await page.context().request.get("/api/bootstrap/social");
  expect(socialResponse.ok()).toBeTruthy();
  const social = await socialResponse.json();
  const systemMessages = social.messages[`3-${peerId}`].filter((message: { system?: boolean }) => message.system);
  expect(systemMessages).toHaveLength(1);
  expect(systemMessages[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

  await page.reload();
  const peerRow = chatRows(page, testInfo.project.name === "mobile").filter({ hasText: "Собеседник проверки" });
  await expect(peerRow).toBeVisible();
  await peerRow.click();
  const systemMessage = page.locator(".message-area:visible .system-message");
  await expect(systemMessage).toHaveCount(1);
  const expectedTime = await page.evaluate((createdAt) => new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(createdAt)), systemMessages[0].createdAt);
  await expect(systemMessage.locator("time")).toHaveText(expectedTime);
  await expect(systemMessage.locator("time")).not.toHaveText(/сейчас/i);
  await expect(page.locator(".message-area:visible .chat-day")).toHaveText("Сегодня");

  await page.reload();
  await expect(page.locator(".message-area:visible .system-message")).toHaveCount(1);
  await expect(page.locator(".message-area:visible .system-message time")).toHaveText(expectedTime);
  await page.clock.fastForward("00:02:00");
  await expect(page.locator(".message-area:visible .chat-day")).toHaveText("Вчера");
});

test("chat read, sorting, notification and per-viewer clear behavior stays isolated", async ({ page, browser, browserDiagnostics }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  const { peerId } = await seedChatScenario(page);
  await loginAs(page, 3, "/chat");
  expect((await page.context().request.post(`/api/social/friends/${peerId}/accept`)).ok()).toBeTruthy();
  expect((await page.context().request.post("/api/social/messages", { data: { targetId: peerId, body: "Старое сообщение собеседнику" } })).ok()).toBeTruthy();
  await page.waitForTimeout(25);
  expect((await page.context().request.post("/api/social/messages", { data: { targetId: 1, body: "Сообщение поддержке" } })).ok()).toBeTruthy();
  await page.waitForTimeout(25);
  expect((await page.context().request.post("/api/social/messages", { data: { targetId: 2, body: "Новое сообщение издательству" } })).ok()).toBeTruthy();
  await page.goto("/chat");

  let rows = chatRows(page, mobile);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Издательство «Тест»");
  await expect(rows.nth(2)).toContainText("Служба поддержки");

  await loginAs(page, peerId);
  expect((await page.context().request.post("/api/social/messages", { data: { targetId: 3, body: "Новое входящее сообщение" } })).ok()).toBeTruthy();
  await page.goto("/chat/3");
  const unreadSentMessage = page.locator(".message-area:visible .message-wrap.mine").filter({ hasText: "Новое входящее сообщение" });
  await expect(unreadSentMessage.locator(".message-checks")).toHaveText("✓");
  const receiverContext = await browser.newContext({ baseURL: "http://127.0.0.1:4173", viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  const receiverPage = await receiverContext.newPage();
  browserDiagnostics.trackPage(receiverPage);
  try {
    await loginAs(receiverPage, 3, "/chat");
    rows = chatRows(receiverPage, mobile);
    await expect(rows.nth(0)).toContainText("Собеседник проверки");
    await expect(rows.last()).toContainText("Служба поддержки");
    const unreadRow = rows.filter({ hasText: "Собеседник проверки" });
    await expect(unreadRow.locator(mobile ? ".mobile-message-bottomline b" : ".friend-bottomline b")).toHaveText("1");

    let socialResponse = await receiverPage.context().request.get("/api/bootstrap/social");
    let social = await socialResponse.json();
    expect(social.notifications.some((notification: { type: string }) => notification.type === "new_message")).toBeFalsy();
    expect(social.messages[`3-${peerId}`].some((message: { text: string; unread: boolean }) => message.text === "Новое входящее сообщение" && message.unread)).toBeTruthy();
    await unreadRow.click();
    await expect(receiverPage.locator(".message-area:visible").getByText("Новое входящее сообщение", { exact: true })).toBeVisible();

    // The original sender page remains open throughout. The receiver's read
    // mutation broadcasts SSE, and that same page must transition without a
    // reload, relogin or second send.
    await expect(unreadSentMessage.locator(".message-checks")).toHaveText("✓✓");

    receiverPage.once("dialog", async (dialog) => dialog.accept());
    await receiverPage.locator(".chat-view:visible .chat-history-trigger").click();
    await receiverPage.getByRole("menuitem", { name: "Очистить историю чата" }).click();
    await expect(receiverPage.locator(".message-area:visible").getByText("Старое сообщение собеседнику", { exact: true })).toHaveCount(0);
    await expect(receiverPage.locator(".chat-view:visible .chat-person")).toContainText("Собеседник проверки");

    socialResponse = await receiverPage.context().request.get("/api/bootstrap/social");
    social = await socialResponse.json();
    expect(social.friendships.some((friendship: { userA: number; userB: number }) => [friendship.userA, friendship.userB].includes(3) && [friendship.userA, friendship.userB].includes(peerId))).toBeTruthy();
    expect(social.messages[`3-${peerId}`]).toEqual([]);
    expect(social.messages["1-3"].some((message: { text: string }) => message.text === "Сообщение поддержке")).toBeTruthy();

    const peerSocialBeforeNewMessage = await (await page.context().request.get("/api/bootstrap/social")).json();
    expect(peerSocialBeforeNewMessage.messages[`3-${peerId}`].some((message: { text: string }) => message.text === "Старое сообщение собеседнику")).toBeTruthy();
    expect(peerSocialBeforeNewMessage.messages[`3-${peerId}`].some((message: { text: string }) => message.text === "Новое входящее сообщение")).toBeTruthy();

    const senderComposer = page.getByRole("textbox", { name: "Сообщение" });
    await senderComposer.fill("Сообщение после очистки");
    await senderComposer.press("Enter");
    await expect(page.locator(".message-area:visible").getByText("Сообщение после очистки", { exact: true })).toBeVisible();
    await expect(receiverPage.locator(".message-area:visible").getByText("Сообщение после очистки", { exact: true })).toBeVisible();

    const receiverSocialAfterNewMessage = await (await receiverPage.context().request.get("/api/bootstrap/social")).json();
    const peerSocialAfterNewMessage = await (await page.context().request.get("/api/bootstrap/social")).json();
    expect(receiverSocialAfterNewMessage.messages[`3-${peerId}`].map((message: { text: string }) => message.text)).toEqual(["Сообщение после очистки"]);
    expect(peerSocialAfterNewMessage.messages[`3-${peerId}`].some((message: { text: string }) => message.text === "Сообщение после очистки")).toBeTruthy();
  } finally {
    await receiverContext.close();
  }
});

test("deleted organizations stay out of public and authenticated directories", async ({ page }) => {
  const { deletedCommunityId, deletedPublisherId } = await seedChatScenario(page);
  const publicCatalogResponse = await page.context().request.get("/api/public/catalog");
  expect(publicCatalogResponse.ok()).toBeTruthy();
  const publicCatalog = await publicCatalogResponse.json();
  expect(publicCatalog.organizations.map((organization: { id: number }) => organization.id)).not.toContain(deletedCommunityId);
  expect(publicCatalog.organizations.map((organization: { id: number }) => organization.id)).not.toContain(deletedPublisherId);

  await loginAs(page, 3, "/publishing");
  const catalog = await (await page.context().request.get("/api/bootstrap/catalog")).json();
  expect(catalog.users.some((user: { id: number }) => user.id === deletedCommunityId)).toBeTruthy();
  expect(catalog.users.some((user: { id: number }) => user.id === deletedPublisherId)).toBeTruthy();
  expect(catalog.activeOrganizationIds).not.toContain(deletedCommunityId);
  expect(catalog.activeOrganizationIds).not.toContain(deletedPublisherId);
  await expect(page.getByText("Удалённое издательство", { exact: true })).toHaveCount(0);
  await page.goto("/communities");
  await expect(page.getByText("Удалённое сообщество", { exact: true })).toHaveCount(0);
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
