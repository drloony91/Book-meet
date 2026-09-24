import { useI18n } from "../../i18n";

export function EmptyContentState({ action, onAction }: { action?: string; onAction?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="content-empty">
      <span aria-hidden="true">···</span>
      <h3>{t("common.empty")}</h3>
      {action && <button className="creation-action-button" type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}
