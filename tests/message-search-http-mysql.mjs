import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

test("TZ5 message search uses FULLTEXT without leaking dialogs or private history", async () => {
  // Keep generated fixture usernames within the production 30-character
  // username contract so this test reaches the chat authorization boundary.
  const fixture = await queue3HttpFixture("q5-msg-search");
  const { db, user, call } = fixture;
  try {
    const viewer = await user("search-viewer");
    const firstPeer = await user("search-peer-one");
    const secondPeer = await user("search-peer-two");
    const stranger = await user("search-stranger");
    for (const peer of [firstPeer, secondPeer]) {
      await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [Math.min(viewer.id, peer.id), Math.max(viewer.id, peer.id)]);
    }

    const first = await call(viewer, "POST", "/social/messages", { targetId: firstPeer.id, body: "Редкий индексный книжный маркер первый" }, 201);
    const second = await call(firstPeer, "POST", "/social/messages", { targetId: viewer.id, body: "Редкий индексный книжный маркер второй" }, 201);
    const pageOne = await call(viewer, "GET", `/conversations/${firstPeer.id}/messages/search?q=${encodeURIComponent("индексный")}&limit=1`);
    assert.equal(pageOne.total, 2);
    assert.equal(pageOne.matches.length, 1);
    assert.equal(pageOne.matches[0].messageId, Number(second.message.id));
    assert.deepEqual(Object.keys(pageOne.matches[0]).sort(), ["author", "createdAt", "messageId", "snippet"]);
    const pageTwo = await call(viewer, "GET", `/conversations/${firstPeer.id}/messages/search?q=${encodeURIComponent("индексный")}&limit=1&cursor=${encodeURIComponent(pageOne.nextCursor)}`);
    assert.equal(pageTwo.matches[0].messageId, Number(first.message.id));

    const prefix = await call(viewer, "GET", `/conversations/${firstPeer.id}/messages/search?q=${encodeURIComponent("книж")}`);
    assert.equal(prefix.total, 2, "boolean prefix search should match Russian word prefixes");
    const noStemming = await call(viewer, "GET", `/conversations/${firstPeer.id}/messages/search?q=${encodeURIComponent("книга")}`);
    assert.equal(noStemming.total, 0, "FULLTEXT search deliberately does not invent Russian morphology");
    const tooShort = await call(viewer, "GET", `/conversations/${firstPeer.id}/messages/search?q=ин`, undefined, 422);
    assert.equal(tooShort.code, "MESSAGE_SEARCH_QUERY_TOO_SHORT");

    const edited = await call(viewer, "POST", "/social/messages", { targetId: firstPeer.id, body: "Историческая приватная редакция" }, 201);
    await call(viewer, "PATCH", `/messages/${edited.message.id}`, { body: "Текущая публичная редакция" });
    assert.equal((await call(viewer, "GET", `/conversations/${firstPeer.id}/messages/search?q=${encodeURIComponent("историческая")}`)).total, 0);
    assert.equal((await call(viewer, "GET", `/conversations/${firstPeer.id}/messages/search?q=${encodeURIComponent("текущая")}`)).total, 1);

    const deleted = await call(viewer, "POST", "/social/messages", { targetId: firstPeer.id, body: "Удалённый закрытый поисковый маркер" }, 201);
    await call(viewer, "DELETE", `/messages/${deleted.message.id}`);
    assert.equal((await call(firstPeer, "GET", `/conversations/${viewer.id}/messages/search?q=${encodeURIComponent("поисковый")}`)).total, 0);
    const [[evidence]] = await db.query("SELECT original_body FROM message_deletion_evidence WHERE message_reference_id = ?", [deleted.message.id]);
    assert.match(evidence.original_body, /поисковый/);

    const newest = await call(viewer, "POST", "/social/messages", { targetId: secondPeer.id, body: "Редкий индексный маркер в новом диалоге" }, 201);
    const grouped = await call(viewer, "GET", `/messages/search?q=${encodeURIComponent("индексный")}`);
    assert.equal(grouped.groups[0].peer.id, secondPeer.id);
    assert.equal(grouped.groups[0].matches[0].messageId, Number(newest.message.id));
    assert.equal(grouped.groups.find((group) => group.peer.id === firstPeer.id).count, 2);
    const groupedPage = await call(viewer, "GET", `/messages/search?q=${encodeURIComponent("индексный")}&limit=1`);
    assert.equal(groupedPage.groups.length, 1);
    assert.ok(groupedPage.nextCursor);
    const groupedNext = await call(viewer, "GET", `/messages/search?q=${encodeURIComponent("индексный")}&limit=1&cursor=${encodeURIComponent(groupedPage.nextCursor)}`);
    assert.equal(groupedNext.groups[0].peer.id, firstPeer.id);

    const strangerError = await call(stranger, "GET", `/conversations/${firstPeer.id}/messages/search?q=${encodeURIComponent("индексный")}`, undefined, 404);
    const absentError = await call(stranger, "GET", `/conversations/999999/messages/search?q=${encodeURIComponent("индексный")}`, undefined, 404);
    assert.deepEqual(strangerError, absentError);

    await call(viewer, "DELETE", `/social/messages/${firstPeer.id}/history`);
    assert.equal((await call(viewer, "GET", `/conversations/${firstPeer.id}/messages/search?q=${encodeURIComponent("индексный")}`)).total, 0);
    assert.equal((await call(firstPeer, "GET", `/conversations/${viewer.id}/messages/search?q=${encodeURIComponent("индексный")}`)).total, 2);

    await db.query("DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?", [Math.min(viewer.id, secondPeer.id), Math.max(viewer.id, secondPeer.id)]);
    const revoked = await call(viewer, "GET", `/conversations/${secondPeer.id}/messages/search?q=${encodeURIComponent("индексный")}`, undefined, 404);
    assert.equal(revoked.code, "MESSAGE_SEARCH_DIALOG_NOT_FOUND");
    const afterRevocation = await call(viewer, "GET", `/messages/search?q=${encodeURIComponent("индексный")}`);
    assert.equal(afterRevocation.groups.some((group) => group.peer.id === secondPeer.id), false);

    const [plan] = await db.query("EXPLAIN SELECT id FROM messages FORCE INDEX (messages_body_fulltext) WHERE MATCH(body) AGAINST (? IN BOOLEAN MODE)", ["+индексный*"]);
    assert.equal(plan[0].key, "messages_body_fulltext");
    assert.equal(String(plan[0].type).toLowerCase(), "fulltext");
  } finally {
    await fixture.close();
  }
});
