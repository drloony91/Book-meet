import { useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "../chat/types";
import type { DemoUser } from "../../types/domain";
import { useI18n } from "../../i18n";

export function MaterialSharePicker({ attachment, recipients, onClose, onSend }: { attachment: ChatAttachment; recipients: DemoUser[]; onClose: () => void; onSend: (targetId: number, attachment: ChatAttachment) => Promise<void> }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (!sent) return; const timer = window.setTimeout(onClose, 2000); return () => window.clearTimeout(timer); }, [sent, onClose]);
  const needle = query.trim().toLocaleLowerCase("ru");
  const visible = recipients.filter((user) => !needle || `${user.profile.name} ${user.username}`.toLocaleLowerCase("ru").includes(needle));
  async function send(user: DemoUser) {
    if (sending || sent) return;
    setSending(user.id); setError("");
    try { await onSend(user.id, attachment); setSent(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("share.error")); }
    finally { setSending(null); }
  }
  return <div className="nested-modal-backdrop material-share-backdrop" onMouseDown={onClose}><section className="material-share-picker" role="dialog" aria-modal="true" aria-label={t("share.title")} onMouseDown={(event) => event.stopPropagation()}><header><h2>{sent ? t("share.sent") : t("share.title")}</h2><button type="button" aria-label={t("common.close")} onClick={onClose}>×</button></header>{!sent && <><input ref={input} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("share.searchFriends")} aria-label={t("share.searchFriends")} /><div className="material-share-recipients">{visible.map((user) => <button key={user.id} type="button" disabled={sending !== null} onClick={() => void send(user)}><span className={`avatar avatar-sm avatar-${user.color}`}>{user.avatarUrl ? "" : user.initials}</span><span data-i18n-skip><strong>{user.profile.name}</strong><small>@{user.username}</small></span>{sending === user.id && <i>{t("share.sending")}</i>}</button>)}{!visible.length && <p>{t("share.emptyFriends")}</p>}</div>{error && <p className="form-error" role="alert">{error}</p>}</>}</section></div>;
}
