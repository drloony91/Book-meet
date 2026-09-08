import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import { normalizeBookSearchText } from "../../lib/domain";
import { closeActiveMobileWorkflow, openMobileWorkflowRoute, useRoutedPopup } from "../../navigation/routes";
import { apiFetch } from "../../services/api";
import { announceLibraryMutationStart } from "../../services/library-mutations";
import type { DemoUser, LibraryBook } from "../../types/domain";
import type { BookShelf, ShelfBook } from "../../types/shelves";
import { openReportDialog } from "../safety/SafetyCenter";

export function openShelf(id: number) { window.dispatchEvent(new CustomEvent("bookmeet:open-shelf", { detail: { id } })); }
export function openShelfEditor(id?: number) {
  openMobileWorkflowRoute(id ? { mode: "edit", kind: "shelf", id } : { mode: "create", kind: "shelf" });
  window.dispatchEvent(new CustomEvent("bookmeet:edit-shelf", { detail: { id: id ?? null } }));
}
function changed() { window.dispatchEvent(new CustomEvent("bookmeet:shelves-changed")); }
function characterCount(value: string) { return Array.from(value).length; }

export function useLibraryMode() {
  const [mode, setMode] = useState<"books" | "shelves">(() => {
    const background = window.history.state?.backgroundPath;
    const current = new URL(window.location.href);
    const source = current.searchParams.has("mode") ? current : background ? new URL(background, current.origin) : current;
    return source.searchParams.get("mode") === "shelves" ? "shelves" : "books";
  });
  const select = (next: "books" | "shelves") => {
    setMode(next);
    const url = new URL(window.location.href);
    if (next === "shelves") url.searchParams.set("mode", next); else url.searchParams.delete("mode");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };
  return [mode, select] as const;
}
export function LibraryModeSwitch({ mode, onChange }: { mode: "books" | "shelves"; onChange: (mode: "books" | "shelves") => void }) {
  const { t } = useI18n();
  return <div className="view-switcher library-mode-switch" role="group" aria-label={t("shelves.mode")}><button type="button" className={mode === "books" ? "active" : ""} aria-pressed={mode === "books"} onClick={() => onChange("books")}>{t("shelves.books")}</button><button type="button" className={mode === "shelves" ? "active" : ""} aria-pressed={mode === "shelves"} onClick={() => onChange("shelves")}>{t("shelves.label")}</button></div>;
}

