// Runs only under the disposable MySQL verification runner.
import assert from "node:assert/strict";
import test from "node:test";

process.env.BOOK_MEET_READING_SESSIONS_ENABLED = "1";
const { queue3HttpFixture } = await import("./helpers/queue3-http.mjs");

test("B reading session owner timer, lease, manual entries and retained history", async () => {
  const fixture = await queue3HttpFixture("b-sessions");
  const { db, user, book, call, request } = fixture;
  try {
    const owner = await user("owner");
    const other = await user("other");
    const firstBook = await book("one");
    const secondBook = await book("two");
    for (const id of [firstBook, secondBook]) {
      await db.query("INSERT INTO user_books (user_id, book_id, is_author, reading_status) VALUES (?, ?, 0, 'reading')", [owner.id, id]);
      await db.query("INSERT INTO reading_cycles (user_id, book_id, status) VALUES (?, ?, 'active')", [owner.id, id]);
    }
    process.env.BOOK_MEET_READING_SESSIONS_ENABLED = "0";
    await call(owner, "GET", "/reading-sessions/active", undefined, 404);
    process.env.BOOK_MEET_READING_SESSIONS_ENABLED = "1";

    assert.equal((await call(owner, "GET", "/reading-sessions/active")).session, null);
    const started = await call(owner, "POST", `/books/${firstBook}/reading-sessions/timer/start`, {}, 201);
    const sessionId = started.session.id;
    assert.equal(started.session.state, "running");
    assert.equal((await call(owner, "POST", `/books/${firstBook}/reading-sessions/timer/start`, {})).session.id, sessionId);
    const conflict = await call(owner, "POST", `/books/${secondBook}/reading-sessions/timer/start`, {}, 409);
    assert.equal(conflict.code, "READING_SESSION_ACTIVE_OTHER_BOOK");
    await call(other, "POST", `/reading-sessions/${sessionId}/stop`, {}, 404);
    await call(other, "GET", `/books/${firstBook}/reading-sessions`);
    await call(other, "PATCH", `/reading-sessions/${sessionId}`, { date: "2026-01-01", hours: 0, minutes: 1, seconds: 0 }, 404);

    const heartbeat = await call(owner, "POST", `/reading-sessions/${sessionId}/heartbeat`, {});
    assert.equal(heartbeat.session.state, "running");
    await db.query("UPDATE reading_sessions SET running_since = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), lease_expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 8 MINUTE) WHERE id = ?", [sessionId]);
    const expired = await call(owner, "POST", `/reading-sessions/${sessionId}/heartbeat`, {}, 409);
    assert.equal(expired.code, "READING_SESSION_LEASE_EXPIRED");
    assert.equal(expired.session.state, "paused");
    assert.equal(expired.session.durationSeconds, 120);
    assert.equal((await call(owner, "POST", `/reading-sessions/${sessionId}/resume`, {}, 409)).code, "READING_SESSION_RESUME_CONFIRMATION_REQUIRED");
    assert.equal((await call(owner, "POST", `/reading-sessions/${sessionId}/resume`, { confirmExpired: true })).session.state, "running");
    assert.equal((await call(owner, "POST", `/reading-sessions/${sessionId}/pause`, {})).session.state, "paused");
    const closed = await call(owner, "POST", `/reading-sessions/${sessionId}/stop`, {});
    assert.equal(closed.session.state, "closed");
    const completedDuration = closed.session.durationSeconds;
    assert.equal((await call(owner, "POST", `/reading-sessions/${sessionId}/stop`, {})).session.id, sessionId);
    assert.equal((await call(owner, "GET", "/reading-sessions/active")).session, null);

    const today = new Date().toISOString().slice(0, 10);
    await call(owner, "POST", `/books/${firstBook}/reading-sessions`, { date: today, hours: 0, minutes: 0, seconds: 0 }, 422);
    await call(owner, "POST", `/books/${firstBook}/reading-sessions`, { date: today, hours: 0, minutes: 60, seconds: 0 }, 422);
    const manual = await call(owner, "POST", `/books/${firstBook}/reading-sessions`, { date: today, hours: 1, minutes: 2, seconds: 3 }, 201);
    assert.equal(manual.session.durationSeconds, 3723);
    const [[firstCycle]] = await db.query("SELECT id FROM reading_cycles WHERE user_id = ? AND book_id = ? AND status = 'active'", [owner.id, firstBook]);
    assert.equal(manual.session.readingCycleId, firstCycle.id);
    assert.equal((await call(owner, "GET", `/books/${firstBook}/reading-sessions`)).sessions.length, 2);
    await call(other, "DELETE", `/reading-sessions/${manual.session.id}`, undefined, 404);
    const edited = await call(owner, "PATCH", `/reading-sessions/${manual.session.id}`, { date: today, hours: 0, minutes: 0, seconds: 9 });
    assert.equal(edited.session.durationSeconds, 9);
    const [[day]] = await db.query("SELECT duration_seconds FROM reading_session_days WHERE session_id = ?", [manual.session.id]);
    assert.equal(day.duration_seconds, 9);
    await call(owner, "DELETE", `/reading-sessions/${manual.session.id}`);
    assert.equal((await request(owner, "DELETE", `/reading-sessions/${manual.session.id}`)).status, 404);
    await db.query("UPDATE reading_cycles SET status = 'completed', completed_month = ?, completed_year = ?, completed_at = UTC_TIMESTAMP() WHERE id = ?", [new Date().getUTCMonth() + 1, new Date().getUTCFullYear(), firstCycle.id]);
    const afterCompletion = await call(owner, "POST", `/books/${firstBook}/reading-sessions`, { date: today, hours: 0, minutes: 0, seconds: 1 }, 201);
    assert.equal(afterCompletion.session.readingCycleId, firstCycle.id, "manual time on a finished book belongs to its latest completed cycle");
    const completionMonth = new Date().getUTCMonth() + 1;
    const completionYear = new Date().getUTCFullYear();
    await db.query("UPDATE user_books SET reading_status = 'read', read_month = ?, read_year = ? WHERE user_id = ? AND book_id = ?", [completionMonth, completionYear, owner.id, firstBook]);
    const statistics = await call(owner, "GET", `/reading-statistics?year=${completionYear}`);
    assert.equal(statistics.bookCounts[completionMonth - 1], 1);
    const completedBook = statistics.bookMonths[completionMonth - 1].books.find((entry) => entry.book.id === firstBook);
    assert.equal(completedBook?.durationSeconds, completedDuration + 1, "completed-book time sums only sessions in its cycle");
    await call(owner, "DELETE", `/reading-sessions/${afterCompletion.session.id}`);
    const updatedStatistics = await call(owner, "GET", `/reading-statistics?year=${completionYear}`);
    assert.equal(updatedStatistics.bookMonths[completionMonth - 1].books.find((entry) => entry.book.id === firstBook)?.durationSeconds, completedDuration);

    const midnight = await call(owner, "POST", `/books/${secondBook}/reading-sessions/timer/start`, {}, 201, { "X-BookMeet-Timezone": "Asia/Qyzylorda" });
    const anchor = new Date(); anchor.setUTCDate(anchor.getUTCDate() - 2); anchor.setUTCHours(18, 59, 30, 0);
    const lease = new Date(anchor.getTime() + 60_000);
    await db.query("UPDATE reading_sessions SET running_since = ?, lease_expires_at = ? WHERE id = ?", [anchor, lease, midnight.session.id]);
    await call(owner, "POST", `/reading-sessions/${midnight.session.id}/stop`, {});
    const [days] = await db.query("SELECT local_date, duration_seconds FROM reading_session_days WHERE session_id = ? ORDER BY local_date", [midnight.session.id]);
    assert.deepEqual(days.map((row) => row.duration_seconds), [30, 30]);
    const [[sum]] = await db.query("SELECT duration_seconds FROM reading_sessions WHERE id = ?", [midnight.session.id]);
    assert.equal(sum.duration_seconds, 60);

    await db.query("DELETE FROM user_books WHERE user_id = ? AND book_id = ?", [owner.id, secondBook]);
    const [[retained]] = await db.query("SELECT library_user_id, library_book_id FROM reading_sessions WHERE id = ?", [midnight.session.id]);
    assert.equal(retained.library_user_id, null);
    assert.equal(retained.library_book_id, null);
  } finally {
    await fixture.close();
  }
});
