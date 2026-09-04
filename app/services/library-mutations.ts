import { apiFetch } from "./api";
import type { DemoUser, LibraryBook, ReadingHistoryEntry } from "../types/domain";

export type LibraryMutationResponse = { bookId: number; topRank?: 1 | 2 | 3; book: LibraryBook; readingHistory: ReadingHistoryEntry[] };

export function isLibraryMutationResponse(value: unknown): value is LibraryMutationResponse {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<LibraryMutationResponse>;
  return typeof payload.bookId === "number" && Boolean(payload.book) && typeof (payload.book as LibraryBook).id === "number" && Array.isArray(payload.readingHistory);
}

export function applyLibraryMutation(user: DemoUser, result: LibraryMutationResponse): DemoUser {
  const canonicalId = result.book.catalogBookId ?? result.book.id;
  const existing = user.books.some((book) => (book.catalogBookId ?? book.id) === canonicalId);
  return { ...user, books: existing ? user.books.map((book) => (book.catalogBookId ?? book.id) === canonicalId ? result.book : book) : [result.book, ...user.books], readingHistory: result.readingHistory };
}

/** Build only the status-scoped personal fields. `null` deliberately means
 * clear; undefined would disappear during JSON serialization and retain a
 * stale MySQL value. */
export function buildReadingPatch(book: LibraryBook, includeStatus = true) {
  const value = (entry: unknown) => entry === undefined ? null : entry;
  const status = book.readingStatus ?? "read";
  if (status === "reading") return { ...(includeStatus ? { readingStatus: status } : {}), chaptersCurrent: value(book.chaptersCurrent), chaptersTotal: value(book.chaptersTotal), pagesCurrent: value(book.pagesCurrent), pagesTotal: value(book.pagesTotal), progressUnit: value(book.progressUnit), readingComment: value(book.readingComment) };
  if (status === "read") return { ...(includeStatus ? { readingStatus: status } : {}), rating: book.rating, shortReview: book.review, readMonth: value(book.readMonth), readYear: value(book.readYear) };
  if (status === "abandoned") return { ...(includeStatus ? { readingStatus: status } : {}), shortReview: value(book.review) };
  if (status === "postponed") return { ...(includeStatus ? { readingStatus: status } : {}), readingComment: value(book.readingComment), postponedMonth: value(book.postponedMonth), postponedYear: value(book.postponedYear) };
  return includeStatus ? { readingStatus: "want" } : {};
}

export function announceLibraryMutation(result: LibraryMutationResponse, viewerId = Number(document.documentElement.dataset.bookMeetUserId)) {
  if (!Number.isInteger(viewerId)) return;
  window.dispatchEvent(new CustomEvent("bookmeet:library-mutation", { detail: { viewerId, result } }));
}

export function announceLibraryMutationStart(viewerId = Number(document.documentElement.dataset.bookMeetUserId)) {
  if (Number.isInteger(viewerId)) window.dispatchEvent(new CustomEvent("bookmeet:library-mutation-start", { detail: { viewerId } }));
}

export async function saveLibraryBook(path: string, method: "POST" | "PATCH", payload: unknown): Promise<LibraryMutationResponse> {
  const viewerId = Number(document.documentElement.dataset.bookMeetUserId);
  announceLibraryMutationStart(viewerId);
  const response = await apiFetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "Could not save the book");
  if (!isLibraryMutationResponse(data)) throw new Error("Invalid library response");
  announceLibraryMutation(data, viewerId);
  return data;
}
