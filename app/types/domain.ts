import type { BookShelf } from "./shelves";
import type { Message } from "../components/chat/types";

export type FriendRequest = { id: number; fromId: number; toId: number; status: "pending" | "accepted" | "rejected"; message?: string; comment?: string };
export type Friendship = { userA: number; userB: number };
export type CommunityMembership = { communityId: number; memberId: number };
export type SocialRelationship = "none" | "outgoing" | "incoming" | "friends" | "community-member";
export type Follow = { followerId: number; targetId: number };
export type NotificationType = "friend_request" | "friendship_started" | "friend_rejected" | "new_message" | "new_follower" | "publication" | "friendship_ended" | "like" | "comment" | "event_submitted" | "event_moderation" | "event_reminder" | "author_book_activity" | "gift_reserved";
export type SocialNotification = { id: number; userId: number; actorId: number; type: NotificationType; title: string; text: string; unread: boolean; createdAt: string; materialId?: number; materialKind?: "review" | "excerpt" | "event" | "occasion" | "publisher_news" | "book" | "wishlist" | "shelf" };

export type EventStatus = "pending" | "needs_changes" | "rejected" | "published";
export type LinkedBookPreview = { id: number; title: string; author: string; annotation?: string; coverUrl?: string; coverTone?: string };
export type BookEvent = {
  id: number;
  creatorId: number;
  creatorName: string;
  title: string;
  summary: string;
  description: string;
  isAdult?: boolean;
  date: string;
  time: string;
  city: string;
  cityId?: number;
  country?: string;
  address: string;
  mapUrl: string;
  detailsUrl: string;
  status: EventStatus;
  moderationNote?: string;
  linkedBookId?: number;
  linkedBookIds?: number[];
  linkedBooks?: LinkedBookPreview[];
  bookTitle?: string;
  bookAuthor?: string;
  bookAnnotation?: string;
  bookCoverUrl?: string;
  bookCoverTone?: string;
  pinned?: boolean;
  reminderSet?: boolean;
  reminderUserIds?: number[];
  reminderCount?: number;
  createdAt: string;
};
export type OccasionType = "meet" | "discuss" | "invite";
export type Occasion = { id: number; creatorId: number; type: OccasionType; primaryText: string; audienceText: string; isAdult?: boolean; targetGender: "Мужской" | "Женский" | "Все"; targetCities: string[]; targetProfileType: "Писатель" | "Читатель" | "Блогер" | "Все"; meetingDate?: string; meetingStartTime?: string; meetingEndTime?: string; meetingCity?: string; meetingCityId?: number; meetingAddress?: string; meetingMapUrl?: string; linkedBookId?: number; linkedBooks?: LinkedBookPreview[]; status: EventStatus; moderationNote?: string; creatorName: string; createdAt: string };
export type CityOption = { id: number; name: string; countryCode: string; country: string };

export type Review = {
  id: number;
  ownerId: number;
  quote: string;
  fullText: string;
  bodyHtml?: string;
  linkedBookId?: number;
  book: string;
  author: string;
  user: string;
  rating: string;
  tone: string;
  createdAt: string;
  createdAtValue?: string;
  isAdult?: boolean;
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
  linkedBookIds?: number[];
  isAdult?: boolean;
};

export type ReadingItem = { id: number; kind: "review" | "excerpt" | "event" | "occasion" | "publisher_news"; title: string; author: string; text: string; ownerId?: number; createdAt?: string; preview?: string; bookAuthor?: string; rating?: number; bodyHtml?: string; linkedBookId?: number; linkedBookIds?: number[]; isAdult?: boolean };
export type MaterialComment = { id: number; userId: number; text: string; createdAt: string };

export type ProfileTab = "main" | "author-books" | "excerpts" | "publisher-news" | "library" | "wishlist" | "communities" | "reviews" | "events" | "occasions" | "friends" | "admin";
export type LibraryView = "grid" | "list";
export type ReadingStatus = "want" | "reading" | "read" | "abandoned" | "postponed";
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
  topRank?: 1 | 2 | 3;
  lastReadChapter?: number;
  readingComment?: string;
  chaptersCurrent?: number | null;
  chaptersTotal?: number | null;
  pagesCurrent?: number | null;
  pagesTotal?: number | null;
  progressUnit?: "chapters" | "pages";
  progressPercent?: number | null;
  postponedMonth?: number | null;
  postponedYear?: number | null;
  postponedOverdue?: boolean;
  hasCompletedReading?: boolean;
  isAdult?: boolean;
  flipUrl?: string;
  links?: BookLink[];
  createdAtValue?: string;
  featuredMonth?: number;
  featuredYear?: number;
  publicationMonth?: number;
  publicationYear?: number;
  averageRating?: number;
  ratingCount: number;
};
export type CommunityBook = LibraryBook;

