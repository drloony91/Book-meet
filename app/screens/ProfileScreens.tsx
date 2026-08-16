import React, { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { CustomSelect } from "../components/common/CustomSelect";
import { ModalIconActions } from "../components/modals/ModalIconActions";
import { AdminSafetySection } from "../components/safety/AdminSafety";
import { UserComplaints } from "../components/safety/UserComplaints";
import { AdminStatisticsPanel } from "../components/admin/AdminStatisticsPanel";
import { AdminCompliancePanel } from "../components/admin/AdminCompliancePanel";
import {
  AdminCatalogCard,
  AdminCatalogEditor as BaseAdminCatalogEditor,
  AdminCatalogOverlay as BaseAdminCatalogOverlay,
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
import { localizedApiError, useI18n } from "../i18n";
import { normalizedPathname, profileTabFromPathname, profileTabPaths } from "../navigation/routes";
import type {
  AdminCatalogItem,
  AdminCatalogKind,
  AdminMaterialKind,
  AdminSection,
  AdminStatistics,
  AuthorBook,
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
  const { locale, t, domainLabel } = useI18n();
  const [linked, setLinked] = useState<LinkedProfileCard | null>(null);
  const [mode, setMode] = useState<"none" | "choose" | "create" | "attach" | "unlink">("none");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState(() => t("linked.defaultName")); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const personal = ["Читатель", "Писатель", "Блогер"].includes(profileType);
  useEffect(() => { fetch("/api/bootstrap/session", { credentials: "same-origin" }).then((response) => response.json()).then((data: { linkedProfile?: LinkedProfileCard }) => setLinked(data.linkedProfile ?? null)).catch(() => undefined); }, []);
  async function request(path: string, body?: unknown) {
    const response = await fetch(path, { method: path.includes("unlink") ? "DELETE" : "POST", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({})) as { error?: string; requiresTotp?: boolean };
    if (!response.ok && response.status !== 202) throw new Error(localizedApiError(data.error, t("common.actionError")));
    return { response, data };
  }
  async function switchProfile(created = false) { await request("/api/linked-profiles/switch"); window.location.assign(created ? "/profile?linked-create=1" : "/profile"); }
  async function googleLink() {
    setNotice(t("linked.openingGoogle"));
    try {
      const providers = await fetch("/api/auth/providers", { credentials: "same-origin" }).then((response) => response.json()) as { googleClientId?: string };
      if (!(window as any).google?.accounts?.id) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
          if (existing) { existing.addEventListener("load", () => resolve(), { once: true }); existing.addEventListener("error", () => reject(new Error(t("auth.googleUnavailable"))), { once: true }); return; }
          const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true;
          script.onload = () => resolve(); script.onerror = () => reject(new Error(t("auth.googleUnavailable"))); document.head.append(script);
        });
      }
      const gsi = (window as any).google?.accounts?.id;
      if (!providers.googleClientId || !gsi) throw new Error(t("auth.googleWindowUnavailable"));
      gsi.initialize({ client_id: providers.googleClientId, locale, callback: async ({ credential }: { credential?: string }) => { try { await request("/api/linked-profiles/google", { credential, mode: mode === "create" ? "create" : "attach", name }); await switchProfile(mode === "create"); } catch (error) { setNotice(error instanceof Error ? error.message : t("auth.googleConfirmError")); } } });
      gsi.prompt();
    } catch (error) { setNotice(error instanceof Error ? error.message : t("auth.googleUnavailable")); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setNotice(""); try { const { data } = await request(mode === "create" ? "/api/linked-profiles/create" : "/api/linked-profiles/attach", mode === "create" ? { email, password, name } : { email, password }); if (data.requiresTotp) { setNotice(t("linked.totpUnsupported")); return; } await switchProfile(mode === "create"); } catch (error) { setNotice(error instanceof Error ? error.message : t("linked.connectError")); } finally { setBusy(false); } }
  if (!personal && profileType !== "Сообщество") return null;
  if (linked) return <div className={settings ? "linked-profile-settings" : "linked-profile-actions"}>{settings ? <><h2>{t("linked.title")}</h2><button type="button" className="linked-profile-card" onClick={() => void switchProfile()}><span className={`avatar avatar-sm ${linked.avatarUrl ? "has-photo" : ""}`} style={linked.avatarUrl ? { backgroundImage: `url(${linked.avatarUrl})` } : undefined}>{!linked.avatarUrl && linked.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU")}</span><span data-i18n-skip><strong>{linked.name}</strong><small>{domainLabel(linked.type)}</small></span></button><button className="quiet-danger-button" type="button" onClick={() => setMode("unlink")}>{t("linked.unlinkProfile")}</button></> : <button className="outline-button linked-profile-switch" type="button" onClick={() => void switchProfile()}>{t("linked.switchTo", { name: linked.name })}</button>}{mode === "unlink" && <div className="notice-backdrop" onMouseDown={() => setMode("none")}><section className="confirm-social-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label={t("common.close")} onClick={() => setMode("none")}>×</button><h2>{t("linked.unlinkConfirm", { name: linked.name })}</h2><p>{t("linked.unlinkHint")}</p><div className="form-actions"><button type="button" onClick={() => setMode("none")}>{t("common.cancel")}</button><button className="quiet-danger-button" type="button" onClick={async () => { try { await request("/api/linked-profiles/unlink"); setLinked(null); setMode("none"); } catch (error) { setNotice(error instanceof Error ? error.message : t("linked.unlinkError")); } }}>{t("linked.unlink")}</button></div></section></div>}</div>;
  if (!personal) return null;
  return <div className={settings ? "linked-profile-settings" : "linked-profile-actions"}>{settings ? <><h2>{t("linked.title")}</h2><p>{t("linked.settingsHint")}</p></> : <button className="outline-button" type="button" onClick={() => setMode("choose")}>{t("linked.attachCommunity")}</button>}{settings && <button className="outline-button linked-profile-settings-button" type="button" onClick={() => setMode("choose")}>{t("linked.attachCommunity")}</button>}{mode !== "none" && <div className="notice-backdrop" onMouseDown={() => setMode("none")}><section className="confirm-social-modal linked-profile-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label={t("common.close")} onClick={() => setMode("none")}>×</button>{mode === "choose" ? <div className="linked-profile-choice"><h2>{t("linked.attachCommunity")}</h2><p>{t("linked.chooseHint")}</p><div className="form-actions"><button className="outline-button" type="button" onClick={() => setMode("create")}>{t("linked.createNew")}</button><button className="primary-button" type="button" onClick={() => setMode("attach")}>{t("linked.attachExisting")}</button></div></div> : <div className="auth-form-page linked-profile-auth"><h2>{mode === "create" ? t("linked.newCommunity") : t("linked.communityLogin")}</h2><form onSubmit={submit}>{mode === "create" && <label>{t("linked.communityName")}<input required autoComplete="organization" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("linked.communityPlaceholder")} /></label>}<label>E-mail<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><label>{t("auth.password")}<input required type="password" minLength={8} autoComplete={mode === "create" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("auth.passwordHint")} /></label>{notice && <span className="login-error">{notice}</span>}<button className="primary-button" disabled={busy} type="submit">{busy ? t("auth.checking") : mode === "create" ? t("auth.register") : t("auth.login")}</button></form><div className="auth-provider-actions"><button className="google-provider-button linked-google-button" type="button" disabled={busy} onClick={() => void googleLink()}>{mode === "create" ? t("auth.registerGoogle") : t("auth.loginGoogle")}</button></div><button className="outline-button linked-profile-back" type="button" onClick={() => setMode("choose")}>{t("common.back")}</button></div>}</section></div>}</div>;
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
  const { t } = useI18n();
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
      if (!response.ok) throw new Error(localizedApiError(data.error, t("admin.importCatalogError")));
      setCreatedCount(data.createdCount ?? 0);
      setConflicts(data.conflicts ?? []);
      if (!(data.conflicts?.length)) onComplete();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("admin.readFileError"));
    } finally { setBusy(false); }
  }
  async function resolve(conflict: AdminImportConflict, action: "replace" | "supplement" | "duplicate") {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/books/import/resolve", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ existingId: conflict.existing.id, incoming: conflict.incoming, action }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(localizedApiError(data.error, t("admin.applyDecisionError")));
      setConflicts((current) => current.filter((item) => item.key !== conflict.key));
      if (conflicts.length === 1) onComplete();
    } catch (error) { window.alert(error instanceof Error ? error.message : t("admin.applyDecisionError")); }
    finally { setBusy(false); }
  }
  const card = (book: AdminImportBook, label: string) => <button className="admin-import-book-card" type="button" onClick={() => setDetails(book)}><span>{label}</span><strong data-i18n-skip>{book.title || t("book.untitled")}</strong><small data-i18n-skip>{book.author || t("book.authorUnknown")}</small>{book.isbn && <em data-i18n-skip>ISBN {book.isbn}</em>}</button>;
  return <section className="admin-book-import"><div><h2>{t("admin.importCatalog")}</h2><p>{t("admin.importCatalogHint")}</p></div><button className="outline-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? t("admin.processing") : t("admin.uploadFile")}</button><input ref={inputRef} hidden type="file" accept=".csv,.xls,.xlsx" onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} />{createdCount > 0 && <p className="admin-import-result">{t("admin.importCreated", { count: createdCount })}</p>}{conflicts.map((conflict) => <article className="admin-import-conflict" key={conflict.key}><div className="admin-import-comparison">{card(conflict.existing, t("admin.alreadyExists"))}{card(conflict.incoming, t("admin.fromFile"))}</div><div className="admin-import-actions"><button type="button" onClick={() => void resolve(conflict, "replace")}>{t("admin.replace")}</button><button type="button" onClick={() => void resolve(conflict, "supplement")}>{t("admin.supplement")}</button><button type="button" onClick={() => void resolve(conflict, "duplicate")}>{t("admin.duplicate")}</button></div></article>)}{details && <div className="nested-modal-backdrop" onMouseDown={() => setDetails(null)}><section className="admin-import-details" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t("common.close")} type="button" onClick={() => setDetails(null)}>×</button><h2 data-i18n-skip>{details.title}</h2><p data-i18n-skip><strong>{details.author}</strong></p>{details.publisher && <p>{t("content.publisher")}: <span data-i18n-skip>{details.publisher}</span></p>}{details.isbn && <p data-i18n-skip>ISBN: {details.isbn}</p>}{details.annotation && <p data-i18n-skip>{details.annotation}</p>}</section></div>}</section>;
}

