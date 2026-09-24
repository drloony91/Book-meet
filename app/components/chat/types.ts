export type Friend = {
  id: number;
  name: string;
  username?: string;
  type: "Читатель" | "Писатель" | "Блогер" | "Издатель" | "Сообщество";
  city: string;
  initials: string;
  color: string;
  online?: boolean;
  unread?: number;
  lastMessage: string;
  time: string;
  lastActivityAt?: string;
  bio: string;
  books: string;
  support?: boolean;
  supportCase?: boolean;
  avatarUrl?: string;
};

export type ChatAttachmentKind = "book" | "user" | "event" | "review" | "excerpt" | "occasion" | "publisher_news" | "shelf";
export type ChatAttachment = { kind: ChatAttachmentKind; id: number };
export type BookSticker = { id: string; version: number; assetUrl: string; label: string; labels?: Partial<Record<"ru" | "kk" | "en", string>> };
export type ChatShareItem = ChatAttachment & {
  title: string;
  subtitle: string;
  preview?: string;
  imageUrl?: string;
  path: string;
};

export type Message = {
  id: number;
  mine: boolean;
  text: string;
  time: string;
  createdAt?: string;
  editedAt?: string;
  deleted?: boolean;
  read?: boolean;
  system?: boolean;
  senderId?: number;
  unread?: boolean;
  likeCount?: number;
  likedByViewer?: boolean;
  likedByUserIds?: number[];
  attachment?: ChatAttachment;
  kind?: "text" | "sticker";
  sticker?: BookSticker;
  mentions?: import("../../types/domain").MentionRef[];
};

export type MessageSearchMatch = {
  messageId: number;
  snippet: string;
  createdAt: string;
  author: { id: number; name: string; username?: string };
};

export type MessageSearchGroup = {
  peer: { id: number; name: string; username?: string; type: Friend["type"]; initials: string; color: string; avatarUrl?: string };
  count: number;
  newestAt: string;
  matches: MessageSearchMatch[];
  matchesNextCursor?: string | null;
};
