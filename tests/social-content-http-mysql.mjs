import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

test("TZ4 social content: real HTTP privacy, comments, mentions and repost lifecycle", async (t) => {
  const fixture = await queue3HttpFixture("q4-social");
  const { db, user, book, call } = fixture;
  try {
    const source = await user("source");
    const viewer = await user("viewer");
    const replier = await user("replier");
    const mentioned = await user("mentioned");
    const catalogBookId = await book("source-book");
    const mentionedToken = "@q4-social-mentioned";
    const reviewPayload = {
      bookId: catalogBookId,
      rating: 4.5,
      preview: `Совет для ${mentionedToken}`,
      bodyHtml: "<p>Полный текст рецензии</p>",
      mentions: [{ userId: mentioned.id, token: mentionedToken }],
    };
    const review = await call(source, "POST", "/reviews", reviewPayload, 201);
    const reviewId = Number(review.id);

    await t.test("hide is one-way and does not remove relationships, messages or notifications", async () => {
      const low = Math.min(source.id, viewer.id);
      const high = Math.max(source.id, viewer.id);
      await db.query("INSERT INTO friendships (user_low_id, user_high_id) VALUES (?, ?)", [low, high]);
      await db.query("INSERT INTO messages (sender_user_id, recipient_user_id, body) VALUES (?, ?, 'message survives hide')", [source.id, viewer.id]);
      await db.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body) VALUES (?, ?, 'follow', 'hide test', 'notification survives hide')", [viewer.id, source.id]);

      await call(viewer, "POST", `/users/${source.id}/hide`, {}, 201);
      const viewerCatalog = await call(viewer, "GET", "/bootstrap/catalog");
      const sourceForViewer = viewerCatalog.users.find((entry) => entry.id === source.id);
      assert.ok(sourceForViewer, "the hidden profile remains addressable as an entity");
      assert.equal(sourceForViewer.hiddenByMe, true);
      assert.deepEqual(sourceForViewer.reviews, []);

      const viewerSocial = await call(viewer, "GET", "/bootstrap/social");
      assert.ok(viewerSocial.friendships.some((entry) => [entry.userA, entry.userB].includes(source.id)));
      assert.ok(Object.values(viewerSocial.messages).flat().some((entry) => entry.text === "message survives hide"));
      assert.ok(viewerSocial.notifications.some((entry) => entry.text === "notification survives hide"));

      const sourceCatalog = await call(source, "GET", "/bootstrap/catalog");
      assert.equal(sourceCatalog.users.find((entry) => entry.id === viewer.id)?.hiddenByMe, false);
      await call(viewer, "DELETE", `/users/${source.id}/hide`);
    });

    let rootId;
    let addressedReplyId;
    await t.test("reply depth, pages of three and comment likes are authoritative", async () => {
      rootId = Number((await call(viewer, "POST", "/comments", { materialKind: "review", materialId: reviewId, body: "Корневой комментарий" }, 201)).comment.id);
      const directReplies = [];
      for (let index = 0; index < 5; index += 1) {
        const created = await call(replier, "POST", "/comments", { materialKind: "review", materialId: reviewId, body: `Ответ ${index + 1}`, parentCommentId: rootId }, 201);
        directReplies.push(Number(created.comment.id));
      }
      const addressed = await call(source, "POST", "/comments", { materialKind: "review", materialId: reviewId, body: "Ответ на ответ", parentCommentId: directReplies[0], replyToCommentId: directReplies[0] }, 201);
      addressedReplyId = Number(addressed.comment.id);
      assert.equal(addressed.comment.parentCommentId, rootId, "a reply to a reply stays under the root");
      assert.equal(addressed.comment.replyToCommentId, directReplies[0]);
      assert.match(addressed.comment.text, /^@q4-social-replier\s/);

      const initial = await call(source, "GET", `/comments?kind=review&id=${reviewId}`);
      const root = initial.comments.find((entry) => entry.id === rootId);
      assert.equal(root.replyCount, 6);
      const firstReplyPage = initial.comments.filter((entry) => entry.parentCommentId === rootId);
      assert.equal(firstReplyPage.length, 3);
      const next = await call(source, "GET", `/comments?kind=review&id=${reviewId}&rootId=${rootId}&cursor=${firstReplyPage.at(-1).id}`);
      assert.equal(next.comments.length, 3);
      assert.equal(new Set([...firstReplyPage, ...next.comments].map((entry) => entry.id)).size, 6);

      await call(source, "POST", `/comments/${addressedReplyId}/like`, {}, 201);
      await call(source, "POST", `/comments/${addressedReplyId}/like`, {}, 201);
      let [[likeCount]] = await db.query("SELECT COUNT(*) AS total FROM material_comment_likes WHERE comment_id = ? AND user_id = ?", [addressedReplyId, source.id]);
      assert.equal(Number(likeCount.total), 1);
      await call(source, "DELETE", `/comments/${addressedReplyId}/like`);
      await call(source, "DELETE", `/comments/${addressedReplyId}/like`);
      [[likeCount]] = await db.query("SELECT COUNT(*) AS total FROM material_comment_likes WHERE comment_id = ? AND user_id = ?", [addressedReplyId, source.id]);
      assert.equal(Number(likeCount.total), 0);

      await call(source, "POST", `/users/${viewer.id}/hide`, {}, 201);
      const redacted = await call(source, "GET", `/comments?kind=review&id=${reviewId}`);
      const hiddenRoot = redacted.comments.find((entry) => entry.id === rootId);
      assert.equal(hiddenRoot.deleted, true);
      assert.equal(hiddenRoot.text, "Комментарий скрыт");
      assert.equal(hiddenRoot.author, undefined);
      await call(source, "DELETE", `/users/${viewer.id}/hide`);
    });

    await t.test("mention ids survive rename, repeat save is deduplicated and unavailable DTO is neutral", async () => {
      let [[mentionCount]] = await db.query("SELECT COUNT(*) AS total FROM content_mentions WHERE entity_type = 'review' AND entity_id = ? AND mentioned_user_id = ?", [reviewId, mentioned.id]);
      assert.equal(Number(mentionCount.total), 1);
      let [[notificationCount]] = await db.query("SELECT COUNT(*) AS total FROM notifications WHERE group_key = ?", [`mention:review:${reviewId}:${mentioned.id}`]);
      assert.equal(Number(notificationCount.total), 1);

      await db.query("UPDATE users SET username = 'q4-social-renamed', username_key = 'q4-social-renamed' WHERE id = ?", [mentioned.id]);
      await call(source, "PATCH", `/reviews/${reviewId}`, reviewPayload);
      [[mentionCount]] = await db.query("SELECT COUNT(*) AS total FROM content_mentions WHERE entity_type = 'review' AND entity_id = ? AND mentioned_user_id = ?", [reviewId, mentioned.id]);
      [[notificationCount]] = await db.query("SELECT COUNT(*) AS total FROM notifications WHERE group_key = ?", [`mention:review:${reviewId}:${mentioned.id}`]);
      assert.equal(Number(mentionCount.total), 1);
      assert.equal(Number(notificationCount.total), 1);

      const visible = await call(replier, "GET", "/bootstrap/catalog");
      const visibleReview = visible.users.find((entry) => entry.id === source.id).reviews.find((entry) => entry.id === reviewId);
      assert.equal(visibleReview.mentions[0].username, "q4-social-renamed");
      assert.equal(visibleReview.mentions[0].userId, mentioned.id);

      await call(replier, "POST", `/users/${mentioned.id}/hide`, {}, 201);
      const neutral = await call(replier, "GET", "/bootstrap/catalog");
      const neutralReview = neutral.users.find((entry) => entry.id === source.id).reviews.find((entry) => entry.id === reviewId);
      const serialized = JSON.stringify(neutralReview);
      assert.match(neutralReview.preview, /@пользователь/);
      assert.equal(neutralReview.mentions[0].username, undefined);
      assert.equal(neutralReview.mentions[0].token, "@пользователь");
      assert.doesNotMatch(serialized, /q4-social-mentioned/);
      await call(replier, "DELETE", `/users/${mentioned.id}/hide`);
    });

    await t.test("clean and text reposts keep distinct public lifecycles", async () => {
      const clean = await call(viewer, "POST", `/materials/review/${reviewId}/repost`, {}, 201);
      assert.equal(clean.repost.clean, true);
      await call(viewer, "POST", `/materials/review/${reviewId}/repost`, {}, 409);

      await call(viewer, "POST", `/users/${source.id}/hide`, {}, 201);
      let catalog = await call(viewer, "GET", "/bootstrap/catalog");
      let cleanDto = catalog.users.find((entry) => entry.id === viewer.id).cleanReposts.find((entry) => entry.id === clean.repost.id);
      assert.deepEqual(Object.keys(cleanDto.source).sort(), ["available", "label"]);
      assert.equal(cleanDto.source.available, false);
      await call(viewer, "DELETE", `/users/${source.id}/hide`);

      const text = await call(replier, "POST", `/materials/review/${reviewId}/repost`, { text: "Мой самостоятельный текст" }, 201);
      assert.equal(text.repost.clean, false);
      assert.equal(Object.hasOwn(text.repost.material, "source"), false);
      const textMaterialId = Number(text.repost.material.id);
      const [[storedText]] = await db.query("SELECT provenance_repost_id FROM excerpts WHERE id = ?", [textMaterialId]);
      assert.equal(Number(storedText.provenance_repost_id), Number(text.repost.id));
      await call(replier, "POST", `/materials/excerpt/${textMaterialId}/repost`, {}, 409);
      catalog = await call(replier, "GET", "/bootstrap/catalog");
      const publicText = catalog.users.find((entry) => entry.id === replier.id).excerpts.find((entry) => entry.id === textMaterialId);
      assert.equal(Object.hasOwn(publicText, "provenanceRepostId"), false);
      assert.doesNotMatch(JSON.stringify(publicText), /provenance_repost/i);
      await call(replier, "DELETE", `/materials/excerpt/${textMaterialId}`);
      const [[orphan]] = await db.query("SELECT COUNT(*) AS total FROM reposts WHERE id = ?", [text.repost.id]);
      assert.equal(Number(orphan.total), 0);

      await call(source, "DELETE", `/materials/review/${reviewId}`);
      catalog = await call(viewer, "GET", "/bootstrap/catalog");
      cleanDto = catalog.users.find((entry) => entry.id === viewer.id).cleanReposts.find((entry) => entry.id === clean.repost.id);
      assert.deepEqual(Object.keys(cleanDto.source).sort(), ["available", "label"]);
      assert.equal(cleanDto.source.available, false);
      await call(viewer, "DELETE", `/reposts/${clean.repost.id}`);
    });
  } finally {
    await fixture.close();
  }
});
