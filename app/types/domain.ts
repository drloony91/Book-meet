import type { Message } from "../components/chat/types";

export type FriendRequest = { id: number; fromId: number; toId: number; status: "pending" | "accepted" | "rejected"; message?: string; comment?: string };
export type Friendship = { userA: number; userB: number };
export type Follow = { followerId: number; targetId: number };
export type NotificationType = "friend_request" | "friendship_started" | "friend_rejected" | "new_message" | "new_follower" | "publication" | "friendship_ended" | "like" | "comment" | "event_submitted" | "event_moderation" | "event_reminder" | "author_book_activity" | "gift_reserved";
export type SocialNotification = { id: number; userId: number; actorId: number; type: NotificationType; title: string; text: string; unread: boolean; createdAt: string; materialId?: number; materialKind?: "review" | "excerpt" | "event" | "occasion" | "book" | "wishlist" };

export type EventStatus = "pending" | "needs_changes" | "rejected" | "published";
export type BookEvent = {
  id: number;
  creatorId: number;
  title: string;
  summary: string;
  description: string;
  date: string;
  time: string;
  city: string;
  cityId?: number;
  address: string;
  mapUrl: string;
  detailsUrl: string;
  status: EventStatus;
  moderationNote?: string;
  linkedBookId?: number;
  bookTitle?: string;
  bookAuthor?: string;
  bookAnnotation?: string;
  bookCoverUrl?: string;
  bookCoverTone?: string;
  pinned?: boolean;
  reminderSet?: boolean;
  createdAt: string;
};
export type OccasionType = "meet" | "discuss" | "invite";
export type Occasion = { id: number; creatorId: number; type: OccasionType; primaryText: string; audienceText: string; targetGender: "Мужской" | "Женский" | "Все"; targetCities: string[]; targetProfileType: "Писатель" | "Читатель" | "Блогер" | "Все"; status: EventStatus; moderationNote?: string; creatorName: string; createdAt: string };
export type CityOption = { id: number; name: string; countryCode: string; country: string };

export type Review = {
  id: number;
  ownerId: number;
  quote: string;
  fullText: string;
  book: string;
  author: string;
  user: string;
  rating: string;
  tone: string;
  createdAt: string;
  createdAtValue?: string;
};

export type Excerpt = {
  id: number;
  ownerId: number;
  text: string;
  fullText: string;
  title: string;
  author: string;
  genre: string;
  createdAt: string;
  createdAtValue?: string;
  bodyHtml?: string;
  linkedBookId?: number;
};

export type ReadingItem = { id: number; kind: "review" | "excerpt"; title: string; author: string; text: string; ownerId?: number; createdAt?: string; preview?: string; bookAuthor?: string; bodyHtml?: string; linkedBookId?: number };
export type MaterialComment = { id: number; userId: number; text: string; createdAt: string };

export type ProfileTab = "main" | "author-books" | "excerpts" | "publisher-news" | "library" | "wishlist" | "reviews" | "events" | "friends" | "admin" | "settings";
export type LibraryView = "grid" | "list";
export type ReadingStatus = "want" | "reading" | "read";
export type BookFormat = "Бумажная" | "Электронная" | "Аудио";

export type LibraryBook = {
  id: number;
  creatorUserId?: number;
  catalogBookId?: number;
  author: string;
  title: string;
  isbn?: string;
  publisher?: string;
  genres: string[];
  annotation: string;
  pages: string;
  format: BookFormat;
  durationHours: string;
  durationMinutes: string;
  rating: number;
  review: string;
  coverUrl?: string;
  coverTone: string;
  readMonth?: number;
  readYear?: number;
  readingStatus?: ReadingStatus;
  flipUrl?: string;
  links?: BookLink[];
};

export type BookLink = { id: number; label: string; url: string; action?: "Купить" | "Читать" | "Слушать" };
export type AuthorBook = Omit<LibraryBook, "rating" | "review"> & { rating?: undefined; review?: undefined; links: BookLink[] };
export type WishBook = Pick<LibraryBook, "id" | "author" | "title" | "genres" | "annotation" | "coverUrl" | "coverTone"> & { ownerId: number; catalogBookId?: number; marketplace: "Flip"; productUrl?: string; pickupAddress?: string; recipientName?: string; phone?: string; price?: number; priceCurrency?: string; priceCheckedAt?: string; reservedByUserId?: number; reservedAt?: string; privateVisible: boolean };
export type MarketplaceProductPreview = { marketplace: "Flip" | "Marwin/Меломан" | "Яндекс.Книги"; productUrl: string; title: string; author: string; isbn?: string; publisher?: string; catalogBookId?: number; annotation: string; coverUrl?: string; price?: number; currency: string; suggestedAction: "Купить" | "Читать" | "Слушать" };
export type FlipProductPreview = MarketplaceProductPreview & { marketplace: "Flip"; suggestedAction: "Купить" };

