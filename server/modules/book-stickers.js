// Book Meet-owned, versioned sticker definitions.  These identifiers are part
// of the message contract: retired picker entries remain here so old messages
// can still be rendered without a remote asset or an arbitrary URL.
export const BOOK_STICKER_CATALOG_VERSION = 1;

const stickers = [
  { id: "book-open-v1", assetUrl: "/stickers/book-open-v1.svg", labels: { ru: "Открытая книга", kk: "Ашық кітап", en: "Open book" } },
  { id: "book-tea-v1", assetUrl: "/stickers/book-tea-v1.svg", labels: { ru: "Книга и чай", kk: "Кітап және шай", en: "Book and tea" } },
  { id: "book-star-v1", assetUrl: "/stickers/book-star-v1.svg", labels: { ru: "Книга со звездой", kk: "Жұлдызды кітап", en: "Book with a star" } },
  { id: "book-heart-v1", assetUrl: "/stickers/book-heart-v1.svg", labels: { ru: "Любимая книга", kk: "Сүйікті кітап", en: "Favourite book" } },
];

export function stickerDto(sticker, locale = "ru") {
  if (!sticker) return undefined;
  return { id: sticker.id, version: BOOK_STICKER_CATALOG_VERSION, assetUrl: sticker.assetUrl, label: sticker.labels[locale] ?? sticker.labels.ru, labels: { ...sticker.labels } };
}

export function bookStickerCatalog(locale = "ru", { pickerOnly = false } = {}) {
  // `pickerOnly` is intentionally separate from the archive lookup below.
  return { version: BOOK_STICKER_CATALOG_VERSION, stickers: stickers.filter((sticker) => !pickerOnly || sticker.enabled !== false).map((sticker) => stickerDto(sticker, locale)) };
}

export function activeBookSticker(stickerId) {
  const sticker = stickers.find((item) => item.id === stickerId);
  return sticker && sticker.enabled !== false ? sticker : undefined;
}

export function archivedBookSticker(stickerId) {
  return stickers.find((item) => item.id === stickerId);
}