export function AdminTab({ events, occasions, users, catalog = [], reports, onModerate, onModerateOccasion, onModeratePublisher, onOpenChat, onOpenUser, onRefresh, onDeleteMaterial }: { events: BookEvent[]; occasions: Occasion[]; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; reports: SafetyReport[]; onModerate: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, event?: typeof emptyEvent, pinned?: boolean) => Promise<void>; onModerateOccasion: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, occasion?: typeof emptyOccasion) => Promise<void>; onModeratePublisher: (id: number, action: "accept" | "revision" | "reject", note?: string) => Promise<void>; onOpenChat: (userId: number) => void; onOpenUser: (userId: number) => void; onRefresh: () => void; onDeleteMaterial: (kind: AdminCatalogKind, id: number) => Promise<void> }) {
  const { t, domainLabel } = useI18n();
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
  const [catalogBooks, setCatalogBooks] = useState<LibraryBook[] | null>(() => catalog.length ? catalog.map((book) => ({ rating: 0, review: "", ...book } as LibraryBook)) : null);
  useEffect(() => {
    let active = true;
    fetch("/api/admin/statistics", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("admin.statisticsLoadError"));
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
        if (!response.ok) throw new Error(t("admin.catalogLoadError"));
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
  const AdminCatalogEditor = (props: React.ComponentProps<typeof BaseAdminCatalogEditor>) => <BaseAdminCatalogEditor {...props} catalog={books} />;
  const AdminCatalogOverlay = (props: React.ComponentProps<typeof BaseAdminCatalogOverlay>) => <BaseAdminCatalogOverlay {...props} catalog={books} />;
  const reviews = users.flatMap((user) => user.reviews.map((item) => ({ ...item, ownerId: user.id, ownerName: user.profile.name })));
  const publications = users.flatMap((user) => (user.excerpts ?? []).map((item) => ({ ...item, ownerId: user.id, ownerName: user.profile.name })));
  const publisherNews = users.flatMap((user) => (user.publisherNews ?? []).map((item) => ({ ...item, ownerId: user.id, ownerName: user.profile.name })));
  const remove = async (kind: AdminCatalogKind, id: number, title: string) => { if (window.confirm(t("admin.deleteForeverConfirm", { title }))) await onDeleteMaterial(kind, id); };
  const catalogItems: Record<AdminMaterialKind, AdminCatalogItem[]> = {
    book: books.map((item) => ({ id: item.id, kind: "book", title: item.title, subtitle: item.author, text: item.annotation, coverUrl: item.coverUrl, coverTone: item.coverTone, source: item })),
    review: reviews.map((item) => ({ id: item.id, kind: "review", title: item.bookTitle, subtitle: `${item.ownerName} · ★ ${item.rating}`, text: item.preview, source: item })),
    excerpt: [
      ...publications.map((item) => ({ id: item.id, kind: "excerpt" as const, title: item.bookTitle || t("content.publications"), subtitle: item.ownerName, text: item.previewText || item.text, source: item })),
      ...publisherNews.map((item) => ({ id: item.id, kind: "publisher_news" as const, title: item.title, subtitle: `${users.find((user) => user.id === item.ownerId)?.profile.type === "Сообщество" ? t("admin.communityNews") : t("admin.publisherNews")} · ${item.ownerName}`, text: item.previewText, source: item })),
    ],
    event: events.map((item) => { const organizationType = users.find((user) => user.id === item.creatorId)?.profile.type; return { id: item.id, kind: "event", title: item.title, subtitle: `${organizationType === "Сообщество" ? `${t("admin.communityEvent")} · ` : organizationType === "Издатель" ? `${t("admin.publisherEvent")} · ` : ""}${item.city} · ${item.date}`, text: item.summary, source: item }; }),
    occasion: occasions.map((item) => ({ id: item.id, kind: "occasion", title: item.primaryText, subtitle: occasionLabels[item.type], text: item.audienceText, source: item })),
  };
  const labels: Record<AdminMaterialKind, string> = { book: t("nav.books"), review: t("content.reviews"), excerpt: t("content.publications"), event: t("content.events"), occasion: t("content.occasionsShort") };
  const saveCatalogItem = async (item: AdminCatalogItem, payload: unknown) => {
    const response = await fetch(`/api/admin/materials/${item.kind}/${item.id}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { window.alert(localizedApiError(data.error, t("common.saveChangesError"))); return; }
    window.location.reload();
  };
  const startCatalogEdit = (item: AdminCatalogItem) => {
    setSelectedCatalogItem(null);
    if (item.kind === "event") { setEditing(item.source); return; }
    if (item.kind === "occasion") { setEditingOccasion(item.source); return; }
    setEditingCatalogItem(item);
  };
  if (section === "dashboard") return <div className="admin-tab admin-dashboard">
    <div className="profile-title-row"><div><span className="section-subtitle">{t("admin.manageBookMeet")}</span><h1>{t("admin.panel")}</h1><p>{t("admin.panelHint")}</p></div></div>
    <AdminStatisticsPanel statistics={statistics} />
    <button className="admin-moderation-button" type="button" onClick={() => setSection("moderation")}><span>{t("admin.pendingMaterials")}</span><b>{total}</b></button>
    <div className="admin-dashboard-divider"><span>{t("admin.allMaterials")}</span></div>
    <div className="admin-section-buttons">{(["book", "review", "excerpt", "event", "occasion"] as AdminMaterialKind[]).map((kind) => <button type="button" key={kind} onClick={() => { setSection(kind); setSearch(""); }}><span>{labels[kind]}</span><b>{catalogItems[kind].length}</b></button>)}</div>
    <div className="admin-dashboard-divider"><span>{t("admin.allReports")}</span></div>
    <div className="admin-section-buttons admin-report-buttons"><button type="button" onClick={() => setSection("reports-new")}><span>{t("admin.newReports")}</span><b>{reports.filter((item) => ["new", "reviewing"].includes(item.status)).length}</b></button><button type="button" onClick={() => setSection("reports-reviewed")}><span>{t("admin.reviewed")}</span><b>{reports.filter((item) => ["satisfied", "rejected"].includes(item.status)).length}</b></button></div>
    <div className="admin-user-status-buttons"><button className="admin-moderation-button" type="button" onClick={() => setSection("users-active")}><span>{t("admin.activeUsers")}</span><b>{users.filter((item) => !item.isAdmin && !item.suspension && !item.deletedAt && !item.purged).length}</b></button><button className="admin-moderation-button danger" type="button" onClick={() => setSection("users-blocked")}><span>{t("admin.blockedUsers")}</span><b>{users.filter((item) => !item.isAdmin && item.suspension && !item.deletedAt && !item.purged).length}</b></button><button className="admin-moderation-button deleted" type="button" onClick={() => setSection("users-deleted")}><span>{t("admin.deletedUsers")}</span><b>{users.filter((item) => !item.isAdmin && item.deletedAt && !item.purged).length}</b></button></div>
  </div>;
  if (["reports-new", "reports-reviewed", "users-active", "users-blocked", "users-deleted"].includes(section)) return <AdminSafetySection mode={section as "reports-new" | "reports-reviewed" | "users-active" | "users-blocked" | "users-deleted"} reports={reports} users={users} onBack={() => setSection("dashboard")} onOpenUser={onOpenUser} onOpenChat={onOpenChat} onRefresh={onRefresh} />;
  if (section !== "moderation") {
    const catalogSection = section as AdminMaterialKind;
    const items = catalogItems[catalogSection].filter((item) => `${item.title} ${item.subtitle}`.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))).sort((a, b) => b.id - a.id);
    return <div className="admin-tab admin-catalog-page"><div className="admin-catalog-heading"><button className="back-button" type="button" onClick={() => { setSection("dashboard"); setSelectedCatalogItem(null); }}>← {t("admin.back")}</button><div><span className="section-subtitle">{t("admin.allMaterials")}</span><h1>{labels[catalogSection]}</h1><p>{t("admin.materialCountNewest", { count: catalogItems[catalogSection].length })}</p></div><label className="admin-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("admin.searchTitle")} /></label></div>{catalogSection === "book" && <AdminBookImport onComplete={onRefresh} />}<div className={`admin-catalog-grid ${catalogSection === "book" ? "admin-books-grid" : ""}`}>{items.map((item) => <AdminCatalogCard key={`${item.kind}-${item.id}`} item={item} onOpen={() => setSelectedCatalogItem(item)} />)}</div>{!items.length && <div className="profile-tab-placeholder">{t("common.nothingFound")}</div>}{selectedCatalogItem && <AdminCatalogOverlay item={selectedCatalogItem} users={users} onClose={() => setSelectedCatalogItem(null)} onEdit={() => startCatalogEdit(selectedCatalogItem)} onDelete={async () => { await remove(selectedCatalogItem.kind, selectedCatalogItem.id, selectedCatalogItem.title); setSelectedCatalogItem(null); }} />}{editingCatalogItem && <AdminCatalogEditor item={editingCatalogItem} users={users} onClose={() => setEditingCatalogItem(null)} onSave={(payload) => void saveCatalogItem(editingCatalogItem, payload)} />}{editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm initial={editing} submitLabel={t("common.saveChanges")} onCancel={() => setEditing(null)} onSave={async (value) => { await onModerate(editing.id, "edit", "", value); setEditing(null); }} /></section></div>}{editingOccasion && <div className="modal-backdrop" onMouseDown={() => setEditingOccasion(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm initial={editingOccasion} submitLabel={t("common.saveChanges")} onCancel={() => setEditingOccasion(null)} onSave={async (value) => { await onModerateOccasion(editingOccasion.id, "edit", "", value); setEditingOccasion(null); }} /></section></div>}</div>;
  }
  if (section === "moderation") return <div className="admin-tab admin-moderation-page">
    <button className="back-button" type="button" onClick={() => setSection("dashboard")}>← {t("admin.back")}</button>
    <div className="profile-title-row"><div><span className="section-subtitle">{t("admin.reviewQueue")}</span><h1>{t("admin.pendingMaterials")}</h1><p>{t("admin.awaitingDecision", { count: total })}</p></div></div>
    {total ? <div className="admin-moderation-grid">
      {moderationEvents.map((item) => <article key={`moderation-event-${item.id}`}><EventStatusLabel status={item.status} /><span className="section-subtitle">{t("content.events")} · <span data-i18n-skip>{item.city}</span></span><h3 data-i18n-skip>{item.title}</h3><p data-i18n-skip>{item.summary}</p><button className="outline-button" type="button" onClick={() => { setOpened(item); setOpenedOccasion(null); setNote(item.moderationNote ?? ""); setPinEvent(Boolean(item.pinned)); }}>{t("admin.openReview")}</button></article>)}
      {moderationOccasions.map((item) => <article key={`moderation-occasion-${item.id}`}><EventStatusLabel status={item.status} /><span className="section-subtitle">{t("content.occasionsShort")} · {occasionLabels[item.type]}</span><h3 data-i18n-skip>{item.primaryText}</h3><p data-i18n-skip>{item.audienceText}</p><button className="outline-button" type="button" onClick={() => { setOpenedOccasion(item); setOpened(null); setNote(item.moderationNote ?? ""); }}>{t("admin.openReview")}</button></article>)}
      {moderationPublishers.map((item) => <article key={`moderation-publisher-${item.id}`}><span className="event-status event-status-pending">{t("admin.profileType", { type: domainLabel(item.profile.type) })}</span><span className="section-subtitle">{t("admin.officialVerification")}</span><h3 data-i18n-skip>{item.profile.name}</h3><p data-i18n-skip>{item.profile.bio}</p><button className="outline-button" type="button" onClick={() => { setOpenedPublisher(item); setOpened(null); setOpenedOccasion(null); setNote(item.profile.publisherModerationNote ?? ""); }}>{t("admin.openReview")}</button></article>)}
    </div> : <div className="profile-tab-placeholder">{t("admin.noModeration")}</div>}
    {opened && <div className="modal-backdrop" onMouseDown={() => setOpened(null)}><section className="admin-event-modal" onMouseDown={(event) => event.stopPropagation()}>
      <ModalIconActions onEdit={() => setEditing(opened)} onDelete={async () => { await remove("event", opened.id, opened.title); setOpened(null); }} onClose={() => setOpened(null)} />
      <span className="section-subtitle">{t("admin.eventModeration")}</span><h2 data-i18n-skip>{opened.title}</h2>
      <p data-i18n-skip><strong>{opened.date} · {opened.time} · {opened.city}</strong><br />{opened.address}</p><p data-i18n-skip>{opened.description}</p>
      {opened.bookTitle && <div data-i18n-skip className="moderation-linked-book"><strong>{opened.bookTitle}</strong><span>{opened.bookAuthor}</span></div>}
      <label className="admin-pin-toggle"><input type="checkbox" checked={pinEvent} onChange={(event) => setPinEvent(event.target.checked)} /><span>{t("admin.pinEvent")}</span></label>
      <label className="moderation-comment">{t("admin.userComment")}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="admin-event-actions">{creator && <button className="outline-button" type="button" onClick={() => onOpenChat(creator.id)}>{t("admin.messageUser")}</button>}<button className="outline-button" type="button" onClick={async () => { await onModerate(opened.id, "revision", note); setOpened(null); }}>{t("admin.requestChanges")}</button><button className="quiet-danger-button" type="button" onClick={async () => { await onModerate(opened.id, "reject", note); setOpened(null); }}>{t("admin.reject")}</button><button className="primary-button" type="button" onClick={async () => { await onModerate(opened.id, "accept", "", undefined, pinEvent); setOpened(null); }}>{t("admin.accept")}</button></div>
    </section></div>}
    {openedOccasion && <div className="modal-backdrop" onMouseDown={() => setOpenedOccasion(null)}><section className="admin-event-modal" onMouseDown={(event) => event.stopPropagation()}><ModalIconActions onEdit={() => setEditingOccasion(openedOccasion)} onDelete={async () => { await remove("occasion", openedOccasion.id, openedOccasion.primaryText); setOpenedOccasion(null); }} onClose={() => setOpenedOccasion(null)} /><span className="section-subtitle">{t("admin.occasionModeration")} · {occasionLabels[openedOccasion.type]}</span><h2 data-i18n-skip>{openedOccasion.primaryText}</h2><p data-i18n-skip>{openedOccasion.audienceText}</p><label className="moderation-comment">{t("admin.userComment")}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="admin-event-actions">{creator && <button className="outline-button" type="button" onClick={() => onOpenChat(creator.id)}>{t("admin.messageUser")}</button>}<button className="outline-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "revision", note); setOpenedOccasion(null); }}>{t("admin.requestChanges")}</button><button className="quiet-danger-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "reject", note); setOpenedOccasion(null); }}>{t("admin.reject")}</button><button className="primary-button" type="button" onClick={async () => { await onModerateOccasion(openedOccasion.id, "accept"); setOpenedOccasion(null); }}>{t("admin.accept")}</button></div></section></div>}
    {openedPublisher && <div className="modal-backdrop" onMouseDown={() => setOpenedPublisher(null)}><section className="admin-event-modal publisher-moderation-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t("common.close")} type="button" onClick={() => setOpenedPublisher(null)}>×</button><span className="section-subtitle">{t("admin.verificationOf", { type: domainLabel(openedPublisher.profile.type) })}</span><h2 data-i18n-skip>{openedPublisher.profile.name}</h2><p data-i18n-skip>{openedPublisher.profile.bio}</p><dl>{openedPublisher.profile.type === "Сообщество" ? <><dt>{t("profile.communityType")}</dt><dd data-i18n-skip>{openedPublisher.profile.communityType}</dd><dt>{t("profile.communityRules")}</dt><dd data-i18n-skip>{openedPublisher.profile.communityRules}</dd></> : <><dt>{t("profile.publisherWebsite")}</dt><dd data-i18n-skip>{openedPublisher.profile.publisherWebsite}</dd><dt>{t("admin.legalName")}</dt><dd data-i18n-skip>{openedPublisher.profile.publisherLegalName}</dd><dt>{t("admin.bin")}</dt><dd data-i18n-skip>{openedPublisher.profile.publisherBin}</dd><dt>{t("admin.account")}</dt><dd data-i18n-skip>{openedPublisher.profile.publisherAccount}</dd><dt>{t("admin.bankDetails")}</dt><dd data-i18n-skip>{openedPublisher.profile.publisherBik} · {openedPublisher.profile.publisherBank}</dd><dt>{t("admin.legalAddress")}</dt><dd data-i18n-skip>{openedPublisher.profile.publisherLegalAddress}</dd><dt>{t("admin.postalAddress")}</dt><dd data-i18n-skip>{openedPublisher.profile.publisherPostalAddress}</dd></>}</dl><label className="moderation-comment">{t("admin.organizationComment", { type: domainLabel(openedPublisher.profile.type) })}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="admin-event-actions"><button className="outline-button" type="button" onClick={() => onOpenChat(openedPublisher.id)}>{t("admin.messageUser")}</button><button className="outline-button" type="button" onClick={async () => { await onModeratePublisher(openedPublisher.id, "revision", note); setOpenedPublisher(null); }}>{t("admin.requestChanges")}</button><button className="quiet-danger-button" type="button" onClick={async () => { await onModeratePublisher(openedPublisher.id, "reject", note); setOpenedPublisher(null); }}>{t("admin.reject")}</button><button className="primary-button" type="button" onClick={async () => { await onModeratePublisher(openedPublisher.id, "accept"); setOpenedPublisher(null); }}>{t("admin.confirm")}</button></div></section></div>}
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><EventForm initial={editing} catalog={books} submitLabel={t("common.saveChanges")} onCancel={() => setEditing(null)} onSave={async (value) => { await onModerate(editing.id, "edit", "", value); setEditing(null); setOpened(null); }} /></section></div>}
    {editingOccasion && <div className="modal-backdrop" onMouseDown={() => setEditingOccasion(null)}><section className="event-editor-modal" onMouseDown={(event) => event.stopPropagation()}><OccasionForm initial={editingOccasion} submitLabel={t("common.saveChanges")} onCancel={() => setEditingOccasion(null)} onSave={async (value) => { await onModerateOccasion(editingOccasion.id, "edit", "", value); setEditingOccasion(null); setOpenedOccasion(null); }} /></section></div>}
  </div>;
}

export function AdminSecurityPanel({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
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
    if (!response.ok) throw new Error(localizedApiError(data.error, t("security.statusError")));
    setStatus(data);
  }

  useEffect(() => {
    loadStatus().catch((reason) => setError(reason instanceof Error ? reason.message : t("security.statusError")));
  }, []);

  async function post<T>(url: string, body: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(localizedApiError(data.error, t("security.saveError")));
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
      setError(reason instanceof Error ? reason.message : t("security.keyError"));
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
      setError(reason instanceof Error ? reason.message : t("security.codeError"));
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
        if (!window.confirm(t("security.disableConfirm"))) return;
        await post<{ disabled: boolean }>("/api/auth/totp/disable", { password, code });
        setStatus({ enabled: false, pending: false, recoveryCodesLeft: 0 });
      }
      setPassword("");
      setCode("");
      setAction(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("security.changeError"));
    }
  }

  function recoveryText() {
    return `${t("security.recoveryCodesTitle")}\n\n${recoveryCodes.join("\n")}\n\n${t("security.recoveryOnce")}`;
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
    <button className="back-button" type="button" onClick={onBack}>← {t("admin.back")}</button>
    <div className="profile-title-row"><div><span className="section-subtitle">{t("security.account")}</span><h1>{t("security.twoFactor")}</h1><p>{t("security.intro")}</p></div></div>
    {error && <div className="security-message security-error">{error}</div>}
    {!status && !error && <div className="profile-tab-placeholder">{t("security.checkingStatus")}</div>}
    {recoveryCodes.length > 0 ? <section className="security-card recovery-card">
      <span className="security-status enabled">{t("security.enabled")}</span>
      <h2>{t("security.saveRecovery")}</h2>
      <p>{t("security.recoveryHint")}</p>
      <div className="recovery-code-grid" data-i18n-skip>{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
      <div className="security-actions"><button className="outline-button" type="button" onClick={() => void copyRecoveryCodes()}>{copied ? t("security.copied") : t("security.copy")}</button><button className="outline-button" type="button" onClick={downloadRecoveryCodes}>{t("security.download")}</button><button className="primary-button" type="button" onClick={() => setRecoveryCodes([])}>{t("security.savedCodes")}</button></div>
    </section> : status && !status.enabled ? <section className="security-card">
      <span className="security-status disabled">{t("security.disabled")}</span>
      {!setup ? <>
        <h2>{t("security.connectAuthenticator")}</h2>
        <p>{t("security.setupHint")}</p>
        {status.pending && <div className="security-message">{t("security.pendingHint")}</div>}
        <form className="security-form" onSubmit={startSetup}><label>{t("security.currentPassword")}<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? t("security.creating") : t("security.createQr")}</button></form>
      </> : <>
        <h2>{t("security.addToApp")}</h2>
        <div className="totp-setup-grid"><div className="totp-qr"><img src={setup.qrDataUrl} alt={t("security.qrAlt")} /></div><div><ol><li>{t("security.stepOpen")}</li><li>{t("security.stepScan")}</li><li>{t("security.stepScanCode")}</li><li>{t("security.stepEnterCode")}</li></ol><div className="manual-totp-key"><span>{t("security.manualKey")}</span><code data-i18n-skip>{setup.secret}</code></div></div></div>
        <form className="security-form security-confirm-form" onSubmit={confirmSetup}><label>{t("security.appCode")}<input required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label><button className="primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? t("auth.checking") : t("security.confirmEnable")}</button></form>
      </>}
    </section> : status?.enabled ? <section className="security-card">
      <span className="security-status enabled">{t("security.enabled")}</span>
      <h2>{t("security.connected")}</h2>
      <p>{t("security.connectedHint", { count: status.recoveryCodesLeft })}</p>
      {!action ? <div className="security-actions"><button className="outline-button" type="button" onClick={() => setAction("regenerate")}>{t("security.newRecovery")}</button><button className="quiet-danger-button" type="button" onClick={() => setAction("disable")}>{t("security.disable")}</button></div> : <form className="security-form protected-security-form" onSubmit={protectedAction}><h3>{action === "regenerate" ? t("security.replaceCodes") : t("security.confirmDisable")}</h3><label>{t("security.currentPassword")}<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>{t("security.appCode")}{action === "disable" ? ` ${t("security.orRecovery")}` : ""}<input required autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 19))} placeholder={action === "disable" ? t("security.codePlaceholder") : "000000"} /></label><div className="security-actions"><button type="button" onClick={() => { setAction(null); setPassword(""); setCode(""); }}>{t("common.cancel")}</button><button className={action === "disable" ? "danger-button" : "primary-button"} type="submit" disabled={busy}>{busy ? t("auth.checking") : action === "disable" ? t("security.disable") : t("security.createCodes")}</button></div></form>}
    </section> : null}
  </div>;
}

export function AdminProfile({ onBack, onLogout, events, occasions, users, catalog, reports, onModerateEvent, onModerateOccasion, onModeratePublisher, onOpenChat, onOpenUser, onRefresh, onDeleteMaterial }: { onBack: () => void; onLogout: () => void; events: BookEvent[]; occasions: Occasion[]; users: DemoUser[]; catalog: (LibraryBook | AuthorBook)[]; reports: SafetyReport[]; onModerateEvent: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, event?: typeof emptyEvent, pinned?: boolean) => Promise<void>; onModerateOccasion: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, occasion?: typeof emptyOccasion) => Promise<void>; onModeratePublisher: (id: number, action: "accept" | "revision" | "reject", note?: string) => Promise<void>; onOpenChat: (userId: number) => void; onOpenUser: (userId: number) => void; onRefresh: () => void; onDeleteMaterial: (kind: AdminCatalogKind, id: number) => Promise<void> }) {
  const { t } = useI18n();
  const [securityOpen, setSecurityOpen] = useState(false);
  const [complianceOpen, setComplianceOpen] = useState(false);
  return <main className="my-profile-page admin-profile-page"><div className="profile-page-topbar"><button type="button" className="back-button" onClick={onBack}>← {t("common.home")}</button><div className="admin-profile-top-actions">{!securityOpen && !complianceOpen && <><button type="button" className="outline-button" onClick={() => setComplianceOpen(true)}>{t("admin.compliance")}</button><button type="button" className="outline-button" onClick={() => setSecurityOpen(true)}>{t("security.title")}</button></>}<button type="button" className="back-button" onClick={onLogout}>{t("common.logout")}</button></div></div><section className="admin-profile-card">{securityOpen ? <AdminSecurityPanel onBack={() => setSecurityOpen(false)} /> : complianceOpen ? <AdminCompliancePanel onBack={() => setComplianceOpen(false)} onLogout={onLogout} /> : <AdminTab events={events} occasions={occasions} users={users} catalog={catalog} reports={reports} onModerate={onModerateEvent} onModerateOccasion={onModerateOccasion} onModeratePublisher={onModeratePublisher} onOpenChat={onOpenChat} onOpenUser={onOpenUser} onRefresh={onRefresh} onDeleteMaterial={onDeleteMaterial} />}</section></main>;
}

export function MyProfile({ onBack, user, users, catalog, friends, friendRequests, follows, events, occasions, likes, initialAction, initialEditId, initialEditing = false, onProfileCompleted, onToggleLike, onComment, onEditEvent, onDeleteEvent, onEditOccasion, onDeleteOccasion, onModerateEvent, onModerateOccasion, onLogout, onUserChange, onHomeViewChange, onOpenUser, onOpenChat }: { onBack: () => void; user: DemoUser; users: DemoUser[]; catalog: (LibraryBook | AuthorBook)[]; friends: DemoUser[]; friendRequests: FriendRequest[]; follows: Follow[]; events: BookEvent[]; occasions: Occasion[]; likes: Record<string, number[]>; initialAction?: "review" | "excerpt" | "book" | null; initialEditId?: number | null; initialEditing?: boolean; onProfileCompleted?: () => void; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onEditEvent: (item: BookEvent) => void; onDeleteEvent: (id: number) => void; onEditOccasion: (item: Occasion) => void; onDeleteOccasion: (id: number) => void; onModerateEvent: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, event?: typeof emptyEvent, pinned?: boolean) => Promise<void>; onModerateOccasion: (id: number, action: "accept" | "revision" | "reject" | "edit", note?: string, occasion?: typeof emptyOccasion) => Promise<void>; onLogout: () => void; onUserChange: (user: DemoUser) => Promise<void>; onHomeViewChange: (homeView: "classic" | "feed") => Promise<void>; onOpenUser: (userId: number) => void; onOpenChat: (userId: number) => void }) {
  const { t, domainLabel, formatNumber } = useI18n();
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
      window.alert(error instanceof Error ? error.message : t("settings.homeViewError"));
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
      window.alert(t("profile.saveError"));
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
      window.alert(t("profile.avatarError"));
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
    { key: "main", label: t("profile.main") },
    profile.type === "Писатель" ? { key: "author-books", label: `${t("authorBooks.mine")} · ${formatNumber(authorBooks.length)}` } : null,
    profile.type === "Издатель" ? { key: "author-books", label: `${t("profile.publisherBooks")} · ${formatNumber(authorBooks.length)}` } : null,
    profile.type === "Сообщество" ? { key: "author-books", label: `${t("profile.communityBooks")} · ${formatNumber(authorBooks.length)}` } : null,
    profile.type === "Писатель" || profile.type === "Блогер" ? { key: "excerpts", label: `${t("profile.blog")} · ${formatNumber(userExcerpts.length)}` } : null,
    profile.type === "Издатель" ? { key: "events", label: `${t("profile.publisherEvents")} · ${formatNumber(events.filter((item) => item.creatorId === user.id).length)}` } : null,
    profile.type === "Сообщество" ? { key: "events", label: `${t("profile.communityEvents")} · ${formatNumber(events.filter((item) => item.creatorId === user.id).length)}` } : null,
    profile.type === "Издатель" ? { key: "publisher-news", label: `${t("admin.publisherNews")} · ${formatNumber(publisherNews.length)}` } : null,
    profile.type === "Сообщество" ? { key: "publisher-news", label: `${t("admin.communityNews")} · ${formatNumber(publisherNews.length)}` } : null,
    !["Издатель", "Сообщество"].includes(profile.type) ? { key: "library", label: `${t("profile.library")} · ${formatNumber(books.length)}` } : null,
    profile.type === "Читатель" || profile.type === "Блогер" ? { key: "wishlist", label: `${t("wishlist.title")} · ${formatNumber(wishBooks.length)}` } : null,
    profile.type === "Читатель" || profile.type === "Блогер" ? { key: "reviews", label: `${t("profile.reviews")} · ${formatNumber(reviews.length)}` } : null,
    !["Издатель", "Сообщество"].includes(profile.type) ? { key: "events", label: `${t("event.myEvents")} · ${formatNumber(events.filter((item) => item.creatorId === user.id).length + events.filter((item) => item.creatorId !== user.id && item.reminderSet).length)}` } : null,
    !["Издатель", "Сообщество"].includes(profile.type) ? { key: "occasions", label: `${t("profile.occasions")} · ${formatNumber(occasions.filter((item) => item.creatorId === user.id).length)}` } : null,
    { key: "friends", label: profile.type === "Сообщество" ? `${t("profile.communityMembers")} · ${formatNumber(friends.length)}` : profile.type === "Издатель" ? `${t("profile.subscriptions")} · ${formatNumber(follows.filter((item) => item.followerId === user.id).length)}` : `${t("profile.friends")} · ${formatNumber(friends.length)}` },
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
      window.alert(localizedApiError(data.error, t("profile.deleteError")));
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
      window.alert(t("settings.menuVisibilityError"));
    }
  }

  return (
    <main className="my-profile-page">
      <div className="profile-page-topbar">
        <button type="button" className="back-button" onClick={() => leaveOrWarn(onBack)}>← {t("common.home")}</button>
        <div className="profile-top-actions">{saved && <span className="saved-toast">{t("common.changesSaved")}</span>}<button type="button" className="back-button" onClick={() => leaveOrWarn(onLogout)}>{t("common.logout")}</button></div>
      </div>
      <section className="my-profile-card">
        <div className="my-profile-aside">
          <div className={`avatar avatar-xl avatar-user ${avatarUrl ? "has-photo" : ""}`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && user.initials}<span className="online-dot" /></div>
          <input ref={avatarInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void changeAvatar(event.target.files?.[0])} />
          <button type="button" className="change-photo" onClick={() => avatarInputRef.current?.click()}>{t("profile.changePhoto")}</button>
          <nav className="profile-nav" aria-label={t("profile.sections")}>
            {orderedProfileTabs.map((item) => <div ref={(element) => { if (element) tabRowRefs.current.set(item.key, element); else tabRowRefs.current.delete(item.key); }} className={`profile-nav-row ${reorderingTabs ? "is-reordering" : ""}`} key={item.key} onDragOver={(event) => { if (reorderingTabs) event.preventDefault(); }} onDragEnter={() => moveDraggedTab(item.key)} onDrop={() => setDraggedTab(null)}>
              {reorderingTabs && item.key !== "main" && <span className="profile-tab-drag-handle" draggable onDragStart={() => { for (const [tab, element] of tabRowRefs.current) previousTabPositions.current.set(tab, element.getBoundingClientRect().top); setDraggedTab(item.key); }} onDragEnd={() => setDraggedTab(null)} aria-label={t("settings.moveTab", { label: item.label })} title={t("settings.dragTab")}>☰</span>}
              <button className={activeTab === item.key ? "active" : ""} type="button" onClick={() => openTab(item.key)}>{item.label}</button>
            </div>)}
            <button className={activeTab === "settings" ? "active" : ""} type="button" onClick={() => openTab("settings")}>{t("profile.settings")}</button>
          </nav>
        </div>
        <div className={`my-profile-main ${activeTab === "library" ? "library-main" : ""}`}>
          {activeTab === "main" && <>
            <div className="profile-title-row">
              <div><h1 data-i18n-skip>{profile.name}</h1><p>{domainLabel(profile.type)}{profile.city ? <> · <span data-i18n-skip>{profile.city}</span></> : ""}</p></div>
              {!editing && <div className="profile-main-actions"><LinkedProfileControls profileType={profile.type} /><button className="outline-button profile-edit-button" type="button" onClick={() => setEditing(true)}>{t("common.edit")}</button></div>}
            </div>
            {editing ? (
              <form className="profile-form" noValidate onSubmit={save}>
                {profile.type === "Сообщество" ? <div className="community-profile-fields">
                   <label className={invalidFields.name ? "field-invalid" : ""}>{t("directory.communityName")} *<input required aria-invalid={invalidFields.name} value={profile.name} onChange={(event) => { setProfile({ ...profile, name: event.target.value }); setInvalidFields((current) => ({ ...current, name: false })); }} /></label>
                  <CityAutocomplete value={profile.city} required invalid={invalidFields.city} onChange={(city, cityId, country) => { setProfile({ ...profile, city, cityId, country }); setInvalidFields((current) => ({ ...current, city: false })); }} />
                   <label>{t("profile.profileType")}<CustomSelect ariaLabel={t("profile.profileType")} value={profile.type} onChange={(type) => { if (["Издатель", "Сообщество"].includes(type) && profile.type !== type) { setPendingOrganizationType(type as "Издатель" | "Сообщество"); setPublisherTypeNotice(true); } else setProfile({ ...profile, type }); }} options={["Читатель", "Писатель", "Блогер", "Издатель", "Сообщество"].map((item) => ({ value: item as UserProfileData["type"], label: domainLabel(item) }))} /></label>
                   <label>{t("profile.communityType")} *<input required value={profile.communityType ?? ""} onChange={(event) => setProfile({ ...profile, communityType: event.target.value })} placeholder={t("linked.communityPlaceholder")} /></label>
                   <label>{t("profile.aboutCommunity")} *<textarea required rows={5} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></label>
                   <label>{t("profile.communityRules")} *<textarea required rows={5} value={profile.communityRules ?? ""} onChange={(event) => setProfile({ ...profile, communityRules: event.target.value })} /></label>
                </div> : <><div className="form-row">
                   <label className={invalidFields.name ? "field-invalid" : ""}>{profile.type === "Издатель" ? `${t("directory.publisherName")} *` : `${t("profile.name")} *`}<input required aria-invalid={invalidFields.name} value={profile.name} onChange={(event) => { setProfile({ ...profile, name: event.target.value }); setInvalidFields((current) => ({ ...current, name: false })); }} /></label>
                   <label>{t("profile.profileType")}<CustomSelect ariaLabel={t("profile.profileType")} value={profile.type} onChange={(type) => { if (["Издатель", "Сообщество"].includes(type) && profile.type !== type) { setPendingOrganizationType(type as "Издатель" | "Сообщество"); setPublisherTypeNotice(true); } else setProfile({ ...profile, type }); }} options={["Читатель", "Писатель", "Блогер", "Издатель", "Сообщество"].map((item) => ({ value: item as UserProfileData["type"], label: domainLabel(item) }))} /></label>
                </div>
                 <div className="form-row profile-identity-row"><CityAutocomplete value={profile.city} required invalid={invalidFields.city} onChange={(city, cityId, country) => { setProfile({ ...profile, city, cityId, country }); setInvalidFields((current) => ({ ...current, city: false })); }} />{!["Издатель", "Сообщество"].includes(profile.type) && <label className={invalidFields.birthDate ? "field-invalid" : ""}>{t("profile.birthDate")} *<input required aria-invalid={invalidFields.birthDate} type="date" max={new Date().toISOString().slice(0, 10)} value={profile.birthDate ?? ""} onChange={(event) => { setProfile({ ...profile, birthDate: event.target.value }); setInvalidFields((current) => ({ ...current, birthDate: false })); }} /></label>}</div>
                 {!["Издатель", "Сообщество"].includes(profile.type) && <div className="form-row profile-demographics-row"><label>{t("profile.gender")}<CustomSelect ariaLabel={t("profile.gender")} value={profile.gender} onChange={(gender) => setProfile({ ...profile, gender })} options={["Не указан", "Мужской", "Женский"].map((item) => ({ value: item as UserProfileData["gender"], label: domainLabel(item) }))} /></label><label className="profile-checkbox profile-birth-visibility"><input type="checkbox" checked={Boolean(profile.showBirthDateToFriends)} onChange={(event) => setProfile({ ...profile, showBirthDateToFriends: event.target.checked })} />{t("profile.showBirthDate")}</label></div>}
                </>}
                {profile.type === "Издатель" ? <>
                  <label>{t("profile.publisherWebsite")} *<input required type="url" value={profile.publisherWebsite ?? ""} onChange={(event) => setProfile({ ...profile, publisherWebsite: event.target.value })} /></label>
                  <label>{t("profile.aboutPublisher")} *<textarea required rows={5} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></label>
                  <fieldset className="publisher-sales-editor"><legend>{t("profile.bookSales")}</legend>{(profile.publisherSalesLinks ?? []).map((link, index) => <div className="form-row" key={link.id}><label>{t("profile.storeName")}<input value={link.label} onChange={(event) => setProfile({ ...profile, publisherSalesLinks: (profile.publisherSalesLinks ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} /></label><label>{t("book.link")}<input type="url" value={link.url} onChange={(event) => setProfile({ ...profile, publisherSalesLinks: (profile.publisherSalesLinks ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item) })} /></label></div>)}<button className="outline-button" type="button" disabled={(profile.publisherSalesLinks ?? []).length >= 5} onClick={() => setProfile({ ...profile, publisherSalesLinks: [...(profile.publisherSalesLinks ?? []), { id: Date.now(), label: "", url: "" }] })}>＋ {t("profile.addStore")}</button></fieldset>
                  <div className="publisher-private-heading"><h3>{t("profile.legalData")}</h3><p>{t("profile.privateLegalHint")}</p></div>
                  <label>{t("admin.legalName")} *<input required value={profile.publisherLegalName ?? ""} onChange={(event) => setProfile({ ...profile, publisherLegalName: event.target.value })} /></label>
                  <div className="form-row"><label>{t("admin.bin")} *<input required inputMode="numeric" value={profile.publisherBin ?? ""} onChange={(event) => setProfile({ ...profile, publisherBin: event.target.value.replace(/\D/g, "").slice(0, 12) })} /></label><label>{t("admin.account")} *<input required value={profile.publisherAccount ?? ""} onChange={(event) => setProfile({ ...profile, publisherAccount: event.target.value })} /></label></div>
                  <div className="form-row"><label>{t("admin.bik")} *<input required value={profile.publisherBik ?? ""} onChange={(event) => setProfile({ ...profile, publisherBik: event.target.value })} /></label><label>{t("admin.bank")} *<input required value={profile.publisherBank ?? ""} onChange={(event) => setProfile({ ...profile, publisherBank: event.target.value })} /></label></div>
                  <label>{t("admin.legalAddress")} *<textarea required rows={3} value={profile.publisherLegalAddress ?? ""} onChange={(event) => setProfile({ ...profile, publisherLegalAddress: event.target.value })} /></label>
                  <label>{t("admin.postalAddress")} *<textarea required rows={3} value={profile.publisherPostalAddress ?? ""} onChange={(event) => setProfile({ ...profile, publisherPostalAddress: event.target.value })} /></label>
                </> : profile.type === "Сообщество" ? null : <>
                <label>{t("profile.aboutMe")}<textarea rows={4} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></label>
                {profile.type === "Писатель" && <div className="form-row"><label>{t("profile.authorInfluences")}<textarea rows={4} value={profile.authorInfluences} onChange={(event) => setProfile({ ...profile, authorInfluences: event.target.value })} /></label><label>{t("profile.writingThemes")}<textarea rows={4} value={profile.writingThemes} onChange={(event) => setProfile({ ...profile, writingThemes: event.target.value })} /></label></div>}
                <label>{t("profile.weekend")}<textarea rows={3} value={profile.weekend} onChange={(event) => setProfile({ ...profile, weekend: event.target.value })} /></label>
                <label>{t("profile.joy")}<textarea rows={3} value={profile.joy} onChange={(event) => setProfile({ ...profile, joy: event.target.value })} /></label>
                <label>{t("profile.talk")}<textarea rows={3} value={profile.talk} onChange={(event) => setProfile({ ...profile, talk: event.target.value })} /></label>
                <label>{t("profile.strangerMessage")}<textarea rows={4} value={profile.strangerMessage} onChange={(event) => setProfile({ ...profile, strangerMessage: event.target.value })} /></label>
                <GenrePicker label={t("profile.favoriteGenres")} value={profile.favoriteGenres} onChange={(favoriteGenres) => setProfile({ ...profile, favoriteGenres })} />
                <GenrePicker label={t("profile.dislikedGenres")} value={profile.dislikedGenres} onChange={(dislikedGenres) => setProfile({ ...profile, dislikedGenres })} />
                </>}
                <div className="form-actions"><button type="button" onClick={() => leaveOrWarn(() => setEditing(false))}>{t("common.cancel")}</button><button className="primary-button" type="submit">{t("common.save")}</button></div>
              </form>
            ) : (
              <div className="profile-details">
                {profile.type === "Сообщество" ? <>
                  <div className="publisher-status-card"><span>{t("profile.status")}</span><p>{profile.publisherStatus === "approved" ? t("profile.communityApproved") : profile.publisherStatus === "needs_changes" ? t("status.needsChanges") : profile.publisherStatus === "rejected" ? t("profile.rejected") : t("profile.moderation")}</p>{profile.publisherModerationNote && <small data-i18n-skip>{profile.publisherModerationNote}</small>}</div>
                  <div><span>{t("profile.communityType")}</span><p data-i18n-skip>{profile.communityType}</p></div>
                  <div className="profile-wide-field"><span>{t("profile.aboutCommunity")}</span><p data-i18n-skip>{profile.bio}</p></div>
                  <div className="profile-wide-field"><span>{t("profile.communityRules")}</span><p data-i18n-skip>{profile.communityRules}</p></div>
                </> : profile.type === "Издатель" ? <>
                  <div className="publisher-status-card"><span>{t("profile.status")}</span><p>{profile.publisherStatus === "approved" ? t("profile.publisherApproved") : profile.publisherStatus === "needs_changes" ? t("status.needsChanges") : profile.publisherStatus === "rejected" ? t("profile.rejected") : t("profile.moderation")}</p>{profile.publisherModerationNote && <small data-i18n-skip>{profile.publisherModerationNote}</small>}</div>
                  <div className="profile-wide-field"><span>{t("profile.aboutPublisher")}</span><p data-i18n-skip>{profile.bio}</p></div>
                  <div><span>{t("profile.publisherWebsite")}</span><p data-i18n-skip>{profile.publisherWebsite && <a href={profile.publisherWebsite} target="_blank" rel="noreferrer">{profile.publisherWebsite}</a>}</p></div>
                  <div><span>{t("profile.bookSales")}</span><div className="writer-book-links" data-i18n-skip>{(profile.publisherSalesLinks ?? []).map((link) => <a className="outline-button" key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</div></div>
                  <div className="publisher-private-details profile-wide-field"><span>{t("profile.privateLegalTitle")}</span><p data-i18n-skip><b>{profile.publisherLegalName}</b><br />{t("admin.bin")}: {profile.publisherBin}<br />{t("admin.account")}: {profile.publisherAccount}<br />{t("admin.bik")}: {profile.publisherBik} · {profile.publisherBank}<br />{t("admin.legalAddress")}: {profile.publisherLegalAddress}<br />{t("admin.postalAddress")}: {profile.publisherPostalAddress}</p></div>
                </> : <>
                <div><span>{t("profile.age")}</span><p>{profile.age !== undefined ? formatNumber(profile.age) : t("profile.ageCalculated")}</p></div>
                <div><span>{t("profile.aboutMe")}</span><p data-i18n-skip>{profile.bio}</p></div>
                {profile.type === "Писатель" && <><div><span>{t("profile.authorInfluences")}</span><p data-i18n-skip>{profile.authorInfluences}</p></div><div><span>{t("profile.writingThemes")}</span><p data-i18n-skip>{profile.writingThemes}</p></div></>}
                <div><span>{t("profile.weekend")}</span><p data-i18n-skip>{profile.weekend}</p></div>
                <div><span>{t("profile.joy")}</span><p data-i18n-skip>{profile.joy}</p></div>
                <div><span>{t("profile.talk")}</span><p data-i18n-skip>{profile.talk}</p></div>
                <div className="stranger-message"><span>{t("profile.strangerMessage")}</span><p data-i18n-skip>{profile.strangerMessage}</p></div>
                <div><span>{t("profile.favoriteGenres")}</span><div className="profile-tags" data-i18n-skip>{profile.favoriteGenres.map((genre) => <span key={genre}>{genre}</span>)}</div></div>
                <div><span>{t("profile.dislikedGenres")}</span><div className="profile-tags disliked-tags" data-i18n-skip>{profile.dislikedGenres.map((genre) => <span key={genre}>{genre}</span>)}</div></div>
                {profile.type === "Писатель" && <div><span>{t("authorBooks.mine")}</span><p data-i18n-skip={Boolean(authorBooks.length)}>{authorBooks.length ? authorBooks.map((book) => book.title).join(" · ") : t("authorBooks.empty")}</p></div>}
                </>}
              </div>
            )}
          </>}
          {activeTab === "author-books" && (profile.type === "Писатель" || ["Издатель", "Сообщество"].includes(profile.type)) && <AuthorBooksTab books={authorBooks} setBooks={setAuthorBooks} userId={user.id} author={profile.name} users={users} publisherMode={["Издатель", "Сообщество"].includes(profile.type)} communityMode={profile.type === "Сообщество"} canCreate={profile.type === "Писатель" || profile.publisherStatus === "approved"} />}
          {activeTab === "excerpts" && (profile.type === "Писатель" || profile.type === "Блогер") && <ExcerptsTab excerpts={userExcerpts} setExcerpts={setUserExcerpts} owner={{ ...user, profile, excerpts: userExcerpts }} users={users} catalog={catalog} likes={likes} onToggleLike={onToggleLike} onComment={onComment} onOpenUser={onOpenUser} initialAdd={initialAction === "excerpt" && !initialEditId} initialEditId={initialAction === "excerpt" ? initialEditId : null} />}
          {activeTab === "publisher-news" && ["Издатель", "Сообщество"].includes(profile.type) && <PublisherNewsTab news={publisherNews} setNews={setPublisherNews} owner={{ ...user, profile, publisherNews }} users={users} catalog={catalog} canCreate={profile.publisherStatus === "approved"} communityMode={profile.type === "Сообщество"} />}
          {activeTab === "library" && !["Издатель", "Сообщество"].includes(profile.type) && <LibraryTab books={books} setBooks={setBooks} userId={user.id} users={users} catalog={catalog} initialAdd={initialAction === "book"} />}
          {activeTab === "wishlist" && (profile.type === "Читатель" || profile.type === "Блогер") && <WishlistTab books={wishBooks} setBooks={setWishBooks} owner={{ ...user, profile, wishBooks }} viewer={{ ...user, profile, wishBooks }} users={users} />}
          {activeTab === "reviews" && (profile.type === "Читатель" || profile.type === "Блогер") && <ReviewsTab reviews={reviews} setReviews={setReviews} owner={{ ...user, profile, books, reviews }} users={users} catalog={catalog} likes={likes} onToggleLike={onToggleLike} onComment={onComment} onOpenUser={onOpenUser} initialAdd={initialAction === "review" && !initialEditId} initialEditId={initialAction === "review" ? initialEditId : null} />}
          {activeTab === "events" && <MyEventsTab createdEvents={events.filter((item) => item.creatorId === user.id)} participatingEvents={events.filter((item) => item.creatorId !== user.id && item.reminderSet)} users={users} catalog={catalog} currentUserId={user.id} onOpenUser={onOpenUser} onEdit={onEditEvent} onDeleted={onDeleteEvent} />}
          {activeTab === "occasions" && <div className="simple-profile-tab"><div className="profile-title-row"><div><h1>{t("profile.occasions")}</h1><p>{t("occasion.createdCount", { count: formatNumber(occasions.filter((item) => item.creatorId === user.id).length) })}</p></div></div><div className="occasion-grid">{occasions.filter((item) => item.creatorId === user.id).map((item) => <OccasionCard key={item.id} item={item} own onOpen={() => setOpenedOwnOccasion(item)} onEdit={() => onEditOccasion(item)} />)}</div>{!occasions.some((item) => item.creatorId === user.id) && <div className="profile-tab-placeholder">{t("occasion.noneCreated")}</div>}{openedOwnOccasion && <OccasionModal item={openedOwnOccasion} currentUser={user} users={users} onOpenUser={onOpenUser} onOpenBook={setOpenedOwnOccasionBookId} onClose={() => setOpenedOwnOccasion(null)} onEdit={() => { onEditOccasion(openedOwnOccasion); setOpenedOwnOccasion(null); }} onDelete={async () => { if (!window.confirm(t("occasion.deleteConfirm"))) return; const response = await fetch(`/api/occasions/${openedOwnOccasion.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert(t("occasion.deleteError")); return; } onDeleteOccasion(openedOwnOccasion.id); setOpenedOwnOccasion(null); }} />}{openedOwnOccasionBookId && catalog.find((book) => book.id === openedOwnOccasionBookId) && <UnifiedBookModal book={catalog.find((book) => book.id === openedOwnOccasionBookId)!} users={users} catalog={catalog} nested onOpenUser={onOpenUser} onClose={() => setOpenedOwnOccasionBookId(null)} />}</div>}
          {activeTab === "friends" && <ProfileFriendsTab friends={friends} outgoing={friendRequests.filter((request) => request.status === "pending" && request.fromId === user.id).map((request) => users.find((item) => item.id === request.toId)).filter(Boolean) as DemoUser[]} incoming={friendRequests.filter((request) => request.status === "pending" && request.toId === user.id).map((request) => users.find((item) => item.id === request.fromId)).filter(Boolean) as DemoUser[]} subscriptions={follows.filter((follow) => follow.followerId === user.id).map((follow) => users.find((item) => item.id === follow.targetId)).filter((item): item is DemoUser => Boolean(item) && !item!.isAdmin)} followers={follows.filter((follow) => follow.targetId === user.id).map((follow) => users.find((item) => item.id === follow.followerId)).filter((item): item is DemoUser => Boolean(item) && !item!.isAdmin)} communityMode={profile.type === "Сообщество"} publisherMode={profile.type === "Издатель"} onOpenUser={onOpenUser} />}
          {activeTab === "settings" && <div className="simple-profile-tab profile-settings-stack"><div className="profile-title-row"><div><h1>{t("profile.settings")}</h1><p>{t("settings.manageProfile")}</p></div></div><section className="profile-home-view-settings"><h2>{t("settings.defaultHome")}</h2><div className="profile-home-view-options"><button className={homeView === "classic" ? "active" : ""} type="button" onClick={() => void chooseHomeView("classic")}>{t("settings.classicHome")}</button><button className={homeView === "feed" ? "active" : ""} type="button" onClick={() => void chooseHomeView("feed")}>{t("content.feed")}</button></div></section><section className="profile-menu-visibility-settings"><h2>{t("settings.showMenu")}</h2><div className="profile-menu-visibility-list">{profileTabs.filter((item) => item.key !== "main").map((item) => <label key={item.key}><input type="checkbox" checked={!hiddenTabsDraft.includes(item.key)} onChange={(event) => void toggleProfileTabVisibility(item.key, event.target.checked)} />{item.label.split(" · ")[0]}</label>)}</div></section><section className="profile-menu-order-settings"><h2>{t("settings.changeOrder")}</h2><div className="profile-menu-order-actions"><button className="outline-button" type="button" onClick={() => { setTabOrderDraft(profile.tabOrder ?? defaultTabOrder); setReorderingTabs(true); }}>{t("common.edit")}</button>{reorderingTabs && <button className="primary-button" type="button" onClick={() => void applyTabOrder()}>{t("settings.apply")}</button>}</div></section><LinkedProfileControls profileType={profile.type} settings /><section className="blocked-users-settings"><h2>{t("profile.blocked")}</h2>{users.some((item) => item.blockedByMe) ? <div className="blocked-user-grid">{users.filter((item) => item.blockedByMe).map((item) => <button type="button" key={item.id} className="blocked-user-card" onClick={() => onOpenUser(item.id)}><span className={`avatar avatar-sm avatar-${item.color} ${item.avatarUrl ? "has-photo" : ""}`} style={item.avatarUrl ? { backgroundImage: `url(${item.avatarUrl})` } : undefined}>{!item.avatarUrl && item.initials}</span><span><strong data-i18n-skip>{item.profile.name}</strong><small>{domainLabel(item.profile.type)} · <span data-i18n-skip>{item.profile.city}</span></small></span></button>)}</div> : <p>{t("settings.noBlocked")}</p>}</section><section className="profile-delete-settings"><h2>{t("profile.delete")}</h2><p>{t("settings.deleteHint")}</p><button className="quiet-danger-button" type="button" onClick={() => setDeleteProfileConfirm(true)}>{t("profile.delete")}</button></section></div>}
        </div>
      </section>
      {activeTab === "settings" && <UserComplaints />}
      {deleteProfileConfirm && <div className="notice-backdrop" role="presentation" onMouseDown={() => setDeleteProfileConfirm(false)}><section className="confirm-social-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>{t("settings.deleteConfirm")}</h2><p>{t("settings.deleteRestore")}</p><div className="form-actions"><button type="button" onClick={() => setDeleteProfileConfirm(false)}>{t("common.cancel")}</button><button className="quiet-danger-button" type="button" onClick={() => void deleteProfile()}>{t("common.delete")}</button></div></section></div>}
      {requiredNotice && <div className="notice-backdrop" role="presentation" onMouseDown={() => setRequiredNotice(false)}><section className="required-fields-notice" role="alertdialog" aria-modal="true" aria-labelledby="required-fields-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="required-fields-title">{t("form.requiredFields")}</h2><button className="primary-button" type="button" autoFocus onClick={() => setRequiredNotice(false)}>{t("common.ok")}</button></section></div>}
      {publisherTypeNotice && <div className="notice-backdrop" role="presentation"><section className="publisher-type-notice" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>{t("profile.organizationVerification")}</h2><p>{pendingOrganizationType === "Сообщество" ? t("profile.communityVerificationHint") : t("profile.publisherVerificationHint")}</p><div className="form-actions"><button type="button" onClick={() => setPublisherTypeNotice(false)}>{t("common.cancel")}</button><button className="primary-button" type="button" onClick={() => { setProfile({ ...profile, type: pendingOrganizationType, city: "", cityId: undefined, gender: "Не указан", publisherStatus: "draft", publisherSalesLinks: profile.publisherSalesLinks ?? [] }); setPublisherTypeNotice(false); }}>{t("book.continue")}</button></div></section></div>}
      {unsavedNotice && <div className="notice-backdrop" role="presentation"><section className="unsaved-changes-notice" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-changes-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="unsaved-changes-title">{t("profile.unsavedConfirm")}</h2><div className="form-actions"><button type="button" onClick={discardChangesAndLeave}>{t("profile.leaveWithoutSaving")}</button><button className="primary-button" type="button" autoFocus onClick={() => { pendingExitRef.current = null; setUnsavedNotice(false); }}>{t("profile.returnEditing")}</button></div></section></div>}
    </main>
  );
}
