import { FormEvent, useMemo, useState } from "react";
import type { DemoUser, SafetyReport } from "../../types/domain";

function materialPath(report: SafetyReport) {
  const roots: Record<string, string> = { book: "books", review: "reviews", excerpt: "blog", event: "events", occasion: "meet", publisher_news: "publishing" };
  if (report.targetKind === "comment" && report.materialKind && report.materialId) return `/${roots[report.materialKind] ?? ""}/${report.materialId}`;
  if (report.targetKind === "chat") return "";
  return report.targetKind === "user" ? `/users/${report.targetId}` : `/${roots[report.targetKind] ?? ""}/${report.targetId}`;
}

function reportObjectLabel(report: SafetyReport) {
  if (report.targetKind === "user") return `на пользователя ${report.targetUserName ?? ""}`;
  if (report.targetKind === "chat") return `на диалог с ${report.targetUserName ?? "пользователем"}`;
  if (report.targetKind === "comment") return `на комментарий пользователя ${report.targetUserName ?? ""}`;
  return `на материал «${report.targetTitle ?? "Без названия"}»`;
}

export function AdminSafetySection({ mode, reports, users, onBack, onOpenUser, onOpenChat, onRefresh }: {
  mode: "reports-new" | "reports-reviewed" | "users-active" | "users-blocked";
  reports: SafetyReport[];
  users: DemoUser[];
  onBack: () => void;
  onOpenUser: (id: number) => void;
  onOpenChat: (id: number) => void;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<SafetyReport | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const [days, setDays] = useState(7);
  const [suspensionReason, setSuspensionReason] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const shownReports = reports.filter((item) => item.status === (mode === "reports-new" ? "new" : "reviewed"));
  const shownUsers = useMemo(() => users.filter((user) => !user.isAdmin && (mode === "users-blocked" ? Boolean(user.suspension) : !user.suspension)), [users, mode]);

  async function action(url: string, options: RequestInit = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие");
    setSelected(null);
    setDeleting(false);
    setSuspending(false);
    onRefresh();
  }

  if (mode === "users-active" || mode === "users-blocked") return <div className="admin-safety-page">
    <button className="back-button" type="button" onClick={onBack}>← В админку</button>
    <div className="admin-catalog-heading"><div><span className="section-subtitle">Пользователи</span><h1>{mode === "users-blocked" ? "Заблокированные пользователи" : "Активные пользователи"}</h1><p>{shownUsers.length} профилей</p></div><div className="admin-user-view-toggle"><button className={view === "grid" ? "active" : ""} type="button" onClick={() => setView("grid")}>Плитка</button><button className={view === "list" ? "active" : ""} type="button" onClick={() => setView("list")}>Список</button></div></div>
    <div className={`admin-user-directory ${view}`}>{shownUsers.map((user) => <article key={user.id} onClick={() => onOpenUser(user.id)}><span className={`avatar avatar-sm avatar-${user.color}`}>{user.initials}</span><div><strong>{user.profile.name}</strong><p>{user.profile.type} · {user.profile.city}</p>{user.suspension && <small>{user.suspension.permanent ? "Бессрочно" : `До ${new Date(user.suspension.until ?? "").toLocaleDateString("ru-RU")}`} · {user.suspension.reason}</small>}</div>{user.suspension && <button className="outline-button" type="button" onClick={(event) => { event.stopPropagation(); void action(`/api/admin/users/${user.id}/suspension`, { method: "DELETE" }); }}>Разблокировать</button>}</article>)}</div>
  </div>;

  return <div className="admin-safety-page">
    <button className="back-button" type="button" onClick={onBack}>← В админку</button>
    <div className="profile-title-row"><div><span className="section-subtitle">Все жалобы</span><h1>{mode === "reports-new" ? "Новые жалобы" : "Просмотренные жалобы"}</h1><p>{shownReports.length} жалоб</p></div></div>
    <div className="admin-report-list">{shownReports.map((report) => <button type="button" key={report.id} onClick={() => setSelected(report)}><span>Жалоба № {report.id}</span><strong>{report.reporterName} пожаловался(ась) {reportObjectLabel(report)}</strong><small>{new Date(report.createdAt).toLocaleString("ru-RU")}</small></button>)}</div>
    {!shownReports.length && <div className="profile-tab-placeholder">В этом разделе жалоб нет.</div>}
    {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)}><section className="admin-report-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" type="button" onClick={() => setSelected(null)}>×</button>
      <span className="section-subtitle">Жалоба № {selected.id}</span><h2>{selected.targetKind === "user" ? "Жалоба на пользователя" : selected.targetKind === "chat" ? "Жалоба на диалог" : selected.targetKind === "comment" ? "Жалоба на комментарий" : "Жалоба на материал"}</h2>
      <dl><dt>Пожаловался</dt><dd><button type="button" onClick={() => onOpenUser(selected.reporterId)}>{selected.reporterName}</button></dd><dt>Объект жалобы</dt><dd>{selected.targetKind === "chat" ? selected.targetTitle : <a href={materialPath(selected)}>{selected.targetTitle ?? selected.targetUserName ?? "Открыть материал"}</a>}</dd><dt>Текст жалобы</dt><dd>{selected.reason}</dd></dl>
      {selected.targetKind === "comment" && <section className="admin-reported-comment"><strong>Комментарий пользователя {selected.targetUserName}</strong><p>{selected.commentText ?? "Комментарий был удалён."}</p>{selected.materialKind && selected.materialId && <a className="outline-button" href={materialPath(selected)}>Перейти к материалу</a>}</section>}
      {selected.targetKind === "chat" && <section className="admin-reported-conversation"><h3>Диалог на момент жалобы</h3><div>{(selected.conversationMessages ?? []).map((message) => { const sender = users.find((user) => user.id === message.senderId); return <article key={message.id}><strong>{sender?.profile.name ?? "Система"}</strong><small>{message.createdAt ? new Date(message.createdAt).toLocaleString("ru-RU") : message.time}</small><p>{message.text}</p></article>; })}{!(selected.conversationMessages ?? []).length && <p>В диалоге нет сообщений.</p>}</div></section>}
      {selected.status === "new" && <div className="admin-event-actions"><button className="outline-button" type="button" onClick={() => selected.targetUserId && onOpenChat(selected.targetUserId)}>Написать пользователю</button>{selected.targetKind === "user" ? <button className="danger-button" type="button" onClick={() => setSuspending(true)}>Заблокировать</button> : !["chat", "comment"].includes(selected.targetKind) ? <button className="danger-button" type="button" onClick={() => setDeleting(true)}>Удалить материал</button> : null}<button className="primary-button" type="button" onClick={() => void action(`/api/admin/reports/${selected.id}/processed`, { method: "PATCH" })}>Обработано</button></div>}
    </section></div>}
    {deleting && selected && <div className="nested-modal-backdrop" onMouseDown={() => setDeleting(false)}><form className="safety-action-modal" onSubmit={(event) => { event.preventDefault(); void action(`/api/admin/reports/${selected.id}/delete-material`, { method: "POST", body: JSON.stringify({ reason: deleteReason }) }); }} onMouseDown={(event) => event.stopPropagation()}><h2>Удалить материал</h2><label>Причина удаления<textarea required rows={5} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} /></label><div className="form-actions"><button className="danger-button" type="submit">Удалить</button><button className="outline-button" type="button" onClick={() => setDeleting(false)}>Отмена</button></div></form></div>}
    {suspending && selected && <div className="nested-modal-backdrop" onMouseDown={() => setSuspending(false)}><form className="safety-action-modal" onSubmit={(event: FormEvent) => { event.preventDefault(); void action(`/api/admin/users/${selected.targetId}/suspension`, { method: "POST", body: JSON.stringify({ permanent, days, reason: suspensionReason, reportId: selected.id }) }); }} onMouseDown={(event) => event.stopPropagation()}><h2>Заблокировать пользователя</h2><div className="suspension-mode"><button className={!permanent ? "active" : ""} type="button" onClick={() => setPermanent(false)}>Временно</button><button className={permanent ? "active" : ""} type="button" onClick={() => setPermanent(true)}>Навсегда</button></div>{!permanent && <label>Количество дней<input type="number" min={1} max={3650} value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>}<label>Причина блокировки<textarea required rows={5} value={suspensionReason} onChange={(event) => setSuspensionReason(event.target.value)} /></label><div className="form-actions"><button className="danger-button" type="submit">Заблокировать</button><button className="outline-button" type="button" onClick={() => setSuspending(false)}>Отмена</button></div></form></div>}
  </div>;
}
