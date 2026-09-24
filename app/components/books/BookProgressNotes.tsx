import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { apiFetch } from "../../services/api";
import type { LibraryBook } from "../../types/domain";
import { openReportDialog } from "../safety/SafetyCenter";

export type NoteProgress = { unit: "pages" | "chapters"; current: number; total: number; percent: number };
export type BookProgressNote = {
  id: number; userId: number; bookId: number; readingCycleId: number | null; body: string;
  progressUnit: NoteProgress["unit"]; progressCurrent: number; progressTotal: number; progressPercent: number;
  createdAt: string; updatedAt: string;
  author: { id: number; name: string; initials: string; avatarUrl?: string };
};

export function noteProgress(book: LibraryBook): NoteProgress | null {
  const unit = book.progressUnit;
  if (book.readingStatus !== "reading" || (unit !== "pages" && unit !== "chapters")) return null;
  const current = unit === "pages" ? book.pagesCurrent : book.chaptersCurrent;
  const total = unit === "pages" ? book.pagesTotal : book.chaptersTotal;
  if (typeof current !== "number" || typeof total !== "number" || !Number.isInteger(current) || !Number.isInteger(total) || current < 0 || total <= 0 || current > total || total > 4_294_967_295) return null;
  return { unit, current, total, percent: Math.floor(current / total * 100) };
}

function isNote(value: unknown): value is BookProgressNote {
  if (!value || typeof value !== "object") return false;
  const note = value as BookProgressNote;
  return Number.isSafeInteger(note.id) && note.id > 0 && Number.isSafeInteger(note.userId) && Number.isSafeInteger(note.bookId) && typeof note.body === "string" && note.body.length > 0 && Array.from(note.body).length <= 3000 && (note.progressUnit === "pages" || note.progressUnit === "chapters") && Number.isInteger(note.progressCurrent) && Number.isInteger(note.progressTotal) && note.progressCurrent >= 0 && note.progressTotal > 0 && note.progressCurrent <= note.progressTotal && Number.isInteger(note.progressPercent) && note.progressPercent === Math.floor(note.progressCurrent / note.progressTotal * 100) && typeof note.createdAt === "string" && typeof note.updatedAt === "string" && Boolean(note.author) && Number.isSafeInteger(note.author.id) && typeof note.author.name === "string" && typeof note.author.initials === "string";
}

