import type { AuthorBook, BookEvent, DemoUser, LibraryBook, ReadingItem } from "../types/domain";

export function sanitizeRichHtml(value: string) {
  if (typeof document === "undefined" || !value) return "";
  const template = document.createElement("template");
  template.innerHTML = value;
  const allowed = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "UL", "OL", "LI", "SPAN"]);
  const clean = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement;
      if (!allowed.has(element.tagName)) {
        element.replaceWith(...Array.from(element.childNodes));
        continue;
      }
      const textAlign = element.style.textAlign;
      const fontSize = element.style.fontSize;
      const spoiler = element.tagName === "SPAN" && element.classList.contains("spoiler");
      for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
      if (spoiler) element.className = "spoiler";
      if (["left", "right", "center", "justify"].includes(textAlign)) element.style.textAlign = textAlign;
      if (["12px", "14px", "16px", "18px", "22px", "28px"].includes(fontSize)) element.style.fontSize = fontSize;
      clean(element);
    }
  };
  clean(template.content);
  return template.innerHTML;
}

export function userBookMatches(viewer: DemoUser, user: DemoUser) {
  const ownBooks = new Set(viewer.books.map((book) => `${book.author}|${book.title}`.toLocaleLowerCase("ru")));
  const books = user.books.filter((book) => ownBooks.has(`${book.author}|${book.title}`.toLocaleLowerCase("ru"))).length;
  const ownFavorites = new Set(viewer.profile.favoriteGenres.map((genre) => genre.toLocaleLowerCase("ru")));
  const favoriteGenres = user.profile.favoriteGenres.filter((genre) => ownFavorites.has(genre.toLocaleLowerCase("ru"))).length;
  const ownDisliked = new Set(viewer.profile.dislikedGenres.map((genre) => genre.toLocaleLowerCase("ru")));
  const dislikedGenres = user.profile.dislikedGenres.filter((genre) => ownDisliked.has(genre.toLocaleLowerCase("ru"))).length;
  return { books, favoriteGenres, dislikedGenres, total: books + favoriteGenres + dislikedGenres };
}

export function eventTimestamp(item: BookEvent) {
  const parsed = Date.parse(`${item.date}T${item.time || "23:59"}:00`);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function normalizeBookKey(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/[«»"'.,:;!?()[\]{}]/g, "").replace(/\s+/g, " ");
}

export function catalogFromUsers(users: DemoUser[]) {
  const all = users.flatMap((user) => [...(user.authorBooks ?? []), ...user.books]);
  return all.filter((book, index) => all.findIndex((item) => item.id === book.id || (book.isbn && item.isbn === book.isbn) || (item.title.toLowerCase() === book.title.toLowerCase() && item.author.toLowerCase() === book.author.toLowerCase())) === index);
}

export function reviewReadingItemById(users: DemoUser[], id: number): ReadingItem | null {
  for (const user of users) {
    const review = user.reviews.find((item) => item.id === id);
    if (review) return { id: review.id, kind: "review", title: review.bookTitle, author: user.profile.name, text: review.fullText, ownerId: user.id, createdAt: review.createdAt, preview: review.preview, bookAuthor: review.bookAuthor, rating: review.rating, isAdult: review.isAdult };
  }
  return null;
}

export function excerptReadingItemById(users: DemoUser[], id: number): ReadingItem | null {
  for (const user of users) {
    const excerpt = (user.excerpts ?? []).find((item) => item.id === id);
    if (excerpt) return { id: excerpt.id, kind: "excerpt", title: excerpt.bookTitle || "Публикация", author: user.profile.name, text: excerpt.text, preview: excerpt.previewText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.bookId, ownerId: user.id, createdAt: excerpt.createdAt, isAdult: excerpt.isAdult };
  }
  return null;
}

export function resolveCanonicalBook(book: LibraryBook | AuthorBook, users: DemoUser[]): LibraryBook | AuthorBook {
  const sameBook = (item: LibraryBook | AuthorBook) => item.id === book.id || Boolean(book.isbn && item.isbn === book.isbn) || (item.title.toLowerCase() === book.title.toLowerCase() && item.author.toLowerCase() === book.author.toLowerCase());
  const writerBook = users.flatMap((user) => user.authorBooks ?? []).find(sameBook);
  if (writerBook) {
    const links = [...writerBook.links, ...(book.links ?? [])].filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index);
    return { ...book, ...writerBook, links } as LibraryBook & AuthorBook;
  }
  return catalogFromUsers(users).find(sameBook) ?? book;
}

export function formatKazakhstanPhone(value: string) {
  const raw = value.replace(/\D/g, "");
  const digits = (`7${raw.replace(/^[78]/, "")}`).slice(0, 11);
  const local = digits.slice(1);
  let result = "+7";
  if (local.length) result += ` (${local.slice(0, 3)}`;
  if (local.length >= 3) result += ")";
  if (local.length > 3) result += ` ${local.slice(3, 6)}`;
  if (local.length > 6) result += `-${local.slice(6, 8)}`;
  if (local.length > 8) result += `-${local.slice(8, 10)}`;
  return result;
}
