import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../chat/ChatComponents";
import type { Friend } from "../chat/types";
import { CustomSelect } from "../common/CustomSelect";
import { ModalIconActions } from "../modals/ModalIconActions";
import { openReportDialog } from "../safety/SafetyCenter";
import { useRoutedPopup } from "../../navigation/routes";
import {
  catalogFromUsers,
  excerptReadingItemById,
  eventTimestamp,
  formatKazakhstanPhone,
  normalizeBookKey,
  resolveCanonicalBook,
  reviewReadingItemById,
  sanitizeRichHtml,
  userBookMatches,
} from "../../lib/domain";
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
  PublisherNews,
  ReadingItem,
  Review,
  UserExcerpt,
  UserReview,
  WishBook,
} from "../../types/domain";

export const monthlyBooks = [
  { title: "Время секонд хэнд", author: "Светлана Алексиевич", cover: "cover-red", mark: "В" },
  { title: "Тревожные люди", author: "Фредрик Бакман", cover: "cover-cream", mark: "ТЛ" },
  { title: "Клара и Солнце", author: "Кадзуо Исигуро", cover: "cover-blue", mark: "КС" },
  { title: "Бегущий за ветром", author: "Халед Хоссейни", cover: "cover-green", mark: "БВ" },
];

export type EventFormValue = { title: string; summary: string; description: string; date: string; time: string; city: string; cityId?: number; address: string; mapUrl: string; detailsUrl: string; relatedToBook: boolean; linkedBookId?: number };
export const emptyEvent: EventFormValue = { title: "", summary: "", description: "", date: "", time: "", city: "", address: "", mapUrl: "", detailsUrl: "", relatedToBook: false };

function EventBookSelector({ catalog, selectedId, onSelect, onCreateBook }: { catalog: (LibraryBook | AuthorBook)[]; selectedId?: number; onSelect: (book: LibraryBook | AuthorBook) => void; onCreateBook: () => void }) {
  const selected = catalog.find((book) => book.id === selectedId);
  const [query, setQuery] = useState(selected ? `${selected.title} — ${selected.author}` : "");
  const normalized = query.trim().toLocaleLowerCase("ru");
  const matches = normalized.length >= 2 ? catalog.filter((book) => book.title.toLocaleLowerCase("ru").includes(normalized) || book.author.toLocaleLowerCase("ru").includes(normalized) || `${book.title} ${book.author}`.toLocaleLowerCase("ru").includes(normalized)).slice(0, 5) : [];
  useEffect(() => {
    if (selected) setQuery(`${selected.title} — ${selected.author}`);
  }, [selected?.id]);
  return <div className="event-book-selector"><label>Название книги или автор<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Начните вводить название или имя автора" autoComplete="off" /></label>{matches.length > 0 ? <div className="book-match-suggestions"><strong>Выберите книгу</strong>{matches.map((book) => <button type="button" key={book.id} onClick={() => onSelect(book)}><div className={`match-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <span>{book.title.slice(0, 1)}</span>}</div><span><b>{book.title}</b><small>{book.author}</small></span></button>)}</div> : normalized.length >= 2 && !selected ? <div className="event-book-not-found"><span>Совпадений не найдено.</span><button className="outline-button" type="button" onClick={onCreateBook}>Сначала создать книгу</button></div> : null}</div>;
}

export function EventForm({ initial, catalog = [], onCreateBook = () => undefined, onCancel, onSave, submitLabel = "Отправить на модерацию" }: { initial?: BookEvent; catalog?: (LibraryBook | AuthorBook)[]; onCreateBook?: () => void; onCancel: () => void; onSave: (value: EventFormValue) => Promise<void>; submitLabel?: string }) {
  const [value, setValue] = useState<EventFormValue>(() => initial ? { title: initial.title, summary: initial.summary, description: initial.description, date: initial.date, time: initial.time, city: initial.city, cityId: initial.cityId, address: initial.address, mapUrl: initial.mapUrl, detailsUrl: initial.detailsUrl, relatedToBook: Boolean(initial.linkedBookId), linkedBookId: initial.linkedBookId } : emptyEvent);
  const [saving, setSaving] = useState(false);
  const field = (name: "title" | "summary" | "description" | "date" | "time" | "address" | "mapUrl" | "detailsUrl") => ({ value: value[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue((current) => ({ ...current, [name]: event.target.value })) });
  return <form className="event-form" onSubmit={async (event) => { event.preventDefault(); setSaving(true); try { await onSave(value); } finally { setSaving(false); } }}>
    <div className="profile-title-row"><div><span className="section-subtitle">Книжные события Казахстана</span><h2>{initial ? "Редактировать событие" : "Предложить событие"}</h2></div></div>
    <label className="event-related-toggle"><input type="checkbox" checked={value.relatedToBook} onChange={(event) => setValue((current) => ({ ...current, relatedToBook: event.target.checked, linkedBookId: event.target.checked ? current.linkedBookId : undefined }))} /><span>Событие связано с книгой</span></label>
    {value.relatedToBook && <EventBookSelector catalog={catalog} selectedId={value.linkedBookId} onSelect={(book) => setValue((current) => ({ ...current, linkedBookId: book.id }))} onCreateBook={onCreateBook} />}
    <label>Название события<input required maxLength={200} {...field("title")} /></label>
    <label>Краткое описание для карточки<textarea required rows={3} maxLength={1200} {...field("summary")} /></label>
    <label>Подробности события<textarea required rows={6} {...field("description")} /></label>
    <div className="form-row"><label>Дата<input required type="date" {...field("date")} /></label><label>Время<input required type="time" {...field("time")} /></label></div>
    <div className="form-row"><CityAutocomplete value={value.city} required onChange={(city, cityId) => setValue((current) => ({ ...current, city, cityId }))} /><label>Адрес<input required {...field("address")} /></label></div>
    <label>Ссылка на 2ГИС<input type="url" placeholder="https://2gis.kz/..." {...field("mapUrl")} /></label>
    <label>Ссылка на анонс, билеты или регистрацию<input type="url" placeholder="https://..." {...field("detailsUrl")} /></label>
    <div className="form-actions"><button type="button" onClick={onCancel}>Отмена</button><button className="primary-button" disabled={saving || (value.relatedToBook && !value.linkedBookId)} type="submit">{saving ? "Сохраняем…" : submitLabel}</button></div>
  </form>;
}

export function EventStatusLabel({ status }: { status: EventStatus }) {
  if (status === "published") return null;
  const labels = { pending: "На модерации", needs_changes: "Нужна доработка", rejected: "Отклонено" };
  return <span className={`event-status event-status-${status}`}>{labels[status]}</span>;
}

export function EventCard({ item, own, onOpen, onOpenBook, onEdit, compact = false }: { item: BookEvent; own: boolean; onOpen: () => void; onOpenBook?: () => void; onEdit?: () => void; compact?: boolean }) {
  return <article className={`event-card event-card-clickable ${compact ? "event-card-compact" : ""} ${item.pinned ? "is-pinned" : ""}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><div className="event-date"><strong>{new Date(`${item.date}T00:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}</strong><span>{item.time}</span></div><div className="event-card-copy"><div>{own && <EventStatusLabel status={item.status} />}<span className="section-subtitle">{item.pinned && <b className="pinned-event-label">Закреплено · </b>}{item.city}{!compact && item.bookTitle && <><i className="event-book-dot" aria-hidden="true" /><button className="event-book-inline" type="button" onClick={(event) => { event.stopPropagation(); onOpenBook?.(); }}>{item.bookTitle} · {item.bookAuthor}</button></>}</span></div><h3>{item.title}</h3>{!compact && <><p>{item.summary}</p><small>{item.address}</small></>}{own && item.status === "needs_changes" && onEdit && <div className="moderated-card-actions"><button className="outline-button" type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>Редактировать</button></div>}</div></article>;
}

export async function editReadingMaterial(item: ReadingItem, currentUser: DemoUser) {
  if (item.ownerId === currentUser.id) {
    window.dispatchEvent(new CustomEvent("bookmeet:edit-material", { detail: { kind: item.kind, id: item.id } }));
    return;
  }
  if (!currentUser.isAdmin) return;
  const title = window.prompt(item.kind === "review" ? "Название книги для рецензии" : "Название публикации", item.title);
  if (title === null) return;
  const text = window.prompt(item.kind === "review" ? "Краткое описание рецензии" : "Текст публикации", item.preview || item.text);
  if (text === null) return;
  const response = await fetch(`/api/admin/materials/${item.kind}/${item.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, text }) });
  if (!response.ok) { window.alert("Не удалось сохранить изменения"); return; }
  window.location.reload();
}

export async function deleteReadingMaterial(item: ReadingItem, currentUser: DemoUser) {
  if (!currentUser.isAdmin && item.ownerId !== currentUser.id) return;
  if (!window.confirm(`Удалить ${item.kind === "review" ? "рецензию" : "публикацию"}?`)) return;
  const endpoint = currentUser.isAdmin ? `/api/admin/materials/${item.kind}/${item.id}` : `/api/materials/${item.kind}/${item.id}`;
  const response = await fetch(endpoint, { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) { window.alert("Не удалось удалить материал"); return; }
  window.location.reload();
}

function formatCommentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startComment = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday.getTime() - startComment.getTime()) / 86400000);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (days === 0) return `Сегодня в ${time}`;
  if (days === 1) return `Вчера в ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date)} в ${time}`;
  }
  return `${new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date)} в ${time}`;
}

export function EventModal({ item, onClose, onOpenBook, onEdit, onDelete, onReport }: { item: BookEvent; onClose: () => void; onOpenBook?: () => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void }) {
  const routedClose = useRoutedPopup(`/events/${item.id}`, "/events", onClose, `${item.title} — Book Meet`);
  const [reminderSet, setReminderSet] = useState(Boolean(item.reminderSet));
  const [reminderDialog, setReminderDialog] = useState<"created" | "cancel" | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  async function setReminder() {
    if (reminderSet || reminderBusy) return;
    setReminderBusy(true);
    try {
      const response = await fetch(`/api/events/${item.id}/reminder`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "Не удалось установить напоминание");
      setReminderSet(true);
      window.setTimeout(() => setReminderDialog("created"), 40);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось установить напоминание");
    } finally {
      setReminderBusy(false);
    }
  }
  async function cancelReminder() {
    if (!reminderSet || reminderBusy) return;
    setReminderBusy(true);
    try {
      const response = await fetch(`/api/events/${item.id}/reminder`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "Не удалось отменить напоминание");
      setReminderSet(false);
      setReminderDialog(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось отменить напоминание");
    } finally {
      setReminderBusy(false);
    }
  }
  function openOwnProfile() {
    setReminderDialog(null);
    window.location.assign("/profile/events");
  }
  return <div className="modal-backdrop" onMouseDown={routedClose}><section className="event-modal" onMouseDown={(event) => event.stopPropagation()}><ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={routedClose} /><EventStatusLabel status={item.status} /><span className="section-subtitle">Книжное событие · {item.city}</span><h2>{item.title}</h2>{item.bookTitle && <button className="event-modal-book" type="button" onClick={onOpenBook}><div className={`event-modal-book-cover library-cover-${item.bookCoverTone ?? "blue"}`} style={item.bookCoverUrl ? { backgroundImage: `url(${item.bookCoverUrl})` } : undefined}>{!item.bookCoverUrl && item.bookTitle.slice(0, 1)}</div><span><strong>{item.bookTitle}</strong><small>{item.bookAuthor}</small><p>{item.bookAnnotation || "Аннотация пока не добавлена."}</p></span></button>}<div className="event-modal-meta"><strong>{new Date(`${item.date}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })} · {item.time}</strong><span>{item.address}</span></div><p>{item.description}</p>{item.moderationNote && item.status !== "published" && <div className="moderation-note"><strong>Комментарий модератора</strong><p>{item.moderationNote}</p></div>}<div className="event-links">{item.detailsUrl && <a className="primary-button" href={item.detailsUrl} target="_blank" rel="noreferrer">Регистрация</a>}{item.mapUrl && <a className="outline-button" href={item.mapUrl} target="_blank" rel="noreferrer">Смотреть в 2ГИС</a>}{item.status === "published" && <button className="outline-button" type="button" disabled={reminderBusy} onClick={() => reminderSet ? setReminderDialog("cancel") : void setReminder()}>{reminderSet ? "Напоминание установлено" : "Установить напоминание"}</button>}</div>{reminderDialog && <div className="nested-modal-backdrop" onMouseDown={() => setReminderDialog(null)}><section className="event-reminder-notice" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>{reminderDialog === "created" ? <><h2>Напоминание установлено</h2><p>Вы установили напоминание, за 24 часа до мероприятия вы получите уведомление с напоминанием. Мероприятие сохранено в раздел «Мои мероприятия» в вашем профиле. Не забудьте зарегистрироваться на мероприятие у организатора, если это требуется.</p><div className="form-actions"><button className="outline-button" type="button" onClick={() => setReminderDialog(null)}>Ок</button><button className="outline-button" type="button" onClick={openOwnProfile}>Перейти в профиль</button></div></> : <><h2>Отменить напоминание?</h2><div className="form-actions"><button className="outline-button" type="button" disabled={reminderBusy} onClick={() => void cancelReminder()}>Да</button><button className="outline-button" type="button" autoFocus onClick={() => setReminderDialog(null)}>Нет</button></div></>}</section></div>}</section></div>;
}

