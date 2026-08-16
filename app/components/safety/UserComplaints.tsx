import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SafetyReport } from "../../types/domain";
import { localizedApiError, useI18n, type Translate } from "../../i18n";

function statusLabel(status: SafetyReport["status"], t: Translate) {
  return status === "new" ? t("safety.status.new") : status === "reviewing" ? t("safety.status.reviewing") : status === "satisfied" ? t("safety.status.satisfied") : t("safety.status.rejected");
}

export function UserComplaints() {
  const { t, formatDate } = useI18n();
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [selected, setSelected] = useState<SafetyReport | null>(null);
  const [appeal, setAppeal] = useState("");
  const [error, setError] = useState("");
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  async function load() {
    const response = await fetch("/api/reports/mine", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({})) as { reports?: SafetyReport[] };
    if (response.ok) setReports(data.reports ?? []);
  }
  useEffect(() => { void load(); setPortalTarget(document.querySelector(".blocked-users-settings")); }, []);

  async function submitAppeal(event: FormEvent) {
    event.preventDefault();
    if (!selected || !appeal.trim()) return;
    const response = await fetch(`/api/reports/${selected.id}/appeal`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: appeal }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(localizedApiError(data.error, t("safety.appealError"))); return; }
    setAppeal(""); setSelected(null); await load();
  }

  const content = <div className="user-complaints-settings">
    <h3>{t("safety.myComplaints")}</h3>
    <div className="user-complaints-grid">{reports.map((report) => <button type="button" key={report.id} onClick={() => setSelected(report)}><strong data-i18n-skip>{t("safety.complaintCard", { reference: report.reference ?? `BMC-${report.id}`, status: statusLabel(report.status, t) })}</strong><small>{formatDate(report.createdAt, { dateStyle: "medium" })}</small></button>)}</div>
    {!reports.length && <p>{t("safety.noComplaints")}</p>}
    {selected && <div className="notice-backdrop" onMouseDown={() => setSelected(null)}><section className="complaint-detail-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label={t("common.close")} onClick={() => setSelected(null)}>×</button><span className="section-subtitle" data-i18n-skip>{selected.reference}</span><h2>{statusLabel(selected.status, t)}</h2><dl><dt>{t("safety.submittedAt")}</dt><dd>{formatDate(selected.createdAt, { dateStyle: "medium", timeStyle: "short" })}</dd><dt>{t("safety.description")}</dt><dd data-i18n-skip>{selected.reason}</dd>{selected.motivatedResponse && <><dt>{t("safety.motivatedResponse")}</dt><dd data-i18n-skip>{selected.motivatedResponse}</dd></>}</dl>{["satisfied", "rejected"].includes(selected.status) && !selected.appealedAt && <form onSubmit={submitAppeal}><label>{t("safety.appealText")}<textarea required rows={5} value={appeal} onChange={(event) => setAppeal(event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">{t("safety.appeal")}</button></form>}{selected.appealedAt && <p>{t("safety.appealSubmitted")}</p>}</section></div>}
  </div>;
  return portalTarget ? createPortal(content, portalTarget) : content;
}