export type BookLink = { id: number; label: string; url: string; action?: "Купить" | "Читать" | "Слушать" };
export type AuthorBook = Omit<LibraryBook, "rating" | "review"> & { rating?: undefined; review?: undefined; links: BookLink[] };
export type WishBook = Pick<LibraryBook, "id" | "author" | "title" | "genres" | "annotation" | "coverUrl" | "coverTone"> & { ownerId: number; catalogBookId?: number; marketplace: "Flip"; productUrl?: string; pickupAddress?: string; recipientName?: string; phone?: string; price?: number; priceCurrency?: string; priceCheckedAt?: string; reservedByUserId?: number; reservedAt?: string; privateVisible: boolean };
export type MarketplaceProductPreview = { marketplace: "Flip" | "Marwin/Меломан" | "Яндекс.Книги"; productUrl: string; title: string; author: string; isbn?: string; publisher?: string; catalogBookId?: number; annotation: string; coverUrl?: string; price?: number; currency: string; suggestedAction: "Купить" | "Читать" | "Слушать" };
export type FlipProductPreview = MarketplaceProductPreview & { marketplace: "Flip"; suggestedAction: "Купить" };

export type UserReview = { id: number; bookId?: number; bookTitle: string; bookAuthor: string; rating: number; preview: string; fullText: string; bodyHtml?: string; isAdult?: boolean; createdAt: string; createdAtValue?: string };
export type UserExcerpt = { id: number; bookId?: number; bookIds?: number[]; bookTitle: string; previewText: string; bodyHtml: string; text: string; link: string; isAdult?: boolean; createdAt: string; createdAtValue?: string };
export type PublisherVerificationStatus = "not_required" | "draft" | "pending" | "needs_changes" | "rejected" | "approved";
export type PublisherSaleLink = { id: number; label: string; url: string };
export type PublisherNews = { id: number; ownerId: number; title: string; previewText: string; bodyHtml: string; body: string; isAdult?: boolean; createdAt: string; createdAtValue?: string };
export type UserProfileData = {
  name: string;
  city: string;
  cityId?: number;
  country?: string;
  type: "Читатель" | "Писатель" | "Блогер" | "Издатель" | "Сообщество";
  gender: "Мужской" | "Женский" | "Не указан";
  birthDate?: string;
  age?: number;
  ageGroup?: "minor" | "adult" | "missing";
  birthDateVisibility?: "nobody" | "friends" | "everyone";
  followersVisibility?: "nobody" | "friends" | "everyone";
  friendsVisibility?: "nobody" | "friends" | "everyone";
  wishlistVisibility?: "nobody" | "friends" | "everyone";
  canViewFollowers?: boolean;
  canViewFriends?: boolean;
  canViewWishlist?: boolean;
  showBirthDateToFriends?: boolean;
  tabOrder?: ProfileTab[];
  hiddenProfileTabs?: ProfileTab[];
  homeView?: "classic" | "feed";
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
  communityType?: string;
  communityRules?: string;
  communityIsClosed?: boolean;
};
export type UserSuspension = { permanent: boolean; until?: string; reason: string };
export type UserBlock = { blockerId: number; blockedId: number; createdAt?: string };
export type ReportMaterialKind = "book" | "review" | "excerpt" | "event" | "occasion" | "publisher_news" | "shelf";
export type SafetyReport = {
  id: number;
  reference?: string;
  reporterId?: number;
  reporterName: string;
  targetKind: "user" | ReportMaterialKind | "chat" | "comment" | "book_note";
  targetId: number;
  targetUserId?: number;
  targetUserName?: string;
  targetTitle?: string;
  reason: string;
  status: "new" | "reviewing" | "satisfied" | "rejected";
  createdAt: string;
  dueAt?: string;
  motivatedResponse?: string;
  responseAt?: string;
  appealedAt?: string;
  appealText?: string;
  commentText?: string;
  noteText?: string;
  noteBookId?: number;
  materialKind?: ReportMaterialKind;
  materialId?: number;
  conversationMessages?: Message[];
};
export type ReadingHistoryEntry = { id: number; bookId: number; completedMonth?: number; completedYear?: number; book: Pick<LibraryBook, "id" | "author" | "title" | "coverUrl" | "coverTone"> };
export type ReadingGoal = { id: number; goalKind: "month" | "year"; targetCount: number; targetMonth: number | null; targetYear: number; startMonth: number | null; createdAt?: string; updatedAt?: string };
export type DemoUser = { id: number; username: string; usernameIsTemporary?: boolean; profileCompleted?: boolean; initials: string; color: string; avatarUrl?: string; joined: string; joinedAt?: string; online?: boolean; lastSeenAt?: string; isAdmin?: boolean; blockedByMe?: boolean; friendCount?: number; followerCount?: number; friendIds?: number[]; followerIds?: number[]; memberCount?: number; memberIds?: number[]; suspension?: UserSuspension; deletedAt?: string; deletionExpiresAt?: string; purged?: boolean; profile: UserProfileData; books: LibraryBook[]; readingHistory?: ReadingHistoryEntry[]; communityBooks?: CommunityBook[]; reviews: UserReview[]; authorBooks?: AuthorBook[]; excerpts?: UserExcerpt[]; publisherNews?: PublisherNews[]; wishBooks?: WishBook[] };