export function CityAutocomplete({ value, onChange, required = false, label = "Город", invalid = false }: { value: string; onChange: (name: string, id?: number) => void; required?: boolean; label?: string; invalid?: boolean }) {
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState<CityOption[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => {
    if (!open || query.trim().length < 1) { setOptions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => fetch(`/api/cities?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal }).then((response) => response.json()).then((data: { cities?: CityOption[] }) => { setOptions(data.cities ?? []); setOpen(true); }).catch(() => undefined), 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);
  return <label className={`city-autocomplete ${invalid ? "field-invalid" : ""}`}>{label}<input required={required} aria-invalid={invalid} value={query} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { const next = event.target.value.replace(/[^А-ЯЁа-яёІіҢңҒғҮүҰұҚқӨөҺһӘәЎўЇїЄєҐґЏџЉљЊњЋћЌќ\s.'’()-]/gu, ""); setQuery(next); onChange(next); }} placeholder="Начните вводить город" autoComplete="off" />{open && query.trim() && <div className="city-suggestions">{options.map((city) => <button type="button" key={city.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(city.name); onChange(city.name, city.id); setOpen(false); }}>{city.name}<small>{city.country}</small></button>)}</div>}</label>;
}

export function CityFilter({ value, cities, onChange }: { value: string; cities: string[]; onChange: (city: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => Array.from(new Set(cities.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru")), [cities]);
  const matches = options.filter((city) => !value.trim() || city.toLocaleLowerCase("ru").includes(value.trim().toLocaleLowerCase("ru")));
  return <label className="directory-city-filter" aria-label="Выбрать город"><span className="city-filter-icon" aria-hidden="true">⌕</span><input value={value} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { onChange(event.target.value.replace(/[^А-ЯЁа-яёІіҢңҒғҮүҰұҚқӨөҺһӘәЎўЇїЄєҐґЏџЉљЊњЋћЌќ\s.'’()-]/gu, "")); setOpen(true); }} placeholder="Начните вводить город" autoComplete="off" />{value && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onChange("")} aria-label="Сбросить фильтр">×</button>}{open && <div className="directory-city-options"><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setOpen(false); }}>Все города</button>{matches.map((city) => <button type="button" key={city} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(city); setOpen(false); }}>{city}</button>)}</div>}</label>;
}

export function MultiCityPicker({ values, onChange }: { values: string[]; onChange: (cities: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return <div className="multi-city-picker"><div className="selected-city-tags">{values.map((city) => <span key={city}>{city}<button type="button" onClick={() => onChange(values.filter((item) => item !== city))}>×</button></span>)}</div><CityAutocomplete label="Город (можно выбрать несколько)" value={draft} required={!values.length} onChange={(name, id) => { setDraft(name); if (id && !values.includes(name)) { onChange([...values, name]); setDraft(""); } }} /></div>;
}

export const emptyOccasion = { type: "" as "" | OccasionType, primaryText: "", audienceText: "", targetGender: "Все" as Occasion["targetGender"], targetCities: [] as string[], targetProfileType: "Все" as Occasion["targetProfileType"] };
export const occasionLabels = { meet: "Просто познакомиться", discuss: "Обсудить что-то", invite: "Встретиться" } as const;

export function OccasionForm({ initial, onCancel, onSave, submitLabel = "Отправить" }: { initial?: Occasion; onCancel: () => void; onSave: (value: typeof emptyOccasion) => Promise<void>; submitLabel?: string }) {
  const [value, setValue] = useState<typeof emptyOccasion>(() => initial ? { type: initial.type, primaryText: initial.primaryText, audienceText: initial.audienceText, targetGender: initial.targetGender, targetCities: initial.targetCities, targetProfileType: initial.targetProfileType } : emptyOccasion);
  const [saving, setSaving] = useState(false);
  const changeType = (type: OccasionType | "") => setValue({ ...emptyOccasion, type });
  const texts = value.type === "meet" ? { primary: "Расскажите о себе", audience: "С кем вы хотите познакомиться", audienceHint: "Опишите людей, с которыми вам хотелось бы познакомиться: например, их книжные интересы, возраст или формат общения." } : value.type === "discuss" ? { primary: "Что вы хотите обсудить?", audience: "С кем вы хотите это обсудить", audienceHint: "Расскажите, какого собеседника вы ищете и с кем вам было бы интересно обсудить эту тему." } : { primary: "Напишите своё предложение", audience: "Кого вы хотите пригласить?", audienceHint: "Опишите людей, которым может быть интересно ваше предложение и с кем вы хотели бы встретиться." };
  return <form className="occasion-form" onSubmit={async (event) => { event.preventDefault(); if (!value.type) return; setSaving(true); try { await onSave(value); } finally { setSaving(false); } }}><div className="profile-title-row"><div><span className="section-subtitle">Поводы познакомиться</span><h2>{initial ? "Редактировать повод" : "Предложить повод для знакомства"}</h2></div></div><label>Тип предложения<CustomSelect ariaLabel="Тип предложения" value={value.type} onChange={changeType} options={[{ value: "", label: "Выберите тип предложения" }, { value: "meet", label: "1. Просто познакомиться" }, { value: "discuss", label: "2. Обсудить что-то" }, { value: "invite", label: "3. Встретиться" }]} /></label>{value.type && <><label>{texts.primary}<textarea required rows={5} value={value.primaryText} onChange={(event) => setValue({ ...value, primaryText: event.target.value })} placeholder={value.type === "invite" ? "Вы можете предложить сходить в книжный, музей или театр, выпить кофе, посмотреть кино, выйти на прогулку или посетить любое другое мероприятие." : undefined} /></label><fieldset className="occasion-audience-box"><legend>Кого вы ищете</legend><label>{texts.audience}<textarea required rows={4} value={value.audienceText} onChange={(event) => setValue({ ...value, audienceText: event.target.value })} placeholder={texts.audienceHint} /></label><div className="occasion-audience-grid"><label>Пол собеседника<CustomSelect ariaLabel="Пол собеседника" value={value.targetGender} onChange={(targetGender) => setValue({ ...value, targetGender })} options={["Все", "Мужской", "Женский"].map((item) => ({ value: item as Occasion["targetGender"], label: item }))} /></label><label>Тип профиля собеседника<CustomSelect ariaLabel="Тип профиля собеседника" value={value.targetProfileType} onChange={(targetProfileType) => setValue({ ...value, targetProfileType })} options={["Все", "Читатель", "Писатель", "Блогер"].map((item) => ({ value: item as Occasion["targetProfileType"], label: item }))} /></label></div></fieldset><MultiCityPicker values={value.targetCities} onChange={(targetCities) => setValue({ ...value, targetCities })} /></>}<div className="form-actions"><button type="button" onClick={onCancel}>Отмена</button><button className="primary-button" disabled={saving || !value.type || !value.targetCities.length} type="submit">{saving ? "Сохраняем…" : submitLabel}</button></div></form>;
}

export function OccasionCard({ item, own, onOpen, onEdit }: { item: Occasion; own: boolean; onOpen: () => void; onEdit?: () => void }) {
  return <article className="occasion-card material-clickable-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><div><span className="section-subtitle">{occasionLabels[item.type]}</span>{own && <EventStatusLabel status={item.status} />}</div><h3>{item.primaryText}</h3><p>{item.audienceText}</p><small>{item.targetCities.join(" · ")} · {item.targetProfileType} · {item.targetGender === "Все" ? "любой пол" : item.targetGender}</small>{own && item.status === "needs_changes" && onEdit && <button className="outline-button card-inline-action" type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>Редактировать</button>}</article>;
}

export function OccasionModal({ item, onClose, onOpenUser, onEdit, onDelete, onReport }: { item: Occasion; onClose: () => void; onOpenUser?: (id: number) => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void }) {
  const routedClose = useRoutedPopup(`/meet/${item.id}`, "/meet", onClose, "Повод познакомиться — Book Meet");
  return <div className="modal-backdrop" onMouseDown={routedClose}><section className="event-modal occasion-modal" onMouseDown={(event) => event.stopPropagation()}><ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={routedClose} /><EventStatusLabel status={item.status} /><span className="section-subtitle">{occasionLabels[item.type]}</span><h2>{item.primaryText}</h2><p>{item.audienceText}</p><div className="occasion-filter-summary"><span>Города: {item.targetCities.join(", ")}</span><span>Профиль: {item.targetProfileType}</span><span>Пол: {item.targetGender}</span></div><p>Автор: <button className="inline-user-link" type="button" onClick={() => onOpenUser?.(item.creatorId)}>{item.creatorName}</button></p>{item.moderationNote && item.status !== "published" && <div className="moderation-note"><strong>Комментарий модератора</strong><p>{item.moderationNote}</p></div>}</section></div>;
}

export function MaterialPreviewCard({ item, index = 0, book, likesCount, commentsCount, onOpen, onOpenUser, onOpenBook }: { item: ReadingItem; index?: number; book?: LibraryBook | AuthorBook; likesCount?: number; commentsCount?: number; onOpen: () => void; onOpenUser: (id: number) => void; onOpenBook?: () => void }) {
  const review = item.kind === "review";
  return <article className={`excerpt-card material-preview-card material-clickable-card ${review ? "review-preview-card" : ""}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><span className="quote-mark">“</span><p>{item.preview || item.text}</p><div className="excerpt-footer"><div className={`author-dot author-dot-${index % 3 + 1}`}>{item.author.slice(0, 1)}</div><div><h3>{review ? "Рецензия" : "Публикация"}</h3><span><button className="inline-user-link" type="button" onClick={(event) => { event.stopPropagation(); if (item.ownerId) onOpenUser(item.ownerId); }}>{item.author}</button>{book && <> · <button className="inline-book-link" type="button" onClick={(event) => { event.stopPropagation(); onOpenBook?.(); }}>{book.title}</button></>}</span>{(likesCount !== undefined || commentsCount !== undefined) && <small>♡ {likesCount ?? 0} · Комментарии: {commentsCount ?? 0}</small>}</div></div></article>;
}

export function HomeScopeSwitch({ city, value, onChange }: { city: string; value: "country" | "city"; onChange: (value: "country" | "city") => void }) {
  return <div className={`home-scope-switch scope-${value}`} role="group" aria-label="Область показа"><span aria-hidden="true" /><button className={value === "country" ? "active" : ""} type="button" onClick={() => onChange("country")}>Казахстан</button><button className={value === "city" ? "active" : ""} type="button" onClick={() => onChange("city")}>{city || "Мой город"}</button></div>;
}

export function ReadingModal({ item, currentUser, users = [], likedUserIds = [], onToggleLike, onComment, onClose, onOpenUser, relationship, isFollowing, onAddFriend, onFollow, onEdit, onDelete, onReport }: { item: ReadingItem; currentUser?: DemoUser; users?: DemoUser[]; likedUserIds?: number[]; onToggleLike?: () => void; onComment?: (text: string) => Promise<MaterialComment | null>; onClose: () => void; onOpenUser?: (userId: number) => void; relationship?: "none" | "outgoing" | "incoming" | "friends"; isFollowing?: boolean; onAddFriend?: (message: string) => void; onFollow?: () => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void }) {
  const routeBase = item.kind === "review" ? "/reviews" : "/blog";
  const routedClose = useRoutedPopup(`${routeBase}/${item.id}`, routeBase, onClose, `${item.kind === "review" ? "Рецензия" : "Публикация"} — Book Meet`);
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
  const matchingBook = catalogFromUsers(users).find((book) => book.title.toLowerCase() === item.title.replace(/[«»]/g, "").toLowerCase() && (!item.bookAuthor || book.author.toLowerCase() === item.bookAuthor.toLowerCase())) ?? null;
  async function deleteComment(entry: MaterialComment) {
    if (!window.confirm("Удалить комментарий?")) return;
    const response = await fetch(`/api/comments/${entry.id}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      window.alert(data.error || "Не удалось удалить комментарий");
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

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={routedClose}>
      <article className="reading-modal" role="dialog" aria-modal="true" aria-labelledby="reading-title" onMouseDown={(event) => event.stopPropagation()}>
        <ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={routedClose} />
        <span className="section-subtitle">{item.kind === "review" ? "Рецензия" : "Публикация блога"}</span>
        {item.kind === "review" ? <button className="review-book-heading" type="button" onClick={() => matchingBook && setBookPopup(matchingBook)}><span className={`mini-book mini-book-${matchingBook?.coverTone ?? "blue"}`} style={matchingBook?.coverUrl ? { backgroundImage: `url(${matchingBook.coverUrl})` } : undefined}>{!matchingBook?.coverUrl && item.title.replace(/[«»]/g, "").slice(0, 1)}</span><span><small>{item.bookAuthor ?? matchingBook?.author ?? "Автор книги"}</small><strong id="reading-title">{item.title}</strong></span></button> : matchingBook && item.linkedBookId ? <h2 id="reading-title"><button className="reading-book-title-link" type="button" onClick={() => setBookPopup(matchingBook)}>{item.title}</button></h2> : <h2 id="reading-title">{item.title}</h2>}
        <p className="reading-author">{item.ownerId ? <button className="inline-user-link" type="button" onClick={() => onOpenUser?.(item.ownerId!)}>{item.author}</button> : item.author}{item.createdAt ? ` · ${item.createdAt}` : ""}</p>
        {item.preview && <div className="reading-text reading-preview-text">{item.preview}</div>}
        {item.kind === "excerpt" ? (item.bodyHtml ? <div className="reading-text rich-reading-text" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(item.bodyHtml) }} /> : !item.preview && <div className="reading-text">{item.text}</div>) : <div className="reading-text">{item.text}</div>}
        <div className="reading-social-row"><button type="button" className={liked ? "outline-button liked" : "outline-button"} onClick={() => { if (currentUser) setHydratedLikedIds((current) => current.includes(currentUser.id) ? current.filter((id) => id !== currentUser.id) : [...current, currentUser.id]); onToggleLike?.(); }}>{liked ? "♥" : "♡"} Нравится · {effectiveLikedIds.length}</button>{item.ownerId && relationship === "none" && <button type="button" className="outline-button tooltip-button" data-tooltip="При добавлении пользователя в друзья, вы подписываетесь на все его обновления и начинаете переписку. Внимание: Пользователь может не принять ваше предложение дружбы" onClick={() => setRequesting(true)}>Добавить автора в друзья</button>}{item.ownerId && relationship === "outgoing" && <button type="button" className="outline-button" disabled>Предложение отправлено</button>}{item.ownerId && relationship !== "friends" && !isFollowing && <button type="button" className="outline-button tooltip-button" data-tooltip="Вы подписываетесь на все обновления пользователя, но переписываться можно только с друзьями" onClick={onFollow}>Подписаться на автора</button>}</div>
        {requesting && <form className="friend-request-form" onSubmit={(event) => { event.preventDefault(); onAddFriend?.(requestNote); setRequesting(false); }}><textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Напишите пользователю, почему вы хотите добавиться в друзья и начать переписку" /><button className="primary-button" type="submit">Отправить</button></form>}
        {currentUser?.id === item.ownerId && likedUsers.length > 0 && <section className="material-likes"><h3>Нравится · {likedUsers.length}</h3><div>{likedUsers.slice(0, 4).map((user) => <button type="button" key={user.id} onClick={() => onOpenUser?.(user.id)}><span className={`avatar avatar-sm avatar-${user.color}`}>{user.initials}</span><strong>{user.profile.name}</strong></button>)}{likedUsers.length > 4 && <button className="other-likes-button" type="button" onClick={() => setShowAllLikes(true)}>и другие</button>}</div></section>}
        <section className="comments-block"><h3>Комментарии · {comments.length}</h3><form onSubmit={async (event) => { event.preventDefault(); const clean = comment.trim(); if (!clean) return; const saved = await onComment?.(clean); setComments((current) => [...current, saved ?? { id: Date.now(), text: clean, userId: currentUser?.id ?? 0, createdAt: new Date().toISOString() }]); setComment(""); }}><textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Написать комментарий" /><button className="primary-button" type="submit">Отправить</button></form>{comments.slice((page - 1) * 10, page * 10).map((entry) => { const author = users.find((user) => user.id === entry.userId); const canDelete = Boolean(currentUser && (currentUser.isAdmin || currentUser.id === entry.userId)); const canReport = Boolean(currentUser && !currentUser.isAdmin && currentUser.id !== entry.userId); return <article key={entry.id}><div className="comment-actions">{canReport && <button className="comment-report-button" type="button" onClick={() => openReportDialog({ kind: "comment", id: entry.id })} aria-label="Пожаловаться на комментарий" title="Пожаловаться"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 8v6" /><circle cx="12" cy="17" r="1" /></svg></button>}{canDelete && <button className="comment-delete-button" type="button" onClick={() => void deleteComment(entry)} aria-label="Удалить комментарий" title="Удалить комментарий">×</button>}</div><button type="button" onClick={() => entry.userId && onOpenUser?.(entry.userId)}>{author?.profile.name ?? "Пользователь"}</button><small>{formatCommentDate(entry.createdAt)}</small><p>{entry.text}</p></article>; })}{comments.length > 10 && <div className="comment-pages">{Array.from({ length: Math.ceil(comments.length / 10) }, (_, index) => <button className={page === index + 1 ? "active" : ""} type="button" key={index} onClick={() => setPage(index + 1)}>{index + 1}</button>)}</div>}</section>
        {showAllLikes && <div className="nested-modal-backdrop" onMouseDown={() => setShowAllLikes(false)}><section className="likes-list-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setShowAllLikes(false)}>×</button><h2>Кому нравится</h2>{likedUsers.map((user) => <button type="button" key={user.id} onClick={() => onOpenUser?.(user.id)}><span className={`avatar avatar-sm avatar-${user.color}`}>{user.initials}</span><span><strong>{user.profile.name}</strong><small>{user.profile.type} · {user.profile.city}</small></span></button>)}</section></div>}
        {bookPopup && <UnifiedBookModal book={bookPopup} users={users} nested onClose={() => setBookPopup(null)} onOpenUser={onOpenUser} />}
      </article>
    </div>
  );
}

export function FriendProfile({ friend, onClose }: { friend: Friend; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="friend-profile-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Закрыть профиль">×</button>
        <div className="profile-cover" />
        <div className="profile-modal-body">
          <Avatar friend={friend} size="lg" />
          <span className="profile-type">{friend.type}</span>
          <h2 id="friend-profile-title">{friend.name}</h2>
          <p className="profile-location">⌖ {friend.city}</p>
          <p className="profile-bio">{friend.bio}</p>
          <div className="profile-fact"><span>На книжной полке</span><strong>{friend.books}</strong></div>
          <div className="profile-tags"><span>Современная проза</span><span>Книжные клубы</span><span>Прогулки</span></div>
          <button className="primary-button" type="button" onClick={onClose}>Вернуться к переписке</button>
        </div>
      </section>
    </div>
  );
}

function PublicProfileDetails({ user }: { user: DemoUser }) {
  const textField = (label: string, value: string, className?: string) => value.trim() ? <div className={className}><span>{label}</span><p>{value}</p></div> : null;
  const genresField = (label: string, values: string[], disliked = false) => values.length ? <div><span>{label}</span><div className={`profile-tags ${disliked ? "disliked-tags" : ""}`}>{values.map((genre) => <span key={genre}>{genre}</span>)}</div></div> : null;
  if (user.profile.type === "Издатель") return <div className="public-profile-details publisher-public-details">
    {textField("Об издательстве", user.profile.bio, "profile-bio-wide")}
    {user.profile.publisherWebsite && <div><span>Сайт издательства</span><p><a href={user.profile.publisherWebsite} target="_blank" rel="noreferrer">{user.profile.publisherWebsite}</a></p></div>}
    {(user.profile.publisherSalesLinks ?? []).length > 0 && <div><span>Где продаются книги</span><div className="writer-book-links">{user.profile.publisherSalesLinks!.map((link) => <a className="outline-button" href={link.url} target="_blank" rel="noreferrer" key={link.id}>{link.label}</a>)}</div></div>}
  </div>;
  return <div className="public-profile-details">
    {textField("О себе", user.profile.bio, "profile-bio-wide")}
    {user.profile.type === "Писатель" && textField("Книги, повлиявшие на меня, как на автора", user.profile.authorInfluences)}
    {user.profile.type === "Писатель" && textField("О чем мои тексты", user.profile.writingThemes)}
    {textField("Мой идеальный выходной", user.profile.weekend)}
    {textField("Что меня радует в жизни", user.profile.joy)}
    {textField("О чем мне интересно говорить", user.profile.talk)}
    {textField("Послание незнакомому читателю", user.profile.strangerMessage)}
    {genresField("Любимые жанры", user.profile.favoriteGenres)}
    {genresField("Жанры, которые мне не нравятся", user.profile.dislikedGenres, true)}
  </div>;
}

export function UserProfileModal({ user, viewer, users, events = [], likes, friendCount, relationship, incomingMessage, isFollowing, canMessage, blockedByMe = false, onClose, onAddFriend, onCancelFriendRequest, onAccept, onReject, onRemoveFriend, onOpenChat, onFollow, onUnfollow, onUnblock, onReport, onToggleLike, onComment, onOpenUser }: { user: DemoUser; viewer: DemoUser; users: DemoUser[]; events?: BookEvent[]; likes: Record<string, number[]>; friendCount: number; relationship: "none" | "outgoing" | "incoming" | "friends"; incomingMessage?: string; isFollowing: boolean; canMessage: boolean; blockedByMe?: boolean; onClose: () => void; onAddFriend: (message: string) => void; onCancelFriendRequest: () => Promise<void>; onAccept: () => void; onReject: (comment: string) => void; onRemoveFriend: () => void; onOpenChat: () => void; onFollow: () => void; onUnfollow: () => Promise<void>; onUnblock?: () => Promise<void>; onReport?: () => void; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void }) {
  const routedClose = useRoutedPopup(`/users/${user.id}`, "/users", onClose, `${user.profile.name} — Book Meet`);
  const [rejecting, setRejecting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [socialBusy, setSocialBusy] = useState(false);
  const [unblockConfirm, setUnblockConfirm] = useState(false);
  const [comment, setComment] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "author-books" | "excerpts" | "publisher-events" | "publisher-news" | "library" | "wishlist" | "reviews">("main");
  const [openedPublisherEvent, setOpenedPublisherEvent] = useState<BookEvent | null>(null);
  const [openedPublisherNews, setOpenedPublisherNews] = useState<PublisherNews | null>(null);
  const [profileWishBooks, setProfileWishBooks] = useState(user.wishBooks ?? []);
  const [openedBook, setOpenedBook] = useState<LibraryBook | null>(null);
  const [openedAuthorBook, setOpenedAuthorBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [openedReview, setOpenedReview] = useState<ReadingItem | UserReview | null>(null);
  const [bookDetailTab, setBookDetailTab] = useState<"about" | "readers" | "reviews">("about");
  const [libraryStatus, setLibraryStatus] = useState<"want" | "reading" | "read">("read");
  const commonBooks = viewer.books.filter((book) => user.books.some((other) => other.title.toLowerCase() === book.title.toLowerCase() && other.author.toLowerCase() === book.author.toLowerCase()));
  const commonFavoriteGenres = viewer.profile.favoriteGenres.filter((genre) => user.profile.favoriteGenres.includes(genre));
  const commonDislikedGenres = viewer.profile.dislikedGenres.filter((genre) => user.profile.dislikedGenres.includes(genre));
  const hasMatches = commonBooks.length + commonFavoriteGenres.length + commonDislikedGenres.length > 0;
  const openedReadingItem: ReadingItem | null = openedReview ? ("kind" in openedReview ? openedReview : { id: openedReview.id, kind: "review", title: openedReview.bookTitle, author: user.profile.name, text: openedReview.fullText, ownerId: user.id, createdAt: openedReview.createdAt, preview: openedReview.preview, bookAuthor: openedReview.bookAuthor }) : null;

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && routedClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [routedClose]);

  return (
    <div className="modal-backdrop profile-overlay-top" role="presentation" onMouseDown={routedClose}>
      <section className="public-profile-modal" role="dialog" aria-modal="true" aria-labelledby="public-profile-title" onMouseDown={(event) => event.stopPropagation()}>
        <ModalIconActions onReport={onReport} onClose={routedClose} />
        <div className="public-profile-cover" />
        <div className="public-profile-body">
          <div className={`avatar avatar-lg avatar-${user.color} ${user.avatarUrl ? "has-photo" : ""}`} style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}>{!user.avatarUrl && user.initials}{user.online && <span className="online-dot" />}</div>
          <span className="profile-type">{user.profile.type}</span>
          <h2 id="public-profile-title">{user.profile.name}</h2>{user.profile.city && <p className="profile-location">⌖ {user.profile.city}</p>}<p className={`profile-presence ${user.online ? "is-online" : ""}`}>{user.online ? "В сети" : "Не в сети"}</p>
          <div className="public-profile-actions">
            {blockedByMe && <><span className="blocked-profile-label">Вы заблокировали пользователя</span><button className="outline-button" type="button" onClick={() => setUnblockConfirm(true)}>Разблокировать</button></>}
            {!blockedByMe && <>
            {relationship === "incoming" && <><button className="primary-button" type="button" onClick={onAccept}>Начать дружить</button><button className="outline-button" type="button" onClick={() => setRejecting(true)}>Отклонить предложение</button></>}
            {relationship === "outgoing" && <button className="outline-button" type="button" onClick={() => setCancellingRequest(true)}>Предложение отправлено</button>}
            {relationship === "none" && <button className="primary-button tooltip-button" data-tooltip="При добавлении пользователя в друзья, вы подписываетесь на все его обновления и начинаете переписку. Внимание: Пользователь может не принять ваше предложение дружбы" type="button" onClick={() => setRequesting(true)}>Добавить в друзья</button>}
            {relationship === "friends" && <><button className="primary-button" type="button" onClick={onOpenChat}>Написать</button><button className="quiet-danger-button" type="button" onClick={onRemoveFriend}>Перестать дружить</button></>}
            {relationship !== "friends" && canMessage && <button className="primary-button" type="button" onClick={onOpenChat}>{user.isAdmin ? "Написать в поддержку" : "Написать"}</button>}
            {relationship !== "friends" && !isFollowing && <button className="follow-button tooltip-button" data-tooltip="Вы подписываетесь на все обновления пользователя, но переписываться можно только с друзьями" type="button" onClick={onFollow}>Подписаться</button>}
            {relationship !== "friends" && isFollowing && <button className="follow-button" type="button" disabled={socialBusy} onClick={async () => { setSocialBusy(true); try { await onUnfollow(); } finally { setSocialBusy(false); } }}>Отписаться</button>}
            </>}
          </div>
          {unblockConfirm && <div className="nested-modal-backdrop" onMouseDown={() => setUnblockConfirm(false)}><section className="confirm-social-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>Разблокировать пользователя?</h2><div className="form-actions"><button className="outline-button" type="button" onClick={async () => { await onUnblock?.(); setUnblockConfirm(false); }}>Да</button><button className="outline-button" type="button" onClick={() => setUnblockConfirm(false)}>Нет</button></div></section></div>}
          {relationship === "incoming" && incomingMessage && <div className="incoming-friend-message"><span>Сообщение к предложению дружбы</span><p>{incomingMessage}</p></div>}
          {requesting && relationship === "none" && <form className="friend-request-form" onSubmit={(event) => { event.preventDefault(); onAddFriend(requestMessage.trim()); setRequesting(false); }}><textarea autoFocus rows={4} value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} placeholder="Напишите пользователю, почему вы хотите добавиться в друзья и начать переписку" /><button className="primary-button" type="submit">Отправить</button></form>}
          {rejecting && <form className="reject-form" onSubmit={(event) => { event.preventDefault(); onReject(comment); }}><label>Почему вы не хотите дружить?<textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Не обязательно" /></label><div><button type="button" onClick={() => setRejecting(false)}>Отмена</button><button type="submit">Отклонить</button></div></form>}
          {cancellingRequest && <div className="nested-modal-backdrop" onMouseDown={() => setCancellingRequest(false)}><section className="confirm-social-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>Отменить запрос?</h2><div className="form-actions"><button type="button" onClick={async () => { setSocialBusy(true); try { await onCancelFriendRequest(); setCancellingRequest(false); } finally { setSocialBusy(false); } }} disabled={socialBusy}>Да</button><button className="primary-button" type="button" autoFocus onClick={() => setCancellingRequest(false)}>Нет</button></div></section></div>}
          <div className="public-profile-stats"><span><strong>{user.profile.type === "Издатель" ? user.authorBooks?.length ?? 0 : user.books.length}</strong> книг</span><span><strong>{user.profile.type === "Издатель" ? events.filter((item) => item.creatorId === user.id && item.status === "published").length : user.reviews.length}</strong> {user.profile.type === "Издатель" ? "событий" : "рецензий"}</span><span><strong>{friendCount}</strong> друзей</span></div>
          {activeTab === "main" && user.profile.type !== "Издатель" && hasMatches && <section className="interest-matches"><h3>Совпадения по книжным интересам</h3><div className="interest-match-grid"><div title={commonBooks.map((book) => book.title).join(", ")}><strong>{commonBooks.length}</strong><span>общих книг</span></div><div title={commonFavoriteGenres.join(", ")}><strong>{commonFavoriteGenres.length}</strong><span>любимых жанров</span></div><div title={commonDislikedGenres.join(", ")}><strong>{commonDislikedGenres.length}</strong><span>нелюбимых жанров</span></div></div></section>}
          <nav className="public-profile-tabs" aria-label="Профиль пользователя">
            <button className={activeTab === "main" ? "active" : ""} type="button" onClick={() => setActiveTab("main")}>Основное</button>
            {(user.profile.type === "Писатель" || user.profile.type === "Издатель") && <button className={activeTab === "author-books" ? "active" : ""} type="button" onClick={() => setActiveTab("author-books")}>{user.profile.type === "Издатель" ? "Книги издательства" : "Мои книги"} <span>{user.authorBooks?.length ?? 0}</span></button>}
            {(user.profile.type === "Писатель" || user.profile.type === "Блогер") && <button className={activeTab === "excerpts" ? "active" : ""} type="button" onClick={() => setActiveTab("excerpts")}>Мой блог <span>{user.excerpts?.length ?? 0}</span></button>}
            {user.profile.type === "Издатель" && <button className={activeTab === "publisher-events" ? "active" : ""} type="button" onClick={() => setActiveTab("publisher-events")}>События издательства <span>{events.filter((item) => item.creatorId === user.id && item.status === "published").length}</span></button>}
            {user.profile.type === "Издатель" && <button className={activeTab === "publisher-news" ? "active" : ""} type="button" onClick={() => setActiveTab("publisher-news")}>Новости издательства <span>{user.publisherNews?.length ?? 0}</span></button>}
            {user.profile.type !== "Издатель" && <button className={activeTab === "library" ? "active" : ""} type="button" onClick={() => setActiveTab("library")}>Библиотека <span>{user.books.length}</span></button>}
            {relationship === "friends" && (user.profile.type === "Читатель" || user.profile.type === "Блогер") && <button className={activeTab === "wishlist" ? "active" : ""} type="button" onClick={() => setActiveTab("wishlist")}>Хочу почитать! <span>{profileWishBooks.length}</span></button>}
            {user.profile.type !== "Издатель" && <button className={activeTab === "reviews" ? "active" : ""} type="button" onClick={() => setActiveTab("reviews")}>Рецензии <span>{user.reviews.length}</span></button>}
          </nav>
          {activeTab === "main" && <PublicProfileDetails user={user} />}
          {activeTab === "author-books" && <div className="public-books-grid">{(user.authorBooks ?? []).map((book) => <button type="button" className="public-book-card" key={book.id} onClick={() => setOpenedAuthorBook(book)}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><h3>{book.title}</h3><p>{book.author}</p></button>)}</div>}
          {activeTab === "excerpts" && <div className="public-reviews-list">{(user.excerpts ?? []).map((excerpt) => <button type="button" key={excerpt.id} onClick={() => setOpenedReview({ id: excerpt.id, kind: "excerpt", title: excerpt.bookTitle || "Публикация", author: user.profile.name, text: excerpt.text, preview: excerpt.previewText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.bookId, ownerId: user.id, createdAt: excerpt.createdAt })}><span>{excerpt.createdAt}</span><h3>{excerpt.bookTitle || "Публикация"}</h3><p>{excerpt.previewText || excerpt.text.slice(0, 500)}</p><b>Смотреть →</b></button>)}</div>}
          {activeTab === "publisher-events" && <div className="events-grid">{events.filter((item) => item.creatorId === user.id && item.status === "published").map((item) => <EventCard key={item.id} item={item} own={false} onOpen={() => setOpenedPublisherEvent(item)} />)}</div>}
          {activeTab === "publisher-news" && <div className="publisher-news-grid">{(user.publisherNews ?? []).map((item) => <button type="button" key={item.id} onClick={() => setOpenedPublisherNews(item)}><span>{item.createdAt}</span><h3>{item.title}</h3><p>{item.previewText}</p></button>)}</div>}
          {activeTab === "library" && <div className="public-library-view"><div className="library-status-filter public-library-status-filter" role="group" aria-label="Фильтр библиотеки по статусу"><button className={libraryStatus === "want" ? "active" : ""} type="button" onClick={() => setLibraryStatus("want")}>Хочу прочитать</button><button className={libraryStatus === "reading" ? "active" : ""} type="button" onClick={() => setLibraryStatus("reading")}>Читаю</button><button className={libraryStatus === "read" ? "active" : ""} type="button" onClick={() => setLibraryStatus("read")}>Прочитано</button></div><div className="public-books-grid">{user.books.filter((book) => (book.readingStatus ?? "read") === libraryStatus).map((book) => <button type="button" className="public-book-card" key={book.id} onClick={() => setOpenedAuthorBook(book)}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><h3>{book.title}</h3><p>{book.author}</p>{libraryStatus === "read" && <span>★ {book.rating}</span>}</button>)}</div>{!user.books.some((book) => (book.readingStatus ?? "read") === libraryStatus) && <div className="profile-tab-placeholder">В этом разделе пока нет книг.</div>}</div>}
          {activeTab === "wishlist" && relationship === "friends" && <WishlistTab books={profileWishBooks} setBooks={setProfileWishBooks} owner={{ ...user, wishBooks: profileWishBooks }} viewer={viewer} users={users} readOnly />}
          {activeTab === "reviews" && <div className="public-reviews-list">{user.reviews.map((review) => <button type="button" key={review.id} onClick={() => setOpenedReview({ id: review.id, kind: "review", title: review.bookTitle, author: user.profile.name, text: review.fullText, ownerId: user.id, createdAt: review.createdAt, preview: review.preview, bookAuthor: review.bookAuthor })}><span>★ {review.rating} · {review.createdAt}</span><h3>{review.bookTitle}</h3><p>{review.preview}</p><b>Читать →</b></button>)}</div>}
        </div>
        {openedBook && <div className="nested-profile-view"><button className="back-button" type="button" onClick={() => setOpenedBook(null)}>← Вернуться в профиль</button><div className="nested-book-detail"><div className={`library-book-cover library-cover-${openedBook.coverTone}`} style={openedBook.coverUrl ? { backgroundImage: `url(${openedBook.coverUrl})` } : undefined}>{!openedBook.coverUrl && <><em>{openedBook.author}</em><strong>{openedBook.title}</strong><span>Book Meet</span></>}</div><div><span className="section-subtitle">★ {openedBook.rating}</span><h2>{openedBook.title}</h2><p>{openedBook.author}</p><nav className="book-detail-tabs"><button className={bookDetailTab === "about" ? "active" : ""} type="button" onClick={() => setBookDetailTab("about")}>О книге</button><button className={bookDetailTab === "readers" ? "active" : ""} type="button" onClick={() => setBookDetailTab("readers")}>Эту книгу читали</button><button className={bookDetailTab === "reviews" ? "active" : ""} type="button" onClick={() => setBookDetailTab("reviews")}>Рецензии</button></nav>{bookDetailTab === "about" && <><p>{openedBook.annotation}</p><blockquote>«{openedBook.review}»</blockquote></>}{bookDetailTab === "readers" && <div className="book-readers-list">{users.flatMap((reader) => reader.books.filter((book) => book.title.toLowerCase() === openedBook.title.toLowerCase() && book.author.toLowerCase() === openedBook.author.toLowerCase()).map((book) => <article className="book-reader-row" key={`${reader.id}-${book.id}`}><button type="button" onClick={() => { setOpenedBook(null); routedClose(); }} className={`avatar avatar-sm avatar-${reader.color}`}>{reader.initials}</button><div><strong>{reader.profile.name} · ★ {book.rating}</strong>{book.review && <p>«{book.review}»</p>}</div></article>))}</div>}{bookDetailTab === "reviews" && <div className="book-review-results">{users.flatMap((reviewer) => reviewer.reviews.filter((review) => review.bookTitle.toLowerCase() === openedBook.title.toLowerCase() && review.bookAuthor.toLowerCase() === openedBook.author.toLowerCase()).map((review) => <button type="button" key={`${reviewer.id}-${review.id}`} onClick={() => setOpenedReview(review)}><strong>★ {review.rating} · {reviewer.profile.name} · {review.createdAt}</strong><p>{review.preview}</p></button>))}{!users.some((reviewer) => reviewer.reviews.some((review) => review.bookTitle.toLowerCase() === openedBook.title.toLowerCase() && review.bookAuthor.toLowerCase() === openedBook.author.toLowerCase())) && <div><p>Рецензий пока нет</p><button className="primary-button" type="button">Напишите рецензию первым</button></div>}</div>}</div></div></div>}
        {openedReadingItem && <ReadingModal item={openedReadingItem} currentUser={viewer} users={users} likedUserIds={likes[`${openedReadingItem.kind}-${openedReadingItem.id}`] ?? []} onToggleLike={() => onToggleLike(openedReadingItem)} onComment={(text) => onComment(openedReadingItem, text)} onClose={() => setOpenedReview(null)} onReport={!viewer.isAdmin ? () => openReportDialog({ kind: openedReadingItem.kind, id: openedReadingItem.id }) : undefined} onOpenUser={onOpenUser} relationship={relationship} isFollowing={isFollowing} onAddFriend={onAddFriend} onFollow={onFollow} onEdit={viewer.isAdmin ? () => void editReadingMaterial(openedReadingItem, viewer) : undefined} onDelete={viewer.isAdmin ? () => void deleteReadingMaterial(openedReadingItem, viewer) : undefined} />}
        {openedAuthorBook && <UnifiedBookModal book={openedAuthorBook} users={users} nested onClose={() => setOpenedAuthorBook(null)} onReport={!viewer.isAdmin ? () => openReportDialog({ kind: "book", id: openedAuthorBook.id }) : undefined} />}
        {openedPublisherEvent && <EventModal item={openedPublisherEvent} onClose={() => setOpenedPublisherEvent(null)} onReport={!viewer.isAdmin ? () => openReportDialog({ kind: "event", id: openedPublisherEvent.id }) : undefined} />}
        {openedPublisherNews && <div className="nested-modal-backdrop" onMouseDown={() => setOpenedPublisherNews(null)}><section className="reading-modal publisher-news-modal" onMouseDown={(event) => event.stopPropagation()}><ModalIconActions onReport={!viewer.isAdmin ? () => openReportDialog({ kind: "publisher_news", id: openedPublisherNews.id }) : undefined} onClose={() => setOpenedPublisherNews(null)} /><span className="section-subtitle">Новости издательства · {openedPublisherNews.createdAt}</span><h2>{openedPublisherNews.title}</h2><p className="reading-preview">{openedPublisherNews.previewText}</p><div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(openedPublisherNews.bodyHtml) }} /></section></div>}
      </section>
    </div>
  );
}

export function UnifiedBookModal({ book: sourceBook, users, onClose, onOpenUser, onOpenReview, onEdit, onDelete, onReport, nested = false }: { book: LibraryBook | AuthorBook; users: DemoUser[]; onClose: () => void; onOpenUser?: (userId: number) => void; onOpenReview?: (review: UserReview, user: DemoUser) => void; onEdit?: () => void; onDelete?: () => void; onReport?: () => void; nested?: boolean }) {
  const book = resolveCanonicalBook(sourceBook, users);
  const routedClose = useRoutedPopup(`/books/${book.id}`, "/", onClose, `${book.title} — Book Meet`);
  const [tab, setTab] = useState<"about" | "readers" | "reviews" | "wishers">("about");
  const [warningLink, setWarningLink] = useState<BookLink | null>(null);
  const [openedReview, setOpenedReview] = useState<{ review: UserReview; reviewer: DemoUser } | null>(null);
  const isLibraryBook = "rating" in book;
  const sameBook = (title: string, author: string) => title.toLowerCase() === book.title.toLowerCase() && author.toLowerCase() === book.author.toLowerCase();
  const readers = users.flatMap((reader) => reader.books.filter((item) => sameBook(item.title, item.author) && (item.readingStatus ?? "read") !== "want").map((item) => ({ reader, item })));
  const bookReviews = users.flatMap((reviewer) => reviewer.reviews.filter((review) => sameBook(review.bookTitle, review.bookAuthor)).map((review) => ({ reviewer, review })));
  const wishers = users.filter((user) => user.books.some((item) => sameBook(item.title, item.author) && item.readingStatus === "want") || (user.wishBooks ?? []).some((item) => item.catalogBookId === book.id || sameBook(item.title, item.author)));
  return (
    <div className={nested ? "nested-modal-backdrop" : "modal-backdrop"} onMouseDown={routedClose}>
      <section className="unified-book-modal" onMouseDown={(event) => event.stopPropagation()}>
        <ModalIconActions onEdit={onEdit} onDelete={onDelete} onReport={onReport} onClose={routedClose} />
        <div className="unified-book-layout">
          <div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div>
          <div className="unified-book-copy">
            <span className="section-subtitle">{"links" in book ? "Книга писателя" : "Карточка книги"}</span><h2>{book.title}</h2><p className="library-author">{book.author}</p>
            <div className="profile-tags">{book.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>
            <nav className="book-detail-tabs">
              <button className={tab === "about" ? "active" : ""} type="button" onClick={() => setTab("about")}>О книге</button>
              <button className={tab === "readers" ? "active" : ""} type="button" onClick={() => setTab("readers")}>Эту книгу читали</button>
              <button className={tab === "reviews" ? "active" : ""} type="button" onClick={() => setTab("reviews")}>Рецензии</button>
              <button className={tab === "wishers" ? "active" : ""} type="button" onClick={() => setTab("wishers")}>Хотят почитать</button>
            </nav>
            {tab === "about" && <div className="unified-book-section">{(book.isbn || book.publisher) && <dl className="book-edition-details">{book.isbn && <><dt>ISBN</dt><dd>{book.isbn}</dd></>}{book.publisher && <><dt>Издательство</dt><dd>{book.publisher}</dd></>}</dl>}<p>{book.annotation || "Аннотация пока не добавлена."}</p>{isLibraryBook && <><strong>★ {book.rating}</strong><blockquote>«{book.review}»</blockquote></>}{book.flipUrl && <div className="writer-book-links"><button type="button" onClick={() => setWarningLink({ id: -1, label: "Flip", url: book.flipUrl!, action: "Купить" })}>Купить на Flip</button></div>}{(book.links ?? []).filter((link) => link.url !== book.flipUrl).length > 0 && <div className="writer-book-links">{(book.links ?? []).filter((link) => link.url !== book.flipUrl).map((link) => <button type="button" key={link.id} onClick={() => setWarningLink(link)}>{link.action} · {link.label}</button>)}</div>}</div>}
            {tab === "readers" && <div className="book-readers-list">{readers.length ? readers.map(({ reader, item }) => <article className="book-reader-row" key={`${reader.id}-${item.id}`}><button type="button" className={`avatar avatar-sm avatar-${reader.color}`} onClick={() => onOpenUser?.(reader.id)}>{reader.initials}</button><div><button className="inline-user-link" type="button" onClick={() => onOpenUser?.(reader.id)}>{reader.profile.name}</button>{(item.readingStatus ?? "read") === "read" && item.rating > 0 && <strong> · ★ {item.rating}</strong>}<small className="book-reader-status">{item.readingStatus === "reading" ? "Читает сейчас" : "Прочитано"}</small>{item.review && <p>«{item.review}»</p>}</div></article>) : <p>Пока никто не читает и не прочитал эту книгу.</p>}</div>}
            {tab === "reviews" && <div className="book-review-results">{bookReviews.length ? bookReviews.map(({ reviewer, review }) => <button type="button" key={`${reviewer.id}-${review.id}`} onClick={() => onOpenReview ? onOpenReview(review, reviewer) : setOpenedReview({ review, reviewer })}><strong>★ {review.rating} · {review.createdAt}</strong><p>{review.preview}</p><span className="inline-user-link">{reviewer.profile.name}</span></button>) : <div><p>Рецензий пока нет</p><button className="primary-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("bookmeet:create-review"))}>Напишите рецензию первым</button></div>}</div>}
            {tab === "wishers" && <div className="book-readers-list">{wishers.length ? wishers.map((user) => <article className="book-reader-row" key={user.id}><button type="button" className={`avatar avatar-sm avatar-${user.color}`} onClick={() => onOpenUser?.(user.id)}>{user.initials}</button><div><button className="inline-user-link" type="button" onClick={() => onOpenUser?.(user.id)}>{user.profile.name}</button><p>{user.profile.type} · {user.profile.city}</p></div></article>) : <p>Пока никто не добавил эту книгу в список «Хочу почитать!».</p>}</div>}
          </div>
        </div>
        {warningLink && <div className="nested-modal-backdrop" onMouseDown={() => setWarningLink(null)}><section className="external-warning" onMouseDown={(event) => event.stopPropagation()}><h2>Вы переходите на другой сайт</h2><p>{warningLink.url}</p><div className="form-actions"><button type="button" onClick={() => setWarningLink(null)}>Отмена</button><button className="primary-button" type="button" onClick={() => window.open(warningLink.url, "_blank", "noopener,noreferrer")}>Перейти</button></div></section></div>}
        {openedReview && <ReadingModal item={{ id: openedReview.review.id, kind: "review", title: openedReview.review.bookTitle, author: openedReview.reviewer.profile.name, text: openedReview.review.fullText, ownerId: openedReview.reviewer.id, createdAt: openedReview.review.createdAt, preview: openedReview.review.preview, bookAuthor: openedReview.review.bookAuthor }} users={users} onOpenUser={onOpenUser} onClose={() => setOpenedReview(null)} />}
      </section>
    </div>
  );
}

export function BookMatchSuggestions({ books, queryAuthor, queryTitle, queryIsbn = "", onSelect }: { books: (LibraryBook | AuthorBook)[]; queryAuthor: string; queryTitle: string; queryIsbn?: string; onSelect: (book: LibraryBook | AuthorBook) => void }) {
  const author = queryAuthor.trim().toLowerCase(); const title = queryTitle.trim().toLowerCase();
  const isbn = queryIsbn.replace(/\D/g, "");
  const matches = books.filter((book) => (isbn.length >= 6 && book.isbn?.replace(/\D/g, "").includes(isbn)) || (author.length >= 2 && book.author.toLowerCase().includes(author)) || (title.length >= 2 && book.title.toLowerCase().includes(title))).slice(0, 4);
  if (!matches.length) return null;
  return <div className="book-match-suggestions"><strong>Вы хотите добавить эту книгу?</strong>{matches.map((book) => <button type="button" key={`${book.author}-${book.title}`} onClick={() => onSelect(book)}><div className={`match-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <span>{book.title.slice(0, 1)}</span>}</div><span><b>{book.title}</b><small>{book.author}</small></span></button>)}</div>;
}

export function RatingStars({ value, onChange, label = "Оценка", allowHalf = false }: { value: number; onChange: (rating: number) => void; label?: string; allowHalf?: boolean }) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const shownValue = hoverValue ?? value;
  return (
    <div className="rating-stars" role="group" aria-label={`${label}: ${value || "не выбрана"} из 5`} onMouseLeave={() => setHoverValue(null)}>
      {[1, 2, 3, 4, 5].map((star) => {
        const halfValue = star - 0.5;
        const fill = Math.max(0, Math.min(1, shownValue - star + 1));
        return <span className="rating-star-control" key={star}>
          <svg className="rating-star-base" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 1.7 15.2 8l7 .95-5.1 4.9 1.25 6.95L12 17.5l-6.35 3.3 1.25-6.95-5.1-4.9 7-.95L12 1.7Z" /></svg>
          <svg className="rating-star-fill" aria-hidden="true" viewBox="0 0 24 24" style={{ clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` }}><path d="M12 1.7 15.2 8l7 .95-5.1 4.9 1.25 6.95L12 17.5l-6.35 3.3 1.25-6.95-5.1-4.9 7-.95L12 1.7Z" /></svg>
          {allowHalf && <button className="rating-star-hit rating-star-hit-left" type="button" aria-label={`Поставить оценку ${halfValue.toLocaleString("ru-RU")}`} onMouseEnter={() => setHoverValue(halfValue)} onMouseMove={() => setHoverValue(halfValue)} onFocus={() => setHoverValue(halfValue)} onBlur={() => setHoverValue(null)} onClick={() => onChange(halfValue)} />}
          <button className={`rating-star-hit ${allowHalf ? "rating-star-hit-right" : "rating-star-hit-full"}`} type="button" aria-label={`Поставить оценку ${star}`} onMouseEnter={() => setHoverValue(star)} onMouseMove={() => setHoverValue(star)} onFocus={() => setHoverValue(star)} onBlur={() => setHoverValue(null)} onClick={() => onChange(star)} />
        </span>;
      })}
      {value > 0 && <output aria-live="polite">{value.toLocaleString("ru-RU", { minimumFractionDigits: value % 1 ? 1 : 0 })}</output>}
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
  if (!link.label.trim()) return "Заполните название и ссылку";
  try {
    const host = new URL(link.url).hostname.toLowerCase().replace(/^www\./, "");
    if ((link.action ?? "Купить") === "Купить" && !["flip.kz", "meloman.kz", "marwin.kz"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return "Для покупки поддерживаются только Flip и Marwin/Меломан";
    if ((link.action === "Читать" || link.action === "Слушать") && !(host === "books.yandex.kz" || host.endsWith(".books.yandex.kz"))) return "Для чтения и прослушивания поддерживаются только Яндекс.Книги";
    return "";
  } catch {
    return "Введите корректную ссылку";
  }
}

function BookLinksEditor({ links, onChange, restricted = false, lockedUrls = [] }: { links: BookLink[]; onChange: (links: BookLink[]) => void; restricted?: boolean; lockedUrls?: string[] }) {
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
  return <div className="writer-links-editor"><span className="field-label">Где купить, читать или слушать</span>{restricted && <small className="book-link-hint">Купить — Flip или Marwin/Меломан. Читать и слушать — Яндекс.Книги.</small>}{links.map((link, index) => {
    const error = restricted ? libraryLinkError(link) : "";
    const locked = Boolean(link.url && lockedUrls.includes(link.url));
    const action: NonNullable<BookLink["action"]> = link.action ?? "Купить";
    return <div className={`writer-link-row ${error ? "has-error" : ""} ${locked ? "is-locked" : ""}`} key={link.id}><label>Действие<CustomSelect disabled={locked} ariaLabel="Действие" value={action} onChange={(nextAction) => restricted ? updateRestrictedAction(link, nextAction) : updateLink(link.id, { action: nextAction })} options={["Купить", "Читать", "Слушать"].map((item) => ({ value: item as NonNullable<BookLink["action"]>, label: item }))} /></label><label>Магазин или портал{restricted && action === "Купить" ? <CustomSelect disabled={locked} ariaLabel="Магазин или портал" value={["Flip", "Marwin/Меломан"].includes(link.label) ? link.label : "Flip"} onChange={(label) => updateLink(link.id, { label })} options={["Flip", "Marwin/Меломан"].map((item) => ({ value: item, label: item }))} /> : <input readOnly={locked || restricted} value={restricted ? "Яндекс.Книги" : link.label} onChange={(event) => updateLink(link.id, { label: event.target.value })} placeholder={restricted ? undefined : ((link.action ?? "Купить") === "Купить" ? "Например, Flip или Marwin/Меломан" : "Например, Яндекс.Книги")} />}</label><label>Ссылка<input readOnly={locked} type="url" value={link.url} onChange={(event) => { const url = event.target.value; const detectedStore = restricted && action === "Купить" ? purchaseStoreFromUrl(url) : ""; updateLink(link.id, { url, ...(restricted ? { label: action === "Купить" ? (detectedStore || (["Flip", "Marwin/Меломан"].includes(link.label) ? link.label : "Flip")) : "Яндекс.Книги" } : {}) }); }} placeholder={restricted ? undefined : "https://"} />{error && <small className="form-error">{error}</small>}</label>{index > 0 && !locked && <button type="button" aria-label="Удалить ссылку" onClick={() => onChange(links.filter((item) => item.id !== link.id))}>×</button>}</div>;
  })}{links.length < 3 && <button className="add-link-button" type="button" onClick={() => onChange([...links, { id: Date.now(), label: restricted ? "Flip" : "", url: "", action: "Купить" }])}>＋ Добавить ещё одну ссылку</button>}</div>;
}

export function BookAutofillField({ value, onChange, onProduct, hidePlaceholder = false }: { value: string; onChange: (value: string) => void; onProduct: (product: MarketplaceProductPreview) => void; hidePlaceholder?: boolean }) {
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
        if (!response.ok || !data.product) throw new Error(data.error ?? "Не удалось получить данные книги");
        onProduct(data.product);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось получить данные книги");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 550);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value]);
  return <div className="flip-autofill-block"><p>Вставьте ссылку на книгу на Flip, Marwin/Меломан или Яндекс.Книгах — данные заполнятся автоматически</p><label>Ссылка на книгу<input type="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder={hidePlaceholder ? undefined : "https://www.flip.kz/… · https://www.meloman.kz/… · https://books.yandex.kz/…"} /></label>{loading && <small>Получаем данные книги…</small>}{error && <small className="form-error">{error}</small>}</div>;
}

export function WishBookEditor({ ownerId, onClose, onSaved }: { ownerId: number; onClose: () => void; onSaved: (item: WishBook) => void }) {
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
        if (!response.ok || !data.product) throw new Error(data.error ?? "Не удалось получить карточку книги");
        setPreview(data.product);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось получить карточку книги"); }
      finally { if (!controller.signal.aborted) setPreviewLoading(false); }
    }, 550);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.productUrl]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (!preview) throw new Error("Сначала дождитесь загрузки данных книги с Flip");
      const response = await fetch("/api/wishlist", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json() as { item?: WishBook; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error ?? "Не удалось добавить книгу");
      onSaved({ ...data.item, ownerId });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось добавить книгу"); }
    finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="book-editor wishlist-editor" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose}>×</button><div className="book-editor-heading"><span className="section-subtitle">Хочу почитать!</span><h2>Добавить книгу в список желаемого</h2><p>Добавьте ссылку на книгу с Flip — название, автор, аннотация, обложка и актуальная цена заполнятся автоматически.</p></div><form className="wishlist-gift-form" onSubmit={submit}><div className="wishlist-private-fields"><span className="field-label">Данные для подарка</span><p>Эти данные увидят только ваши друзья. Сама ссылка скрыта: друг увидит актуальную цену и перейдёт на Flip кнопкой «Подарить».</p><label>Ссылка на Flip *<input type="url" required value={form.productUrl} onChange={(event) => setForm({ ...form, productUrl: event.target.value })} placeholder="https://www.flip.kz/catalog?prod=…" /></label>{previewLoading && <div className="flip-preview-loading">Получаем данные книги с Flip…</div>}{preview && <article className="flip-product-preview"><div className="flip-preview-cover" style={preview.coverUrl ? { backgroundImage: `url(${preview.coverUrl})` } : undefined}>{!preview.coverUrl && preview.title.slice(0, 1)}</div><div><span>Найдено на Flip</span><h3>{preview.title}</h3><strong>{preview.author}</strong><p>{preview.annotation || "Аннотация не указана."}</p><b>{preview.price ? `${preview.price.toLocaleString("ru-RU")} ${preview.currency === "KZT" ? "₸" : preview.currency}` : "Цена временно недоступна"}</b></div></article>}<label>Адрес пункта выдачи *<textarea required rows={2} value={form.pickupAddress} onChange={(event) => setForm({ ...form, pickupAddress: event.target.value })} placeholder="Город, улица и номер пункта выдачи Flip" /></label><label>Имя получателя *<input required value={form.recipientName} onChange={(event) => setForm({ ...form, recipientName: event.target.value })} placeholder="Как указать получателя при оформлении" /></label><label>Телефон получателя *<input type="tel" inputMode="tel" autoComplete="tel" required value={form.phone} onFocus={() => !form.phone && setForm({ ...form, phone: "+7" })} onChange={(event) => setForm({ ...form, phone: formatKazakhstanPhone(event.target.value) })} placeholder="+7 (___) ___-__-__" /></label></div>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" onClick={onClose}>Отмена</button><button className="primary-button" type="submit" disabled={saving || previewLoading || !preview}>{saving ? "Добавляем…" : "Добавить"}</button></div></form></section></div>;
}

export function WishBookModal({ item, owner, viewer, users, onClose, onChanged, onDeleted }: { item: WishBook; owner: DemoUser; viewer: DemoUser; users: DemoUser[]; onClose: () => void; onChanged: (item: WishBook) => void; onDeleted?: (id: number) => void }) {
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
    try { const response = await fetch(`/api/wishlist/${current.id}/reserve`, { method: "POST", credentials: "same-origin" }); const data = await response.json() as { checkoutUrl?: string; reservedByUserId?: number; error?: string }; if (!response.ok || !data.checkoutUrl) throw new Error(data.error ?? "Не удалось забронировать подарок"); const next = { ...current, reservedByUserId: data.reservedByUserId, reservedAt: new Date().toISOString() }; setCurrent(next); onChanged(next); if (nextWindow) { nextWindow.opener = null; nextWindow.location.href = data.checkoutUrl; } } catch (error) { nextWindow?.close(); window.alert(error instanceof Error ? error.message : "Не удалось забронировать подарок"); } finally { setWorking(false); }
  }
  async function unlock() { const response = await fetch(`/api/wishlist/${current.id}/reservation`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) return; const next = { ...current, reservedByUserId: undefined, reservedAt: undefined }; setCurrent(next); onChanged(next); }
  async function remove() { if (!window.confirm("Удалить книгу из списка «Хочу почитать!»?")) return; const response = await fetch(`/api/wishlist/${current.id}`, { method: "DELETE", credentials: "same-origin" }); if (response.ok) { onDeleted?.(current.id); onClose(); } }
  return <div className="nested-modal-backdrop" onMouseDown={onClose}><section className="wishlist-book-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose}>×</button><div className={`library-book-cover library-cover-${current.coverTone}`} style={current.coverUrl ? { backgroundImage: `url(${current.coverUrl})` } : undefined}>{!current.coverUrl && <><em>{current.author}</em><strong>{current.title}</strong><span>Book Meet</span></>}</div><div><span className="section-subtitle">Хочу почитать! · {current.marketplace}</span><h2>{current.title}</h2><p className="library-author">{current.author}</p><p>{current.annotation || "Аннотация пока не добавлена."}</p>{current.privateVisible && <div className="wishlist-delivery"><div><span>Актуальная стоимость</span><strong>{current.price ? `${current.price.toLocaleString("ru-RU")} ${current.priceCurrency === "KZT" ? "₸" : current.priceCurrency}` : "Цена временно недоступна"}</strong></div><div><span>Получатель</span><strong>{current.recipientName}</strong></div><div><span>Пункт выдачи</span><strong>{current.pickupAddress}</strong></div><div><span>Телефон получателя</span><strong>{current.phone}</strong></div></div>}{current.reservedByUserId && <p className="wishlist-reserved-note">Подарок забронировал(а): <strong>{reserver?.profile.name ?? "друг"}</strong></p>}<div className="form-actions">{isOwner ? <><button className="quiet-danger-button" type="button" onClick={remove}>Удалить карточку</button>{current.reservedByUserId && <button className="outline-button" type="button" onClick={unlock}>Снять бронирование</button>}</> : current.reservedByUserId && current.reservedByUserId !== viewer.id ? <button className="outline-button" type="button" disabled>Забронировано</button> : <button className="primary-button" type="button" disabled={working} onClick={reserve}>{current.reservedByUserId === viewer.id ? "Перейти к покупке" : "Подарить"}</button>}</div></div></section></div>;
}

export function WishlistTab({ books, setBooks, owner, viewer, users, readOnly = false }: { books: WishBook[]; setBooks: React.Dispatch<React.SetStateAction<WishBook[]>>; owner: DemoUser; viewer: DemoUser; users: DemoUser[]; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false); const [opened, setOpened] = useState<WishBook | null>(null);
  function update(item: WishBook) { setBooks((current) => current.map((entry) => entry.id === item.id ? item : entry)); setOpened(item); }
  return <div className="library-tab wishlist-tab"><div className="profile-title-row library-title-row"><div><h1>Хочу почитать!</h1><p>Этот раздел видят только ваши друзья.</p></div>{!readOnly && <button className="primary-button" type="button" onClick={() => setEditing(true)}>＋ Добавить книгу</button>}</div><div className="library-grid">{books.map((book) => { const blocked = Boolean(book.reservedByUserId && book.reservedByUserId !== viewer.id && owner.id !== viewer.id); return <article className={`library-book wishlist-card ${blocked ? "reserved" : ""}`} key={book.id}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div className="library-book-copy"><span className="book-format">{book.marketplace}</span><h3>{book.title}</h3><p>{book.author}</p><button className={blocked ? "outline-button" : "primary-button"} type="button" disabled={blocked} onClick={() => setOpened(book)}>{blocked ? "Забронировано" : "Открыть"}</button></div></article>; })}</div>{!books.length && <div className="profile-tab-placeholder">В списке пока нет книг.</div>}{editing && <WishBookEditor ownerId={owner.id} onClose={() => setEditing(false)} onSaved={(item) => { setBooks((current) => [item, ...current]); setEditing(false); }} />}{opened && <WishBookModal item={opened} owner={owner} viewer={viewer} users={users} onClose={() => setOpened(null)} onChanged={update} onDeleted={(id) => setBooks((current) => current.filter((item) => item.id !== id))} />}</div>;
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
        {value.map((genre) => <span className="genre-chip" key={genre}>{genre}<button type="button" onClick={() => onChange(value.filter((item) => item !== genre))} aria-label={`Удалить жанр ${genre}`}>×</button></span>)}
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder={value.length ? "Найти ещё жанр" : "Начните вводить жанр"} />
      </div>
      {query.trim() && matches.length > 0 && <div className="genre-suggestions">{matches.map((genre) => <button type="button" key={genre} onClick={() => addGenre(genre)}>{genre}</button>)}</div>}
    </div>
  );
}

export const readingMonths = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const readingMonthsPrepositional = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
export function booksWord(count: number) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "книг";
  if (count % 10 === 1) return "книга";
  if (count % 10 >= 2 && count % 10 <= 4) return "книги";
  return "книг";
}

export function BookEditor({ book, catalog, onClose, onSave }: { book: LibraryBook | null; catalog: (LibraryBook | AuthorBook)[]; onClose: () => void; onSave: (book: LibraryBook) => void }) {
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
    onSave({ ...form, links: (form.links ?? []).filter((link) => link.label.trim() && link.url.trim()) });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="book-editor" role="dialog" aria-modal="true" aria-labelledby="book-editor-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="book-editor-heading"><span className="section-subtitle">Моя библиотека</span><h2 id="book-editor-title">{book ? "Редактировать книгу" : "Добавить книгу"}</h2><p>Поля со звёздочкой обязательны.</p></div>
        <form className="book-form" onSubmit={submit}>
          <div className="cover-upload-column">
            <div className={`editable-book-cover library-cover-${form.coverTone}`} style={form.coverUrl ? { backgroundImage: `url(${form.coverUrl})` } : undefined}>
              {!form.coverUrl && <><em>{form.author || "Автор книги"}</em><strong>{form.title || "Название книги"}</strong><span>Book Meet</span></>}
            </div>
            <label className={`cover-upload-button ${coverLocked ? "is-disabled" : ""}`}>{coverLocked ? "Обложка книги уже сохранена" : "Загрузить обложку"}<input type="file" accept="image/*" disabled={coverLocked} onChange={uploadCover} /></label>
          </div>
          <div className="book-fields">
            <div className="book-reading-status library-editor-status" role="group" aria-label="Статус книги в библиотеке"><button className={(form.readingStatus ?? "read") === "want" ? "active" : ""} type="button" onClick={() => { setForm((current) => ({ ...current, readingStatus: "want", rating: 0, review: "", readMonth: undefined, readYear: undefined })); setRatingError(false); }}>Хочу прочитать</button><button className={form.readingStatus === "reading" ? "active" : ""} type="button" onClick={() => { setForm((current) => ({ ...current, readingStatus: "reading", rating: 0, review: "", readMonth: undefined, readYear: undefined })); setRatingError(false); }}>Читаю</button><button className={(form.readingStatus ?? "read") === "read" ? "active" : ""} type="button" onClick={() => setForm((current) => ({ ...current, readingStatus: "read" }))}>Прочитано</button></div>
            <BookAutofillField hidePlaceholder value={autofillUrl} onChange={(value) => { setAutofillUrl(value); if (!value.trim()) setSourceFieldsLocked(false); }} onProduct={(product) => {
              const match = catalog.find((item) => item.id === product.catalogBookId)
                ?? catalog.find((item) => product.isbn && item.isbn?.replace(/\D/g, "") === product.isbn.replace(/\D/g, ""))
                ?? catalog.find((item) => normalizeBookKey(item.title) === normalizeBookKey(product.title) && normalizeBookKey(item.author) === normalizeBookKey(product.author));
              if (match) setSelectedCatalogId(match.id);
              setSourceFieldsLocked(true);
              setForm((current) => ({ ...current, id: match?.id ?? product.catalogBookId ?? current.id, catalogBookId: match?.id ?? product.catalogBookId, author: match?.author || product.author, title: match?.title || product.title, isbn: match?.isbn || product.isbn, publisher: match?.publisher || product.publisher, annotation: match?.annotation || product.annotation, coverUrl: match?.coverUrl || product.coverUrl || current.coverUrl, coverTone: match?.coverTone ?? current.coverTone, genres: match?.genres ?? current.genres, flipUrl: product.marketplace === "Flip" ? product.productUrl : (match?.flipUrl ?? current.flipUrl), links: upsertSourceLink(match?.links ?? current.links, product) }));
            }} />
            <p className="book-manual-divider">или заполните данные вручную</p>
            <div className="book-identity-block">
              <div className="form-row">
                <label>Автор *<input required readOnly={fieldLocked(selectedCatalogBook?.author, form.author)} value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} /></label>
                <label>Название книги *<input required readOnly={fieldLocked(selectedCatalogBook?.title, form.title)} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              </div>
              <div className="form-row">
                <label>ISBN<input inputMode="numeric" pattern="[0-9]{10}|[0-9]{13}" maxLength={13} readOnly={fieldLocked(selectedCatalogBook?.isbn, form.isbn)} value={form.isbn ?? ""} onChange={(event) => setForm({ ...form, isbn: event.target.value.replace(/\D/g, "").slice(0, 13) })} /></label>
                <label>Издательство<input readOnly={fieldLocked(selectedCatalogBook?.publisher, form.publisher)} value={form.publisher ?? ""} onChange={(event) => setForm({ ...form, publisher: event.target.value })} /></label>
              </div>
              <BookMatchSuggestions books={catalog} queryAuthor={form.author} queryTitle={form.title} queryIsbn={form.isbn} onSelect={(match) => { setSelectedCatalogId(match.id); setAutofillUrl(match.flipUrl ?? ""); setForm((current) => ({ ...current, id: match.id, catalogBookId: match.id, author: match.author, title: match.title, isbn: match.isbn, publisher: match.publisher, genres: [...match.genres], annotation: match.annotation, coverUrl: match.coverUrl, coverTone: match.coverTone, flipUrl: match.flipUrl, links: match.links?.length ? match.links.map((link) => ({ ...link, id: Date.now() + link.id })) : current.links })); }} />
              <label>Аннотация<textarea rows={3} readOnly={fieldLocked(selectedCatalogBook?.annotation, form.annotation)} value={form.annotation} onChange={(event) => setForm({ ...form, annotation: event.target.value })} /></label>
            </div>
            {(form.readingStatus ?? "read") === "read" && <div className="library-reading-details">
              <div className="book-rating-field"><span>Оценка *</span><RatingStars allowHalf value={form.rating} onChange={(rating) => { setForm({ ...form, rating }); setRatingError(false); }} />{ratingError && <small>Поставьте оценку книге</small>}</div>
              <label>Краткий отзыв *<textarea required rows={4} value={form.review} onChange={(event) => setForm({ ...form, review: event.target.value })} /></label>
              <fieldset className="reading-date-field">
                <legend>Дата прочтения</legend>
                <label>Месяц<CustomSelect ariaLabel="Месяц прочтения" value={form.readMonth ?? 0} onChange={(readMonth) => setForm({ ...form, readMonth: readMonth || undefined })} options={[{ value: 0, label: "Не указан" }, ...readingMonths.map((month, index) => ({ value: index + 1, label: month }))]} /></label>
                <label>Год<CustomSelect ariaLabel="Год прочтения" value={form.readYear ?? 0} onChange={(readYear) => setForm({ ...form, readYear: readYear || undefined })} options={[{ value: 0, label: "Не указан" }, ...Array.from({ length: 80 }, (_, index) => new Date().getFullYear() - index).map((year) => ({ value: year, label: String(year) }))]} /></label>
              </fieldset>
            </div>}
            <div className="library-links-section">
              <BookLinksEditor links={form.links ?? []} lockedUrls={lockedLinkUrls} restricted onChange={(links) => { setForm((current) => ({ ...current, links })); setLinksError(false); }} />
              {linksError && <p className="form-error">Проверьте ссылки в блоке «Где купить, читать или слушать»</p>}
            </div>
            <div className="form-actions"><button type="button" onClick={onClose}>Отмена</button><button className="primary-button creation-action-button" type="submit">Сохранить книгу</button></div>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ReadingStatsModal({ books, onClose }: { books: LibraryBook[]; onClose: () => void }) {
  const currentYear = new Date().getFullYear();
  const availableYears = Array.from(new Set([currentYear, ...books.map((book) => book.readYear).filter((year): year is number => Boolean(year))])).sort((a, b) => b - a);
  const [year, setYear] = useState(currentYear);
  const counts = readingMonths.map((_, index) => books.filter((book) => book.readYear === year && book.readMonth === index + 1).length);
  const maxCount = Math.max(1, ...counts);
  const chartLeft = 54;
  const chartTop = 20;
  const chartHeight = 220;
  const chartWidth = 660;
  const slot = chartWidth / 12;
  const tickCount = Math.min(5, maxCount + 1);
  const ticks = Array.from({ length: tickCount }, (_, index) => Math.round(index * maxCount / Math.max(1, tickCount - 1))).filter((value, index, list) => list.indexOf(value) === index);

  return <div className="nested-modal-backdrop" onMouseDown={onClose}><section className="reading-stats-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" type="button" onClick={onClose} aria-label="Закрыть">×</button>
    <div className="reading-stats-heading"><div><span className="section-subtitle">Моя библиотека</span><h2>Статистика чтения</h2><p>Количество прочитанных книг по месяцам.</p></div><label>Год<CustomSelect ariaLabel="Год статистики" value={year} onChange={setYear} options={availableYears.map((item) => ({ value: item, label: String(item) }))} /></label></div>
    <div className="reading-chart-shell">
      <svg className="reading-stats-chart" viewBox="0 0 750 290" role="img" aria-label={`Прочитанные книги за ${year} год`}>
        {ticks.map((tick) => { const y = chartTop + chartHeight - (tick / maxCount) * chartHeight; return <g key={tick}><line x1={chartLeft} x2={chartLeft + chartWidth} y1={y} y2={y} className="chart-grid-line" /><text x={chartLeft - 14} y={y + 4} textAnchor="end" className="chart-y-label">{tick}</text></g>; })}
        {counts.map((count, index) => {
          const height = count ? Math.max(8, (count / maxCount) * chartHeight) : 3;
          const x = chartLeft + index * slot + 8;
          const y = chartTop + chartHeight - height;
          return <g key={readingMonths[index]}><rect className={`chart-bar ${count ? "has-value" : ""}`} x={x} y={y} width={slot - 16} height={height} rx="7"><title>{readingMonths[index]}: {count} книг</title></rect>{count > 0 && <text x={x + (slot - 16) / 2} y={y - 8} textAnchor="middle" className="chart-value">{count}</text>}<text x={x + (slot - 16) / 2} y={chartTop + chartHeight + 24} textAnchor="middle" className="chart-month-label">{readingMonths[index].slice(0, 3)}</text></g>;
        })}
      </svg>
    </div>
  </section></div>;
}

export function LibraryTab({ books, setBooks, userId, users, initialAdd = false }: { books: LibraryBook[]; setBooks: React.Dispatch<React.SetStateAction<LibraryBook[]>>; userId: number; users: DemoUser[]; initialAdd?: boolean }) {
  const [view, setView] = useState<LibraryView>("grid");
  const [statusFilter, setStatusFilter] = useState<"want" | "reading" | "read">("read");
  const [editingBook, setEditingBook] = useState<LibraryBook | null | undefined>(() => initialAdd ? null : undefined);
  const [viewingBook, setViewingBook] = useState<LibraryBook | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const monthReadCount = books.filter((book) => (book.readingStatus ?? "read") === "read" && book.readMonth === currentMonth && book.readYear === currentYear).length;
  const yearReadCount = books.filter((book) => (book.readingStatus ?? "read") === "read" && book.readYear === currentYear).length;
  const wantCount = books.filter((book) => book.readingStatus === "want").length;
  const readingCount = books.filter((book) => book.readingStatus === "reading").length;
  const visibleBooks = books.filter((book) => (book.readingStatus ?? "read") === statusFilter);

  async function updateRating(id: number, rating: number) {
    const book = books.find((item) => item.id === id);
    if (!book) return;
    const response = await fetch("/api/books", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ author: book.author, title: book.title, isbn: book.isbn, publisher: book.publisher, genres: book.genres, annotation: book.annotation, coverUrl: book.coverUrl, coverTone: book.coverTone, flipUrl: book.flipUrl, links: book.links, rating, shortReview: book.review, readMonth: book.readMonth, readYear: book.readYear, readingStatus: book.readingStatus ?? "read", useExistingId: book.id }) });
    if (!response.ok) { window.alert("Не удалось сохранить оценку"); return; }
    setBooks((current) => current.map((item) => item.id === id ? { ...item, rating } : item));
  }

  async function saveBook(book: LibraryBook) {
    const existingBook = books.some((item) => item.id === book.id) || catalogFromUsers(users).some((item) => item.id === book.id);
    const payload = { userId, author: book.author, title: book.title, isbn: book.isbn, publisher: book.publisher, genres: book.genres, annotation: book.annotation, coverUrl: book.coverUrl, coverTone: book.coverTone, flipUrl: book.flipUrl, links: book.links?.map(({ label, url, action }) => ({ label, url, action })), format: "Книга", rating: book.rating, shortReview: book.review, readMonth: book.readMonth, readYear: book.readYear, readingStatus: book.readingStatus ?? "read", useExistingId: book.catalogBookId ?? (existingBook ? book.id : undefined) };
    try {
      let response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status === 409) {
        const data = await response.json() as { match: { id: number; title: string; author: string } };
        if (!window.confirm(`Вы имеете в виду эту книгу?\n\n${data.match.author} — «${data.match.title}»`)) return;
        response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, useExistingId: data.match.id }) });
      }
      if (!response.ok) throw new Error("Не удалось сохранить книгу в каталоге");
      const data = await response.json() as { bookId: number };
      const savedBook = { ...book, id: data.bookId };
      setBooks((current) => current.some((item) => item.id === book.id) ? current.map((item) => item.id === book.id ? savedBook : item) : [savedBook, ...current]);
      setEditingBook(undefined);
    } catch (error) { console.warn(error); window.alert("Не удалось сохранить книгу. Проверьте соединение и попробуйте ещё раз."); }
  }

  return (
    <div className="library-tab">
      <div className="profile-title-row library-title-row">
        <div><h1>Моя библиотека</h1><button className="library-reading-summary" type="button" onClick={() => setStatsOpen(true)}><span>В {readingMonthsPrepositional[currentMonth - 1]} прочитано: <strong>{monthReadCount}</strong> {booksWord(monthReadCount)}</span><i aria-hidden="true" /><span>В {currentYear} году прочитано: <strong>{yearReadCount}</strong> {booksWord(yearReadCount)}</span></button><div className="library-status-summary"><span>Хочу прочитать: <strong>{wantCount}</strong> {booksWord(wantCount)}</span><i aria-hidden="true" /><span>Читаю сейчас: <strong>{readingCount}</strong> {booksWord(readingCount)}</span></div></div>
        <button className="primary-button creation-action-button" type="button" onClick={() => setEditingBook(null)}>＋ Добавить книгу</button>
      </div>
      <div className="library-toolbar">
        <div className="library-status-filter" role="group" aria-label="Фильтр книг по статусу"><button className={statusFilter === "want" ? "active" : ""} type="button" onClick={() => setStatusFilter("want")}>Хочу прочитать</button><button className={statusFilter === "reading" ? "active" : ""} type="button" onClick={() => setStatusFilter("reading")}>Читаю</button><button className={statusFilter === "read" ? "active" : ""} type="button" onClick={() => setStatusFilter("read")}>Прочитано</button></div>
        <div className="view-switcher" aria-label="Вид библиотеки">
          <button className={view === "grid" ? "active" : ""} type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>▦ Плитка</button>
          <button className={view === "list" ? "active" : ""} type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>☷ Список</button>
        </div>
      </div>
      <div className={`library-grid ${view === "list" ? "list-view" : ""}`}>
        {visibleBooks.map((book) => (
          <article className="library-book material-clickable-card" role="button" tabIndex={0} key={book.id} onClick={() => setViewingBook(book)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewingBook(book); } }}>
            <div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>
              {!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}
            </div>
            <div className="library-book-copy">
              <h3>{book.title}</h3><p className="library-author">{book.author}</p>
              {(book.readingStatus ?? "read") === "read" && <RatingStars allowHalf value={book.rating} onChange={(rating) => updateRating(book.id, rating)} label={`Оценка книги ${book.title}`} />}
              <div className="list-only-book-details"><p>{book.annotation}</p><span>{book.genres.join(", ")}</span>{(book.readingStatus ?? "read") === "read" && book.review && <blockquote>«{book.review}»</blockquote>}</div>
            </div>
          </article>
        ))}
      </div>
      {editingBook !== undefined && <BookEditor book={editingBook} catalog={catalogFromUsers(users)} onClose={() => setEditingBook(undefined)} onSave={saveBook} />}
      {viewingBook && <UnifiedBookModal book={viewingBook} users={users} onClose={() => setViewingBook(null)} onEdit={() => { setEditingBook(viewingBook); setViewingBook(null); }} onDelete={async () => { if (!window.confirm(`Удалить «${viewingBook.title}» из библиотеки?`)) return; const response = await fetch(`/api/books/${viewingBook.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить книгу"); return; } setBooks((current) => current.filter((book) => book.id !== viewingBook.id)); setViewingBook(null); }} />}
      {statsOpen && <ReadingStatsModal books={books} onClose={() => setStatsOpen(false)} />}
    </div>
  );
}

export function ReviewEditor({ review, catalog, onClose, onSave }: { review?: UserReview | null; catalog: (LibraryBook | AuthorBook)[]; onClose: () => void; onSave: (review: UserReview) => void }) {
  const [form, setForm] = useState({ bookTitle: review?.bookTitle ?? "", bookAuthor: review?.bookAuthor ?? "", rating: review?.rating ?? 0, preview: review?.preview ?? "", fullText: review?.fullText ?? "" });
  const [ratingError, setRatingError] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.rating) { setRatingError(true); return; }
    onSave({ id: review?.id ?? Date.now(), ...form, createdAt: review?.createdAt ?? "сегодня", createdAtValue: review?.createdAtValue ?? new Date().toISOString() });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="review-editor" role="dialog" aria-modal="true" aria-labelledby="review-editor-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        <span className="section-subtitle">Мои рецензии</span><h2 id="review-editor-title">{review ? "Редактировать рецензию" : "Добавить рецензию"}</h2>
        <form className="book-fields" onSubmit={submit}>
          <div className="form-row"><label>Название книги *<input required value={form.bookTitle} onChange={(event) => setForm({ ...form, bookTitle: event.target.value })} /></label><label>Автор книги *<input required value={form.bookAuthor} onChange={(event) => setForm({ ...form, bookAuthor: event.target.value })} /></label></div>
          <BookMatchSuggestions books={catalog} queryAuthor={form.bookAuthor} queryTitle={form.bookTitle} onSelect={(book) => setForm({ ...form, bookTitle: book.title, bookAuthor: book.author })} />
          <div className="book-rating-field"><span>Оценка *</span><RatingStars value={form.rating} onChange={(rating) => { setForm({ ...form, rating }); setRatingError(false); }} />{ratingError && <small>Поставьте оценку книге</small>}</div>
          <label className="review-preview-field">Краткое описание к рецензии *<span className="review-preview-shell"><textarea required rows={4} maxLength={500} placeholder="Кратко расскажите, чем интересна ваша рецензия" value={form.preview} onChange={(event) => setForm({ ...form, preview: event.target.value })} /><small className={Array.from(form.preview).length >= 500 ? "limit-reached" : ""}>{Array.from(form.preview).length}/500</small></span></label>
          <label>Полная рецензия *<textarea required rows={9} value={form.fullText} onChange={(event) => setForm({ ...form, fullText: event.target.value })} /></label>
          <div className="form-actions"><button type="button" onClick={onClose}>Отмена</button><button className="primary-button creation-action-button" type="submit">Опубликовать</button></div>
        </form>
      </section>
    </div>
  );
}

export function ReviewsTab({ reviews, setReviews, owner, users, likes, onToggleLike, onComment, onOpenUser, initialAdd = false, initialEditId }: { reviews: UserReview[]; setReviews: React.Dispatch<React.SetStateAction<UserReview[]>>; owner: DemoUser; users: DemoUser[]; likes: Record<string, number[]>; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void; initialAdd?: boolean; initialEditId?: number | null }) {
  const [selected, setSelected] = useState<UserReview | null>(null);
  const [editing, setEditing] = useState<UserReview | null | undefined>(() => initialEditId ? reviews.find((item) => item.id === initialEditId) : initialAdd ? null : undefined);

  return (
    <div className="reviews-tab">
      <div className="profile-title-row library-title-row"><div><h1>Мои рецензии</h1><p>{reviews.length} опубликованные рецензии</p></div><button className="primary-button creation-action-button" type="button" onClick={() => setEditing(null)}>＋ Добавить рецензию</button></div>
      <div className="my-reviews-list">
        {reviews.map((review) => { const matchingBook = catalogFromUsers(users).find((book) => book.title.toLowerCase() === review.bookTitle.toLowerCase() && book.author.toLowerCase() === review.bookAuthor.toLowerCase()); return (
          <article className="my-review-row material-clickable-card" role="button" tabIndex={0} key={review.id} onClick={() => setSelected(review)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(review); } }}>
            <div className="my-review-mark" style={matchingBook?.coverUrl ? { backgroundImage: `url(${matchingBook.coverUrl})` } : undefined}>{!matchingBook?.coverUrl && review.bookTitle.slice(0, 1)}</div>
            <div><span>{review.createdAt} · ★ {review.rating}</span><h3>{review.bookTitle}</h3><p className="review-book-author">{review.bookAuthor}</p><p>{review.preview}</p></div>
          </article>
        ); })}
      </div>
      {selected && (() => { const item: ReadingItem = { id: selected.id, kind: "review", title: selected.bookTitle, author: `${owner.profile.name} · ★ ${selected.rating}`, text: selected.fullText, ownerId: owner.id, createdAt: selected.createdAt, preview: selected.preview, bookAuthor: selected.bookAuthor }; return <ReadingModal item={item} currentUser={owner} users={users} likedUserIds={likes[`review-${selected.id}`] ?? []} onToggleLike={() => onToggleLike(item)} onComment={(text) => onComment(item, text)} onOpenUser={onOpenUser} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null); }} onDelete={() => { if (window.confirm(`Удалить рецензию к книге «${selected.bookTitle}»?`)) { setReviews((current) => current.filter((review) => review.id !== selected.id)); setSelected(null); } }} />; })()}
      {editing !== undefined && <ReviewEditor review={editing} catalog={catalogFromUsers(users)} onClose={() => setEditing(undefined)} onSave={(review) => { setReviews((current) => current.some((item) => item.id === review.id) ? current.map((item) => item.id === review.id ? review : item) : [review, ...current]); setEditing(undefined); }} />}
    </div>
  );
}

export function ProfileFriendsTab({ friends, outgoing, incoming, subscriptions, followers, onOpenUser }: { friends: DemoUser[]; outgoing: DemoUser[]; incoming: DemoUser[]; subscriptions: DemoUser[]; followers: DemoUser[]; onOpenUser: (userId: number) => void }) {
  const [mode, setMode] = useState<"friends" | "follows">("friends");
  const groups = mode === "friends"
    ? [
      { key: "friends", title: "Текущие друзья", users: friends },
      { key: "outgoing", title: "Запросы, отправленные вами", users: outgoing },
      { key: "incoming", title: "Запросы, полученные вами", users: incoming },
    ]
    : [
      { key: "subscriptions", title: "Подписки", users: subscriptions },
      { key: "followers", title: "Подписчики", users: followers },
    ];
  return <div className="profile-friends-tab"><div className="profile-title-row"><div><h1>Мои друзья</h1><p>Эти списки видите только вы</p></div></div><div className="profile-social-switch" role="tablist"><button className={mode === "friends" ? "active" : ""} type="button" onClick={() => setMode("friends")}>Друзья</button><button className={mode === "follows" ? "active" : ""} type="button" onClick={() => setMode("follows")}>Подписки</button></div><div className="profile-friend-groups">{groups.map((group) => <details key={group.key} open><summary><span>{group.title}</span><b>{group.users.length}</b></summary>{group.users.length > 0 && <div className="profile-friends-grid">{group.users.map((friend) => <button className="profile-friend-card" type="button" key={friend.id} onClick={() => onOpenUser(friend.id)}><span className={`avatar avatar-md avatar-${friend.color} ${friend.avatarUrl ? "has-photo" : ""}`} style={friend.avatarUrl ? { backgroundImage: `url(${friend.avatarUrl})` } : undefined}>{!friend.avatarUrl && friend.initials}</span><span className="profile-friend-copy"><strong>{friend.profile.name}</strong><small>{friend.profile.type}{friend.profile.city ? ` · ${friend.profile.city}` : ""}</small></span></button>)}</div>}</details>)}</div></div>;
}

export function MyEventsTab({ createdEvents, participatingEvents, users, onEdit, onDeleted }: { createdEvents: BookEvent[]; participatingEvents: BookEvent[]; users: DemoUser[]; onEdit: (item: BookEvent) => void; onDeleted: (id: number) => void }) {
  const [opened, setOpened] = useState<BookEvent | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const groups = [
    { key: "created", title: "Созданные мной события", events: [...createdEvents].sort((first, second) => (Date.parse(second.createdAt) || second.id) - (Date.parse(first.createdAt) || first.id)), own: true },
    { key: "participating", title: "События, в которых я участвую", events: [...participatingEvents].sort((first, second) => eventTimestamp(first) - eventTimestamp(second)), own: false },
  ];
  const openedIsOwn = Boolean(opened && createdEvents.some((item) => item.id === opened.id));
  const openBook = (item: BookEvent) => setOpenedBook(catalogFromUsers(users).find((book) => book.id === item.linkedBookId) ?? null);
  async function remove(item: BookEvent) {
    if (!window.confirm(`Удалить событие «${item.title}»?`)) return;
    const response = await fetch(`/api/events/${item.id}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) { window.alert("Не удалось удалить событие"); return; }
    setOpened(null);
    onDeleted(item.id);
  }
  return <div className="my-events-tab"><div className="profile-title-row"><div><h1>Мои мероприятия</h1><p>{createdEvents.length + participatingEvents.length} событий · этот раздел видите только вы</p></div></div><div className="my-event-groups">{groups.map((group) => <details key={group.key} open><summary><span>{group.title}</span><b>{group.events.length}</b></summary>{group.events.length > 0 && <div className="events-grid">{group.events.map((item) => <EventCard key={item.id} item={item} own={group.own} compact onOpen={() => setOpened(item)} onOpenBook={item.linkedBookId ? () => openBook(item) : undefined} onEdit={group.own ? () => onEdit(item) : undefined} />)}</div>}</details>)}</div>{opened && <EventModal item={opened} onOpenBook={opened.linkedBookId ? () => openBook(opened) : undefined} onClose={() => setOpened(null)} onEdit={openedIsOwn ? () => { onEdit(opened); setOpened(null); } : undefined} onDelete={openedIsOwn ? () => void remove(opened) : undefined} />}{openedBook && <UnifiedBookModal book={openedBook} users={users} onClose={() => setOpenedBook(null)} />}</div>;
}

export function LegacyAuthorBooksTab({ books, setBooks, userId }: { books: AuthorBook[]; setBooks: React.Dispatch<React.SetStateAction<AuthorBook[]>>; userId: number }) {
  const [adding, setAdding] = useState(false);
  const [warningUrl, setWarningUrl] = useState<string | null>(null);
  const [form, setForm] = useState({ author: "", title: "", genres: [] as string[], annotation: "", pages: "", format: "Бумажная" as BookFormat, label: "", url: "" });
  async function submit(event: FormEvent) { event.preventDefault(); const links = form.label && form.url ? [{ id: Date.now(), label: form.label, url: form.url }] : []; const newBook: AuthorBook = { id: Date.now(), author: form.author, title: form.title, genres: form.genres, annotation: form.annotation, pages: form.pages, durationHours: "", durationMinutes: "", format: form.format, coverTone: ["wine", "sky", "forest", "sand"][Math.floor(Math.random() * 4)], links }; const payload = { userId, ...newBook, isAuthor: true, links: links.map(({ label, url }) => ({ label, url })) }; try { let response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); if (response.status === 409) { const data = await response.json() as { match: { id: number; title: string; author: string } }; if (!window.confirm(`Вы имеете в виду эту книгу?\n\n${data.match.author} — «${data.match.title}»`)) return; response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, useExistingId: data.match.id }) }); } if (!response.ok) throw new Error("Не удалось сохранить книгу"); } catch (error) { console.warn(error); } setBooks((current) => [newBook, ...current]); setAdding(false); }
  return <div className="library-tab"><div className="profile-title-row library-title-row"><div><h1>Мои книги</h1><p>Книги, которые вы написали</p></div><button className="primary-button" type="button" onClick={() => setAdding(true)}>＋ Добавить книгу</button></div><div className="library-grid">{books.map((book) => <article className="library-book" key={book.id}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div className="library-book-copy"><span className="book-format">Авторская книга</span><h3>{book.title}</h3><p>{book.author}</p><div className="writer-book-links">{book.links.map((link) => <button type="button" key={link.id} onClick={() => setWarningUrl(link.url)}>{link.label}</button>)}</div></div></article>)}</div>{adding && <div className="modal-backdrop" onMouseDown={() => setAdding(false)}><section className="review-editor" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setAdding(false)}>×</button><h2>Добавить авторскую книгу</h2><form className="book-fields" onSubmit={submit}><div className="form-row"><label>Автор *<input required value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} /></label><label>Название книги *<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label></div><GenrePicker label="Жанр" value={form.genres} onChange={(genres) => setForm({ ...form, genres })} /><label>Аннотация<textarea rows={4} value={form.annotation} onChange={(event) => setForm({ ...form, annotation: event.target.value })} /></label><div className="form-row"><label>Название магазина/портала<input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label><label>Ссылка<input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></label></div><div className="form-actions"><button type="button" onClick={() => setAdding(false)}>Отмена</button><button className="primary-button" type="submit">Сохранить книгу</button></div></form></section></div>}{warningUrl && <div className="modal-backdrop" onMouseDown={() => setWarningUrl(null)}><section className="external-warning" onMouseDown={(event) => event.stopPropagation()}><span className="section-subtitle">Внешняя ссылка</span><h2>Вы переходите на другой сайт</h2><p>{warningUrl}</p><div className="form-actions"><button type="button" onClick={() => setWarningUrl(null)}>Отмена</button><button className="primary-button" type="button" onClick={() => window.open(warningUrl, "_blank", "noopener,noreferrer")}>Перейти</button></div></section></div>}</div>;
}

export function WriterBookEditor({ book, author, allowFreeAuthor = false, onClose, onSave }: { book?: AuthorBook | null; author: string; allowFreeAuthor?: boolean; onClose: () => void; onSave: (book: AuthorBook) => void }) {
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
      <button className="modal-close" type="button" onClick={onClose}>×</button>
      <div className="book-editor-heading"><span className="section-subtitle">Мои книги</span><h2>{book ? "Редактировать книгу" : "Добавить книгу"}</h2></div>
      <form className="book-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, links: form.links.filter((link) => link.label.trim() && link.url.trim()) }); }}>
        <div className="cover-upload-column">
          <div className={`editable-book-cover library-cover-${form.coverTone}`} style={form.coverUrl ? { backgroundImage: `url(${form.coverUrl})` } : undefined}>{!form.coverUrl && <><em>{form.author}</em><strong>{form.title || "Название книги"}</strong><span>Book Meet</span></>}</div>
          <label className={`cover-upload-button ${coverLocked ? "is-disabled" : ""}`}>{coverLocked ? "Обложка книги уже сохранена" : "Загрузить обложку"}<input type="file" accept="image/*" disabled={coverLocked} onChange={uploadCover} /></label>
        </div>
        <div className="book-fields">
          <BookAutofillField value={autofillUrl} onChange={(value) => { setAutofillUrl(value); if (!value.trim() && !book) setSourceFieldsLocked(false); }} onProduct={applyMarketplaceProduct} />
          <p className="book-manual-divider">или заполните данные вручную</p>
          <div className="book-identity-block">
            <div className="form-row">
              <label>Автор<input required value={form.author} disabled={!allowFreeAuthor} onChange={(event) => setForm({ ...form, author: event.target.value })} /></label>
              <label>Название книги *<input required readOnly={fieldLocked(book?.title, form.title)} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            </div>
            <div className="form-row">
              <label>ISBN<input inputMode="numeric" pattern="[0-9]{10}|[0-9]{13}" maxLength={13} readOnly={fieldLocked(book?.isbn, form.isbn)} value={form.isbn ?? ""} onChange={(event) => setForm({ ...form, isbn: event.target.value.replace(/\D/g, "").slice(0, 13) })} /></label>
              <label>Издательство<input readOnly={fieldLocked(book?.publisher, form.publisher)} value={form.publisher ?? ""} onChange={(event) => setForm({ ...form, publisher: event.target.value })} /></label>
            </div>
            <label>Аннотация<textarea rows={4} readOnly={fieldLocked(book?.annotation, form.annotation)} value={form.annotation} onChange={(event) => setForm({ ...form, annotation: event.target.value })} /></label>
          </div>
          <BookLinksEditor links={form.links} lockedUrls={lockedLinkUrls} onChange={(links) => setForm((current) => ({ ...current, links }))} />
          <div className="form-actions"><button type="button" onClick={onClose}>Отмена</button><button className="primary-button" type="submit">Сохранить книгу</button></div>
        </div>
      </form>
    </section>
  </div>;
}

export function AuthorBooksTab({ books, setBooks, userId, author, users, publisherMode = false, canCreate = true }: { books: AuthorBook[]; setBooks: React.Dispatch<React.SetStateAction<AuthorBook[]>>; userId: number; author: string; users: DemoUser[]; publisherMode?: boolean; canCreate?: boolean }) {
  const [editing, setEditing] = useState<AuthorBook | null | undefined>(undefined); const [viewing, setViewing] = useState<AuthorBook | null>(null); const [warning, setWarning] = useState<BookLink | null>(null);
  async function save(book: AuthorBook) { const existingBook = books.some((item) => item.id === book.id) || Boolean(book.catalogBookId); const payload = { userId, ...book, format: "Книга", isAuthor: true, useExistingId: existingBook ? (book.catalogBookId ?? book.id) : undefined, links: book.links.map(({ label, url, action }) => ({ label, url, action })) }; try { let response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); if (response.status === 409) { const data = await response.json() as { match: { id: number; title: string; author: string } }; if (!window.confirm(`Вы имеете в виду эту книгу?\n\n${data.match.author} — «${data.match.title}»`)) return; response = await fetch("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, useExistingId: data.match.id }) }); } if (!response.ok) throw new Error("Не удалось сохранить книгу"); const data = await response.json() as { bookId: number }; const savedBook = { ...book, id: data.bookId }; setBooks((current) => current.some((item) => item.id === book.id) ? current.map((item) => item.id === book.id ? savedBook : item) : [savedBook, ...current]); setEditing(undefined); } catch (error) { console.warn(error); window.alert("Не удалось сохранить книгу. Проверьте соединение и попробуйте ещё раз."); } }
  return <div className="library-tab">
    <div className="profile-title-row library-title-row">
      <div><h1>{publisherMode ? "Книги издательства" : "Мои книги"}</h1><p>{publisherMode ? "Книги, выпущенные вашим издательством" : "Книги, которые вы написали"}</p></div>
      {canCreate && <button className="primary-button" type="button" onClick={() => setEditing(null)}>＋ Добавить книгу</button>}
    </div>
    <div className="library-grid">{books.map((book) => <article className="library-book material-clickable-card" role="button" tabIndex={0} key={book.id} onClick={() => setViewing(book)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewing(book); } }}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div className="library-book-copy"><h3>{book.title}</h3><p>{book.author}</p><div className="writer-book-links">{book.links.map((link) => <button type="button" key={link.id} onClick={(event) => { event.stopPropagation(); setWarning(link); }}>{link.action} · {link.label}</button>)}</div></div></article>)}</div>
    {editing !== undefined && <WriterBookEditor book={editing} author={author} allowFreeAuthor={publisherMode} onClose={() => setEditing(undefined)} onSave={save} />}
    {viewing && <UnifiedBookModal book={viewing} users={users} onClose={() => setViewing(null)} onEdit={canCreate ? () => { setEditing(viewing); setViewing(null); } : undefined} onDelete={canCreate ? async () => { if (!window.confirm(`Удалить «${viewing.title}» из списка ваших книг?`)) return; const response = await fetch(`/api/books/${viewing.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить книгу"); return; } setBooks((current) => current.filter((book) => book.id !== viewing.id)); setViewing(null); } : undefined} />}
    {warning && <div className="modal-backdrop" onMouseDown={() => setWarning(null)}><section className="external-warning" onMouseDown={(event) => event.stopPropagation()}><h2>Вы переходите на другой сайт</h2><p>{warning.url}</p><div className="form-actions"><button type="button" onClick={() => setWarning(null)}>Отмена</button><button className="primary-button" type="button" onClick={() => window.open(warning.url, "_blank", "noopener,noreferrer")}>Перейти</button></div></section></div>}
  </div>;
}

export function RichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [fontSizeValue, setFontSizeValue] = useState("16");
  useEffect(() => {
    if (editorRef.current && document.activeElement !== editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value;
  }, [value]);

  function run(command: string, commandValue?: string) {
    editorRef.current?.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, commandValue);
    onChange(sanitizeRichHtml(editorRef.current?.innerHTML ?? ""));
  }

  function setFontSize(size: string) {
    setFontSizeValue(size);
    editorRef.current?.focus();
    document.execCommand("fontSize", false, "7");
    editorRef.current?.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement("span");
      span.style.fontSize = `${size}px`;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
    });
    onChange(sanitizeRichHtml(editorRef.current?.innerHTML ?? ""));
  }

  return <div className="rich-editor-shell">
    <div className="rich-editor-toolbar" aria-label="Форматирование текста">
      <button type="button" title="Жирный" onMouseDown={(event) => event.preventDefault()} onClick={() => run("bold")}><b>Ж</b></button>
      <button type="button" title="Курсив" onMouseDown={(event) => event.preventDefault()} onClick={() => run("italic")}><i>К</i></button>
      <button type="button" title="Подчеркнутый" onMouseDown={(event) => event.preventDefault()} onClick={() => run("underline")}><u>Ч</u></button>
      <button type="button" title="Зачеркнутый" onMouseDown={(event) => event.preventDefault()} onClick={() => run("strikeThrough")}><s>А</s></button>
      <CustomSelect ariaLabel="Размер шрифта" value={fontSizeValue} onChange={setFontSize} options={["12", "14", "16", "18", "22", "28"].map((size) => ({ value: size, label: size }))} />
      <span className="toolbar-divider" />
      <button type="button" title="По левому краю" onMouseDown={(event) => event.preventDefault()} onClick={() => run("justifyLeft")}>≡</button>
      <button type="button" title="По центру" onMouseDown={(event) => event.preventDefault()} onClick={() => run("justifyCenter")}>≡</button>
      <button type="button" title="По правому краю" onMouseDown={(event) => event.preventDefault()} onClick={() => run("justifyRight")}>≡</button>
      <button type="button" title="По ширине" onMouseDown={(event) => event.preventDefault()} onClick={() => run("justifyFull")}>☰</button>
      <span className="toolbar-divider" />
      <button type="button" title="Маркированный список" onMouseDown={(event) => event.preventDefault()} onClick={() => run("insertUnorderedList")}>•≡</button>
      <button type="button" title="Нумерованный список" onMouseDown={(event) => event.preventDefault()} onClick={() => run("insertOrderedList")}>1≡</button>
    </div>
    <div ref={editorRef} className="rich-editor-content" contentEditable suppressContentEditableWarning data-placeholder="Продолжите публикацию…" onInput={(event) => { if (!event.currentTarget.textContent?.trim()) event.currentTarget.innerHTML = ""; onChange(sanitizeRichHtml(event.currentTarget.innerHTML)); }} />
  </div>;
}

export function PublisherNewsTab({ news, setNews, owner, canCreate = true }: {
  news: PublisherNews[];
  setNews: React.Dispatch<React.SetStateAction<PublisherNews[]>>;
  owner: DemoUser;
  canCreate?: boolean;
}) {
  const [editing, setEditing] = useState<PublisherNews | null | undefined>(undefined);
  const [opened, setOpened] = useState<PublisherNews | null>(null);
  const empty = { id: 0, ownerId: owner.id, title: "", previewText: "", bodyHtml: "", body: "", createdAt: new Date().toLocaleDateString("ru-RU") };
  const [form, setForm] = useState<PublisherNews>(empty);
  const begin = (item: PublisherNews | null) => { setForm(item ? { ...item } : { ...empty, id: Date.now() }); setEditing(item); };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const body = form.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const value = { ...form, title: form.title.trim(), previewText: form.previewText.trim().slice(0, 500), body };
    setNews((current) => current.some((item) => item.id === value.id) ? current.map((item) => item.id === value.id ? value : item) : [value, ...current]);
    setEditing(undefined);
  };
  return <div className="publisher-news-tab">
    <div className="profile-title-row"><div><h1>Новости издательства</h1><p>{news.length} публикаций</p></div>{canCreate && <button className="primary-button" type="button" onClick={() => begin(null)}>＋ Добавить новость</button>}</div>
    {news.length ? <div className="publisher-news-grid">{news.map((item) => <article className="material-clickable-card" role="button" tabIndex={0} key={item.id} onClick={() => setOpened(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpened(item); } }}><span className="section-subtitle">{item.createdAt}</span><h3>{item.title}</h3><p>{item.previewText}</p></article>)}</div> : <div className="profile-tab-placeholder">Новости пока не опубликованы.</div>}
    {opened && <div className="modal-backdrop" onMouseDown={() => setOpened(null)}><section className="reading-modal publisher-news-modal" onMouseDown={(event) => event.stopPropagation()}><ModalIconActions onEdit={canCreate ? () => { begin(opened); setOpened(null); } : undefined} onDelete={canCreate ? () => { if (window.confirm(`Удалить новость «${opened.title}»?`)) { setNews((current) => current.filter((item) => item.id !== opened.id)); setOpened(null); } } : undefined} onClose={() => setOpened(null)} /><span className="section-subtitle">Новости издательства · {opened.createdAt}</span><h2>{opened.title}</h2><p className="reading-preview">{opened.previewText}</p><div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(opened.bodyHtml) }} /></section></div>}
    {editing !== undefined && <div className="modal-backdrop" onMouseDown={() => setEditing(undefined)}><section className="review-editor publisher-news-editor" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setEditing(undefined)}>×</button><h2>{editing ? "Редактировать новость" : "Добавить новость"}</h2><form onSubmit={save}><label>Заголовок<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Краткий текст<textarea required maxLength={500} rows={5} value={form.previewText} onChange={(event) => setForm({ ...form, previewText: event.target.value })} /></label><small>{form.previewText.length}/500</small><label>Полный текст<RichTextEditor value={form.bodyHtml} onChange={(bodyHtml) => setForm({ ...form, bodyHtml })} /></label><div className="form-actions"><button type="button" onClick={() => setEditing(undefined)}>Отмена</button><button className="primary-button" type="submit">Сохранить новость</button></div></form></section></div>}
  </div>;
}

