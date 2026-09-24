import assert from "node:assert/strict";
import test from "node:test";
import { localReadingDate, manualReadingInput, readingSessionDaySlices, readingSessionsEnabled } from "../server/modules/reading-sessions.js";

test("timer slices an elapsed interval at local midnight without losing seconds", () => {
  assert.deepEqual(readingSessionDaySlices("2026-09-23T18:59:30Z", "2026-09-23T19:00:30Z", "Asia/Qyzylorda"), [
    { date: "2026-09-23", seconds: 30 }, { date: "2026-09-24", seconds: 30 },
  ]);
  assert.equal(localReadingDate("Asia/Qyzylorda", new Date("2026-09-23T19:00:00Z")), "2026-09-24");
});

test("manual input needs exact local date and bounded integer seconds", () => {
  const now = new Date("2026-09-23T19:00:00Z");
  assert.deepEqual(manualReadingInput({ date: "2026-09-24", hours: 0, minutes: 1, seconds: 1 }, "Asia/Qyzylorda", now), { date: "2026-09-24", durationSeconds: 61 });
  for (const payload of [
    { date: "2026-09-25", hours: 0, minutes: 1, seconds: 0 },
    { date: "2026-02-30", hours: 0, minutes: 1, seconds: 0 },
    { date: "2026-09-24", hours: 0, minutes: 0, seconds: 0 },
    { date: "2026-09-24", hours: 25, minutes: 0, seconds: 0 },
    { date: "2026-09-24", hours: 0, minutes: 60, seconds: 0 },
    { date: "2026-09-24", hours: 0, minutes: 0, seconds: 60 },
    { date: "2026-09-24", hours: "1", minutes: 0, seconds: 0 },
  ]) assert.throws(() => manualReadingInput(payload, "Asia/Qyzylorda", now), { statusCode: 422 });
});

test("reading-session feature gate accepts only explicit enablement", () => {
  const original = process.env.BOOK_MEET_READING_SESSIONS_ENABLED;
  try {
    for (const value of [undefined, "0", "yes"]) {
      if (value === undefined) delete process.env.BOOK_MEET_READING_SESSIONS_ENABLED;
      else process.env.BOOK_MEET_READING_SESSIONS_ENABLED = value;
      assert.equal(readingSessionsEnabled(), false);
    }
    for (const value of ["1", "true"]) {
      process.env.BOOK_MEET_READING_SESSIONS_ENABLED = value;
      assert.equal(readingSessionsEnabled(), true);
    }
  } finally {
    if (original === undefined) delete process.env.BOOK_MEET_READING_SESSIONS_ENABLED;
    else process.env.BOOK_MEET_READING_SESSIONS_ENABLED = original;
  }
});
