// Runs only under the disposable MySQL verification runner.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.BOOK_MEET_GROUP_CHATS_ENABLED = "1";
const { queue3HttpFixture } = await import("./helpers/queue3-http.mjs");

test("A2 group lifecycle: flag, role matrix, membership boundaries and deletion", async (t) => {
  const fixture = await queue3HttpFixture("a2-groups");
  const { db, origin, user, call } = fixture;
  try {
    const owner = await user("owner");
    const member = await user("member");
    const candidate = await user("candidate");
    const minor = await user("minor", { minor: true });
    const outsider = await user("outsider");
    for (const [left, right] of [[owner, member], [owner, candidate], [owner, minor]]) {
      await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [Math.min(left.id, right.id), Math.max(left.id, right.id)]);
    }

    process.env.BOOK_MEET_GROUP_CHATS_ENABLED = "0";
    await call(owner, "GET", "/group-conversations", undefined, 404);
    process.env.BOOK_MEET_GROUP_CHATS_ENABLED = "true";
    const avatarUrl = `data:image/png;base64,${(await readFile(new URL("./browser/fixtures/avatar-valid.png", import.meta.url))).toString("base64")}`;
    await call(owner, "POST", "/group-conversations", { name: "Invalid avatar", participantIds: [member.id], avatarPath: "/uploads/arbitrary.png" }, 422);
    await call(owner, "POST", "/group-conversations", { name: "Invalid avatar", participantIds: [member.id], avatarUrl: "https://example.com/avatar.png" }, 422);
    const created = await call(owner, "POST", "/group-conversations", { name: "A2 lifecycle", participantIds: [member.id], avatarUrl }, 201);
    const groupId = Number(created.id);
    const detail = await call(member, "GET", `/group-conversations/${groupId}`);
    assert.equal(detail.currentRole, "member");
    assert.equal(detail.members.length, 2);
    assert.match(detail.avatarUrl, /^\/uploads\/avatar-/);
    await call(member, "PATCH", `/group-conversations/${groupId}`, { name: "forbidden" }, 404);
    await call(owner, "PATCH", `/group-conversations/${groupId}`, { addMembersPolicy: "owner_or_moderators", removeMembersPolicy: "owner_or_moderators" });
    await call(owner, "PATCH", `/group-conversations/${groupId}`, { avatarUrl: null });
    assert.equal((await call(owner, "GET", `/group-conversations/${groupId}`)).avatarUrl, undefined);
    const candidates = await call(owner, "GET", "/group-conversations/candidates?q=candidate");
    assert.ok(candidates.users.some((entry) => entry.id === candidate.id), "contact search exposes authorized candidates");

    await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [member.id, candidate.id]);
    await call(owner, "POST", `/group-conversations/${groupId}/members`, { userId: candidate.id }, 404);
    await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [member.id, candidate.id]);
    await call(owner, "POST", `/group-conversations/${groupId}/members`, { userId: minor.id }, 404);
    await call(owner, "POST", `/group-conversations/${groupId}/members`, { userId: candidate.id }, 201);
    await call(owner, "PATCH", `/group-conversations/${groupId}/members/${member.id}/role`, { role: "moderator" });

    const message = await call(member, "POST", `/group-conversations/${groupId}/messages`, { body: "boundary" }, 201);
    const searchable = await call(member, "POST", `/group-conversations/${groupId}/messages`, { body: "needleword original" }, 201);
    await call(member, "PATCH", `/group-conversations/${groupId}/messages/${searchable.id}`, { body: "needleword edited" });
    await call(candidate, "PATCH", `/group-conversations/${groupId}/messages/${searchable.id}`, { body: "forbidden" }, 404);
    const searchBeforeRead = await call(owner, "GET", `/group-conversations/${groupId}/messages/search?q=needleword`);
    assert.equal(searchBeforeRead.total, 1, "per-member read cursor must not hide search");
    assert.match(searchBeforeRead.matches[0].snippet, /needleword/i);
    const bookId = await fixture.book("group-attachment");
    const attachment = await call(owner, "POST", `/group-conversations/${groupId}/messages`, { attachment: { kind: "book", id: bookId } }, 201);
    await call(owner, "POST", `/group-conversations/${groupId}/messages`, { stickerId: "book-open-v1", mentions: [{ userId: candidate.id, token: "@a2-groups-candidate" }] }, 422);
    const sticker = await call(owner, "POST", `/group-conversations/${groupId}/messages`, { stickerId: "book-open-v1" }, 201);
    const mention = await call(owner, "POST", `/group-conversations/${groupId}/messages`, { body: "@a2-groups-candidate привет", mentions: [{ userId: candidate.id, token: "@a2-groups-candidate" }] }, 201);
    assert.equal((await call(owner, "GET", `/group-conversations/${groupId}/messages`)).messages.find((entry) => entry.id === attachment.id).attachment.kind, "book");
    await call(member, "POST", `/group-conversations/${groupId}/messages/${mention.id}/reactions/like`, {});
    const reaction = await call(member, "POST", `/group-conversations/${groupId}/messages/${mention.id}/reactions/like`, {});
    assert.equal(reaction.likeCount, 1, "group likes are idempotent");
    await call(member, "DELETE", `/group-conversations/${groupId}/messages/${mention.id}/reactions/like`);
    await call(candidate, "POST", `/group-conversations/${groupId}/messages/${mention.id}/reactions/like`, {});
    await db.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)", [owner.id, candidate.id]);
    await call(candidate, "GET", `/group-conversations/${groupId}/messages`, undefined, 404);
    assert.equal((await call(candidate, "GET", "/group-conversations")).conversations.some((entry) => entry.id === groupId), false, "group list must not reveal blocked group activity");
    assert.equal((await call(owner, "GET", "/group-conversations")).conversations.some((entry) => entry.id === groupId), false, "blocking also hides the group from the blocker");
    await db.query("DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", [owner.id, candidate.id]);
    const [[candidateProfile]] = await db.query("SELECT birth_date FROM profiles WHERE user_id = ?", [candidate.id]);
    await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [`${new Date().getUTCFullYear() - 15}-01-01`, candidate.id]);
    await call(candidate, "GET", `/group-conversations/${groupId}`, undefined, 404);
    assert.equal((await call(owner, "GET", "/group-conversations")).conversations.some((entry) => entry.id === groupId), false, "an age change immediately removes incompatible group visibility");
    await db.query("UPDATE profiles SET birth_date = ? WHERE user_id = ?", [candidateProfile.birth_date, candidate.id]);
    await call(outsider, "POST", `/group-conversations/${groupId}/polls`, { question: "Outsider", options: ["Да", "Нет"], allowsMultiple: false, mayChangeVote: true }, 404);
    await call(owner, "POST", `/group-conversations/${groupId}/polls`, { question: "", options: ["Да", "Нет"], allowsMultiple: false, mayChangeVote: true }, 422);
    await call(owner, "POST", `/group-conversations/${groupId}/polls`, { question: "Few", options: ["Да"], allowsMultiple: false, mayChangeVote: true }, 422);
    await call(owner, "POST", `/group-conversations/${groupId}/polls`, { question: "Duplicate", options: ["Да", " да "], allowsMultiple: false, mayChangeVote: true }, 422);
    await call(owner, "POST", `/group-conversations/${groupId}/polls`, { question: "Past", options: ["Да", "Нет"], allowsMultiple: false, mayChangeVote: true, closesAt: "2000-01-01T00:00:00.000Z" }, 422);
    const single = await call(owner, "POST", `/group-conversations/${groupId}/polls`, { question: "Single vote", options: ["Первый", "Второй"], allowsMultiple: false, mayChangeVote: false }, 201);
    assert.equal(JSON.stringify(single.poll).includes("userId"), false, "poll DTO must not reveal voter identities");
    assert.equal((await call(owner, "GET", `/group-conversations/${groupId}/messages`)).messages.find((entry) => entry.id === single.messageId).poll.question, "Single vote");
    const [singleFirst, singleSecond] = single.poll.options.map((option) => option.id);
    await call(candidate, "POST", `/group-conversations/${groupId}/polls/${single.poll.id}/vote`, { optionIds: [singleFirst] });
    const singleRetry = await call(candidate, "POST", `/group-conversations/${groupId}/polls/${single.poll.id}/vote`, { optionIds: [singleFirst] });
    assert.equal(singleRetry.poll.options.find((option) => option.id === singleFirst).viewerSelected, true, "an exact no-change retry is idempotent");
    await call(candidate, "POST", `/group-conversations/${groupId}/polls/${single.poll.id}/vote`, { optionIds: [singleSecond] }, 409);
    const multiple = await call(member, "POST", `/group-conversations/${groupId}/polls`, { question: "Multiple vote", options: ["Один", "Два", "Три"], allowsMultiple: true, mayChangeVote: true, closesAt: new Date(Date.now() + 3600_000).toISOString() }, 201);
    const multipleIds = multiple.poll.options.map((option) => option.id);
    await call(owner, "POST", `/group-conversations/${groupId}/polls/${multiple.poll.id}/vote`, { optionIds: [multipleIds[0], multipleIds[1]] });
    const changedVote = await call(owner, "POST", `/group-conversations/${groupId}/polls/${multiple.poll.id}/vote`, { optionIds: [multipleIds[2]] });
    assert.equal(changedVote.poll.options.filter((option) => option.viewerSelected).length, 1);
    await call(candidate, "POST", `/group-conversations/${groupId}/polls/${multiple.poll.id}/vote`, { optionIds: [singleFirst] }, 422);
    const deadline = await call(owner, "POST", `/group-conversations/${groupId}/polls`, { question: "Deadline", options: ["Да", "Нет"], allowsMultiple: false, mayChangeVote: true, closesAt: new Date(Date.now() + 1600).toISOString() }, 201);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await call(member, "POST", `/group-conversations/${groupId}/polls/${deadline.poll.id}/vote`, { optionIds: [deadline.poll.options[0].id] }, 409);
    const concurrent = await call(owner, "POST", `/group-conversations/${groupId}/polls`, { question: "Concurrent", options: ["A", "B"], allowsMultiple: false, mayChangeVote: false }, 201);
    const concurrentResults = await Promise.all([
      fixture.request(member, "POST", `/group-conversations/${groupId}/polls/${concurrent.poll.id}/vote`, { optionIds: [concurrent.poll.options[0].id] }),
      fixture.request(member, "POST", `/group-conversations/${groupId}/polls/${concurrent.poll.id}/vote`, { optionIds: [concurrent.poll.options[1].id] }),
    ]);
    assert.deepEqual(concurrentResults.map((entry) => entry.status).sort(), [200, 409], "poll row locking serializes conflicting no-change votes");
    const [[concurrentVotes]] = await db.query("SELECT COUNT(*) AS count FROM conversation_poll_votes WHERE poll_id = ? AND user_id = ?", [concurrent.poll.id, member.id]);
    assert.equal(Number(concurrentVotes.count), 1);
    let list = await call(owner, "GET", "/group-conversations");
    assert.equal(list.conversations[0].memberCount, 3, "group list projects active membership count");
    assert.ok(typeof list.conversations[0].lastMessage === "string", "group list has a last visible message label");
    assert.ok(list.conversations[0].lastMessageAt, "group list has a last visible message timestamp");
    assert.ok(list.conversations[0].unreadCount >= 1);
    await call(owner, "PATCH", `/group-conversations/${groupId}/read`, { messageId: message.id });
    list = await call(owner, "GET", "/group-conversations");
    assert.ok(list.conversations[0].unreadCount >= 1, "a monotonic cursor does not mark later group messages read");
    await call(member, "POST", `/group-conversations/${groupId}/history/clear`, {});
    assert.deepEqual((await call(owner, "GET", `/group-conversations/${groupId}/messages`)).messages, [], "clear boundary hides retained history for every active member");
    assert.deepEqual((await call(owner, "GET", `/group-conversations/${groupId}/polls`)).polls, [], "global clear hides poll cards through their system messages");
    assert.equal((await call(owner, "GET", `/group-conversations/${groupId}/messages/search?q=needleword`)).total, 0, "search obeys global clear boundary");

    const authorDeleted = await call(candidate, "POST", `/group-conversations/${groupId}/messages`, { body: "author delete" }, 201);
    await call(candidate, "DELETE", `/group-conversations/${groupId}/messages/${authorDeleted.id}`);
    const moderatorDeleted = await call(owner, "POST", `/group-conversations/${groupId}/messages`, { body: "moderator evidence" }, 201);
    await call(member, "DELETE", `/group-conversations/${groupId}/messages/${moderatorDeleted.id}`);
    const ownerDeleted = await call(member, "POST", `/group-conversations/${groupId}/messages`, { body: "owner evidence" }, 201);
    await call(owner, "DELETE", `/group-conversations/${groupId}/messages/${ownerDeleted.id}`);
    const moderatedSticker = await call(owner, "POST", `/group-conversations/${groupId}/messages`, { stickerId: "book-open-v1" }, 201);
    await call(member, "DELETE", `/group-conversations/${groupId}/messages/${moderatedSticker.id}`);
    await call(candidate, "POST", `/group-conversations/${groupId}/messages/${authorDeleted.id}/reactions/like`, {}, 409);
    const messageRows = (await call(owner, "GET", `/group-conversations/${groupId}/messages`)).messages;
    assert.equal(messageRows.find((entry) => entry.id === authorDeleted.id).text, "Пользователь удалил это сообщение");
    assert.equal(messageRows.find((entry) => entry.id === moderatorDeleted.id).text, "Сообщение удалено модератором");
    assert.equal(messageRows.find((entry) => entry.id === ownerDeleted.id).text, "Сообщение удалено администратором");
    const [[moderationEvidence]] = await db.query("SELECT author_reference_id, deleter_reference_id, original_message_kind, original_sticker_id, original_attachment_kind FROM group_message_moderation_evidence WHERE message_reference_id = ?", [moderatedSticker.id]);
    assert.deepEqual([Number(moderationEvidence.author_reference_id), Number(moderationEvidence.deleter_reference_id), moderationEvidence.original_message_kind, moderationEvidence.original_sticker_id, moderationEvidence.original_attachment_kind], [owner.id, member.id, "sticker", "book-open-v1", null]);
    assert.equal((await call(owner, "GET", `/group-conversations/${groupId}/messages/search?q=evidence`)).total, 0, "deleted group bodies and evidence never enter ordinary search");

    await call(owner, "POST", `/group-conversations/${groupId}/leave`, undefined, 409);
    await call(owner, "POST", `/group-conversations/${groupId}/owner-transfer`, { userId: candidate.id });
    await call(owner, "POST", `/group-conversations/${groupId}/leave`);
    await call(owner, "GET", `/group-conversations/${groupId}`, undefined, 404);
    await call(candidate, "DELETE", `/group-conversations/${groupId}`);
    await call(member, "GET", "/group-conversations");
    await call(member, "GET", `/group-conversations/${groupId}`, undefined, 404);
    await call(member, "GET", `/group-conversations/${groupId}/messages`, undefined, 404);
    const [[deleted]] = await db.query("SELECT state FROM conversations WHERE id = ?", [groupId]);
    assert.equal(deleted.state, "deleted", "ordinary access is invalidated without deleting evidence");
    const [[closedAfterDelete]] = await db.query("SELECT closed_at FROM conversation_polls WHERE id = ?", [single.poll.id]);
    assert.ok(closedAfterDelete.closed_at, "group deletion closes retained polls");
    await db.query("DELETE FROM users WHERE id = ?", [member.id]);
    const [[durableModerationEvidence]] = await db.query("SELECT deleter_reference_id, deleted_by_user_id, original_message_kind, original_sticker_id FROM group_message_moderation_evidence WHERE message_reference_id = ?", [moderatedSticker.id]);
    assert.deepEqual([Number(durableModerationEvidence.deleter_reference_id), durableModerationEvidence.deleted_by_user_id, durableModerationEvidence.original_message_kind, durableModerationEvidence.original_sticker_id], [member.id, null, "sticker", "book-open-v1"], "moderation evidence keeps stable refs when a live deleter account is removed");

    const personal = await user("personal");
    const community = await user("community", { type: "Сообщество" });
    await db.query("INSERT INTO linked_profiles (personal_user_id, community_user_id) VALUES (?, ?)", [personal.id, community.id]);
    const switchOne = await fetch(`${origin}/api/linked-profiles/switch`, { method: "POST", headers: { cookie: personal.cookie, "content-type": "application/json" }, body: "{}" });
    assert.equal(switchOne.status, 200);
    const communityCookie = switchOne.headers.get("set-cookie")?.split(";")[0];
    assert.ok(communityCookie);
    // The switched session is the only newest live one for this personal→community
    // operation; its stored operator must be the factual personal side, not community.
    const [[operatorAfterFirstSwitch]] = await db.query("SELECT operator_user_id FROM sessions WHERE user_id = ? AND operator_user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [community.id]);
    assert.equal(Number(operatorAfterFirstSwitch.operator_user_id), personal.id);
    const switchBack = await fetch(`${origin}/api/linked-profiles/switch`, { method: "POST", headers: { cookie: communityCookie, "content-type": "application/json" }, body: "{}" });
    assert.equal(switchBack.status, 200);
    const [[operatorAfterSecondSwitch]] = await db.query("SELECT operator_user_id FROM sessions WHERE user_id = ? AND operator_user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [personal.id]);
    assert.equal(Number(operatorAfterSecondSwitch.operator_user_id), personal.id, "switching back must retain the factual personal operator rather than inherit a community self-operator");
  } finally {
    await fixture.close();
  }
});

