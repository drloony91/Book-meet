import { FormEvent, useEffect, useState } from "react";
import { localizedApiError, useI18n } from "../../i18n";
import { apiFetch } from "../../services/api";

type AuditRow = { id: number; action_type: string; object_type: string; object_id?: number; old_status?: string; new_status?: string; reason?: string; created_at: string };
type IncidentRow = { id: number; incident_code: string; detected_at: string; description: string; affected_data: string; affected_user_count: number; cause: string; measures: string; resolved_at?: string; authority_notified_at?: string };
type SecurityRow = { id: number; user_id?: number; event_type: string; result: string; details?: string; created_at: string };
type LegalDocumentRow = {
  id: number;
  document_type: "user_agreement" | "privacy_policy" | "personal_data_consent" | "community_moderation_rules";
  version: string;
  language_code: "ru" | "kk" | "en";
  title: string;
  content: string;
  file_name?: string;
  is_active: number | boolean;
  requires_reacceptance: number | boolean;
  acceptance_count: number | string;
  published_at?: string;
  created_at: string;
};

const emptyDocumentForm = { type: "user_agreement", language: "ru", version: "", title: "", content: "", fileName: "", activate: true, requiresReacceptance: false };
const emptyIncidentForm = { description: "", affectedData: "", affectedUserCount: 0, cause: "", measures: "", detectedAt: "", resolvedAt: "", authorityNotifiedAt: "" };

