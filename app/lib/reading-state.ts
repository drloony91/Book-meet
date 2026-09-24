import type { DemoUser, LibraryBook } from "../types/domain";

export function readingPercent(book: Pick<LibraryBook, "progressPercent" | "progressUnit" | "chaptersCurrent" | "chaptersTotal" | "pagesCurrent" | "pagesTotal">): number | null {
  if (typeof book.progressPercent === "number" && Number.isFinite(book.progressPercent)) return Math.max(0, Math.min(100, Math.floor(book.progressPercent)));
  const current = book.progressUnit === "pages" ? book.pagesCurrent : book.progressUnit === "chapters" ? book.chaptersCurrent : undefined;
  const total = book.progressUnit === "pages" ? book.pagesTotal : book.progressUnit === "chapters" ? book.chaptersTotal : undefined;
  if (!Number.isInteger(current) || !Number.isInteger(total)) return null;
  const safeCurrent = current as number;
  const safeTotal = total as number;
  if (safeTotal <= 0 || safeCurrent < 0 || safeCurrent > safeTotal) return null;
  return Math.floor(safeCurrent / safeTotal * 100);
}

type ReaderEntry = { reader: DemoUser; item: LibraryBook };
const compareIdentity = (a: ReaderEntry, b: ReaderEntry) => a.reader.profile.name.localeCompare(b.reader.profile.name, "ru") || a.reader.id - b.reader.id;
const completed = (item: LibraryBook) => item.readingStatus === "read" || ((item.readingStatus === "abandoned" || item.readingStatus === "postponed") && item.hasCompletedReading);

export function sortBookReaders(entries: ReaderEntry[], viewerBook?: LibraryBook): ReaderEntry[] {
  const viewerPercent = readingPercent(viewerBook ?? {});
  const status = viewerBook?.readingStatus;
  // A paused relation can retain a past completion, but the reader is still
  // choosing the next book by its saved current progress, not by that history.
  const mode = status === "read" ? "completed" : (status === "reading" || status === "abandoned" || status === "postponed") && viewerPercent !== null ? "nearest" : "want";
  const kind = (item: LibraryBook) => item.readingStatus === "reading" ? 1 : completed(item) ? 2 : item.readingStatus === "want" ? 3 : 4;
  const order = mode === "completed" ? [2, 1, 3, 4] : mode === "nearest" ? [1, 2, 3, 4] : [3, 1, 2, 4];
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
    const aKind = kind(a.entry.item); const bKind = kind(b.entry.item);
    if (order.indexOf(aKind) !== order.indexOf(bKind)) return order.indexOf(aKind) - order.indexOf(bKind);
    if (aKind === 1) {
      const ap = readingPercent(a.entry.item); const bp = readingPercent(b.entry.item);
      if (ap === null || bp === null) return ap === bp ? compareIdentity(a.entry, b.entry) : ap === null ? 1 : -1;
      if (mode === "nearest") return Math.abs(ap - viewerPercent!) - Math.abs(bp - viewerPercent!) || compareIdentity(a.entry, b.entry);
      return (mode === "completed" ? bp - ap : ap - bp) || compareIdentity(a.entry, b.entry);
    }
    return compareIdentity(a.entry, b.entry) || a.index - b.index;
  }).map(({ entry }) => entry);
}
