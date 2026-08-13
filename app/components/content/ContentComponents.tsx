import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Avatar } from "../chat/ChatComponents";
import type { Friend } from "../chat/types";
import { CustomSelect } from "../common/CustomSelect";
import { ModalIconActions } from "../modals/ModalIconActions";
import { openReportDialog } from "../safety/SafetyCenter";
import { SpoilerText, SpoilerTextarea } from "./text/SpoilerText";
import { useRoutedPopup } from "../../navigation/routes";
import {
  catalogFromUsers,
  excerptReadingItemById,
  eventTimestamp,
  formatKazakhstanPhone,
  matchesBookQuery,
  normalizeBookKey,
  normalizeBookSearchText,
  resolveCanonicalBook,
  renderRichHtml,
  reviewReadingItemById,
  sanitizeRichHtml,
  sortLibraryBooks,
  userBookMatches,
} from "../../lib/domain";
import { isSpecialLocation, SPECIAL_LOCATIONS } from "../../lib/locations";
import type {
  AdminCatalogItem,
  AuthorBook,
  BookEvent,
  BookFormat,
  BookLink,
  CityOption,
  DemoUser,
  EventStatus,
  Excerpt,
  FlipProductPreview,
  LibraryBook,
  LibraryView,
  MarketplaceProductPreview,
  MaterialComment,
  Occasion,
  OccasionType,
  ProfileTab,
  PublisherNews,
  ReadingItem,
  Review,
  SocialRelationship,
  UserExcerpt,
  UserReview,
  WishBook,
} from "../../types/domain";
import { currentLocale, formatDateForLocale, localizedApiError, translate, useI18n, type Locale } from "../../i18n";

export const monthlyBooks = [
  { title: "Время секонд хэнд", author: "Светлана Алексиевич", cover: "cover-red", mark: "В" },
  { title: "Тревожные люди", author: "Фредрик Бакман", cover: "cover-cream", mark: "ТЛ" },
  { title: "Клара и Солнце", author: "Кадзуо Исигуро", cover: "cover-blue", mark: "КС" },
  { title: "Бегущий за ветром", author: "Халед Хоссейни", cover: "cover-green", mark: "БВ" },
];

export type EventFormValue = { title: string; summary: string; description: string; isAdult: boolean; date: string; time: string; city: string; cityId?: number; address: string; mapUrl: string; detailsUrl: string; relatedToBook: boolean; linkedBookId?: number; linkedBookIds: number[] };
export const emptyEvent: EventFormValue = { title: "", summary: "", description: "", isAdult: false, date: "", time: "", city: "", address: "", mapUrl: "", detailsUrl: "", relatedToBook: false, linkedBookIds: [] };