export function ExcerptsTab({ excerpts, setExcerpts, owner, users, likes, onToggleLike, onComment, onOpenUser, initialAdd = false, initialEditId }: { excerpts: UserExcerpt[]; setExcerpts: React.Dispatch<React.SetStateAction<UserExcerpt[]>>; owner: DemoUser; users: DemoUser[]; likes: Record<string, number[]>; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void; initialAdd?: boolean; initialEditId?: number | null }) {
  const author = owner.profile.name;
  const writerBooks = owner.authorBooks ?? [];
  const [editing, setEditing] = useState<UserExcerpt | null | undefined>(() => initialEditId ? excerpts.find((item) => item.id === initialEditId) : initialAdd ? null : undefined);
  const [viewing, setViewing] = useState<UserExcerpt | null>(null);
  const [form, setForm] = useState<UserExcerpt | null>(null);
  const [linkedToBook, setLinkedToBook] = useState(false);

  useEffect(() => {
    if (editing === undefined) return;
    const next = editing ?? { id: Date.now(), bookTitle: "", previewText: "", bodyHtml: "", text: "", link: "", createdAt: "сегодня", createdAtValue: new Date().toISOString() };
    setForm(next);
    setLinkedToBook(Boolean(next.bookId));
  }, [editing]);

  function closeEditor() { setEditing(undefined); setForm(null); setLinkedToBook(false); }

  return <div className="reviews-tab">
    <div className="profile-title-row library-title-row"><div><h1>Мой блог</h1><p>{excerpts.length} публикаций</p></div><button className="primary-button" type="button" onClick={() => setEditing(null)}>＋ Добавить публикацию</button></div>
    <div className="my-reviews-list">{excerpts.map((excerpt) => <article className="my-review-row material-clickable-card" role="button" tabIndex={0} key={excerpt.id} onClick={() => setViewing(excerpt)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewing(excerpt); } }}><div className="my-review-mark">✦</div><div><span>{excerpt.createdAt} · {author}</span><h3>{excerpt.bookTitle || "Публикация"}</h3><p>{excerpt.previewText || excerpt.text.slice(0, 500)}</p></div></article>)}</div>
    {viewing && (() => { const item: ReadingItem = { id: viewing.id, kind: "excerpt", title: viewing.bookTitle || "Публикация", author, text: viewing.text, preview: viewing.previewText, bodyHtml: viewing.bodyHtml, linkedBookId: viewing.bookId, ownerId: owner.id, createdAt: viewing.createdAt }; return <ReadingModal item={item} currentUser={owner} users={users} likedUserIds={likes[`excerpt-${viewing.id}`] ?? []} onToggleLike={() => onToggleLike(item)} onComment={(text) => onComment(item, text)} onOpenUser={onOpenUser} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} onDelete={() => { if (window.confirm("Удалить публикацию?")) { setExcerpts((current) => current.filter((excerpt) => excerpt.id !== viewing.id)); setViewing(null); } }} />; })()}
    {form && <div className="modal-backdrop" onMouseDown={closeEditor}><section className="review-editor blog-editor-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={closeEditor}>×</button><h2>{editing ? "Редактировать публикацию" : "Добавить публикацию"}</h2><form className="book-fields" onSubmit={(event) => { event.preventDefault(); const saved = { ...form, bookId: linkedToBook ? form.bookId : undefined, bookTitle: linkedToBook ? form.bookTitle : "", previewText: form.previewText.trim(), bodyHtml: sanitizeRichHtml(form.bodyHtml ?? ""), text: form.text || form.previewText.trim() }; setExcerpts((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]); closeEditor(); }}>
      <div className="blog-book-toggle"><span>Публикация связана с вашей книгой?</span><button className={`switch-control ${linkedToBook ? "active" : ""}`} type="button" role="switch" aria-checked={linkedToBook} onClick={() => { setLinkedToBook((current) => !current); if (linkedToBook) setForm({ ...form, bookId: undefined, bookTitle: "" }); }}><span /></button></div>
      {linkedToBook && <div className="blog-book-picker">{writerBooks.length ? writerBooks.map((book) => <button className={`blog-book-option ${form.bookId === book.id ? "selected" : ""}`} type="button" key={book.id} onClick={() => setForm({ ...form, bookId: book.id, bookTitle: book.title, link: "" })}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><strong>{book.title}</strong></button>) : <p>Сначала добавьте книгу во вкладке «Мои книги».</p>}</div>}
      <div className="blog-composer"><span className="field-label blog-composer-title">Что нового?</span><label className="blog-text-block blog-preview-field"><span className="blog-block-title">Эта часть текста будет видна на главной странице и внутри публикации</span><textarea required rows={7} maxLength={500} placeholder="Напишите то, что привлечет читателей" value={form.previewText} onChange={(event) => setForm({ ...form, previewText: event.target.value, text: event.target.value })} /><small className={form.previewText.length >= 500 ? "limit-reached" : ""}>{form.previewText.length}/500</small></label><div className="blog-text-block blog-rich-block"><span className="blog-block-title">Эта часть текста будет видна только внутри публикации</span><RichTextEditor value={form.bodyHtml ?? ""} onChange={(bodyHtml) => setForm({ ...form, bodyHtml })} /></div></div>
      <div className="form-actions"><button type="button" onClick={closeEditor}>Отмена</button><button className="primary-button" type="submit" disabled={linkedToBook && !form.bookId}>Сохранить</button></div>
    </form></section></div>}
  </div>;
}