export async function shelfRequest(path: string, method = "GET", body?: unknown) {
  const response = await apiFetch(path, { method, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not load or save the shelf");
  return data;
}
export function isBookShelf(value: unknown): value is BookShelf {
  if (!value || typeof value !== "object") return false;
  const shelf = value as BookShelf;
  return Number.isSafeInteger(shelf.id) && shelf.id > 0 && Number.isSafeInteger(shelf.ownerId) && typeof shelf.title === "string" && typeof shelf.description === "string" && Number.isInteger(shelf.bookCount) && shelf.bookCount >= 0 && typeof shelf.createdAt === "string" && typeof shelf.updatedAt === "string" && Boolean(shelf.owner) && typeof shelf.owner.name === "string" && typeof shelf.owner.initials === "string" && Array.isArray(shelf.items) && shelf.items.every((item) => Number.isInteger(item.position) && typeof item.description === "string" && (item.bookId === null || Number.isSafeInteger(item.bookId)) && (item.book === null || Number.isSafeInteger(item.book.id) && typeof item.book.title === "string" && typeof item.book.author === "string"));
}
function ShelfCover({ book }: { book: ShelfBook }) {
  return <div className={`shelf-book-cover library-cover-${book.coverTone ?? "blue"}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined} data-i18n-skip>{!book.coverUrl && <span>{book.title}</span>}</div>;
}
export function BookShelfCard({ shelf }: { shelf: BookShelf }) {
  const { t } = useI18n();
  return <button className="book-shelf-card" type="button" onClick={() => openShelf(shelf.id)}><h3 data-i18n-skip>{shelf.title}</h3>{shelf.description && <p data-i18n-skip>{shelf.description}</p>}<div className="shelf-cover-row">{shelf.items.filter((item) => item.book).slice(0, 4).map((item) => <ShelfCover key={item.position} book={item.book!} />)}</div><footer><span>{t("shelves.bookCount", { count: shelf.bookCount })}</span><span data-i18n-skip>{shelf.owner.name}</span></footer></button>;
}
export function BookShelfList({ ownerId }: { ownerId: number }) {
  const { t } = useI18n();
  const [shelves, setShelves] = useState<BookShelf[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("bookmeet:shelves-changed", refresh); window.addEventListener("bookmeet:materials-refreshed", refresh);
    return () => { window.removeEventListener("bookmeet:shelves-changed", refresh); window.removeEventListener("bookmeet:materials-refreshed", refresh); };
  }, []);
  async function load(next: number | null, version: number) {
    setLoading(true); setError("");
    try {
      const data = await shelfRequest(`/api/users/${ownerId}/shelves${next === null ? "" : `?cursor=${next}`}`);
      if (!Array.isArray(data?.shelves) || !data.shelves.every(isBookShelf) || !(data.nextCursor === null || Number.isSafeInteger(data.nextCursor) && data.nextCursor > 0)) throw new Error(t("shelves.invalidResponse"));
      if (epoch.current === version) { setShelves((current) => next === null ? data.shelves : [...current, ...data.shelves.filter((shelf: BookShelf) => !current.some((item) => item.id === shelf.id))]); setCursor(data.nextCursor); }
    } catch (cause) { if (epoch.current === version) setError(cause instanceof Error ? cause.message : t("common.error")); }
    finally { if (epoch.current === version) setLoading(false); }
  }
  useEffect(() => { const version = ++epoch.current; setShelves([]); setCursor(null); void load(null, version); return () => { epoch.current += 1; }; }, [ownerId, revision]);
  return <div className="book-shelf-list">{shelves.map((shelf) => <BookShelfCard key={shelf.id} shelf={shelf} />)}{loading && <p role="status">{t("common.loading")}</p>}{error && <p role="alert" className="form-error">{error}</p>}{!loading && !error && !shelves.length && <p>{t("shelves.empty")}</p>}{cursor !== null && <button type="button" disabled={loading} onClick={() => void load(cursor, epoch.current)}>{t("feed.loadMore")}</button>}</div>;
}

export function BookShelfEditor({ id, viewer, onClose }: { id: number | null; viewer: DemoUser; onClose: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [items, setItems] = useState<Array<{ bookId: number; description: string }>>([]);
  const [query, setQuery] = useState(""); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(id !== null); const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(id === null);
  const books = viewer.books;
  const tokens = normalizeBookSearchText(query).split(" ").filter(Boolean);
  const matches = books.filter((book) => !items.some((item) => item.bookId === (book.catalogBookId ?? book.id)) && tokens.every((token) => normalizeBookSearchText(`${book.title} ${book.author}`).includes(token))).slice(0, 20);
  useEffect(() => {
    if (id === null) return;
    let active = true;
    void shelfRequest(`/api/shelves/${id}`).then((data) => {
      if (!isBookShelf(data?.shelf) || data.shelf.ownerId !== viewer.id) throw new Error(t("shelves.unavailable"));
      if (!active) return;
      setTitle(data.shelf.title); setDescription(data.shelf.description); setItems((data.shelf as BookShelf).items.filter((item) => item.bookId !== null).map((item) => ({ bookId: item.bookId!, description: item.description }))); setLoaded(true);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t("common.error")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, viewer.id]);
  const valid = loaded && characterCount(title.trim()) >= 1 && characterCount(title.trim()) <= 120 && characterCount(description.trim()) <= 500 && items.length >= 1 && items.every((item) => characterCount(item.description.trim()) <= 500 && books.some((book) => (book.catalogBookId ?? book.id) === item.bookId));
  async function save() {
    if (!valid || busy) return;
    setBusy(true); setError("");
    try {
      const data = await shelfRequest(id === null ? "/api/shelves" : `/api/shelves/${id}`, id === null ? "POST" : "PATCH", { title: title.trim(), description: description.trim(), items });
      if (!isBookShelf(data?.shelf)) throw new Error(t("shelves.invalidResponse"));
      changed(); onClose(); closeActiveMobileWorkflow("/profile/library?mode=shelves");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.error")); }
    finally { setBusy(false); }
  }
  const close = () => { if (!busy) { onClose(); closeActiveMobileWorkflow("/profile/library?mode=shelves"); } };
  function move(index: number, direction: number) { setItems((current) => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); }
  return <div className="modal-backdrop workflow-page-backdrop shelf-editor-backdrop" onMouseDown={close}><section className="book-shelf-editor" role="dialog" aria-modal="true" aria-label={t(id === null ? "shelves.create" : "shelves.edit")} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="shelf-close" aria-label={t("common.close")} onClick={close}>×</button><button type="button" className="shelf-mobile-back" onClick={close}>← {t("common.back")}</button><h2>{t(id === null ? "shelves.create" : "shelves.edit")}</h2>{loading && <p role="status">{t("common.loading")}</p>}<form onSubmit={(event) => { event.preventDefault(); void save(); }}><label>{t("shelves.title")} *<input required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>{t("shelves.description")}<textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><h3>{t("shelves.addFromLibrary")}</h3><label>{t("shelves.search")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="shelf-book-options">{matches.map((book) => <button key={book.catalogBookId ?? book.id} type="button" onClick={() => { setItems((current) => [...current, { bookId: book.catalogBookId ?? book.id, description: "" }]); setQuery(""); }} data-i18n-skip>{book.title} — {book.author}</button>)}</div>{!matches.length && <p>{t("common.nothingFound")}</p>}<ol className="shelf-selected-books">{items.map((item, index) => { const book = books.find((entry) => (entry.catalogBookId ?? entry.id) === item.bookId); return <li key={item.bookId}><strong data-i18n-skip>{book ? `${book.title} — ${book.author}` : t("shelves.unavailable")}</strong><div className="shelf-order-actions"><button type="button" disabled={index === 0} aria-label={t("shelves.moveUp")} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === items.length - 1} aria-label={t("shelves.moveDown")} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={t("shelves.removeBook")} onClick={() => setItems((current) => current.filter((entry) => entry.bookId !== item.bookId))}>×</button></div><label>{t("shelves.bookDescription")}<textarea rows={2} maxLength={1000} value={item.description} onChange={(event) => setItems((current) => current.map((entry) => entry.bookId === item.bookId ? { ...entry, description: event.target.value } : entry))} /></label></li>; })}</ol>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="submit" className="primary-button" disabled={!valid || busy}>{t(id === null ? "common.publish" : "common.save")}</button><button type="button" disabled={busy} onClick={close}>{t("common.cancel")}</button></div></form></section></div>;
}

export function BookShelfDialog({ id, viewer, onClose, onOpenBook, renderActions }: { id: number; viewer: DemoUser; onClose: () => void; onOpenBook: (id: number) => void; renderActions: (shelf: BookShelf) => ReactNode }) {
  const { t } = useI18n(); const [shelf, setShelf] = useState<BookShelf | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false); const [result, setResult] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("bookmeet:shelves-changed", refresh); window.addEventListener("bookmeet:materials-refreshed", refresh);
    return () => { window.removeEventListener("bookmeet:shelves-changed", refresh); window.removeEventListener("bookmeet:materials-refreshed", refresh); };
  }, []);
  useEffect(() => { setShelf(null); setResult(""); setConfirm(false); }, [id, viewer.id]);
  const routed = useRoutedPopup(`/shelves/${id}`, "/profile/library?mode=shelves", onClose, shelf ? `${shelf.title} — Book Meet` : "Book Meet");
  useEffect(() => { let active = true; setError(""); void shelfRequest(`/api/shelves/${id}`).then((data) => { if (!isBookShelf(data?.shelf)) throw new Error(t("shelves.invalidResponse")); if (active) setShelf(data.shelf); }).catch((cause) => { if (active) { setShelf(null); setError(cause instanceof Error ? cause.message : t("common.error")); } }); return () => { active = false; }; }, [id, viewer.id, revision]);
  async function add() {
    if (busy) return; setBusy(true); setError(""); const viewerId = viewer.id; announceLibraryMutationStart(viewerId);
    try {
      const data = await shelfRequest(`/api/shelves/${id}/add-to-library`, "POST");
      if (![data?.addedCount, data?.skippedExistingCount, data?.skippedUnavailableCount].every((value) => Number.isInteger(value) && value >= 0) || !Array.isArray(data.addedBooks) || !data.addedBooks.every((book: LibraryBook) => Number.isSafeInteger(book.id) && book.readingStatus === "want")) throw new Error(t("shelves.invalidResponse"));
      window.dispatchEvent(new CustomEvent("bookmeet:library-batch-added", { detail: { viewerId, books: data.addedBooks } }));
      setResult(t("shelves.addResult", { added: data.addedCount, existing: data.skippedExistingCount, unavailable: data.skippedUnavailableCount })); setConfirm(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.error")); } finally { setBusy(false); }
  }
  async function remove() {
    if (busy || !window.confirm(t("shelves.deleteConfirm"))) return; setBusy(true);
    try { await shelfRequest(`/api/shelves/${id}`, "DELETE"); changed(); routed.close(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.error")); } finally { setBusy(false); }
  }
  if (!routed.active) return null;
  return <div className="modal-backdrop entity-page-backdrop shelf-detail-backdrop" onMouseDown={routed.close}><section className="book-shelf-dialog" role="dialog" aria-modal="true" aria-label={shelf?.title ?? t("shelves.label")} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="shelf-close" aria-label={t("common.close")} onClick={routed.close}>×</button><button type="button" className="shelf-mobile-back" onClick={routed.close}>← {t("common.back")}</button>{error && <p className="form-error" role="alert">{error}</p>}{!shelf && !error && <p role="status">{t("common.loading")}</p>}{shelf && <><h2 data-i18n-skip>{shelf.title}</h2><p className="shelf-description" data-i18n-skip>{shelf.description}</p><p data-i18n-skip>{shelf.owner.name}</p><div className="shelf-owner-actions">{viewer.id === shelf.ownerId ? <><button type="button" disabled={busy} onClick={() => openShelfEditor(id)}>{t("common.edit")}</button><button type="button" disabled={busy} onClick={() => void remove()}>{t("common.delete")}</button></> : <button type="button" onClick={() => openReportDialog({ kind: "shelf", id })}>{t("safety.report")}</button>}</div><ol className="shelf-detail-books">{shelf.items.map((item) => <li key={item.position}>{item.book ? <><button type="button" className="shelf-book-open" onClick={() => onOpenBook(item.book!.id)}><ShelfCover book={item.book} /><span><strong data-i18n-skip>{item.book.title}</strong><small data-i18n-skip>{item.book.author}</small>{Boolean(item.book.rating) && <span aria-label={t("content.rating")}>★ {item.book.rating}</span>}</span></button><p className="shelf-description" data-i18n-skip>{item.description || item.book.annotation}</p></> : <p>{t("shelves.unavailable")}</p>}</li>)}</ol>{confirm ? <section className="shelf-add-confirm"><p>{t("shelves.addConfirm")}</p><button type="button" className="primary-button" disabled={busy} onClick={() => void add()}>{t("common.add")}</button><button type="button" disabled={busy} onClick={() => setConfirm(false)}>{t("common.cancel")}</button></section> : <button type="button" className="outline-button shelf-add-library" onClick={() => setConfirm(true)}>{t("shelves.addLibrary")}</button>}{result && <p role="status">{result}</p>}{renderActions(shelf)}</>}</section></div>;
}