function EventBookSelector({ catalog, selectedId, onSelect, onClear, onCreateBook }: { catalog: (LibraryBook | AuthorBook)[]; selectedId?: number; onSelect: (book: LibraryBook | AuthorBook) => void; onClear?: () => void; onCreateBook: () => void }) {
  const { t } = useI18n();
  const selected = catalog.find((book) => book.id === selectedId);
  const [query, setQuery] = useState(selected ? `${selected.title} — ${selected.author}` : "");
  const [remoteMatches, setRemoteMatches] = useState<(LibraryBook | AuthorBook)[]>([]);
  const normalized = normalizeBookSearchText(query);
  const localMatches = normalized.length >= 2 ? catalog.filter((book) => matchesBookQuery(book, query)) : [];
  const matches = [...localMatches, ...remoteMatches].filter((book, index, all) => all.findIndex((item) => item.id === book.id) === index).slice(0, 5);
  useEffect(() => {
    if (selected) setQuery(`${selected.title} — ${selected.author}`);
  }, [selected?.id]);
  useEffect(() => {
    if (normalized.length < 2 || selected && normalized === normalizeBookSearchText(`${selected.title} — ${selected.author}`)) { setRemoteMatches([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => fetch(`/api/books?q=${encodeURIComponent(query.trim())}`, { credentials: "same-origin", signal: controller.signal }).then((response) => response.json()).then((data: { books?: Array<Partial<LibraryBook> & { id: number; title: string; author: string }> }) => setRemoteMatches((data.books ?? []).map((book) => ({ genres: [], annotation: "", pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", coverTone: "blue", ...book } as LibraryBook)))).catch((error) => { if (error instanceof Error && error.name !== "AbortError") console.warn(error); }), 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [normalized, query, selected]);
  return <div className="event-book-selector"><label>{t("content.bookTitleAuthor")}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("content.startBookSearch")} autoComplete="off" /></label>{selected && <button className="selected-material-book" type="button" onClick={() => { setQuery(""); onClear?.(); }}>{t("content.book")}: <span data-i18n-skip>{selected.title}</span> <span>×</span></button>}{matches.length > 0 ? <div className="book-match-suggestions"><strong>{t("content.chooseBook")}</strong>{matches.map((book) => <button type="button" key={book.id} onClick={() => onSelect(book)}><div className={`match-book-cover library-cover-${book.coverTone}`} data-i18n-skip style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <span>{book.title.slice(0, 1)}</span>}</div><span data-i18n-skip><b>{book.title}</b><small>{book.author}</small></span></button>)}</div> : normalized.length >= 2 && !selected ? <div className="event-book-not-found"><span>{t("content.noMatches")}</span><button className="outline-button" type="button" onClick={onCreateBook}>{t("content.createBookFirst")}</button></div> : null}</div>;
}

export function EventForm({ initial, catalog = [], onCreateBook = () => undefined, onCancel, onSave, submitLabel }: { initial?: BookEvent; catalog?: (LibraryBook | AuthorBook)[]; onCreateBook?: () => void; onCancel: () => void; onSave: (value: EventFormValue) => Promise<void>; submitLabel?: string }) {
  const { t } = useI18n();
  const availableCatalog = catalog.length ? catalog : (initial?.linkedBooks ?? []).map((book) => ({ genres: [], pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", coverTone: "blue", ...book } as LibraryBook));
  catalog = availableCatalog;
  const [value, setValue] = useState<EventFormValue>(() => initial ? { title: initial.title, summary: initial.summary, description: initial.description, isAdult: Boolean(initial.isAdult), date: initial.date, time: initial.time, city: initial.city, cityId: initial.cityId, address: initial.address, mapUrl: initial.mapUrl, detailsUrl: initial.detailsUrl, relatedToBook: Boolean(initial.linkedBookId || initial.linkedBookIds?.length), linkedBookId: initial.linkedBookId, linkedBookIds: initial.linkedBookIds?.length ? initial.linkedBookIds : initial.linkedBookId ? [initial.linkedBookId] : [] } : emptyEvent);
  const [bookSlots, setBookSlots] = useState<Array<number | undefined>>(() => value.linkedBookIds.length ? value.linkedBookIds : [undefined]);
  const [saving, setSaving] = useState(false);
  const field = (name: "title" | "summary" | "description" | "date" | "time" | "address" | "mapUrl" | "detailsUrl") => ({ value: value[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue((current) => ({ ...current, [name]: event.target.value })) });
  return <form className="event-form" onSubmit={async (event) => { event.preventDefault(); setSaving(true); try { await onSave(value); } finally { setSaving(false); } }}>
    <button className="modal-close" type="button" aria-label={t("common.close")} onClick={onCancel}>×</button>
    <div className="profile-title-row"><div><span className="section-subtitle">{t("event.kazakhstan")}</span><h2>{initial ? t("event.edit") : t("event.suggest")}</h2></div></div>
    <fieldset className="material-books-field"><legend>{t("event.books")}</legend>{bookSlots.map((selectedId, index) => <EventBookSelector key={`${index}-${selectedId ?? "empty"}`} catalog={catalog} selectedId={selectedId} onSelect={(book) => { const next = bookSlots.map((id, slot) => slot === index ? book.id : id); setBookSlots(next); const ids = next.filter((id): id is number => Boolean(id)); setValue((current) => ({ ...current, relatedToBook: ids.length > 0, linkedBookId: ids[0], linkedBookIds: ids })); }} onClear={() => { const next = bookSlots.map((id, slot) => slot === index ? undefined : id); setBookSlots(next); const ids = next.filter((id): id is number => Boolean(id)); setValue((current) => ({ ...current, relatedToBook: ids.length > 0, linkedBookId: ids[0], linkedBookIds: ids })); }} onCreateBook={onCreateBook} />)}<button className="add-another-book" type="button" onClick={() => setBookSlots((current) => [...current, undefined])}>＋ {t("event.addBook")}</button></fieldset>
    <label>{t("event.title")}<input required maxLength={200} {...field("title")} /></label>
    <label>{t("event.summary")}<textarea required rows={3} maxLength={1200} {...field("summary")} /></label>
    <label>{t("event.details")}<textarea required rows={6} {...field("description")} /></label>
    <label className="adult-material-checkbox"><input type="checkbox" checked={value.isAdult} onChange={(event) => setValue((current) => ({ ...current, isAdult: event.target.checked }))} />{t("event.adult")}</label>
    <div className="form-row"><label>{t("content.date")}<input required type="date" {...field("date")} /></label><label>{t("content.time")}<input required type="time" {...field("time")} /></label></div>
    <div className="form-row"><CityAutocomplete value={value.city} required includeSpecialLocations onChange={(city, cityId) => setValue((current) => ({ ...current, city, cityId }))} /><label>{t("content.address")}<input required={!isSpecialLocation(value.city)} {...field("address")} /></label></div>
    <label>{t("event.mapLink")}<input type="url" placeholder="https://2gis.kz/..." {...field("mapUrl")} /></label>
    <label>{t("event.detailsLink")}<input type="url" placeholder="https://..." {...field("detailsUrl")} /></label>
    <div className="form-actions"><button type="button" onClick={onCancel}>{t("common.cancel")}</button><button className="primary-button" disabled={saving} type="submit">{saving ? t("auth.saving") : submitLabel ?? t("event.submitModeration")}</button></div>
  </form>;
}

export function EventStatusLabel({ status }: { status: EventStatus }) {
  const { t } = useI18n();
  if (status === "published") return null;
  const labels = { pending: t("status.pending"), needs_changes: t("status.needsChanges"), rejected: t("status.rejected") };
  return <span className={`event-status event-status-${status}`}>{labels[status]}</span>;
}

export function EventCard({ item, own, onOpen, onOpenBook, onEdit, compact = false }: { item: BookEvent; own: boolean; onOpen: () => void; onOpenBook?: () => void; onEdit?: () => void; compact?: boolean }) {
  const { t, formatDate } = useI18n();
  const dateTime = `${formatDate(`${item.date}T00:00:00`, { day: "numeric", month: "long" })}${item.time ? ` · ${item.time}` : ""}`;
  return <article className={`event-card event-card-clickable event-card-modern ${compact ? "event-card-compact" : ""} ${item.pinned ? "is-pinned" : ""}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><div className="event-card-copy"><div>{own && <EventStatusLabel status={item.status} />}<span className="section-subtitle">{item.pinned && <b className="pinned-event-label">{t("event.pinned")} · </b>}{item.isAdult && <b>18+ · </b>}{dateTime}{!compact && item.bookTitle && <><i className="event-book-dot" aria-hidden="true" /><button className="event-book-inline" data-i18n-skip type="button" onClick={(event) => { event.stopPropagation(); onOpenBook?.(); }}>{item.bookTitle} · {item.bookAuthor}</button></>}</span></div><h3 data-i18n-skip>{item.title}</h3>{!compact && <><p data-i18n-skip>{item.summary}</p><small className="event-location-line" data-i18n-skip><span>{item.city}</span><i aria-hidden="true" />{item.address}</small></>}{own && item.status === "needs_changes" && onEdit && <div className="moderated-card-actions"><button className="outline-button" type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>{t("common.edit")}</button></div>}</div></article>;
}

export async function editReadingMaterial(item: ReadingItem, currentUser: DemoUser) {
  if (item.ownerId !== currentUser.id && !currentUser.isAdmin) return;
  window.dispatchEvent(new CustomEvent("bookmeet:edit-material", { detail: { kind: item.kind, id: item.id, admin: Boolean(currentUser.isAdmin && item.ownerId !== currentUser.id) } }));
}

export async function deleteReadingMaterial(item: ReadingItem, currentUser: DemoUser) {
  if (!currentUser.isAdmin && item.ownerId !== currentUser.id) return;
  const locale = currentLocale();
  if (!window.confirm(translate(locale, "material.deleteConfirm", { kind: translate(locale, item.kind === "review" ? "material.reviewAccusative" : "material.publicationAccusative") }))) return;
  const endpoint = currentUser.isAdmin ? `/api/admin/materials/${item.kind}/${item.id}` : `/api/materials/${item.kind}/${item.id}`;
  const response = await fetch(endpoint, { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) { window.alert(translate(locale, "material.deleteError")); return; }
  window.location.reload();
}

function formatCommentDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startComment = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday.getTime() - startComment.getTime()) / 86400000);
  const intl = locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU";
  const time = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (days === 0) return translate(locale, "date.todayAt", { time });
  if (days === 1) return translate(locale, "date.yesterdayAt", { time });
  if (date.getFullYear() === now.getFullYear()) {
    return translate(locale, "date.dateAt", { date: formatDateForLocale(locale, date, { day: "numeric", month: "long" }), time });
  }
  return translate(locale, "date.dateAt", { date: new Intl.DateTimeFormat(intl, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date), time });
}

type EngagementKind = "event" | "occasion" | "publisher_news";

function MaterialEngagement({ kind, materialId, ownerId, currentUser, users, onOpenUser }: { kind: EngagementKind; materialId: number; ownerId: number; currentUser?: DemoUser; users: DemoUser[]; onOpenUser?: (userId: number) => void }) {
  const { locale, t } = useI18n();
  const [likedUserIds, setLikedUserIds] = useState<number[]>([]);
  const [comments, setComments] = useState<MaterialComment[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/reactions?kind=${kind}&id=${materialId}`, { credentials: "same-origin", cache: "no-store" }).then((response) => response.json() as Promise<{ userIds?: number[] }>),
      fetch(`/api/comments?kind=${kind}&id=${materialId}`, { credentials: "same-origin", cache: "no-store" }).then((response) => response.json() as Promise<{ comments?: MaterialComment[] }>),
    ]).then(([reactions, materialComments]) => {
      if (!active) return;
      setLikedUserIds(reactions.userIds ?? []);
      setComments(materialComments.comments ?? []);
    }).catch((error) => console.warn(error));
    return () => { active = false; };
  }, [kind, materialId]);
  const liked = Boolean(currentUser && likedUserIds.includes(currentUser.id));
  async function toggleLike() {
    if (!currentUser || busy || currentUser.id === ownerId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/reactions", { method: liked ? "DELETE" : "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ materialKind: kind, materialId }) });
      if (!response.ok) throw new Error(localizedApiError((await response.json() as { error?: string }).error, t("material.likeError")));
      setLikedUserIds((current) => liked ? current.filter((id) => id !== currentUser.id) : [...new Set([...current, currentUser.id])]);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("material.likeError"));
    } finally { setBusy(false); }
  }
  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || busy || !comment.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/comments", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ materialKind: kind, materialId, body: comment.trim() }) });
      const data = await response.json() as { comment?: MaterialComment; error?: string };
      if (!response.ok || !data.comment) throw new Error(localizedApiError(data.error, t("material.commentError")));
      setComments((current) => [...current, data.comment!]);
      setComment("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("material.commentError"));
    } finally { setBusy(false); }
  }
  async function deleteComment(entry: MaterialComment) {
    if (!currentUser || !(currentUser.isAdmin || currentUser.id === entry.userId)) return;
    const response = await fetch(`/api/comments/${entry.id}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) setComments((current) => current.filter((item) => item.id !== entry.id));
  }
  return <section className="material-engagement"><div className="reading-social-row"><button className={liked ? "outline-button liked" : "outline-button"} type="button" disabled={!currentUser || busy || currentUser.id === ownerId} title={currentUser?.id === ownerId ? t("material.ownLikeDisabled") : undefined} onClick={() => void toggleLike()}>{liked ? "♥" : "♡"} {t("material.like")} · {likedUserIds.length}</button></div><section className="comments-block"><h3>{t("content.comments")} · {comments.length}</h3>{currentUser && <form onSubmit={submitComment}><SpoilerTextarea rows={3} value={comment} onChange={setComment} placeholder={t("material.writeComment")} /><button className="primary-button" type="submit" disabled={busy || !comment.trim()}>{t("common.send")}</button></form>}{comments.map((entry) => { const author = users.find((user) => user.id === entry.userId); const canDelete = Boolean(currentUser && (currentUser.isAdmin || currentUser.id === entry.userId)); const canReport = Boolean(currentUser && !currentUser.isAdmin && currentUser.id !== entry.userId); return <article key={entry.id}><div className="comment-actions">{canReport && <button className="comment-report-button" type="button" onClick={() => openReportDialog({ kind: "comment", id: entry.id })} aria-label={t("safety.comment")} title={t("safety.report")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 8v6" /><circle cx="12" cy="17" r="1" /></svg></button>}{canDelete && <button className="comment-delete-button" type="button" onClick={() => void deleteComment(entry)} aria-label={t("material.deleteComment")} title={t("material.deleteComment")}>×</button>}</div><button type="button" data-i18n-skip onClick={() => onOpenUser?.(entry.userId)}>{author?.profile.name ?? t("material.user")}</button><small>{formatCommentDate(entry.createdAt, locale)}</small><p data-i18n-skip><SpoilerText text={entry.text} /></p></article>; })}</section></section>;
}

type EventAttendee = { id: number; name: string; type: string; city: string; initials: string; color: string; avatarUrl?: string };

export function EventModal({ item, users = [], catalog: canonicalCatalog = [], currentUserId, currentUser, onClose, onOpenBook, onOpenUser, onEdit, onDelete, onReport }: { item: BookEvent; users?: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; currentUserId?: number; currentUser?: DemoUser; onClose: () => void; onOpenBook?: (bookId?: number) => void; onOpenUser?: (userId: number) => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void }) {
  const { t, formatDate, domainLabel } = useI18n();
  const routedPopup = useRoutedPopup(`/events/${item.id}`, "/events", onClose, `${item.title} — Book Meet`);
  const routedClose = routedPopup.close;
  const [reminderSet, setReminderSet] = useState(Boolean(item.reminderSet));
  const [reminderUserIds, setReminderUserIds] = useState(item.reminderUserIds ?? []);
  const [reminderDialog, setReminderDialog] = useState<"created" | "cancel" | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [attendeesOpen, setAttendeesOpen] = useState(false);
  const [attendeesPage, setAttendeesPage] = useState(1);
  const [attendeesPageCount, setAttendeesPageCount] = useState(1);
  const [attendeeCount, setAttendeeCount] = useState(item.reminderCount ?? item.reminderUserIds?.length ?? 0);
  const [pagedAttendees, setPagedAttendees] = useState<EventAttendee[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [bookPopup, setBookPopup] = useState<LibraryBook | AuthorBook | null>(null);
  const viewer = currentUser ?? users.find((user) => user.id === currentUserId);
  async function setReminder() {
    if (reminderSet || reminderBusy) return;
    setReminderBusy(true);
    try {
      const response = await fetch(`/api/events/${item.id}/reminder`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(localizedApiError((await response.json() as { error?: string }).error, t("event.reminderSetError")));
      setReminderSet(true);
      if (currentUserId) setReminderUserIds((current) => Array.from(new Set([...current, currentUserId])));
      setAttendeeCount((count) => count + 1);
      window.setTimeout(() => setReminderDialog("created"), 40);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("event.reminderSetError"));
    } finally {
      setReminderBusy(false);
    }
  }
  async function cancelReminder() {
    if (!reminderSet || reminderBusy) return;
    setReminderBusy(true);
    try {
      const response = await fetch(`/api/events/${item.id}/reminder`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(localizedApiError((await response.json() as { error?: string }).error, t("event.reminderCancelError")));
      setReminderSet(false);
      if (currentUserId) setReminderUserIds((current) => current.filter((id) => id !== currentUserId));
      setAttendeeCount((count) => Math.max(0, count - 1));
      setReminderDialog(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("event.reminderCancelError"));
    } finally {
      setReminderBusy(false);
    }
  }
  function openOwnProfile() {
    setReminderDialog(null);
    window.location.assign("/profile/events");
  }
  const previewAttendees = reminderUserIds.map((id) => users.find((user) => user.id === id)).filter(Boolean).map((user) => ({ id: user!.id, name: user!.profile.name, type: user!.profile.type, city: user!.profile.city, initials: user!.initials, color: user!.color, avatarUrl: user!.avatarUrl }));
  useEffect(() => {
    if (!attendeesOpen) return;
    const controller = new AbortController();
    setAttendeesLoading(true);
    fetch(`/api/events/${item.id}/attendees?page=${attendeesPage}`, { credentials: "same-origin", signal: controller.signal }).then(async (response) => {
      const data = await response.json() as { attendees?: EventAttendee[]; page?: number; pageCount?: number; total?: number; error?: string };
      if (!response.ok) throw new Error(localizedApiError(data.error, t("event.attendeesError")));
      setPagedAttendees(data.attendees ?? []);
      setAttendeesPage(data.page ?? 1);
      setAttendeesPageCount(data.pageCount ?? 1);
      setAttendeeCount(data.total ?? 0);
    }).catch((error) => { if (error instanceof Error && error.name !== "AbortError") window.alert(error.message); }).finally(() => setAttendeesLoading(false));
    return () => controller.abort();
  }, [attendeesOpen, attendeesPage, item.id]);
  const attendeeCard = (user: EventAttendee) => <button type="button" key={user.id} onClick={() => { setAttendeesOpen(false); onOpenUser?.(user.id); }}><span className={`avatar avatar-sm avatar-${user.color} ${user.avatarUrl ? "has-photo" : ""}`} style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}>{!user.avatarUrl && user.initials}</span><span><strong data-i18n-skip>{user.name}</strong><small>{domainLabel(user.type)}<span data-i18n-skip>{user.city ? ` · ${user.city}` : ""}</span></small></span></button>;
  const catalog = canonicalCatalog.length ? canonicalCatalog : catalogFromUsers(users);
  const openLinkedBook = (bookId?: number) => {
    const book = catalog.find((candidate) => candidate.id === bookId);
    if (book) setBookPopup(book);
    else onOpenBook?.(bookId);
  };
  if (!routedPopup.active && !bookPopup) return null;
  return <div className="modal-backdrop" onMouseDown={routedClose}><section className="event-modal" onMouseDown={(event) => event.stopPropagation()}>
    <ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={routedClose} />
    <EventStatusLabel status={item.status} />
    <span className="section-subtitle">{t("event.bookEvent")}{item.isAdult ? " · 18+" : ""} · <span data-i18n-skip>{item.city}</span></span><h2 data-i18n-skip>{item.title}</h2>
    <div className="event-modal-books">{(item.linkedBooks?.length ? item.linkedBooks : item.bookTitle ? [{ id: item.linkedBookId ?? 0, title: item.bookTitle, author: item.bookAuthor ?? "", annotation: item.bookAnnotation, coverUrl: item.bookCoverUrl, coverTone: item.bookCoverTone }] : []).map((book) => <button className="event-modal-book" data-i18n-skip type="button" key={book.id || book.title} onClick={() => openLinkedBook(book.id || undefined)}><div className={`event-modal-book-cover library-cover-${book.coverTone ?? "blue"}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && book.title.slice(0, 1)}</div><span><strong>{book.title}</strong><small>{book.author}</small><p>{book.annotation || t("book.noAnnotation")}</p></span></button>)}</div>
    <div className="event-modal-meta"><strong>{formatDate(`${item.date}T00:00:00`, { day: "numeric", month: "long", year: "numeric" })} · {item.time}</strong><span data-i18n-skip>{item.address}</span></div><p data-i18n-skip>{item.description}</p>
    {item.moderationNote && item.status !== "published" && <div className="moderation-note"><strong>{t("moderation.comment")}</strong><p data-i18n-skip>{item.moderationNote}</p></div>}
    <div className="event-links">{item.detailsUrl && <a className="primary-button" href={item.detailsUrl} target="_blank" rel="noreferrer">{t("auth.register")}</a>}{item.mapUrl && <a className="outline-button" href={item.mapUrl} target="_blank" rel="noreferrer">{t("event.viewMap")}</a>}{item.status === "published" && <button className="outline-button" type="button" disabled={reminderBusy} onClick={() => reminderSet ? setReminderDialog("cancel") : void setReminder()}>{reminderSet ? t("event.reminderSet") : t("event.setReminder")}</button>}</div>
    {attendeeCount > 0 && <section className="event-attendees"><h3>{t("event.going")} · {attendeeCount}</h3><div>{previewAttendees.slice(0, 4).map(attendeeCard)}</div>{attendeeCount > 4 && <button className="outline-button event-attendees-all" type="button" onClick={() => { setAttendeesPage(1); setAttendeesOpen(true); }}>{t("event.showAll")}</button>}</section>}
    <MaterialEngagement kind="event" materialId={item.id} ownerId={item.creatorId} currentUser={viewer} users={users} onOpenUser={onOpenUser} />
    {attendeesOpen && <div className="nested-modal-backdrop" onMouseDown={() => setAttendeesOpen(false)}><section className="event-attendees-modal" role="dialog" aria-modal="true" aria-label={t("event.attendees")} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label={t("event.closeAttendees")} onClick={() => setAttendeesOpen(false)}>×</button><h2>{t("event.attending")} · {attendeeCount}</h2>{attendeesLoading ? <p className="event-attendees-loading">{t("event.loadingAttendees")}</p> : <div className="event-attendees-list">{pagedAttendees.map(attendeeCard)}</div>}{attendeesPageCount > 1 && <div className="event-attendees-pagination"><button type="button" disabled={attendeesLoading || attendeesPage === 1} onClick={() => setAttendeesPage((page) => Math.max(1, page - 1))}>{t("common.back")}</button><span>{t("common.pageOf", { page: attendeesPage, pages: attendeesPageCount })}</span><button type="button" disabled={attendeesLoading || attendeesPage === attendeesPageCount} onClick={() => setAttendeesPage((page) => Math.min(attendeesPageCount, page + 1))}>{t("common.next")}</button></div>}</section></div>}
    {reminderDialog && <div className="nested-modal-backdrop" onMouseDown={() => setReminderDialog(null)}><section className="event-reminder-notice" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>{reminderDialog === "created" ? <><h2>{t("event.reminderCreated")}</h2><p>{t("event.reminderExplanation")}</p><div className="form-actions"><button className="outline-button" type="button" onClick={() => setReminderDialog(null)}>{t("common.ok")}</button><button className="outline-button" type="button" onClick={openOwnProfile}>{t("event.goProfile")}</button></div></> : <><h2>{t("event.cancelReminder")}</h2><div className="form-actions"><button className="outline-button" type="button" disabled={reminderBusy} onClick={() => void cancelReminder()}>{t("common.yes")}</button><button className="outline-button" type="button" autoFocus onClick={() => setReminderDialog(null)}>{t("common.no")}</button></div></>}</section></div>}
    {bookPopup && <UnifiedBookModal book={bookPopup} users={users} catalog={catalog} nested onClose={() => setBookPopup(null)} onOpenUser={onOpenUser} />}
  </section></div>;
}

export function CityAutocomplete({ value, onChange, required = false, label, invalid = false, includeSpecialLocations = true }: { value: string; onChange: (name: string, id?: number, country?: string) => void; required?: boolean; label?: string; invalid?: boolean; includeSpecialLocations?: boolean }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState<CityOption[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => {
    if (!open || query.trim().length < 1) { setOptions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => fetch(`/api/cities?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal }).then((response) => response.json()).then((data: { cities?: CityOption[] }) => { setOptions(includeSpecialLocations ? [...SPECIAL_LOCATIONS.filter((name) => name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"))).map((name) => ({ id: -1, name, countryCode: "", country: t("location.special") })), ...(data.cities ?? [])] : data.cities ?? []); setOpen(true); }).catch(() => undefined), 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, includeSpecialLocations, t]);
  return <label className={`city-autocomplete ${invalid ? "field-invalid" : ""}`}>{label ?? t("content.city")}<input required={required} aria-invalid={invalid} value={query} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { const next = event.target.value.replace(/[^А-ЯЁа-яёІіҢңҒғҮүҰұҚқӨөҺһӘәЎўЇїЄєҐґЏџЉљЊњЋћЌќ\s.'’()-]/gu, ""); setQuery(next); onChange(next); }} placeholder={t("location.startCity")} autoComplete="off" />{open && query.trim() && <div className="city-suggestions">{options.map((city) => <button type="button" data-i18n-skip key={city.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(city.name); onChange(city.name, city.id, city.country); setOpen(false); }}>{city.name}<small>{city.country}</small></button>)}</div>}</label>;
}

export function CityFilter({ value, cities, onChange }: { value: string; cities: string[]; onChange: (city: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const options = useMemo(() => Array.from(new Set(cities.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru")), [cities]);
  const matches = options.filter((city) => !value.trim() || city.toLocaleLowerCase("ru").includes(value.trim().toLocaleLowerCase("ru")));
  return <label className="directory-city-filter" aria-label={t("location.chooseCity")}><span className="city-filter-icon" aria-hidden="true">⌕</span><input value={value} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { onChange(event.target.value.replace(/[^А-ЯЁа-яёІіҢңҒғҮүҰұҚқӨөҺһӘәЎўЇїЄєҐґЏџЉљЊњЋћЌќ\s.'’()-]/gu, "")); setOpen(true); }} placeholder={t("location.startCity")} autoComplete="off" />{value && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onChange("")} aria-label={t("location.resetFilter")}>×</button>}{open && <div className="directory-city-options"><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setOpen(false); }}>{t("location.allCities")}</button>{matches.map((city) => <button type="button" data-i18n-skip key={city} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(city); setOpen(false); }}>{city}</button>)}</div>}</label>;
}

export function MultiCityPicker({ values, onChange, label }: { values: string[]; onChange: (cities: string[]) => void; label?: string }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  return <div className="multi-city-picker"><div className="selected-city-tags" data-i18n-skip>{values.map((city) => <span key={city}>{city}<button type="button" onClick={() => onChange(values.filter((item) => item !== city))}>×</button></span>)}</div><CityAutocomplete label={label ?? t("location.multipleCities")} value={draft} onChange={(name, id) => { setDraft(name); if (id && !values.includes(name)) { onChange([...values, name]); setDraft(""); } }} /></div>;
}

export const emptyOccasion = { type: "" as "" | OccasionType, primaryText: "", audienceText: "", isAdult: false, targetGender: "Все" as Occasion["targetGender"], targetCities: [] as string[], targetProfileType: "Все" as Occasion["targetProfileType"], meetingDate: "", meetingStartTime: "", meetingEndTime: "", meetingCity: "", meetingCityId: undefined as number | undefined, meetingAddress: "", meetingMapUrl: "", linkedBookId: undefined as number | undefined };
export const occasionLabels = {
  get meet() { return translate(currentLocale(), "occasion.meet"); },
  get discuss() { return translate(currentLocale(), "occasion.discuss"); },
  get invite() { return translate(currentLocale(), "occasion.invite"); },
};
const occasionFieldKeys = {
  meet: { primary: "occasion.aboutMe", audience: "occasion.meetAudience" },
  discuss: { primary: "occasion.discussTopic", audience: "occasion.discussAudience" },
  invite: { primary: "occasion.offer", audience: "occasion.inviteAudience" },
} as const;

function occasionDateLabel(item: Occasion, locale: Locale) {
  if (item.type !== "invite" || !item.meetingDate) return null;
  const date = new Date(`${item.meetingDate}T00:00:00`);
  const dateText = formatDateForLocale(locale, date, { day: "numeric", month: "long", year: "numeric" });
  if (!item.meetingStartTime) return dateText;
  if (!item.meetingEndTime) return `${dateText} · ${item.meetingStartTime}`;
  const nextDay = item.meetingEndTime < item.meetingStartTime;
  return `${dateText} · ${item.meetingStartTime}–${item.meetingEndTime}${nextDay ? ` ${translate(locale, "occasion.nextDay")}` : ""}`;
}

export function OccasionForm({ initial, catalog = [], onCancel, onSave, submitLabel }: { initial?: Occasion; catalog?: (LibraryBook | AuthorBook)[]; onCancel: () => void; onSave: (value: typeof emptyOccasion) => Promise<void>; submitLabel?: string }) {
  const { t, domainLabel } = useI18n();
  const availableCatalog = catalog.length ? catalog : (initial?.linkedBooks ?? []).map((book) => ({ genres: [], pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", coverTone: "blue", ...book } as LibraryBook));
  catalog = availableCatalog;
  const [value, setValue] = useState<typeof emptyOccasion>(() => initial ? { type: initial.type, primaryText: initial.primaryText, audienceText: initial.audienceText, isAdult: Boolean(initial.isAdult), targetGender: initial.targetGender, targetCities: initial.targetCities, targetProfileType: initial.targetProfileType, meetingDate: initial.meetingDate ?? "", meetingStartTime: initial.meetingStartTime ?? "", meetingEndTime: initial.meetingEndTime ?? "", meetingCity: initial.meetingCity ?? initial.targetCities[0] ?? "", meetingCityId: initial.meetingCityId, meetingAddress: initial.meetingAddress ?? "", meetingMapUrl: initial.meetingMapUrl ?? "", linkedBookId: initial.linkedBookId } : emptyOccasion);
  const [saving, setSaving] = useState(false);
  const changeType = (type: OccasionType | "") => setValue({ ...emptyOccasion, type });
  const textKeys = value.type ? occasionFieldKeys[value.type] : occasionFieldKeys.meet;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const minimumDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const incompleteTime = Boolean(value.meetingEndTime) && !Boolean(value.meetingStartTime);
  const targetMissing = false;
  const locationMissing = value.type === "invite" && (!value.meetingCity || !isSpecialLocation(value.meetingCity) && !value.meetingAddress);
  const bookMissing = value.type === "discuss" && !value.linkedBookId;
  return <form className="occasion-form" onSubmit={async (event) => { event.preventDefault(); if (!value.type || incompleteTime || targetMissing || locationMissing || bookMissing) return; setSaving(true); try { await onSave({ ...value, targetCities: value.type === "invite" ? [value.meetingCity] : value.targetCities }); } finally { setSaving(false); } }}>
    <button className="modal-close" type="button" aria-label={t("common.close")} onClick={onCancel}>×</button>
    <div className="profile-title-row"><div><span className="section-subtitle">{t("content.occasions")}</span><h2>{initial ? t("occasion.edit") : t("occasion.suggest")}</h2></div></div>
    <div><span className="occasion-type-label">{t("occasion.chooseType")}</span><div className="occasion-type-switch" role="group" aria-label={t("occasion.chooseType")}>{(["meet", "discuss", "invite"] as OccasionType[]).map((type) => <button className={value.type === type ? "active" : ""} type="button" key={type} aria-pressed={value.type === type} onClick={() => changeType(type)}>{t(`occasion.${type}`)}</button>)}</div></div>
    {value.type && <>
      {value.type === "discuss" && <div className="occasion-discuss-book"><EventBookSelector catalog={catalog} selectedId={value.linkedBookId} onSelect={(book) => setValue({ ...value, linkedBookId: book.id })} onClear={() => setValue({ ...value, linkedBookId: undefined })} onCreateBook={() => undefined} /></div>}
      <label>{t(textKeys.primary)}<textarea required rows={5} value={value.primaryText} onChange={(event) => setValue({ ...value, primaryText: event.target.value })} placeholder={value.type === "invite" ? t("occasion.example") : undefined} /></label>
      <fieldset className="occasion-audience-box"><legend>{t("occasion.who")}</legend><label>{t(textKeys.audience)}<textarea required rows={4} value={value.audienceText} onChange={(event) => setValue({ ...value, audienceText: event.target.value })} /></label><div className="occasion-audience-grid"><label>{t("occasion.gender")}<CustomSelect ariaLabel={t("occasion.gender")} value={value.targetGender} onChange={(targetGender) => setValue({ ...value, targetGender })} options={["Все", "Мужской", "Женский"].map((item) => ({ value: item as Occasion["targetGender"], label: domainLabel(item) }))} /></label><label>{t("occasion.profileType")}<CustomSelect ariaLabel={t("occasion.profileType")} value={value.targetProfileType} onChange={(targetProfileType) => setValue({ ...value, targetProfileType })} options={["Все", "Читатель", "Писатель", "Блогер"].map((item) => ({ value: item as Occasion["targetProfileType"], label: domainLabel(item) }))} /></label></div></fieldset>
      {value.type === "invite" ? <><fieldset className="occasion-schedule-box"><legend>{t("occasion.when")}</legend><label>{t("content.date")}<input required type="date" min={minimumDate} value={value.meetingDate} onChange={(event) => setValue({ ...value, meetingDate: event.target.value })} /></label><div className="occasion-time-range"><label>{t("occasion.timeFrom")}<input type="time" value={value.meetingStartTime} onChange={(event) => setValue({ ...value, meetingStartTime: event.target.value })} /></label><label>{t("occasion.timeTo")}<input type="time" value={value.meetingEndTime} onChange={(event) => setValue({ ...value, meetingEndTime: event.target.value })} /></label></div></fieldset><fieldset className="occasion-location-box"><legend>{t("occasion.where")}</legend><CityAutocomplete value={value.meetingCity} required onChange={(meetingCity, meetingCityId) => setValue({ ...value, meetingCity, meetingCityId })} /><label>{t("occasion.place")}<input required value={value.meetingAddress} onChange={(event) => setValue({ ...value, meetingAddress: event.target.value })} /></label><label>{t("event.mapLink")}<input type="url" placeholder="https://2gis.kz/..." value={value.meetingMapUrl} onChange={(event) => setValue({ ...value, meetingMapUrl: event.target.value })} /></label></fieldset></> : <MultiCityPicker values={value.targetCities} onChange={(targetCities) => setValue({ ...value, targetCities })} />}
      <label className="adult-material-checkbox"><input type="checkbox" checked={value.isAdult} onChange={(event) => setValue({ ...value, isAdult: event.target.checked })} />{t("occasion.adult")}</label>
    </>}
    <div className="form-actions"><button type="button" onClick={onCancel}>{t("common.cancel")}</button><button className="primary-button" disabled={saving || !value.type || incompleteTime || targetMissing || locationMissing || bookMissing} type="submit">{saving ? t("auth.saving") : submitLabel ?? t("common.send")}</button></div>
  </form>;
}

export function OccasionCard({ item, own, onOpen, onEdit }: { item: Occasion; own: boolean; onOpen: () => void; onEdit?: () => void }) {
  const { locale, t } = useI18n();
  const schedule = occasionDateLabel(item, locale);
  const labels = occasionFieldKeys[item.type];
  return <article className="occasion-card material-clickable-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><div><span className="section-subtitle">{t(`occasion.${item.type}`)}{schedule && <><i className="occasion-blue-dot" aria-hidden="true" />{schedule}</>}{item.isAdult ? " · 18+" : ""}</span>{own && <EventStatusLabel status={item.status} />}</div><p className="occasion-audience-row"><strong>{t(labels.primary)}:</strong> <span data-i18n-skip>{item.primaryText}</span></p><p className="occasion-audience-row"><strong>{t(labels.audience)}:</strong> <span data-i18n-skip>{item.audienceText}</span></p><small data-i18n-skip>{item.type === "invite" ? [item.meetingCity, item.meetingAddress].filter(Boolean).join(" · ") : item.targetCities.join(" · ")}</small>{own && item.status === "needs_changes" && onEdit && <button className="outline-button card-inline-action" type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>{t("common.edit")}</button>}</article>;
}

export function OccasionModal({ item, currentUser, users = [], onClose, onOpenUser, onOpenBook, onEdit, onDelete, onReport }: { item: Occasion; currentUser?: DemoUser; users?: DemoUser[]; onClose: () => void; onOpenUser?: (id: number) => void; onOpenBook?: (id: number) => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void }) {
  const { locale, t } = useI18n();
  const routedPopup = useRoutedPopup(`/meet/${item.id}`, "/meet", onClose, `${t(`occasion.${item.type}`)} — Book Meet`);
  const routedClose = routedPopup.close;
  if (!routedPopup.active) return null;
  const schedule = occasionDateLabel(item, locale);
  const labels = occasionFieldKeys[item.type];
  return <div className="modal-backdrop" onMouseDown={routedClose}><section className="event-modal occasion-modal" onMouseDown={(event) => event.stopPropagation()}>
    <ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={routedClose} />
    <EventStatusLabel status={item.status} />
    <span className="section-subtitle">{t(`occasion.${item.type}`)}{schedule && <><i className="occasion-blue-dot" aria-hidden="true" />{schedule}</>}</span>
    <p className="occasion-audience-row"><strong>{t(labels.primary)}:</strong> <span data-i18n-skip>{item.primaryText}</span></p>
    <p className="occasion-audience-row"><strong>{t(labels.audience)}:</strong> <span data-i18n-skip>{item.audienceText}</span></p>
    {item.type === "invite" && <div className="occasion-place"><strong data-i18n-skip>{item.meetingCity}{item.meetingAddress ? ` · ${item.meetingAddress}` : ""}</strong>{item.meetingMapUrl && <a className="outline-button" href={item.meetingMapUrl} target="_blank" rel="noreferrer">{t("event.viewMap")}</a>}</div>}
    {item.linkedBooks?.map((book) => <button className="event-modal-book" type="button" key={book.id} onClick={() => onOpenBook?.(book.id)}><div data-i18n-skip className={`event-modal-book-cover library-cover-${book.coverTone ?? "blue"}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && book.title.slice(0, 1)}</div><span><strong data-i18n-skip>{book.title}</strong><small data-i18n-skip>{book.author}</small><p data-i18n-skip={Boolean(book.annotation)}>{book.annotation || t("book.noAnnotation")}</p></span></button>)}
    <p>{t("content.author")}: <button className="inline-user-link" data-i18n-skip type="button" onClick={() => onOpenUser?.(item.creatorId)}>{item.creatorName}</button></p>
    {item.moderationNote && item.status !== "published" && <div className="moderation-note"><strong>{t("moderation.comment")}</strong><p data-i18n-skip>{item.moderationNote}</p></div>}
    <MaterialEngagement kind="occasion" materialId={item.id} ownerId={item.creatorId} currentUser={currentUser} users={users} onOpenUser={onOpenUser} />
  </section></div>;
}

export function MaterialPreviewCard({ item, index = 0, owner, book, likesCount, commentsCount, kindLabel, onOpen, onOpenUser, onOpenAuthor, onOpenBook }: { item: ReadingItem; index?: number; owner?: Pick<DemoUser, "avatarUrl">; book?: LibraryBook | AuthorBook; likesCount?: number; commentsCount?: number; kindLabel?: string; onOpen: () => void; onOpenUser: (id: number) => void; onOpenAuthor?: () => void; onOpenBook?: () => void }) {
  const { t } = useI18n();
  const review = item.kind === "review";
  return <article className={`excerpt-card material-preview-card material-clickable-card ${review ? "review-preview-card" : ""}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><span className="quote-mark">“</span><p data-i18n-skip>{item.preview || item.text}</p><div className="excerpt-footer"><div data-i18n-skip className={`author-dot author-dot-${index % 3 + 1} ${owner?.avatarUrl ? "has-photo" : ""}`} style={owner?.avatarUrl ? { backgroundImage: `url(${owner.avatarUrl})` } : undefined}>{!owner?.avatarUrl && item.author.slice(0, 1)}</div><div><h3>{kindLabel ?? (review ? <>{t("content.reviews")}{item.rating ? ` · ★ ${item.rating}` : ""}</> : t("content.publications"))}</h3><span><button className="inline-user-link" data-i18n-skip type="button" onClick={(event) => { event.stopPropagation(); if (onOpenAuthor) onOpenAuthor(); else if (item.ownerId) onOpenUser(item.ownerId); }}>{item.author}</button>{book && <> · <button className="inline-book-link" data-i18n-skip type="button" onClick={(event) => { event.stopPropagation(); onOpenBook?.(); }}>{book.title}</button></>}</span>{(likesCount !== undefined || commentsCount !== undefined) && <small>♡ {likesCount ?? 0} · {t("content.comments")}: {commentsCount ?? 0}</small>}</div></div></article>;
}

export function PublisherNewsCard({ item, owner, onOpen, onOpenUser }: { item: PublisherNews; owner?: DemoUser; onOpen: () => void; onOpenUser: (id: number) => void }) {
  const { t, domainLabel } = useI18n();
  const community = owner?.profile.type === "Сообщество";
  return <article className="excerpt-card material-preview-card publisher-news-card material-clickable-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><span className="quote-mark">“</span><p data-i18n-skip>{item.previewText}</p><div className="excerpt-footer"><div data-i18n-skip className={`author-dot ${owner?.avatarUrl ? "has-photo" : ""}`} style={owner?.avatarUrl ? { backgroundImage: `url(${owner.avatarUrl})` } : undefined}>{!owner?.avatarUrl && (owner?.profile.name ?? "BM").slice(0, 1)}</div><div><h3>{t("content.publisherNews")}{item.isAdult ? " · 18+" : ""}</h3><span data-i18n-skip><button className="inline-user-link" type="button" onClick={(event) => { event.stopPropagation(); onOpenUser(item.ownerId); }}>{owner?.profile.name ?? domainLabel(community ? "Сообщество" : "Издатель")}</button> · {item.title}</span></div></div></article>;
}

export function PublisherNewsModal({ item, owner, currentUser, users = [], catalog = [], onClose, onOpenUser, onEdit, onDelete, onReport }: { item: PublisherNews; owner?: DemoUser; currentUser?: DemoUser; users?: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; onClose: () => void; onOpenUser: (id: number) => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void }) {
  const { t, domainLabel } = useI18n();
  const community = owner?.profile.type === "Сообщество";
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="reading-modal publisher-news-modal" onMouseDown={(event) => event.stopPropagation()}><ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={onClose} /><span className="section-subtitle">{t("content.publisherNews")} · <span data-i18n-skip>{item.createdAt}</span></span><h2 data-i18n-skip>{item.title}</h2><p className="reading-preview" data-i18n-skip>{item.previewText}</p><div className="reading-text rich-reading-text" data-i18n-skip dangerouslySetInnerHTML={{ __html: renderRichHtml(item.bodyHtml, catalog.length ? catalog : catalogFromUsers(users), { inlineImageAlt: t("editor.inlineImage"), noAnnotation: t("book.noAnnotation") }) }} /><p>{domainLabel(community ? "Сообщество" : "Издатель")}: <button className="inline-user-link" data-i18n-skip type="button" onClick={() => onOpenUser(item.ownerId)}>{owner?.profile.name ?? domainLabel(community ? "Сообщество" : "Издатель")}</button></p><MaterialEngagement kind="publisher_news" materialId={item.id} ownerId={item.ownerId} currentUser={currentUser} users={users.length ? users : owner ? [owner] : []} onOpenUser={onOpenUser} /></section></div>;
}

export function HomeScopeSwitch({ city, country, value, onChange }: { city: string; country?: string; value: "country" | "city"; onChange: (value: "country" | "city") => void }) {
  const { t, domainLabel } = useI18n();
  return <div className={`home-scope-switch scope-${value}`} role="group" aria-label={t("content.scope")}><span aria-hidden="true" /><button className={value === "country" ? "active" : ""} type="button" onClick={() => onChange("country")} data-i18n-skip={Boolean(country)}>{country || domainLabel("Казахстан")}</button><button className={value === "city" ? "active" : ""} type="button" onClick={() => onChange("city")} data-i18n-skip={Boolean(city)}>{city || t("content.myCity")}</button></div>;
}

export function ReadingModal({ item, currentUser, users = [], catalog: canonicalCatalog = [], likedUserIds = [], onToggleLike, onComment, onClose, onOpenUser, relationship, isFollowing, onAddFriend, onFollow, onEdit, onDelete, onReport }: { item: ReadingItem; currentUser?: DemoUser; users?: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; likedUserIds?: number[]; onToggleLike?: () => void; onComment?: (text: string) => Promise<MaterialComment | null>; onClose: () => void; onOpenUser?: (userId: number) => void; relationship?: SocialRelationship; isFollowing?: boolean; onAddFriend?: (message: string) => void; onFollow?: () => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void }) {
  const { locale, t } = useI18n();
  const routeBase = item.kind === "review" ? "/reviews" : "/blog";
  const routedPopup = useRoutedPopup(`${routeBase}/${item.id}`, routeBase, onClose, `${item.kind === "review" ? t("content.reviews") : t("content.publications")} — Book Meet`);
  const routedClose = routedPopup.close;
  const [comments, setComments] = useState<MaterialComment[]>([]);
  const [hydratedLikedIds, setHydratedLikedIds] = useState<number[]>(likedUserIds);
  const [comment, setComment] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [page, setPage] = useState(1);
  const [requesting, setRequesting] = useState(false);
  const [showAllLikes, setShowAllLikes] = useState(false);
  const [bookPopup, setBookPopup] = useState<LibraryBook | AuthorBook | null>(null);
  const effectiveLikedIds = Array.from(new Set([...likedUserIds, ...hydratedLikedIds]));
  const liked = Boolean(currentUser && effectiveLikedIds.includes(currentUser.id));
  const likedUsers = effectiveLikedIds.map((id) => users.find((user) => user.id === id)).filter(Boolean) as DemoUser[];
  const catalog = canonicalCatalog.length ? canonicalCatalog : catalogFromUsers(users);
  const linkedBookIds = item.linkedBookIds?.length ? item.linkedBookIds : item.linkedBookId ? [item.linkedBookId] : [];
  const matchingBooks = linkedBookIds.map((id) => catalog.find((book) => book.id === id)).filter(Boolean) as (LibraryBook | AuthorBook)[];
  const matchingBook = matchingBooks[0] ?? catalog.find((book) => book.title.toLowerCase() === item.title.replace(/[«»]/g, "").toLowerCase() && (!item.bookAuthor || book.author.toLowerCase() === item.bookAuthor.toLowerCase())) ?? null;
  const publisherPair = currentUser?.profile.type === "Издатель" || users.find((user) => user.id === item.ownerId)?.profile.type === "Издатель";
  async function deleteComment(entry: MaterialComment) {
    if (!window.confirm(t("material.deleteCommentConfirm"))) return;
    const response = await fetch(`/api/comments/${entry.id}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      window.alert(localizedApiError(data.error, t("material.deleteCommentError")));
      return;
    }
    setComments((current) => current.filter((commentEntry) => commentEntry.id !== entry.id));
  }
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && routedClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [routedClose]);
  useEffect(() => {
    let active = true;
    const refresh = () => Promise.all([
      fetch(`/api/reactions?kind=${item.kind}&id=${item.id}`, { cache: "no-store" }).then((response) => response.json()) as Promise<{ userIds: number[] }>,
      fetch(`/api/comments?kind=${item.kind}&id=${item.id}`, { cache: "no-store" }).then((response) => response.json()) as Promise<{ comments: MaterialComment[] }>,
    ]).then(([reactionData, commentData]) => { if (active) { setHydratedLikedIds(reactionData.userIds ?? []); setComments(commentData.comments ?? []); } }).catch((error) => console.warn(error));
    void refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [item.id, item.kind]);

  // A nested book has its own address. Keep this material mounted behind it so
  // closing the book restores both the previous popup and its URL.
  if (!routedPopup.active && !bookPopup) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={routedClose}>
      <article className="reading-modal" role="dialog" aria-modal="true" aria-labelledby="reading-title" onMouseDown={(event) => event.stopPropagation()}>
        <ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={routedClose} />
        <span className="section-subtitle">{item.kind === "review" ? `${t("content.reviews")}${item.rating ? ` · ★ ${item.rating}` : ""}` : t("content.blogPublications")}{item.isAdult ? " · 18+" : ""}</span>
        <h2 id="reading-title" data-i18n-skip={item.kind !== "review"}>{item.kind === "review" ? t("material.reviewOf", { title: matchingBook?.title ?? item.title.replace(/[«»]/g, "") }) : item.title}</h2>
        <p className="reading-author" data-i18n-skip>{item.ownerId ? <button className="inline-user-link" type="button" onClick={() => onOpenUser?.(item.ownerId!)}>{item.author}</button> : item.author}{item.createdAt ? ` · ${item.createdAt}` : ""}</p>
        {matchingBooks.map((book) => <button className="event-modal-book reading-linked-book" type="button" key={book.id} onClick={() => setBookPopup(book)}><div data-i18n-skip className={`event-modal-book-cover library-cover-${book.coverTone ?? "blue"}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && book.title.slice(0, 1)}</div><span><strong data-i18n-skip>{book.title}</strong><small data-i18n-skip>{book.author}</small><p data-i18n-skip={Boolean(book.annotation)}>{book.annotation || t("book.noAnnotation")}</p></span></button>)}
        {item.preview && <div className="reading-text reading-preview-text" data-i18n-skip>{item.preview}</div>}
        {item.bodyHtml ? <div className="reading-text rich-reading-text" data-i18n-skip onClick={(event) => { const spoiler = (event.target as Element).closest?.(".spoiler"); if (spoiler) spoiler.classList.add("is-revealed"); const inlineBook = (event.target as Element).closest?.(".rich-inline-book") as HTMLElement | null; const bookId = Number(inlineBook?.dataset.bookId); if (bookId) setBookPopup(catalog.find((book) => book.id === bookId) ?? null); }} dangerouslySetInnerHTML={{ __html: renderRichHtml(item.bodyHtml, catalog, { inlineImageAlt: t("editor.inlineImage"), noAnnotation: t("book.noAnnotation") }) }} /> : item.kind === "review" || !item.preview ? <div className="reading-text" data-i18n-skip><SpoilerText text={item.text} /></div> : null}
        <div className="reading-social-row"><button type="button" className={liked ? "outline-button liked" : "outline-button"} onClick={() => { if (currentUser) setHydratedLikedIds((current) => current.includes(currentUser.id) ? current.filter((id) => id !== currentUser.id) : [...current, currentUser.id]); onToggleLike?.(); }}>{liked ? "♥" : "♡"} {t("material.like")} · {effectiveLikedIds.length}</button>{item.ownerId && currentUser?.id !== item.ownerId && relationship === "none" && !publisherPair && <button type="button" className="outline-button tooltip-button" data-tooltip={t("material.friendTooltip")} onClick={() => setRequesting(true)}>{t("material.addAuthorFriend")}</button>}{item.ownerId && currentUser?.id !== item.ownerId && relationship === "outgoing" && !publisherPair && <button type="button" className="outline-button" disabled>{t("material.requestSent")}</button>}{item.ownerId && currentUser?.id !== item.ownerId && relationship !== "friends" && !isFollowing && <button type="button" className="outline-button tooltip-button" data-tooltip={publisherPair ? t("material.publisherFollowTooltip") : t("material.followTooltip")} onClick={onFollow}>{t("material.followAuthor")}</button>}</div>
        {requesting && <form className="friend-request-form" onSubmit={(event) => { event.preventDefault(); onAddFriend?.(requestNote); setRequesting(false); }}><textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder={t("material.friendRequestPlaceholder")} /><button className="primary-button" type="submit">{t("common.send")}</button></form>}
        {currentUser?.id === item.ownerId && likedUsers.length > 0 && <section className="material-likes"><h3>{t("material.like")} · {likedUsers.length}</h3><div>{likedUsers.slice(0, 4).map((user) => <button type="button" key={user.id} onClick={() => onOpenUser?.(user.id)}><span data-i18n-skip className={`avatar avatar-sm avatar-${user.color}`}>{user.initials}</span><strong data-i18n-skip>{user.profile.name}</strong></button>)}{likedUsers.length > 4 && <button className="other-likes-button" type="button" onClick={() => setShowAllLikes(true)}>{t("material.andOthers")}</button>}</div></section>}
        <section className="comments-block"><h3>{t("content.comments")} · {comments.length}</h3><form onSubmit={async (event) => { event.preventDefault(); const clean = comment.trim(); if (!clean) return; const saved = await onComment?.(clean); setComments((current) => [...current, saved ?? { id: Date.now(), text: clean, userId: currentUser?.id ?? 0, createdAt: new Date().toISOString() }]); setComment(""); }}><SpoilerTextarea rows={3} value={comment} onChange={setComment} placeholder={t("material.writeComment")} /><button className="primary-button" type="submit">{t("common.send")}</button></form>{comments.slice((page - 1) * 10, page * 10).map((entry) => { const author = users.find((user) => user.id === entry.userId); const canDelete = Boolean(currentUser && (currentUser.isAdmin || currentUser.id === entry.userId)); const canReport = Boolean(currentUser && !currentUser.isAdmin && currentUser.id !== entry.userId); return <article key={entry.id}><div className="comment-actions">{canReport && <button className="comment-report-button" type="button" onClick={() => openReportDialog({ kind: "comment", id: entry.id })} aria-label={t("safety.comment")} title={t("content.report")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 8v6" /><circle cx="12" cy="17" r="1" /></svg></button>}{canDelete && <button className="comment-delete-button" type="button" onClick={() => void deleteComment(entry)} aria-label={t("material.deleteComment")} title={t("material.deleteComment")}>×</button>}</div><button data-i18n-skip={Boolean(author)} type="button" onClick={() => entry.userId && onOpenUser?.(entry.userId)}>{author?.profile.name ?? t("material.user")}</button><small>{formatCommentDate(entry.createdAt, locale)}</small><p data-i18n-skip><SpoilerText text={entry.text} /></p></article>; })}{comments.length > 10 && <div className="comment-pages">{Array.from({ length: Math.ceil(comments.length / 10) }, (_, index) => <button className={page === index + 1 ? "active" : ""} type="button" key={index} onClick={() => setPage(index + 1)}>{index + 1}</button>)}</div>}</section>
        {showAllLikes && <div className="nested-modal-backdrop" onMouseDown={() => setShowAllLikes(false)}><section className="likes-list-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label={t("common.close")} onClick={() => setShowAllLikes(false)}>×</button><h2>{t("material.likedBy")}</h2>{likedUsers.map((user) => <button type="button" data-i18n-skip key={user.id} onClick={() => onOpenUser?.(user.id)}><span className={`avatar avatar-sm avatar-${user.color}`}>{user.initials}</span><span><strong>{user.profile.name}</strong><small>{user.profile.type} · {user.profile.city}</small></span></button>)}</section></div>}
        {bookPopup && <UnifiedBookModal book={bookPopup} users={users} catalog={catalog} nested onClose={() => setBookPopup(null)} onOpenUser={onOpenUser} />}
      </article>
    </div>
  );
}

export function FriendProfile({ friend, onClose }: { friend: Friend; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="friend-profile-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label={t("profile.close")}>×</button>
        <div className="profile-cover" />
        <div className="profile-modal-body">
          <Avatar friend={friend} size="lg" />
          <span className="profile-type" data-i18n-skip>{friend.type}</span>
          <h2 id="friend-profile-title" data-i18n-skip>{friend.name}</h2>
          <p className="profile-location" data-i18n-skip>⌖ {friend.city}</p>
          <p className="profile-bio" data-i18n-skip>{friend.bio}</p>
          <div className="profile-fact"><span>{t("profile.onShelf")}</span><strong>{friend.books}</strong></div>
          <div className="profile-tags" data-i18n-skip><span>Современная проза</span><span>Книжные клубы</span><span>Прогулки</span></div>
          <button className="primary-button" type="button" onClick={onClose}>{t("profile.backToChat")}</button>
        </div>
      </section>
    </div>
  );
}

function PublicProfileDetails({ user }: { user: DemoUser }) {
  const { locale, t } = useI18n();
  const textField = (label: string, value: string, className?: string) => value.trim() ? <div className={className}><span>{label}</span><p data-i18n-skip>{value}</p></div> : null;
  const genresField = (label: string, values: string[], disliked = false) => values.length ? <div><span>{label}</span><div className={`profile-tags ${disliked ? "disliked-tags" : ""}`} data-i18n-skip>{values.map((genre) => <span key={genre}>{genre}</span>)}</div></div> : null;
  if (user.profile.type === "Сообщество") return <div className="public-profile-details publisher-public-details">
    {textField(t("profile.communityType"), user.profile.communityType ?? "")}
    {textField(t("profile.aboutCommunity"), user.profile.bio, "profile-bio-wide")}
    {textField(t("profile.communityRules"), user.profile.communityRules ?? "", "profile-bio-wide")}
  </div>;
  if (user.profile.type === "Издатель") return <div className="public-profile-details publisher-public-details">
    {textField(t("profile.aboutPublisher"), user.profile.bio, "profile-bio-wide")}
    {user.profile.publisherWebsite && <div><span>{t("profile.publisherWebsite")}</span><p data-i18n-skip><a href={user.profile.publisherWebsite} target="_blank" rel="noreferrer">{user.profile.publisherWebsite}</a></p></div>}
    {(user.profile.publisherSalesLinks ?? []).length > 0 && <div><span>{t("profile.bookSales")}</span><div className="writer-book-links" data-i18n-skip>{user.profile.publisherSalesLinks!.map((link) => <a className="outline-button" href={link.url} target="_blank" rel="noreferrer" key={link.id}>{link.label}</a>)}</div></div>}
  </div>;
  return <div className="public-profile-details">
    {user.profile.birthDate && <div><span>{t("profile.birthday")}</span><p>{formatDateForLocale(locale, new Date(`${user.profile.birthDate}T00:00:00Z`), { day: "numeric", month: "long", timeZone: "UTC" })}</p></div>}
    {textField(t("profile.aboutMe"), user.profile.bio, "profile-bio-wide")}
    {user.profile.type === "Писатель" && textField(t("profile.authorInfluences"), user.profile.authorInfluences)}
    {user.profile.type === "Писатель" && textField(t("profile.writingThemes"), user.profile.writingThemes)}
    {textField(t("profile.weekend"), user.profile.weekend)}
    {textField(t("profile.joy"), user.profile.joy)}
    {textField(t("profile.talk"), user.profile.talk)}
    {textField(t("profile.strangerMessage"), user.profile.strangerMessage)}
    {genresField(t("profile.favoriteGenres"), user.profile.favoriteGenres)}
    {genresField(t("profile.dislikedGenres"), user.profile.dislikedGenres, true)}
  </div>;
}

export function UserProfileModal({ user, viewer, users, catalog, profileFriends = [], events = [], occasions = [], likes, friendCount, relationship, incomingMessage, isFollowing, canMessage, blockedByMe = false, onClose, onAddFriend, onCancelFriendRequest, onAccept, onReject, onRemoveFriend, onOpenChat, onFollow, onUnfollow, onBlock, onUnblock, onReport, onToggleLike, onComment, onOpenUser }: { user: DemoUser; viewer: DemoUser; users: DemoUser[]; catalog: (LibraryBook | AuthorBook)[]; profileFriends?: DemoUser[]; events?: BookEvent[]; occasions?: Occasion[]; likes: Record<string, number[]>; friendCount: number; relationship: SocialRelationship; incomingMessage?: string; isFollowing: boolean; canMessage: boolean; blockedByMe?: boolean; onClose: () => void; onAddFriend: (message: string) => void; onCancelFriendRequest: () => Promise<void>; onAccept: () => void; onReject: (comment: string) => void; onRemoveFriend: () => void; onOpenChat: () => void; onFollow: () => void; onUnfollow: () => Promise<void>; onBlock?: () => Promise<void>; onUnblock?: () => Promise<void>; onReport?: () => void; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void }) {
  const { t, domainLabel } = useI18n();
  const routedPopup = useRoutedPopup(`/users/${user.id}`, "/users", onClose, `${user.profile.name} — Book Meet`);
  const routedClose = routedPopup.close;
  const [rejecting, setRejecting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [socialBusy, setSocialBusy] = useState(false);
  const [unblockConfirm, setUnblockConfirm] = useState(false);
  const [comment, setComment] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "author-books" | "excerpts" | "publisher-events" | "publisher-news" | "library" | "wishlist" | "reviews" | "occasions" | "members">("main");
  const [openedPublisherEvent, setOpenedPublisherEvent] = useState<BookEvent | null>(null);
  const [openedPublisherNews, setOpenedPublisherNews] = useState<PublisherNews | null>(null);
  const [openedOccasion, setOpenedOccasion] = useState<Occasion | null>(null);
  const [profileWishBooks, setProfileWishBooks] = useState(user.wishBooks ?? []);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [openedAuthorBook, setOpenedAuthorBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [openedReview, setOpenedReview] = useState<ReadingItem | UserReview | null>(null);
  const [bookDetailTab, setBookDetailTab] = useState<"about" | "readers" | "reviews">("about");
  const [libraryStatus, setLibraryStatus] = useState<"want" | "reading" | "read">(() =>
    user.books.some((book) => (book.readingStatus ?? "read") === "read")
      ? "read"
      : user.books.some((book) => book.readingStatus === "reading") ? "reading" : "want",
  );
  const commonBooks = viewer.books.filter((book) => user.books.some((other) => other.title.toLowerCase() === book.title.toLowerCase() && other.author.toLowerCase() === book.author.toLowerCase()));
  const commonFavoriteGenres = viewer.profile.favoriteGenres.filter((genre) => user.profile.favoriteGenres.includes(genre));
  const commonDislikedGenres = viewer.profile.dislikedGenres.filter((genre) => user.profile.dislikedGenres.includes(genre));
  const hasMatches = commonBooks.length + commonFavoriteGenres.length + commonDislikedGenres.length > 0;
  const openedReadingItem: ReadingItem | null = openedReview ? ("kind" in openedReview ? openedReview : { id: openedReview.id, kind: "review", title: openedReview.bookTitle, author: user.profile.name, text: openedReview.fullText, ownerId: user.id, createdAt: openedReview.createdAt, preview: openedReview.preview, bookAuthor: openedReview.bookAuthor, rating: openedReview.rating, isAdult: openedReview.isAdult }) : null;
  const isCommunity = user.profile.type === "Сообщество";
  const isCommunityMember = relationship === "community-member";
  const viewerIsCommunity = viewer.profile.type === "Сообщество";
  const publisherPair = user.profile.type === "Издатель" || viewer.profile.type === "Издатель";
  const isOrganization = user.profile.type === "Издатель" || isCommunity;
  const tabVisible = (tab: ProfileTab) => !(user.profile.hiddenProfileTabs ?? []).includes(tab);
  const publicEvents = events.filter((item) => item.creatorId === user.id && item.status === "published");
  const publicOccasions = occasions.filter((item) => item.creatorId === user.id && item.status === "published");
  const publicLibraryBooks = sortLibraryBooks(user.books.filter((book) => (book.readingStatus ?? "read") === libraryStatus));

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && routedClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [routedClose]);

  if (!routedPopup.active && !openedBook && !openedAuthorBook && !openedReview && !openedPublisherEvent && !openedPublisherNews && !openedOccasion) return null;
  if (user.deletedAt || user.purged) return <div className="modal-backdrop profile-modal-backdrop" onMouseDown={routedClose}><section className="simple-warning-modal deleted-profile-notice" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t("common.close")} type="button" onClick={routedClose}>×</button><h2>{t("profile.deletedTitle")}</h2><p>{t("profile.deletedBody")}</p>{viewer.isAdmin && !user.purged ? <div className="form-actions"><button className="outline-button" type="button" title={t("profile.restore")} onClick={async () => { const response = await fetch(`/api/admin/users/${user.id}/restore`, { method: "POST", credentials: "same-origin" }); if (response.ok) window.location.reload(); }}>↶ {t("profile.restore")}</button><button className="quiet-danger-button" type="button" title={t("profile.deleteForever")} onClick={async () => { if (!window.confirm(t("profile.deleteForeverConfirm"))) return; const response = await fetch(`/api/admin/users/${user.id}/permanent`, { method: "DELETE", credentials: "same-origin" }); if (response.ok) window.location.reload(); }}>🗑 {t("profile.deleteForever")}</button></div> : <button className="primary-button" type="button" onClick={routedClose}>{t("common.close")}</button>}</section></div>;
  return (
    <div className="modal-backdrop profile-overlay-top" role="presentation" onMouseDown={routedClose}>
      <section className="public-profile-modal" role="dialog" aria-modal="true" aria-labelledby="public-profile-title" onMouseDown={(event) => event.stopPropagation()}>
        <ModalIconActions onReport={onReport} onClose={routedClose} />
        <div className="public-profile-cover" />
        <div className="public-profile-body">
          <div className={`avatar avatar-lg avatar-${user.color} ${user.avatarUrl ? "has-photo" : ""}`} style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}>{!user.avatarUrl && user.initials}{user.online && <span className="online-dot" />}</div>
          <span className="profile-type">{domainLabel(user.profile.type)}</span>
          <h2 id="public-profile-title" data-i18n-skip>{user.profile.name}</h2>{user.profile.city && <p className="profile-location" data-i18n-skip>⌖ {user.profile.city}</p>}<p className={`profile-presence ${user.online ? "is-online" : ""}`}>{user.online ? t("chat.online") : t("chat.offline")}</p>
          <div className="public-profile-actions">
            {!blockedByMe && onBlock && <button className="profile-block-button" type="button" title={viewer.isAdmin ? t("profile.blockSite") : t("profile.block")} aria-label={t("profile.block")} onClick={() => void onBlock()}>🔒</button>}
            {blockedByMe && <><span className="blocked-profile-label">{t("profile.blockedByYou")}</span><button className="outline-button" type="button" onClick={() => setUnblockConfirm(true)}>{t("profile.unblock")}</button></>}
            {!blockedByMe && <>
            {relationship === "incoming" && !isCommunity && (!publisherPair || viewerIsCommunity) && <><button className="primary-button" type="button" onClick={onAccept}>{viewerIsCommunity ? t("profile.acceptCommunity") : t("profile.startFriendship")}</button><button className="outline-button" type="button" onClick={() => setRejecting(true)}>{viewerIsCommunity ? t("profile.rejectApplication") : t("profile.rejectRequest")}</button></>}
            {relationship === "outgoing" && (!publisherPair || isCommunity) && <button className="outline-button" type="button" onClick={() => setCancellingRequest(true)}>{isCommunity ? t("profile.applicationSent") : t("material.requestSent")}</button>}
            {relationship === "none" && viewer.profile.type !== "Сообщество" && (!publisherPair || isCommunity) && <button className="primary-button tooltip-button" data-tooltip={isCommunity ? t("profile.joinTooltip") : t("profile.friendTooltip")} type="button" onClick={() => setRequesting(true)}>{isCommunity ? t("profile.joinCommunity") : t("profile.addFriend")}</button>}
            {((relationship === "friends" && !publisherPair) || isCommunityMember) && <><button className="primary-button" type="button" onClick={onOpenChat}>{t("profile.message")}</button><button className="quiet-danger-button" type="button" onClick={onRemoveFriend}>{isCommunity ? t("profile.leaveCommunity") : viewerIsCommunity && isCommunityMember ? t("profile.removeMember") : t("profile.unfriend")}</button></>}
            {(!isCommunityMember && (relationship !== "friends" || publisherPair)) && canMessage && <button className="primary-button" type="button" onClick={onOpenChat}>{user.isAdmin ? t("profile.messageSupport") : t("profile.message")}</button>}
            {(relationship !== "friends" || publisherPair) && !isFollowing && !isCommunity && !viewerIsCommunity && <button className="follow-button tooltip-button" data-tooltip={publisherPair ? t("material.publisherFollowTooltip") : t("material.followTooltip")} type="button" onClick={onFollow}>{t("profile.follow")}</button>}
            {(relationship !== "friends" || publisherPair) && isFollowing && <button className="follow-button" type="button" disabled={socialBusy} onClick={async () => { setSocialBusy(true); try { await onUnfollow(); } finally { setSocialBusy(false); } }}>{t("profile.unfollow")}</button>}
            </>}
          </div>
          {unblockConfirm && <div className="nested-modal-backdrop" onMouseDown={() => setUnblockConfirm(false)}><section className="confirm-social-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>{t("profile.unblockConfirm")}</h2><div className="form-actions"><button className="outline-button" type="button" onClick={async () => { await onUnblock?.(); setUnblockConfirm(false); }}>{t("common.yes")}</button><button className="outline-button" type="button" onClick={() => setUnblockConfirm(false)}>{t("common.no")}</button></div></section></div>}
          {relationship === "incoming" && incomingMessage && (!publisherPair || viewerIsCommunity) && <div className="incoming-friend-message"><span>{viewerIsCommunity ? t("profile.applicationMessage") : t("profile.friendMessage")}</span><p data-i18n-skip>{incomingMessage}</p></div>}
          {requesting && relationship === "none" && <form className="friend-request-form" onSubmit={(event) => { event.preventDefault(); onAddFriend(requestMessage.trim()); setRequesting(false); }}><textarea autoFocus rows={4} value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} placeholder={isCommunity ? t("profile.applicationPlaceholder") : t("material.friendRequestPlaceholder")} /><button className="primary-button" type="submit">{t("common.send")}</button></form>}
          {rejecting && <form className="reject-form" onSubmit={(event) => { event.preventDefault(); onReject(comment); }}><label>{t("profile.rejectReason")}<textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("profile.optional")} /></label><div><button type="button" onClick={() => setRejecting(false)}>{t("common.cancel")}</button><button type="submit">{t("profile.reject")}</button></div></form>}
          {cancellingRequest && <div className="nested-modal-backdrop" onMouseDown={() => setCancellingRequest(false)}><section className="confirm-social-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>{t("profile.cancelRequest")}</h2><div className="form-actions"><button type="button" onClick={async () => { setSocialBusy(true); try { await onCancelFriendRequest(); setCancellingRequest(false); } finally { setSocialBusy(false); } }} disabled={socialBusy}>{t("common.yes")}</button><button className="primary-button" type="button" autoFocus onClick={() => setCancellingRequest(false)}>{t("common.no")}</button></div></section></div>}
          {activeTab === "main" && !isOrganization && hasMatches && <section className="interest-matches"><h3>{t("profile.interestMatches")}</h3><div className="interest-match-grid"><div title={commonBooks.map((book) => book.title).join(", ")}><strong>{commonBooks.length}</strong><span>{t("profile.commonBooks")}</span></div><div title={commonFavoriteGenres.join(", ")}><strong>{commonFavoriteGenres.length}</strong><span>{t("profile.commonFavorites")}</span></div><div title={commonDislikedGenres.join(", ")}><strong>{commonDislikedGenres.length}</strong><span>{t("profile.commonDislikes")}</span></div></div></section>}
          <nav className="public-profile-tabs" aria-label={t("nav.profile")}>
            <button className={activeTab === "main" ? "active" : ""} type="button" onClick={() => setActiveTab("main")}>{t("profile.main")}</button>
            {tabVisible("author-books") && (user.profile.type === "Писатель" || isOrganization) && Boolean(user.authorBooks?.length) && <button className={activeTab === "author-books" ? "active" : ""} type="button" onClick={() => setActiveTab("author-books")}>{isCommunity ? t("profile.communityBooks") : user.profile.type === "Издатель" ? t("profile.publisherBooks") : t("nav.books")} <span>{user.authorBooks?.length ?? 0}</span></button>}
            {tabVisible("excerpts") && (user.profile.type === "Писатель" || user.profile.type === "Блогер") && Boolean(user.excerpts?.length) && <button className={activeTab === "excerpts" ? "active" : ""} type="button" onClick={() => setActiveTab("excerpts")}>{t("content.blog")} <span>{user.excerpts?.length ?? 0}</span></button>}
            {tabVisible("events") && isOrganization && publicEvents.length > 0 && <button className={activeTab === "publisher-events" ? "active" : ""} type="button" onClick={() => setActiveTab("publisher-events")}>{isCommunity ? t("profile.communityEvents") : t("profile.publisherEvents")} <span>{publicEvents.length}</span></button>}
            {tabVisible("events") && !isOrganization && publicEvents.length > 0 && <button className={activeTab === "publisher-events" ? "active" : ""} type="button" onClick={() => setActiveTab("publisher-events")}>{t("profile.events")} <span>{publicEvents.length}</span></button>}
            {tabVisible("publisher-news") && isOrganization && Boolean(user.publisherNews?.length) && <button className={activeTab === "publisher-news" ? "active" : ""} type="button" onClick={() => setActiveTab("publisher-news")}>{t("content.publisherNews")} <span>{user.publisherNews?.length ?? 0}</span></button>}
            {tabVisible("library") && !isOrganization && user.books.length > 0 && <button className={activeTab === "library" ? "active" : ""} type="button" onClick={() => setActiveTab("library")}>{t("profile.library")} <span>{user.books.length}</span></button>}
            {tabVisible("wishlist") && relationship === "friends" && (user.profile.type === "Читатель" || user.profile.type === "Блогер") && profileWishBooks.length > 0 && <button className={activeTab === "wishlist" ? "active" : ""} type="button" onClick={() => setActiveTab("wishlist")}>{t("wishlist.title")} <span>{profileWishBooks.length}</span></button>}
            {tabVisible("reviews") && (user.profile.type === "Читатель" || user.profile.type === "Блогер") && user.reviews.length > 0 && <button className={activeTab === "reviews" ? "active" : ""} type="button" onClick={() => setActiveTab("reviews")}>{t("profile.reviews")} <span>{user.reviews.length}</span></button>}
            {tabVisible("occasions") && !isOrganization && publicOccasions.length > 0 && <button className={activeTab === "occasions" ? "active" : ""} type="button" onClick={() => setActiveTab("occasions")}>{t("profile.occasions")} <span>{publicOccasions.length}</span></button>}
            {tabVisible("friends") && isCommunity && <button className={activeTab === "members" ? "active" : ""} type="button" onClick={() => setActiveTab("members")}>{t("profile.communityMembers")} <span>{profileFriends.length}</span></button>}
          </nav>
          {activeTab === "main" && <PublicProfileDetails user={user} />}
          {activeTab === "author-books" && <div className="public-books-grid">{(user.authorBooks ?? []).map((book) => <button type="button" className="public-book-card" key={book.id} onClick={() => setOpenedAuthorBook(book)}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><h3>{book.title}</h3><p>{book.author}</p></button>)}</div>}
          {activeTab === "excerpts" && <div className="public-reviews-list">{(user.excerpts ?? []).map((excerpt) => <button type="button" key={excerpt.id} onClick={() => setOpenedReview({ id: excerpt.id, kind: "excerpt", title: excerpt.bookTitle || t("content.publications"), author: user.profile.name, text: excerpt.text, preview: excerpt.previewText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.bookId, linkedBookIds: excerpt.bookIds, ownerId: user.id, createdAt: excerpt.createdAt })}><span data-i18n-skip>{excerpt.createdAt}</span><h3 data-i18n-skip={Boolean(excerpt.bookTitle)}>{excerpt.bookTitle || t("content.publications")}</h3><p data-i18n-skip>{excerpt.previewText || excerpt.text.slice(0, 500)}</p><b>{t("common.open")} →</b></button>)}</div>}
          {activeTab === "publisher-events" && <div className="events-grid">{events.filter((item) => item.creatorId === user.id && item.status === "published").map((item) => <EventCard key={item.id} item={item} own={false} onOpen={() => setOpenedPublisherEvent(item)} />)}</div>}
          {activeTab === "publisher-news" && <div className="publisher-news-grid">{(user.publisherNews ?? []).map((item) => <button type="button" key={item.id} onClick={() => setOpenedPublisherNews(item)}><span>{item.createdAt}</span><h3>{item.title}</h3><p>{item.previewText}</p></button>)}</div>}
          {activeTab === "library" && <div className="public-library-view"><div className="library-status-filter public-library-status-filter" role="group" aria-label={t("library.statusFilter")}><button className={libraryStatus === "want" ? "active" : ""} type="button" onClick={() => setLibraryStatus("want")}>{t("content.want")}</button><button className={libraryStatus === "reading" ? "active" : ""} type="button" onClick={() => setLibraryStatus("reading")}>{t("content.reading")}</button><button className={libraryStatus === "read" ? "active" : ""} type="button" onClick={() => setLibraryStatus("read")}>{t("content.readDone")}</button></div><div className="public-books-grid">{publicLibraryBooks.map((book) => <button type="button" data-i18n-skip className={`public-book-card ${book.topRank ? "top3-book" : ""}`} key={book.id} onClick={() => setOpenedAuthorBook(book)}>{book.topRank && <span className="top3-crown" aria-label={`TOP3, ${book.topRank}`}>♛<b>{book.topRank}</b></span>}<div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><h3>{book.title}</h3><p>{book.author}</p>{libraryStatus === "read" && <span>★ {book.rating}</span>}</button>)}</div>{!publicLibraryBooks.length && <div className="profile-tab-placeholder">{t("library.sectionEmpty")}</div>}</div>}
          {activeTab === "wishlist" && relationship === "friends" && <WishlistTab books={profileWishBooks} setBooks={setProfileWishBooks} owner={{ ...user, wishBooks: profileWishBooks }} viewer={viewer} users={users} readOnly />}
          {activeTab === "reviews" && (user.profile.type === "Читатель" || user.profile.type === "Блогер") && <div className="public-reviews-list">{user.reviews.map((review) => <button type="button" data-i18n-skip key={review.id} onClick={() => setOpenedReview({ id: review.id, kind: "review", title: review.bookTitle, author: user.profile.name, text: review.fullText, ownerId: user.id, createdAt: review.createdAt, preview: review.preview, bookAuthor: review.bookAuthor, rating: review.rating })}><span>★ {review.rating} · {review.createdAt}</span><h3>{review.bookTitle}</h3><p>{review.preview}</p><b data-i18n-skip={false}>{t("content.read")} →</b></button>)}</div>}
          {activeTab === "occasions" && <div className="occasion-grid">{occasions.filter((item) => item.creatorId === user.id && item.status === "published").map((item) => <OccasionCard key={item.id} item={item} own={false} onOpen={() => setOpenedOccasion(item)} />)}{!occasions.some((item) => item.creatorId === user.id && item.status === "published") && <div className="profile-tab-placeholder">{t("occasion.userEmpty")}</div>}</div>}
          {activeTab === "members" && <div className="community-members-grid">{profileFriends.map((member) => <button className="community-member-card" type="button" key={member.id} onClick={() => onOpenUser(member.id)}><span className={`avatar avatar-md avatar-${member.color} ${member.avatarUrl ? "has-photo" : ""}`} style={member.avatarUrl ? { backgroundImage: `url(${member.avatarUrl})` } : undefined}>{!member.avatarUrl && member.initials}</span><span><strong>{member.profile.name}</strong><small>{member.profile.type} · {member.profile.city}</small></span></button>)}</div>}
        </div>
        {openedBook && <UnifiedBookModal book={openedBook} users={users} catalog={catalog} events={events} nested onClose={() => setOpenedBook(null)} onOpenUser={onOpenUser} />}
        {openedReadingItem && <ReadingModal item={openedReadingItem} currentUser={viewer} users={users} catalog={catalog} likedUserIds={likes[`${openedReadingItem.kind}-${openedReadingItem.id}`] ?? []} onToggleLike={() => onToggleLike(openedReadingItem)} onComment={(text) => onComment(openedReadingItem, text)} onClose={() => setOpenedReview(null)} onReport={!viewer.isAdmin ? () => openReportDialog({ kind: openedReadingItem.kind, id: openedReadingItem.id }) : undefined} onOpenUser={onOpenUser} relationship={relationship} isFollowing={isFollowing} onAddFriend={onAddFriend} onFollow={onFollow} onEdit={viewer.isAdmin ? () => void editReadingMaterial(openedReadingItem, viewer) : undefined} onDelete={viewer.isAdmin ? () => void deleteReadingMaterial(openedReadingItem, viewer) : undefined} />}
        {openedAuthorBook && <UnifiedBookModal book={openedAuthorBook} users={users} catalog={catalog} nested onClose={() => setOpenedAuthorBook(null)} onOpenUser={onOpenUser} onReport={!viewer.isAdmin ? () => openReportDialog({ kind: "book", id: openedAuthorBook.id }) : undefined} />}
        {openedPublisherEvent && <EventModal item={openedPublisherEvent} users={users} catalog={catalog} currentUserId={viewer.id} currentUser={viewer} onOpenUser={onOpenUser} onClose={() => setOpenedPublisherEvent(null)} onReport={!viewer.isAdmin ? () => openReportDialog({ kind: "event", id: openedPublisherEvent.id }) : undefined} />}
        {openedPublisherNews && <PublisherNewsModal item={openedPublisherNews} owner={user} currentUser={viewer} users={users} catalog={catalog} onOpenUser={onOpenUser} onReport={!viewer.isAdmin ? () => openReportDialog({ kind: "publisher_news", id: openedPublisherNews.id }) : undefined} onClose={() => setOpenedPublisherNews(null)} />}
        {openedOccasion && <OccasionModal item={openedOccasion} currentUser={viewer} users={users} onOpenUser={onOpenUser} onOpenBook={(bookId) => setOpenedBook(catalog.find((book) => book.id === bookId) ?? null)} onClose={() => setOpenedOccasion(null)} onReport={!viewer.isAdmin ? () => openReportDialog({ kind: "occasion", id: openedOccasion.id }) : undefined} />}
      </section>
    </div>
  );
}

export function UnifiedBookModal({ book: sourceBook, users, catalog = [], viewer, events = [], onClose, onOpenUser, onOpenReview, onOpenEvent, onEdit, onDelete, onReport, nested = false, retainWhenInactive = false }: { book: LibraryBook | AuthorBook; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; viewer?: DemoUser; events?: BookEvent[]; onClose: () => void; onOpenUser?: (userId: number) => void; onOpenReview?: (review: UserReview, user: DemoUser) => void; onOpenEvent?: (event: BookEvent) => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void; nested?: boolean; retainWhenInactive?: boolean }) {
  const { locale, t } = useI18n();
  const book = resolveCanonicalBook(sourceBook, users, catalog);
  const bookAuthorProfile = book.creatorUserId ? users.find((user) => user.id === book.creatorUserId) : undefined;
  const routedPopup = useRoutedPopup(`/books/${book.id}`, "/", onClose, `${book.title} — Book Meet`);
  const routedClose = routedPopup.close;
  const [tab, setTab] = useState<"about" | "readers" | "reviews" | "wishers">("about");
  const [warningLink, setWarningLink] = useState<BookLink | null>(null);
  const [openedReview, setOpenedReview] = useState<{ review: UserReview; reviewer: DemoUser } | null>(null);
  const sameBook = (title: string, author: string) => title.toLowerCase() === book.title.toLowerCase() && author.toLowerCase() === book.author.toLowerCase();
  const readers = users.flatMap((reader) => reader.books.filter((item) => sameBook(item.title, item.author) && (item.readingStatus ?? "read") !== "want").map((item) => ({ reader, item })));
  const bookReviews = users.flatMap((reviewer) => reviewer.reviews.filter((review) => sameBook(review.bookTitle, review.bookAuthor)).map((review) => ({ reviewer, review })));
  const wishers = users.filter((user) => user.books.some((item) => sameBook(item.title, item.author) && item.readingStatus === "want") || (user.wishBooks ?? []).some((item) => item.catalogBookId === book.id || sameBook(item.title, item.author)));
  const relatedEvents = events.filter((event) => event.status === "published" && (event.linkedBookIds?.includes(book.id) || event.linkedBookId === book.id) && eventTimestamp(event) > Date.now()).sort((a, b) => eventTimestamp(a) - eventTimestamp(b));
  const catalogBookId = book.catalogBookId ?? book.id;
  const effectiveViewer = viewer ?? users.find((user) => user.id === Number(document.documentElement.dataset.bookMeetUserId));
  const canAddToLibrary = Boolean(effectiveViewer && !["Издатель", "Сообщество"].includes(effectiveViewer.profile.type) && !effectiveViewer.books.some((item) => (item.catalogBookId ?? item.id) === catalogBookId));
  if (!routedPopup.active && !openedReview && !retainWhenInactive) return null;
  return (
    <div className={nested ? "nested-modal-backdrop" : "modal-backdrop"} onMouseDown={routedClose}>
      <section className="unified-book-modal" onMouseDown={(event) => event.stopPropagation()}>
        <ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={routedClose} />
        <div className="unified-book-layout">
          <div className={`library-book-cover library-cover-${book.coverTone}`} data-i18n-skip style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div>
          <div className="unified-book-copy">
            <span className="section-subtitle">{t("book.card")}{book.isAdult ? " · 18+" : ""}</span><h2 data-i18n-skip>{book.title}</h2>{bookAuthorProfile && onOpenUser ? <button className="book-author-profile" data-i18n-skip type="button" onClick={() => onOpenUser(bookAuthorProfile.id)}><span className={`avatar avatar-sm avatar-${bookAuthorProfile.color} ${bookAuthorProfile.avatarUrl ? "has-photo" : ""}`} style={bookAuthorProfile.avatarUrl ? { backgroundImage: `url(${bookAuthorProfile.avatarUrl})` } : undefined}>{!bookAuthorProfile.avatarUrl && bookAuthorProfile.initials}</span><span>{book.author}</span></button> : <p className="library-author" data-i18n-skip>{book.author}</p>}
            <div className="profile-tags" data-i18n-skip>{book.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>
            <nav className="book-detail-tabs">
              <button className={tab === "about" ? "active" : ""} type="button" onClick={() => setTab("about")}>{t("book.about")}</button>
              <button className={tab === "readers" ? "active" : ""} type="button" onClick={() => setTab("readers")}>{t("book.readers")}</button>
              <button className={tab === "reviews" ? "active" : ""} type="button" onClick={() => setTab("reviews")}>{t("content.reviews")}</button>
              <button className={tab === "wishers" ? "active" : ""} type="button" onClick={() => setTab("wishers")}>{t("book.wishers")}</button>
            </nav>
            {tab === "about" && <div className="unified-book-section">{(book.isbn || book.publisher) && <dl className="book-edition-details">{book.isbn && <><dt>ISBN</dt><dd data-i18n-skip>{book.isbn}</dd></>}{book.publisher && <><dt>{t("content.publisher")}</dt><dd data-i18n-skip>{book.publisher}</dd></>}</dl>}<p data-i18n-skip={Boolean(book.annotation)}>{book.annotation || t("book.noAnnotation")}</p>{relatedEvents.length > 0 && <div className="book-related-events">{relatedEvents.map((event) => <button type="button" data-i18n-skip key={event.id} onClick={() => onOpenEvent?.(event)}><strong>{event.title}</strong><span>{new Date(`${event.date}T00:00:00`).toLocaleDateString(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU")} · {event.time} · {event.city}</span></button>)}</div>}<div className="writer-book-links book-primary-actions">{book.flipUrl && <button type="button" onClick={() => setWarningLink({ id: -1, label: "Flip", url: book.flipUrl!, action: "Купить" })}>{t("book.buyOnFlip")}</button>}{(book.links ?? []).filter((link) => link.url !== book.flipUrl).map((link) => <button type="button" key={link.id} onClick={() => setWarningLink(link)}>{t(link.action === "Читать" ? "content.read" : link.action === "Слушать" ? "content.listen" : "content.buy")} · <span data-i18n-skip>{link.label}</span></button>)}{canAddToLibrary && <button className="primary-button add-catalog-to-library" type="button" onClick={() => window.dispatchEvent(new CustomEvent("bookmeet:add-catalog-book", { detail: { bookId: catalogBookId } }))}>{t("content.addLibrary")}</button>}</div></div>}
            {tab === "readers" && <div className="book-readers-list">{readers.length ? readers.map(({ reader, item }) => <button type="button" className="book-reader-row" key={`${reader.id}-${item.id}`} onClick={() => onOpenUser?.(reader.id)}><span data-i18n-skip className={`avatar avatar-sm avatar-${reader.color} ${reader.avatarUrl ? "has-photo" : ""}`} style={reader.avatarUrl ? { backgroundImage: `url(${reader.avatarUrl})` } : undefined}>{!reader.avatarUrl && reader.initials}</span><span><span className="inline-user-link" data-i18n-skip>{reader.profile.name}</span>{(item.readingStatus ?? "read") === "read" && item.rating > 0 && <strong> · ★ {item.rating}</strong>}<small className="book-reader-status">{item.readingStatus === "reading" ? t("book.readingNow", { chapter: item.lastReadChapter ? ` · ${t("book.chapter", { chapter: item.lastReadChapter })}` : "" }) : t("content.readDone")}</small>{item.readingStatus === "reading" && item.readingComment && <span className="book-reader-note" data-i18n-skip>«{item.readingComment}»</span>}{item.review && <span className="book-reader-note" data-i18n-skip>«{item.review}»</span>}</span></button>) : <p>{t("book.noReaders")}</p>}</div>}
            {tab === "reviews" && <div className="book-review-results">{bookReviews.length ? bookReviews.map(({ reviewer, review }) => <button type="button" data-i18n-skip key={`${reviewer.id}-${review.id}`} onClick={() => onOpenReview ? onOpenReview(review, reviewer) : setOpenedReview({ review, reviewer })}><strong>★ {review.rating} · {review.createdAt}</strong><p>{review.preview}</p><span className="inline-user-link">{reviewer.profile.name}</span></button>) : <div><p>{t("book.noReviews")}</p><button className="primary-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("bookmeet:create-review"))}>{t("book.firstReview")}</button></div>}</div>}
            {tab === "wishers" && <div className="book-readers-list">{wishers.length ? wishers.map((user) => <button type="button" className="book-reader-row" key={user.id} onClick={() => onOpenUser?.(user.id)}><span data-i18n-skip className={`avatar avatar-sm avatar-${user.color} ${user.avatarUrl ? "has-photo" : ""}`} style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}>{!user.avatarUrl && user.initials}</span><span data-i18n-skip><span className="inline-user-link">{user.profile.name}</span><span className="book-reader-note">{user.profile.type} · {user.profile.city}</span></span></button>) : <p>{t("book.noWishers")}</p>}</div>}
          </div>
        </div>
        {warningLink && <div className="nested-modal-backdrop" onMouseDown={() => setWarningLink(null)}><section className="external-warning" onMouseDown={(event) => event.stopPropagation()}><h2>{t("book.externalSite")}</h2><p data-i18n-skip>{warningLink.url}</p><div className="form-actions"><button type="button" onClick={() => setWarningLink(null)}>{t("common.cancel")}</button><button className="primary-button" type="button" onClick={() => window.open(warningLink.url, "_blank", "noopener,noreferrer")}>{t("book.continue")}</button></div></section></div>}
        {openedReview && <ReadingModal item={{ id: openedReview.review.id, kind: "review", title: openedReview.review.bookTitle, author: openedReview.reviewer.profile.name, text: openedReview.review.fullText, bodyHtml: openedReview.review.bodyHtml, linkedBookId: openedReview.review.bookId, ownerId: openedReview.reviewer.id, createdAt: openedReview.review.createdAt, preview: openedReview.review.preview, bookAuthor: openedReview.review.bookAuthor, rating: openedReview.review.rating, isAdult: openedReview.review.isAdult }} users={users} onOpenUser={onOpenUser} onClose={() => setOpenedReview(null)} />}
      </section>
    </div>
  );
}

export function BookMatchSuggestions({ books, queryAuthor, queryTitle, queryIsbn = "", onSelect }: { books: (LibraryBook | AuthorBook)[]; queryAuthor: string; queryTitle: string; queryIsbn?: string; onSelect: (book: LibraryBook | AuthorBook) => void }) {
  const { t } = useI18n();
  const query = [queryTitle, queryAuthor, queryIsbn].map((value) => value.trim()).filter((value) => value.length >= 2).join(" ");
  const matches = query ? books.filter((book) => matchesBookQuery(book, query)).slice(0, 4) : [];
  if (!matches.length) return null;
  return <div className="book-match-suggestions"><strong>{t("book.addThis")}</strong>{matches.map((book) => <button type="button" data-i18n-skip key={`${book.author}-${book.title}`} onClick={() => onSelect(book)}><div className={`match-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <span>{book.title.slice(0, 1)}</span>}</div><span><b>{book.title}</b><small>{book.author}</small></span></button>)}</div>;
}

export function RatingStars({ value, onChange, label, allowHalf = false }: { value: number; onChange: (rating: number) => void; label?: string; allowHalf?: boolean }) {
  const { locale, t } = useI18n();
  const effectiveLabel = label ?? t("content.rating");
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const shownValue = hoverValue ?? value;
  return (
    <div className="rating-stars" role="group" aria-label={t("book.ratingOfFive", { label: effectiveLabel, value: value || t("book.notSelected") })} onMouseLeave={() => setHoverValue(null)}>
      {[1, 2, 3, 4, 5].map((star) => {
        const halfValue = star - 0.5;
        const fill = Math.max(0, Math.min(1, shownValue - star + 1));
        return <span className="rating-star-control" key={star}>
          <svg className="rating-star-base" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 1.7 15.2 8l7 .95-5.1 4.9 1.25 6.95L12 17.5l-6.35 3.3 1.25-6.95-5.1-4.9 7-.95L12 1.7Z" /></svg>
          <svg className="rating-star-fill" aria-hidden="true" viewBox="0 0 24 24" style={{ clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` }}><path d="M12 1.7 15.2 8l7 .95-5.1 4.9 1.25 6.95L12 17.5l-6.35 3.3 1.25-6.95-5.1-4.9 7-.95L12 1.7Z" /></svg>
          {allowHalf && <button className="rating-star-hit rating-star-hit-left" type="button" aria-label={t("book.setRating", { value: halfValue.toLocaleString(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU") })} onMouseEnter={() => setHoverValue(halfValue)} onMouseMove={() => setHoverValue(halfValue)} onFocus={() => setHoverValue(halfValue)} onBlur={() => setHoverValue(null)} onClick={() => onChange(halfValue)} />}
          <button className={`rating-star-hit ${allowHalf ? "rating-star-hit-right" : "rating-star-hit-full"}`} type="button" aria-label={t("book.setRating", { value: star })} onMouseEnter={() => setHoverValue(star)} onMouseMove={() => setHoverValue(star)} onFocus={() => setHoverValue(star)} onBlur={() => setHoverValue(null)} onClick={() => onChange(star)} />
        </span>;
      })}
      {value > 0 && <output aria-live="polite">{value.toLocaleString(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU", { minimumFractionDigits: value % 1 ? 1 : 0 })}</output>}
    </div>
  );
}

function sourceLink(product: MarketplaceProductPreview, id = Date.now()): BookLink {
  const label = product.marketplace === "Яндекс.Книги" ? "Яндекс.Книги" : product.marketplace === "Marwin/Меломан" ? "Marwin/Меломан" : "Flip";
  return { id, label, url: product.productUrl, action: product.suggestedAction };
}

function upsertSourceLink(links: BookLink[] | undefined, product: MarketplaceProductPreview) {
  const next = [...(links ?? [])];
  const host = new URL(product.productUrl).hostname.replace(/^www\./, "");
  const existingIndex = next.findIndex((link) => {
    try { return new URL(link.url).hostname.replace(/^www\./, "") === host; } catch { return false; }
  });
  const emptyIndex = next.findIndex((link) => !link.label.trim() && !link.url.trim());
  const item = sourceLink(product, existingIndex >= 0 ? next[existingIndex].id : emptyIndex >= 0 ? next[emptyIndex].id : Date.now());
  if (existingIndex >= 0) next[existingIndex] = item;
  else if (emptyIndex >= 0) next[emptyIndex] = item;
  else if (next.length < 3) next.push(item);
  else next[0] = item;
  return next;
}

function libraryLinkError(link: BookLink) {
  if (!link.url.trim()) return "";
  if (!link.label.trim()) return translate(currentLocale(), "book.linkNameRequired");
  try {
    const host = new URL(link.url).hostname.toLowerCase().replace(/^www\./, "");
    if ((link.action ?? "Купить") === "Купить" && !["flip.kz", "meloman.kz", "marwin.kz"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return translate(currentLocale(), "book.purchaseSitesOnly");
    if ((link.action === "Читать" || link.action === "Слушать") && !(host === "books.yandex.kz" || host.endsWith(".books.yandex.kz"))) return translate(currentLocale(), "book.readSitesOnly");
    return "";
  } catch {
    return translate(currentLocale(), "book.validLink");
  }
}

function BookLinksEditor({ links, onChange, restricted = false, lockedUrls = [] }: { links: BookLink[]; onChange: (links: BookLink[]) => void; restricted?: boolean; lockedUrls?: string[] }) {
  const { t } = useI18n();
  function updateLink(id: number, patch: Partial<BookLink>) { onChange(links.map((link) => link.id === id ? { ...link, ...patch } : link)); }
  function linkMatchesAction(urlValue: string, action: BookLink["action"]) {
    if (!urlValue.trim()) return true;
    try {
      const host = new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");
      if (action === "Купить") return ["flip.kz", "meloman.kz", "marwin.kz"].some((domain) => host === domain || host.endsWith(`.${domain}`));
      return host === "books.yandex.kz" || host.endsWith(".books.yandex.kz");
    } catch {
      return false;
    }
  }
  function purchaseStoreFromUrl(urlValue: string) {
    try {
      const host = new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");
      if (host === "flip.kz" || host.endsWith(".flip.kz")) return "Flip";
      if (["meloman.kz", "marwin.kz"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return "Marwin/Меломан";
    } catch {
      // The validation message below the URL field explains malformed links.
    }
    return "";
  }
  function updateRestrictedAction(link: BookLink, action: NonNullable<BookLink["action"]>) {
    const label = action === "Купить" && ["Flip", "Marwin/Меломан"].includes(link.label) ? link.label : action === "Купить" ? "Flip" : "Яндекс.Книги";
    updateLink(link.id, { action, label, url: linkMatchesAction(link.url, action) ? link.url : "" });
  }
  return <div className="writer-links-editor"><span className="field-label">{t("book.whereAccess")}</span>{restricted && <small className="book-link-hint">{t("book.linkHint")}</small>}{links.map((link, index) => {
    const error = restricted ? libraryLinkError(link) : "";
    const locked = Boolean(link.url && lockedUrls.includes(link.url));
    const action: NonNullable<BookLink["action"]> = link.action ?? "Купить";
    return <div className={`writer-link-row ${error ? "has-error" : ""} ${locked ? "is-locked" : ""}`} key={link.id}><label>{t("book.action")}<CustomSelect disabled={locked} ariaLabel={t("book.action")} value={action} onChange={(nextAction) => restricted ? updateRestrictedAction(link, nextAction) : updateLink(link.id, { action: nextAction })} options={["Купить", "Читать", "Слушать"].map((item) => ({ value: item as NonNullable<BookLink["action"]>, label: t(item === "Читать" ? "content.read" : item === "Слушать" ? "content.listen" : "content.buy") }))} /></label><label>{t("book.storePortal")}{restricted && action === "Купить" ? <CustomSelect disabled={locked} ariaLabel={t("book.storePortal")} value={["Flip", "Marwin/Меломан"].includes(link.label) ? link.label : "Flip"} onChange={(label) => updateLink(link.id, { label })} options={["Flip", "Marwin/Меломан"].map((item) => ({ value: item, label: item }))} /> : <input readOnly={locked || restricted} value={restricted ? "Яндекс.Книги" : link.label} onChange={(event) => updateLink(link.id, { label: event.target.value })} placeholder={restricted ? undefined : ((link.action ?? "Купить") === "Купить" ? t("book.storeExample") : t("book.portalExample"))} />}</label><label>{t("book.link")}<input readOnly={locked} type="url" value={link.url} onChange={(event) => { const url = event.target.value; const detectedStore = restricted && action === "Купить" ? purchaseStoreFromUrl(url) : ""; updateLink(link.id, { url, ...(restricted ? { label: action === "Купить" ? (detectedStore || (["Flip", "Marwin/Меломан"].includes(link.label) ? link.label : "Flip")) : "Яндекс.Книги" } : {}) }); }} placeholder={restricted ? undefined : "https://"} />{error && <small className="form-error">{error}</small>}</label>{index > 0 && !locked && <button type="button" aria-label={t("book.deleteLink")} onClick={() => onChange(links.filter((item) => item.id !== link.id))}>×</button>}</div>;
  })}{links.length < 3 && <button className="add-link-button" type="button" onClick={() => onChange([...links, { id: Date.now(), label: restricted ? "Flip" : "", url: "", action: "Купить" }])}>＋ {t("book.addLink")}</button>}</div>;
}

export function BookAutofillField({ value, onChange, onProduct, hidePlaceholder = false }: { value: string; onChange: (value: string) => void; onProduct: (product: MarketplaceProductPreview) => void; hidePlaceholder?: boolean }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    if (!value.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/books/preview", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ productUrl: value }), signal: controller.signal });
        const data = await response.json() as { product?: MarketplaceProductPreview; error?: string };
        if (!response.ok || !data.product) throw new Error(localizedApiError(data.error, t("book.autofillError")));
        onProduct(data.product);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("book.autofillError"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 550);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value]);
  return <div className="flip-autofill-block"><p>{t("book.autofillHint")}</p><label>{t("book.bookLink")}<input type="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder={hidePlaceholder ? undefined : "https://www.flip.kz/… · https://www.meloman.kz/… · https://books.yandex.kz/…"} /></label>{loading && <small>{t("book.autofillLoading")}</small>}{error && <small className="form-error">{error}</small>}</div>;
}

export function WishBookEditor({ ownerId, onClose, onSaved }: { ownerId: number; onClose: () => void; onSaved: (item: WishBook) => void }) {
  const { locale, t } = useI18n();
  const [form, setForm] = useState({ productUrl: "", pickupAddress: "", recipientName: "", phone: "+7" });
  const [preview, setPreview] = useState<FlipProductPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setPreview(null); setError("");
    if (!form.productUrl.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const response = await fetch("/api/wishlist/preview", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ productUrl: form.productUrl }), signal: controller.signal });
        const data = await response.json() as { product?: FlipProductPreview; error?: string };
        if (!response.ok || !data.product) throw new Error(localizedApiError(data.error, t("wishlist.previewError")));
        setPreview(data.product);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("wishlist.previewError")); }
      finally { if (!controller.signal.aborted) setPreviewLoading(false); }
    }, 550);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.productUrl]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (!preview) throw new Error(t("wishlist.waitPreview"));
      const response = await fetch("/api/wishlist", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json() as { item?: WishBook; error?: string };
      if (!response.ok || !data.item) throw new Error(localizedApiError(data.error, t("wishlist.addError")));
      onSaved({ ...data.item, ownerId });
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("wishlist.addError")); }
    finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="book-editor wishlist-editor" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" type="button" aria-label={t("common.close")} onClick={onClose}>×</button>
    <div className="book-editor-heading"><span className="section-subtitle">{t("wishlist.title")}</span><h2>{t("wishlist.addTitle")}</h2><p>{t("wishlist.addHint")}</p></div>
    <form className="wishlist-gift-form" onSubmit={submit}><div className="wishlist-private-fields"><span className="field-label">{t("wishlist.giftData")}</span><p>{t("wishlist.privateHint")}</p>
      <label>{t("wishlist.flipLink")} *<input type="url" required value={form.productUrl} onChange={(event) => setForm({ ...form, productUrl: event.target.value })} placeholder="https://www.flip.kz/catalog?prod=…" /></label>
      {previewLoading && <div className="flip-preview-loading">{t("wishlist.previewLoading")}</div>}
      {preview && <article className="flip-product-preview"><div data-i18n-skip className="flip-preview-cover" style={preview.coverUrl ? { backgroundImage: `url(${preview.coverUrl})` } : undefined}>{!preview.coverUrl && preview.title.slice(0, 1)}</div><div><span>{t("wishlist.foundFlip")}</span><h3 data-i18n-skip>{preview.title}</h3><strong data-i18n-skip>{preview.author}</strong><p data-i18n-skip={Boolean(preview.annotation)}>{preview.annotation || t("wishlist.noAnnotation")}</p><b>{preview.price ? `${preview.price.toLocaleString(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU")} ${preview.currency === "KZT" ? "₸" : preview.currency}` : t("wishlist.priceUnavailable")}</b></div></article>}
      <label>{t("wishlist.pickupAddress")} *<textarea required rows={2} value={form.pickupAddress} onChange={(event) => setForm({ ...form, pickupAddress: event.target.value })} placeholder={t("wishlist.pickupPlaceholder")} /></label>
      <label>{t("wishlist.recipientName")} *<input required value={form.recipientName} onChange={(event) => setForm({ ...form, recipientName: event.target.value })} placeholder={t("wishlist.recipientPlaceholder")} /></label>
      <label>{t("wishlist.recipientPhone")} *<input type="tel" inputMode="tel" autoComplete="tel" required value={form.phone} onFocus={() => !form.phone && setForm({ ...form, phone: "+7" })} onChange={(event) => setForm({ ...form, phone: formatKazakhstanPhone(event.target.value) })} placeholder="+7 (___) ___-__-__" /></label>
    </div>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={saving || previewLoading || !preview}>{saving ? t("wishlist.adding") : t("common.add")}</button></div></form>
  </section></div>;
}

export function WishBookModal({ item, owner, viewer, users, onClose, onChanged, onDeleted }: { item: WishBook; owner: DemoUser; viewer: DemoUser; users: DemoUser[]; onClose: () => void; onChanged: (item: WishBook) => void; onDeleted?: (id: number) => void }) {
  const { locale, t } = useI18n();
  const [current, setCurrent] = useState(item);
  const [working, setWorking] = useState(false);
  const isOwner = owner.id === viewer.id;
  const reserver = users.find((user) => user.id === current.reservedByUserId);
  useEffect(() => {
    if (!current.privateVisible) return;
    let active = true;
    fetch(`/api/wishlist/${current.id}/price`, { credentials: "same-origin" }).then((response) => response.json()).then((data: { price?: number; currency?: string; checkedAt?: string }) => { if (active) { const next = { ...current, price: data.price, priceCurrency: data.currency, priceCheckedAt: data.checkedAt }; setCurrent(next); onChanged(next); } }).catch(() => undefined);
    return () => { active = false; };
  }, [current.id]);
  async function reserve() {
    setWorking(true); const nextWindow = window.open("", "_blank");
    try { const response = await fetch(`/api/wishlist/${current.id}/reserve`, { method: "POST", credentials: "same-origin" }); const data = await response.json() as { checkoutUrl?: string; reservedByUserId?: number; error?: string }; if (!response.ok || !data.checkoutUrl) throw new Error(localizedApiError(data.error, t("wishlist.reserveError"))); const next = { ...current, reservedByUserId: data.reservedByUserId, reservedAt: new Date().toISOString() }; setCurrent(next); onChanged(next); if (nextWindow) { nextWindow.opener = null; nextWindow.location.href = data.checkoutUrl; } } catch (error) { nextWindow?.close(); window.alert(error instanceof Error ? error.message : t("wishlist.reserveError")); } finally { setWorking(false); }
  }
  async function unlock() { const response = await fetch(`/api/wishlist/${current.id}/reservation`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) return; const next = { ...current, reservedByUserId: undefined, reservedAt: undefined }; setCurrent(next); onChanged(next); }
  async function remove() { if (!window.confirm(t("wishlist.deleteConfirm"))) return; const response = await fetch(`/api/wishlist/${current.id}`, { method: "DELETE", credentials: "same-origin" }); if (response.ok) { onDeleted?.(current.id); onClose(); } }
  return <div className="nested-modal-backdrop" onMouseDown={onClose}><section className="wishlist-book-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t("common.close")} type="button" onClick={onClose}>×</button><div data-i18n-skip className={`library-book-cover library-cover-${current.coverTone}`} style={current.coverUrl ? { backgroundImage: `url(${current.coverUrl})` } : undefined}>{!current.coverUrl && <><em>{current.author}</em><strong>{current.title}</strong><span>Book Meet</span></>}</div><div><span className="section-subtitle">{t("wishlist.title")} · <span data-i18n-skip>{current.marketplace}</span></span><h2 data-i18n-skip>{current.title}</h2><p className="library-author" data-i18n-skip>{current.author}</p><p data-i18n-skip={Boolean(current.annotation)}>{current.annotation || t("book.noAnnotation")}</p>{current.privateVisible && <div className="wishlist-delivery"><div><span>{t("wishlist.currentPrice")}</span><strong>{current.price ? `${current.price.toLocaleString(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU")} ${current.priceCurrency === "KZT" ? "₸" : current.priceCurrency}` : t("wishlist.priceUnavailable")}</strong></div><div><span>{t("wishlist.recipient")}</span><strong data-i18n-skip>{current.recipientName}</strong></div><div><span>{t("wishlist.pickup")}</span><strong data-i18n-skip>{current.pickupAddress}</strong></div><div><span>{t("wishlist.recipientPhone")}</span><strong data-i18n-skip>{current.phone}</strong></div></div>}{current.reservedByUserId && <p className="wishlist-reserved-note">{t("wishlist.reservedBy")}: <strong data-i18n-skip={Boolean(reserver)}>{reserver?.profile.name ?? t("wishlist.friend")}</strong></p>}<div className="form-actions">{isOwner ? <><button className="quiet-danger-button" type="button" onClick={remove}>{t("wishlist.deleteCard")}</button>{current.reservedByUserId && <button className="outline-button" type="button" onClick={unlock}>{t("wishlist.unlock")}</button>}</> : current.reservedByUserId && current.reservedByUserId !== viewer.id ? <button className="outline-button" type="button" disabled>{t("wishlist.reserved")}</button> : <button className="primary-button" type="button" disabled={working} onClick={reserve}>{current.reservedByUserId === viewer.id ? t("wishlist.goPurchase") : t("wishlist.gift")}</button>}</div></div></section></div>;
}

export function WishlistTab({ books, setBooks, owner, viewer, users, readOnly = false }: { books: WishBook[]; setBooks: React.Dispatch<React.SetStateAction<WishBook[]>>; owner: DemoUser; viewer: DemoUser; users: DemoUser[]; readOnly?: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false); const [opened, setOpened] = useState<WishBook | null>(null);
  function update(item: WishBook) { setBooks((current) => current.map((entry) => entry.id === item.id ? item : entry)); setOpened(item); }
  return <div className="library-tab wishlist-tab"><div className="profile-title-row library-title-row"><div><h1>{t("wishlist.title")}</h1><p>{t("wishlist.friendsOnly")}</p></div>{!readOnly && <button className="primary-button" type="button" onClick={() => setEditing(true)}>＋ {t("content.addBook")}</button>}</div><div className="library-grid">{books.map((book) => { const blocked = Boolean(book.reservedByUserId && book.reservedByUserId !== viewer.id && owner.id !== viewer.id); return <article className={`library-book wishlist-card material-clickable-card ${blocked ? "reserved" : ""}`} role="button" tabIndex={blocked ? -1 : 0} aria-disabled={blocked} key={book.id} onClick={() => { if (!blocked) setOpened(book); }} onKeyDown={(event) => { if (!blocked && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setOpened(book); } }}><div data-i18n-skip className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div className="library-book-copy"><span className="book-format" data-i18n-skip={!blocked}>{blocked ? t("wishlist.reserved") : book.marketplace}</span><h3 data-i18n-skip>{book.title}</h3><p data-i18n-skip>{book.author}</p></div></article>; })}</div>{!books.length && <div className="profile-tab-placeholder">{t("wishlist.empty")}</div>}{editing && <WishBookEditor ownerId={owner.id} onClose={() => setEditing(false)} onSaved={(item) => { setBooks((current) => [item, ...current]); setEditing(false); }} />}{opened && <WishBookModal item={opened} owner={owner} viewer={viewer} users={users} onClose={() => setOpened(null)} onChanged={update} onDeleted={(id) => setBooks((current) => current.filter((item) => item.id !== id))} />}</div>;
}

export const genreSuggestions = [
  "Современная проза", "Классическая проза", "Русская классика", "Зарубежная классика", "Казахская литература",
  "Азиатская литература", "Латиноамериканская литература", "Роман", "Современный роман", "Любовный роман",
  "Исторический роман", "Психологический роман", "Философский роман", "Семейная сага", "Магический реализм",
  "Психологическая проза", "Философская проза", "Экспериментальная проза", "Малая проза", "Рассказы",
  "Повесть", "Новелла", "Эссе", "Дневники", "Письма", "Поэзия", "Драматургия", "Пьесы",
  "Фэнтези", "Городское фэнтези", "Тёмное фэнтези", "Эпическое фэнтези", "Романтическое фэнтези",
  "Фантастика", "Научная фантастика", "Социальная фантастика", "Космическая фантастика", "Киберпанк",
  "Стимпанк", "Антиутопия", "Утопия", "Альтернативная история", "Постапокалипсис",
  "Детектив", "Классический детектив", "Исторический детектив", "Полицейский детектив", "Иронический детектив",
  "Психологический триллер", "Триллер", "Мистика", "Хоррор", "Готический роман", "Боевик", "Приключения",
  "Военная проза", "Шпионский роман", "Судебная драма", "Медицинская драма", "Сатира", "Юмор",
  "Биография", "Автобиография", "Мемуары", "Документальная проза", "Репортаж", "Нон-фикшн",
  "История", "Всемирная история", "История Казахстана", "Краеведение", "Политика", "Общество", "Социология",
  "Психология", "Популярная психология", "Саморазвитие", "Мотивационная литература", "Философия", "Религия",
  "Культурология", "Искусство", "Музыка", "Кино", "Архитектура", "Дизайн", "Фотография",
  "Научпоп", "Математика", "Физика", "Астрономия", "Биология", "Медицина", "Экология", "Технологии",
  "Программирование", "Искусственный интеллект", "Экономика", "Финансы", "Бизнес", "Маркетинг", "Менеджмент",
  "Право", "Педагогика", "Лингвистика", "Литературоведение", "Путешествия", "География", "Кулинария",
  "Спорт", "Здоровье", "Хобби и творчество", "Дом и сад", "Комиксы", "Графический роман", "Манга",
  "Детская литература", "Сказки", "Книги для подростков", "Young Adult", "Образовательная литература",
];
export const coverTones = ["wine", "sky", "sand", "forest", "charcoal", "plum", "blue", "terracotta"];

export function GenrePicker({ value, onChange, label }: { value: string[]; onChange: (genres: string[]) => void; label: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const matches = genreSuggestions.filter((genre) => !value.includes(genre) && genre.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6);

  function addGenre(genre: string) {
    const clean = genre.trim();
    if (!genreSuggestions.includes(clean) || value.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
    onChange([...value, clean]);
    setQuery("");
  }

  return (
    <div className="genre-field">
      <span className="field-label">{label}</span>
      <div className="genre-input-shell">
        {value.map((genre) => <span className="genre-chip" data-i18n-skip key={genre}>{genre}<button type="button" onClick={() => onChange(value.filter((item) => item !== genre))} aria-label={t("genre.remove", { genre })}>×</button></span>)}
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder={value.length ? t("genre.findMore") : t("genre.startTyping")} />
      </div>
      {query.trim() && matches.length > 0 && <div className="genre-suggestions">{matches.map((genre) => <button type="button" key={genre} onClick={() => addGenre(genre)}>{genre}</button>)}</div>}
    </div>
  );
}

export const readingMonths = ["month.january", "month.february", "month.march", "month.april", "month.may", "month.june", "month.july", "month.august", "month.september", "month.october", "month.november", "month.december"] as const;
export const readingMonthsPrepositional = ["month.inJanuary", "month.inFebruary", "month.inMarch", "month.inApril", "month.inMay", "month.inJune", "month.inJuly", "month.inAugust", "month.inSeptember", "month.inOctober", "month.inNovember", "month.inDecember"] as const;
export function booksWord(count: number) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return translate(currentLocale(), "book.wordMany");
  if (count % 10 === 1) return translate(currentLocale(), "book.wordOne");
  if (count % 10 >= 2 && count % 10 <= 4) return translate(currentLocale(), "book.wordFew");
  return translate(currentLocale(), "book.wordMany");
}

export function BookEditor({ book, catalog, top3Count = 0, onClose, onSave }: { book: LibraryBook | null; catalog: (LibraryBook | AuthorBook)[]; top3Count?: number; onClose: () => void; onSave: (book: LibraryBook) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<LibraryBook>(() => book ? { ...book, links: book.links?.length ? book.links : [{ id: Date.now(), label: "Flip", url: "", action: "Купить" }] } : { id: Date.now(), author: "", title: "", genres: [], annotation: "", pages: "", durationHours: "", durationMinutes: "", format: "Бумажная", rating: 0, review: "", readingStatus: "read", coverTone: coverTones[Math.floor(Math.random() * coverTones.length)], links: [{ id: Date.now(), label: "Flip", url: "", action: "Купить" }] });
  const [autofillUrl, setAutofillUrl] = useState(book?.flipUrl ?? "");
  const [sourceFieldsLocked, setSourceFieldsLocked] = useState(Boolean(book?.flipUrl));
  const [selectedCatalogId, setSelectedCatalogId] = useState<number | undefined>(() => book && catalog.some((item) => item.id === book.id) ? book.id : undefined);
  const [ratingError, setRatingError] = useState(false);
  const [linksError, setLinksError] = useState(false);
  const selectedCatalogBook = catalog.find((item) => item.id === selectedCatalogId);
  const coverLocked = Boolean(selectedCatalogBook?.coverUrl);
  const fieldLocked = (canonicalValue: unknown, currentValue: unknown) => selectedCatalogBook ? Boolean(canonicalValue) : sourceFieldsLocked && Boolean(currentValue);
  const lockedLinkUrls = (selectedCatalogBook?.links ?? []).map((link) => link.url);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  useEffect(() => {
    if (form.readingStatus !== "read" && form.topRank) setForm((current) => ({ ...current, topRank: undefined }));
  }, [form.readingStatus, form.topRank]);

  function uploadCover(event: React.ChangeEvent<HTMLInputElement>) {
    if (coverLocked) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, coverUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if ((form.links ?? []).some((link) => Boolean(libraryLinkError(link)))) {
      setLinksError(true);
      return;
    }
    if ((form.readingStatus ?? "read") === "read" && form.rating === 0) {
      setRatingError(true);
      return;
    }
    if (form.topRank && !book?.topRank && top3Count >= 3) {
      window.alert(t("library.top3Full"));
      return;
    }
    onSave({ ...form, links: (form.links ?? []).filter((link) => link.label.trim() && link.url.trim()) });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="book-editor" role="dialog" aria-modal="true" aria-labelledby="book-editor-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
        <div className="book-editor-heading"><span className="section-subtitle">{t("profile.library")}</span><h2 id="book-editor-title">{book ? t("book.edit") : t("content.addBook")}</h2><p>{t("form.requiredHint")}</p></div>
        <form className="book-form" onSubmit={submit}>
          <div className="cover-upload-column">
            <div className={`editable-book-cover library-cover-${form.coverTone}`} style={form.coverUrl ? { backgroundImage: `url(${form.coverUrl})` } : undefined}>
              {!form.coverUrl && <><em data-i18n-skip={Boolean(form.author)}>{form.author || t("book.authorPlaceholder")}</em><strong data-i18n-skip={Boolean(form.title)}>{form.title || t("book.titlePlaceholder")}</strong><span>Book Meet</span></>}
            </div>
            <label className={`cover-upload-button ${coverLocked ? "is-disabled" : ""}`}>{coverLocked ? t("book.coverSaved") : t("book.uploadCover")}<input type="file" accept="image/*" disabled={coverLocked} onChange={uploadCover} /></label>
          </div>
          <div className="book-fields">
            <div className="book-reading-status library-editor-status" role="group" aria-label={t("library.bookStatus")}><button className={(form.readingStatus ?? "read") === "want" ? "active" : ""} type="button" onClick={() => { setForm((current) => ({ ...current, readingStatus: "want", rating: 0, review: "", readMonth: undefined, readYear: undefined, lastReadChapter: undefined, readingComment: "" })); setRatingError(false); }}>{t("content.want")}</button><button className={form.readingStatus === "reading" ? "active" : ""} type="button" onClick={() => { setForm((current) => ({ ...current, readingStatus: "reading", rating: 0, review: "", readMonth: undefined, readYear: undefined })); setRatingError(false); }}>{t("content.reading")}</button><button className={(form.readingStatus ?? "read") === "read" ? "active" : ""} type="button" onClick={() => setForm((current) => ({ ...current, readingStatus: "read", lastReadChapter: undefined, readingComment: "" }))}>{t("content.readDone")}</button></div>
            <BookAutofillField hidePlaceholder value={autofillUrl} onChange={(value) => { setAutofillUrl(value); if (!value.trim()) setSourceFieldsLocked(false); }} onProduct={(product) => {
              const match = catalog.find((item) => item.id === product.catalogBookId)
                ?? catalog.find((item) => product.isbn && item.isbn?.replace(/\D/g, "") === product.isbn.replace(/\D/g, ""))
                ?? catalog.find((item) => normalizeBookKey(item.title) === normalizeBookKey(product.title) && normalizeBookKey(item.author) === normalizeBookKey(product.author));
              if (match) setSelectedCatalogId(match.id);
              setSourceFieldsLocked(true);
              setForm((current) => ({ ...current, id: match?.id ?? product.catalogBookId ?? current.id, catalogBookId: match?.id ?? product.catalogBookId, author: match?.author || product.author, title: match?.title || product.title, isbn: match?.isbn || product.isbn, publisher: match?.publisher || product.publisher, annotation: match?.annotation || product.annotation, coverUrl: match?.coverUrl || product.coverUrl || current.coverUrl, coverTone: match?.coverTone ?? current.coverTone, genres: match?.genres ?? current.genres, flipUrl: product.marketplace === "Flip" ? product.productUrl : (match?.flipUrl ?? current.flipUrl), links: upsertSourceLink(match?.links ?? current.links, product) }));
            }} />
            <p className="book-manual-divider">{t("book.manualFill")}</p>
            <div className="book-identity-block">
              <div className="form-row">
                <label>{t("content.author")} *<input required readOnly={fieldLocked(selectedCatalogBook?.author, form.author)} value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} /></label>
                <label>{t("content.title")} *<input required readOnly={fieldLocked(selectedCatalogBook?.title, form.title)} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              </div>
              <div className="form-row">
                <label>ISBN<input inputMode="numeric" pattern="[0-9]{10}|[0-9]{13}" maxLength={13} readOnly={fieldLocked(selectedCatalogBook?.isbn, form.isbn)} value={form.isbn ?? ""} onChange={(event) => setForm({ ...form, isbn: event.target.value.replace(/\D/g, "").slice(0, 13) })} /></label>
                <label>{t("content.publisher")}<input readOnly={fieldLocked(selectedCatalogBook?.publisher, form.publisher)} value={form.publisher ?? ""} onChange={(event) => setForm({ ...form, publisher: event.target.value })} /></label>
              </div>
              <BookMatchSuggestions books={catalog} queryAuthor={form.author} queryTitle={form.title} queryIsbn={form.isbn} onSelect={(match) => { setSelectedCatalogId(match.id); setAutofillUrl(match.flipUrl ?? ""); setForm((current) => ({ ...current, id: match.id, catalogBookId: match.id, author: match.author, title: match.title, isbn: match.isbn, publisher: match.publisher, genres: [...match.genres], annotation: match.annotation, coverUrl: match.coverUrl, coverTone: match.coverTone, flipUrl: match.flipUrl, links: match.links?.length ? match.links.map((link) => ({ ...link, id: Date.now() + link.id })) : current.links })); }} />
              <GenrePicker label={t("content.genre")} value={form.genres} onChange={(genres) => setForm({ ...form, genres })} />
              <label>{t("content.annotation")}<textarea rows={3} readOnly={fieldLocked(selectedCatalogBook?.annotation, form.annotation)} value={form.annotation} onChange={(event) => setForm({ ...form, annotation: event.target.value })} /></label>
            </div>
            {form.readingStatus === "reading" && <div className="library-reading-progress"><label>{t("library.chaptersRead")}<input min={1} step={1} type="number" inputMode="numeric" value={form.lastReadChapter ?? ""} onChange={(event) => setForm({ ...form, lastReadChapter: event.target.value ? Math.max(1, Math.floor(Number(event.target.value))) : undefined })} /></label><label>{t("material.comment")}<textarea rows={4} placeholder={t("library.readingImpressions")} value={form.readingComment ?? ""} onChange={(event) => setForm({ ...form, readingComment: event.target.value })} /></label></div>}
            {(form.readingStatus ?? "read") === "read" && <div className="library-reading-details">
              <div className="book-rating-field top3-rating-row"><span>{t("content.rating")} *</span><RatingStars allowHalf value={form.rating} onChange={(rating) => { setForm({ ...form, rating }); setRatingError(false); }} /><label className="top3-checkbox"><input type="checkbox" checked={Boolean(form.topRank)} onChange={(event) => setForm({ ...form, topRank: event.target.checked ? form.topRank ?? 1 : undefined })} />{t("content.top3")}</label>{ratingError && <small>{t("library.ratingRequired")}</small>}</div>
              <label>{t("library.shortReview")} *<textarea required rows={4} value={form.review} onChange={(event) => setForm({ ...form, review: event.target.value })} /></label>
              <fieldset className="reading-date-field">
                <legend>{t("library.readDate")}</legend>
                <label>{t("library.month")}<CustomSelect ariaLabel={t("library.readMonth")} value={form.readMonth ?? 0} onChange={(readMonth) => setForm({ ...form, readMonth: readMonth || undefined })} options={[{ value: 0, label: t("domain.unspecified") }, ...readingMonths.map((month, index) => ({ value: index + 1, label: t(month) }))]} /></label>
                <label>{t("library.year")}<CustomSelect ariaLabel={t("library.readYear")} value={form.readYear ?? 0} onChange={(readYear) => setForm({ ...form, readYear: readYear || undefined })} options={[{ value: 0, label: t("domain.unspecified") }, ...Array.from({ length: 80 }, (_, index) => new Date().getFullYear() - index).map((year) => ({ value: year, label: String(year) }))]} /></label>
              </fieldset>
            </div>}
            <div className="library-links-section">
              <BookLinksEditor links={form.links ?? []} lockedUrls={lockedLinkUrls} restricted onChange={(links) => { setForm((current) => ({ ...current, links })); setLinksError(false); }} />
              {linksError && <p className="form-error">{t("library.linksError")}</p>}
            </div>
            <label className="adult-material-checkbox"><input type="checkbox" checked={Boolean(form.isAdult)} onChange={(event) => setForm({ ...form, isAdult: event.target.checked })} />{t("book.adult")}</label>
            <div className="form-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button creation-action-button" type="submit">{t("book.save")}</button></div>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ReadingStatsModal({ books, users, onClose }: { books: LibraryBook[]; users: DemoUser[]; onClose: () => void }) {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();
  const availableYears = Array.from(new Set([currentYear, ...books.map((book) => book.readYear).filter((year): year is number => Boolean(year))])).sort((a, b) => b - a);
  const [year, setYear] = useState(currentYear);
  const [openedBook, setOpenedBook] = useState<LibraryBook | null>(null);
  const counts = readingMonths.map((_, index) => books.filter((book) => book.readYear === year && book.readMonth === index + 1).length);
  const maxCount = Math.max(1, ...counts);
  const chartLeft = 54;
  const chartTop = 20;
  const chartHeight = 220;
  const chartWidth = 660;
  const slot = chartWidth / 12;
  const tickCount = Math.min(5, maxCount + 1);
  const ticks = Array.from({ length: tickCount }, (_, index) => Math.round(index * maxCount / Math.max(1, tickCount - 1))).filter((value, index, list) => list.indexOf(value) === index);
  const monthlyGroups = readingMonths.map((month, index) => ({ month, books: books.filter((book) => (book.readingStatus ?? "read") === "read" && book.readYear === year && book.readMonth === index + 1) })).filter((group) => group.books.length);

  return <div className="nested-modal-backdrop" onMouseDown={onClose}><section className="reading-stats-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
    <div className="reading-stats-heading"><div><span className="section-subtitle">{t("profile.library")}</span><h2>{t("library.readingStats")}</h2><p>{t("library.readByMonth")}</p></div><label>{t("library.year")}<CustomSelect ariaLabel={t("library.statsYear")} value={year} onChange={setYear} options={availableYears.map((item) => ({ value: item, label: String(item) }))} /></label></div>
    <div className="reading-chart-shell">
      <svg className="reading-stats-chart" viewBox="0 0 750 290" role="img" aria-label={t("library.readInYear", { year })}>
        {ticks.map((tick) => { const y = chartTop + chartHeight - (tick / maxCount) * chartHeight; return <g key={tick}><line x1={chartLeft} x2={chartLeft + chartWidth} y1={y} y2={y} className="chart-grid-line" /><text x={chartLeft - 14} y={y + 4} textAnchor="end" className="chart-y-label">{tick}</text></g>; })}
        {counts.map((count, index) => {
          const height = count ? Math.max(8, (count / maxCount) * chartHeight) : 3;
          const x = chartLeft + index * slot + 8;
          const y = chartTop + chartHeight - height;
          return <g key={readingMonths[index]}><rect className={`chart-bar ${count ? "has-value" : ""}`} x={x} y={y} width={slot - 16} height={height} rx="7"><title>{t(readingMonths[index])}: {count} {booksWord(count)}</title></rect>{count > 0 && <text x={x + (slot - 16) / 2} y={y - 8} textAnchor="middle" className="chart-value">{count}</text>}<text x={x + (slot - 16) / 2} y={chartTop + chartHeight + 24} textAnchor="middle" className="chart-month-label">{t(readingMonths[index]).slice(0, 3)}</text></g>;
        })}
      </svg>
      <div className="reading-stats-mobile-chart" role="img" aria-label={t("library.readInYear", { year })}>{counts.map((count, index) => ({ count, month: readingMonths[index] })).reverse().map(({ count, month }) => <div className="reading-stats-mobile-row" key={month}><span>{t(month).slice(0, 3)}</span><i><b style={{ width: `${count ? count / maxCount * 100 : 0}%` }}><em>{count}</em></b></i></div>)}</div>
    </div>
    {monthlyGroups.length > 0 && <div className="reading-month-groups">{monthlyGroups.map((group) => <section className="reading-month-group" key={group.month}><h3>{t(group.month)}</h3><div>{group.books.map((book) => <button type="button" data-i18n-skip className="reading-month-book" key={book.id} onClick={() => setOpenedBook(book)}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <strong>{book.title.slice(0, 1)}</strong>}</div><span><strong>{book.title}</strong><small>{book.author}</small></span></button>)}</div></section>)}</div>}
    {openedBook && <UnifiedBookModal book={openedBook} users={users} nested onClose={() => setOpenedBook(null)} />}
  </section></div>;
}

export function LibraryTab({ books, setBooks, userId, users, catalog = [], initialAdd = false }: { books: LibraryBook[]; setBooks: React.Dispatch<React.SetStateAction<LibraryBook[]>>; userId: number; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; initialAdd?: boolean }) {
  const { t } = useI18n();
  const canonicalCatalog = catalog.length ? catalog : catalogFromUsers(users);
  const [view, setView] = useState<LibraryView>("grid");
  const [statusFilter, setStatusFilter] = useState<"want" | "reading" | "read">("read");
  const [editingBook, setEditingBook] = useState<LibraryBook | null | undefined>(() => initialAdd ? null : undefined);
  const [viewingBook, setViewingBook] = useState<LibraryBook | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const monthReadCount = books.filter((book) => (book.readingStatus ?? "read") === "read" && book.readMonth === currentMonth && book.readYear === currentYear).length;
  const yearReadCount = books.filter((book) => (book.readingStatus ?? "read") === "read" && book.readYear === currentYear).length;
  const wantCount = books.filter((book) => book.readingStatus === "want").length;
  const readingCount = books.filter((book) => book.readingStatus === "reading").length;
  const visibleBooks = sortLibraryBooks(books.filter((book) => (book.readingStatus ?? "read") === statusFilter));

  async function importBooks(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const existing = new Set(canonicalCatalog.map((book) => normalizeBookKey(`${book.author}|${book.title}`)));
      const imported: LibraryBook[] = [];
      for (const row of rows.slice(0, 1000)) {
        const value = (keys: string[]) => String(keys.map((key) => row[key]).find(Boolean) ?? "").trim();
        const author = value(["Автор", "автор", "Author", "author"]);
        const title = value(["Название", "название", "Книга", "Title", "title"]);
        const key = normalizeBookKey(`${author}|${title}`);
        if (!author || !title || existing.has(key)) continue;
        const response = await fetch("/api/books", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, author, title, isbn: value(["ISBN", "isbn"]), publisher: value(["Издательство", "Publisher", "publisher"]), annotation: value(["Аннотация", "Описание", "Annotation", "annotation"]), coverUrl: value(["Обложка", "Cover", "coverUrl"]), genres: value(["Жанры", "Genres", "genres"]).split(/[,;]+/).map((item) => item.trim()).filter(Boolean), readingStatus: "read", rating: 0, shortReview: "", coverTone: "blue" }) });
        if (!response.ok) continue;
        const data = await response.json() as { book?: LibraryBook };
        if (data.book) imported.push(data.book);
        existing.add(key);
      }
      if (imported.length) setBooks((current) => [...imported, ...current]);
      window.alert(t("library.importComplete", { count: imported.length }));
    } catch (error) { console.warn(error); window.alert(t("library.importError")); }
    finally { setImporting(false); }
  }

  async function updateRating(id: number, rating: number) {
    const book = books.find((item) => item.id === id);
    if (!book) return;
    const response = await fetch("/api/books", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating, shortReview: book.review, readMonth: book.readMonth, readYear: book.readYear, readingStatus: book.readingStatus ?? "read", lastReadChapter: book.lastReadChapter, readingComment: book.readingComment, top3: Boolean(book.topRank), useExistingId: book.catalogBookId ?? book.id }) });
    if (!response.ok) { window.alert(t("library.ratingSaveError")); return; }
    setBooks((current) => current.map((item) => item.id === id ? { ...item, rating } : item));
  }

  async function saveBook(book: LibraryBook) {
    const existingBook = books.some((item) => item.id === book.id) || canonicalCatalog.some((item) => item.id === book.id);
    const canonicalId = book.catalogBookId ?? (existingBook ? book.id : undefined);
    const ownerFields = { rating: book.rating, shortReview: book.review, readMonth: book.readMonth, readYear: book.readYear, readingStatus: book.readingStatus ?? "read", lastReadChapter: book.lastReadChapter, readingComment: book.readingComment, top3: Boolean(book.topRank) };
    const payload = canonicalId ? { ...ownerFields, useExistingId: canonicalId } : { userId, author: book.author, title: book.title, isbn: book.isbn, publisher: book.publisher, genres: book.genres, annotation: book.annotation, isAdult: book.isAdult, coverUrl: book.coverUrl, coverTone: book.coverTone, flipUrl: book.flipUrl, links: book.links?.map(({ label, url, action }) => ({ label, url, action })), format: "Книга", ...ownerFields };
    try {
      let response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status === 409) {
        const conflict = await response.json() as { code?: string; error?: string; match?: { id: number; title: string; author: string } };
        if (conflict.code === "TOP3_LIMIT") { window.alert(t("library.top3Full")); return; }
        if (!conflict.match || !window.confirm(t("book.matchConfirm", { author: conflict.match.author, title: conflict.match.title }))) return;
        response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...ownerFields, useExistingId: conflict.match.id }) });
      }
      if (!response.ok) throw new Error(t("book.catalogSaveError"));
      const data = await response.json() as { bookId: number; topRank?: 1 | 2 | 3 };
      const savedBook = { ...book, id: data.bookId, catalogBookId: book.catalogBookId ?? data.bookId, topRank: data.topRank };
      setBooks((current) => current.some((item) => item.id === book.id) ? current.map((item) => item.id === book.id ? savedBook : item) : [savedBook, ...current]);
      setEditingBook(undefined);
    } catch (error) { console.warn(error); window.alert(t("book.saveConnectionError")); }
  }

  return (
    <div className="library-tab">
      <div className="profile-title-row library-title-row">
        <div><h1>{t("profile.library")}</h1><button className="library-reading-summary" type="button" onClick={() => setStatsOpen(true)}><span>{t("library.monthRead", { month: t(readingMonthsPrepositional[currentMonth - 1]), count: monthReadCount, books: booksWord(monthReadCount) })}</span><i aria-hidden="true" /><span>{t("library.yearRead", { year: currentYear, count: yearReadCount, books: booksWord(yearReadCount) })}</span></button><div className="library-status-summary"><span>{t("library.wantSummary", { count: wantCount, books: booksWord(wantCount) })}</span><i aria-hidden="true" /><span>{t("library.readingSummary", { count: readingCount, books: booksWord(readingCount) })}</span></div></div>
        <div className="library-import-actions"><button className="outline-button" type="button" disabled={importing} onClick={() => importInputRef.current?.click()}>{importing ? t("library.importing") : t("library.import")}</button><input ref={importInputRef} type="file" hidden accept=".csv,.xls,.xlsx" onChange={(event) => { void importBooks(event.target.files?.[0]); event.currentTarget.value = ""; }} /><button className="primary-button creation-action-button" type="button" onClick={() => setEditingBook(null)}>＋ {t("content.addBook")}</button></div>
      </div>
      <div className="library-toolbar">
        <div className="library-status-filter" role="group" aria-label={t("library.statusFilter")}><button className={statusFilter === "want" ? "active" : ""} type="button" onClick={() => setStatusFilter("want")}>{t("content.want")}</button><button className={statusFilter === "reading" ? "active" : ""} type="button" onClick={() => setStatusFilter("reading")}>{t("content.reading")}</button><button className={statusFilter === "read" ? "active" : ""} type="button" onClick={() => setStatusFilter("read")}>{t("content.readDone")}</button></div>
        <div className="view-switcher" aria-label={t("library.view")}>
          <button className={view === "grid" ? "active" : ""} type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>▦ {t("library.grid")}</button>
          <button className={view === "list" ? "active" : ""} type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>☷ {t("library.list")}</button>
        </div>
      </div>
      <div className={`library-grid ${view === "list" ? "list-view" : ""}`}>
        {visibleBooks.map((book) => (
          <article data-i18n-skip className={`library-book material-clickable-card ${book.topRank ? "top3-book" : ""}`} role="button" tabIndex={0} key={book.id} onClick={() => setViewingBook(book)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewingBook(book); } }}>
            {book.topRank && <span className="top3-crown" aria-label={t("library.top3Place", { rank: book.topRank })}>♛<b>{book.topRank}</b></span>}
            <div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>
              {!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}
            </div>
            <div className="library-book-copy">
              <h3>{book.title}</h3><p className="library-author">{book.author}</p>
              {(book.readingStatus ?? "read") === "read" && <RatingStars allowHalf value={book.rating} onChange={(rating) => updateRating(book.id, rating)} label={t("library.bookRating", { title: book.title })} />}
              <div className="list-only-book-details"><p>{book.annotation}</p><span>{book.genres.join(", ")}</span>{(book.readingStatus ?? "read") === "read" && book.review && <blockquote>«{book.review}»</blockquote>}</div>
            </div>
          </article>
        ))}
      </div>
      {editingBook !== undefined && <BookEditor book={editingBook} catalog={canonicalCatalog} top3Count={books.filter((item) => item.topRank).length} onClose={() => setEditingBook(undefined)} onSave={saveBook} />}
      {viewingBook && <UnifiedBookModal book={viewingBook} users={users} catalog={canonicalCatalog} onClose={() => setViewingBook(null)} onEdit={() => { setEditingBook(viewingBook); setViewingBook(null); }} onDelete={async () => { if (!window.confirm(t("library.deleteConfirm", { title: viewingBook.title }))) return; const response = await fetch(`/api/books/${viewingBook.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert(t("book.deleteError")); return; } setBooks((current) => current.filter((book) => book.id !== viewingBook.id)); setViewingBook(null); }} />}
      {statsOpen && <ReadingStatsModal books={books} users={users} onClose={() => setStatsOpen(false)} />}
    </div>
  );
}

export function ReviewEditor({ review, catalog, onClose, onSave }: { review?: UserReview | null; catalog: (LibraryBook | AuthorBook)[]; onClose: () => void; onSave: (review: UserReview) => void }) {
  const { t } = useI18n();
  const matchedInitialBook = review?.bookId ? catalog.find((book) => book.id === review.bookId) : catalog.find((book) => book.title === review?.bookTitle && book.author === review?.bookAuthor);
  const [form, setForm] = useState({ bookId: matchedInitialBook?.id, bookTitle: review?.bookTitle ?? "", bookAuthor: review?.bookAuthor ?? "", rating: review?.rating ?? 0, preview: review?.preview ?? "", fullText: review?.fullText ?? "", bodyHtml: review?.bodyHtml ?? (review?.fullText ? `<p>${review.fullText}</p>` : ""), isAdult: review?.isAdult ?? false });
  const [ratingError, setRatingError] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.rating) { setRatingError(true); return; }
    if (!form.bookId) { window.alert(t("review.chooseBookError")); return; }
    const fullText = form.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!fullText) { window.alert(t("review.fullTextError")); return; }
    onSave({ id: review?.id ?? Date.now(), ...form, fullText, bodyHtml: sanitizeRichHtml(form.bodyHtml, t("editor.inlineImage")), createdAt: review?.createdAt ?? t("date.today"), createdAtValue: review?.createdAtValue ?? new Date().toISOString() });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="review-editor blog-editor-modal" role="dialog" aria-modal="true" aria-labelledby="review-editor-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
        <span className="section-subtitle">{t("profile.reviews")}</span><h2 id="review-editor-title">{review ? t("review.edit") : t("review.add")}</h2>
        <form className="book-fields" onSubmit={submit}>
          <fieldset className="material-books-field required-book-field"><legend>{t("review.book")} *</legend><EventBookSelector catalog={catalog} selectedId={form.bookId} onSelect={(book) => setForm({ ...form, bookId: book.id, bookTitle: book.title, bookAuthor: book.author })} onClear={() => setForm({ ...form, bookId: undefined, bookTitle: "", bookAuthor: "" })} onCreateBook={() => undefined} /></fieldset>
          <div className="book-rating-field"><span>{t("content.rating")} *</span><RatingStars value={form.rating} onChange={(rating) => { setForm({ ...form, rating }); setRatingError(false); }} />{ratingError && <small>{t("library.ratingRequired")}</small>}</div>
          <label className="review-preview-field">{t("review.preview")} *<span className="review-preview-shell"><textarea required rows={4} maxLength={500} placeholder={t("review.previewPlaceholder")} value={form.preview} onChange={(event) => setForm({ ...form, preview: event.target.value })} /><small className={Array.from(form.preview).length >= 500 ? "limit-reached" : ""}>{Array.from(form.preview).length}/500</small></span></label>
          <div className="blog-composer"><span className="field-label blog-composer-title">{t("review.full")} *</span><div className="blog-text-block blog-rich-block"><span className="blog-block-title">{t("review.editorHint")}</span><RichTextEditor value={form.bodyHtml} onChange={(bodyHtml) => setForm({ ...form, bodyHtml })} catalog={catalog} /></div></div>
          <label className="adult-material-checkbox"><input type="checkbox" checked={form.isAdult} onChange={(event) => setForm({ ...form, isAdult: event.target.checked })} />{t("review.adult")}</label>
          <div className="form-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button creation-action-button" type="submit">{t("common.publish")}</button></div>
        </form>
      </section>
    </div>
  );
}

