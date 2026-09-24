// Runs only under the guarded disposable MySQL verification runner.
import assert from "node:assert/strict";
import test from "node:test";

process.env.BOOK_MEET_READING_SESSIONS_ENABLED = "1";
const { queue3HttpFixture } = await import("./helpers/queue3-http.mjs");
const { authorizedReadingPresenceRecipients } = await import("../server/modules/reading-presence-router.js");

test("reading presence respects audience, book, age, block and lease boundaries", async () => {
  const fixture = await queue3HttpFixture("b-presence");
  const { db, user, book, call, request } = fixture;
  try {
    const owner = await user("owner");
    const friend = await user("friend");
    const follower = await user("follower");
    const stranger = await user("stranger");
    const blocked = await user("blocked");
    const minor = await user("minor", { minor: true });
    const bookId = await book("one");
    for (const actor of [owner, friend, follower, stranger, blocked, minor]) {
      await db.query("INSERT INTO user_books (user_id, book_id, is_author, reading_status) VALUES (?, ?, 0, 'reading')", [actor.id, bookId]);
    }
    await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [Math.min(owner.id, friend.id), Math.max(owner.id, friend.id)]);
    await db.query("INSERT INTO follows (follower_user_id, target_user_id) VALUES (?, ?)", [follower.id, owner.id]);
    await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [blocked.id, owner.id]);
    process.env.BOOK_MEET_READING_SESSIONS_ENABLED = "0";
    await call(owner, "GET", "/reading-presence/preferences", undefined, 404);
    process.env.BOOK_MEET_READING_SESSIONS_ENABLED = "1";
    assert.equal((await call(owner, "GET", "/reading-presence/preferences")).visibility, "nobody");
    await call(owner, "PATCH", "/reading-presence/preferences", { visibility: "invalid" }, 422);
    const started = await call(owner, "POST", `/books/${bookId}/reading-sessions/timer/start`, {}, 201);
    assert.deepEqual((await call(owner, "GET", `/books/${bookId}/reading-presence`)).readers.map((item) => item.userId), [owner.id]);
    assert.deepEqual((await call(friend, "GET", `/books/${bookId}/reading-presence`)).readers, []);

    await call(owner, "PATCH", "/reading-presence/preferences", { visibility: "friends" });
    assert.deepEqual((await call(friend, "GET", `/books/${bookId}/reading-presence`)).readers.map((item) => item.userId), [owner.id]);
    assert.deepEqual((await call(follower, "GET", `/books/${bookId}/reading-presence`)).readers, []);
    await call(owner, "PATCH", "/reading-presence/preferences", { visibility: "followers" });
    assert.deepEqual((await call(follower, "GET", `/books/${bookId}/reading-presence`)).readers.map((item) => item.userId), [owner.id]);
    assert.deepEqual((await call(friend, "GET", `/books/${bookId}/reading-presence`)).readers, []);

    await call(owner, "PATCH", "/reading-presence/preferences", { visibility: "everyone" });
    assert.deepEqual((await call(stranger, "GET", `/books/${bookId}/reading-presence`)).readers.map((item) => item.userId), [owner.id]);
    assert.deepEqual((await call(blocked, "GET", `/books/${bookId}/reading-presence`)).readers, []);
    assert.deepEqual((await call(minor, "GET", `/books/${bookId}/reading-presence`)).readers, []);
    const recipients = await authorizedReadingPresenceRecipients(db, { readerId: owner.id, bookId, visibilities: ["everyone"], connectedUserIds: [owner.id, friend.id, follower.id, stranger.id, blocked.id, minor.id] });
    assert.deepEqual(recipients.sort((a, b) => a - b), [friend.id, follower.id, stranger.id].sort((a, b) => a - b));
    await db.query("UPDATE reading_sessions SET running_since = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 SECOND), lease_expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE id = ?", [started.session.id]);
    assert.deepEqual((await call(stranger, "GET", `/books/${bookId}/reading-presence`)).readers, []);
    await call(owner, "POST", `/reading-sessions/${started.session.id}/pause`, {});
    assert.deepEqual((await call(owner, "GET", `/books/${bookId}/reading-presence`)).readers, []);
    await call(owner, "POST", `/reading-sessions/${started.session.id}/resume`, { confirmExpired: true });
    await db.query("DELETE FROM user_books WHERE user_id = ? AND book_id = ?", [owner.id, bookId]);
    assert.deepEqual((await call(stranger, "GET", `/books/${bookId}/reading-presence`)).readers, [], "unlinked reader must not remain visible");
    assert.equal((await request(stranger, "GET", `/books/${bookId + 10000}/reading-presence`)).status, 404);
  } finally {
    await fixture.close();
  }
});
