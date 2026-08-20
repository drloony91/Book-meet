import { useI18n } from "../i18n";

export function ChatScreen({ hasFriends = true }: { hasFriends?: boolean }) {
  const { t } = useI18n();
  return (
    <main className="chat-empty-screen">
      <div aria-hidden="true">•••</div>
      <h1>{t("header.chats")}</h1>
      <p>{hasFriends ? t("chat.choose") : t("chat.noFriends")}</p>
    </main>
  );
}
