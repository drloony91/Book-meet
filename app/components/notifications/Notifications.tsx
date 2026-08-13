import type { DemoUser, SocialNotification } from "../../types/domain";
import { useRoutedPopup } from "../../navigation/routes";
import { localizedNotificationDate, localizedNotificationText, localizedNotificationTitle, useI18n } from "../../i18n";

export function NotificationsMenu({ notifications, users, onOpen, onClose, onMarkAllRead }: { notifications: SocialNotification[]; users: DemoUser[]; onOpen: (notification: SocialNotification) => void; onClose: () => void; onMarkAllRead: () => void }) {
  const { locale, t } = useI18n();
  return (
    <div className="notifications-menu" role="dialog" aria-label={t("notifications.title")}>
      <div className="notifications-heading"><strong>{t("notifications.center")}</strong><div><button className="mark-read-button" type="button" onClick={onMarkAllRead}>{t("notifications.allRead")}</button><button type="button" onClick={onClose} aria-label={t("common.close")}>×</button></div></div>
      <div className="notifications-list">
        {notifications.length ? notifications.map((notification) => {
          const actor = users.find((user) => user.id === notification.actorId);
          return <button type="button" className={`notification-item ${notification.unread ? "unread" : ""}`} key={notification.id} onClick={() => onOpen(notification)}><span className={`notification-avatar avatar-${actor?.color ?? "navy"}`}>{actor?.initials ?? "BM"}</span><span><strong>{localizedNotificationTitle(locale, notification.type, notification.title)}</strong><p>{localizedNotificationText(locale, notification.type, notification.text, { name: actor?.profile.name })}</p><small>{localizedNotificationDate(locale, notification.createdAt)}</small></span></button>;
        }) : <div className="notifications-empty">{t("notifications.empty")}</div>}
      </div>
    </div>
  );
}

export function NotificationDetail({ notification, actor, isFollowing, onClose, onFollow }: { notification: SocialNotification; actor?: DemoUser; isFollowing: boolean; onClose: () => void; onFollow: () => void }) {
  const { locale, t } = useI18n();
  const localizedTitle = localizedNotificationTitle(locale, notification.type, notification.title);
  const localizedText = localizedNotificationText(locale, notification.type, notification.text, { name: actor?.profile.name });
  const routedPopup = useRoutedPopup(`/notifications/${notification.id}`, "/", onClose, `${localizedTitle} — Book Meet`);
  if (!routedPopup.active) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={routedPopup.close}>
      <section className="notification-detail" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={routedPopup.close}>×</button><span className="section-subtitle">{localizedTitle}</span><h2 data-i18n-skip>{actor?.profile.name ?? "Book Meet"}</h2><p>{localizedText}</p>
        {notification.type === "friend_rejected" && !isFollowing && <button className="primary-button" type="button" onClick={() => { onFollow(); routedPopup.close(); }}>{t("notifications.followUser")}</button>}
      </section>
    </div>
  );
}