test("A2 group history returns the newest page and an older cursor without crossing a global clear", async () => {
  const fixture = await queue3HttpFixture("a2-group-pages");
  const { db, user, call } = fixture;
  try {
    const owner = await user("owner");
    const member = await user("member");
    await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [Math.min(owner.id, member.id), Math.max(owner.id, member.id)]);
    const group = await call(owner, "POST", "/group-conversations", { name: "History pages", participantIds: [member.id] }, 201);
    const values = Array.from({ length: 205 }, (_, index) => [group.id, owner.id, `message ${index}`]);
    await db.query(`INSERT INTO messages (conversation_id, sender_user_id, body) VALUES ${values.map(() => "(?, ?, ?)").join(", ")}`, values.flat());
    const latest = await call(member, "GET", `/group-conversations/${group.id}/messages`);
    assert.equal(latest.messages.length, 200);
    assert.equal(latest.messages[0].text, "message 5");
    assert.equal(latest.messages.at(-1).text, "message 204");
    assert.equal(latest.nextCursor, latest.messages[0].id);
    const older = await call(member, "GET", `/group-conversations/${group.id}/messages?before=${latest.nextCursor}`);
    assert.deepEqual(older.messages.map((message) => message.text), ["message 0", "message 1", "message 2", "message 3", "message 4"]);
    assert.equal(older.nextCursor, null);
    await call(member, "GET", `/group-conversations/${group.id}/messages?before=invalid`, undefined, 422);
    await call(owner, "POST", `/group-conversations/${group.id}/history/clear`, {});
    assert.deepEqual((await call(member, "GET", `/group-conversations/${group.id}/messages?before=${latest.nextCursor}`)).messages, []);
  } finally {
    await fixture.close();
  }
});
