import type { DemoUser, SocialNotification } from "../../types/domain";
import { useRoutedPopup } from "../../navigation/routes";

export function NotificationsMenu({ notifications, users, onOpen, onClose, onMarkAllRead }: { notifications: SocialNotification[]; users: DemoUser[]; onOpen: (notification: SocialNotification) => void; onClose: () => void; onMarkAllRead: () => void }) {
  return (
    <div className="notifications-menu" role="dialog" aria-label="Уведомления">
      <div className="notifications-heading"><strong>Центр событий</strong><div><button className="mark-read-button" type="button" onClick={onMarkAllRead}>Всё прочитано</button><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div></div>
      <div className="notifications-list">
        {notifications.length ? notifications.map((notification) => {
          const actor = users.find((user) => user.id === notification.actorId);
          return <button type="button" className={`notification-item ${notification.unread ? "unread" : ""}`} key={notification.id} onClick={() => onOpen(notification)}><span className={`notification-avatar avatar-${actor?.color ?? "navy"}`}>{actor?.initials ?? "BM"}</span><span><strong>{notification.title}</strong><p>{notification.text}</p><small>{notification.createdAt}</small></span></button>;
        }) : <div className="notifications-empty">Новых уведомлений нет</div>}
      </div>
    </div>
  );
}

export function NotificationDetail({ notification, actor, isFollowing, onClose, onFollow }: { notification: SocialNotification; actor?: DemoUser; isFollowing: boolean; onClose: () => void; onFollow: () => void }) {
  const routedPopup = useRoutedPopup(`/notifications/${notification.id}`, "/", onClose, `${notification.title} — Book Meet`);
  if (!routedPopup.active) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={routedPopup.close}>
      <section className="notification-detail" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={routedPopup.close}>×</button><span className="section-subtitle">{notification.title}</span><h2>{actor?.profile.name ?? "Book Meet"}</h2><p>{notification.text}</p>
        {notification.type === "friend_rejected" && !isFollowing && <button className="primary-button" type="button" onClick={() => { onFollow(); routedPopup.close(); }}>Подписаться на пользователя</button>}
      </section>
    </div>
  );
}
