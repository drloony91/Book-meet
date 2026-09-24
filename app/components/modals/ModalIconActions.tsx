import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../../i18n";

function useMobilePageActions() {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function ResponsiveModalCloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const mobile = useMobilePageActions();
  return <button className="modal-close mobile-page-back" type="button" onClick={onClose} aria-label={t(mobile ? "common.back" : "common.close")}>{mobile ? "<" : "×"}</button>;
}

export function ModalIconActions({ leading, onEdit, onDelete, onReport, onClose }: { leading?: ReactNode; onEdit?: () => void; onDelete?: () => void; onReport?: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const mobile = useMobilePageActions();
  return <div className="modal-icon-actions">
    {leading}
    {onEdit && <button className="modal-tool-button" type="button" onClick={onEdit} data-tooltip={t("common.edit")} aria-label={t("common.edit")}><svg viewBox="0 0 24 24"><path d="m4 16-.8 4 4-.8L18.8 7.6a2 2 0 0 0 0-2.8l-.6-.6a2 2 0 0 0-2.8 0L4 16Z" /><path d="m14 5 5 5" /></svg></button>}
    {onDelete && <button className="modal-tool-button modal-delete-button" type="button" onClick={onDelete} data-tooltip={t("common.delete")} aria-label={t("common.delete")}><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button>}
    {onReport && <button className="modal-tool-button modal-report-button" type="button" onClick={onReport} data-tooltip={t("safety.report")} aria-label={t("safety.report")}><svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5m0 3h.01" /></svg></button>}
    <button className="modal-tool-button modal-close-button" type="button" onClick={onClose} data-tooltip={t(mobile ? "common.back" : "common.close")} aria-label={t(mobile ? "common.back" : "common.close")}>{mobile ? "<" : "×"}</button>
  </div>;
}
