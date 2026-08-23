import { useMemo, useState } from "react";
import { Avatar } from "../components/chat/ChatComponents";
import type { Friend } from "../components/chat/types";
import { useI18n } from "../i18n";

export type MobileMessageRequest = {
  id: number;
  friend: Friend;
  message?: string;
};

export function MobileMessagesPage({
  friends,
  requests,
  onSelectFriend,
  onOpenRequest,
}: {
  friends: Friend[];
  requests: MobileMessageRequest[];
  onSelectFriend: (friend: Friend) => void;
  onOpenRequest: (userId: number) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"incoming" | "requests">("incoming");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const filteredFriends = useMemo(
    () => friends.filter((friend) => !normalizedQuery || `${friend.name} ${friend.username ?? ""}`.toLocaleLowerCase("ru").includes(normalizedQuery)),
    [friends, normalizedQuery],
  );
  const filteredRequests = useMemo(
    () => requests.filter(({ friend, message }) => !normalizedQuery || `${friend.name} ${friend.username ?? ""} ${message ?? ""}`.toLocaleLowerCase("ru").includes(normalizedQuery)),
    [requests, normalizedQuery],
  );

  return (
    <main className="mobile-messages-page" aria-labelledby="mobile-messages-title">
      <header className="mobile-messages-header">
        <h1 id="mobile-messages-title">{t("header.chats")}</h1>
      </header>
      <div className="mobile-messages-controls">
        <label className="mobile-messages-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("chat.searchMessages")} aria-label={t("chat.searchMessages")} />
        </label>
        <div className="mobile-messages-tabs" role="tablist" aria-label={t("header.chats")}>
          <button type="button" role="tab" aria-selected={tab === "incoming"} className={tab === "incoming" ? "is-active" : ""} onClick={() => setTab("incoming")}>{t("chat.incoming")}</button>
          <button type="button" role="tab" aria-selected={tab === "requests"} className={tab === "requests" ? "is-active" : ""} onClick={() => setTab("requests")}>{t("chat.requests")}{requests.length ? ` · ${requests.length}` : ""}</button>
        </div>
      </div>
      <section className="mobile-messages-list" role="tabpanel">
        {tab === "incoming" ? filteredFriends.map((friend) => (
          <button type="button" className="mobile-message-row" key={friend.id} onClick={() => onSelectFriend(friend)}>
            <Avatar friend={friend} size="md" />
            <span className="mobile-message-copy">
              <span className="mobile-message-topline"><strong data-i18n-skip>{friend.name}</strong><small data-i18n-skip>{friend.time}</small></span>
              {friend.username && <small className="mobile-message-username" data-i18n-skip>@{friend.username}</small>}
              <span className="mobile-message-bottomline"><span data-i18n-skip>{friend.lastMessage}</span>{friend.unread ? <b aria-label={`${friend.unread}`}>{friend.unread > 99 ? "99+" : friend.unread}</b> : null}</span>
            </span>
          </button>
        )) : filteredRequests.map((request) => {
          const message = request.message?.trim() || t("chat.requestPending");
          return <button type="button" className="mobile-message-row mobile-request-row" key={request.id} onClick={() => onOpenRequest(request.friend.id)} aria-label={t("chat.openProfile", { name: request.friend.name })}>
            <Avatar friend={request.friend} size="md" />
            <span className="mobile-message-copy">
              <span className="mobile-message-topline"><strong data-i18n-skip>{request.friend.name}</strong><small>{t("chat.incoming")}</small></span>
              {request.friend.username && <small className="mobile-message-username" data-i18n-skip>@{request.friend.username}</small>}
              <span className="mobile-message-bottomline"><span data-i18n-skip>{message}</span></span>
            </span>
          </button>;
        })}
        {tab === "incoming" && !filteredFriends.length && <p className="mobile-messages-empty">{normalizedQuery ? t("common.nothingFound") : t("chat.noConversations")}</p>}
        {tab === "requests" && !filteredRequests.length && <p className="mobile-messages-empty">{normalizedQuery ? t("common.nothingFound") : t("chat.noIncomingRequests")}</p>}
      </section>
    </main>
  );
}
