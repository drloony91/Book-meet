import { FormEvent, useEffect, useState } from "react";
import { localizedApiError, useI18n } from "../../i18n";

type AuditRow = { id: number; action_type: string; object_type: string; object_id?: number; old_status?: string; new_status?: string; reason?: string; created_at: string };
type IncidentRow = { id: number; incident_code: string; detected_at: string; description: string; affected_data: string; affected_user_count: number; cause: string; measures: string; resolved_at?: string; authority_notified_at?: string };
type SecurityRow = { id: number; user_id?: number; event_type: string; result: string; details?: string; created_at: string };

async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Request failed");
  return data;
}

export function AdminCompliancePanel({ onBack, onLogout }: { onBack: () => void; onLogout: () => void }) {
  const { t, formatDate } = useI18n();
  const [tab, setTab] = useState<"audit" | "legal" | "incidents" | "security">("audit");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [security, setSecurity] = useState<SecurityRow[]>([]);
  const [notice, setNotice] = useState("");
  const [documentForm, setDocumentForm] = useState({ type: "user_agreement", language: "ru", version: "", title: "", content: "", fileName: "", activate: true, requiresReacceptance: false });
  const [incidentForm, setIncidentForm] = useState({ description: "", affectedData: "", affectedUserCount: 0, cause: "", measures: "", detectedAt: "", resolvedAt: "", authorityNotifiedAt: "" });

  async function load() {
    try {
      const [auditData, incidentData, securityData] = await Promise.all([
        jsonRequest("/api/admin/audit-log"), jsonRequest("/api/admin/incidents"), jsonRequest("/api/admin/security-events"),
      ]) as [{ actions?: AuditRow[] }, { incidents?: IncidentRow[] }, { events?: SecurityRow[] }];
      setAudit(auditData.actions ?? []); setIncidents(incidentData.incidents ?? []); setSecurity(securityData.events ?? []);
    } catch (error) { setNotice(localizedApiError(error instanceof Error ? error.message : "", t("common.actionError"))); }
  }
  useEffect(() => { void load(); }, []);

  async function publishDocument(event: FormEvent) {
    event.preventDefault(); setNotice("");
    try { await jsonRequest("/api/admin/legal-documents", { method: "POST", body: JSON.stringify(documentForm) }); setDocumentForm({ ...documentForm, version: "", title: "", content: "", fileName: "", requiresReacceptance: false }); setNotice(t("common.changesSaved")); await load(); }
    catch (error) { setNotice(localizedApiError(error instanceof Error ? error.message : "", t("common.actionError"))); }
  }

  async function createIncident(event: FormEvent) {
    event.preventDefault(); setNotice("");
    try { await jsonRequest("/api/admin/incidents", { method: "POST", body: JSON.stringify(Object.fromEntries(Object.entries(incidentForm).map(([key, value]) => [key, typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? `${value.replace("T", " ")}:00` : value]))) }); setIncidentForm({ description: "", affectedData: "", affectedUserCount: 0, cause: "", measures: "", detectedAt: "", resolvedAt: "", authorityNotifiedAt: "" }); setNotice(t("common.changesSaved")); await load(); }
    catch (error) { setNotice(localizedApiError(error instanceof Error ? error.message : "", t("common.actionError"))); }
  }

  return <div className="admin-compliance-panel">
    <button className="back-button" type="button" onClick={onBack}>← {t("admin.backToAdmin")}</button>
    <h1>{t("admin.compliance")}</h1>
    <nav className="admin-compliance-tabs"><button className={tab === "audit" ? "active" : ""} type="button" onClick={() => setTab("audit")}>{t("admin.auditLog")}</button><button className={tab === "legal" ? "active" : ""} type="button" onClick={() => setTab("legal")}>{t("admin.legalDocuments")}</button><button className={tab === "incidents" ? "active" : ""} type="button" onClick={() => setTab("incidents")}>{t("admin.incidents")}</button><button className={tab === "security" ? "active" : ""} type="button" onClick={() => setTab("security")}>{t("admin.securityEvents")}</button></nav>
    {notice && <p className="security-message">{notice}</p>}
    {tab === "audit" && <div className="admin-audit-list">{audit.map((row) => <article key={row.id}><strong data-i18n-skip>{row.action_type}</strong><span data-i18n-skip>{row.object_type} #{row.object_id ?? "—"} · {row.old_status ?? "—"} → {row.new_status ?? "—"}</span><small>{formatDate(row.created_at, { dateStyle: "medium", timeStyle: "short" })}</small>{row.reason && <p data-i18n-skip>{row.reason}</p>}</article>)}</div>}
    {tab === "legal" && <form className="admin-compliance-form" onSubmit={publishDocument}><label>{t("admin.documentType")}<select value={documentForm.type} onChange={(event) => setDocumentForm({ ...documentForm, type: event.target.value })}><option value="user_agreement">{t("legal.userAgreement")}</option><option value="privacy_policy">Privacy Policy</option><option value="personal_data_consent">{t("legal.consent")}</option></select></label><label>{t("locale.label")}<select value={documentForm.language} onChange={(event) => setDocumentForm({ ...documentForm, language: event.target.value })}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label><label>{t("admin.documentVersion")}<input required value={documentForm.version} onChange={(event) => setDocumentForm({ ...documentForm, version: event.target.value })} placeholder="2026.1" /></label><label>{t("admin.documentTitle")}<input required value={documentForm.title} onChange={(event) => setDocumentForm({ ...documentForm, title: event.target.value })} /></label><label>{t("admin.uploadDocument")}<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setDocumentForm({ ...documentForm, fileName: file.name, content: await file.text() }); }} /></label><label>{t("admin.documentText")}<textarea required rows={14} value={documentForm.content} onChange={(event) => setDocumentForm({ ...documentForm, content: event.target.value })} /></label><label><input type="checkbox" checked={documentForm.activate} onChange={(event) => setDocumentForm({ ...documentForm, activate: event.target.checked })} />{t("admin.activateDocument")}</label><label><input type="checkbox" checked={documentForm.requiresReacceptance} onChange={(event) => setDocumentForm({ ...documentForm, requiresReacceptance: event.target.checked })} />{t("admin.requireReacceptance")}</label><button className="primary-button" type="submit">{t("admin.publishDocument")}</button></form>}
    {tab === "incidents" && <><form className="admin-compliance-form" onSubmit={createIncident}><label>{t("admin.detectedAt")}<input type="datetime-local" value={incidentForm.detectedAt} onChange={(event) => setIncidentForm({ ...incidentForm, detectedAt: event.target.value })} /></label><label>{t("admin.incidentDescription")}<textarea required rows={4} value={incidentForm.description} onChange={(event) => setIncidentForm({ ...incidentForm, description: event.target.value })} /></label><label>{t("admin.affectedData")}<textarea required rows={3} value={incidentForm.affectedData} onChange={(event) => setIncidentForm({ ...incidentForm, affectedData: event.target.value })} /></label><label>{t("admin.affectedUsers")}<input type="number" min={0} value={incidentForm.affectedUserCount} onChange={(event) => setIncidentForm({ ...incidentForm, affectedUserCount: Number(event.target.value) })} /></label><label>{t("admin.incidentCause")}<textarea required rows={3} value={incidentForm.cause} onChange={(event) => setIncidentForm({ ...incidentForm, cause: event.target.value })} /></label><label>{t("admin.incidentMeasures")}<textarea required rows={3} value={incidentForm.measures} onChange={(event) => setIncidentForm({ ...incidentForm, measures: event.target.value })} /></label><label>{t("admin.resolvedAt")}<input type="datetime-local" value={incidentForm.resolvedAt} onChange={(event) => setIncidentForm({ ...incidentForm, resolvedAt: event.target.value })} /></label><label>{t("admin.authorityNotifiedAt")}<input type="datetime-local" value={incidentForm.authorityNotifiedAt} onChange={(event) => setIncidentForm({ ...incidentForm, authorityNotifiedAt: event.target.value })} /></label><button className="primary-button" type="submit">{t("admin.createIncident")}</button></form><div className="admin-audit-list">{incidents.map((row) => <article key={row.id}><strong data-i18n-skip>{row.incident_code}</strong><small>{formatDate(row.detected_at, { dateStyle: "medium", timeStyle: "short" })}</small><p data-i18n-skip>{row.description}</p></article>)}</div></>}
    {tab === "security" && <><button className="quiet-danger-button" type="button" onClick={async () => { if (!window.confirm(t("admin.terminateSessions"))) return; await jsonRequest("/api/admin/sessions", { method: "DELETE" }); onLogout(); }}>{t("admin.terminateSessions")}</button><div className="admin-audit-list">{security.map((row) => <article key={row.id}><strong data-i18n-skip>{row.event_type} · {row.result}</strong><small>{formatDate(row.created_at, { dateStyle: "medium", timeStyle: "short" })}</small>{row.details && <p data-i18n-skip>{row.details}</p>}</article>)}</div></>}
  </div>;
}
