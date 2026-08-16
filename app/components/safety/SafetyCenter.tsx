import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { reportTargetFromPathname, useRoutedPopup } from "../../navigation/routes";
import { localizedApiError, useI18n } from "../../i18n";

export type ReportTarget = {
  kind: "user" | "book" | "review" | "excerpt" | "event" | "occasion" | "publisher_news" | "chat" | "comment";
  id: number;
};

export function openReportDialog(target: ReportTarget) {
  window.dispatchEvent(new CustomEvent<ReportTarget>("bookmeet:report", { detail: target }));
}

export function SafetyCenter({ onChanged }: { onChanged: () => void }) {
  const [target, setTarget] = useState<ReportTarget | null>(() => typeof window === "undefined" ? null : reportTargetFromPathname(window.location.pathname));

  useEffect(() => {
    const restore = () => setTarget(reportTargetFromPathname(window.location.pathname));
    const open = (event: Event) => setTarget((event as CustomEvent<ReportTarget>).detail);
    window.addEventListener("popstate", restore);
    window.addEventListener("bookmeet:report", open);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("bookmeet:report", open);
    };
  }, []);

  if (!target) return null;
  return <SafetyReportDialog target={target} onClose={() => setTarget(null)} onChanged={onChanged} />;
}

function SafetyReportDialog({ target, onClose, onChanged }: { target: ReportTarget; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [blockUser, setBlockUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const routedPopup = useRoutedPopup(`/reports/${target.kind}/${target.id}`, "/", onClose, `${t("safety.report")} — Book Meet`);

  const userReport = target.kind === "user";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetKind: target?.kind, targetId: target?.id, reason: reason.trim(), blockUser }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; reference?: string };
      if (!response.ok) throw new Error(localizedApiError(data.error, t("safety.sendError")));
      setConfirmation(data.reference ?? "");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("safety.sendError"));
    } finally {
      setBusy(false);
    }
  }

  if (!routedPopup.active) return null;
  const title = userReport ? t("safety.user") : target.kind === "chat" ? t("safety.chat") : target.kind === "comment" ? t("safety.comment") : t("safety.material");
  return createPortal(<div className="nested-modal-backdrop safety-backdrop" onMouseDown={routedPopup.close}>
    <section className="safety-report-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      {confirmation ? <><h2>{t("safety.confirmationTitle")}</h2><p>{t("safety.confirmationText", { reference: confirmation })}</p><button className="primary-button" type="button" onClick={routedPopup.close}>{t("common.ok")}</button></> : <>
      <h2>{title}</h2>
      {userReport && <>
        <label className="safety-block-choice">
          <input type="checkbox" checked={blockUser} onChange={(event) => setBlockUser(event.target.checked)} />
          <span>{t("safety.blockUser")}</span>
        </label>
        <p className="safety-explanation">{t("safety.blockExplanation")}</p>
      </>}
      <form onSubmit={submit}>
        <label>{t("safety.description")}
          <textarea required rows={6} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("safety.placeholder")} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={busy || !reason.trim()}>{busy ? t("safety.sending") : t("safety.report")}</button>
          <button className="outline-button" type="button" onClick={routedPopup.close}>{t("common.cancel")}</button>
        </div>
      </form>
      </>}
    </section>
  </div>, document.body);
}