export function ReviewsTab({ reviews, setReviews, owner, users, catalog = [], likes, onToggleLike, onComment, onOpenUser, initialAdd = false, initialEditId }: { reviews: UserReview[]; setReviews: React.Dispatch<React.SetStateAction<UserReview[]>>; owner: DemoUser; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; likes: Record<string, number[]>; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void; initialAdd?: boolean; initialEditId?: number | null }) {
  const { t } = useI18n();
  const canonicalCatalog = catalog.length ? catalog : catalogFromUsers(users);
  const [selected, setSelected] = useState<UserReview | null>(null);
  const [editing, setEditing] = useState<UserReview | null | undefined>(() => initialEditId ? reviews.find((item) => item.id === initialEditId) : initialAdd ? null : undefined);

  return (
    <div className="reviews-tab">
      <div className="profile-title-row library-title-row"><div><h1>{t("profile.reviews")}</h1><p>{t("review.publishedCount", { count: reviews.length })}</p></div><button className="primary-button creation-action-button" type="button" onClick={() => setEditing(null)}>＋ {t("review.add")}</button></div>
      <div className="my-reviews-list">
        {reviews.map((review) => { const matchingBook = canonicalCatalog.find((book) => book.title.toLowerCase() === review.bookTitle.toLowerCase() && book.author.toLowerCase() === review.bookAuthor.toLowerCase()); return (
          <article data-i18n-skip className="my-review-row material-clickable-card" role="button" tabIndex={0} key={review.id} onClick={() => setSelected(review)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(review); } }}>
            <div className="my-review-mark" style={matchingBook?.coverUrl ? { backgroundImage: `url(${matchingBook.coverUrl})` } : undefined}>{!matchingBook?.coverUrl && review.bookTitle.slice(0, 1)}</div>
            <div><span>{review.createdAt} · ★ {review.rating}</span><h3>{review.bookTitle}</h3><p className="review-book-author">{review.bookAuthor}</p><p>{review.preview}</p></div>
          </article>
        ); })}
      </div>
      {selected && (() => { const item: ReadingItem = { id: selected.id, kind: "review", title: selected.bookTitle, author: `${owner.profile.name} · ★ ${selected.rating}`, text: selected.fullText, bodyHtml: selected.bodyHtml, linkedBookId: selected.bookId, ownerId: owner.id, createdAt: selected.createdAt, preview: selected.preview, bookAuthor: selected.bookAuthor }; return <ReadingModal item={item} currentUser={owner} users={users} catalog={canonicalCatalog} likedUserIds={likes[`review-${selected.id}`] ?? []} onToggleLike={() => onToggleLike(item)} onComment={(text) => onComment(item, text)} onOpenUser={onOpenUser} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null); }} onDelete={() => { if (window.confirm(t("review.deleteConfirm", { title: selected.bookTitle }))) { setReviews((current) => current.filter((review) => review.id !== selected.id)); setSelected(null); } }} />; })()}
      {editing !== undefined && <ReviewEditor review={editing} catalog={canonicalCatalog} onClose={() => setEditing(undefined)} onSave={(review) => { setReviews((current) => current.some((item) => item.id === review.id) ? current.map((item) => item.id === review.id ? review : item) : [review, ...current]); setEditing(undefined); }} />}
    </div>
  );
}

