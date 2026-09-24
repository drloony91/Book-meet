import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createNotificationDeliveryWorker,
  nextDailyNotificationAt,
  notificationDeliveryPlan,
  safeExternalNotificationPayload,
  safeNotificationDeliveryError,
} from "../server/modules/notification-events.js";
import { notificationPreferencesState } from "../server/modules/notification-preferences.js";

test("notification delivery plan respects category, channel readiness and modes", () => {
  const state = notificationPreferencesState({
    rows: [{ category: "likes", in_app_enabled: 0, telegram_enabled: 1, email_mode: "daily" }],
    account: { email: "verified@example.test", email_verified_at: new Date(), telegram_user_id: 42, telegram_connected_at: new Date(), notification_timezone: "Asia/Almaty" },
    environment: { USER_TELEGRAM_NOTIFICATIONS_READY: "1", USER_EMAIL_NOTIFICATIONS_READY: "1" },
  });
  const now = new Date("2026-03-08T00:00:00.000Z");
  assert.deepEqual(notificationDeliveryPlan(state, "likes", now).map(({ channel, mode }) => [channel, mode]), [["telegram", "immediate"], ["email", "daily"]]);
  assert.deepEqual(notificationDeliveryPlan(state, "system_security", now).map(({ channel, mode }) => [channel, mode]), [["in_app", "immediate"]]);
  const unavailable = notificationPreferencesState({ rows: [{ category: "likes", in_app_enabled: 1, telegram_enabled: 1, email_mode: "immediate" }] });
  assert.deepEqual(notificationDeliveryPlan(unavailable, "likes", now).map(({ channel }) => channel), ["in_app"]);
});

test("daily delivery uses the next local 09:00 across timezone and DST", () => {
  assert.equal(nextDailyNotificationAt(new Date("2026-03-08T12:30:00.000Z"), "America/New_York").toISOString(), "2026-03-08T13:00:00.000Z");
  assert.equal(nextDailyNotificationAt(new Date("2026-03-08T13:30:00.000Z"), "America/New_York").toISOString(), "2026-03-09T13:00:00.000Z");
  assert.equal(nextDailyNotificationAt(new Date("2026-03-08T00:00:00.000Z"), "Asia/Almaty").toISOString(), "2026-03-08T04:00:00.000Z");
});

test("generic worker claims once, retries safely and never exposes internal body", async () => {
  const delivery = { id: 7, channel: "email", mode: "immediate", idempotency_key: "stable-key", attempt_count: 1, category: "likes", material_kind: "review", material_id: 51, body: "private full material text" };
  let claimCount = 0;
  const calls = [];
  const store = {
    async claimDue() { claimCount += 1; return claimCount === 1 ? [delivery] : []; },
    async markDeliveredBatch(input) { calls.push(["delivered", input]); },
    async markFailedBatch(input) { calls.push(["failed", input]); },
  };
  let payload;
  const worker = createNotificationDeliveryWorker({ store, adapters: { email: async (input) => { payload = input; throw new Error("https://secret.test/path token=super-secret private content"); } }, now: () => new Date("2026-01-01T00:00:00.000Z") });
  assert.deepEqual(await worker.runOnce(), [{ id: 7, status: "retry" }]);
  assert.deepEqual(await worker.runOnce(), []);
  assert.equal(payload.idempotencyKey, "stable-key");
  assert.equal(JSON.stringify(payload).includes("private full material text"), false);
  assert.equal(calls[0][0], "failed");
  assert.equal(calls[0][1].error.includes("secret.test"), false);
  assert.equal(calls[0][1].error.includes("super-secret"), false);
});

