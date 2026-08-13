import { FormEvent, useMemo, useState } from "react";
import { localizedApiError, useI18n, type Translate } from "../../i18n";
import type { DemoUser, SafetyReport } from "../../types/domain";

function materialPath(report: SafetyReport) {
  const roots: Record<string, string> = { book: "books", review: "reviews", excerpt: "blog", event: "events", occasion: "meet", publisher_news: "publishing" };
  if (report.targetKind === "comment" && report.materialKind && report.materialId) return `/${roots[report.materialKind] ?? ""}/${report.materialId}`;
  if (report.targetKind === "chat") return "";
  return report.targetKind === "user" ? `/users/${report.targetId}` : `/${roots[report.targetKind] ?? ""}/${report.targetId}`;
}

function reportObjectLabel(report: SafetyReport, t: Translate) {
  if (report.targetKind === "user") return t("admin.reportOnUser", { name: report.targetUserName ?? "" });
  if (report.targetKind === "chat") return t("admin.reportOnChat", { name: report.targetUserName ?? t("material.user") });
  if (report.targetKind === "comment") return t("admin.reportOnComment", { name: report.targetUserName ?? "" });
  return t("admin.reportOnMaterial", { title: report.targetTitle ?? t("book.untitled") });
}

export function AdminSafetySection({ mode, reports, users, onBack, onOpenUser, onOpenChat, onRefresh }: {
  mode: "reports-new" | "reports-reviewed" | "users-active" | "users-blocked" | "users-deleted";
  reports: SafetyReport[];
  users: DemoUser[];
  onBack: () => void;
  onOpenUser: (id: number) => void;
  onOpenChat: (id: number) => void;
  onRefresh: () => void;
}) {
  const { t, domainLabel, formatDate, formatNumber } = useI18n();
  const [selected, setSelected] = useState<SafetyReport | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const [days, setDays] = useState(7);
  const [suspensionReason, setSuspensionReason] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const shownReports = reports.filter((item) => item.status === (mode === "reports-new" ? "new" : "reviewed"));
  const shownUsers = useMemo(() => users.filter((user) => !user.isAdmin && (mode === "users-deleted" ? Boolean(user.deletedAt && !user.purged) : !user.deletedAt && !user.purged && (mode === "users-blocked" ? Boolean(user.suspension) : !user.suspension))), [users, mode]);

  async function action(url: string, options: RequestInit = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(localizedApiError(data.error, t("common.actionError")));
    setSelected(null);
    setDeleting(false);
    setSuspending(false);
    onRefresh();
  }

  if (mode === "users-active" || mode === "users-blocked" || mode === "users-deleted") return <div className="admin-safety-page">
    <button className="back-button" type="button" onClick={onBack}>← {t("admin.backToAdmin")}</button>
    <div className="admin-catalog-heading"><div><span className="section-subtitle">{t("admin.users")}</span><h1>{mode === "users-deleted" ? t("admin.deletedUsers") : mode === "users-blocked" ? t("admin.blockedUsers") : t("admin.activeUsers")}</h1><p>{t("admin.profileCount", { count: formatNumber(shownUsers.length) })}</p></div><div className="admin-user-view-toggle"><button className={view === "grid" ? "active" : ""} type="button" onClick={() => setView("grid")}>{t("admin.gridView")}</button><button className={view === "list" ? "active" : ""} type="button" onClick={() => setView("list")}>{t("admin.listView")}</button></div></div>
    <div className={`admin-user-directory ${view}`}>{shownUsers.map((user) => <article key={user.id} onClick={() => onOpenUser(user.id)}><span className={`avatar avatar-sm avatar-${user.color}`}>{user.initials}</span><div><strong data-i18n-skip>{user.profile.name}</strong><p><span>{domainLabel(user.profile.type)}</span> · <span data-i18n-skip>{user.profile.city}</span></p>{user.suspension && <small>{user.suspension.permanent ? t("admin.indefinitely") : t("admin.untilDate", { date: formatDate(user.suspension.until ?? "") })} · <span data-i18n-skip>{user.suspension.reason}</span></small>}{mode === "users-deleted" && <small>{user.purged ? t("admin.deletedPermanently") : t("admin.storedUntil", { date: formatDate(user.deletionExpiresAt ?? "") })}</small>}</div>{user.suspension && <button className="outline-button" type="button" onClick={(event) => { event.stopPropagation(); void action(`/api/admin/users/${user.id}/suspension`, { method: "DELETE" }); }}>{t("admin.unblock")}</button>}{mode === "users-deleted" && !user.purged && <div className="admin-deleted-user-actions"><button className="outline-button" type="button" title={t("admin.restoreProfile")} aria-label={t("admin.restoreProfile")} onClick={(event) => { event.stopPropagation(); void action(`/api/admin/users/${user.id}/restore`, { method: "POST" }); }}>↶</button><button className="quiet-danger-button" type="button" title={t("admin.deletePermanently")} aria-label={t("admin.deletePermanently")} onClick={(event) => { event.stopPropagation(); if (window.confirm(t("admin.deleteProfilePermanentlyConfirm"))) void action(`/api/admin/users/${user.id}/permanent`, { method: "DELETE" }); }}>🗑</button></div>}</article>)}</div>
  </div>;

  return <div className="admin-safety-page">
    <button className="back-button" type="button" onClick={onBack}>← {t("admin.backToAdmin")}</button>
    <div className="profile-title-row"><div><span className="section-subtitle">{t("admin.allReports")}</span><h1>{mode === "reports-new" ? t("admin.newReports") : t("admin.reviewedReports")}</h1><p>{t("admin.reportCount", { count: formatNumber(shownReports.length) })}</p></div></div>
    <div className="admin-report-list">{shownReports.map((report) => <button type="button" key={report.id} onClick={() => setSelected(report)}><span>{t("admin.reportNumber", { id: report.id })}</span><strong data-i18n-skip>{report.reporterName} {reportObjectLabel(report, t)}</strong><small>{formatDate(report.createdAt, { dateStyle: "medium", timeStyle: "short" })}</small></button>)}</div>
    {!shownReports.length && <div className="profile-tab-placeholder">{t("admin.noReports")}</div>}
    {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)}><section className="admin-report-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" type="button" aria-label={t("common.close")} onClick={() => setSelected(null)}>×</button>
      <span className="section-subtitle">{t("admin.reportNumber", { id: selected.id })}</span><h2>{selected.targetKind === "user" ? t("safety.user") : selected.targetKind === "chat" ? t("safety.chat") : selected.targetKind === "comment" ? t("safety.comment") : t("safety.material")}</h2>
      <dl><dt>{t("admin.reporter")}</dt><dd><button type="button" data-i18n-skip onClick={() => onOpenUser(selected.reporterId)}>{selected.reporterName}</button></dd><dt>{t("admin.reportObject")}</dt><dd data-i18n-skip>{selected.targetKind === "chat" ? selected.targetTitle : <a href={materialPath(selected)}>{selected.targetTitle ?? selected.targetUserName ?? t("admin.openMaterial")}</a>}</dd><dt>{t("admin.reportText")}</dt><dd data-i18n-skip>{selected.reason}</dd></dl>
      {selected.targetKind === "comment" && <section className="admin-reported-comment"><strong>{t("admin.userCommentBy", { name: selected.targetUserName ?? "" })}</strong><p data-i18n-skip>{selected.commentText ?? t("admin.commentDeleted")}</p>{selected.materialKind && selected.materialId && <a className="outline-button" href={materialPath(selected)}>{t("admin.goToMaterial")}</a>}</section>}
      {selected.targetKind === "chat" && <section className="admin-reported-conversation"><h3>{t("admin.reportedConversation")}</h3><div>{(selected.conversationMessages ?? []).map((message) => { const sender = users.find((user) => user.id === message.senderId); return <article key={message.id}><strong data-i18n-skip>{sender?.profile.name ?? t("admin.system")}</strong><small>{message.createdAt ? formatDate(message.createdAt, { dateStyle: "medium", timeStyle: "short" }) : message.time}</small><p data-i18n-skip>{message.text}</p></article>; })}{!(selected.conversationMessages ?? []).length && <p>{t("admin.noConversationMessages")}</p>}</div></section>}
      {selected.status === "new" && <div className="admin-event-actions"><button className="outline-button" type="button" onClick={() => selected.targetUserId && onOpenChat(selected.targetUserId)}>{t("admin.messageUser")}</button>{selected.targetKind === "user" ? <button className="danger-button" type="button" onClick={() => setSuspending(true)}>{t("admin.block")}</button> : !["chat", "comment"].includes(selected.targetKind) ? <button className="danger-button" type="button" onClick={() => setDeleting(true)}>{t("admin.deleteMaterial")}</button> : null}<button className="primary-button" type="button" onClick={() => void action(`/api/admin/reports/${selected.id}/processed`, { method: "PATCH" })}>{t("admin.processed")}</button></div>}
    </section></div>}
    {deleting && selected && <div className="nested-modal-backdrop" onMouseDown={() => setDeleting(false)}><form className="safety-action-modal" onSubmit={(event) => { event.preventDefault(); void action(`/api/admin/reports/${selected.id}/delete-material`, { method: "POST", body: JSON.stringify({ reason: deleteReason }) }); }} onMouseDown={(event) => event.stopPropagation()}><h2>{t("admin.deleteMaterial")}</h2><label>{t("admin.deleteReason")}<textarea required rows={5} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} /></label><div className="form-actions"><button className="danger-button" type="submit">{t("common.delete")}</button><button className="outline-button" type="button" onClick={() => setDeleting(false)}>{t("common.cancel")}</button></div></form></div>}
    {suspending && selected && <div className="nested-modal-backdrop" onMouseDown={() => setSuspending(false)}><form className="safety-action-modal" onSubmit={(event: FormEvent) => { event.preventDefault(); void action(`/api/admin/users/${selected.targetId}/suspension`, { method: "POST", body: JSON.stringify({ permanent, days, reason: suspensionReason, reportId: selected.id }) }); }} onMouseDown={(event) => event.stopPropagation()}><h2>{t("admin.blockUser")}</h2><div className="suspension-mode"><button className={!permanent ? "active" : ""} type="button" onClick={() => setPermanent(false)}>{t("admin.temporarily")}</button><button className={permanent ? "active" : ""} type="button" onClick={() => setPermanent(true)}>{t("admin.forever")}</button></div>{!permanent && <label>{t("admin.daysCount")}<input type="number" min={1} max={3650} value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>}<label>{t("admin.blockReason")}<textarea required rows={5} value={suspensionReason} onChange={(event) => setSuspensionReason(event.target.value)} /></label><div className="form-actions"><button className="danger-button" type="submit">{t("admin.block")}</button><button className="outline-button" type="button" onClick={() => setSuspending(false)}>{t("common.cancel")}</button></div></form></div>}
  </div>;
}
