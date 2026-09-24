import { defineConfig } from "@playwright/test";

const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  // The demo adapter is intentionally process-local. Serial workers keep the
  // per-test reset meaningful across the desktop/mobile project matrix.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  webServer: {
    command: "pnpm build && node scripts/demo.js",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      DEMO_MODE: "1",
      PORT: String(port),
      APP_ORIGIN: baseURL,
      BOOK_MEET_GROUP_CHATS_ENABLED: "1",
      BOOK_MEET_READING_SESSIONS_ENABLED: "1",
      USER_TELEGRAM_NOTIFICATIONS_READY: "1",
      TELEGRAM_WEBHOOK_SECRET: "playwright-only-webhook-secret",
    },
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