test("daily email deliveries form one stable safe digest and retry as one group", async () => {
  const digestWindow = "2026-03-09T13:00:00.000Z";
  const claimed = [
    { id: 21, user_id: 9, channel: "email", mode: "daily", idempotency_key: "event-21", attempt_count: 2, digest_window_at: digestWindow, category: "likes", material_kind: "review", material_id: 3, body: "PRIVATE_ONE" },
    { id: 22, user_id: 9, channel: "email", mode: "daily", idempotency_key: "event-22", attempt_count: 2, digest_window_at: digestWindow, category: "mentions", material_kind: "comment", material_id: 4, body: "PRIVATE_TWO" },
  ];
  const mutations = [];
  let adapterInput;
  const store = {
    async claimDue() { return claimed.splice(0); },
    async markDeliveredBatch(input) { mutations.push(["delivered", input]); },
    async markFailedBatch(input) { mutations.push(["failed", input]); },
  };
  const worker = createNotificationDeliveryWorker({
    store,
    adapters: { email: async (input) => { adapterInput = input; throw new Error("digest transport failed"); } },
    now: () => new Date("2026-03-09T13:00:01.000Z"),
  });
  assert.deepEqual(await worker.runOnce(), [{ id: 21, status: "retry" }, { id: 22, status: "retry" }]);
  assert.equal(adapterInput.idempotencyKey, "notification-digest:9:2026-03-09T13:00:00.000Z");
  assert.equal(adapterInput.mode, "daily");
  assert.equal(adapterInput.payloads.length, 2);
  assert.equal(JSON.stringify(adapterInput).includes("PRIVATE_ONE"), false);
  assert.equal(JSON.stringify(adapterInput).includes("PRIVATE_TWO"), false);
  assert.deepEqual(mutations[0][1].ids, [21, 22]);
  assert.equal(mutations[0][1].nextAttemptAt.toISOString(), "2026-03-09T13:01:01.000Z");
});

test("a reclaimed stale processing delivery keeps max-attempt and ownership guards", async () => {
  const stale = { id: 31, user_id: 7, channel: "telegram", mode: "immediate", idempotency_key: "stale-31", attempt_count: 5, category: "system_security" };
  const mutations = [];
  const worker = createNotificationDeliveryWorker({
    store: {
      async claimDue() { return [stale]; },
      async markDeliveredBatch(input) { mutations.push(["delivered", input]); },
      async markFailedBatch(input) { mutations.push(["failed", input]); },
    },
    adapters: { telegram: async () => { throw new Error("crashed delivery retry"); } },
    workerId: "replacement-worker",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.deepEqual(await worker.runOnce(), [{ id: 31, status: "failed" }]);
  assert.equal(mutations[0][0], "failed");
  assert.equal(mutations[0][1].workerId, "replacement-worker");
  assert.equal(mutations[0][1].terminal, true);
  assert.equal(mutations[0][1].nextAttemptAt, null);
});

test("a blocked Telegram bot marks the channel errored without retrying", async () => {
  const delivery = { id: 41, user_id: 7, channel: "telegram", mode: "immediate", idempotency_key: "blocked-41", attempt_count: 1, category: "mentions" };
  const mutations = [];
  const blocked = Object.assign(new Error("forbidden"), { code: "TELEGRAM_CHANNEL_BLOCKED" });
  const worker = createNotificationDeliveryWorker({
    store: {
      async claimDue() { return [delivery]; },
      async markChannelError(input) { mutations.push(["channel-error", input]); },
      async markDeliveredBatch(input) { mutations.push(["delivered", input]); },
      async markFailedBatch(input) { mutations.push(["failed", input]); },
    },
    adapters: { telegram: async () => { throw blocked; } },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.deepEqual(await worker.runOnce(), [{ id: 41, status: "failed" }]);
  assert.equal(mutations[0][0], "channel-error");
  assert.equal(mutations[0][1].userId, 7);
  assert.equal(mutations[1][0], "failed");
  assert.equal(mutations[1][1].terminal, true);
  assert.equal(mutations[1][1].nextAttemptAt, null);
});

test("external payload and stored errors are intentionally generic", () => {
  const payload = safeExternalNotificationPayload({ category: "mentions", material_kind: "review", material_id: 9, body: "private body" });
  assert.equal(payload.title, "Новое упоминание");
  assert.deepEqual(payload.link, { materialKind: "review", materialId: 9 });
  assert.equal(JSON.stringify(payload).includes("private body"), false);
  const safe = safeNotificationDeliveryError(new Error("Bearer abcdef https://example.test/private\nfull body"));
  assert.equal(safe.includes("abcdef"), false);
  assert.equal(safe.includes("example.test"), false);
  assert.ok(safe.length <= 255);
});

test("production notification projections are created only by the domain helper", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const api = await readFile(path.join(root, "server", "api.js"), "utf8");
  const postponed = await readFile(path.join(root, "server", "modules", "postponed-reminders.js"), "utf8");
  assert.doesNotMatch(api, /INSERT\s+(?:IGNORE\s+)?INTO\s+notifications/i);
  assert.doesNotMatch(postponed, /INSERT\s+(?:IGNORE\s+)?INTO\s+notifications/i);
});