export function AdminCatalogCard({ item, onOpen }: { item: AdminCatalogItem; onOpen: () => void }) {
  if (item.kind === "book") return <button className="admin-book-card" type="button" onClick={onOpen}><div className={`library-book-cover library-cover-${item.coverTone || "blue"}`} style={item.coverUrl ? { backgroundImage: `url(${item.coverUrl})` } : undefined}>{!item.coverUrl && <><em>{item.subtitle}</em><strong>{item.title}</strong><span>Book Meet</span></>}</div><strong>{item.title}</strong><span>{item.subtitle}</span></button>;
  return <button className={`admin-content-card admin-content-${item.kind}`} type="button" onClick={onOpen}><span className="section-subtitle">{item.subtitle}</span><h3>{item.title}</h3><p>{item.text}</p><small>Открыть материал</small></button>;
}

export function AdminExcerptEditor({ excerpt, writerBooks, onClose, onSave }: { excerpt: UserExcerpt; writerBooks: AuthorBook[]; onClose: () => void; onSave: (excerpt: UserExcerpt) => void }) {
  const [form, setForm] = useState(excerpt);
  const [linked, setLinked] = useState(Boolean(excerpt.bookId));
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="review-editor blog-editor-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose}>×</button><h2>Редактировать публикацию</h2><form className="book-fields" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, bookId: linked ? form.bookId : undefined, bookTitle: linked ? form.bookTitle : "", previewText: form.previewText.trim(), bodyHtml: sanitizeRichHtml(form.bodyHtml), text: form.previewText.trim() }); }}><div className="blog-book-toggle"><span>Публикация связана с вашей книгой?</span><button className={`switch-control ${linked ? "active" : ""}`} type="button" role="switch" aria-checked={linked} onClick={() => { setLinked((value) => !value); if (linked) setForm({ ...form, bookId: undefined, bookTitle: "" }); }}><span /></button></div>{linked && <div className="blog-book-picker">{writerBooks.map((book) => <button className={`blog-book-option ${form.bookId === book.id ? "selected" : ""}`} type="button" key={book.id} onClick={() => setForm({ ...form, bookId: book.id, bookTitle: book.title, link: "" })}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><strong>{book.title}</strong></button>)}</div>}<div className="blog-composer"><span className="field-label blog-composer-title">Что нового?</span><label className="blog-text-block blog-preview-field"><span className="blog-block-title">Эта часть текста будет видна на главной странице и внутри публикации</span><textarea required rows={7} maxLength={500} placeholder="Напишите то, что привлечет читателей" value={form.previewText} onChange={(event) => setForm({ ...form, previewText: event.target.value, text: event.target.value })} /><small className={form.previewText.length >= 500 ? "limit-reached" : ""}>{form.previewText.length}/500</small></label><div className="blog-text-block blog-rich-block"><span className="blog-block-title">Эта часть текста будет видна только внутри публикации</span><RichTextEditor value={form.bodyHtml} onChange={(bodyHtml) => setForm({ ...form, bodyHtml })} /></div></div><div className="form-actions"><button type="button" onClick={onClose}>Отмена</button><button className="primary-button creation-action-button" type="submit">Сохранить</button></div></form></section></div>;
}

