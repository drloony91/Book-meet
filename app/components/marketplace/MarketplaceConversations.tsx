import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import { apiFetch } from "../../services/api";
import type { MarketplaceListing } from "./MarketplaceListings";

type ConversationCard = { id: number; unavailable: boolean; label?: string; title?: string; author?: string; price?: number | null; currency?: string | null; status?: string };
type Conversation = { id: number; buyerId: number; sellerId: number; mine: "buyer" | "seller"; listing: ConversationCard; safetyWarning: string };
type ChatMessage = { id: number; senderId: number | null; mine: boolean; body: string; createdAt: string };

function words(locale: string, ru: string, kk: string, en: string) { return locale === "kk" ? kk : locale === "en" ? en : ru; }
async function json(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : response.statusText);
  return payload;
}

export default function MarketplaceConversations({ listingToStart, onClose }: { listingToStart: MarketplaceListing | null; onClose: () => void }) {
  const { locale } = useI18n();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = active?.id ?? null;

  const refreshList = useCallback(async () => {
    try {
      const result = await json(await apiFetch("/api/marketplace/conversations")) as { conversations: Conversation[] };
      setConversations(result.conversations);
      setActive((current) => current ? result.conversations.find((item) => item.id === current.id) ?? current : null);
    } catch (error) { setNotice((error as Error).message); }
  }, []);
  const refreshMessages = useCallback(async (conversationId: number, beforeId?: number | null) => {
    try {
      const url = `/api/marketplace/conversations/${conversationId}/messages${beforeId ? `?beforeId=${beforeId}` : ""}`;
      const result = await json(await apiFetch(url)) as { messages: ChatMessage[]; nextBeforeId: number | null };
      if (activeIdRef.current !== conversationId) return;
      setMessages((current) => [...new Map([...result.messages, ...current].map((item) => [item.id, item])).values()].sort((a, b) => a.id - b.id));
      setNextBeforeId(result.nextBeforeId);
    } catch (error) { if (activeIdRef.current === conversationId) setNotice((error as Error).message); }
  }, []);
  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => {
    if (!active) return;
    setMessages([]); setNextBeforeId(null);
    void refreshMessages(active.id);
  }, [active?.id, refreshMessages]);
  useEffect(() => {
    const onRefresh = () => { void refreshList(); if (active) void refreshMessages(active.id); };
    window.addEventListener("bookmeet:marketplace-chat-refresh", onRefresh);
    return () => window.removeEventListener("bookmeet:marketplace-chat-refresh", onRefresh);
  }, [active?.id, refreshList, refreshMessages]);

  async function start() {
    if (!listingToStart) return;
    setBusy(true); setNotice("");
    try {
      const result = await json(await apiFetch(`/api/marketplace/listings/${listingToStart.id}/conversations`, { method: "POST" })) as { conversation: Conversation };
      setStarted(true);
      setActive(result.conversation);
      await refreshList();
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    setBusy(true); setNotice("");
    try {
      const result = await json(await apiFetch(`/api/marketplace/conversations/${active.id}/messages`, { method: "POST", body: JSON.stringify({ body: draft.trim() }) })) as { message: ChatMessage };
      if (activeIdRef.current === active.id) setMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message]);
      setDraft("");
      await refreshList();
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function hide() {
    if (!active) return;
    setBusy(true); setNotice("");
    try {
      await json(await apiFetch(`/api/marketplace/conversations/${active.id}`, { method: "DELETE" }));
      setConversations((current) => current.filter((item) => item.id !== active.id));
      setActive(null); setMessages([]);
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function report(event: FormEvent) {
    event.preventDefault();
    if (!active || !reportReason.trim()) return;
    setBusy(true); setNotice("");
    try {
      await json(await apiFetch("/api/reports", { method: "POST", body: JSON.stringify({ targetKind: "marketplace_conversation", targetId: active.id, reason: reportReason.trim() }) }));
      setReportOpen(false); setReportReason("");
      setNotice(words(locale, "Жалоба отправлена", "Шағым жіберілді", "Report submitted"));
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }

  const showStart = listingToStart && !started && !active;
  return <div className="marketplace-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="marketplace-dialog marketplace-conversations" role="dialog" aria-modal="true" aria-labelledby="marketplace-conversations-title">
      <button className="marketplace-close" type="button" onClick={onClose} aria-label={words(locale, "Закрыть", "Жабу", "Close")}>×</button>
      <h2 id="marketplace-conversations-title">{words(locale, "Диалоги по объявлениям", "Хабарландыру диалогтары", "Listing conversations")}</h2>
      {notice && <p className="marketplace-notice" role="alert">{notice}</p>}
      {showStart ? <div className="marketplace-conversation-start"><h3>{listingToStart.title}</h3><p>{listingToStart.author}</p><div className="marketplace-safety-box">{words(locale, "Book Meet не принимает оплату и не участвует в сделке. Не переводите предоплату незнакомым людям и выбирайте безопасное место встречи.", "Book Meet төлем қабылдамайды және мәмілеге қатыспайды. Бейтаныс адамдарға алдын ала төлем жібермеңіз және қауіпсіз кездесу орнын таңдаңыз.", "Book Meet does not process payments or take part in the deal. Avoid advance payments to strangers and choose a safe meeting place.")}</div><button className="marketplace-primary" type="button" disabled={busy} onClick={() => void start()}>{words(locale, "Начать диалог", "Диалогты бастау", "Start conversation")}</button></div> : null}
      <div className="marketplace-conversation-layout">
        <nav className="marketplace-conversation-list" aria-label={words(locale, "Список диалогов", "Диалогтар тізімі", "Conversation list")}>
          {conversations.length ? conversations.map((item) => <button type="button" key={item.id} className={active?.id === item.id ? "is-active" : ""} onClick={() => { setActive(item); setNotice(""); setReportOpen(false); }}><strong>{item.listing.unavailable ? item.listing.label : item.listing.title}</strong><span>{item.listing.unavailable ? "" : item.listing.author}</span></button>) : <p>{words(locale, "Диалогов пока нет", "Әзірше диалог жоқ", "No conversations yet")}</p>}
        </nav>
        {active && <div className="marketplace-conversation-thread"><div className="marketplace-conversation-card"><strong>{active.listing.unavailable ? active.listing.label : active.listing.title}</strong>{!active.listing.unavailable && <span>{active.listing.author} · {active.listing.status}</span>}</div><div className="marketplace-safety-box">{active.safetyWarning}</div><div className="marketplace-conversation-messages" aria-label={words(locale, "Сообщения", "Хабарлар", "Messages")}>{nextBeforeId && <button type="button" onClick={() => void refreshMessages(active.id, nextBeforeId)}>{words(locale, "Ранее", "Алдыңғы", "Earlier")}</button>}{messages.map((item) => <p key={item.id} className={item.mine ? "is-mine" : ""}><span>{item.body}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)}</time></p>)}</div>{!active.listing.unavailable && ["active", "reserved"].includes(active.listing.status ?? "") && <form className="marketplace-conversation-send" onSubmit={(event) => void send(event)}><label><span>{words(locale, "Сообщение", "Хабар", "Message")}</span><textarea required maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} /></label><button className="marketplace-primary" type="submit" disabled={busy || !draft.trim()}>{words(locale, "Отправить", "Жіберу", "Send")}</button></form>}<div className="marketplace-conversation-actions"><button type="button" disabled={busy} onClick={() => void hide()}>{words(locale, "Убрать из моих диалогов", "Менің диалогтарымнан алып тастау", "Remove from my conversations")}</button><button type="button" onClick={() => setReportOpen((value) => !value)}>{words(locale, "Пожаловаться", "Шағымдану", "Report")}</button></div>{reportOpen && <form className="marketplace-conversation-report" onSubmit={(event) => void report(event)}><label><span>{words(locale, "Причина жалобы", "Шағым себебі", "Reason for report")}</span><textarea required maxLength={5000} value={reportReason} onChange={(event) => setReportReason(event.target.value)} /></label><button type="submit" disabled={busy}>{words(locale, "Отправить жалобу", "Шағым жіберу", "Submit report")}</button></form>}</div>}
      </div>
    </section>
  </div>;
}
