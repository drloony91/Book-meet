import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { apiFetch } from "../../services/api";
import { useI18n } from "../../i18n";
import MarketplaceConversations from "./MarketplaceConversations";
import "./marketplace-listings.css";

export type MarketplaceCity = { id: number; name: string; country?: string; countryCode?: string };
export type MarketplaceCatalogBook = { id: number; title: string; author: string };
export type MarketplaceImage = { id: number; url: string };
export type MarketplaceListing = {
  id: number; sellerId: number | null; sellerName: string; sellerUsername: string;
  catalogBookId: number | null; title: string; author: string; type: "sale" | "exchange";
  condition: string; description: string; cityId: number | null; cityName: string;
  price: number | null; currency: string | null; exchangeWishes: string | null;
  status: "active" | "reserved" | "sold" | "exchanged" | "closed";
  images: MarketplaceImage[]; createdAt: string; updatedAt: string;
};

type Props = {
  catalogBooks?: MarketplaceCatalogBook[];
  accessAllowed?: boolean;
  currentUserId: number;
};
type PageResult = { listings: MarketplaceListing[]; nextBeforeId: number | null };
type Draft = {
  catalogBookId: string; title: string; author: string; type: "sale" | "exchange";
  condition: string; description: string; price: string; currency: string;
  exchangeWishes: string; status: MarketplaceListing["status"];
};
const emptyDraft: Draft = { catalogBookId: "", title: "", author: "", type: "sale", condition: "", description: "", price: "", currency: "KZT", exchangeWishes: "", status: "active" };

function words(locale: string, ru: string, kk: string, en: string) { return locale === "kk" ? kk : locale === "en" ? en : ru; }
function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}
async function responseJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(errorMessage(payload, response.statusText)), { status: response.status, code: (payload as { code?: string })?.code });
  return payload;
}
function asDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read image"));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
}
function formatMoney(price: number | null, currency: string | null, locale: string) {
  if (price == null) return "";
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "KZT", maximumFractionDigits: 2 }).format(price); }
  catch { return `${price} ${currency ?? ""}`.trim(); }
}

function MarketplaceCityPicker({ selected, onSelect, label, placeholder, noResults, required = false }: { selected: MarketplaceCity | null; onSelect: (city: MarketplaceCity | null) => void; label: string; placeholder: string; noResults: string; required?: boolean }) {
  const [query, setQuery] = useState(selected?.name ?? "");
  const [results, setResults] = useState<MarketplaceCity[]>([]);
  const [searching, setSearching] = useState(false);
  const requestId = useRef(0);
  useEffect(() => { setQuery(selected?.name ?? ""); }, [selected?.id, selected?.name]);
  useEffect(() => {
    const search = query.trim();
    if (search.length < 2 || search === selected?.name) { setResults([]); return; }
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await apiFetch(`/api/cities?q=${encodeURIComponent(search)}`);
        const result = await responseJson(response) as { cities?: MarketplaceCity[] };
        if (id === requestId.current) setResults(Array.isArray(result.cities) ? result.cities : []);
      } catch { if (id === requestId.current) setResults([]); }
      finally { if (id === requestId.current) setSearching(false); }
    }, 250);
    return () => { window.clearTimeout(timer); if (id === requestId.current) requestId.current += 1; };
  }, [query, selected?.name]);
  return <div className="marketplace-city-picker"><span className="marketplace-city-label">{label}</span><input aria-label={label} autoComplete="off" required={required} value={query} placeholder={placeholder} onChange={(event) => { setQuery(event.target.value); if (selected) onSelect(null); }} />
    {searching && <small role="status">…</small>}
    {results.length > 0 && <ul className="marketplace-city-options" role="listbox">{results.map((city) => <li key={city.id}><button type="button" role="option" onClick={() => { onSelect(city); setQuery(city.name); setResults([]); }}>{city.name}{city.country ? `, ${city.country}` : ""}</button></li>)}</ul>}
    {selected && <span className="marketplace-city-selected">{selected.name}<button type="button" onClick={() => { onSelect(null); setQuery(""); }} aria-label={`${label}: clear`}>×</button></span>}
    {query.trim().length >= 2 && !searching && results.length === 0 && !selected && <small>{noResults}</small>}
  </div>;
}