export function AdminCatalogOverlay({ item, users, onClose, onEdit, onDelete }: { item: AdminCatalogItem; users: DemoUser[]; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const admin = users.find((user) => user.isAdmin);
  if (item.kind === "book") return <UnifiedBookModal book={item.source} users={users} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
  if (item.kind === "event") return <EventModal item={item.source} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
  if (item.kind === "occasion") return <OccasionModal item={item.source} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
  const source = item.source as (UserReview | UserExcerpt) & { ownerId: number; ownerName: string };
  const readingItem: ReadingItem = item.kind === "review"
    ? { id: item.id, kind: "review", title: (source as UserReview).bookTitle, bookAuthor: (source as UserReview).bookAuthor, author: source.ownerName, ownerId: source.ownerId, text: (source as UserReview).fullText, preview: (source as UserReview).preview, createdAt: (source as UserReview).createdAt }
    : { id: item.id, kind: "excerpt", title: (source as UserExcerpt).bookTitle || "Публикация", linkedBookId: (source as UserExcerpt).bookId, author: source.ownerName, ownerId: source.ownerId, text: (source as UserExcerpt).text, preview: (source as UserExcerpt).previewText, bodyHtml: (source as UserExcerpt).bodyHtml, createdAt: (source as UserExcerpt).createdAt };
  return <ReadingModal item={readingItem} currentUser={admin} users={users} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
}

export function AdminCatalogEditor({ item, users, onClose, onSave }: { item: AdminCatalogItem; users: DemoUser[]; onClose: () => void; onSave: (payload: unknown) => void }) {
  if (item.kind === "book") {
    const owner = users.find((user) => (user.authorBooks ?? []).some((book) => book.id === item.id) || user.books.some((book) => book.id === item.id));
    if ("links" in item.source) return <WriterBookEditor book={item.source} author={item.source.author} onClose={onClose} onSave={(book) => onSave({ ...book, ownerId: owner?.id })} />;
    return <BookEditor book={item.source} catalog={catalogFromUsers(users)} onClose={onClose} onSave={(book) => onSave({ ...book, ownerId: owner?.id })} />;
  }
  if (item.kind === "review") return <ReviewEditor review={item.source} catalog={catalogFromUsers(users)} onClose={onClose} onSave={(review) => onSave(review)} />;
  if (item.kind === "excerpt") {
    const owner = users.find((user) => user.id === item.source.ownerId);
    return <AdminExcerptEditor excerpt={item.source} writerBooks={owner?.authorBooks ?? []} onClose={onClose} onSave={(excerpt) => onSave(excerpt)} />;
  }
  return null;
}
