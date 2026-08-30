import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

type ExpectedHttpError = { path: string | RegExp; status?: number; warning?: string | RegExp };

type BrowserFixtures = {
  resetDemo: () => Promise<void>;
  allowExpectedHttpError: (expected: ExpectedHttpError) => void;
  browserDiagnostics: { allowExpectedHttpError: (expected: ExpectedHttpError) => void; trackPage: (page: Page) => void; assertNoErrors: () => Promise<void> };
};

function matchesPath(url: string, pattern: string | RegExp) {
  const pathname = new URL(url).pathname;
  return pattern instanceof RegExp ? pattern.test(pathname) : pathname === pattern || pathname.startsWith(`${pattern}/`);
}

async function resetDemo(request: APIRequestContext, page: Page) {
  const response = await request.post("/api/__test__/reset");
  expect(response.ok(), `demo reset failed with HTTP ${response.status()}`).toBeTruthy();
  await page.context().clearCookies();
}

export const test = base.extend<BrowserFixtures>({
  resetDemo: async ({ request, page }, use) => {
    await use(() => resetDemo(request, page));
  },
  browserDiagnostics: async ({ page }, use, testInfo) => {
    const expected: ExpectedHttpError[] = [];
    const expectedWarnings: Array<string | RegExp> = [];
    const errors: string[] = [];
    const allow = (entry: ExpectedHttpError) => {
      expected.push(entry);
      if (entry.warning) expectedWarnings.push(entry.warning);
    };
    const expectedResponse = (url: string, status: number) => {
      const match = expected.find((entry) => matchesPath(url, entry.path) && (entry.status === undefined || entry.status === status));
      return Boolean(match);
    };

    const trackPage = (trackedPage: Page) => {
      const expectedFailedRequestUrls = new Set<string>();
      const completedRequestUrls = new Set<string>();
      trackedPage.on("pageerror", (error) => errors.push(`pageerror: ${error.stack || error.message}`));
      trackedPage.on("console", (message) => {
        if (message.type() === "error") {
          const statusMatch = /Failed to load resource: the server responded with a status of (\d{3})/i.exec(message.text());
          if (statusMatch) {
            const status = Number(statusMatch[1]);
            const sourceUrl = message.location().url;
            // Chromium sometimes emits this generic message without exposing the
            // matching fetch through Playwright's response event (notably for the
            // parallel unauthenticated bootstrap requests). The message itself
            // carries the observed status and source URL; both must match an
            // explicit per-test allowance.
            if (sourceUrl && expected.some((entry) => entry.status === status && matchesPath(sourceUrl, entry.path))) return;
          }
          errors.push(`console.error: ${message.text()}${message.location().url ? ` (${message.location().url})` : ""}`);
        }
        if (message.type() === "warning" && !/Download the React DevTools/i.test(message.text()) && !expectedWarnings.some((pattern) => pattern instanceof RegExp ? pattern.test(message.text()) : message.text().includes(pattern))) errors.push(`console.warn: ${message.text()}`);
      });
      trackedPage.on("requestfailed", (request) => {
        const failureText = request.failure()?.errorText || "unknown";
        if (request.resourceType() === "eventsource" && failureText === "net::ERR_ABORTED") return;
        if (expectedFailedRequestUrls.has(request.url())) return;
        if (completedRequestUrls.has(request.url())) return;
        if (expected.some((entry) => entry.status !== undefined && entry.status >= 500 && (matchesPath(request.url(), entry.path) || typeof entry.path === "string" && request.url().includes(entry.path)))) return;
        const resourceType = request.resourceType();
        const localAsset = ["document", "script", "stylesheet", "image", "font"].includes(resourceType)
          && request.url().startsWith(String(testInfo.project.use?.baseURL || "http://127.0.0.1"));
        errors.push(`${localAsset ? "broken local asset" : "requestfailed"} ${resourceType} ${request.method()} ${request.url()}: ${failureText}`);
      });
      trackedPage.on("response", (response) => {
        const url = response.url();
        const status = response.status();
        if (status >= 400 && status <= 599) {
          if (expectedResponse(url, status)) {
            if (status >= 500) expectedFailedRequestUrls.add(url);
            return;
          }
          errors.push(`unexpected HTTP ${status} ${response.request().method()} ${url}`);
          return;
        }
        const resourceType = response.request().resourceType();
        if (status >= 200 && status < 400) completedRequestUrls.add(url);
        const localAsset = ["document", "script", "stylesheet", "image", "font"].includes(resourceType) && url.startsWith(String(testInfo.project.use?.baseURL || "http://127.0.0.1"));
        if (localAsset && status === 0) errors.push(`broken local asset ${resourceType} ${url}`);
      });
    };
    trackPage(page);

    await use({
      allowExpectedHttpError: allow,
      trackPage,
      assertNoErrors: async () => {
        if (!errors.length) return;
        const report = [...new Set(errors)].join("\n");
        throw new Error(`Strict browser regression checks failed:\n${report}`);
      },
    });
  },
  allowExpectedHttpError: async ({ browserDiagnostics }, use) => {
    // The listener lifecycle and assertion live in browserDiagnostics so the
    // failure is raised by afterEach while the Playwright test step is still
    // open, avoiding fixture-teardown reporter errors.
    await use(browserDiagnostics.allowExpectedHttpError);
  },
});

export { expect };

export async function loginAs(page: Page, user = 1, pathName = "/") {
  await page.goto(`/api/auth/demo-login?user=${user}`);
  await expect(page.locator("html")).toHaveAttribute("data-book-meet-user-id", String(user));
  if (pathName !== "/") await page.goto(pathName);
  await expect(page.locator("html")).toHaveAttribute("data-book-meet-user-id", String(user));
}

export async function allowGuestBootstrap401(allowExpectedHttpError: (expected: ExpectedHttpError) => void) {
  allowExpectedHttpError({ path: /^\/api\/bootstrap(?:\/|$)/, status: 401 });
}

export const browserFixtureDir = path.resolve("tests/browser/fixtures");

export async function createOversizedAvatarFixture() {
  const outputDir = path.resolve("test-results/browser-fixtures");
  await mkdir(outputDir, { recursive: true });
  const target = path.join(outputDir, "oversized-avatar.png");
  await writeFile(target, Buffer.alloc(8 * 1024 * 1024 + 1, 7));
  return target;
}