export default function MarketplaceListings({ catalogBooks = [], accessAllowed, currentUserId }: Props) {
  const { locale } = useI18n();
  const [view, setView] = useState<"browse" | "mine">("browse");
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [filters, setFilters] = useState({ q: "", cityId: "", type: "", condition: "", minPrice: "", maxPrice: "" });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [selectedFilterCity, setSelectedFilterCity] = useState<MarketplaceCity | null>(null);
  const nextBeforeId = useRef<number | null>(null);
  const feedRequestId = useRef(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(accessAllowed === false);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<MarketplaceListing | null>(null);
  const [editing, setEditing] = useState<MarketplaceListing | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [selectedDraftCity, setSelectedDraftCity] = useState<MarketplaceCity | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [replaceImages, setReplaceImages] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [conversationListing, setConversationListing] = useState<MarketplaceListing | null>(null);
  const [reportListing, setReportListing] = useState<MarketplaceListing | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportSellerListing, setReportSellerListing] = useState<MarketplaceListing | null>(null);
  const [reportSellerReason, setReportSellerReason] = useState("");

  const copy = useMemo(() => ({
    title: words(locale, "Книжный маркетплейс", "Кітап маркетплейсі", "Book marketplace"),
    browse: words(locale, "Объявления", "Хабарландырулар", "Listings"), mine: words(locale, "Мои объявления", "Менің хабарландыруларым", "My listings"),
    create: words(locale, "＋ Разместить объявление", "＋ Хабарландыру қосу", "＋ Create listing"),
    safety: words(locale, "Будьте осторожны: Book Meet не принимает оплату и не гарантирует безопасность сделки. Условия встречи, доставки и расчёта согласуйте самостоятельно.", "Сақ болыңыз: Book Meet төлем қабылдамайды және мәміле қауіпсіздігіне кепілдік бермейді. Кездесу, жеткізу және есеп айырысу шарттарын өзара келісіңіз.", "Stay cautious: Book Meet does not process payments or guarantee transaction safety. Agree on meeting, delivery and payment directly."),
    adult: words(locale, "Раздел доступен только совершеннолетним пользователям личных профилей.", "Бөлім тек кәмелетке толған жеке профиль иелеріне қолжетімді.", "This section is available only to adults with personal profiles."),
  }), [locale]);

  const load = useCallback(async (append = false) => {
    if (accessAllowed === false || blocked) return;
    const requestId = ++feedRequestId.current;
    setLoading(true); setNotice("");
    try {
      const params = new URLSearchParams();
      if (view === "browse") {
        Object.entries(appliedFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
        if (selectedFilterCity) params.set("cityId", String(selectedFilterCity.id));
        params.set("limit", "20");
        if (append && nextBeforeId.current) params.set("beforeId", String(nextBeforeId.current));
      }
      const response = await apiFetch(`/api/marketplace/listings${view === "mine" ? "/mine" : `?${params.toString()}`}`);
      const result = await responseJson(response) as PageResult;
      if (requestId !== feedRequestId.current) return;
      setListings((current) => append ? [...current, ...result.listings.filter((item) => !current.some((old) => old.id === item.id))] : result.listings);
      nextBeforeId.current = result.nextBeforeId ?? null;
    } catch (error) {
      const err = error as Error & { status?: number; code?: string };
      if (requestId !== feedRequestId.current) return;
      if (err.status === 403 || err.code === "MARKETPLACE_ADULTS_ONLY") { setBlocked(true); setListings([]); }
      else setNotice(err.message || words(locale, "Не удалось загрузить объявления", "Хабарландыруларды жүктеу мүмкін болмады", "Could not load listings"));
    } finally { if (requestId === feedRequestId.current) setLoading(false); }
  }, [accessAllowed, appliedFilters, blocked, locale, selectedFilterCity, view]);

  useEffect(() => { if (accessAllowed !== false) void load(false); else { feedRequestId.current += 1; setBlocked(true); } }, [accessAllowed, view, load]);
  useEffect(() => { if (accessAllowed === true) setBlocked(false); }, [accessAllowed]);

  function startCreate() { setEditing(null); setDraft(emptyDraft); setSelectedDraftCity(null); setFiles([]); setReplaceImages(false); setShowForm(true); setNotice(""); }
  function startEdit(item: MarketplaceListing) {
    setEditing(item); setSelectedDraftCity(item.cityId ? { id: item.cityId, name: item.cityName } : null); setDraft({ catalogBookId: item.catalogBookId ? String(item.catalogBookId) : "", title: item.catalogBookId ? "" : item.title, author: item.catalogBookId ? "" : item.author, type: item.type, condition: item.condition, description: item.description, price: item.price == null ? "" : String(item.price), currency: item.currency ?? "KZT", exchangeWishes: item.exchangeWishes ?? "", status: item.status });
    setFiles([]); setReplaceImages(false); setShowForm(true); setSelected(null); setNotice("");
  }
  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    if (chosen.length > 6) { setNotice(words(locale, "Можно выбрать не более 6 изображений", "6 суреттен артық таңдауға болмайды", "Choose up to 6 images")); event.target.value = ""; return; }
    if (chosen.some((file) => file.size > 800 * 1024)) { setNotice(words(locale, "Размер каждого изображения не должен превышать 800 КиБ", "Әр сурет өлшемі 800 КиБ-тан аспауы керек", "Each image must be 800 KiB or smaller")); event.target.value = ""; return; }
    if (chosen.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type))) { setNotice(words(locale, "Поддерживаются PNG, JPEG и WebP", "PNG, JPEG және WebP қолданылады", "PNG, JPEG and WebP are supported")); event.target.value = ""; return; }
    setFiles(chosen); setReplaceImages(true); setNotice("");
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const bookId = draft.catalogBookId ? Number(draft.catalogBookId) : null;
      const payload: Record<string, unknown> = { type: draft.type, condition: draft.condition, description: draft.description, cityId: Number(selectedDraftCity?.id) };
      if (editing) payload.status = draft.status;
      if (bookId) payload.catalogBookId = bookId; else { payload.title = draft.title; payload.author = draft.author; }
      if (draft.type === "sale") { payload.price = Number(draft.price); payload.currency = draft.currency; }
      else payload.exchangeWishes = draft.exchangeWishes;
      if (!editing || replaceImages) payload.images = await Promise.all(files.map(asDataUrl));
      const response = await apiFetch(editing ? `/api/marketplace/listings/${editing.id}` : "/api/marketplace/listings", { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) });
      const result = await responseJson(response) as { listing: MarketplaceListing };
      setShowForm(false); setEditing(null); setFiles([]); setReplaceImages(false);
      setListings((current) => editing ? current.map((item) => item.id === result.listing.id ? result.listing : item) : [result.listing, ...current]);
      await load(false);
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status === 403) setBlocked(true);
      else setNotice(err.message || words(locale, "Не удалось сохранить объявление", "Хабарландыруды сақтау мүмкін болмады", "Could not save listing"));
    } finally { setBusy(false); }
  }
  async function setStatus(item: MarketplaceListing, status: MarketplaceListing["status"]) {
    setBusy(true); setNotice("");
    try {
      const response = await apiFetch(`/api/marketplace/listings/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      const result = await responseJson(response) as { listing: MarketplaceListing };
      setListings((current) => current.map((row) => row.id === item.id ? result.listing : row)); setSelected(result.listing);
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(item: MarketplaceListing) {
    if (!window.confirm(words(locale, "Удалить объявление?", "Хабарландыруды жоясыз ба?", "Delete this listing?"))) return;
    setBusy(true); setNotice("");
    try { await responseJson(await apiFetch(`/api/marketplace/listings/${item.id}`, { method: "DELETE" })); setListings((current) => current.filter((row) => row.id !== item.id)); setSelected(null); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  }
  async function open(item: MarketplaceListing) {
    setSelected(item);
    try { const result = await responseJson(await apiFetch(`/api/marketplace/listings/${item.id}`)) as { listing: MarketplaceListing }; setSelected(result.listing); }
    catch (error) { setNotice((error as Error).message); }
  }
  async function submitReport(event: FormEvent) {
    event.preventDefault();
    if (!reportListing || !reportReason.trim()) return;
    setBusy(true); setNotice("");
    try {
      await responseJson(await apiFetch("/api/reports", { method: "POST", body: JSON.stringify({ targetKind: "marketplace_listing", targetId: reportListing.id, reason: reportReason.trim() }) }));
      setReportListing(null); setReportReason("");
      setNotice(words(locale, "Жалоба на объявление отправлена", "Хабарландыруға шағым жіберілді", "Listing report submitted"));
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function submitSellerReport(event: FormEvent) {
    event.preventDefault();
    if (!reportSellerListing || !reportSellerListing.sellerId || reportSellerListing.sellerId === currentUserId || !reportSellerReason.trim()) return;
    setBusy(true); setNotice("");
    try {
      await responseJson(await apiFetch("/api/reports", { method: "POST", body: JSON.stringify({ targetKind: "user", targetId: reportSellerListing.sellerId, reason: reportSellerReason.trim() }) }));
      setReportSellerListing(null); setReportSellerReason("");
      setNotice(words(locale, "Жалоба на продавца отправлена", "Сатушыға шағым жіберілді", "Seller report submitted"));
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  const isOwner = (item: MarketplaceListing) => view === "mine";

  if (blocked || accessAllowed === false) return <section className="marketplace-listings"><div className="marketplace-adult-gate" role="status"><h1>{copy.title}</h1><p>{copy.adult}</p></div></section>;

  return <section className="marketplace-listings">
    <header className="marketplace-header"><div><h1>{copy.title}</h1><p>{copy.safety}</p></div><div className="marketplace-header-actions"><button type="button" onClick={() => { setConversationListing(null); setConversationsOpen(true); }}>{words(locale, "Диалоги", "Диалогтар", "Conversations")}</button>{view === "mine" && <button className="marketplace-primary" type="button" onClick={startCreate}>{copy.create}</button>}</div></header>
    <div className="marketplace-tabs" role="tablist" aria-label={copy.title}>
      <button type="button" role="tab" aria-selected={view === "browse"} className={view === "browse" ? "is-active" : ""} onClick={() => setView("browse")}>{copy.browse}</button>
      <button type="button" role="tab" aria-selected={view === "mine"} className={view === "mine" ? "is-active" : ""} onClick={() => setView("mine")}>{copy.mine}</button>
    </div>
    {view === "browse" && <form className="marketplace-filters" onSubmit={(event) => { event.preventDefault(); setAppliedFilters(filters); }}>
      <label><span>{words(locale, "Поиск", "Іздеу", "Search")}</span><input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></label>
      <MarketplaceCityPicker selected={selectedFilterCity} onSelect={setSelectedFilterCity} label={words(locale, "Город", "Қала", "City")} placeholder={words(locale, "Все города или введите название", "Барлық қала немесе атауын енгізіңіз", "All cities or enter a name")} noResults={words(locale, "Город не найден", "Қала табылмады", "City not found")} />
      <label><span>{words(locale, "Тип", "Түрі", "Type")}</span><select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">{words(locale, "Любой", "Кез келгені", "Any")}</option><option value="sale">{words(locale, "Продажа", "Сату", "Sale")}</option><option value="exchange">{words(locale, "Обмен", "Айырбас", "Exchange")}</option></select></label>
      <label><span>{words(locale, "Состояние", "Күйі", "Condition")}</span><input value={filters.condition} onChange={(event) => setFilters({ ...filters, condition: event.target.value })} /></label>
      <label><span>{words(locale, "Цена от", "Бағасы бастап", "Price from")}</span><input type="number" min="0" step="0.01" value={filters.minPrice} onChange={(event) => setFilters({ ...filters, minPrice: event.target.value })} /></label>
      <label><span>{words(locale, "Цена до", "Бағасы дейін", "Price to")}</span><input type="number" min="0" step="0.01" value={filters.maxPrice} onChange={(event) => setFilters({ ...filters, maxPrice: event.target.value })} /></label>
      <button className="marketplace-filter-submit" type="submit">{words(locale, "Найти", "Табу", "Search")}</button>
    </form>}
    {notice && <p className="marketplace-notice" role="alert">{notice}</p>}
    {loading && listings.length === 0 ? <p className="marketplace-empty" role="status">{words(locale, "Загрузка…", "Жүктелуде…", "Loading…")}</p> : listings.length ? <div className="marketplace-grid">{listings.map((item) => <article className="marketplace-card" key={item.id}>
      <button className="marketplace-card-open" type="button" onClick={() => void open(item)} aria-label={`${item.title} — ${item.author}`}>
        {item.images[0] ? <img className="marketplace-cover" src={item.images[0].url} alt="" /> : <div className="marketplace-cover marketplace-cover-empty" aria-hidden="true">{words(locale, "Книга", "Кітап", "Book")}</div>}
        <span className="marketplace-card-copy"><span className="marketplace-badge">{item.type === "sale" ? words(locale, "Продажа", "Сату", "Sale") : words(locale, "Обмен", "Айырбас", "Exchange")}</span><strong>{item.title}</strong><span>{item.author}</span><span>{item.cityName} · {item.condition}</span><b>{item.type === "sale" ? formatMoney(item.price, item.currency, locale) : item.exchangeWishes}</b><small>{words(locale, "Продавец", "Сатушы", "Seller")}: {item.sellerName}</small></span>
      </button>
      <p className="marketplace-card-safety">{words(locale, "Book Meet не принимает оплату. Соблюдайте осторожность.", "Book Meet төлем қабылдамайды. Сақ болыңыз.", "Book Meet does not handle payment. Use caution.")}</p>
    </article>)}</div> : <p className="marketplace-empty">{words(locale, "Объявлений пока нет", "Әзірше хабарландыру жоқ", "No listings yet")}</p>}
    {view === "browse" && listings.length > 0 && nextBeforeId.current != null && <button className="marketplace-more" type="button" disabled={loading} onClick={() => void load(true)}>{words(locale, "Показать ещё", "Тағы көрсету", "Load more")}</button>}

    {selected && <div className="marketplace-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="marketplace-dialog" role="dialog" aria-modal="true" aria-labelledby="marketplace-detail-title"><button type="button" className="marketplace-close" onClick={() => setSelected(null)} aria-label={words(locale, "Закрыть", "Жабу", "Close")}>×</button><h2 id="marketplace-detail-title">{selected.title}</h2><p>{selected.author} · {selected.cityName} · {selected.condition}</p><div className="marketplace-dialog-images">{selected.images.map((image) => <img key={image.id} src={image.url} alt="" />)}</div><p>{selected.description}</p><p><strong>{selected.type === "sale" ? formatMoney(selected.price, selected.currency, locale) : selected.exchangeWishes}</strong></p><p>{words(locale, "Продавец", "Сатушы", "Seller")}: {selected.sellerName}</p><div className="marketplace-safety-box">{copy.safety}</div>{selected.sellerId !== currentUserId && <div className="marketplace-owner-actions">{selected.status === "active" && <button type="button" onClick={() => { setConversationListing(selected); setSelected(null); setConversationsOpen(true); }}>{words(locale, "Написать продавцу", "Сатушыға жазу", "Message seller")}</button>}<button type="button" onClick={() => { setReportListing(selected); setSelected(null); setNotice(""); }}>{words(locale, "Пожаловаться на объявление", "Хабарландыруға шағымдану", "Report listing")}</button>{selected.sellerId != null && <button type="button" onClick={() => { setReportSellerListing(selected); setSelected(null); setNotice(""); }}>{words(locale, "Пожаловаться на продавца", "Сатушыға шағымдану", "Report seller")}</button>}</div>}{isOwner(selected) && <div className="marketplace-owner-actions"><button type="button" onClick={() => startEdit(selected)}>{words(locale, "Редактировать", "Өңдеу", "Edit")}</button>{selected.status === "active" && <button type="button" disabled={busy} onClick={() => void setStatus(selected, "reserved")}>{words(locale, "Зарезервировать", "Брондау", "Reserve")}</button>}{selected.status === "reserved" && <button type="button" disabled={busy} onClick={() => void setStatus(selected, "active")}>{words(locale, "Снять резерв", "Броньды алу", "Unreserve")}</button>}{(selected.status === "active" || selected.status === "reserved") && <button type="button" disabled={busy} onClick={() => void setStatus(selected, selected.type === "sale" ? "sold" : "exchanged")}>{words(locale, selected.type === "sale" ? "Продано" : "Обменяно", selected.type === "sale" ? "Сатылды" : "Айырбасталды", selected.type === "sale" ? "Sold" : "Exchanged")}</button>}<button type="button" onClick={() => void remove(selected)}>{words(locale, "Удалить", "Жою", "Delete")}</button></div>}</section></div>}
    {conversationsOpen && <MarketplaceConversations listingToStart={conversationListing} onClose={() => { setConversationsOpen(false); setConversationListing(null); }} />}
    {reportListing && <div className="marketplace-dialog-backdrop"><form className="marketplace-dialog marketplace-form" onSubmit={(event) => void submitReport(event)} aria-label={words(locale, "Жалоба на объявление", "Хабарландыруға шағым", "Report listing")}><button className="marketplace-close" type="button" onClick={() => { setReportListing(null); setReportReason(""); }} aria-label={words(locale, "Закрыть", "Жабу", "Close")}>×</button><h2>{words(locale, "Жалоба на объявление", "Хабарландыруға шағым", "Report listing")}</h2><p>{reportListing.title}</p><label><span>{words(locale, "Причина", "Себеп", "Reason")}</span><textarea required maxLength={5000} value={reportReason} onChange={(event) => setReportReason(event.target.value)} /></label>{notice && <p role="alert" className="marketplace-notice">{notice}</p>}<button className="marketplace-primary" type="submit" disabled={busy}>{words(locale, "Отправить жалобу", "Шағым жіберу", "Submit report")}</button></form></div>}
    {reportSellerListing && <div className="marketplace-dialog-backdrop"><form className="marketplace-dialog marketplace-form" onSubmit={(event) => void submitSellerReport(event)} aria-label={words(locale, "Жалоба на продавца", "Сатушыға шағым", "Report seller")}><button className="marketplace-close" type="button" onClick={() => { setReportSellerListing(null); setReportSellerReason(""); }} aria-label={words(locale, "Закрыть", "Жабу", "Close")}>×</button><h2>{words(locale, "Жалоба на продавца", "Сатушыға шағым", "Report seller")}</h2><p>{reportSellerListing.sellerName}</p><label><span>{words(locale, "Причина", "Себеп", "Reason")}</span><textarea required maxLength={5000} value={reportSellerReason} onChange={(event) => setReportSellerReason(event.target.value)} /></label>{notice && <p role="alert" className="marketplace-notice">{notice}</p>}<button className="marketplace-primary" type="submit" disabled={busy}>{words(locale, "Отправить жалобу на продавца", "Сатушыға шағым жіберу", "Submit seller report")}</button></form></div>}
    {showForm && <div className="marketplace-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowForm(false); }}><form className="marketplace-dialog marketplace-form" onSubmit={(event) => void save(event)} aria-labelledby="marketplace-form-title"><button type="button" className="marketplace-close" disabled={busy} onClick={() => setShowForm(false)} aria-label={words(locale, "Закрыть", "Жабу", "Close")}>×</button><h2 id="marketplace-form-title">{editing ? words(locale, "Редактировать объявление", "Хабарландыруды өңдеу", "Edit listing") : copy.create}</h2>
      {catalogBooks.length > 0 && <label><span>{words(locale, "Книга из каталога", "Каталогтағы кітап", "Catalog book")}</span><select value={draft.catalogBookId} onChange={(event) => setDraft({ ...draft, catalogBookId: event.target.value })}><option value="">{words(locale, "Указать вручную", "Қолмен енгізу", "Enter manually")}</option>{catalogBooks.map((book) => <option key={book.id} value={book.id}>{book.title} — {book.author}</option>)}</select></label>}
      {!draft.catalogBookId && <><label><span>{words(locale, "Название книги", "Кітап атауы", "Book title")}</span><input required maxLength={255} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label><span>{words(locale, "Автор", "Автор", "Author")}</span><input required maxLength={255} value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} /></label></>}
      <label><span>{words(locale, "Тип объявления", "Хабарландыру түрі", "Listing type")}</span><select value={draft.type} onChange={(event) => { const type = event.target.value as Draft["type"]; setDraft({ ...draft, type, status: draft.status === "sold" || draft.status === "exchanged" ? "active" : draft.status }); }}><option value="sale">{words(locale, "Продажа", "Сату", "Sale")}</option><option value="exchange">{words(locale, "Обмен", "Айырбас", "Exchange")}</option></select></label>
      <label><span>{words(locale, "Состояние", "Күйі", "Condition")}</span><input required maxLength={80} value={draft.condition} onChange={(event) => setDraft({ ...draft, condition: event.target.value })} /></label>
      <label><span>{words(locale, "Описание", "Сипаттама", "Description")}</span><textarea required maxLength={5000} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <MarketplaceCityPicker selected={selectedDraftCity} onSelect={setSelectedDraftCity} required label={words(locale, "Город", "Қала", "City")} placeholder={words(locale, "Введите название и выберите город", "Атауын енгізіп, қаланы таңдаңыз", "Enter a name and choose a city")} noResults={words(locale, "Город не найден — уточните название", "Қала табылмады — атауын нақтылаңыз", "City not found — refine the name")} />
      {draft.type === "sale" ? <div className="marketplace-form-row"><label><span>{words(locale, "Цена", "Бағасы", "Price")}</span><input required type="number" min="0.01" max="99999999.99" step="0.01" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></label><label><span>{words(locale, "Валюта", "Валюта", "Currency")}</span><input required pattern="[A-Za-z]{3}" maxLength={3} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} /></label></div> : <label><span>{words(locale, "Пожелания к обмену", "Айырбас тілектері", "Exchange wishes")}</span><textarea required maxLength={1000} value={draft.exchangeWishes} onChange={(event) => setDraft({ ...draft, exchangeWishes: event.target.value })} /></label>}
      {editing && <label><span>{words(locale, "Статус", "Күйі", "Status")}</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Draft["status"] })}><option value="active">{words(locale, "Активно", "Белсенді", "Active")}</option><option value="reserved">{words(locale, "Зарезервировано", "Брондалған", "Reserved")}</option><option value={draft.type === "sale" ? "sold" : "exchanged"}>{words(locale, draft.type === "sale" ? "Продано" : "Обменяно", draft.type === "sale" ? "Сатылды" : "Айырбасталды", draft.type === "sale" ? "Sold" : "Exchanged")}</option><option value="closed">{words(locale, "Закрыто", "Жабық", "Closed")}</option></select></label>}
      <label><span>{words(locale, "Изображения (до 6)", "Суреттер (6-ға дейін)", "Images (up to 6)")}</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void chooseFiles(event)} />{editing && !replaceImages && <small>{words(locale, `Сейчас добавлено изображений: ${editing.images.length}. Выбор файлов заменит их.`, `Қазір ${editing.images.length} сурет бар. Файл таңдау оларды ауыстырады.`, `${editing.images.length} images currently attached. Selecting files replaces them.`)}</small>}{replaceImages && <small>{files.length} {words(locale, "файл(ов) выбрано", "файл таңдалды", "file(s) selected")}</small>}</label>
      <div className="marketplace-safety-box">{copy.safety}</div>{notice && <p role="alert" className="marketplace-notice">{notice}</p>}<button className="marketplace-primary" type="submit" disabled={busy || !selectedDraftCity}>{busy ? words(locale, "Сохранение…", "Сақталуда…", "Saving…") : words(locale, "Сохранить", "Сақтау", "Save")}</button>
    </form></div>}
  </section>;
}
