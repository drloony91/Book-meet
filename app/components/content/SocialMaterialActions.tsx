import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { apiFetch } from "../../services/api";
import type { CleanRepost, MentionRef } from "../../types/domain";
import { MentionTextarea } from "./MentionTextarea";

export type RepostableMaterialKind = "review" | "excerpt" | "publisher_news" | "event" | "occasion" | "shelf";

export function RepostAction({ kind, materialId, disabled = false, repostCount = 0 }: { kind: RepostableMaterialKind; materialId: number; disabled?: boolean; repostCount?: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <><button className="material-repost-action" type="button" disabled={disabled} aria-label={t("repost.action")} title={t("repost.action")} onClick={() => setOpen(true)}><span aria-hidden="true">↗</span><b>{Math.max(0, repostCount)}</b><span className="material-repost-label">{t("repost.action")}</span></button>{open && <RepostDialog kind={kind} materialId={materialId} onClose={() => setOpen(false)} />}</>;
}

export function RepostDialog({ kind, materialId, onClose }: { kind: RepostableMaterialKind; materialId: number; onClose: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"clean" | "text">("clean");
  const [text, setText] = useState("");
  const [mentionUserIds, setMentionUserIds] = useState<number[]>([]);
  const [mentionRefs, setMentionRefs] = useState<MentionRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || mode === "text" && !text.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/materials/${kind}/${materialId}/repost`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(mode === "clean" ? {} : { text, mentions: mentionRefs.length ? mentionRefs : mentionUserIds }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || t("repost.error"));
      window.dispatchEvent(new Event("bookmeet:bootstrap-refresh"));
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("repost.error")); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="nested-modal-backdrop repost-dialog-backdrop" onMouseDown={onClose}><section className="confirm-social-modal repost-dialog" role="dialog" aria-modal="true" aria-labelledby="repost-dialog-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label={t("common.close")} onClick={onClose}>×</button><h2 id="repost-dialog-title">{t("repost.title")}</h2><div className="repost-mode" role="group" aria-label={t("repost.title")}><button type="button" className={mode === "clean" ? "active" : ""} aria-pressed={mode === "clean"} onClick={() => setMode("clean")}>{t("repost.clean")}</button><button type="button" className={mode === "text" ? "active" : ""} aria-pressed={mode === "text"} onClick={() => setMode("text")}>{t("repost.withText")}</button></div><form onSubmit={submit}>{mode === "clean" ? <p>{t("repost.cleanHint")}</p> : <label>{t("repost.text")}<MentionTextarea rows={4} maxLength={3000} value={text} onChange={(event) => setText(event.target.value)} mentionUserIds={mentionUserIds} onMentionUserIdsChange={setMentionUserIds} mentionRefs={mentionRefs} onMentionRefsChange={setMentionRefs} /></label>}{error && <p role="alert" className="form-error">{error}</p>}<div className="form-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busy || mode === "text" && !text.trim()}>{busy ? t("auth.saving") : t("repost.submit")}</button></div></form></section></div>, document.body);
}

export function HideUserAction({ userId, hidden = false, icon = false, onHidden }: { userId: number; hidden?: boolean; icon?: boolean; onHidden?: () => void }) {
  const { t } = useI18n(); const [busy, setBusy] = useState(false);
  const label = t(hidden ? "hide.restore" : "hide.action");
  const hide = async () => {
    if (busy || !hidden && !window.confirm(t("hide.confirm"))) return;
    setBusy(true);
    try {
      const response = await apiFetch(`/api/users/${userId}/hide`, { method: hidden ? "DELETE" : "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error();
      window.dispatchEvent(new Event("bookmeet:bootstrap-refresh")); onHidden?.();
    } finally { setBusy(false); }
  };
  return <button className={icon ? "modal-tool-button modal-report-button public-profile-block-button" : "outline-button hide-user-action"} type="button" disabled={busy} aria-label={label} title={label} onClick={() => void hide()}>{icon ? <span aria-hidden="true">{hidden ? "↶" : "◉"}</span> : label}</button>;
}

function sourcePath(kind: string, id: number) {
  const base: Record<string, string> = { review: "/reviews", excerpt: "/blog", publisher_news: "/publishing", event: "/events", occasion: "/meet", shelf: "/shelves" };
  return base[kind] ? `${base[kind]}/${id}` : null;
}

export function CleanRepostCard({ repost, own, onDeleted }: { repost: CleanRepost; own: boolean; onDeleted?: () => void }) {
  const { t, formatDate } = useI18n(); const [busy, setBusy] = useState(false); const [removed, setRemoved] = useState(false);
  if (removed) return null;
  const source = repost.source; const href = source.available ? sourcePath(source.kind, source.id) : null;
  const remove = async () => {
    if (busy || !window.confirm(t("repost.deleteConfirm"))) return;
    setBusy(true);
    try { const response = await apiFetch(`/api/reposts/${repost.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) throw new Error(); setRemoved(true); window.dispatchEvent(new Event("bookmeet:bootstrap-refresh")); onDeleted?.(); } finally { setBusy(false); }
  };
  return <article className="clean-repost-card"><span className="section-subtitle">{t("repost.clean")}</span><time>{formatDate(repost.createdAt, { day: "2-digit", month: "2-digit", year: "numeric" })}</time>{source.available && href ? <button type="button" className="clean-repost-source" data-i18n-skip onClick={() => window.location.assign(href)}>{source.title}</button> : <p>{t("repost.unavailable")}</p>}{own && <button className="quiet-danger-button" type="button" disabled={busy} onClick={() => void remove()}>{t("common.delete")}</button>}</article>;
}

