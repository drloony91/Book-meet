import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../services/api";
import { useI18n } from "../../i18n";
import type { DemoUser, MaterialComment, MentionRef } from "../../types/domain";
import { openReportDialog } from "../safety/SafetyCenter";
import { MentionTextarea } from "./MentionTextarea";
import { MentionText } from "./MentionText";

type MaterialKind = "review" | "excerpt" | "event" | "occasion" | "publisher_news" | "shelf";
const EMOJI = ["😀", "😍", "📚", "👍", "✨", "😢", "🤔", "🎉"];

export function SocialComments({ kind, materialId, currentUser, users, onOpenUser, onCountChange }: { kind: MaterialKind; materialId: number; currentUser?: DemoUser; users: DemoUser[]; onOpenUser?: (id: number) => void; onCountChange?: (count: number) => void }) {
  const { t, locale } = useI18n();
  const [comments, setComments] = useState<MaterialComment[]>([]);
  const [replyTo, setReplyTo] = useState<MaterialComment | null>(null);
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionUserIds, setMentionUserIds] = useState<number[]>([]);
  const [mentionRefs, setMentionRefs] = useState<MentionRef[]>([]);
  const [replyCursors, setReplyCursors] = useState<Record<number, number | null>>({});
  const [editing, setEditing] = useState<MaterialComment | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    const response = await apiFetch(`/api/comments?kind=${kind}&id=${materialId}`, { credentials: "same-origin", cache: "no-store" });
    const data = await response.json() as { comments?: MaterialComment[] };
    if (response.ok) setComments(data.comments ?? []);
  };
  useEffect(() => { void load(); }, [kind, materialId]);
  useEffect(() => { onCountChange?.(comments.length); }, [comments.length, onCountChange]);
  const roots = useMemo(() => comments.filter((comment) => !comment.parentCommentId), [comments]);
  const replies = (rootId: number) => comments.filter((comment) => comment.parentCommentId === rootId);
  const insertEmoji = (emoji: string) => {
    const node = inputRef.current; const start = node?.selectionStart ?? text.length; const end = node?.selectionEnd ?? start;
    setText(`${text.slice(0, start)}${emoji}${text.slice(end)}`); setEmojiOpen(false);
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(start + emoji.length, start + emoji.length); });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!text.trim() || Array.from(text).length > 3000 || busy) return;
    setBusy(true);
    try {
      const response = await apiFetch(editing ? `/api/comments/${editing.id}` : "/api/comments", { method: editing ? "PATCH" : "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(editing ? { body: text, mentions: mentionRefs.length ? mentionRefs : mentionUserIds } : { materialKind: kind, materialId, body: text, parentCommentId: replyTo?.parentCommentId ?? replyTo?.id, replyToCommentId: replyTo?.id, mentions: mentionRefs.length ? mentionRefs : mentionUserIds }) });
      if (response.ok) { setText(""); setReplyTo(null); setEditing(null); setMentionUserIds([]); setMentionRefs([]); await load(); }
    } finally { setBusy(false); }
  };
  const loadReplies = async (root: MaterialComment) => {
    const seen = replies(root.id);
    const hasCursor = Object.prototype.hasOwnProperty.call(replyCursors, root.id);
    const cursor = hasCursor ? replyCursors[root.id] ?? 0 : seen.at(-1)?.id ?? 0;
    const response = await apiFetch(`/api/comments?kind=${kind}&id=${materialId}&rootId=${root.id}&cursor=${cursor}`, { credentials: "same-origin" });
    const data = await response.json() as { comments?: MaterialComment[]; nextCursor?: number | null };
    if (response.ok) { setComments((current) => [...current.filter((item) => !data.comments?.some((next) => next.id === item.id)), ...(data.comments ?? [])]); setReplyCursors((current) => ({ ...current, [root.id]: data.nextCursor ?? null })); }
  };
  const remove = async (comment: MaterialComment) => {
    const response = await apiFetch(`/api/comments/${comment.id}`, { method: "DELETE", credentials: "same-origin" });
    const data = await response.json().catch(() => ({})) as { comment?: MaterialComment & { removed?: boolean } };
    if (response.ok && data.comment?.removed) setComments((current) => current.filter((item) => item.id !== comment.id));
    else if (response.ok) await load();
  };
  const toggleLike = async (comment: MaterialComment) => {
    const response = await apiFetch(`/api/comments/${comment.id}/like`, { method: comment.likedByViewer ? "DELETE" : "POST", credentials: "same-origin" });
    if (response.ok) setComments((current) => current.map((item) => item.id === comment.id ? { ...item, likedByViewer: !item.likedByViewer, likeCount: Math.max(0, (item.likeCount ?? 0) + (item.likedByViewer ? -1 : 1)) } : item));
  };
  const author = (comment: MaterialComment) => comment.author ?? (() => { const user = users.find((entry) => entry.id === comment.userId); return user ? { displayName: user.profile.name, username: user.username, initials: user.initials, color: user.color, avatarUrl: user.avatarUrl } : undefined; })();
  const card = (comment: MaterialComment, nested = false) => {
    const person = author(comment); const owner = currentUser && (currentUser.id === comment.userId || currentUser.isAdmin);
    return <article className={nested ? "comment-reply" : "comment-root"} key={comment.id}>
      {comment.deleted ? <p>{t("comments.hidden")}</p> : <>
        <button className={`avatar avatar-sm avatar-${person?.color ?? "gray"}`} type="button" aria-label={person?.displayName ?? t("material.user")} onClick={() => onOpenUser?.(comment.userId)}>{person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : person?.initials}</button>
        <span className="comment-author"><button type="button" onClick={() => onOpenUser?.(comment.userId)}>{person?.displayName ?? t("material.user")}</button>{person?.username && <span>@{person.username}</span>}<time>{new Intl.DateTimeFormat(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(comment.createdAt))}</time></span>
        <p><MentionText text={comment.text} mentions={comment.mentions} onOpenUser={onOpenUser} /></p>
        <div className="comment-actions"><button type="button" onClick={() => { setEditing(null); setReplyTo(comment); setText(""); setMentionUserIds([]); setMentionRefs([]); inputRef.current?.focus(); }}>{t("comments.reply")}</button><button type="button" aria-pressed={Boolean(comment.likedByViewer)} onClick={() => void toggleLike(comment)}>{t("material.like")} · {comment.likeCount ?? 0}</button>{owner && <><button type="button" onClick={() => { setReplyTo(null); setEditing(comment); setText(comment.text); setMentionUserIds([]); setMentionRefs(comment.mentions ?? []); inputRef.current?.focus(); }}>{t("common.edit")}</button><button type="button" onClick={() => void remove(comment)}>{t("material.deleteComment")}</button></>}{!owner && currentUser && <><button type="button" onClick={() => openReportDialog({ kind: "comment", id: comment.id })}>{t("safety.report")}</button><button type="button" aria-label={t("comments.hideUser")} onClick={async () => { if (!window.confirm(t("comments.hideUserConfirm"))) return; const response = await apiFetch(`/api/users/${comment.userId}/hide`, { method: "POST", credentials: "same-origin" }); if (response.ok) { window.dispatchEvent(new Event("bookmeet:bootstrap-refresh")); await load(); } }}>{t("comments.hideUser")}</button></>}</div>
      </>}
    </article>;
  };
  const codePointLength = Array.from(text).length;
  const collapseReplies = (rootId: number) => {
    const firstPage = replies(rootId).slice(0, 3);
    setComments((current) => current.filter((item) => item.parentCommentId !== rootId || firstPage.some((keep) => keep.id === item.id)));
    setReplyCursors((current) => ({ ...current, [rootId]: firstPage.at(-1)?.id ?? null }));
  };

  return (
    <section className="comments-block social-comments">
      <h3>{t("content.comments")}</h3>
      {currentUser && (
        <form onSubmit={save}>
          {(replyTo || editing) && <p className="replying-to">{editing ? t("common.edit") : t("comments.replyingTo")} <button type="button" onClick={() => { setReplyTo(null); setEditing(null); setText(""); setMentionUserIds([]); }}>{t("common.cancel")}</button></p>}
          <MentionTextarea ref={inputRef} rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder={t("material.writeComment")} mentionUserIds={mentionUserIds} onMentionUserIdsChange={setMentionUserIds} mentionRefs={mentionRefs} onMentionRefsChange={setMentionRefs} aria-invalid={codePointLength > 3000} />
          <div className="comment-composer-actions">
            <small aria-live="polite">{codePointLength}/3000{codePointLength > 3000 ? ` — ${t("comments.tooLong")}` : ""}</small>
            <div className="emoji-picker">
              <button type="button" aria-expanded={emojiOpen} aria-label={t("comments.emoji")} onClick={() => setEmojiOpen((open) => !open)}>☺</button>
              {emojiOpen && <div role="dialog" aria-label={t("comments.emoji")}><div>{EMOJI.map((emoji) => <button type="button" key={emoji} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div></div>}
            </div>
            <button className="primary-button" type="submit" disabled={busy || !text.trim() || codePointLength > 3000}>{t("common.send")}</button>
          </div>
        </form>
      )}
      {roots.map((root) => {
        const visibleReplies = replies(root.id);
        const hasCursor = Object.prototype.hasOwnProperty.call(replyCursors, root.id);
        const nextCursor = hasCursor ? replyCursors[root.id] : root.nextRepliesCursor ?? null;
        return <div className="comment-thread" key={root.id}>
          {card(root)}
          <div className="comment-replies">
            {visibleReplies.map((reply) => card(reply, true))}
            {nextCursor != null && <button type="button" onClick={() => void loadReplies(root)}>{t("comments.moreReplies")}</button>}
            {visibleReplies.length > 3 && <button type="button" onClick={() => collapseReplies(root.id)}>{t("comments.collapseReplies")}</button>}
          </div>
        </div>;
      })}
    </section>
  );
}
