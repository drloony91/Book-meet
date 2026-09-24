import assert from "node:assert/strict";
import test from "node:test";
import { assembleReadingStatistics } from "../server/modules/reading-statistics.js";

const book = (id, title) => ({ book_id: id, title, author: "Автор", cover_path: null, cover_tone: "blue" });

test("books count once in completion month while exact time can span months", () => {
  const result = assembleReadingStatistics({
    year: 2026,
    completed: [{ ...book(1, "Первая"), cycle_id: 11, completed_year: 2026, completed_month: 5 }],
    reading: [{ ...book(2, "Вторая"), cycle_id: 22, progress_unit: "pages", pages_current: 25, pages_total: 100 }],
    cycleRows: [{ reading_cycle_id: 11, duration_seconds: 3723 }, { reading_cycle_id: 22, duration_seconds: 125 }],
    dayRows: [
      { ...book(1, "Первая"), local_date: new Date("2026-04-30T00:00:00Z"), duration_seconds: 3600 },
      { ...book(1, "Первая"), local_date: new Date("2026-05-01T00:00:00Z"), duration_seconds: 123 },
      { ...book(2, "Вторая"), local_date: new Date("2026-05-01T00:00:00Z"), duration_seconds: 125 },
    ],
  });
  assert.equal(result.bookCounts[4], 1);
  assert.equal(result.bookCounts.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(result.bookMonths[4].books[0].durationSeconds, 3723);
  assert.equal(result.currentReading[0].progressPercent, 25);
  assert.equal(result.currentReading[0].durationSeconds, 125);
  assert.equal(result.timeCounts[3], 3600);
  assert.equal(result.timeCounts[4], 248);
  assert.deepEqual(result.timeMonths[4].books.map((entry) => entry.book.id), [2, 1]);
});

test("unflushed active timer time is bounded by lease and split at local midnight", () => {
  const result = assembleReadingStatistics({
    year: 2026,
    reading: [{ ...book(2, "Вторая"), cycle_id: 22, progress_unit: "chapters", chapters_current: 1, chapters_total: 4 }],
    cycleRows: [{ reading_cycle_id: 22, duration_seconds: 10 }],
    running: [{ ...book(2, "Вторая"), reading_cycle_id: 22, running_since: "2026-09-23T18:59:30Z", lease_expires_at: "2026-09-23T19:00:30Z", timezone: "Asia/Qyzylorda" }],
    now: new Date("2026-09-23T19:02:00Z"),
  });
  assert.equal(result.currentReading[0].durationSeconds, 70);
  assert.equal(result.timeCounts[8], 60);
  assert.equal(result.timeMonths[8].books[0].durationSeconds, 60);
});
