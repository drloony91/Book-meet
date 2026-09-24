import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../services/api";
import { useI18n } from "../../i18n";
import { ReadingPresenceAvatars } from "./ReadingPresenceAvatars";

type Session = { id: number; bookId: number; date: string; timezone: string; source: "timer" | "manual"; state: "running" | "paused" | "closed"; durationSeconds: number; startedAt?: string; runningSince?: string; leaseExpiresAt?: string; requiresResumeConfirmation?: boolean };
type ManualForm = { date: string; hours: string; minutes: string; seconds: string };
const todayLocal = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const emptyForm = (): ManualForm => ({ date: todayLocal(), hours: "0", minutes: "0", seconds: "0" });
const clock = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
const elapsed = (session: Session) => Math.max(0, session.durationSeconds + (session.state === "running" && session.runningSince ? Math.min(Math.floor((Date.now() - Date.parse(session.runningSince)) / 1000), Math.max(0, Math.floor((Date.parse(session.leaseExpiresAt ?? session.runningSince) - Date.parse(session.runningSince)) / 1000))) : 0));

export function ReadingSessions({ bookId, bookTitle, self }: { bookId: number; bookTitle: string; self: { id: number; initials: string; color: string; avatarUrl?: string } }) {
  const { locale } = useI18n();
  const tr = (ru: string, kk: string, en: string) => locale === "kk" ? kk : locale === "en" ? en : ru;
  const [session, setSession] = useState<Session | null>(null);
  const [focused, setFocused] = useState(false);
  const [opened, setOpened] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [form, setForm] = useState<ManualForm>(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(tick); }, []);
  useEffect(() => { void apiFetch("/api/reading-sessions/active").then((response) => response.ok ? response.json() : null).then((data) => { if (data?.session) { setSession(data.session); if (data.session.bookId === bookId) setFocused(true); } }).catch(() => undefined); }, [bookId]);
  useEffect(() => {
    if (session?.state !== "running") return;
    const beat = window.setInterval(async () => {
      try {
        const response = await apiFetch(`/api/reading-sessions/${session.id}/heartbeat`, { method: "POST" });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.session) setSession(data.session);
        else if (data.session) setSession(data.session);
      } catch { /* server lease bounds display through network interruptions */ }
    }, 30_000);
    return () => window.clearInterval(beat);
  }, [session?.id, session?.state]);
  useEffect(() => { if (opened) void refreshList(); }, [opened, bookId]);
  async function refreshList() {
    try { const response = await apiFetch(`/api/books/${bookId}/reading-sessions`); const data = await response.json(); if (response.ok) setSessions(data.sessions ?? []); }
    catch { setError(tr("Не удалось загрузить сессии чтения", "Оқу сессияларын жүктеу мүмкін болмады", "Could not load reading sessions")); }
  }
  async function request(path: string, method = "POST", body?: unknown) {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.code === "READING_SESSION_ACTIVE_OTHER_BOOK") {
        if (!window.confirm(tr("Уже идёт чтение другой книги. Завершить текущую сессию и переключиться?", "Басқа кітапты оқу жүріп жатыр. Ағымдағы сессияны аяқтап, ауысасыз ба?", "Another book has an active session. Stop it and switch books?"))) return null;
        const stopped = await apiFetch(`/api/reading-sessions/${data.session.id}/stop`, { method: "POST" });
        if (!stopped.ok) throw new Error(tr("Не удалось завершить текущую сессию", "Ағымдағы сессияны аяқтау мүмкін болмады", "Could not stop the current session"));
        return await request(path, method, body);
      }
      if (response.status === 409 && data.code === "READING_SESSION_RESUME_CONFIRMATION_REQUIRED") {
        if (!window.confirm(tr("Сессия давно не обновлялась. Продолжить таймер с сохранённого времени?", "Сессия ұзақ уақыт жаңартылмады. Сақталған уақыттан таймерді жалғастырасыз ба?", "This session has been inactive for a while. Resume from the saved time?"))) { setSession(data.session); return null; }
        return await request(path, method, { ...(typeof body === "object" && body ? body : {}), confirmExpired: true });
      }
      if (!response.ok) throw new Error(data.error || tr("Не удалось выполнить действие", "Әрекетті орындау мүмкін болмады", "Could not complete the action"));
      if (data.session) setSession(data.session);
      return data;
    } catch (reason) { setError(reason instanceof Error ? reason.message : tr("Проблема с соединением", "Байланыс қатесі", "Connection error")); return null; }
    finally { setBusy(false); }
  }
  async function start() { const result = await request(`/api/books/${bookId}/reading-sessions/timer/start`); if (result?.session) { setSession(result.session); setFocused(true); } }
  async function pauseOrResume() { if (!session) return; await request(`/api/reading-sessions/${session.id}/${session.state === "running" ? "pause" : "resume"}`); }
  async function stop() { if (!session || !window.confirm(tr("Завершить текущую сессию чтения?", "Оқу сессиясын аяқтайсыз ба?", "Stop this reading session?"))) return; const result = await request(`/api/reading-sessions/${session.id}/stop`); if (result) { setSession(null); setFocused(false); } }
  const ownSession = session?.bookId === bookId ? session : null;
  const seconds = useMemo(() => ownSession ? elapsed(ownSession) : 0, [ownSession, now]);
  const formDuration = Number(form.hours) * 3600 + Number(form.minutes) * 60 + Number(form.seconds);
  const formValid = /^\d{4}-\d{2}-\d{2}$/.test(form.date) && form.date <= todayLocal() && Number.isInteger(Number(form.hours)) && Number(form.hours) >= 0 && Number(form.hours) <= 24 && Number.isInteger(Number(form.minutes)) && Number(form.minutes) >= 0 && Number(form.minutes) <= 59 && Number.isInteger(Number(form.seconds)) && Number(form.seconds) >= 0 && Number(form.seconds) <= 59 && formDuration > 0 && formDuration <= 86400;
  async function saveManual(event: React.FormEvent) {
    event.preventDefault(); if (!formValid) return;
    const body = { date: form.date, hours: Number(form.hours), minutes: Number(form.minutes), seconds: Number(form.seconds) };
    const result = await request(editId ? `/api/reading-sessions/${editId}` : `/api/books/${bookId}/reading-sessions`, editId ? "PATCH" : "POST", body);
    if (result) { setForm(emptyForm()); setEditId(null); await refreshList(); }
  }
  async function edit(item: Session) { if (item.state !== "closed") { window.alert(tr("Сначала завершите сессию чтения", "Алдымен оқу сессиясын аяқтаңыз", "Stop the reading session before editing it")); return; } setEditId(item.id); setForm({ date: item.date, hours: String(Math.floor(item.durationSeconds / 3600)), minutes: String(Math.floor(item.durationSeconds / 60) % 60), seconds: String(item.durationSeconds % 60) }); }
  async function remove(item: Session) { if (!window.confirm(tr("Удалить эту сессию чтения?", "Бұл оқу сессиясын жоясыз ба?", "Delete this reading session?"))) return; const result = await request(`/api/reading-sessions/${item.id}`, "DELETE"); if (result) await refreshList(); }
  return <>
    {focused && <div className="reading-focus-backdrop"><section className="reading-focus-panel" role="region" aria-label={`${tr("Чтение", "Оқу", "Reading")}: ${bookTitle}`}><button className="modal-close" type="button" aria-label={tr("Закрыть режим чтения", "Оқу режимін жабу", "Close reading mode")} onClick={() => setFocused(false)}>×</button><span className="section-subtitle">{tr("СЕЙЧАС ЧИТАЮ", "ҚАЗІР ОҚЫП ЖАТЫРМЫН", "READING NOW")}</span><h2>{bookTitle}</h2><output className="reading-focus-clock" aria-live="off">{clock(seconds)}</output><div className="reading-focus-actions"><button className="primary-button" type="button" disabled={busy} onClick={() => ownSession ? void pauseOrResume() : void start()}>{ownSession?.state === "running" ? tr("Пауза", "Үзіліс", "Pause") : ownSession?.state === "paused" ? tr("Продолжить", "Жалғастыру", "Resume") : tr("▶ Пуск", "▶ Бастау", "▶ Play")}</button>{ownSession && <button className="quiet-danger-button" type="button" disabled={busy} onClick={() => void stop()}>{tr("Стоп", "Тоқтату", "Stop")}</button>}</div><ReadingPresenceAvatars bookId={bookId} running={ownSession?.state === "running"} self={self} />{error && <p className="form-error">{error}</p>}</section></div>}
    {ownSession ? <button className="reading-session-open" type="button" onClick={() => setFocused(true)}>{ownSession.state === "running" ? clock(seconds) : tr("Продолжить чтение", "Оқуды жалғастыру", "Resume reading")}</button> : <button className="primary-button reading-start-button" type="button" disabled={busy} onClick={() => setFocused(true)}>{tr("Читать", "Оқу", "Read")} <span>▶</span></button>}
    <button className="reading-session-list-button" type="button" onClick={() => setOpened(true)}>{tr("Сессии чтения", "Оқу сессиялары", "Reading sessions")}</button>
    {opened && <div className="nested-modal-backdrop reading-sessions-backdrop" onMouseDown={() => setOpened(false)}><section className="reading-sessions-panel" role="dialog" aria-modal="true" aria-label={tr("Сессии чтения", "Оқу сессиялары", "Reading sessions")} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label={tr("Закрыть", "Жабу", "Close")} onClick={() => setOpened(false)}>×</button><h2>{tr("Сессии чтения", "Оқу сессиялары", "Reading sessions")}</h2><div className="reading-session-list">{sessions.map((item) => <article key={item.id}><div><strong>{item.date}</strong><small>{item.source === "timer" ? tr("Таймер", "Таймер", "Timer") : tr("Вручную", "Қолмен", "Manual")}</small></div><b>{clock(item.durationSeconds)}</b><button type="button" onClick={() => void edit(item)} aria-label={tr("Изменить сессию", "Сессияны өзгерту", "Edit session")}>{tr("Изменить", "Өзгерту", "Edit")}</button><button className="quiet-danger-button" type="button" onClick={() => void remove(item)} aria-label={tr("Удалить сессию", "Сессияны жою", "Delete session")}>{tr("Удалить", "Жою", "Delete")}</button></article>)}{!sessions.length && <p>{tr("Пока нет записанных сессий", "Әзірге жазылған сессиялар жоқ", "No reading sessions yet")}</p>}</div><form className="reading-session-form" onSubmit={(event) => void saveManual(event)}><h3>{editId ? tr("Изменить запись", "Жазбаны өзгерту", "Edit entry") : tr("Добавить вручную", "Қолмен қосу", "Add manually")}</h3><label>{tr("Когда", "Қашан", "Date")}<input type="date" value={form.date} max={todayLocal()} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label><fieldset><legend>{tr("Длительность чтения", "Оқу ұзақтығы", "Reading duration")}</legend>{(["hours", "minutes", "seconds"] as const).map((key) => <label key={key}>{key === "hours" ? tr("Часы", "Сағат", "Hours") : key === "minutes" ? tr("Минуты", "Минут", "Minutes") : tr("Секунды", "Секунд", "Seconds")}<input type="number" min={0} max={key === "hours" ? 24 : 59} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required /></label>)}</fieldset>{formDuration > 86400 && <small className="form-error">{tr("Максимум 24 часа", "Ең көбі 24 сағат", "Maximum 24 hours")}</small>}{error && <p className="form-error">{error}</p>}<div className="form-actions">{editId && <button type="button" onClick={() => { setEditId(null); setForm(emptyForm()); }}>{tr("Отмена", "Бас тарту", "Cancel")}</button>}<button className="primary-button" type="submit" disabled={!formValid || busy}>{editId ? tr("Сохранить", "Сақтау", "Save") : tr("Добавить", "Қосу", "Add")}</button></div></form></section></div>}
  </>;
}
