import React, { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { CustomSelect } from "../components/common/CustomSelect";
import { ModalIconActions } from "../components/modals/ModalIconActions";
import { AdminSafetySection } from "../components/safety/AdminSafety";
import { AdminStatisticsPanel } from "../components/admin/AdminStatisticsPanel";
import {
  AdminCatalogCard,
  AdminCatalogEditor,
  AdminCatalogOverlay,
  AuthorBooksTab,
  CityAutocomplete,
  EventForm,
  EventStatusLabel,
  ExcerptsTab,
  GenrePicker,
  LibraryTab,
  MyEventsTab,
  OccasionCard,
  OccasionForm,
  OccasionModal,
  PublisherNewsTab,
  ProfileFriendsTab,
  ReviewsTab,
  UnifiedBookModal,
  WishlistTab,
  emptyEvent,
  emptyOccasion,
  occasionLabels,
} from "../components/content/ContentComponents";
import { catalogFromUsers } from "../lib/domain";
import { normalizedPathname, profileTabFromPathname, profileTabPaths } from "../navigation/routes";
import type {
  AdminCatalogItem,
  AdminCatalogKind,
  AdminMaterialKind,
  AdminSection,
  AdminStatistics,
  BookEvent,
  DemoUser,
  FriendRequest,
  Follow,
  LibraryBook,
  MaterialComment,
  Occasion,
  ProfileTab,
  ReadingItem,
  SafetyReport,
  TotpSetup,
  TotpStatus,
  UserProfileData,
} from "../types/domain";

type LinkedProfileCard = { id: number; name: string; type: string; avatarUrl?: string; profileCompleted?: boolean };

function LinkedProfileControls({ profileType, settings = false }: { profileType: string; settings?: boolean }) {
  const [linked, setLinked] = useState<LinkedProfileCard | null>(null);
  const [mode, setMode] = useState<"none" | "choose" | "create" | "attach" | "unlink">("none");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("Новое сообщество"); const [totp, setTotp] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const personal = ["Читатель", "Писатель", "Блогер"].includes(profileType);
  useEffect(() => { fetch("/api/bootstrap/session", { credentials: "same-origin" }).then((response) => response.json()).then((data: { linkedProfile?: LinkedProfileCard }) => setLinked(data.linkedProfile ?? null)).catch(() => undefined); }, []);
  async function request(path: string, body?: unknown) {
    const response = await fetch(path, { method: path.includes("unlink") ? "DELETE" : "POST", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({})) as { error?: string; requiresTotp?: boolean };
    if (!response.ok && response.status !== 202) throw new Error(data.error || "Не удалось выполнить действие");
    return { response, data };
  }
  async function switchProfile(created = false) { await request("/api/linked-profiles/switch"); window.location.assign(created ? "/profile?linked-create=1" : "/profile"); }
  async function googleLink() {
    setNotice("Открываем подтверждение Google…");
    try {
      const providers = await fetch("/api/auth/providers", { credentials: "same-origin" }).then((response) => response.json()) as { googleClientId?: string };
      if (!(window as any).google?.accounts?.id) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
          if (existing) { existing.addEventListener("load", () => resolve(), { once: true }); existing.addEventListener("error", () => reject(new Error("Google-вход недоступен")), { once: true }); return; }
          const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true;
          script.onload = () => resolve(); script.onerror = () => reject(new Error("Google-вход недоступен")); document.head.append(script);
        });
      }
      const gsi = (window as any).google?.accounts?.id;
      if (!providers.googleClientId || !gsi) throw new Error("Google-вход пока недоступен в этом окне");
      gsi.initialize({ client_id: providers.googleClientId, callback: async ({ credential }: { credential?: string }) => { try { await request("/api/linked-profiles/google", { credential, mode: mode === "create" ? "create" : "attach", name }); await switchProfile(mode === "create"); } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось подтвердить Google"); } } });
      gsi.prompt();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Google-вход недоступен"); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setNotice(""); try { const { data } = await request(mode === "create" ? "/api/linked-profiles/create" : "/api/linked-profiles/attach", mode === "create" ? { email, password, name } : { email, password, totp }); if (data.requiresTotp) { setNotice("Введите код из приложения-аутентификатора."); return; } await switchProfile(mode === "create"); } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось связать профиль"); } finally { setBusy(false); } }
  if (!personal && profileType !== "Сообщество") return null;
  if (linked) return <div className={settings ? "linked-profile-settings" : "linked-profile-actions"}>{settings ? <><h2>Привязанный профиль</h2><button type="button" className="linked-profile-card" onClick={() => void switchProfile()}><span className={`avatar avatar-sm ${linked.avatarUrl ? "has-photo" : ""}`} style={linked.avatarUrl ? { backgroundImage: `url(${linked.avatarUrl})` } : undefined}>{!linked.avatarUrl && linked.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase("ru")}</span><span><strong>{linked.name}</strong><small>{linked.type}</small></span></button><button className="quiet-danger-button" type="button" onClick={() => setMode("unlink")}>Отвязать профиль</button></> : <button className="outline-button linked-profile-switch" type="button" onClick={() => void switchProfile()}>Переключиться на {linked.name}</button>}{mode === "unlink" && <div className="notice-backdrop" onMouseDown={() => setMode("none")}><section className="confirm-social-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="Закрыть" onClick={() => setMode("none")}>×</button><h2>Отвязать профиль «{linked.name}»?</h2><p>Профили останутся отдельными, материалы и настройки не изменятся.</p><div className="form-actions"><button type="button" onClick={() => setMode("none")}>Отмена</button><button className="quiet-danger-button" type="button" onClick={async () => { try { await request("/api/linked-profiles/unlink"); setLinked(null); setMode("none"); } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось отвязать профиль"); } }}>Отвязать</button></div></section></div>}</div>;
  if (!personal) return null;
  return <div className={settings ? "linked-profile-settings" : "linked-profile-actions"}>{settings ? <><h2>Привязанный профиль</h2><p>Свяжите личный профиль с одним профилем сообщества.</p></> : <button className="outline-button" type="button" onClick={() => setMode("choose")}>Привязать сообщество</button>}{settings && <button className="outline-button" type="button" onClick={() => setMode("choose")}>Привязать сообщество</button>}{mode !== "none" && <div className="notice-backdrop" onMouseDown={() => setMode("none")}><section className="confirm-social-modal linked-profile-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="Закрыть" onClick={() => setMode("none")}>×</button>{mode === "choose" ? <><h2>Привязать сообщество</h2><p>Вы можете создать новое сообщество или привязать уже существующий профиль.</p><div className="form-actions"><button className="outline-button" type="button" onClick={() => setMode("create")}>Создать новое</button><button className="primary-button" type="button" onClick={() => setMode("attach")}>Привязать существующее</button></div></> : <form onSubmit={submit}><h2>{mode === "create" ? "Новое сообщество" : "Вход в профиль сообщества"}</h2>{mode === "create" && <label>Название сообщества<input required value={name} onChange={(event) => setName(event.target.value)} /></label>}<label>E-mail<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Пароль<input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{mode === "attach" && <label>Код двухэтапной проверки (если включён)<input value={totp} onChange={(event) => setTotp(event.target.value)} /></label>}{notice && <p className="login-error">{notice}</p>}<button className="outline-button linked-google-button" type="button" disabled={busy} onClick={() => void googleLink()}>{mode === "create" ? "Зарегистрировать через Google" : "Войти через Google"}</button><div className="form-actions"><button type="button" onClick={() => setMode("choose")}>Назад</button><button className="primary-button" disabled={busy} type="submit">{busy ? "Проверяем…" : mode === "create" ? "Зарегистрировать" : "Войти"}</button></div></form>}</section></div>}</div>;
}

function ageFromDateInput(value?: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || now.getMonth() + 1 === month && now.getDate() < day) age -= 1;
  return Number.isFinite(age) && age >= 0 ? age : undefined;
}

type AdminImportBook = { author: string; title: string; isbn?: string; publisher?: string; annotation?: string; genres?: string[]; coverUrl?: string; url?: string; sourceUrl?: string; isAdult?: boolean };
type AdminImportConflict = { key: string; existing: AdminImportBook & { id: number; coverTone?: string }; incoming: AdminImportBook };

function AdminBookImport({ onComplete }: { onComplete: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [conflicts, setConflicts] = useState<AdminImportConflict[]>([]);
  const [details, setDetails] = useState<AdminImportBook | null>(null);
  const read = (row: Record<string, unknown>, aliases: string[]) => {
    const entry = Object.entries(row).find(([key]) => aliases.includes(key.trim().toLocaleLowerCase("ru")));
    return String(entry?.[1] ?? "").trim();
  };
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const rows = sourceRows.map((row) => ({
        author: read(row, ["автор", "author"]),
        title: read(row, ["название", "название книги", "title", "book"]),
        isbn: read(row, ["isbn", "isbn-13", "isbn13"]),
        publisher: read(row, ["издательство", "publisher"]),
        annotation: read(row, ["аннотация", "описание", "annotation", "description"]),
        genres: read(row, ["жанры", "жанр", "genres", "genre"]),
        coverUrl: read(row, ["обложка", "ссылка на обложку", "cover", "coverurl"]),
        sourceUrl: read(row, ["ссылка", "url", "source", "источник"]),
      })).filter((row) => row.author || row.title || row.sourceUrl);
      const response = await fetch("/api/admin/books/import/preview", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json() as { createdCount?: number; conflicts?: AdminImportConflict[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось импортировать каталог");
      setCreatedCount(data.createdCount ?? 0);
      setConflicts(data.conflicts ?? []);
      if (!(data.conflicts?.length)) onComplete();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось прочитать файл");
    } finally { setBusy(false); }
  }
  async function resolve(conflict: AdminImportConflict, action: "replace" | "supplement" | "duplicate") {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/books/import/resolve", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ existingId: conflict.existing.id, incoming: conflict.incoming, action }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось применить решение");
      setConflicts((current) => current.filter((item) => item.key !== conflict.key));
      if (conflicts.length === 1) onComplete();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Не удалось применить решение"); }
    finally { setBusy(false); }
  }
  const card = (book: AdminImportBook, label: string) => <button className="admin-import-book-card" type="button" onClick={() => setDetails(book)}><span>{label}</span><strong>{book.title || "Без названия"}</strong><small>{book.author || "Автор не указан"}</small>{book.isbn && <em>ISBN {book.isbn}</em>}</button>;
  return <section className="admin-book-import"><div><h2>Импорт каталога книг</h2><p>CSV, XLS или XLSX. Система использует знакомые поля карточки и проверяет ISBN, автора и название.</p></div><button className="outline-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Обрабатываем…" : "Загрузить файл"}</button><input ref={inputRef} hidden type="file" accept=".csv,.xls,.xlsx" onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} />{createdCount > 0 && <p className="admin-import-result">Добавлено новых книг: {createdCount}</p>}{conflicts.map((conflict) => <article className="admin-import-conflict" key={conflict.key}><div className="admin-import-comparison">{card(conflict.existing, "Уже есть")}{card(conflict.incoming, "Из файла")}</div><div className="admin-import-actions"><button type="button" onClick={() => void resolve(conflict, "replace")}>Заменить</button><button type="button" onClick={() => void resolve(conflict, "supplement")}>Дополнить</button><button type="button" onClick={() => void resolve(conflict, "duplicate")}>Дублировать</button></div></article>)}{details && <div className="nested-modal-backdrop" onMouseDown={() => setDetails(null)}><section className="admin-import-details" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setDetails(null)}>×</button><h2>{details.title}</h2><p><strong>{details.author}</strong></p>{details.publisher && <p>Издательство: {details.publisher}</p>}{details.isbn && <p>ISBN: {details.isbn}</p>}{details.annotation && <p>{details.annotation}</p>}</section></div>}</section>;
}

