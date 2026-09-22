import { useCallback, useEffect, useRef, useState } from "react";
import { EventCard, MaterialPreviewCard, OccasionCard } from "../components/content/ContentComponents";
import { BookShelfCard, isBookShelf } from "../components/books/BookShelves";
import type { BookShelf } from "../types/shelves";
import { useI18n } from "../i18n";
import { apiFetch } from "../services/api";
import type { BookEvent, DemoUser, Occasion, ReadingItem } from "../types/domain";

type SearchKind = "review" | "excerpt" | "event" | "occasion" | "shelf";
export type SearchEntry = {
  kind: SearchKind;
  id: number;
  ownerId: number;
  createdAt: string;
  item: ReadingItem | BookEvent | Occasion | BookShelf;
};
type SearchResponse = { page: number; hasMore: boolean; items: SearchEntry[] };

const HISTORY_LIMIT = 5;

function historyKey(userId: number) {
  return `bookmeet:mobile-material-search:${userId}`;
}

function readHistory(userId: number) {
  try {
    const values = JSON.parse(window.localStorage.getItem(historyKey(userId)) ?? "[]");
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string").slice(0, HISTORY_LIMIT) : [];
  } catch { return []; }
}

function saveHistory(userId: number, query: string) {
  const normalized = query.toLocaleLowerCase();
  const next = [query, ...readHistory(userId).filter((value) => value.toLocaleLowerCase() !== normalized)].slice(0, HISTORY_LIMIT);
  try { window.localStorage.setItem(historyKey(userId), JSON.stringify(next)); } catch { /* storage is optional */ }
  return next;
}

function replaceSearchUrl(query: string) {
  if (window.location.pathname !== "/search") return;
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  window.history.replaceState(window.history.state, "", `/search${params.size ? `?${params}` : ""}`);
}

function hasMeaningfulQuery(query: string) {
  return query.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").length >= 2;
}