type HiddenUser = { id: number; displayName: string; username: string; initials: string; color: string; avatarUrl?: string; hiddenAt: string };
export function HiddenUsersPanel() {
  const { t, formatDate } = useI18n(); const [users, setUsers] = useState<HiddenUser[]>([]); const [cursor, setCursor] = useState<number | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = async (next: number | null) => { setLoading(true); setError(""); try { const response = await apiFetch(`/api/users/me/hidden-users${next === null ? "" : `?cursor=${next}`}`, { credentials: "same-origin", cache: "no-store" }); const data = await response.json() as { users?: HiddenUser[]; nextCursor?: number | null; error?: string }; if (!response.ok || !Array.isArray(data.users)) throw new Error(data.error || t("hide.loadError")); setUsers((current) => next === null ? data.users! : [...current, ...data.users!.filter((entry) => !current.some((known) => known.id === entry.id))]); setCursor(data.nextCursor ?? null); } catch (cause) { setError(cause instanceof Error ? cause.message : t("hide.loadError")); } finally { setLoading(false); } };
  useEffect(() => { void load(null); }, []);
  const unhide = async (id: number) => { const response = await apiFetch(`/api/users/${id}/hide`, { method: "DELETE", credentials: "same-origin" }); if (response.ok) { setUsers((current) => current.filter((entry) => entry.id !== id)); window.dispatchEvent(new Event("bookmeet:bootstrap-refresh")); } };
  return <section className="profile-edit-settings-section hidden-users-settings"><h2>{t("hide.title")}</h2>{loading && !users.length ? <p role="status">{t("common.loading")}</p> : users.length ? <div className="hidden-user-list">{users.map((user) => <article key={user.id}><span className={`avatar avatar-sm avatar-${user.color} ${user.avatarUrl ? "has-photo" : ""}`} style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}>{!user.avatarUrl && user.initials}</span><span><strong data-i18n-skip>{user.displayName}</strong><small data-i18n-skip>@{user.username}</small><time>{t("hide.hiddenAt", { date: formatDate(user.hiddenAt, { day: "2-digit", month: "2-digit", year: "numeric" }) })}</time></span><button className="outline-button" type="button" onClick={() => void unhide(user.id)}>{t("hide.restore")}</button></article>)}</div> : <p>{t("hide.empty")}</p>}{error && <p role="alert" className="form-error">{error}</p>}{cursor !== null && <button className="outline-button" type="button" disabled={loading} onClick={() => void load(cursor)}>{t("feed.loadMore")}</button>}</section>;
}