async function jsonRequest(url: string, options?: RequestInit) {
  const response = await apiFetch(url, { credentials: "same-origin", ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Request failed");
  return data;
}

export function AdminCompliancePanel({ onBack, onLogout }: { onBack: () => void; onLogout: () => void }) {
  const { t, formatDate } = useI18n();
  const [tab, setTab] = useState<"audit" | "legal" | "incidents" | "security">("audit");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [documents, setDocuments] = useState<LegalDocumentRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [security, setSecurity] = useState<SecurityRow[]>([]);
  const [notice, setNotice] = useState("");
  const [documentForm, setDocumentForm] = useState({ ...emptyDocumentForm });
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [openedDocument, setOpenedDocument] = useState<LegalDocumentRow | null>(null);
  const [incidentForm, setIncidentForm] = useState({ ...emptyIncidentForm });

  async function load() {
    try {
      const [auditData, documentData, incidentData, securityData] = await Promise.all([
        jsonRequest("/api/admin/audit-log"), jsonRequest("/api/admin/legal-documents"), jsonRequest("/api/admin/incidents"), jsonRequest("/api/admin/security-events"),
      ]) as [{ actions?: AuditRow[] }, { documents?: LegalDocumentRow[] }, { incidents?: IncidentRow[] }, { events?: SecurityRow[] }];
      setAudit(auditData.actions ?? []);
      setDocuments(documentData.documents ?? []);
      setIncidents(incidentData.incidents ?? []);
      setSecurity(securityData.events ?? []);
    } catch (error) { setNotice(localizedApiError(error instanceof Error ? error.message : "", t("common.actionError"))); }
  }
  useEffect(() => { void load(); }, []);

  function resetDocumentEditor() {
    setEditingDocumentId(null);
    setDocumentForm({ ...emptyDocumentForm });
  }

  function editDocument(document: LegalDocumentRow) {
    setEditingDocumentId(document.id);
    setDocumentForm({ type: document.document_type, language: document.language_code, version: document.version, title: document.title, content: document.content, fileName: document.file_name ?? "", activate: Boolean(document.is_active), requiresReacceptance: Boolean(document.requires_reacceptance) });
    setNotice(Number(document.acceptance_count) > 0 ? t("admin.documentInUse") : "");
  }

  async function saveDocument(event: FormEvent) {
    event.preventDefault(); setNotice("");
    try {
      await jsonRequest(editingDocumentId ? `/api/admin/legal-documents/${editingDocumentId}` : "/api/admin/legal-documents", { method: editingDocumentId ? "PATCH" : "POST", body: JSON.stringify(documentForm) });
      resetDocumentEditor(); setNotice(t("common.changesSaved")); await load();
    } catch (error) { setNotice(localizedApiError(error instanceof Error ? error.message : "", t("common.actionError"))); }
  }

  async function deleteDocument(document: LegalDocumentRow) {
    if (Number(document.acceptance_count) > 0) { setNotice(t("admin.documentInUse")); return; }
    if (!window.confirm(t("admin.deleteLegalConfirm", { title: document.title }))) return;
    setNotice("");
    try {
      await jsonRequest(`/api/admin/legal-documents/${document.id}`, { method: "DELETE" });
      if (editingDocumentId === document.id) resetDocumentEditor();
      if (openedDocument?.id === document.id) setOpenedDocument(null);
      setNotice(t("common.changesSaved")); await load();
    } catch (error) { setNotice(localizedApiError(error instanceof Error ? error.message : "", t("common.actionError"))); }
  }

  async function createIncident(event: FormEvent) {
    event.preventDefault(); setNotice("");
    try {
      await jsonRequest("/api/admin/incidents", { method: "POST", body: JSON.stringify(Object.fromEntries(Object.entries(incidentForm).map(([key, value]) => [key, typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? `${value.replace("T", " ")}:00` : value]))) });
      setIncidentForm({ ...emptyIncidentForm }); setNotice(t("common.changesSaved")); await load();
    } catch (error) { setNotice(localizedApiError(error instanceof Error ? error.message : "", t("common.actionError"))); }
  }

  function documentTypeLabel(type: LegalDocumentRow["document_type"] | string) {
    if (type === "user_agreement") return t("legal.userAgreement");
    if (type === "privacy_policy") return t("legal.privacyPolicy");
    if (type === "personal_data_consent") return t("legal.consent");
    return t("legal.communityModerationRules");
  }

  function documentStatus(document: LegalDocumentRow) {
    if (document.is_active) return { key: "admin.statusActive" as const, className: "active" };
    if (document.published_at) return { key: "admin.statusArchived" as const, className: "archived" };
    return { key: "admin.statusDraft" as const, className: "draft" };
  }

  return <div className="admin-compliance-panel">
    <button className="back-button" type="button" onClick={onBack}>← {t("admin.backToAdmin")}</button>
    <h1>{t("admin.compliance")}</h1>
    <nav className="admin-compliance-tabs"><button className={tab === "audit" ? "active" : ""} type="button" onClick={() => setTab("audit")}>{t("admin.auditLog")}</button><button className={tab === "legal" ? "active" : ""} type="button" onClick={() => setTab("legal")}>{t("admin.legalDocuments")}</button><button className={tab === "incidents" ? "active" : ""} type="button" onClick={() => setTab("incidents")}>{t("admin.incidents")}</button><button className={tab === "security" ? "active" : ""} type="button" onClick={() => setTab("security")}>{t("admin.securityEvents")}</button></nav>
    {notice && <p className="security-message">{notice}</p>}
    {tab === "audit" && <div className="admin-audit-list">{audit.map((row) => <article key={row.id}><strong data-i18n-skip>{row.action_type}</strong><span data-i18n-skip>{row.object_type} #{row.object_id ?? "—"} · {row.old_status ?? "—"} → {row.new_status ?? "—"}</span><small>{formatDate(row.created_at, { dateStyle: "medium", timeStyle: "short" })}</small>{row.reason && <p data-i18n-skip>{row.reason}</p>}</article>)}</div>}
    {tab === "legal" && <div className="admin-compliance-section">
      <section className="admin-legal-overview"><div className="admin-compliance-heading"><div><h2>{t("admin.legalOverview")}</h2><p>{t("admin.legalOverviewHint")}</p></div></div>
        {documents.length ? <div className="admin-legal-grid">{documents.map((document) => { const status = documentStatus(document); return <article className="admin-legal-card" key={document.id}>
          <div className="admin-legal-card-top"><span className={`admin-status-pill ${status.className}`}>{t(status.key)}</span><span className="admin-language-pill">{document.language_code.toLocaleUpperCase()}</span></div>
          <small>{documentTypeLabel(document.document_type)} · {t("legal.version", { version: document.version })}</small><h3 data-i18n-skip>{document.title}</h3>
          <div className="admin-legal-meta"><span>{t("admin.acceptanceCount", { count: Number(document.acceptance_count) })}</span><span>{document.requires_reacceptance ? t("admin.reacceptanceRequired") : t("admin.reacceptanceNotRequired")}</span>{document.published_at && <span>{t("admin.documentPublishedAt")}: {formatDate(document.published_at, { dateStyle: "medium", timeStyle: "short" })}</span>}</div>
          <div className="admin-legal-actions"><button className="outline-button" type="button" onClick={() => setOpenedDocument(document)}>{t("admin.viewDocument")}</button><button className="outline-button" type="button" onClick={() => editDocument(document)}>{t("admin.editDocument")}</button><button className="quiet-danger-button" type="button" onClick={() => void deleteDocument(document)}>{t("admin.deleteDocument")}</button></div>
        </article>; })}</div> : <p className="empty-state-text">{t("admin.noLegalDocuments")}</p>}
      </section>
      <section className="admin-compliance-editor"><div className="admin-compliance-heading"><div><h2>{editingDocumentId ? t("admin.editLegalDocument") : t("admin.newLegalDocument")}</h2>{editingDocumentId && Number(documents.find((item) => item.id === editingDocumentId)?.acceptance_count) > 0 && <p>{t("admin.documentInUse")}</p>}</div>{editingDocumentId && <button className="outline-button" type="button" onClick={resetDocumentEditor}>{t("admin.cancelEditing")}</button>}</div>
        <form className="admin-compliance-form" onSubmit={saveDocument}><div className="admin-form-row"><label>{t("admin.documentType")}<select disabled={editingDocumentId !== null} value={documentForm.type} onChange={(event) => setDocumentForm({ ...documentForm, type: event.target.value })}><option value="user_agreement">{t("legal.userAgreement")}</option><option value="privacy_policy">{t("legal.privacyPolicy")}</option><option value="personal_data_consent">{t("legal.consent")}</option><option value="community_moderation_rules">{t("legal.communityModerationRules")}</option></select></label><label>{t("locale.label")}<select disabled={editingDocumentId !== null} value={documentForm.language} onChange={(event) => setDocumentForm({ ...documentForm, language: event.target.value })}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label><label>{t("admin.documentVersion")}<input required value={documentForm.version} onChange={(event) => setDocumentForm({ ...documentForm, version: event.target.value })} placeholder="2026.1" /></label></div><label>{t("admin.documentTitle")}<input required value={documentForm.title} onChange={(event) => setDocumentForm({ ...documentForm, title: event.target.value })} /></label><label className="admin-file-field">{t("admin.uploadDocument")}<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setDocumentForm({ ...documentForm, fileName: file.name, content: await file.text() }); }} /></label><label>{t("admin.documentText")}<textarea required rows={14} value={documentForm.content} onChange={(event) => setDocumentForm({ ...documentForm, content: event.target.value })} /></label><div className="admin-checkbox-row"><label><input type="checkbox" checked={documentForm.activate} onChange={(event) => setDocumentForm({ ...documentForm, activate: event.target.checked })} />{t("admin.activateDocument")}</label><label><input type="checkbox" checked={documentForm.requiresReacceptance} onChange={(event) => setDocumentForm({ ...documentForm, requiresReacceptance: event.target.checked })} />{t("admin.requireReacceptance")}</label></div><button className="primary-button" type="submit">{editingDocumentId ? t("admin.saveDocument") : t("admin.publishDocument")}</button></form>
      </section>
    </div>}
    {tab === "incidents" && <div className="admin-compliance-section"><section className="admin-compliance-editor"><div className="admin-compliance-heading"><div><h2>{t("admin.incidentFormTitle")}</h2><p>{t("admin.incidentFormHint")}</p></div></div><form className="admin-compliance-form admin-incident-form" onSubmit={createIncident}><div className="admin-form-row"><label>{t("admin.detectedAt")}<input type="datetime-local" value={incidentForm.detectedAt} onChange={(event) => setIncidentForm({ ...incidentForm, detectedAt: event.target.value })} /></label><label>{t("admin.affectedUsers")}<input type="number" min={0} value={incidentForm.affectedUserCount} onChange={(event) => setIncidentForm({ ...incidentForm, affectedUserCount: Number(event.target.value) })} /></label></div><label>{t("admin.incidentDescription")}<textarea required rows={4} value={incidentForm.description} onChange={(event) => setIncidentForm({ ...incidentForm, description: event.target.value })} /></label><label>{t("admin.affectedData")}<textarea required rows={3} value={incidentForm.affectedData} onChange={(event) => setIncidentForm({ ...incidentForm, affectedData: event.target.value })} /></label><div className="admin-form-row admin-form-row-text"><label>{t("admin.incidentCause")}<textarea required rows={4} value={incidentForm.cause} onChange={(event) => setIncidentForm({ ...incidentForm, cause: event.target.value })} /></label><label>{t("admin.incidentMeasures")}<textarea required rows={4} value={incidentForm.measures} onChange={(event) => setIncidentForm({ ...incidentForm, measures: event.target.value })} /></label></div><div className="admin-form-row"><label>{t("admin.resolvedAt")}<input type="datetime-local" value={incidentForm.resolvedAt} onChange={(event) => setIncidentForm({ ...incidentForm, resolvedAt: event.target.value })} /></label><label>{t("admin.authorityNotifiedAt")}<input type="datetime-local" value={incidentForm.authorityNotifiedAt} onChange={(event) => setIncidentForm({ ...incidentForm, authorityNotifiedAt: event.target.value })} /></label></div><button className="primary-button" type="submit">{t("admin.createIncident")}</button></form></section><div className="admin-audit-list admin-incident-list">{incidents.map((row) => <article key={row.id}><strong data-i18n-skip>{row.incident_code}</strong><small>{formatDate(row.detected_at, { dateStyle: "medium", timeStyle: "short" })}</small><p data-i18n-skip>{row.description}</p><dl><dt>{t("admin.affectedUsers")}</dt><dd>{row.affected_user_count}</dd><dt>{t("admin.affectedData")}</dt><dd data-i18n-skip>{row.affected_data}</dd><dt>{t("admin.incidentCause")}</dt><dd data-i18n-skip>{row.cause}</dd><dt>{t("admin.incidentMeasures")}</dt><dd data-i18n-skip>{row.measures}</dd></dl></article>)}</div></div>}
    {tab === "security" && <><button className="quiet-danger-button" type="button" onClick={async () => { if (!window.confirm(t("admin.terminateSessions"))) return; await jsonRequest("/api/admin/sessions", { method: "DELETE" }); onLogout(); }}>{t("admin.terminateSessions")}</button><div className="admin-audit-list">{security.map((row) => <article key={row.id}><strong data-i18n-skip>{row.event_type} · {row.result}</strong><small>{formatDate(row.created_at, { dateStyle: "medium", timeStyle: "short" })}</small>{row.details && <p data-i18n-skip>{row.details}</p>}</article>)}</div></>}
    {openedDocument && <div className="notice-backdrop" onMouseDown={() => setOpenedDocument(null)}><section className="compliance-document-modal admin-legal-preview" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label={t("common.close")} onClick={() => setOpenedDocument(null)}>×</button><div className="admin-legal-card-top"><span className={`admin-status-pill ${documentStatus(openedDocument).className}`}>{t(documentStatus(openedDocument).key)}</span><span className="admin-language-pill">{openedDocument.language_code.toLocaleUpperCase()}</span></div><small>{documentTypeLabel(openedDocument.document_type)} · {t("legal.version", { version: openedDocument.version })}</small><h2 data-i18n-skip>{openedDocument.title}</h2><div className="legal-document-content" data-i18n-skip>{openedDocument.content}</div></section></div>}
  </div>;
}
