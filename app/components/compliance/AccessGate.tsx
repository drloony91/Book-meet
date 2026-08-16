import { useState } from "react";
import type { AccessGate, LegalDocument } from "../../types/domain";
import { localizedApiError, useI18n } from "../../i18n";
import { apiFetch } from "../../services/api";

function LegalDocumentDialog({ document, onClose }: { document: LegalDocument; onClose: () => void }) {
  const { t } = useI18n();
  return <div className="notice-backdrop compliance-document-backdrop" onMouseDown={onClose}>
    <section className="compliance-document-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" type="button" aria-label={t("common.close")} onClick={onClose}>×</button>
      <span className="section-subtitle">{t("legal.version", { version: document.version })}</span>
      <h2>{document.title}</h2>
      <div className="legal-document-content" data-i18n-skip>{document.content}</div>
    </section>
  </div>;
}

export function ComplianceAccessGate({ gate, onAccepted, onOpenProfile }: { gate: AccessGate; onAccepted: () => Promise<void>; onOpenProfile: () => void }) {
  const { t } = useI18n();
  const [agreement, setAgreement] = useState(false);
  const [personalData, setPersonalData] = useState(false);
  const [opened, setOpened] = useState<LegalDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profileDismissed, setProfileDismissed] = useState(false);
  const documents = gate.legalDocuments ?? gate.pendingLegalDocuments;
  const pendingLegal = gate.pendingLegalDocuments.length > 0;

  async function accept() {
    if (!agreement || !personalData) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/legal/acceptances", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agreementAccepted: agreement, personalDataAccepted: personalData, documentIds: documents.map((item) => item.id) }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(localizedApiError(result.error, t("legal.acceptError")));
      await onAccepted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("legal.acceptError")); }
    finally { setBusy(false); }
  }

  if (!pendingLegal && (gate.profileComplete || profileDismissed)) return null;
  const openProfile = () => { setProfileDismissed(true); onOpenProfile(); };
  return <div className="notice-backdrop compliance-access-backdrop">
    <section className="confirm-social-modal compliance-access-modal" role="alertdialog" aria-modal="true">
      {pendingLegal ? <>
        <h2>{t("legal.updatedTitle")}</h2>
        <p>{t("legal.updatedHint")}</p>
        <div className="legal-document-links">{documents.map((document) => <button className="text-link-button" type="button" key={document.id} onClick={() => setOpened(document)}>{document.title}</button>)}</div>
        <label className="legal-acceptance-choice"><input type="checkbox" checked={agreement} onChange={(event) => setAgreement(event.target.checked)} /><span>{t("legal.agreementAccept")}</span></label>
        <label className="legal-acceptance-choice"><input type="checkbox" checked={personalData} onChange={(event) => setPersonalData(event.target.checked)} /><span>{t("legal.personalDataAccept")}</span></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" type="button" disabled={busy || !agreement || !personalData} onClick={() => void accept()}>{busy ? t("common.loading") : t("legal.acceptContinue")}</button>
      </> : <>
        <h2>{t("access.profileRequiredTitle")}</h2>
        <p>{t("access.profileRequiredHint")}</p>
        <div className="form-actions"><button className="primary-button" type="button" onClick={openProfile}>{t("access.goProfile")}</button><button className="outline-button" type="button" onClick={openProfile}>{t("common.ok")}</button></div>
      </>}
    </section>
    {opened && <LegalDocumentDialog document={opened} onClose={() => setOpened(null)} />}
  </div>;
}