async function noteRequest(path: string, method = "GET", body?: unknown) {
  const response = await apiFetch(path, { method, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data && typeof data.error === "string" ? data.error : "Could not load or save the note");
  return data;
}

function ProgressLabel({ progress }: { progress: NoteProgress }) {
  const { t } = useI18n();
  return <span className="book-note-progress">{t(progress.unit === "pages" ? "notes.pages" : "notes.chapters", { current: progress.current, total: progress.total })} ({progress.percent}%)</span>;
}

export function SaveBookNote({ bookId, draft, pending }: { bookId: number; draft: LibraryBook; pending: boolean }) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState<{ body: string; progress: NoteProgress } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const progress = noteProgress(draft);
  const body = (draft.readingComment ?? "").trim();
  const valid = progress !== null && body.length > 0 && Array.from(body).length <= 3000;
  useEffect(() => { setSaved(false); }, [body, progress?.unit, progress?.current, progress?.total]);
  if (draft.readingStatus !== "reading") return null;
  async function save() {
    if (!confirmation || busy) return;
    setBusy(true); setError("");
    try {
      const data = await noteRequest(`/api/books/${bookId}/notes`, "POST", { body: confirmation.body, expectedProgress: confirmation.progress });
      if (!isNote(data?.note)) throw new Error(t("notes.invalidResponse"));
      setConfirmation(null); setSaved(true);
      window.dispatchEvent(new CustomEvent("bookmeet:notes-changed", { detail: { bookId } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.error")); }
    finally { setBusy(false); }
  }
  return <div className="book-note-create"><button type="button" className="outline-button" disabled={!valid || pending || busy} onClick={() => { if (progress) { setConfirmation({ body, progress }); setError(""); } }}>{t("notes.saveNote")}</button>{saved && <span role="status">{t("notes.saved")}</span>}
    {confirmation && createPortal(<div className="nested-modal-backdrop book-note-confirm-backdrop" onMouseDown={() => { if (!busy) setConfirmation(null); }}><section className="book-note-confirm" role="dialog" aria-modal="true" aria-label={t("notes.confirm")} onMouseDown={(event) => event.stopPropagation()}><h2>{t("notes.confirm")}</h2><ProgressLabel progress={confirmation.progress} /><p className="book-note-body" data-i18n-skip>{confirmation.body}</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>{t("common.save")}</button><button type="button" className="outline-button" disabled={busy} onClick={() => setConfirmation(null)}>{t("common.cancel")}</button></div></section></div>, document.body)}
  </div>;
}

export function BookProgressNotes({ bookId, viewerId, visibilityKey }: { bookId: number; viewerId: number; visibilityKey: string }) {
  const { t, formatDate } = useI18n();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [notes, setNotes] = useState<BookProgressNote[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const requestEpoch = useRef(0);
  useEffect(() => {
    const refresh = (event: Event) => { if ((event as CustomEvent<{ bookId: number }>).detail?.bookId === bookId) setRevision((value) => value + 1); };
    const realtime = () => setRevision((value) => value + 1);
    window.addEventListener("bookmeet:notes-changed", refresh);
    window.addEventListener("bookmeet:materials-refreshed", realtime);
    return () => { window.removeEventListener("bookmeet:notes-changed", refresh); window.removeEventListener("bookmeet:materials-refreshed", realtime); };
  }, [bookId]);
  useEffect(() => { setEditingId(null); }, [bookId, viewerId, scope]);
  async function load(next: number | null, epoch: number) {
    setLoading(true); setError("");
    try {
      const data = await noteRequest(`/api/books/${bookId}/notes?scope=${scope}${next === null ? "" : `&cursor=${next}`}`);
      if (!data || !Array.isArray(data.notes) || !data.notes.every(isNote) || !(data.nextCursor === null || Number.isSafeInteger(data.nextCursor) && data.nextCursor > 0)) throw new Error(t("notes.invalidResponse"));
      if (requestEpoch.current !== epoch) return;
      setNotes((current) => next === null ? data.notes : [...current, ...data.notes.filter((note: BookProgressNote) => !current.some((item) => item.id === note.id))]); setCursor(data.nextCursor);
    } catch (cause) { if (requestEpoch.current === epoch) setError(cause instanceof Error ? cause.message : t("common.error")); }
    finally { if (requestEpoch.current === epoch) setLoading(false); }
  }
  useEffect(() => {
    const epoch = ++requestEpoch.current;
    setNotes([]); setCursor(null);
    void load(null, epoch);
    return () => { requestEpoch.current += 1; };
  }, [bookId, viewerId, scope, revision, visibilityKey]);
  async function mutate(note: BookProgressNote, method: "PATCH" | "DELETE") {
    if (busy || method === "DELETE" && !window.confirm(t("notes.deleteConfirm"))) return;
    setBusy(true); setError(""); requestEpoch.current += 1;
    try {
      const data = await noteRequest(`/api/book-notes/${note.id}`, method, method === "PATCH" ? { body: editBody.trim() } : undefined);
      if (method === "PATCH" && !isNote(data?.note)) throw new Error(t("notes.invalidResponse"));
      setEditingId(null); setRevision((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.error")); }
    finally { setBusy(false); setLoading(false); }
  }
  return <div className="book-progress-notes"><p className="book-notes-hint">{t("notes.gateHint")}</p><div className="book-notes-scopes" role="group" aria-label={t("notes.title")}><button type="button" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>{t("notes.mine")}</button><button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>{t("notes.all")}</button></div>
    {notes.map((note) => <article className="book-note-card" key={note.id}><header><span className="avatar avatar-sm" style={note.author.avatarUrl ? { backgroundImage: `url(${note.author.avatarUrl})` } : undefined} data-i18n-skip>{!note.author.avatarUrl && note.author.initials}</span><strong data-i18n-skip>{note.author.name}</strong><time dateTime={note.createdAt}>{formatDate(note.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time></header><ProgressLabel progress={{ unit: note.progressUnit, current: note.progressCurrent, total: note.progressTotal, percent: note.progressPercent }} />
      {editingId === note.id ? <div className="book-note-edit"><label>{t("notes.text")}<textarea rows={5} maxLength={6000} value={editBody} onChange={(event) => setEditBody(event.target.value)} /></label><button type="button" disabled={busy || !editBody.trim() || Array.from(editBody.trim()).length > 3000} onClick={() => void mutate(note, "PATCH")}>{t("common.save")}</button><button type="button" disabled={busy} onClick={() => setEditingId(null)}>{t("common.cancel")}</button></div> : <p className="book-note-body" data-i18n-skip>{note.body}</p>}
      <footer>{note.userId === viewerId ? <><button type="button" disabled={busy} onClick={() => { setEditingId(note.id); setEditBody(note.body); }}>{t("common.edit")}</button><button type="button" disabled={busy} onClick={() => void mutate(note, "DELETE")}>{t("common.delete")}</button></> : <button type="button" onClick={() => openReportDialog({ kind: "book_note", id: note.id })}>{t("safety.report")}</button>}</footer></article>)}
    {loading && <p role="status">{t("common.loading")}</p>}{error && <p className="form-error" role="alert">{error}</p>}{!loading && !error && !notes.length && <p>{t("notes.empty")}</p>}{cursor !== null && <button type="button" disabled={loading || busy} onClick={() => void load(cursor, requestEpoch.current)}>{t("feed.loadMore")}</button>}
  </div>;
}