export function ProfileFriendsTab({ friends, outgoing, incoming, subscriptions, followers, communityMode = false, publisherMode = false, onOpenUser }: { friends: DemoUser[]; outgoing: DemoUser[]; incoming: DemoUser[]; subscriptions: DemoUser[]; followers: DemoUser[]; communityMode?: boolean; publisherMode?: boolean; onOpenUser: (userId: number) => void }) {
  const { t, domainLabel } = useI18n();
  const [mode, setMode] = useState<"friends" | "follows">("friends");
  const groups = publisherMode ? [
    { key: "subscriptions", title: t("profile.subscriptions"), users: subscriptions },
    { key: "followers", title: t("profile.followers"), users: followers },
  ] : mode === "friends"
    ? [
      { key: "friends", title: communityMode ? t("profile.communityMembers") : t("friends.current"), users: friends },
      ...(!communityMode ? [{ key: "outgoing", title: t("friends.outgoing"), users: outgoing }] : []),
      { key: "incoming", title: communityMode ? t("friends.membershipRequests") : t("friends.incoming"), users: incoming },
    ]
    : [
      { key: "subscriptions", title: t("profile.subscriptions"), users: subscriptions },
      { key: "followers", title: t("profile.followers"), users: followers },
    ];
  return <div className="profile-friends-tab"><div className="profile-title-row"><div><h1>{communityMode ? t("profile.communityMembers") : publisherMode ? t("profile.subscriptions") : t("profile.friends")}</h1><p>{communityMode ? t("friends.communityVisibility") : t("friends.privateLists")}</p></div></div>{!communityMode && !publisherMode && <div className="profile-social-switch" role="tablist"><button className={mode === "friends" ? "active" : ""} type="button" onClick={() => setMode("friends")}>{t("profile.friends")}</button><button className={mode === "follows" ? "active" : ""} type="button" onClick={() => setMode("follows")}>{t("profile.subscriptions")}</button></div>}<div className="profile-friend-groups">{groups.map((group) => <details key={group.key} open><summary><span>{group.title}</span><b>{group.users.length}</b></summary>{group.users.length > 0 && <div className="profile-friends-grid">{group.users.map((friend) => <button className="profile-friend-card" type="button" key={friend.id} onClick={() => onOpenUser(friend.id)}><span className={`avatar avatar-md avatar-${friend.color} ${friend.avatarUrl ? "has-photo" : ""}`} style={friend.avatarUrl ? { backgroundImage: `url(${friend.avatarUrl})` } : undefined}>{!friend.avatarUrl && friend.initials}</span><span className="profile-friend-copy" data-i18n-skip><strong>{friend.profile.name}</strong><small>{domainLabel(friend.profile.type)}{friend.profile.city ? ` · ${friend.profile.city}` : ""}</small></span></button>)}</div>}</details>)}</div></div>;
}

