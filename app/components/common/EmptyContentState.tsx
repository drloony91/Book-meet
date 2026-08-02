export function EmptyContentState({ action, onAction }: { action?: string; onAction?: () => void }) {
  return (
    <div className="content-empty">
      <span aria-hidden="true">···</span>
      <h3>Здесь пока ничего нет</h3>
      {action && <button className="creation-action-button" type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}
