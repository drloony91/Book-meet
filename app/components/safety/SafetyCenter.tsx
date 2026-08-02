import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { reportTargetFromPathname, useRoutedPopup } from "../../navigation/routes";

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
  const [reason, setReason] = useState("");
  const [blockUser, setBlockUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const routedPopup = useRoutedPopup(`/reports/${target.kind}/${target.id}`, "/", onClose, "Жалоба — Book Meet");

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
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось отправить жалобу");
      routedPopup.close();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить жалобу");
    } finally {
      setBusy(false);
    }
  }

  if (!routedPopup.active) return null;
  const title = userReport ? "Пожаловаться на пользователя" : target.kind === "chat" ? "Пожаловаться на диалог" : target.kind === "comment" ? "Пожаловаться на комментарий" : "Пожаловаться на материал";
  return createPortal(<div className="nested-modal-backdrop safety-backdrop" onMouseDown={routedPopup.close}>
    <section className="safety-report-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <h2>{title}</h2>
      {userReport && <>
        <label className="safety-block-choice">
          <input type="checkbox" checked={blockUser} onChange={(event) => setBlockUser(event.target.checked)} />
          <span>Заблокировать пользователя</span>
        </label>
        <p className="safety-explanation">Данный пользователь будет заблокирован, он больше не увидит ваш профиль, опубликованные вами материалы и комментарии. Вы больше не будете видеть профиль этого пользователя, опубликованные им материалы и комментарии.</p>
      </>}
      <form onSubmit={submit}>
        <label>Описание жалобы
          <textarea required rows={6} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Опишите, что нарушает правила сайта, и добавьте детали, которые помогут разобраться в ситуации." />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={busy || !reason.trim()}>{busy ? "Отправляем…" : "Пожаловаться"}</button>
          <button className="outline-button" type="button" onClick={routedPopup.close}>Отмена</button>
        </div>
      </form>
    </section>
  </div>, document.body);
}