export function AdminTab({ events, occasions, users, reports, onModerate, onModerateOccasion, onModeratePublisher, onOpenChat, onOpenUser, onRefresh, onDeleteMaterial }: { events: BookEvent[]; occasions: Occasion[]; users: DemoUser[]; reports: SafetyReport[]; onModerate: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, event?: typeof emptyEvent, pinned?: boolean) => Promise<void>; onModerateOccasion: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, occasion?: typeof emptyOccasion) => Promise<void>; onModeratePublisher: (id: number, action: "accept" | "revision" | "reject", note?: string) => Promise<void>; onOpenChat: (userId: number) => void; onOpenUser: (userId: number) => void; onRefresh: () => void; onDeleteMaterial: (kind: AdminCatalogKind, id: number) => Promise<void> }) {
  const moderationEvents = events.filter((item) => item.status === "pending" || item.status === "needs_changes");
  const moderationOccasions = occasions.filter((item) => item.status === "pending" || item.status === "needs_changes");
  const [opened, setOpened] = useState<BookEvent | null>(null);
  const [openedOccasion, setOpenedOccasion] = useState<Occasion | null>(null);
  const [openedPublisher, setOpenedPublisher] = useState<DemoUser | null>(null);
  const [editing, setEditing] = useState<BookEvent | null>(null);
  const [editingOccasion, setEditingOccasion] = useState<Occasion | null>(null);
  const [note, setNote] = useState("");
  const [pinEvent, setPinEvent] = useState(false);
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [search, setSearch] = useState("");
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<AdminCatalogItem | null>(null);
  const [editingCatalogItem, setEditingCatalogItem] = useState<AdminCatalogItem | null>(null);
  const [statistics, setStatistics] = useState<AdminStatistics | null>(null);
  const [catalogBooks, setCatalogBooks] = useState<LibraryBook[] | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/admin/statistics", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить статистику");
        return response.json() as Promise<AdminStatistics>;
      })
      .then((data) => { if (active) setStatistics(data); })
      .catch((error) => console.warn(error));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/books/catalog", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить полный каталог книг");
        return response.json() as Promise<{ books?: Partial<LibraryBook>[] }>;
      })
      .then((data) => {
        if (!active) return;
        setCatalogBooks((data.books ?? []).map((book) => ({ events: 0, genres: [], pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", coverTone: "blue", annotation: "", author: "", title: "", ...book } as LibraryBook)));
      })
      .catch((error) => console.warn(error));
    return () => { active = false; };
  }, []);
  const creator = users.find((user) => user.id === (opened?.creatorId ?? openedOccasion?.creatorId));
  const moderationPublishers = users.filter((user) => ["Издатель", "Сообщество"].includes(user.profile.type) && ["pending", "needs_changes"].includes(user.profile.publisherStatus ?? ""));
  const total = moderationEvents.length + moderationOccasions.length + moderationPublishers.length;
  const books = catalogBooks ?? catalogFromUsers(users);
  const reviews = users.flatMap((user) => user.reviews.map((item) => ({ ...item, ownerId: user.id, ownerName: user.profile.name })));
  const publications = users.flatMap((user) => (user.excerpts ?? []).map((item) => ({ ...item, ownerId: user.id, ownerName: user.profile.name })));
  const publisherNews = users.flatMap((user) => (user.publisherNews ?? []).map((item) => ({ ...item, ownerId: user.id, ownerName: user.profile.name })));
  const remove = async (kind: AdminCatalogKind, id: number, title: string) => { if (window.confirm(`Удалить «${title}» без возможности восстановления?`)) await onDeleteMaterial(kind, id); };
  const catalogItems: Record<AdminMaterialKind, AdminCatalogItem[]> = {
    book: books.map((item) => ({ id: item.id, kind: "book", title: item.title, subtitle: item.author, text: item.annotation, coverUrl: item.coverUrl, coverTone: item.coverTone, source: item })),
    review: reviews.map((item) => ({ id: item.id, kind: "review", title: item.bookTitle, subtitle: `${item.ownerName} · ★ ${item.rating}`, text: item.preview, source: item })),
    excerpt: [
      ...publications.map((item) => ({ id: item.id, kind: "excerpt" as const, title: item.bookTitle || "Публикация", subtitle: item.ownerName, text: item.previewText || item.text, source: item })),
      ...publisherNews.map((item) => ({ id: item.id, kind: "publisher_news" as const, title: item.title, subtitle: `Новость ${users.find((user) => user.id === item.ownerId)?.profile.type === "Сообщество" ? "сообщества" : "издательства"} · ${item.ownerName}`, text: item.previewText, source: item })),
    ],
    event: events.map((item) => { const organizationType = users.find((user) => user.id === item.creatorId)?.profile.type; return { id: item.id, kind: "event", title: item.title, subtitle: `${organizationType === "Сообщество" ? "Событие сообщества · " : organizationType === "Издатель" ? "Событие издательства · " : ""}${item.city} · ${item.date}`, text: item.summary, source: item }; }),
    occasion: occasions.map((item) => ({ id: item.id, kind: "occasion", title: item.primaryText, subtitle: occasionLabels[item.type], text: item.audienceText, source: item })),
  };
  const labels: Record<AdminMaterialKind, string> = { book: "Книги", review: "Рецензии", excerpt: "Публикации", event: "События", occasion: "Поводы" };
  const saveCatalogItem = async (item: AdminCatalogItem, payload: unknown) => {
    const response = await fetch(`/api/admin/materials/${item.kind}/${item.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { window.alert(data.error ?? "Не удалось сохранить изменения"); return; }
    window.location.reload();
  };
  const startCatalogEdit = (item: AdminCatalogItem) => {
    setSelectedCatalogItem(null);
    if (item.kind === "event") { setEditing(item.source); return; }
    if (item.kind === "occasion") { setEditingOccasion(item.source); return; }
    setEditingCatalogItem(item);
  };
  if (section === "dashboard") return <div className="admin-tab admin-dashboard">
    <div className="profile-title-row"><div><span className="section-subtitle">Управление Book Meet</span><h1>Админка</h1><p>Материалы, жалобы и пользователи собраны по отдельным разделам.</p></div></div>
    <AdminStatisticsPanel statistics={statistics} />
    <button className="admin-moderation-button" type="button" onClick={() => setSection("moderation")}><span>Материалы на модерации</span><b>{total}</b></button>
    <div className="admin-dashboard-divider"><span>Все материалы</span></div>
    <div className="admin-section-buttons">{(["book", "review", "excerpt", "event", "occasion"] as AdminMaterialKind[]).map((kind) => <button type="button" key={kind} onClick={() => { setSection(kind); setSearch(""); }}><span>{labels[kind]}</span><b>{catalogItems[kind].length}</b></button>)}</div>
    <div className="admin-dashboard-divider"><span>Все жалобы</span></div>
    <div className="admin-section-buttons admin-report-buttons"><button type="button" onClick={() => setSection("reports-new")}><span>Новые жалобы</span><b>{reports.filter((item) => item.status === "new").length}</b></button><button type="button" onClick={() => setSection("reports-reviewed")}><span>Просмотренные</span><b>{reports.filter((item) => item.status === "reviewed").length}</b></button></div>
    <div className="admin-user-status-buttons"><button className="admin-moderation-button" type="button" onClick={() => setSection("users-active")}><span>Активные пользователи</span><b>{users.filter((item) => !item.isAdmin && !item.suspension && !item.deletedAt && !item.purged).length}</b></button><button className="admin-moderation-button danger" type="button" onClick={() => setSection("users-blocked")}><span>Заблокированные пользователи</span><b>{users.filter((item) => !item.isAdmin && item.suspension && !item.deletedAt && !item.purged).length}</b></button><button className="admin-moderation-button deleted" type="button" onClick={() => setSection("users-deleted")}><span>Удалённые пользователи</span><b>{users.filter((item) => !item.isAdmin && item.deletedAt && !item.purged).length}</b></button></div>
  </div>;
  if (["reports-new", "reports-reviewed", "users-active", "users-blocked", "users-deleted"].includes(section)) return <AdminSafetySection mode={section as "reports-new" | "reports-reviewed" | "users-active" | "users-blocked" | "users-deleted"} reports={reports} users={users} onBack={() => setSection("dashboard")} onOpenUser={onOpenUser} onOpenChat={onOpenChat} onRefresh={onRefresh} />;
  if (section !== "moderation") {
    const catalogSection = section as AdminMaterialKind;
    const items = catalogItems[catalogSection].filter((item) => `${item.title} ${item.subtitle}`.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))).sort((a, b) => b.id - a.id);
    return <div className="admin-tab admin-catalog-page"><div className="admin-catalog-heading"><button className="back-button" type="button" onClick={() => { setSection("dashboard"); setSelectedCatalogItem(null); }}>← В админку</button><div><span className="section-subtitle">Все материалы</span><h1>{labels[catalogSection]}</h1><p>{catalogItems[catalogSection].length} материалов · сначала новые</p></div><label className="admin-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию" /></label></div>{catalogSection === "book" && <AdminBookImport onComplete={onRefresh} />}<div className={`admin-catalog-grid ${catalogSection === "book" ? "admin-books-grid" : ""}`}>{items.map((item) => <AdminCatalogCard key={`${item.kind}-${item.id}`} item={item} onOpen={() => setSelectedCatalogItem(item)} />)}</div>{!items.length && <div className="profile-tab-placeholder">По вашему запросу ничего не найдено.</div>}{selectedCatalogItem && <AdminCatalogOverlay item={selectedCatalogItem} users={users} onClose={() => setSelectedCatalogItem(null)} onEdit={() => startCatalogEdit(selectedCatalogItem)} onDelete={async () => { await remove(selectedCatalogItem.kind, selectedCatalogItem.id, selectedCatalogItem.title); setSelectedCatalogItem(null); }} />}{editingCatalogItem && <AdminCatalogEditor item={editingCatalogItem} users={users} onClose={() => setEditingCatalogItem(null)} onSave={(payload) => void saveCatalogItem(editingCatalogItem, payload)} />}{editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm initial={editing} submitLabel="Сохранить изменения" onCancel={() => setEditing(null)} onSave={async (value) => { await onModerate(editing.id, "edit", "", value); setEditing(null); }} /></section></div>}{editingOccasion && <div className="modal-backdrop" onMouseDown={() => setEditingOccasion(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm initial={editingOccasion} submitLabel="Сохранить изменения" onCancel={() => setEditingOccasion(null)} onSave={async (value) => { await onModerateOccasion(editingOccasion.id, "edit", "", value); setEditingOccasion(null); }} /></section></div>}</div>;
  }
  if (section === "moderation") return <div className="admin-tab admin-moderation-page">
    <button className="back-button" type="button" onClick={() => setSection("dashboard")}>← В админку</button>
    <div className="profile-title-row"><div><span className="section-subtitle">Очередь проверки</span><h1>Материалы на модерации</h1><p>{total} материалов ожидают решения</p></div></div>
    {total ? <div className="admin-moderation-grid">
      {moderationEvents.map((item) => <article key={`moderation-event-${item.id}`}><EventStatusLabel status={item.status} /><span className="section-subtitle">Событие · {item.city}</span><h3>{item.title}</h3><p>{item.summary}</p><button className="outline-button" type="button" onClick={() => { setOpened(item); setOpenedOccasion(null); setNote(item.moderationNote ?? ""); setPinEvent(Boolean(item.pinned)); }}>Открыть и проверить</button></article>)}
      {moderationOccasions.map((item) => <article key={`moderation-occasion-${item.id}`}><EventStatusLabel status={item.status} /><span className="section-subtitle">Повод · {occasionLabels[item.type]}</span><h3>{item.primaryText}</h3><p>{item.audienceText}</p><button className="outline-button" type="button" onClick={() => { setOpenedOccasion(item); setOpened(null); setNote(item.moderationNote ?? ""); }}>Открыть и проверить</button></article>)}
      {moderationPublishers.map((item) => <article key={`moderation-publisher-${item.id}`}><span className="event-status event-status-pending">Профиль {item.profile.type === "Сообщество" ? "сообщества" : "издателя"}</span><span className="section-subtitle">Официальное подтверждение</span><h3>{item.profile.name}</h3><p>{item.profile.bio}</p><button className="outline-button" type="button" onClick={() => { setOpenedPublisher(item); setOpened(null); setOpenedOccasion(null); setNote(item.profile.publisherModerationNote ?? ""); }}>Открыть и проверить</button></article>)}
    </div> : <div className="profile-tab-placeholder">Материалов на модерации нет.</div>}
    {opened && <div className="modal-backdrop" onMouseDown={() => setOpened(null)}><section className="admin-event-modal" onMouseDown={(event) => event.stopPropagation()}>
      <ModalIconActions onEdit={() => setEditing(opened)} onDelete={async () => { await remove("event", opened.id, opened.title); setOpened(null); }} onClose={() => setOpened(null)} />
      <span className="section-subtitle">Модерация события</span><h2>{opened.title}</h2>
      <p><strong>{opened.date} · {opened.time} · {opened.city}</strong><br />{opened.address}</p><p>{opened.description}</p>
      {opened.bookTitle && <div className="moderation-linked-book"><strong>{opened.bookTitle}</strong><span>{opened.bookAuthor}</span></div>}
      <label className="admin-pin-toggle"><input type="checkbox" checked={pinEvent} onChange={(event) => setPinEvent(event.target.checked)} /><span>Закрепить событие в начале списка</span></label>
      <label className="moderation-comment">Комментарий пользователю<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="admin-event-actions">{creator && <button className="outline-button" type="button" onClick={() => onOpenChat(creator.id)}>Написать пользователю</button>}<button className="outline-button" type="button" onClick={async () => { await onModerate(opened.id, "revision", note); setOpened(null); }}>На доработку</button><button className="quiet-danger-button" type="button" onClick={async () => { await onModerate(opened.id, "reject", note); setOpened(null); }}>Отклонить</button><button className="primary-button" type="button" onClick={async () => { await onModerate(opened.id, "accept", "", undefined, pinEvent); setOpened(null); }}>Принять</button></div>
    </section></div>}
    {openedOccasion && <div className="modal-backdrop" onMouseDown={() => setOpenedOccasion(null)}><section className="admin-event-modal" onMouseDown={(event) => event.stopPropagation()}><ModalIconActions onEdit={() => setEditingOccasion(openedOccasion)} onDelete={async () => { await remove("occasion", openedOccasion.id, openedOccasion.primaryText); setOpenedOccasion(null); }} onClose={() => setOpenedOccasion(null)} /><span className="section-subtitle">Модерация повода · {occasionLabels[openedOccasion.type]}</span><h2>{openedOccasion.primaryText}</h2><p>{openedOccasion.audienceText}</p><label className="moderation-comment">Комментарий пользователю<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="admin-event-actions">{creator && <button className="outline-button" type="button" onClick={() => onOpenChat(creator.id)}>Написать пользователю</button>}<button className="outline-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "revision", note); setOpenedOccasion(null); }}>На доработку</button><button className="quiet-danger-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "reject", note); setOpenedOccasion(null); }}>Отклонить</button><button className="primary-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "accept"); setOpenedOccasion(null); }}>Принять</button></div></section></div>}
    {openedPublisher && <div className="modal-backdrop" onMouseDown={() => setOpenedPublisher(null)}><section className="admin-event-modal publisher-moderation-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setOpenedPublisher(null)}>×</button><span className="section-subtitle">Подтверждение {openedPublisher.profile.type === "Сообщество" ? "сообщества" : "издательства"}</span><h2>{openedPublisher.profile.name}</h2><p>{openedPublisher.profile.bio}</p><dl>{openedPublisher.profile.type === "Сообщество" ? <><dt>Тип сообщества</dt><dd>{openedPublisher.profile.communityType}</dd><dt>Правила вступления/участия</dt><dd>{openedPublisher.profile.communityRules}</dd></> : <><dt>Сайт</dt><dd>{openedPublisher.profile.publisherWebsite}</dd><dt>Юридическое название</dt><dd>{openedPublisher.profile.publisherLegalName}</dd><dt>БИН</dt><dd>{openedPublisher.profile.publisherBin}</dd><dt>Расчётный счёт</dt><dd>{openedPublisher.profile.publisherAccount}</dd><dt>БИК и банк</dt><dd>{openedPublisher.profile.publisherBik} · {openedPublisher.profile.publisherBank}</dd><dt>Юридический адрес</dt><dd>{openedPublisher.profile.publisherLegalAddress}</dd><dt>Почтовый адрес</dt><dd>{openedPublisher.profile.publisherPostalAddress}</dd></>}</dl><label className="moderation-comment">Комментарий {openedPublisher.profile.type === "Сообщество" ? "сообществу" : "издательству"}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="admin-event-actions"><button className="outline-button" type="button" onClick={() => onOpenChat(openedPublisher.id)}>Написать пользователю</button><button className="outline-button" type="button" onClick={async () => { await onModeratePublisher(openedPublisher.id, "revision", note); setOpenedPublisher(null); }}>На доработку</button><button className="quiet-danger-button" type="button" onClick={async () => { await onModeratePublisher(openedPublisher.id, "reject", note); setOpenedPublisher(null); }}>Отклонить</button><button className="primary-button" type="button" onClick={async () => { await onModeratePublisher(openedPublisher.id, "accept"); setOpenedPublisher(null); }}>Подтвердить</button></div></section></div>}
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm initial={editing} catalog={books} submitLabel="Сохранить изменения" onCancel={() => setEditing(null)} onSave={async (value) => { await onModerate(editing.id, "edit", "", value); setEditing(null); setOpened(null); }} /></section></div>}
    {editingOccasion && <div className="modal-backdrop" onMouseDown={() => setEditingOccasion(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm initial={editingOccasion} submitLabel="Сохранить изменения" onCancel={() => setEditingOccasion(null)} onSave={async (value) => { await onModerateOccasion(editingOccasion.id, "edit", "", value); setEditingOccasion(null); setOpenedOccasion(null); }} /></section></div>}
  </div>;
  return <div className="admin-tab"><div className="profile-title-row"><div><h1>Админка</h1><p>{total} {total === 1 ? "материал ожидает" : "материалов ожидают"} модерации</p></div></div>{total ? <div className="admin-moderation-grid">{moderationEvents.map((item) => <article key={`event-${item.id}`}><EventStatusLabel status={item.status} /><span className="section-subtitle">Событие · {item.city} · {item.date}</span><h3>{item.title}</h3><p>{item.summary}</p><button className="outline-button" type="button" onClick={() => { setOpened(item); setOpenedOccasion(null); setNote(item.moderationNote ?? ""); }}>Открыть и проверить</button></article>)}{moderationOccasions.map((item) => <article key={`occasion-${item.id}`}><EventStatusLabel status={item.status} /><span className="section-subtitle">Повод · {occasionLabels[item.type]}</span><h3>{item.primaryText}</h3><p>{item.audienceText}</p><button className="outline-button" type="button" onClick={() => { setOpenedOccasion(item); setOpened(null); setNote(item.moderationNote ?? ""); }}>Открыть и проверить</button></article>)}</div> : <div className="profile-tab-placeholder">Материалов на модерации нет.</div>}
    <section className="admin-materials"><div><h2>Все материалы</h2><p>Администратор может удалить любой опубликованный или ожидающий материал.</p></div><div className="admin-material-groups">
      <div><h3>Книги · {books.length}</h3>{books.map((item) => <article key={`book-${item.id}`}><span>{item.author}</span><strong>{item.title}</strong><button className="quiet-danger-button" type="button" onClick={() => remove("book", item.id, item.title)}>Удалить</button></article>)}</div>
      <div><h3>Рецензии · {reviews.length}</h3>{reviews.map((item) => <article key={`review-${item.id}`}><span>{item.ownerName}</span><strong>{item.bookTitle}</strong><button className="quiet-danger-button" type="button" onClick={() => remove("review", item.id, item.bookTitle)}>Удалить</button></article>)}</div>
      <div><h3>Публикации · {publications.length}</h3>{publications.map((item) => <article key={`excerpt-${item.id}`}><span>{item.ownerName}</span><strong>{item.bookTitle || item.previewText.slice(0, 60) || "Публикация"}</strong><button className="quiet-danger-button" type="button" onClick={() => remove("excerpt", item.id, item.bookTitle || "Публикация")}>Удалить</button></article>)}</div>
      <div><h3>События · {events.length}</h3>{events.map((item) => <article key={`all-event-${item.id}`}><span>{item.city} · {item.status}</span><strong>{item.title}</strong><button className="quiet-danger-button" type="button" onClick={() => remove("event", item.id, item.title)}>Удалить</button></article>)}</div>
      <div><h3>Поводы · {occasions.length}</h3>{occasions.map((item) => <article key={`all-occasion-${item.id}`}><span>{occasionLabels[item.type]} · {item.status}</span><strong>{item.primaryText}</strong><button className="quiet-danger-button" type="button" onClick={() => remove("occasion", item.id, item.primaryText)}>Удалить</button></article>)}</div>
    </div></section>
    {opened && <div className="modal-backdrop" onMouseDown={() => setOpened(null)}><section className="admin-event-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setOpened(null)}>×</button><span className="section-subtitle">Модерация события</span><h2>{opened.title}</h2><p><strong>{opened.date} · {opened.time} · {opened.city}</strong><br />{opened.address}</p><p>{opened.description}</p>{creator && <p>Создал: <button className="inline-user-link" type="button" onClick={() => onOpenChat(creator.id)}>{creator.profile.name}</button></p>}<label className="moderation-comment">Комментарий пользователю<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Для доработки или отказа" /></label><div className="admin-event-actions">{creator && <button className="outline-button" type="button" onClick={() => onOpenChat(creator.id)}>Написать пользователю</button>}<button className="outline-button" type="button" onClick={() => setEditing(opened)}>Редактировать</button><button className="outline-button" type="button" onClick={async () => { await onModerate(opened.id, "revision", note); setOpened(null); }}>На доработку</button><button className="quiet-danger-button" type="button" onClick={async () => { await onModerate(opened.id, "reject", note); setOpened(null); }}>Отклонить</button><button className="primary-button" type="button" onClick={async () => { await onModerate(opened.id, "accept"); setOpened(null); }}>Принять</button></div></section></div>}{openedOccasion && <div className="modal-backdrop" onMouseDown={() => setOpenedOccasion(null)}><section className="admin-event-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setOpenedOccasion(null)}>×</button><span className="section-subtitle">Модерация повода · {occasionLabels[openedOccasion.type]}</span><h2>{openedOccasion.primaryText}</h2><p>{openedOccasion.audienceText}</p><p>{openedOccasion.targetCities.join(", ")} · {openedOccasion.targetGender} · {openedOccasion.targetProfileType}</p>{creator && <p>Создал: <button className="inline-user-link" type="button" onClick={() => onOpenChat(creator.id)}>{creator.profile.name}</button></p>}<label className="moderation-comment">Комментарий пользователю<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Для доработки или отказа" /></label><div className="admin-event-actions">{creator && <button className="outline-button" type="button" onClick={() => onOpenChat(creator.id)}>Написать пользователю</button>}<button className="outline-button" type="button" onClick={() => setEditingOccasion(openedOccasion)}>Редактировать</button><button className="outline-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "revision", note); setOpenedOccasion(null); }}>На доработку</button><button className="quiet-danger-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "reject", note); setOpenedOccasion(null); }}>Отклонить</button><button className="primary-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "accept"); setOpenedOccasion(null); }}>Принять</button></div></section></div>}{editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm initial={editing} submitLabel="Сохранить изменения" onCancel={() => setEditing(null)} onSave={async (value) => { await onModerate(editing.id, "edit", "", value); setEditing(null); setOpened(null); }} /></section></div>}{editingOccasion && <div className="modal-backdrop" onMouseDown={() => setEditingOccasion(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm initial={editingOccasion} submitLabel="Сохранить изменения" onCancel={() => setEditingOccasion(null)} onSave={async (value) => { await onModerateOccasion(editingOccasion.id, "edit", "", value); setEditingOccasion(null); setOpenedOccasion(null); }} /></section></div>}</div>;
}

export function AdminSecurityPanel({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [action, setAction] = useState<"regenerate" | "disable" | null>(null);

  async function loadStatus() {
    const response = await fetch("/api/auth/totp/status", { credentials: "same-origin" });
    const data = await response.json() as TotpStatus & { error?: string };
    if (!response.ok) throw new Error(data.error || "Не удалось проверить состояние защиты");
    setStatus(data);
  }

  useEffect(() => {
    loadStatus().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось проверить состояние защиты"));
  }, []);

  async function post<T>(url: string, body: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройку");
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function startSetup(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await post<TotpSetup>("/api/auth/totp/setup/start", { password });
      setSetup(data);
      setPassword("");
      setCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать ключ");
    }
  }

  async function confirmSetup(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await post<{ enabled: boolean; recoveryCodes: string[] }>("/api/auth/totp/setup/confirm", { code });
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode("");
      setStatus({ enabled: true, pending: false, recoveryCodesLeft: data.recoveryCodes.length });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось подтвердить код");
    }
  }

  async function protectedAction(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    try {
      if (action === "regenerate") {
        const data = await post<{ recoveryCodes: string[] }>("/api/auth/totp/recovery/regenerate", { password, code });
        setRecoveryCodes(data.recoveryCodes);
        setStatus((current) => current ? { ...current, recoveryCodesLeft: data.recoveryCodes.length } : current);
      } else {
        if (!window.confirm("Отключить двухэтапную аутентификацию администратора?")) return;
        await post<{ disabled: boolean }>("/api/auth/totp/disable", { password, code });
        setStatus({ enabled: false, pending: false, recoveryCodesLeft: 0 });
      }
      setPassword("");
      setCode("");
      setAction(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить настройку");
    }
  }

  function recoveryText() {
    return `Резервные коды Book Meet\n\n${recoveryCodes.join("\n")}\n\nКаждый код можно использовать только один раз.`;
  }

  async function copyRecoveryCodes() {
    await navigator.clipboard.writeText(recoveryText());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function downloadRecoveryCodes() {
    const url = URL.createObjectURL(new Blob([recoveryText()], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "book-meet-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return <div className="admin-security">
    <button className="back-button" type="button" onClick={onBack}>← В админку</button>
    <div className="profile-title-row"><div><span className="section-subtitle">Безопасность аккаунта</span><h1>Двухэтапная аутентификация</h1><p>Защитите вход администратора одноразовым кодом из Google Authenticator.</p></div></div>
    {error && <div className="security-message security-error">{error}</div>}
    {!status && !error && <div className="profile-tab-placeholder">Проверяем состояние защиты…</div>}
    {recoveryCodes.length > 0 ? <section className="security-card recovery-card">
      <span className="security-status enabled">Защита включена</span>
      <h2>Сохраните резервные коды</h2>
      <p>Они показаны только сейчас. Каждый код заменяет одноразовый код Authenticator и срабатывает один раз.</p>
      <div className="recovery-code-grid">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
      <div className="security-actions"><button className="outline-button" type="button" onClick={() => void copyRecoveryCodes()}>{copied ? "Скопировано" : "Скопировать"}</button><button className="outline-button" type="button" onClick={downloadRecoveryCodes}>Скачать файлом</button><button className="primary-button" type="button" onClick={() => setRecoveryCodes([])}>Я сохранил коды</button></div>
    </section> : status && !status.enabled ? <section className="security-card">
      <span className="security-status disabled">Защита не подключена</span>
      {!setup ? <>
        <h2>Подключить Google Authenticator</h2>
        <p>Сначала подтвердите текущий пароль. QR-код будет действовать 10 минут, а защита включится только после проверки первого кода.</p>
        {status.pending && <div className="security-message">Предыдущая настройка не завершена. Новый QR-код безопасно заменит её.</div>}
        <form className="security-form" onSubmit={startSetup}><label>Текущий пароль<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Создаём…" : "Создать QR-код"}</button></form>
      </> : <>
        <h2>Добавьте Book Meet в приложение</h2>
        <div className="totp-setup-grid"><div className="totp-qr"><img src={setup.qrDataUrl} alt="QR-код для Google Authenticator" /></div><div><ol><li>Откройте Google Authenticator.</li><li>Нажмите «+» и выберите сканирование QR-кода.</li><li>Отсканируйте код слева.</li><li>Введите появившийся шестизначный код ниже.</li></ol><div className="manual-totp-key"><span>Ключ для ручного ввода</span><code>{setup.secret}</code></div></div></div>
        <form className="security-form security-confirm-form" onSubmit={confirmSetup}><label>Код из приложения<input required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label><button className="primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? "Проверяем…" : "Подтвердить и включить"}</button></form>
      </>}
    </section> : status?.enabled ? <section className="security-card">
      <span className="security-status enabled">Защита включена</span>
      <h2>Google Authenticator подключён</h2>
      <p>После пароля Book Meet запрашивает одноразовый код. Неиспользованных резервных кодов: <strong>{status.recoveryCodesLeft}</strong>.</p>
      {!action ? <div className="security-actions"><button className="outline-button" type="button" onClick={() => setAction("regenerate")}>Создать новые резервные коды</button><button className="quiet-danger-button" type="button" onClick={() => setAction("disable")}>Отключить защиту</button></div> : <form className="security-form protected-security-form" onSubmit={protectedAction}><h3>{action === "regenerate" ? "Новые резервные коды заменят старые" : "Подтвердите отключение защиты"}</h3><label>Текущий пароль<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Код из приложения{action === "disable" ? " или резервный код" : ""}<input required autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 19))} placeholder={action === "disable" ? "000000 или BM-XXXX-XXXX-XXXX" : "000000"} /></label><div className="security-actions"><button type="button" onClick={() => { setAction(null); setPassword(""); setCode(""); }}>Отмена</button><button className={action === "disable" ? "danger-button" : "primary-button"} type="submit" disabled={busy}>{busy ? "Проверяем…" : action === "disable" ? "Отключить" : "Создать коды"}</button></div></form>}
    </section> : null}
  </div>;
}

export function AdminProfile({ onBack, onLogout, events, occasions, users, reports, onModerateEvent, onModerateOccasion, onModeratePublisher, onOpenChat, onOpenUser, onRefresh, onDeleteMaterial }: { onBack: () => void; onLogout: () => void; events: BookEvent[]; occasions: Occasion[]; users: DemoUser[]; reports: SafetyReport[]; onModerateEvent: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, event?: typeof emptyEvent, pinned?: boolean) => Promise<void>; onModerateOccasion: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, occasion?: typeof emptyOccasion) => Promise<void>; onModeratePublisher: (id: number, action: "accept" | "revision" | "reject", note?: string) => Promise<void>; onOpenChat: (userId: number) => void; onOpenUser: (userId: number) => void; onRefresh: () => void; onDeleteMaterial: (kind: AdminCatalogKind, id: number) => Promise<void> }) {
  const [securityOpen, setSecurityOpen] = useState(false);
  return <main className="my-profile-page admin-profile-page"><div className="profile-page-topbar"><button type="button" className="back-button" onClick={onBack}>← На главную</button><div className="admin-profile-top-actions">{!securityOpen && <button type="button" className="outline-button" onClick={() => setSecurityOpen(true)}>Безопасность</button>}<button type="button" className="back-button" onClick={onLogout}>Выйти</button></div></div><section className="admin-profile-card">{securityOpen ? <AdminSecurityPanel onBack={() => setSecurityOpen(false)} /> : <AdminTab events={events} occasions={occasions} users={users} reports={reports} onModerate={onModerateEvent} onModerateOccasion={onModerateOccasion} onModeratePublisher={onModeratePublisher} onOpenChat={onOpenChat} onOpenUser={onOpenUser} onRefresh={onRefresh} onDeleteMaterial={onDeleteMaterial} />}</section></main>;
}

export function MyProfile({ onBack, user, users, friends, friendRequests, follows, events, occasions, likes, initialAction, initialEditId, initialEditing = false, onProfileCompleted, onToggleLike, onComment, onEditEvent, onDeleteEvent, onEditOccasion, onDeleteOccasion, onModerateEvent, onModerateOccasion, onLogout, onUserChange, onHomeViewChange, onOpenUser, onOpenChat }: { onBack: () => void; user: DemoUser; users: DemoUser[]; friends: DemoUser[]; friendRequests: FriendRequest[]; follows: Follow[]; events: BookEvent[]; occasions: Occasion[]; likes: Record<string, number[]>; initialAction?: "review" | "excerpt" | "book" | null; initialEditId?: number | null; initialEditing?: boolean; onProfileCompleted?: () => void; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onEditEvent: (item: BookEvent) => void; onDeleteEvent: (id: number) => void; onEditOccasion: (item: Occasion) => void; onDeleteOccasion: (id: number) => void; onModerateEvent: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, event?: typeof emptyEvent, pinned?: boolean) => Promise<void>; onModerateOccasion: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, occasion?: typeof emptyOccasion) => Promise<void>; onLogout: () => void; onUserChange: (user: DemoUser) => Promise<void>; onHomeViewChange: (homeView: "classic" | "feed") => Promise<void>; onOpenUser: (userId: number) => void; onOpenChat: (userId: number) => void }) {
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialAction === "review" ? "reviews" : initialAction === "excerpt" ? "excerpts" : initialAction === "book" ? "library" : profileTabFromPathname(window.location.pathname));
  const [openedOwnOccasion, setOpenedOwnOccasion] = useState<Occasion | null>(null);
  const [openedOwnOccasionBookId, setOpenedOwnOccasionBookId] = useState<number | null>(null);
  const [editing, setEditing] = useState(initialEditing || new URLSearchParams(window.location.search).get("linked-create") === "1");
  const [saved, setSaved] = useState(false);
  const [books, setBooks] = useState(user.books);
  const [reviews, setReviews] = useState(user.reviews);
  const [authorBooks, setAuthorBooks] = useState(user.authorBooks ?? []);
  const [userExcerpts, setUserExcerpts] = useState(user.excerpts ?? []);
  const [publisherNews, setPublisherNews] = useState(user.publisherNews ?? []);
  const [wishBooks, setWishBooks] = useState(user.wishBooks ?? []);
  const [profile, setProfile] = useState(user.profile);
  const [tabOrderDraft, setTabOrderDraft] = useState<ProfileTab[]>(user.profile.tabOrder ?? []);
  const [hiddenTabsDraft, setHiddenTabsDraft] = useState<ProfileTab[]>(user.profile.hiddenProfileTabs ?? []);
  const [reorderingTabs, setReorderingTabs] = useState(false);
  const [draggedTab, setDraggedTab] = useState<ProfileTab | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [invalidFields, setInvalidFields] = useState({ name: false, city: false, birthDate: false });
  const [requiredNotice, setRequiredNotice] = useState(false);
  const [unsavedNotice, setUnsavedNotice] = useState(false);
  const [publisherTypeNotice, setPublisherTypeNotice] = useState(false);
  const [pendingOrganizationType, setPendingOrganizationType] = useState<"Издатель" | "Сообщество">("Издатель");
  const [deleteProfileConfirm, setDeleteProfileConfirm] = useState(false);
  const [homeView, setHomeView] = useState<"classic" | "feed">(user.profile.homeView ?? "feed");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const tabRowRefs = useRef(new Map<ProfileTab, HTMLDivElement>());
  const previousTabPositions = useRef(new Map<ProfileTab, number>());
  const savedProfileRef = useRef(user.profile);
  const savedAvatarUrlRef = useRef(user.avatarUrl);
  const savedMaterialStateRef = useRef(JSON.stringify([user.books, user.reviews, user.authorBooks ?? [], user.excerpts ?? [], user.publisherNews ?? [], user.wishBooks ?? []]));
  const pendingExitRef = useRef<null | (() => void)>(null);
  const hasUnsavedChanges = editing && (
    JSON.stringify(profile) !== JSON.stringify(savedProfileRef.current)
    || avatarUrl !== savedAvatarUrlRef.current
  );

  useEffect(() => {
    const materialState = JSON.stringify([books, reviews, authorBooks, userExcerpts, publisherNews, wishBooks]);
    if (materialState === savedMaterialStateRef.current) return;
    savedMaterialStateRef.current = materialState;
    void onUserChange({ ...user, profile, books, reviews, authorBooks, excerpts: userExcerpts, publisherNews, wishBooks }).catch((error) => console.warn(error));
  }, [books, reviews, authorBooks, userExcerpts, publisherNews, wishBooks]);

  useEffect(() => {
    const syncProfileTab = () => setActiveTab(profileTabFromPathname(window.location.pathname));
    window.addEventListener("popstate", syncProfileTab);
    return () => window.removeEventListener("popstate", syncProfileTab);
  }, []);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  function leaveOrWarn(action: () => void) {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    pendingExitRef.current = action;
    setUnsavedNotice(true);
  }

  async function chooseHomeView(nextHomeView: "classic" | "feed") {
    const previousHomeView = homeView;
    setHomeView(nextHomeView);
    setProfile((current) => ({ ...current, homeView: nextHomeView }));
    try {
      await onHomeViewChange(nextHomeView);
    } catch (error) {
      setHomeView(previousHomeView);
      setProfile((current) => ({ ...current, homeView: previousHomeView }));
      window.alert(error instanceof Error ? error.message : "Не удалось сохранить вид главной страницы");
    }
  }

  function discardChangesAndLeave() {
    const action = pendingExitRef.current;
    setProfile(savedProfileRef.current);
    setAvatarUrl(savedAvatarUrlRef.current);
    setInvalidFields({ name: false, city: false, birthDate: false });
    setEditing(false);
    setUnsavedNotice(false);
    pendingExitRef.current = null;
    action?.();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const publisher = ["Издатель", "Сообщество"].includes(profile.type);
    const publisherRequired = profile.type === "Издатель" && [
      profile.publisherWebsite, profile.bio, profile.publisherLegalName, profile.publisherBin,
      profile.publisherAccount, profile.publisherBik, profile.publisherBank,
      profile.publisherLegalAddress, profile.publisherPostalAddress,
    ].some((value) => !String(value ?? "").trim());
    const communityRequired = profile.type === "Сообщество" && [profile.communityType, profile.bio, profile.communityRules].some((value) => !String(value ?? "").trim());
    const nextInvalid = { name: !profile.name.trim(), city: !profile.cityId, birthDate: !publisher && !profile.birthDate };
    if (nextInvalid.name || nextInvalid.city || nextInvalid.birthDate || publisherRequired || communityRequired) {
      setInvalidFields(nextInvalid);
      setRequiredNotice(true);
      return;
    }
    const cleanProfile = { ...profile, name: profile.name.trim(), age: publisher ? undefined : ageFromDateInput(profile.birthDate) };
    try {
      await onUserChange({ ...user, initials: cleanProfile.name.slice(0, 2).toUpperCase(), avatarUrl, profile: cleanProfile, books, reviews, authorBooks, excerpts: userExcerpts, publisherNews, wishBooks });
    } catch (error) {
      console.warn(error);
      window.alert("Не удалось сохранить профиль. Проверьте соединение и попробуйте ещё раз.");
      return;
    }
    savedProfileRef.current = cleanProfile;
    savedAvatarUrlRef.current = avatarUrl;
    setProfile(cleanProfile);
    setInvalidFields({ name: false, city: false, birthDate: false });
    setEditing(false);
    onProfileCompleted?.();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function changeAvatar(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      window.alert("Выберите изображение JPG, PNG или WebP размером до 8 МБ.");
      return;
    }
    const source = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = source;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) return;
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      setAvatarUrl(canvas.toDataURL("image/webp", 0.82));
      setEditing(true);
    } finally {
      URL.revokeObjectURL(source);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  function openTab(tab: ProfileTab) {
    leaveOrWarn(() => {
      setEditing(false);
      setActiveTab(tab);
      const nextPath = profileTabPaths[tab as keyof typeof profileTabPaths] ?? "/profile";
      if (normalizedPathname(window.location.pathname) !== nextPath) {
        window.history.pushState({ bookMeetProfileTab: tab }, "", nextPath);
      }
    });
  }

  const profileTabs = ([
    { key: "main", label: "Основное" },
    profile.type === "Писатель" ? { key: "author-books", label: `Мои книги · ${authorBooks.length}` } : null,
    profile.type === "Издатель" ? { key: "author-books", label: `Книги издательства · ${authorBooks.length}` } : null,
    profile.type === "Сообщество" ? { key: "author-books", label: `Книги сообщества · ${authorBooks.length}` } : null,
    profile.type === "Писатель" || profile.type === "Блогер" ? { key: "excerpts", label: `Мой блог · ${userExcerpts.length}` } : null,
    profile.type === "Издатель" ? { key: "events", label: `События издательства · ${events.filter((item) => item.creatorId === user.id).length}` } : null,
    profile.type === "Сообщество" ? { key: "events", label: `События сообщества · ${events.filter((item) => item.creatorId === user.id).length}` } : null,
    profile.type === "Издатель" ? { key: "publisher-news", label: `Новости издательства · ${publisherNews.length}` } : null,
    profile.type === "Сообщество" ? { key: "publisher-news", label: `Новости сообщества · ${publisherNews.length}` } : null,
    !["Издатель", "Сообщество"].includes(profile.type) ? { key: "library", label: `Моя библиотека · ${books.length}` } : null,
    profile.type === "Читатель" || profile.type === "Блогер" ? { key: "wishlist", label: `Хочу почитать! · ${wishBooks.length}` } : null,
    profile.type === "Читатель" || profile.type === "Блогер" ? { key: "reviews", label: `Мои рецензии · ${reviews.length}` } : null,
    !["Издатель", "Сообщество"].includes(profile.type) ? { key: "events", label: `Мои мероприятия · ${events.filter((item) => item.creatorId === user.id).length + events.filter((item) => item.creatorId !== user.id && item.reminderSet).length}` } : null,
    !["Издатель", "Сообщество"].includes(profile.type) ? { key: "occasions", label: `Мои поводы · ${occasions.filter((item) => item.creatorId === user.id).length}` } : null,
    { key: "friends", label: profile.type === "Сообщество" ? `Участники сообщества · ${friends.length}` : profile.type === "Издатель" ? `Подписки · ${follows.filter((item) => item.followerId === user.id).length}` : `Мои друзья · ${friends.length}` },
  ].filter(Boolean) as Array<{ key: ProfileTab; label: string }>);
  const defaultTabOrder = profileTabs.map((item) => item.key);
  const normalizedTabOrder = ["main" as ProfileTab, ...tabOrderDraft.filter((tab) => tab !== "main" && defaultTabOrder.includes(tab)), ...defaultTabOrder.filter((tab) => tab !== "main" && !tabOrderDraft.includes(tab))];
  const orderedProfileTabs = normalizedTabOrder.map((tab) => profileTabs.find((item) => item.key === tab)).filter((item): item is { key: ProfileTab; label: string } => Boolean(item)).filter((item) => item.key === "main" || !hiddenTabsDraft.includes(item.key));

  useEffect(() => {
    if (activeTab === "main" || activeTab === "settings" || !hiddenTabsDraft.includes(activeTab)) return;
    setActiveTab("main");
    window.history.replaceState({ bookMeetProfileTab: "main" }, "", "/profile");
  }, [activeTab, hiddenTabsDraft]);

  useLayoutEffect(() => {
    for (const [tab, element] of tabRowRefs.current) {
      const previousTop = previousTabPositions.current.get(tab);
      const currentTop = element.getBoundingClientRect().top;
      if (previousTop !== undefined && previousTop !== currentTop) {
        element.animate(
          [{ transform: `translateY(${previousTop - currentTop}px)` }, { transform: "translateY(0)" }],
          { duration: 180, easing: "ease-out" },
        );
      }
      previousTabPositions.current.set(tab, currentTop);
    }
  }, [tabOrderDraft]);

  function moveDraggedTab(target: ProfileTab) {
    if (!draggedTab || draggedTab === "main" || target === "main" || draggedTab === target) return;
    for (const [tab, element] of tabRowRefs.current) previousTabPositions.current.set(tab, element.getBoundingClientRect().top);
    const fromIndex = normalizedTabOrder.indexOf(draggedTab);
    const targetIndex = normalizedTabOrder.indexOf(target);
    const next = normalizedTabOrder.filter((tab) => tab !== draggedTab);
    const remainingTargetIndex = next.indexOf(target);
    next.splice(fromIndex < targetIndex ? remainingTargetIndex + 1 : remainingTargetIndex, 0, draggedTab);
    setTabOrderDraft(next);
  }

  async function deleteProfile() {
    const response = await fetch("/api/users/me/profile", { method: "DELETE", credentials: "same-origin" });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      window.alert(data.error ?? "Не удалось удалить профиль");
      return;
    }
    window.location.assign("/");
  }

  async function applyTabOrder() {
    const nextProfile = { ...profile, tabOrder: normalizedTabOrder };
    await onUserChange({ ...user, profile: nextProfile, books, reviews, authorBooks, excerpts: userExcerpts, publisherNews, wishBooks });
    setProfile(nextProfile);
    savedProfileRef.current = nextProfile;
    setTabOrderDraft(normalizedTabOrder);
    setReorderingTabs(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function toggleProfileTabVisibility(tab: ProfileTab, visible: boolean) {
    if (tab === "main" || tab === "settings") return;
    const previousHidden = hiddenTabsDraft;
    const previousProfile = profile;
    const nextHidden = visible ? hiddenTabsDraft.filter((item) => item !== tab) : [...new Set([...hiddenTabsDraft, tab])];
    const nextProfile = { ...profile, hiddenProfileTabs: nextHidden };
    setHiddenTabsDraft(nextHidden);
    setProfile(nextProfile);
    if (!visible && activeTab === tab) openTab("main");
    try {
      await onUserChange({ ...user, profile: nextProfile, books, reviews, authorBooks, excerpts: userExcerpts, publisherNews, wishBooks });
      savedProfileRef.current = nextProfile;
    } catch (error) {
      setHiddenTabsDraft(previousHidden);
      setProfile(previousProfile);
      console.warn(error);
      window.alert("Не удалось изменить видимость меню. Проверьте соединение и попробуйте ещё раз.");
    }
  }

  return (
    <main className="my-profile-page">
      <div className="profile-page-topbar">
        <button type="button" className="back-button" onClick={() => leaveOrWarn(onBack)}>← На главную</button>
        <div className="profile-top-actions">{saved && <span className="saved-toast">Изменения сохранены</span>}<button type="button" className="back-button" onClick={() => leaveOrWarn(onLogout)}>Выйти</button></div>
      </div>
      <section className="my-profile-card">
        <div className="my-profile-aside">
          <div className={`avatar avatar-xl avatar-user ${avatarUrl ? "has-photo" : ""}`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && user.initials}<span className="online-dot" /></div>
          <input ref={avatarInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void changeAvatar(event.target.files?.[0])} />
          <button type="button" className="change-photo" onClick={() => avatarInputRef.current?.click()}>Сменить фото</button>
          <nav className="profile-nav" aria-label="Разделы профиля">
            {orderedProfileTabs.map((item) => <div ref={(element) => { if (element) tabRowRefs.current.set(item.key, element); else tabRowRefs.current.delete(item.key); }} className={`profile-nav-row ${reorderingTabs ? "is-reordering" : ""}`} key={item.key} onDragOver={(event) => { if (reorderingTabs) event.preventDefault(); }} onDragEnter={() => moveDraggedTab(item.key)} onDrop={() => setDraggedTab(null)}>
              {reorderingTabs && item.key !== "main" && <span className="profile-tab-drag-handle" draggable onDragStart={() => { for (const [tab, element] of tabRowRefs.current) previousTabPositions.current.set(tab, element.getBoundingClientRect().top); setDraggedTab(item.key); }} onDragEnd={() => setDraggedTab(null)} aria-label={`Переместить вкладку ${item.label}`} title="Перетащите вкладку">☰</span>}
              <button className={activeTab === item.key ? "active" : ""} type="button" onClick={() => openTab(item.key)}>{item.label}</button>
            </div>)}
            <button className={activeTab === "settings" ? "active" : ""} type="button" onClick={() => openTab("settings")}>Настройки</button>
          </nav>
        </div>
        <div className={`my-profile-main ${activeTab === "library" ? "library-main" : ""}`}>
          {activeTab === "main" && <>
            <div className="profile-title-row">
              <div><h1>{profile.name}</h1><p>{profile.type}{profile.city ? ` · ${profile.city}` : ""}</p></div>
              {!editing && <div className="profile-main-actions"><LinkedProfileControls profileType={profile.type} /><button className="outline-button profile-edit-button" type="button" onClick={() => setEditing(true)}>Редактировать</button></div>}
            </div>
            {editing ? (
              <form className="profile-form" noValidate onSubmit={save}>
                {profile.type === "Сообщество" ? <div className="community-profile-fields">
                  <label className={invalidFields.name ? "field-invalid" : ""}>Название сообщества *<input required aria-invalid={invalidFields.name} value={profile.name} onChange={(event) => { setProfile({ ...profile, name: event.target.value }); setInvalidFields((current) => ({ ...current, name: false })); }} /></label>
                  <CityAutocomplete value={profile.city} required invalid={invalidFields.city} onChange={(city, cityId, country) => { setProfile({ ...profile, city, cityId, country }); setInvalidFields((current) => ({ ...current, city: false })); }} />
                  <label>Тип профиля<CustomSelect ariaLabel="Тип профиля" value={profile.type} onChange={(type) => { if (["Издатель", "Сообщество"].includes(type) && profile.type !== type) { setPendingOrganizationType(type as "Издатель" | "Сообщество"); setPublisherTypeNotice(true); } else setProfile({ ...profile, type }); }} options={["Читатель", "Писатель", "Блогер", "Издатель", "Сообщество"].map((item) => ({ value: item as UserProfileData["type"], label: item }))} /></label>
                  <label>Тип сообщества *<input required value={profile.communityType ?? ""} onChange={(event) => setProfile({ ...profile, communityType: event.target.value })} placeholder="Например: Книжный клуб" /></label>
                  <label>О сообществе *<textarea required rows={5} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></label>
                  <label>Правила вступления/участия *<textarea required rows={5} value={profile.communityRules ?? ""} onChange={(event) => setProfile({ ...profile, communityRules: event.target.value })} /></label>
                </div> : <><div className="form-row">
                  <label className={invalidFields.name ? "field-invalid" : ""}>{profile.type === "Издатель" ? "Название издательства *" : "Имя *"}<input required aria-invalid={invalidFields.name} value={profile.name} onChange={(event) => { setProfile({ ...profile, name: event.target.value }); setInvalidFields((current) => ({ ...current, name: false })); }} /></label>
                  <label>Тип профиля<CustomSelect ariaLabel="Тип профиля" value={profile.type} onChange={(type) => { if (["Издатель", "Сообщество"].includes(type) && profile.type !== type) { setPendingOrganizationType(type as "Издатель" | "Сообщество"); setPublisherTypeNotice(true); } else setProfile({ ...profile, type }); }} options={["Читатель", "Писатель", "Блогер", "Издатель", "Сообщество"].map((item) => ({ value: item as UserProfileData["type"], label: item }))} /></label>
                </div>
                <div className="form-row profile-identity-row"><CityAutocomplete value={profile.city} required invalid={invalidFields.city} onChange={(city, cityId, country) => { setProfile({ ...profile, city, cityId, country }); setInvalidFields((current) => ({ ...current, city: false })); }} />{!["Издатель", "Сообщество"].includes(profile.type) && <label className={invalidFields.birthDate ? "field-invalid" : ""}>Дата рождения *<input required aria-invalid={invalidFields.birthDate} type="date" max={new Date().toISOString().slice(0, 10)} value={profile.birthDate ?? ""} onChange={(event) => { setProfile({ ...profile, birthDate: event.target.value }); setInvalidFields((current) => ({ ...current, birthDate: false })); }} /></label>}</div>
                {!["Издатель", "Сообщество"].includes(profile.type) && <div className="form-row profile-demographics-row"><label>Пол<CustomSelect ariaLabel="Пол" value={profile.gender} onChange={(gender) => setProfile({ ...profile, gender })} options={["Не указан", "Мужской", "Женский"].map((item) => ({ value: item as UserProfileData["gender"], label: item }))} /></label><label className="profile-checkbox profile-birth-visibility"><input type="checkbox" checked={Boolean(profile.showBirthDateToFriends)} onChange={(event) => setProfile({ ...profile, showBirthDateToFriends: event.target.checked })} />Показывать дату рождения друзьям</label></div>}
                </>}
                {profile.type === "Издатель" ? <>
                  <label>Ссылка на сайт издательства *<input required type="url" value={profile.publisherWebsite ?? ""} onChange={(event) => setProfile({ ...profile, publisherWebsite: event.target.value })} /></label>
                  <label>Об издательстве *<textarea required rows={5} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></label>
                  <fieldset className="publisher-sales-editor"><legend>Где продаются книги</legend>{(profile.publisherSalesLinks ?? []).map((link, index) => <div className="form-row" key={link.id}><label>Название магазина<input value={link.label} onChange={(event) => setProfile({ ...profile, publisherSalesLinks: (profile.publisherSalesLinks ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} /></label><label>Ссылка<input type="url" value={link.url} onChange={(event) => setProfile({ ...profile, publisherSalesLinks: (profile.publisherSalesLinks ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item) })} /></label></div>)}<button className="outline-button" type="button" disabled={(profile.publisherSalesLinks ?? []).length >= 5} onClick={() => setProfile({ ...profile, publisherSalesLinks: [...(profile.publisherSalesLinks ?? []), { id: Date.now(), label: "", url: "" }] })}>＋ Добавить магазин</button></fieldset>
                  <div className="publisher-private-heading"><h3>Юридические данные</h3><p>Эти сведения видны только вам и администратору.</p></div>
                  <label>Юридическое название компании *<input required value={profile.publisherLegalName ?? ""} onChange={(event) => setProfile({ ...profile, publisherLegalName: event.target.value })} /></label>
                  <div className="form-row"><label>БИН *<input required inputMode="numeric" value={profile.publisherBin ?? ""} onChange={(event) => setProfile({ ...profile, publisherBin: event.target.value.replace(/\D/g, "").slice(0, 12) })} /></label><label>Расчётный счёт *<input required value={profile.publisherAccount ?? ""} onChange={(event) => setProfile({ ...profile, publisherAccount: event.target.value })} /></label></div>
                  <div className="form-row"><label>БИК *<input required value={profile.publisherBik ?? ""} onChange={(event) => setProfile({ ...profile, publisherBik: event.target.value })} /></label><label>Банк *<input required value={profile.publisherBank ?? ""} onChange={(event) => setProfile({ ...profile, publisherBank: event.target.value })} /></label></div>
                  <label>Юридический адрес *<textarea required rows={3} value={profile.publisherLegalAddress ?? ""} onChange={(event) => setProfile({ ...profile, publisherLegalAddress: event.target.value })} /></label>
                  <label>Почтовый адрес *<textarea required rows={3} value={profile.publisherPostalAddress ?? ""} onChange={(event) => setProfile({ ...profile, publisherPostalAddress: event.target.value })} /></label>
                </> : profile.type === "Сообщество" ? null : <>
                <label>О себе<textarea rows={4} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></label>
                {profile.type === "Писатель" && <div className="form-row"><label>Книги, повлиявшие на меня, как на автора<textarea rows={4} value={profile.authorInfluences} onChange={(event) => setProfile({ ...profile, authorInfluences: event.target.value })} /></label><label>О чем мои тексты<textarea rows={4} value={profile.writingThemes} onChange={(event) => setProfile({ ...profile, writingThemes: event.target.value })} /></label></div>}
                <label>Мой идеальный выходной<textarea rows={3} value={profile.weekend} onChange={(event) => setProfile({ ...profile, weekend: event.target.value })} /></label>
                <label>Что меня радует в жизни<textarea rows={3} value={profile.joy} onChange={(event) => setProfile({ ...profile, joy: event.target.value })} /></label>
                <label>О чем мне интересно говорить<textarea rows={3} value={profile.talk} onChange={(event) => setProfile({ ...profile, talk: event.target.value })} /></label>
                <label>Послание незнакомому читателю<textarea rows={4} value={profile.strangerMessage} onChange={(event) => setProfile({ ...profile, strangerMessage: event.target.value })} /></label>
                <GenrePicker label="Любимые жанры" value={profile.favoriteGenres} onChange={(favoriteGenres) => setProfile({ ...profile, favoriteGenres })} />
                <GenrePicker label="Жанры, которые мне не нравятся" value={profile.dislikedGenres} onChange={(dislikedGenres) => setProfile({ ...profile, dislikedGenres })} />
                </>}
                <div className="form-actions"><button type="button" onClick={() => leaveOrWarn(() => setEditing(false))}>Отмена</button><button className="primary-button" type="submit">Сохранить</button></div>
              </form>
            ) : (
              <div className="profile-details">
                {profile.type === "Сообщество" ? <>
                  <div className="publisher-status-card"><span>Статус профиля</span><p>{profile.publisherStatus === "approved" ? "Сообщество подтверждено" : profile.publisherStatus === "needs_changes" ? "Требуется доработка" : profile.publisherStatus === "rejected" ? "Профиль отклонён" : "Профиль находится на модерации"}</p>{profile.publisherModerationNote && <small>{profile.publisherModerationNote}</small>}</div>
                  <div><span>Тип сообщества</span><p>{profile.communityType}</p></div>
                  <div className="profile-wide-field"><span>О сообществе</span><p>{profile.bio}</p></div>
                  <div className="profile-wide-field"><span>Правила вступления/участия</span><p>{profile.communityRules}</p></div>
                </> : profile.type === "Издатель" ? <>
                  <div className="publisher-status-card"><span>Статус профиля</span><p>{profile.publisherStatus === "approved" ? "Издательство подтверждено" : profile.publisherStatus === "needs_changes" ? "Требуется доработка" : profile.publisherStatus === "rejected" ? "Профиль отклонён" : "Профиль находится на модерации"}</p>{profile.publisherModerationNote && <small>{profile.publisherModerationNote}</small>}</div>
                  <div className="profile-wide-field"><span>Об издательстве</span><p>{profile.bio}</p></div>
                  <div><span>Сайт</span><p>{profile.publisherWebsite && <a href={profile.publisherWebsite} target="_blank" rel="noreferrer">{profile.publisherWebsite}</a>}</p></div>
                  <div><span>Где продаются книги</span><div className="writer-book-links">{(profile.publisherSalesLinks ?? []).map((link) => <a className="outline-button" key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</div></div>
                  <div className="publisher-private-details profile-wide-field"><span>Юридические данные · видны только вам и администратору</span><p><b>{profile.publisherLegalName}</b><br />БИН: {profile.publisherBin}<br />Расчётный счёт: {profile.publisherAccount}<br />БИК: {profile.publisherBik} · {profile.publisherBank}<br />Юридический адрес: {profile.publisherLegalAddress}<br />Почтовый адрес: {profile.publisherPostalAddress}</p></div>
                </> : <>
                <div><span>Возраст</span><p>{profile.age !== undefined ? `${profile.age}` : "Будет рассчитан по дате рождения"}</p></div>
                <div><span>О себе</span><p>{profile.bio}</p></div>
                {profile.type === "Писатель" && <><div><span>Книги, повлиявшие на меня, как на автора</span><p>{profile.authorInfluences}</p></div><div><span>О чем мои тексты</span><p>{profile.writingThemes}</p></div></>}
                <div><span>Мой идеальный выходной</span><p>{profile.weekend}</p></div>
                <div><span>Что меня радует в жизни</span><p>{profile.joy}</p></div>
                <div><span>О чем мне интересно говорить</span><p>{profile.talk}</p></div>
                <div className="stranger-message"><span>Послание незнакомому читателю</span><p>{profile.strangerMessage}</p></div>
                <div><span>Любимые жанры</span><div className="profile-tags">{profile.favoriteGenres.map((genre) => <span key={genre}>{genre}</span>)}</div></div>
                <div><span>Жанры, которые мне не нравятся</span><div className="profile-tags disliked-tags">{profile.dislikedGenres.map((genre) => <span key={genre}>{genre}</span>)}</div></div>
                {profile.type === "Писатель" && <div><span>Мои книги</span><p>{authorBooks.length ? authorBooks.map((book) => book.title).join(" · ") : "Книги пока не добавлены"}</p></div>}
                </>}
              </div>
            )}
          </>}
          {activeTab === "author-books" && (profile.type === "Писатель" || ["Издатель", "Сообщество"].includes(profile.type)) && <AuthorBooksTab books={authorBooks} setBooks={setAuthorBooks} userId={user.id} author={profile.name} users={users} publisherMode={["Издатель", "Сообщество"].includes(profile.type)} communityMode={profile.type === "Сообщество"} canCreate={profile.type === "Писатель" || profile.publisherStatus === "approved"} />}
          {activeTab === "excerpts" && (profile.type === "Писатель" || profile.type === "Блогер") && <ExcerptsTab excerpts={userExcerpts} setExcerpts={setUserExcerpts} owner={{ ...user, profile, excerpts: userExcerpts }} users={users} likes={likes} onToggleLike={onToggleLike} onComment={onComment} onOpenUser={onOpenUser} initialAdd={initialAction === "excerpt" && !initialEditId} initialEditId={initialAction === "excerpt" ? initialEditId : null} />}
          {activeTab === "publisher-news" && ["Издатель", "Сообщество"].includes(profile.type) && <PublisherNewsTab news={publisherNews} setNews={setPublisherNews} owner={{ ...user, profile, publisherNews }} users={users} canCreate={profile.publisherStatus === "approved"} communityMode={profile.type === "Сообщество"} />}
          {activeTab === "library" && !["Издатель", "Сообщество"].includes(profile.type) && <LibraryTab books={books} setBooks={setBooks} userId={user.id} users={users} initialAdd={initialAction === "book"} />}
          {activeTab === "wishlist" && (profile.type === "Читатель" || profile.type === "Блогер") && <WishlistTab books={wishBooks} setBooks={setWishBooks} owner={{ ...user, profile, wishBooks }} viewer={{ ...user, profile, wishBooks }} users={users} />}
          {activeTab === "reviews" && (profile.type === "Читатель" || profile.type === "Блогер") && <ReviewsTab reviews={reviews} setReviews={setReviews} owner={{ ...user, profile, books, reviews }} users={users} likes={likes} onToggleLike={onToggleLike} onComment={onComment} onOpenUser={onOpenUser} initialAdd={initialAction === "review" && !initialEditId} initialEditId={initialAction === "review" ? initialEditId : null} />}
          {activeTab === "events" && <MyEventsTab createdEvents={events.filter((item) => item.creatorId === user.id)} participatingEvents={events.filter((item) => item.creatorId !== user.id && item.reminderSet)} users={users} currentUserId={user.id} onOpenUser={onOpenUser} onEdit={onEditEvent} onDeleted={onDeleteEvent} />}
          {activeTab === "occasions" && <div className="simple-profile-tab"><div className="profile-title-row"><div><h1>Мои поводы</h1><p>{occasions.filter((item) => item.creatorId === user.id).length} созданных поводов</p></div></div><div className="occasion-grid">{occasions.filter((item) => item.creatorId === user.id).map((item) => <OccasionCard key={item.id} item={item} own onOpen={() => setOpenedOwnOccasion(item)} onEdit={() => onEditOccasion(item)} />)}</div>{!occasions.some((item) => item.creatorId === user.id) && <div className="profile-tab-placeholder">Вы пока не создавали поводы.</div>}{openedOwnOccasion && <OccasionModal item={openedOwnOccasion} currentUser={user} users={users} onOpenUser={onOpenUser} onOpenBook={setOpenedOwnOccasionBookId} onClose={() => setOpenedOwnOccasion(null)} onEdit={() => { onEditOccasion(openedOwnOccasion); setOpenedOwnOccasion(null); }} onDelete={async () => { if (!window.confirm("Удалить повод?")) return; const response = await fetch(`/api/occasions/${openedOwnOccasion.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить повод"); return; } onDeleteOccasion(openedOwnOccasion.id); setOpenedOwnOccasion(null); }} />}{openedOwnOccasionBookId && catalogFromUsers(users).find((book) => book.id === openedOwnOccasionBookId) && <UnifiedBookModal book={catalogFromUsers(users).find((book) => book.id === openedOwnOccasionBookId)!} users={users} nested onOpenUser={onOpenUser} onClose={() => setOpenedOwnOccasionBookId(null)} />}</div>}
          {activeTab === "friends" && <ProfileFriendsTab friends={friends} outgoing={friendRequests.filter((request) => request.status === "pending" && request.fromId === user.id).map((request) => users.find((item) => item.id === request.toId)).filter(Boolean) as DemoUser[]} incoming={friendRequests.filter((request) => request.status === "pending" && request.toId === user.id).map((request) => users.find((item) => item.id === request.fromId)).filter(Boolean) as DemoUser[]} subscriptions={follows.filter((follow) => follow.followerId === user.id).map((follow) => users.find((item) => item.id === follow.targetId)).filter((item): item is DemoUser => Boolean(item) && !item!.isAdmin)} followers={follows.filter((follow) => follow.targetId === user.id).map((follow) => users.find((item) => item.id === follow.followerId)).filter((item): item is DemoUser => Boolean(item) && !item!.isAdmin)} communityMode={profile.type === "Сообщество"} publisherMode={profile.type === "Издатель"} onOpenUser={onOpenUser} />}
          {activeTab === "settings" && <div className="simple-profile-tab profile-settings-stack"><div className="profile-title-row"><div><h1>Настройки</h1><p>Управление профилем Book Meet</p></div></div><section className="profile-home-view-settings"><h2>Вид главной страницы по умолчанию</h2><div className="profile-home-view-options"><button className={homeView === "classic" ? "active" : ""} type="button" onClick={() => void chooseHomeView("classic")}>Классическая главная страница</button><button className={homeView === "feed" ? "active" : ""} type="button" onClick={() => void chooseHomeView("feed")}>Лента</button></div></section><section className="profile-menu-visibility-settings"><h2>Показывать пункты меню профиля</h2><div className="profile-menu-visibility-list">{profileTabs.filter((item) => item.key !== "main").map((item) => <label key={item.key}><input type="checkbox" checked={!hiddenTabsDraft.includes(item.key)} onChange={(event) => void toggleProfileTabVisibility(item.key, event.target.checked)} />{item.label.replace(/ · \d+$/, "")}</label>)}</div></section><section className="profile-menu-order-settings"><h2>Изменить порядок пунктов меню профиля</h2><div className="profile-menu-order-actions"><button className="outline-button" type="button" onClick={() => { setTabOrderDraft(profile.tabOrder ?? defaultTabOrder); setReorderingTabs(true); }}>Изменить</button>{reorderingTabs && <button className="primary-button" type="button" onClick={() => void applyTabOrder()}>Применить</button>}</div></section><LinkedProfileControls profileType={profile.type} settings /><section className="blocked-users-settings"><h2>Заблокированные пользователи</h2>{users.some((item) => item.blockedByMe) ? <div className="blocked-user-grid">{users.filter((item) => item.blockedByMe).map((item) => <button type="button" key={item.id} className="blocked-user-card" onClick={() => onOpenUser(item.id)}><span className={`avatar avatar-sm avatar-${item.color} ${item.avatarUrl ? "has-photo" : ""}`} style={item.avatarUrl ? { backgroundImage: `url(${item.avatarUrl})` } : undefined}>{!item.avatarUrl && item.initials}</span><span><strong>{item.profile.name}</strong><small>{item.profile.type} · {item.profile.city}</small></span></button>)}</div> : <p>Заблокированных пользователей нет.</p>}</section><section className="profile-delete-settings"><h2>Удаление профиля</h2><p>Профиль можно восстановить в течение года. Материалы и комментарии сохранятся, сообщения и аватар будут удалены.</p><button className="quiet-danger-button" type="button" onClick={() => setDeleteProfileConfirm(true)}>Удалить профиль</button></section></div>}
        </div>
      </section>
      {deleteProfileConfirm && <div className="notice-backdrop" role="presentation" onMouseDown={() => setDeleteProfileConfirm(false)}><section className="confirm-social-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>Действительно удалить профиль?</h2><p>В течение года вы сможете восстановить его при следующей авторизации.</p><div className="form-actions"><button type="button" onClick={() => setDeleteProfileConfirm(false)}>Отмена</button><button className="quiet-danger-button" type="button" onClick={() => void deleteProfile()}>Удалить</button></div></section></div>}
      {requiredNotice && <div className="notice-backdrop" role="presentation" onMouseDown={() => setRequiredNotice(false)}><section className="required-fields-notice" role="alertdialog" aria-modal="true" aria-labelledby="required-fields-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="required-fields-title">Заполните обязательные поля</h2><button className="primary-button" type="button" autoFocus onClick={() => setRequiredNotice(false)}>Ок</button></section></div>}
      {publisherTypeNotice && <div className="notice-backdrop" role="presentation"><section className="publisher-type-notice" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>Профиль организации требует подтверждения</h2><p>{pendingOrganizationType === "Сообщество" ? "Профиль сообщества требует проверки. После заполнения данных анкета будет отправлена администратору на модерацию." : "Профиль издательства требует официального подтверждения. После заполнения юридических данных анкета будет отправлена администратору на модерацию."}</p><div className="form-actions"><button type="button" onClick={() => setPublisherTypeNotice(false)}>Отмена</button><button className="primary-button" type="button" onClick={() => { setProfile({ ...profile, type: pendingOrganizationType, city: "", cityId: undefined, gender: "Не указан", publisherStatus: "draft", publisherSalesLinks: profile.publisherSalesLinks ?? [] }); setPublisherTypeNotice(false); }}>Продолжить</button></div></section></div>}
      {unsavedNotice && <div className="notice-backdrop" role="presentation"><section className="unsaved-changes-notice" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-changes-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="unsaved-changes-title">Остались несохраненные изменения, вы действительно хотите выйти?</h2><div className="form-actions"><button type="button" onClick={discardChangesAndLeave}>Выйти без сохранения</button><button className="primary-button" type="button" autoFocus onClick={() => { pendingExitRef.current = null; setUnsavedNotice(false); }}>Вернуться к редактированию</button></div></section></div>}
    </main>
  );
}