export function MyEventsTab({ createdEvents, participatingEvents, users, catalog = [], currentUserId, onOpenUser, onEdit, onDeleted }: { createdEvents: BookEvent[]; participatingEvents: BookEvent[]; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; currentUserId: number; onOpenUser: (userId: number) => void; onEdit: (item: BookEvent) => void; onDeleted: (id: number) => void }) {
  const { t } = useI18n();
  const canonicalCatalog = catalog.length ? catalog : catalogFromUsers(users);
  const [opened, setOpened] = useState<BookEvent | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const groups = [
    { key: "created", title: t("event.createdByMe"), events: [...createdEvents].sort((first, second) => (Date.parse(second.createdAt) || second.id) - (Date.parse(first.createdAt) || first.id)), own: true },
    { key: "participating", title: t("event.participating"), events: [...participatingEvents].sort((first, second) => eventTimestamp(first) - eventTimestamp(second)), own: false },
  ];
  const openedIsOwn = Boolean(opened && createdEvents.some((item) => item.id === opened.id));
  const openBook = (item: BookEvent) => setOpenedBook(canonicalCatalog.find((book) => book.id === item.linkedBookId) ?? null);
  async function remove(item: BookEvent) {
    if (!window.confirm(t("event.deleteConfirm", { title: item.title }))) return;
    const response = await fetch(`/api/events/${item.id}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) { window.alert(t("event.deleteError")); return; }
    setOpened(null);
    onDeleted(item.id);
  }
  return <div className="my-events-tab"><div className="profile-title-row"><div><h1>{t("event.myEvents")}</h1><p>{t("event.privateCount", { count: createdEvents.length + participatingEvents.length })}</p></div></div><div className="my-event-groups">{groups.map((group) => <details key={group.key} open><summary><span>{group.title}</span><b>{group.events.length}</b></summary>{group.events.length > 0 && <div className="events-grid">{group.events.map((item) => <EventCard key={item.id} item={item} own={group.own} compact onOpen={() => setOpened(item)} onOpenBook={item.linkedBookId ? () => openBook(item) : undefined} onEdit={group.own ? () => onEdit(item) : undefined} />)}</div>}</details>)}</div>{opened && <EventModal item={opened} users={users} catalog={canonicalCatalog} currentUserId={currentUserId} onOpenUser={onOpenUser} onOpenBook={opened.linkedBookId ? () => openBook(opened) : undefined} onClose={() => setOpened(null)} onEdit={openedIsOwn ? () => { onEdit(opened); setOpened(null); } : undefined} onDelete={openedIsOwn ? () => void remove(opened) : undefined} />}{openedBook && <UnifiedBookModal book={openedBook} users={users} catalog={canonicalCatalog} onClose={() => setOpenedBook(null)} onOpenUser={onOpenUser} />}</div>;
}

export function LegacyAuthorBooksTab({ books, setBooks, userId }: { books: AuthorBook[]; setBooks: React.Dispatch<React.SetStateAction<AuthorBook[]>>; userId: number }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [warningUrl, setWarningUrl] = useState<string | null>(null);
  const [form, setForm] = useState({ author: "", title: "", genres: [] as string[], annotation: "", pages: "", format: "Бумажная" as BookFormat, label: "", url: "" });
  async function submit(event: FormEvent) { event.preventDefault(); const links = form.label && form.url ? [{ id: Date.now(), label: form.label, url: form.url }] : []; const newBook: AuthorBook = { id: Date.now(), author: form.author, title: form.title, genres: form.genres, annotation: form.annotation, pages: form.pages, durationHours: "", durationMinutes: "", format: form.format, coverTone: ["wine", "sky", "forest", "sand"][Math.floor(Math.random() * 4)], links }; const payload = { userId, ...newBook, isAuthor: true, links: links.map(({ label, url }) => ({ label, url })) }; try { let response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); if (response.status === 409) { const data = await response.json() as { match: { id: number; title: string; author: string } }; if (!window.confirm(t("book.matchConfirm", { author: data.match.author, title: data.match.title }))) return; response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, useExistingId: data.match.id }) }); } if (!response.ok) throw new Error(t("book.saveError")); } catch (error) { console.warn(error); } setBooks((current) => [newBook, ...current]); setAdding(false); }
  return <div className="library-tab"><div className="profile-title-row library-title-row"><div><h1>{t("authorBooks.mine")}</h1><p>{t("authorBooks.writtenByYou")}</p></div><button className="primary-button" type="button" onClick={() => setAdding(true)}>＋ {t("content.addBook")}</button></div><div className="library-grid">{books.map((book) => <article data-i18n-skip className="library-book" key={book.id}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div className="library-book-copy"><span data-i18n-skip={false} className="book-format">{t("authorBooks.authored")}</span><h3>{book.title}</h3><p>{book.author}</p><div className="writer-book-links">{book.links.map((link) => <button type="button" key={link.id} onClick={() => setWarningUrl(link.url)}>{link.label}</button>)}</div></div></article>)}</div>{adding && <div className="modal-backdrop" onMouseDown={() => setAdding(false)}><section className="review-editor" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t("common.close")} type="button" onClick={() => setAdding(false)}>×</button><h2>{t("authorBooks.addAuthored")}</h2><form className="book-fields" onSubmit={submit}><div className="form-row"><label>{t("content.author")} *<input required value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} /></label><label>{t("content.title")} *<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label></div><GenrePicker label={t("content.genre")} value={form.genres} onChange={(genres) => setForm({ ...form, genres })} /><label>{t("content.annotation")}<textarea rows={4} value={form.annotation} onChange={(event) => setForm({ ...form, annotation: event.target.value })} /></label><div className="form-row"><label>{t("book.storePortal")}<input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label><label>{t("book.link")}<input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></label></div><div className="form-actions"><button type="button" onClick={() => setAdding(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit">{t("book.save")}</button></div></form></section></div>}{warningUrl && <div className="modal-backdrop" onMouseDown={() => setWarningUrl(null)}><section className="external-warning" onMouseDown={(event) => event.stopPropagation()}><span className="section-subtitle">{t("book.externalLink")}</span><h2>{t("book.externalSite")}</h2><p data-i18n-skip>{warningUrl}</p><div className="form-actions"><button type="button" onClick={() => setWarningUrl(null)}>{t("common.cancel")}</button><button className="primary-button" type="button" onClick={() => window.open(warningUrl, "_blank", "noopener,noreferrer")}>{t("book.continue")}</button></div></section></div>}</div>;
}

export function WriterBookEditor({ book, author, allowFreeAuthor = false, onClose, onSave }: { book?: AuthorBook | null; author: string; allowFreeAuthor?: boolean; onClose: () => void; onSave: (book: AuthorBook) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<AuthorBook>(() => book ?? { id: Date.now(), author, title: "", genres: [], annotation: "", pages: "", durationHours: "", durationMinutes: "", format: "Электронная", coverTone: coverTones[Math.floor(Math.random() * coverTones.length)], links: [{ id: Date.now(), label: "", url: "", action: "Купить" }] });
  const [autofillUrl, setAutofillUrl] = useState(book?.flipUrl ?? "");
  const [sourceFieldsLocked, setSourceFieldsLocked] = useState(Boolean(book));
  const coverLocked = Boolean(book?.coverUrl);
  const fieldLocked = (savedValue: unknown, currentValue: unknown) => book ? Boolean(savedValue) : sourceFieldsLocked && Boolean(currentValue);
  const lockedLinkUrls = (book?.links ?? []).map((link) => link.url);
  function uploadCover(event: React.ChangeEvent<HTMLInputElement>) {
    if (coverLocked) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, coverUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }
  function applyMarketplaceProduct(product: MarketplaceProductPreview) {
    setSourceFieldsLocked(true);
    setForm((current) => ({
      ...current,
      id: product.catalogBookId ?? current.id,
      catalogBookId: product.catalogBookId,
      author: product.catalogBookId || allowFreeAuthor ? product.author : author,
      title: product.title,
      isbn: product.isbn,
      publisher: product.publisher,
      annotation: product.annotation,
      coverUrl: coverLocked ? current.coverUrl : (product.coverUrl || current.coverUrl),
      flipUrl: product.marketplace === "Flip" ? product.productUrl : current.flipUrl,
      links: upsertSourceLink(current.links, product),
    }));
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="book-editor" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" aria-label={t("common.close")} type="button" onClick={onClose}>×</button>
      <div className="book-editor-heading"><span className="section-subtitle">{t("authorBooks.mine")}</span><h2>{book ? t("book.edit") : t("content.addBook")}</h2></div>
      <form className="book-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, links: form.links.filter((link) => link.label.trim() && link.url.trim()) }); }}>
        <div className="cover-upload-column">
          <div data-i18n-skip className={`editable-book-cover library-cover-${form.coverTone}`} style={form.coverUrl ? { backgroundImage: `url(${form.coverUrl})` } : undefined}>{!form.coverUrl && <><em>{form.author}</em><strong data-i18n-skip={Boolean(form.title)}>{form.title || t("book.titlePlaceholder")}</strong><span>Book Meet</span></>}</div>
          <label className={`cover-upload-button ${coverLocked ? "is-disabled" : ""}`}>{coverLocked ? t("book.coverSaved") : t("book.uploadCover")}<input type="file" accept="image/*" disabled={coverLocked} onChange={uploadCover} /></label>
        </div>
        <div className="book-fields">
          <BookAutofillField value={autofillUrl} onChange={(value) => { setAutofillUrl(value); if (!value.trim() && !book) setSourceFieldsLocked(false); }} onProduct={applyMarketplaceProduct} />
          <p className="book-manual-divider">{t("book.manualFill")}</p>
          <div className="book-identity-block">
            <div className="form-row">
              <label>{t("content.author")}<input required value={form.author} disabled={!allowFreeAuthor} onChange={(event) => setForm({ ...form, author: event.target.value })} /></label>
              <label>{t("content.title")} *<input required readOnly={fieldLocked(book?.title, form.title)} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            </div>
            <div className="form-row">
              <label>ISBN<input inputMode="numeric" pattern="[0-9]{10}|[0-9]{13}" maxLength={13} readOnly={fieldLocked(book?.isbn, form.isbn)} value={form.isbn ?? ""} onChange={(event) => setForm({ ...form, isbn: event.target.value.replace(/\D/g, "").slice(0, 13) })} /></label>
              <label>{t("content.publisher")}<input readOnly={fieldLocked(book?.publisher, form.publisher)} value={form.publisher ?? ""} onChange={(event) => setForm({ ...form, publisher: event.target.value })} /></label>
            </div>
            <GenrePicker label={t("content.genre")} value={form.genres} onChange={(genres) => setForm({ ...form, genres })} />
            <label>{t("content.annotation")}<textarea rows={4} readOnly={fieldLocked(book?.annotation, form.annotation)} value={form.annotation} onChange={(event) => setForm({ ...form, annotation: event.target.value })} /></label>
          </div>
          <BookLinksEditor links={form.links} lockedUrls={lockedLinkUrls} onChange={(links) => setForm((current) => ({ ...current, links }))} />
          <label className="adult-material-checkbox"><input type="checkbox" checked={Boolean(form.isAdult)} onChange={(event) => setForm({ ...form, isAdult: event.target.checked })} />{t("book.adult")}</label>
          <div className="form-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit">{t("book.save")}</button></div>
        </div>
      </form>
    </section>
  </div>;
}

export function AuthorBooksTab({ books, setBooks, userId, author, users, publisherMode = false, communityMode = false, canCreate = true }: { books: AuthorBook[]; setBooks: React.Dispatch<React.SetStateAction<AuthorBook[]>>; userId: number; author: string; users: DemoUser[]; publisherMode?: boolean; communityMode?: boolean; canCreate?: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<AuthorBook | null | undefined>(undefined); const [viewing, setViewing] = useState<AuthorBook | null>(null); const [warning, setWarning] = useState<BookLink | null>(null);
  async function save(book: AuthorBook) { const existingBook = books.some((item) => item.id === book.id) || Boolean(book.catalogBookId); const payload = { userId, ...book, format: "Книга", isAuthor: true, useExistingId: existingBook ? (book.catalogBookId ?? book.id) : undefined, links: book.links.map(({ label, url, action }) => ({ label, url, action })) }; try { let response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); if (response.status === 409) { const data = await response.json() as { match: { id: number; title: string; author: string } }; if (!window.confirm(t("book.matchConfirm", { author: data.match.author, title: data.match.title }))) return; response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, useExistingId: data.match.id }) }); } if (!response.ok) throw new Error(t("book.saveError")); const data = await response.json() as { bookId: number }; const savedBook = { ...book, id: data.bookId }; setBooks((current) => current.some((item) => item.id === book.id) ? current.map((item) => item.id === book.id ? savedBook : item) : [savedBook, ...current]); setEditing(undefined); } catch (error) { console.warn(error); window.alert(t("book.saveConnectionError")); } }
  return <div className="library-tab">
    <div className="profile-title-row library-title-row">
      <div><h1>{communityMode ? t("profile.communityBooks") : publisherMode ? t("profile.publisherBooks") : t("authorBooks.mine")}</h1><p>{communityMode ? t("authorBooks.communityHint") : publisherMode ? t("authorBooks.publisherHint") : t("authorBooks.writtenByYou")}</p></div>
      {canCreate && <button className="primary-button" type="button" onClick={() => setEditing(null)}>＋ {t("content.addBook")}</button>}
    </div>
    <div className="library-grid">{books.map((book) => <article data-i18n-skip className="library-book material-clickable-card" role="button" tabIndex={0} key={book.id} onClick={() => setViewing(book)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewing(book); } }}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div className="library-book-copy"><h3>{book.title}</h3><p>{book.author}</p><div className="writer-book-links">{book.links.map((link) => <button type="button" key={link.id} onClick={(event) => { event.stopPropagation(); setWarning(link); }}><span data-i18n-skip={false}>{t(link.action === "Читать" ? "content.read" : link.action === "Слушать" ? "content.listen" : "content.buy")}</span> · {link.label}</button>)}</div></div></article>)}</div>
    {editing !== undefined && <WriterBookEditor book={editing} author={author} allowFreeAuthor={publisherMode} onClose={() => setEditing(undefined)} onSave={save} />}
    {viewing && <UnifiedBookModal book={viewing} users={users} onClose={() => setViewing(null)} onEdit={canCreate ? () => { setEditing(viewing); setViewing(null); } : undefined} onDelete={canCreate ? async () => { if (!window.confirm(t("authorBooks.deleteConfirm", { title: viewing.title }))) return; const response = await fetch(`/api/books/${viewing.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert(t("book.deleteError")); return; } setBooks((current) => current.filter((book) => book.id !== viewing.id)); setViewing(null); } : undefined} />}
    {warning && <div className="modal-backdrop" onMouseDown={() => setWarning(null)}><section className="external-warning" onMouseDown={(event) => event.stopPropagation()}><h2>{t("book.externalSite")}</h2><p data-i18n-skip>{warning.url}</p><div className="form-actions"><button type="button" onClick={() => setWarning(null)}>{t("common.cancel")}</button><button className="primary-button" type="button" onClick={() => window.open(warning.url, "_blank", "noopener,noreferrer")}>{t("book.continue")}</button></div></section></div>}
  </div>;
}