export type AdultMaterialKind = "book" | "review" | "excerpt" | "event" | "occasion";
export type AdultAccess = { status: "adult" | "minor" | "missing"; restricted: Partial<Record<AdultMaterialKind, number[]>> };
export type LegalDocument = { id: number; type: "user_agreement" | "privacy_policy" | "personal_data_consent" | "community_moderation_rules"; version: string; language: "ru" | "kk" | "en"; title: string; content: string; fileName?: string; requiresReacceptance?: boolean; publishedAt?: string };
export type AccessGate = { profileComplete: boolean; missingProfileFields: string[]; legalConfigured: boolean; pendingLegalDocuments: LegalDocument[]; legalDocuments?: LegalDocument[] };
export type LinkedProfileCard = { id: number; name: string; type: "Читатель" | "Писатель" | "Блогер" | "Сообщество"; avatarUrl?: string; profileCompleted?: boolean };
export type MaterialActionRef = { kind: ReportMaterialKind | "book"; id: number; createdAt: string };
export type BootstrapData = { shelves?: BookShelf[]; activeUserId: number; profileCompleted?: boolean; accessGate?: AccessGate; adultAccess?: AdultAccess; users: DemoUser[]; activeOrganizationIds?: number[]; books?: LibraryBook[]; linkedProfile?: LinkedProfileCard; messages: Record<string, Message[]>; friendRequests: FriendRequest[]; friendships: Friendship[]; communityMemberships?: CommunityMembership[]; follows: Follow[]; notifications: SocialNotification[]; likes: Record<string, number[]>; saves?: Record<string, number[]>; likedMaterialRefs?: MaterialActionRef[]; savedMaterialRefs?: MaterialActionRef[]; events?: BookEvent[]; occasions?: Occasion[]; blocks?: UserBlock[]; blockedByUserIds?: number[]; reports?: SafetyReport[] };
export type PublicCatalogBook = Pick<LibraryBook, "id" | "author" | "title" | "isbn" | "publisher" | "genres" | "annotation" | "coverUrl" | "coverTone"> & { addedAt?: string; popularity: number };
export type PublicCatalogOwner = { id: number; name: string; initials: string; color: string; avatarUrl?: string };
export type PublicCatalogMaterial = { id: number; kind: "review" | "excerpt" | "publisher_news"; title: string; preview: string; ownerName: string; owner: PublicCatalogOwner; createdAt?: string };
export type PublicCatalogEvent = { id: number; title: string; summary: string; date: string; time: string; city: string; address: string; createdAt?: string };
export type PublicCatalogOccasion = { id: number; type: OccasionType; primaryText: string; audienceText: string; targetCities: string[]; meetingDate?: string; meetingStartTime?: string; meetingEndTime?: string; meetingCity?: string; meetingAddress?: string; createdAt?: string };
export type PublicOrganization = { id: number; name: string; city: string; type: "Издатель" | "Сообщество"; bio: string; communityType?: string; communityIsClosed?: boolean; initials: string; color: string; avatarUrl?: string };
export type PublicCatalogData = { books: PublicCatalogBook[]; materials: PublicCatalogMaterial[]; events: PublicCatalogEvent[]; occasions: PublicCatalogOccasion[]; organizations: PublicOrganization[] };
export type AuthResult = { error?: string; code?: string; requiresTotp?: boolean; deletedProfile?: boolean; daysRemaining?: number };

export type AdminMaterialKind = "book" | "review" | "excerpt" | "event" | "occasion";
export type AdminCatalogKind = AdminMaterialKind | "publisher_news";
export type AdminSection = "dashboard" | "moderation" | "reports-new" | "reports-reviewed" | "users-active" | "users-blocked" | "users-deleted" | AdminMaterialKind;
type AdminCatalogItemBase<K extends AdminCatalogKind> = {
  id: number;
  kind: K;
  title: string;
  subtitle: string;
  text: string;
  coverUrl?: string;
  coverTone?: string;
};
export type AdminCatalogOwnerMetadata = { ownerId: number; ownerName: string };
export type AdminCatalogItem =
  | (AdminCatalogItemBase<"book"> & { source: LibraryBook | AuthorBook })
  | (AdminCatalogItemBase<"review"> & { source: UserReview & AdminCatalogOwnerMetadata })
  | (AdminCatalogItemBase<"excerpt"> & { source: UserExcerpt & AdminCatalogOwnerMetadata })
  | (AdminCatalogItemBase<"publisher_news"> & { source: PublisherNews & AdminCatalogOwnerMetadata })
  | (AdminCatalogItemBase<"event"> & { source: BookEvent })
  | (AdminCatalogItemBase<"occasion"> & { source: Occasion });

export type AdminStatistics = {
  totalUsers: number;
  usersByType: Record<"Читатель" | "Писатель" | "Блогер" | "Издатель" | "Сообщество", number>;
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