export type UserReview = { id: number; bookId?: number; bookTitle: string; bookAuthor: string; rating: number; preview: string; fullText: string; createdAt: string; createdAtValue?: string };
export type UserExcerpt = { id: number; bookId?: number; bookTitle: string; previewText: string; bodyHtml: string; text: string; link: string; createdAt: string; createdAtValue?: string };
export type PublisherVerificationStatus = "not_required" | "draft" | "pending" | "needs_changes" | "rejected" | "approved";
export type PublisherSaleLink = { id: number; label: string; url: string };
export type PublisherNews = { id: number; ownerId: number; title: string; previewText: string; bodyHtml: string; body: string; createdAt: string; createdAtValue?: string };
export type UserProfileData = {
  name: string;
  city: string;
  cityId?: number;
  type: "Читатель" | "Писатель" | "Блогер" | "Издатель";
  gender: "Мужской" | "Женский" | "Не указан";
  bio: string;
  authorInfluences: string;
  writingThemes: string;
  weekend: string;
  joy: string;
  talk: string;
  strangerMessage: string;
  favoriteGenres: string[];
  dislikedGenres: string[];
  publisherStatus?: PublisherVerificationStatus;
  publisherWebsite?: string;
  publisherSalesLinks?: PublisherSaleLink[];
  publisherLegalName?: string;
  publisherBin?: string;
  publisherAccount?: string;
  publisherBik?: string;
  publisherBank?: string;
  publisherLegalAddress?: string;
  publisherPostalAddress?: string;
  publisherModerationNote?: string;
};
export type UserSuspension = { permanent: boolean; until?: string; reason: string };
export type UserBlock = { blockerId: number; blockedId: number; createdAt?: string };
export type ReportMaterialKind = "book" | "review" | "excerpt" | "event" | "occasion" | "publisher_news";
export type SafetyReport = {
  id: number;
  reporterId: number;
  reporterName: string;
  targetKind: "user" | ReportMaterialKind | "chat" | "comment";
  targetId: number;
  targetUserId?: number;
  targetUserName?: string;
  targetTitle?: string;
  reason: string;
  status: "new" | "reviewed";
  createdAt: string;
  commentText?: string;
  materialKind?: ReportMaterialKind;
  materialId?: number;
  conversationMessages?: Message[];
};
export type DemoUser = { id: number; username: string; initials: string; color: string; avatarUrl?: string; joined: string; joinedAt?: string; online?: boolean; lastSeenAt?: string; isAdmin?: boolean; blockedByMe?: boolean; suspension?: UserSuspension; profile: UserProfileData; books: LibraryBook[]; reviews: UserReview[]; authorBooks?: AuthorBook[]; excerpts?: UserExcerpt[]; publisherNews?: PublisherNews[]; wishBooks?: WishBook[] };

export type BootstrapData = { activeUserId: number; profileCompleted?: boolean; users: DemoUser[]; messages: Record<string, Message[]>; friendRequests: FriendRequest[]; friendships: Friendship[]; follows: Follow[]; notifications: SocialNotification[]; likes: Record<string, number[]>; events?: BookEvent[]; occasions?: Occasion[]; blocks?: UserBlock[]; blockedByUserIds?: number[]; reports?: SafetyReport[] };
export type AuthResult = { error?: string; requiresTotp?: boolean };

export type AdminMaterialKind = "book" | "review" | "excerpt" | "event" | "occasion";
export type AdminSection = "dashboard" | "moderation" | "reports-new" | "reports-reviewed" | "users-active" | "users-blocked" | AdminMaterialKind;
export type AdminCatalogItem = {
  id: number;
  kind: AdminMaterialKind;
  title: string;
  subtitle: string;
  text: string;
  coverUrl?: string;
  coverTone?: string;
  source: any;
};

export type AdminStatistics = {
  totalUsers: number;
  usersByType: Record<"Читатель" | "Писатель" | "Блогер" | "Издатель", number>;
  cities: Array<{ city: string; count: number }>;
  books: number;
  reviews: number;
  publications: number;
  events: number;
  occasions: number;
  wishlistBooks: number;
  reservedGifts: number;
  friendshipUsers: number;
};

export type TotpStatus = { enabled: boolean; pending: boolean; recoveryCodesLeft: number };
export type TotpSetup = { secret: string; qrDataUrl: string; expiresInSeconds: number };