export function RichTextEditor({ value, onChange, catalog = [] }: { value: string; onChange: (value: string) => void; catalog?: (LibraryBook | AuthorBook)[] }) {
  const { t } = useI18n();
  const shellRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [spoilerHint, setSpoilerHint] = useState(false);
  const [bookSearchOpen, setBookSearchOpen] = useState(false);
  const [bookQuery, setBookQuery] = useState("");
  const bookMatches = normalizeBookSearchText(bookQuery).length >= 2 ? catalog.filter((book) => matchesBookQuery(book, bookQuery)).slice(0, 6) : [];
  useEffect(() => {
    if (editorRef.current && document.activeElement !== editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value;
  }, [value]);
  useEffect(() => {
    if (!bookSearchOpen) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setBookSearchOpen(false);
      } else if (!(event.target instanceof Element) || !event.target.closest(".rich-book-search, .rich-book-tool")) setBookSearchOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [bookSearchOpen]);

  function run(command: string, commandValue?: string) {
    editorRef.current?.focus();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false, commandValue);
    onChange(sanitizeRichHtml(editorRef.current?.innerHTML ?? "", t("editor.inlineImage")));
  }

  function rememberRange() {
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (editor && selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange();
    }
  }

  function insertHtml(html: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const range = savedRangeRef.current && editor.contains(savedRangeRef.current.commonAncestorContainer) ? savedRangeRef.current : document.createRange();
    if (!savedRangeRef.current || !editor.contains(range.commonAncestorContainer)) { range.selectNodeContents(editor); range.collapse(false); }
    selection?.removeAllRanges(); selection?.addRange(range);
    document.execCommand("insertHTML", false, html);
    rememberRange();
    onChange(sanitizeRichHtml(editor.innerHTML, t("editor.inlineImage")));
  }

  function toggleRichSpoiler() {
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSpoilerHint(true);
      window.setTimeout(() => setSpoilerHint(false), 1800);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer as HTMLElement : range.commonAncestorContainer.parentElement;
    const existing = parent?.closest("span.spoiler");
    if (existing && editor.contains(existing)) existing.replaceWith(...Array.from(existing.childNodes));
    else {
      const spoiler = document.createElement("span");
      spoiler.className = "spoiler";
      spoiler.append(range.extractContents());
      range.insertNode(spoiler);
    }
    selection.removeAllRanges();
    onChange(sanitizeRichHtml(editor.innerHTML, t("editor.inlineImage")));
  }

  function insertImage(file?: File) {
    if (!file || !file.type.startsWith("image/") || file.size > 3 * 1024 * 1024) {
      if (file) window.alert(t("editor.imageSize"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      insertHtml(`<div class="rich-image-frame" contenteditable="false" style="width:100%;max-width:100%"><img src="${String(reader.result ?? "")}" alt="${t("editor.inlineImage")}" contenteditable="false" style="width:100%;max-width:100%"><span class="rich-image-resize-handle" contenteditable="false">↘</span></div><p><br></p>`);
    };
    reader.readAsDataURL(file);
  }

  function insertBook(book: LibraryBook | AuthorBook) {
    const safeCover = book.coverUrl ? encodeURI(book.coverUrl).replace(/["']/g, "%22") : "";
    insertHtml(`<div class="rich-inline-book" data-book-id="${book.id}" contenteditable="false"><span class="event-modal-book-cover rich-inline-book-cover library-cover-${book.coverTone || "blue"}" contenteditable="false"${safeCover ? ` style="background-image:url('${safeCover}')"` : ""}>${safeCover ? "" : book.title.slice(0, 1)}</span><span class="rich-inline-book-copy" contenteditable="false"><strong>${book.title.replace(/[<>&]/g, "")}</strong><small>${book.author.replace(/[<>&]/g, "")}</small><p>${(book.annotation || t("book.noAnnotation")).replace(/[<>&]/g, "")}</p></span><span class="rich-inline-book-remove" contenteditable="false">×</span></div><p><br></p>`);
    setBookSearchOpen(false); setBookQuery("");
  }

  function resizeImage(event: React.PointerEvent<HTMLDivElement>) {
    const handle = (event.target as Element).closest?.(".rich-image-resize-handle");
    const frame = handle?.closest?.(".rich-image-frame") as HTMLElement | null;
    const editor = editorRef.current;
    if (!frame || !editor) return;
    event.preventDefault();
    const startX = event.clientX; const startWidth = frame.getBoundingClientRect().width; const editorWidth = editor.getBoundingClientRect().width;
    const move = (pointer: PointerEvent) => { const width = Math.min(editorWidth, Math.max(120, startWidth + pointer.clientX - startX)); frame.style.width = `${Math.round(width / editorWidth * 1000) / 10}%`; };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); onChange(sanitizeRichHtml(editor.innerHTML, t("editor.inlineImage"))); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop, { once: true });
  }

  return <div ref={shellRef} className="rich-editor-shell">
    <div className="rich-editor-toolbar" aria-label={t("editor.formatting")}>
      <button type="button" title={t("editor.bold")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("bold")}><b>B</b></button>
      <button type="button" title={t("editor.italic")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("italic")}><i>I</i></button>
      <button type="button" title={t("editor.underline")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("underline")}><u>U</u></button>
      <button type="button" title={t("editor.strike")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("strikeThrough")}><s>S</s></button>
      <button type="button" title={t("editor.heading")} className="rich-heading-button" onMouseDown={(event) => event.preventDefault()} onClick={() => run("formatBlock", "H2")}>{t("editor.heading")}</button>
      <span className="toolbar-divider" />
      <button type="button" title={t("editor.left")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("justifyLeft")}>≡</button>
      <button type="button" title={t("editor.center")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("justifyCenter")}>≡</button>
      <button type="button" title={t("editor.right")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("justifyRight")}>≡</button>
      <button type="button" title={t("editor.justify")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("justifyFull")}>☰</button>
      <span className="toolbar-divider" />
      <button type="button" title={t("editor.bullets")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("insertUnorderedList")}>•≡</button>
      <button type="button" title={t("editor.numbered")} onMouseDown={(event) => event.preventDefault()} onClick={() => run("insertOrderedList")}>1≡</button>
      <span className="toolbar-divider" />
      <button type="button" className="rich-media-tool-button" title={t("editor.insertImage")} aria-label={t("editor.insertImage")} onMouseDown={(event) => event.preventDefault()} onClick={() => imageInputRef.current?.click()}><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="4" width="26" height="24" rx="5" /><circle cx="10" cy="11" r="2.3" /><path d="m5 24 7.5-7 5 4 5.5-6 6 6" /></svg></button>
      <input ref={imageInputRef} className="rich-image-input" type="file" accept="image/*" onChange={(event) => { insertImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      <button type="button" className="rich-media-tool-button rich-book-tool" title={t("editor.insertBook")} aria-label={t("editor.insertBook")} onMouseDown={(event) => { event.preventDefault(); rememberRange(); }} onClick={() => setBookSearchOpen((open) => !open)}><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 4.5h16a2 2 0 0 1 2 2v18H10a4 4 0 0 0-4 4V8.5a4 4 0 0 1 2-4Z" /><path d="M10 4.5v19.8M6 28.5h20" /><path d="m20 4.5 6 6" /></svg></button>
      <button type="button" title={t("editor.spoiler")} onMouseDown={(event) => event.preventDefault()} onClick={toggleRichSpoiler}>▦</button>
      {spoilerHint && <span className="toolbar-hint">{t("editor.selectSpoiler")}</span>}
    </div>
    {bookSearchOpen && <div className="rich-book-search"><input autoFocus value={bookQuery} onChange={(event) => setBookQuery(event.target.value)} placeholder={t("content.startBookSearch")} />{bookMatches.map((book) => <button type="button" data-i18n-skip key={book.id} onClick={() => insertBook(book)}><strong>{book.title}</strong><small>{book.author}</small></button>)}{bookQuery.trim().length >= 2 && !bookMatches.length && <span>{t("editor.bookNotFound")}</span>}</div>}
    <div ref={editorRef} className="rich-editor-content" contentEditable suppressContentEditableWarning data-placeholder={t("editor.continuePublication")} onKeyUp={rememberRange} onMouseUp={rememberRange} onPointerDown={resizeImage} onClick={(event) => { const remove = (event.target as Element).closest?.(".rich-inline-book-remove"); if (remove) { remove.closest(".rich-inline-book")?.remove(); onChange(sanitizeRichHtml(editorRef.current?.innerHTML ?? "", t("editor.inlineImage"))); } }} onInput={(event) => { if (!event.currentTarget.textContent?.trim() && !event.currentTarget.querySelector("img,.rich-inline-book")) event.currentTarget.innerHTML = ""; onChange(sanitizeRichHtml(event.currentTarget.innerHTML, t("editor.inlineImage"))); }} />
  </div>;
}

export function PublisherNewsEditor({ item, catalog = [], communityMode = false, onClose, onSave }: { item: PublisherNews; catalog?: (LibraryBook | AuthorBook)[]; communityMode?: boolean; onClose: () => void; onSave: (item: PublisherNews) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(item);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="review-editor blog-editor-modal publisher-news-editor" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t("common.close")} type="button" onClick={onClose}>×</button><h2>{item.id ? t("news.edit") : t("news.add")}</h2><form className="book-fields" onSubmit={(event) => { event.preventDefault(); const bodyHtml = sanitizeRichHtml(form.bodyHtml ?? "", t("editor.inlineImage")); onSave({ ...form, title: form.title.trim(), previewText: form.previewText.trim().slice(0, 500), bodyHtml, body: bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }); }}>
    <label>{t("content.title")}<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
    <div className="blog-composer"><span className="field-label blog-composer-title">{t("news.whatsNew")}</span><label className="blog-text-block blog-preview-field"><span className="blog-block-title">{t("news.previewHint")}</span><textarea required rows={7} maxLength={500} placeholder={t("news.previewPlaceholder")} value={form.previewText} onChange={(event) => setForm({ ...form, previewText: event.target.value })} /><small className={form.previewText.length >= 500 ? "limit-reached" : ""}>{form.previewText.length}/500</small></label><div className="blog-text-block blog-rich-block"><span className="blog-block-title">{t("news.bodyHint")}</span><RichTextEditor value={form.bodyHtml ?? ""} onChange={(bodyHtml) => setForm({ ...form, bodyHtml })} catalog={catalog} /></div></div>
    <label className="adult-material-checkbox"><input type="checkbox" checked={Boolean(form.isAdult)} onChange={(event) => setForm({ ...form, isAdult: event.target.checked })} />{t("news.adult")}</label>
    <div className="form-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit">{t("common.save")}</button></div>
  </form></section></div>;
}

export function PublisherNewsTab({ news, setNews, owner, users = [owner], catalog = [], canCreate = true, communityMode = false }: {
  news: PublisherNews[];
  setNews: React.Dispatch<React.SetStateAction<PublisherNews[]>>;
  owner: DemoUser;
  users?: DemoUser[];
  catalog?: (LibraryBook | AuthorBook)[];
  canCreate?: boolean;
  communityMode?: boolean;
}) {
  const { locale, t } = useI18n();
  const [editing, setEditing] = useState<PublisherNews | null | undefined>(undefined);
  const [opened, setOpened] = useState<PublisherNews | null>(null);
  const empty = { id: 0, ownerId: owner.id, title: "", previewText: "", bodyHtml: "", body: "", isAdult: false, createdAt: new Date().toLocaleDateString(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU") };
  const [form, setForm] = useState<PublisherNews>(empty);
  const begin = (item: PublisherNews | null) => { setForm(item ? { ...item } : { ...empty }); setEditing(item); };
  const save = (value: PublisherNews) => {
    if (!value.id) value = { ...value, id: Date.now() };
    setNews((current) => current.some((item) => item.id === value.id) ? current.map((item) => item.id === value.id ? value : item) : [value, ...current]);
    setEditing(undefined);
  };
  return <div className="publisher-news-tab">
    <div className="profile-title-row"><div><h1>{t("content.publisherNews")}</h1><p>{t("news.count", { count: news.length })}</p></div>{canCreate && <button className="primary-button" type="button" onClick={() => begin(null)}>＋ {t("news.add")}</button>}</div>
    {news.length ? <div className="publisher-news-grid">{news.map((item) => <article data-i18n-skip className="material-clickable-card" role="button" tabIndex={0} key={item.id} onClick={() => setOpened(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpened(item); } }}><span className="section-subtitle">{item.createdAt}{item.isAdult ? " · 18+" : ""}</span><h3>{item.title}</h3><p>{item.previewText}</p></article>)}</div> : <div className="profile-tab-placeholder">{t("news.empty")}</div>}
    {opened && <PublisherNewsModal item={opened} owner={owner} currentUser={owner} users={users} catalog={catalog} onOpenUser={() => undefined} onEdit={canCreate ? () => { begin(opened); setOpened(null); } : undefined} onDelete={canCreate ? () => { if (window.confirm(t("news.deleteConfirm", { title: opened.title }))) { setNews((current) => current.filter((item) => item.id !== opened.id)); setOpened(null); } } : undefined} onClose={() => setOpened(null)} />}
    {editing !== undefined && <PublisherNewsEditor item={form} catalog={catalog.length ? catalog : catalogFromUsers(users)} communityMode={communityMode} onClose={() => setEditing(undefined)} onSave={save} />}
  </div>;
}

export function PublicationEditor({ excerpt, catalog, onClose, onSave }: { excerpt?: UserExcerpt | null; catalog: (LibraryBook | AuthorBook)[]; onClose: () => void; onSave: (excerpt: UserExcerpt) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<UserExcerpt>(() => excerpt ?? { id: Date.now(), bookTitle: "", previewText: "", bodyHtml: "", text: "", link: "", createdAt: "", createdAtValue: new Date().toISOString() });
  const initialBookIds = excerpt?.bookIds?.length ? excerpt.bookIds : excerpt?.bookId ? [excerpt.bookId] : [];
  const [bookSlots, setBookSlots] = useState<Array<number | undefined>>(() => initialBookIds.length ? initialBookIds : [undefined]);
  function updateBookSlot(index: number, id?: number) {
    const next = bookSlots.map((current, slot) => slot === index ? id : current);
    setBookSlots(next);
    const ids = next.filter((bookId): bookId is number => Boolean(bookId));
    const first = catalog.find((book) => book.id === ids[0]);
    setForm((current) => ({ ...current, bookIds: ids, bookId: ids[0], bookTitle: first?.title ?? "", link: "" }));
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="review-editor blog-editor-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t("common.close")} type="button" onClick={onClose}>×</button><h2>{excerpt ? t("publication.edit") : t("publication.add")}</h2><form className="book-fields" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, bookIds: form.bookIds ?? [], bookId: form.bookIds?.[0], bookTitle: form.bookIds?.[0] ? catalog.find((book) => book.id === form.bookIds?.[0])?.title ?? "" : "", previewText: form.previewText.trim(), bodyHtml: sanitizeRichHtml(form.bodyHtml ?? "", t("editor.inlineImage")), text: form.previewText.trim() }); }}>
    <fieldset className="material-books-field"><legend>{t("publication.books")}</legend>{bookSlots.map((selectedId, index) => <EventBookSelector key={`${index}-${selectedId ?? "empty"}`} catalog={catalog} selectedId={selectedId} onSelect={(book) => updateBookSlot(index, book.id)} onClear={() => updateBookSlot(index)} onCreateBook={() => undefined} />)}<button className="add-another-book" type="button" onClick={() => setBookSlots((current) => [...current, undefined])}>＋ {t("event.addBook")}</button></fieldset>
    <div className="blog-composer"><span className="field-label blog-composer-title">{t("news.whatsNew")}</span><label className="blog-text-block blog-preview-field"><span className="blog-block-title">{t("news.previewHint")}</span><textarea required rows={7} maxLength={500} placeholder={t("news.previewPlaceholder")} value={form.previewText} onChange={(event) => setForm({ ...form, previewText: event.target.value, text: event.target.value })} /><small className={form.previewText.length >= 500 ? "limit-reached" : ""}>{form.previewText.length}/500</small></label><div className="blog-text-block blog-rich-block"><span className="blog-block-title">{t("news.bodyHint")}</span><RichTextEditor value={form.bodyHtml ?? ""} onChange={(bodyHtml) => setForm({ ...form, bodyHtml })} catalog={catalog} /></div></div>
    <label className="adult-material-checkbox"><input type="checkbox" checked={Boolean(form.isAdult)} onChange={(event) => setForm({ ...form, isAdult: event.target.checked })} />{t("news.adult")}</label>
    <div className="form-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit">{t("common.save")}</button></div>
  </form></section></div>;
}

export function ExcerptsTab({ excerpts, setExcerpts, owner, users, catalog = [], likes, onToggleLike, onComment, onOpenUser, initialAdd = false, initialEditId }: { excerpts: UserExcerpt[]; setExcerpts: React.Dispatch<React.SetStateAction<UserExcerpt[]>>; owner: DemoUser; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; likes: Record<string, number[]>; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void; initialAdd?: boolean; initialEditId?: number | null }) {
  const { t } = useI18n();
  const canonicalCatalog = catalog.length ? catalog : catalogFromUsers(users);
  const author = owner.profile.name;
  const [editing, setEditing] = useState<UserExcerpt | null | undefined>(() => initialEditId ? excerpts.find((item) => item.id === initialEditId) : initialAdd ? null : undefined);
  const [viewing, setViewing] = useState<UserExcerpt | null>(null);

  return <div className="reviews-tab">
    <div className="profile-title-row library-title-row"><div><h1>{t("profile.blog")}</h1><p>{t("publication.count", { count: excerpts.length })}</p></div><button className="primary-button" type="button" onClick={() => setEditing(null)}>＋ {t("publication.add")}</button></div>
    <div className="my-reviews-list">{excerpts.map((excerpt) => <article data-i18n-skip className="my-review-row material-clickable-card" role="button" tabIndex={0} key={excerpt.id} onClick={() => setViewing(excerpt)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewing(excerpt); } }}><div className="my-review-mark">✦</div><div><span>{excerpt.createdAt} · {author}</span><h3 data-i18n-skip={Boolean(excerpt.bookTitle)}>{excerpt.bookTitle || t("content.publications")}</h3><p>{excerpt.previewText || excerpt.text.slice(0, 500)}</p></div></article>)}</div>
    {viewing && (() => { const item: ReadingItem = { id: viewing.id, kind: "excerpt", title: viewing.bookTitle || t("content.publications"), author, text: viewing.text, preview: viewing.previewText, bodyHtml: viewing.bodyHtml, linkedBookId: viewing.bookId, linkedBookIds: viewing.bookIds, ownerId: owner.id, createdAt: viewing.createdAt }; return <ReadingModal item={item} currentUser={owner} users={users} catalog={canonicalCatalog} likedUserIds={likes[`excerpt-${viewing.id}`] ?? []} onToggleLike={() => onToggleLike(item)} onComment={(text) => onComment(item, text)} onOpenUser={onOpenUser} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} onDelete={() => { if (window.confirm(t("publication.deleteConfirm"))) { setExcerpts((current) => current.filter((excerpt) => excerpt.id !== viewing.id)); setViewing(null); } }} />; })()}
    {editing !== undefined && <PublicationEditor excerpt={editing} catalog={canonicalCatalog} onClose={() => setEditing(undefined)} onSave={(saved) => { setExcerpts((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]); setEditing(undefined); }} />}
  </div>;
}

export function AdminCatalogCard({ item, onOpen }: { item: AdminCatalogItem; onOpen: () => void }) {
  const { t } = useI18n();
  if (item.kind === "book") return <button data-i18n-skip className="admin-book-card" type="button" onClick={onOpen}><div className={`library-book-cover library-cover-${item.coverTone || "blue"}`} style={item.coverUrl ? { backgroundImage: `url(${item.coverUrl})` } : undefined}>{!item.coverUrl && <><em>{item.subtitle}</em><strong>{item.title}</strong><span>Book Meet</span></>}</div><strong>{item.title}</strong><span>{item.subtitle}</span></button>;
  return <button className={`admin-content-card admin-content-${item.kind}`} type="button" onClick={onOpen}><span data-i18n-skip className="section-subtitle">{item.subtitle}</span><h3 data-i18n-skip>{item.title}</h3><p data-i18n-skip>{item.text}</p><small>{t("admin.openMaterial")}</small></button>;
}

export function AdminExcerptEditor({ excerpt, writerBooks, onClose, onSave }: { excerpt: UserExcerpt; writerBooks: AuthorBook[]; onClose: () => void; onSave: (excerpt: UserExcerpt) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(excerpt);
  const [linked, setLinked] = useState(Boolean(excerpt.bookId));
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="review-editor blog-editor-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t("common.close")} type="button" onClick={onClose}>×</button><h2>{t("publication.edit")}</h2><form className="book-fields" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, bookId: linked ? form.bookId : undefined, bookTitle: linked ? form.bookTitle : "", previewText: form.previewText.trim(), bodyHtml: sanitizeRichHtml(form.bodyHtml, t("editor.inlineImage")), text: form.previewText.trim() }); }}><div className="blog-book-toggle"><span>{t("publication.linkedQuestion")}</span><button className={`switch-control ${linked ? "active" : ""}`} type="button" role="switch" aria-checked={linked} onClick={() => { setLinked((value) => !value); if (linked) setForm({ ...form, bookId: undefined, bookTitle: "" }); }}><span /></button></div>{linked && <div className="blog-book-picker">{writerBooks.map((book) => <button data-i18n-skip className={`blog-book-option ${form.bookId === book.id ? "selected" : ""}`} type="button" key={book.id} onClick={() => setForm({ ...form, bookId: book.id, bookTitle: book.title, link: "" })}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><strong>{book.title}</strong></button>)}</div>}<div className="blog-composer"><span className="field-label blog-composer-title">{t("news.whatsNew")}</span><label className="blog-text-block blog-preview-field"><span className="blog-block-title">{t("news.previewHint")}</span><textarea required rows={7} maxLength={500} placeholder={t("news.previewPlaceholder")} value={form.previewText} onChange={(event) => setForm({ ...form, previewText: event.target.value, text: event.target.value })} /><small className={form.previewText.length >= 500 ? "limit-reached" : ""}>{form.previewText.length}/500</small></label><div className="blog-text-block blog-rich-block"><span className="blog-block-title">{t("news.bodyHint")}</span><RichTextEditor value={form.bodyHtml} onChange={(bodyHtml) => setForm({ ...form, bodyHtml })} /></div></div><div className="form-actions"><button type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button creation-action-button" type="submit">{t("common.save")}</button></div></form></section></div>;
}

export function AdminCatalogOverlay({ item, users, catalog = [], onClose, onEdit, onDelete }: { item: AdminCatalogItem; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const admin = users.find((user) => user.isAdmin);
  if (item.kind === "book") return <UnifiedBookModal book={item.source} users={users} catalog={catalog} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
  if (item.kind === "event") return <EventModal item={item.source} users={users} catalog={catalog} currentUser={admin} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
  if (item.kind === "occasion") return <OccasionModal item={item.source} users={users} currentUser={admin} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
  if (item.kind === "publisher_news") return <PublisherNewsModal item={item.source} owner={users.find((user) => user.id === item.source.ownerId)} currentUser={admin} users={users} catalog={catalog} onOpenUser={() => undefined} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
  const source = item.source as (UserReview | UserExcerpt) & { ownerId: number; ownerName: string };
  const readingItem: ReadingItem = item.kind === "review"
    ? { id: item.id, kind: "review", title: (source as UserReview).bookTitle, bookAuthor: (source as UserReview).bookAuthor, author: source.ownerName, ownerId: source.ownerId, text: (source as UserReview).fullText, bodyHtml: (source as UserReview).bodyHtml, linkedBookId: (source as UserReview).bookId, preview: (source as UserReview).preview, rating: (source as UserReview).rating, createdAt: (source as UserReview).createdAt, isAdult: (source as UserReview).isAdult }
    : { id: item.id, kind: "excerpt", title: (source as UserExcerpt).bookTitle || t("content.publications"), linkedBookId: (source as UserExcerpt).bookId, linkedBookIds: (source as UserExcerpt).bookIds, author: source.ownerName, ownerId: source.ownerId, text: (source as UserExcerpt).text, preview: (source as UserExcerpt).previewText, bodyHtml: (source as UserExcerpt).bodyHtml, createdAt: (source as UserExcerpt).createdAt, isAdult: (source as UserExcerpt).isAdult };
  return <ReadingModal item={readingItem} currentUser={admin} users={users} catalog={catalog} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
}

export function AdminCatalogEditor({ item, users, catalog = [], onClose, onSave }: { item: AdminCatalogItem; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; onClose: () => void; onSave: (payload: unknown) => void }) {
  const canonicalCatalog = catalog.length ? catalog : catalogFromUsers(users);
  if (item.kind === "book") {
    const owner = users.find((user) => (user.authorBooks ?? []).some((book) => book.id === item.id) || user.books.some((book) => book.id === item.id));
    if ("links" in item.source) return <WriterBookEditor book={item.source} author={item.source.author} onClose={onClose} onSave={(book) => onSave({ ...book, ownerId: owner?.id })} />;
    return <BookEditor book={item.source} catalog={canonicalCatalog} onClose={onClose} onSave={(book) => onSave({ ...book, ownerId: owner?.id })} />;
  }
  if (item.kind === "review") return <ReviewEditor review={item.source} catalog={canonicalCatalog} onClose={onClose} onSave={(review) => onSave(review)} />;
  if (item.kind === "excerpt") {
    return <PublicationEditor excerpt={item.source} catalog={canonicalCatalog} onClose={onClose} onSave={(excerpt) => onSave(excerpt)} />;
  }
  if (item.kind === "publisher_news") return <PublisherNewsEditor item={item.source} catalog={canonicalCatalog} onClose={onClose} onSave={onSave} />;
  return null;
}
