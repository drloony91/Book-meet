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

export type ChatAttachmentKind = "book" | "user" | "event" | "review" | "excerpt" | "occasion";
export type ChatAttachment = { kind: ChatAttachmentKind; id: number };
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
  read?: boolean;
  system?: boolean;
  senderId?: number;
  unread?: boolean;
  attachment?: ChatAttachment;
};
