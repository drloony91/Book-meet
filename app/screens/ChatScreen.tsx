import { useI18n } from "../i18n";
import { GeneralMessageSearch } from "../components/chat/ChatComponents";

export function ChatScreen({ hasFriends = true, onSelectMessageSearchResult }: { hasFriends?: boolean; onSelectMessageSearchResult: (peerId: number, messageId: number) => void }) {
  const { t } = useI18n();
  return (
    <main className="chat-empty-screen">
      <div aria-hidden="true">•••</div>
      <h1>{t("header.chats")}</h1>
      <p>{hasFriends ? t("chat.choose") : t("chat.noFriends")}</p>
      <GeneralMessageSearch onSelectResult={onSelectMessageSearchResult} />
    </main>
  );
}