export function MobileGlobalSearchPage({ userId, initialQuery, users, likes, saves, commentCounts, saveCounts, onBack, onOpenResult, onOpenUser, onToggleLike, onToggleSave }: {
  userId: number;
  initialQuery: string;
  users: DemoUser[];
  likes: Record<string, number[]>;
  saves: Record<string, number[]>;
  commentCounts: Record<string, number>;
  saveCounts: Record<string, number>;
  onBack: () => void;
  onOpenResult: (entry: SearchEntry) => void;
  onOpenUser: (userId: number) => void;
  onToggleLike: (item: ReadingItem) => void;
  onToggleSave: (item: ReadingItem) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<SearchEntry[]>([]);
  const [history, setHistory] = useState(() => readHistory(userId));
  const [loading, setLoading] = useState(false);
  const [initialError, setInitialError] = useState(false);
  const [laterError, setLaterError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialQuery !== query) setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setHistory(readHistory(userId));
  }, [userId]);

  const fetchPage = useCallback(async (page: number, reset: boolean) => {
    const trimmed = query.trim();
    if (loadingRef.current || !hasMeaningfulQuery(trimmed)) return;
    loadingRef.current = true;
    setLoading(true);
    if (reset) {
      abortRef.current?.abort();
      setInitialError(false);
      setLaterError(false);
    } else setLaterError(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const sequence = ++sequenceRef.current;
    try {
      const response = await apiFetch(`/api/search/materials?q=${encodeURIComponent(trimmed)}&page=${page}&limit=12`, { signal: controller.signal });
      const data = await response.json().catch(() => ({})) as SearchResponse;
      if (!response.ok) throw new Error("search");
      if (sequence !== sequenceRef.current) return;
      setItems((current) => reset ? data.items ?? [] : [...current, ...(data.items ?? []).filter((entry) => !current.some((existing) => existing.kind === entry.kind && existing.id === entry.id))]);
      setHasMore(Boolean(data.hasMore));
      setSearched(true);
      setHistory(saveHistory(userId, trimmed));
    } catch (error) {
      if (controller.signal.aborted || sequence !== sequenceRef.current) return;
      if (reset) setInitialError(true);
      else setLaterError(true);
    } finally {
      if (sequence === sequenceRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [query, userId]);

  useEffect(() => {
    const trimmed = query.trim();
    replaceSearchUrl(query);
    abortRef.current?.abort();
    ++sequenceRef.current;
    loadingRef.current = false;
    setInitialError(false);
    setLaterError(false);
    if (!hasMeaningfulQuery(trimmed)) {
      setItems([]);
      setHasMore(false);
      setSearched(false);
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => void fetchPage(1, true), 380);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query, fetchPage]);

  const loadMore = useCallback(() => {
    if (!loadingRef.current && hasMore) void fetchPage(Math.floor(items.length / 12) + 1, false);
  }, [fetchPage, hasMore, items.length]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "180px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  const changeQuery = (next: string) => {
    const value = next.slice(0, 120);
    setQuery(value);
    replaceSearchUrl(value);
  };
  const renderEntry = (entry: SearchEntry, index: number) => {
    if (entry.kind === "shelf") return isBookShelf(entry.item) ? <BookShelfCard key={`shelf-${entry.id}`} shelf={entry.item} /> : null;
    const owner = users.find((user) => user.id === entry.ownerId);
    const source = entry.item;
    const actionItem: ReadingItem = entry.kind === "event"
      ? { id: entry.id, kind: "event", title: (source as BookEvent).title, author: owner?.profile.name ?? (source as BookEvent).creatorName, text: (source as BookEvent).description, preview: (source as BookEvent).summary, ownerId: entry.ownerId, createdAt: entry.createdAt, mentions: (source as BookEvent).mentions }
      : entry.kind === "occasion"
        ? { id: entry.id, kind: "occasion", title: (source as Occasion).primaryText, author: owner?.profile.name ?? (source as Occasion).creatorName, text: (source as Occasion).audienceText, preview: (source as Occasion).primaryText, ownerId: entry.ownerId, createdAt: entry.createdAt, mentions: (source as Occasion).mentions }
        : { ...(source as ReadingItem), ownerId: entry.ownerId };
    const key = `${actionItem.kind}-${actionItem.id}`;
    const actions = {
      likesCount: likes[key]?.length ?? 0,
      commentsCount: commentCounts[key] ?? 0,
      savesCount: saveCounts[key] ?? 0,
      liked: Boolean(likes[key]?.includes(userId)),
      saved: Boolean(saves[key]?.includes(userId)),
      onToggleLike: () => onToggleLike(actionItem),
      onToggleSave: () => onToggleSave(actionItem),
      onOpenComments: () => onOpenResult(entry),
    };
    if (entry.kind === "event") return <EventCard key={`search-${entry.kind}-${entry.id}`} item={source as BookEvent} own={entry.ownerId === userId} owner={owner} {...actions} onOpen={() => onOpenResult(entry)} onOpenUser={onOpenUser} />;
    if (entry.kind === "occasion") return <OccasionCard key={`search-${entry.kind}-${entry.id}`} item={source as Occasion} own={entry.ownerId === userId} owner={owner} {...actions} onOpen={() => onOpenResult(entry)} onOpenUser={onOpenUser} />;
    return <MaterialPreviewCard key={`search-${entry.kind}-${entry.id}`} item={actionItem} owner={owner} index={index} {...actions} onOpen={() => onOpenResult(entry)} onOpenUser={onOpenUser} />;
  };

  return <main className="mobile-global-search-page">
    <div className="mobile-global-search-toprow">
      <button className="mobile-global-search-back" type="button" onClick={onBack} aria-label={t("common.back")}>{"<"}</button>
      <input autoFocus type="search" value={query} maxLength={120} onChange={(event) => changeQuery(event.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} />
    </div>
    <section className="mobile-global-search-results" aria-live="polite">
      {!query.trim() && <div className="mobile-global-search-history"><p>{t("search.history")}</p>{history.map((value) => <button key={value.toLocaleLowerCase()} type="button" onClick={() => changeQuery(value)}>{value}</button>)}</div>}
      {query.trim() && !hasMeaningfulQuery(query) && <p className="mobile-global-search-hint">{t("search.start")}</p>}
      {loading && !items.length && <p className="mobile-global-search-hint">{t("common.loading")}</p>}
      {initialError && !items.length && <p className="mobile-global-search-error">{t("common.error")} <button type="button" onClick={() => void fetchPage(1, true)}>{t("common.tryAgain")}</button></p>}
      {searched && !loading && !initialError && !items.length && <p className="mobile-global-search-hint">{t("common.nothingFound")}</p>}
      <div className="mobile-global-search-list">{items.map(renderEntry)}</div>
      {hasMore && <div ref={sentinelRef} className="mobile-global-search-sentinel" />}
      {loading && items.length > 0 && <p className="mobile-global-search-hint">{t("common.moreLoading")}</p>}
      {laterError && <p className="mobile-global-search-error">{t("common.error")} <button type="button" onClick={loadMore}>{t("common.tryAgain")}</button></p>}
    </section>
  </main>;
}
