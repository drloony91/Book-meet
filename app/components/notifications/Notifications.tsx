import { useEffect, useRef, useState } from "react";
import type { DemoUser, NotificationCategory, NotificationEmailMode, NotificationFilter, NotificationPreferencesState, SocialNotification } from "../../types/domain";
import { useRoutedPopup } from "../../navigation/routes";
import { localizedApiError, localizedNotificationDate, localizedNotificationText, localizedNotificationTitle, useI18n } from "../../i18n";
import { notificationCategoryFor, notificationCategoryKeys, notificationFilterKeys } from "../../lib/notification-categories.js";
import { CustomSelect } from "../common/CustomSelect";
import { apiFetch } from "../../services/api";

type MarkNotificationRangeRead = (category: "all" | NotificationCategory) => Promise<boolean>;
const notificationCategories = notificationCategoryKeys as NotificationCategory[];
const notificationFilters = notificationFilterKeys as NotificationFilter[];

export function NotificationsMenu({ notifications, users, onOpen, onClose, onMarkAllRead }: { notifications: SocialNotification[]; users: DemoUser[]; onOpen: (notification: SocialNotification) => void; onClose: () => void; onMarkAllRead: MarkNotificationRangeRead }) {
  const { locale, t } = useI18n();
  const [marking, setMarking] = useState(false);
  return (
    <div className="notifications-menu" role="dialog" aria-label={t("notifications.title")}>
      <div className="notifications-heading"><strong>{t("notifications.center")}</strong><div><button className="mark-read-button" type="button" disabled={marking} onClick={() => { setMarking(true); void onMarkAllRead("all").finally(() => setMarking(false)); }}>{t("notifications.allRead")}</button><button type="button" onClick={onClose} aria-label={t("common.close")}>×</button></div></div>
      <div className="notifications-list">
        {notifications.length ? notifications.map((notification) => {
          const actor = users.find((user) => user.id === notification.actorId);
          return <button type="button" className={`notification-item ${notification.unread ? "unread" : ""}`} key={notification.id} onClick={() => onOpen(notification)}><span className={`notification-avatar avatar-${actor?.color ?? "navy"}`}>{actor?.initials ?? "BM"}</span><span><strong>{localizedNotificationTitle(locale, notification.type, notification.title)}</strong><p>{localizedNotificationText(locale, notification.type, notification.text, { name: actor?.profile.name })}</p><small>{localizedNotificationDate(locale, notification.createdAt)}</small></span></button>;
        }) : <div className="notifications-empty">{t("notifications.empty")}</div>}
      </div>
    </div>
  );
}

