import type { LibraryBook } from "./domain";

export type ShelfBook = Pick<LibraryBook, "id" | "title" | "author" | "annotation" | "coverUrl" | "coverTone"> & { rating?: number };
export type BookShelf = {
  id: number; ownerId: number; title: string; description: string; createdAt: string; updatedAt: string;
  owner: { id: number; name: string; initials: string; avatarUrl?: string };
  bookCount: number;
  items: Array<{ bookId: number | null; position: number; description: string; book: ShelfBook | null }>;
};