export function NotificationsPage({ notifications, users, onOpen, onMarkAllRead }: { notifications: SocialNotification[]; users: DemoUser[]; onOpen: (notification: SocialNotification) => void; onMarkAllRead: MarkNotificationRangeRead }) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<NotificationFilter>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferencesState | null>(null);
  const [draft, setDraft] = useState<NotificationPreferencesState | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<"loading" | "saving" | "saved" | "error" | null>("loading");
  const [settingsError, setSettingsError] = useState("");
  const [marking, setMarking] = useState(false);
  const [telegramAction, setTelegramAction] = useState<"working" | "sent" | "error" | null>(null);
  const saveRequest = useRef(0);
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  useEffect(() => {
    let active = true;
    setSettingsStatus("loading");
    void apiFetch("/api/users/me/notification-preferences").then(async (response) => {
      if (!response.ok) throw new Error(t("notifications.settingsLoadError"));
      const next = await response.json() as NotificationPreferencesState;
      if (active) { setPreferences(next); setDraft(structuredClone(next)); setSettingsStatus(null); }
    }).catch((error) => { if (active) { setSettingsError(error instanceof Error ? error.message : t("notifications.settingsLoadError")); setSettingsStatus("error"); } });
    return () => { active = false; };
  }, [t]);
  const visible = tab === "all" ? notifications : notifications.filter((notification) => notificationCategoryFor(notification.type) === tab);
  const labels: Record<NotificationFilter, string> = {
    all: t("notifications.tabAll"), friendships_follows: t("notifications.tabFriendshipsFollows"), likes: t("notifications.tabLikes"), comments_replies: t("notifications.tabCommentsReplies"), mentions: t("notifications.tabMentions"), reposts: t("notifications.tabReposts"), events_communities: t("notifications.tabEventsCommunities"), reading_reminders: t("notifications.tabReadingReminders"), system_security: t("notifications.tabSystemSecurity"),
  };
  function updateCategory(category: NotificationCategory, changes: Partial<NotificationPreferencesState["categories"][NotificationCategory]>) {
    setDraft((current) => current ? { ...current, categories: { ...current.categories, [category]: { ...current.categories[category], ...changes } } } : current);
    setSettingsStatus(null);
  }
  async function saveSettings() {
    if (!draft) return;
    const requestId = ++saveRequest.current;
    setSettingsStatus("saving"); setSettingsError("");
    try {
      const response = await apiFetch("/api/users/me/notification-preferences", { method: "PUT", body: JSON.stringify({ timezone: draft.timezone, categories: Object.fromEntries(notificationCategories.map((category) => [category, { inAppEnabled: draft.categories[category].inAppEnabled, telegramEnabled: draft.categories[category].telegramEnabled, emailMode: draft.categories[category].emailMode }])) }) });
      const payload = await response.json().catch(() => ({})) as NotificationPreferencesState & { error?: string };
      if (!response.ok) throw new Error(payload.error || t("notifications.settingsSaveError"));
      if (requestId !== saveRequest.current) return;
      setPreferences(payload); setDraft(structuredClone(payload)); setSettingsStatus("saved");
    } catch (error) {
      if (requestId !== saveRequest.current) return;
      setSettingsError(error instanceof Error ? error.message : t("notifications.settingsSaveError")); setSettingsStatus("error");
    }
  }
  async function markVisibleRead() {
    setMarking(true);
    try { await onMarkAllRead(tab); } finally { setMarking(false); }
  }
  async function reloadPreferences() {
    const response = await apiFetch("/api/users/me/notification-preferences");
    const payload = await response.json().catch(() => ({})) as NotificationPreferencesState & { error?: string };
    if (!response.ok) throw new Error(localizedApiError(payload.error, t("notifications.settingsLoadError")));
    setPreferences(payload); setDraft(structuredClone(payload));
  }
  async function connectTelegram() {
    setTelegramAction("working");
    try {
      const response = await apiFetch("/api/users/me/telegram-link", { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { deepLink?: string; error?: string };
      if (!response.ok || !payload.deepLink) throw new Error(localizedApiError(payload.error, t("notifications.telegramActionError")));
      const target = new URL(payload.deepLink);
      if (target.protocol !== "https:" || target.hostname !== "t.me") throw new Error(t("notifications.telegramActionError"));
      window.location.assign(target.toString());
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : t("notifications.telegramActionError")); setTelegramAction("error");
    }
  }
  async function disconnectTelegram() {
    setTelegramAction("working");
    try {
      const response = await apiFetch("/api/users/me/telegram", { method: "DELETE" });
      if (!response.ok) throw new Error(t("notifications.telegramActionError"));
      await reloadPreferences(); setTelegramAction(null);
    } catch (error) { setSettingsError(error instanceof Error ? error.message : t("notifications.telegramActionError")); setTelegramAction("error"); }
  }
  async function testTelegram() {
    setTelegramAction("working");
    try {
      const response = await apiFetch("/api/users/me/telegram/test", { method: "POST" });
      if (!response.ok) throw new Error(t("notifications.telegramActionError"));
      setTelegramAction("sent");
    } catch (error) { setSettingsError(error instanceof Error ? error.message : t("notifications.telegramActionError")); setTelegramAction("error"); }
  }
  const emailOptions: { value: NotificationEmailMode; label: string }[] = [
    { value: "off", label: t("notifications.emailOff") }, { value: "immediate", label: t("notifications.emailImmediate") }, { value: "daily", label: t("notifications.emailDaily") },
  ];
  return <main className="notifications-page">
    <header><h1>{t("notifications.center")}</h1><div className="notifications-page-actions"><button type="button" className="outline-button" aria-expanded={settingsOpen} aria-controls="notification-settings" onClick={() => setSettingsOpen((open) => !open)}>{t("notifications.settingsAction")}</button><button className="mark-read-button" type="button" disabled={marking} onClick={() => void markVisibleRead()}>{t("notifications.allRead")}</button></div></header>
    {settingsOpen && <section id="notification-settings" className="notification-settings" aria-labelledby="notification-settings-title">
      <div className="notification-settings-heading"><div><h2 id="notification-settings-title">{t("notifications.settingsTitle")}</h2><p>{t("notifications.settingsHint")}</p></div><button type="button" className="modal-close-inline" aria-label={t("common.close")} onClick={() => setSettingsOpen(false)}>×</button></div>
      {settingsStatus === "loading" ? <p role="status">{t("notifications.settingsLoading")}</p> : draft && <>
        <div className="notification-channel-actions">
          {draft.readiness.telegram.connected ? <div><p>{t("notifications.telegramConnected", { name: draft.readiness.telegram.displayName ?? "Telegram" })}</p><div className="form-actions"><button type="button" disabled={telegramAction === "working"} onClick={() => void testTelegram()}>{t("notifications.telegramTest")}</button><button type="button" disabled={telegramAction === "working"} onClick={() => void disconnectTelegram()}>{t("notifications.telegramDisconnect")}</button></div></div> : draft.readiness.telegram.serviceReady ? <button type="button" className="outline-button" disabled={telegramAction === "working"} onClick={() => void connectTelegram()}>{t("notifications.telegramConnect")}</button> : null}
          {telegramAction === "sent" && <p className="form-success" role="status">{t("notifications.telegramTestSent")}</p>}
          {telegramAction === "error" && <p className="form-error" role="alert">{settingsError || t("notifications.telegramActionError")}</p>}
        </div>
        <div className="notification-settings-table" role="group" aria-label={t("notifications.settingsMatrix")}>
          <div className="notification-settings-row notification-settings-labels" aria-hidden="true"><strong>{t("notifications.category")}</strong><strong>{t("notifications.channelInApp")}</strong><strong>Telegram</strong><strong>Email</strong></div>
          {notificationCategories.map((category) => { const item = draft.categories[category]; return <div className="notification-settings-row" key={category}>
            <strong>{labels[category]}</strong>
            <label><span className="notification-mobile-label">{t("notifications.channelInApp")}</span><input type="checkbox" checked={item.inAppEnabled} disabled={item.mandatoryInApp} onChange={(event) => updateCategory(category, { inAppEnabled: event.target.checked })} />{item.mandatoryInApp && <small>{t("notifications.mandatoryInApp")}</small>}</label>
            <label><span className="notification-mobile-label">Telegram</span><input type="checkbox" checked={item.telegramEnabled} disabled={!draft.readiness.telegram.available && !item.telegramEnabled} onChange={(event) => updateCategory(category, { telegramEnabled: event.target.checked })} /></label>
            <label><span className="notification-mobile-label">Email</span><select value={item.emailMode} disabled={!draft.readiness.email.available && item.emailMode === "off"} onChange={(event) => updateCategory(category, { emailMode: event.target.value as NotificationEmailMode })}>{emailOptions.map((option) => <option key={option.value} value={option.value} disabled={!draft.readiness.email.available && option.value !== "off"}>{option.label}</option>)}</select></label>
          </div>; })}
        </div>
        {!draft.readiness.telegram.available && <p className="notification-channel-note">{t("notifications.telegramUnavailable")}</p>}
        {!draft.readiness.email.available && <p className="notification-channel-note">{t("notifications.emailUnavailable")}</p>}
        <label className="notification-timezone"><span>{t("notifications.timezone")}</span><input list="notification-timezones" value={draft.timezone ?? ""} placeholder={t("notifications.timezoneDevice")} onChange={(event) => setDraft((current) => current ? { ...current, timezone: event.target.value || null } : current)} /><datalist id="notification-timezones"><option value={localTimezone} /><option value="UTC" /></datalist></label>
        <div className="notification-timezone-summary"><span>{t("notifications.effectiveTimezone")}: <strong>{draft.effectiveTimezone}</strong></span><button type="button" onClick={() => setDraft((current) => current ? { ...current, timezone: localTimezone, effectiveTimezone: localTimezone } : current)}>{t("notifications.useDeviceTimezone")}</button></div>
        {settingsStatus === "error" && <p className="form-error" role="alert">{settingsError}</p>}{settingsStatus === "saved" && <p className="form-success" role="status">{t("notifications.settingsSaved")}</p>}
        <div className="form-actions"><button type="button" onClick={() => { if (preferences) setDraft(structuredClone(preferences)); setSettingsOpen(false); }}>{t("common.cancel")}</button><button className="primary-button" type="button" disabled={settingsStatus === "saving"} onClick={() => void saveSettings()}>{settingsStatus === "saving" ? t("notifications.settingsSaving") : t("notifications.settingsSave")}</button></div>
      </>}
    </section>}
    <label className="notification-category-filter"><span>{t("notifications.category")}</span><CustomSelect ariaLabel={t("notifications.category")} value={tab} onChange={(value) => setTab(value as NotificationFilter)} options={notificationFilters.map((item) => ({ value: item, label: labels[item] }))} /></label>
    <div className="notifications-list">{visible.length ? visible.map((notification) => { const actor = users.find((user) => user.id === notification.actorId); return <button type="button" className={`notification-item ${notification.unread ? "unread" : ""}`} key={notification.id} onClick={() => onOpen(notification)}><span className={`notification-avatar avatar-${actor?.color ?? "navy"}`}>{actor?.initials ?? "BM"}</span><span><strong>{localizedNotificationTitle(locale, notification.type, notification.title)}</strong><p>{localizedNotificationText(locale, notification.type, notification.text, { name: actor?.profile.name })}</p><small>{localizedNotificationDate(locale, notification.createdAt)}</small></span></button>; }) : <div className="notifications-empty">{tab === "all" ? t("notifications.empty") : t("notifications.emptyCategory")}</div>}</div>
  </main>;
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
