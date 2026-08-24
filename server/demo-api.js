import { Router } from "express";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, recoveryCodeIndex, verifyTotp } from "./security.js";
import { canCreateFriendRequest, canMessagePair } from "./modules/social-permissions.js";
import { nextTopRank, top3Eligibility } from "./modules/top3.js";
import { consumeAccountActionToken, createOpaqueActionToken, EMAIL_VERIFICATION_TTL_MINUTES, PASSWORD_RESET_TTL_MINUTES, replaceAccountActionToken } from "./modules/account-tokens.js";
import { isPublicOccasion, isPublicUpcomingEvent } from "./modules/public-catalog.js";
import { legalConsentRequired } from "./modules/compliance.js";
import { authText, requestLocale } from "./modules/i18n.js";
import { LoginAttemptTracker } from "./modules/login-attempts.js";
import { normalizeUsername, usernameValidationError } from "./modules/username.js";
import { searchBootstrapMaterials } from "./modules/material-search.js";

const router = Router();
const sessions = new Map();
const passwords = new Map([
  [1, process.env.TEST1_PASSWORD || "testtest1"],
  [2, process.env.PUBLISHER_TEST_PASSWORD || "publisher2026"],
]);
const demoAccountActionTokens = new Map();
const loginAttempts = new LoginAttemptTracker({ limit: 10, windowMs: 15 * 60 * 1000 });
const demoLegalAcceptances = new Map([
  [1, new Set([1, 2, 3])],
  [2, new Set([1, 2, 3])],
]);
let nextId = 100;

const demoLegalDocuments = [
  { id: 1, type: "user_agreement", version: "demo-1", language: "ru", title: "Пользовательское соглашение", content: "Демонстрационная версия пользовательского соглашения.", requiresReacceptance: true },
  { id: 2, type: "privacy_policy", version: "demo-1", language: "ru", title: "Политика конфиденциальности", content: "Демонстрационная версия политики конфиденциальности.", requiresReacceptance: true },
  { id: 3, type: "personal_data_consent", version: "demo-1", language: "ru", title: "Согласие на сбор и обработку персональных данных", content: "Демонстрационная версия согласия.", requiresReacceptance: true },
  { id: 4, type: "community_moderation_rules", version: "demo-1", language: "ru", title: "Правила сообщества и модерации", content: "Демонстрационная версия правил сообщества и модерации.", requiresReacceptance: false },
];
const demoRequiredLegalDocuments = demoLegalDocuments.filter((document) => document.type !== "community_moderation_rules");

function demoProfileAccess(user) {
  if (user?.isAdmin) return { complete: true, missing: [] };
  const missing = [];
  if (!String(user?.profile?.name ?? "").trim()) missing.push("name");
  if (!String(user?.profile?.city ?? "").trim() && !user?.profile?.cityId) missing.push("city");
  if (!["Издатель", "Сообщество"].includes(user?.profile?.type) && !/^\d{4}-\d{2}-\d{2}$/.test(String(user?.profile?.birthDate ?? ""))) missing.push("birthDate");
  return { complete: missing.length === 0, missing };
}

function demoLegalAccess(userId) {
  const accepted = demoLegalAcceptances.get(userId) ?? new Set();
  const pending = legalConsentRequired()
    ? demoLegalDocuments.filter((document) => document.requiresReacceptance && !accepted.has(document.id))
    : [];
  return { configured: true, pending, documents: demoLegalDocuments };
}

function hasMultipleOccasionCities(body = {}) {
  return body.type !== "invite" && new Set((Array.isArray(body.targetCities) ? body.targetCities : []).map((city) => String(city).trim()).filter(Boolean)).size > 1;
}

function demoTokenConnection() {
  return {
    async query(sql, values = []) {
      if (sql.startsWith("DELETE FROM account_action_tokens")) {
        for (const [hash, entry] of demoAccountActionTokens) if (entry.userId === Number(values[0]) && entry.purpose === values[1]) demoAccountActionTokens.delete(hash);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("INSERT INTO account_action_tokens")) {
        const [userId, purpose, tokenHash, ttlMinutes] = values;
        demoAccountActionTokens.set(tokenHash, { id: tokenHash, userId: Number(userId), purpose, expiresAt: Date.now() + Number(ttlMinutes) * 60_000, consumedAt: null });
        return [{ insertId: 1 }];
      }
      if (sql.includes("FROM account_action_tokens")) {
        const [tokenHash, purpose] = values;
        const entry = demoAccountActionTokens.get(tokenHash);
        return [[entry && entry.purpose === purpose && !entry.consumedAt && entry.expiresAt > Date.now() ? { id: entry.id, user_id: entry.userId } : undefined]];
      }
      if (sql.startsWith("UPDATE account_action_tokens SET consumed_at")) {
        const entry = demoAccountActionTokens.get(values[0]);
        if (!entry || entry.consumedAt) return [{ affectedRows: 0 }];
        entry.consumedAt = Date.now();
        return [{ affectedRows: 1 }];
      }
      throw new Error("Unsupported demo account token query");
    },
  };
}

async function replaceDemoActionToken(userId, purpose, token, ttlMinutes) {
  return replaceAccountActionToken(demoTokenConnection(), { userId, purpose, token, ttlMinutes });
}

async function consumeDemoActionToken(token, purpose) {
  return consumeAccountActionToken(demoTokenConnection(), { token, purpose });
}

const users = [
  {
    id: 1,
    isAdmin: true,
    username: "Тест 1",
    email: "dr.loony91@gmail.com",
    initials: "Т1",
    color: "mint",
    joined: "сегодня",
    joinedAt: new Date(Date.now() - 60_000).toISOString(),
    profile: {
      name: "Тест 1",
      city: "Астана",
      cityId: 1,
      country: "Казахстан",
      type: "Читатель",
      gender: "Мужской",
      birthDate: "1991-07-15",
      age: 35,
      birthDateVisibility: "nobody",
      showBirthDateToFriends: false,
      tabOrder: [],
      bio: "",
      authorInfluences: "",
      writingThemes: "",
      weekend: "",
      joy: "",
      talk: "",
      strangerMessage: "",
      favoriteGenres: [],
      dislikedGenres: [],
    },
    books: [],
    authorBooks: [],
    reviews: [{ id: 51, bookId: 21, bookTitle: "Город между строк", bookAuthor: "Айдана Сарсен", rating: 4.5, preview: "Тёплый городской роман о памяти, случайных встречах и внимании к деталям.", fullText: "Книга легко читается и оставляет после себя желание внимательнее смотреть на знакомые улицы.", bodyHtml: "<p>Книга <strong>легко читается</strong> и оставляет после себя желание внимательнее смотреть на знакомые улицы.</p>", isAdult: false, createdAt: "сегодня", createdAtValue: new Date().toISOString() }],
    excerpts: [{ id: 52, bookId: 21, bookIds: [21, 22], bookTitle: "Город между строк", previewText: "Две новые книги казахстанских авторов, которые стоит добавить в планы на осень.", bodyHtml: "<p>Собрал две разные по настроению книги: городской роман и тёплый сборник рассказов.</p>", text: "Собрал две разные по настроению книги: городской роман и тёплый сборник рассказов.", link: "", isAdult: false, createdAt: "сегодня", createdAtValue: new Date().toISOString() }],
    wishBooks: [],
  },
  {
    id: 2,
    isAdmin: false,
    username: "Издательство «Тест»",
    email: "publisher.test@bookmeet.kz",
    initials: "ИТ",
    color: "blue",
    joined: "сегодня",
    joinedAt: new Date(Date.now() - 30_000).toISOString(),
    profile: {
      name: "Издательство «Тест»",
      city: "Астана",
      cityId: 1,
      country: "Казахстан",
      type: "Издатель",
      homeView: "classic",
      gender: "Не указан",
      bio: "Независимое казахстанское издательство современной прозы, нон-фикшна и красивых книг для вдумчивого чтения.",
      authorInfluences: "",
      writingThemes: "",
      weekend: "",
      joy: "",
      talk: "",
      strangerMessage: "",
      favoriteGenres: [],
      dislikedGenres: [],
      publisherStatus: "approved",
      publisherWebsite: "https://bookmeet.kz",
      publisherSalesLinks: [{ id: 1, label: "Flip", url: "https://www.flip.kz" }],
      publisherLegalName: "ТОО «Тестовое издательство»",
      publisherBin: "240740000001",
      publisherAccount: "KZ000000000000000001",
      publisherBik: "TESTKZKX",
      publisherBank: "Тестовый банк",
      publisherLegalAddress: "г. Астана, тестовый адрес, 1",
      publisherPostalAddress: "010000, г. Астана, а/я 1",
      publisherModerationNote: "",
    },
    books: [],
    authorBooks: [
      { id: 21, author: "Айдана Сарсен", title: "Город между строк", genres: [], annotation: "Роман о городе, памяти и встречах, которые меняют привычный маршрут.", pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", coverTone: "blue", links: [] },
      { id: 22, author: "Марат Есенов", title: "Тёплый ветер степи", genres: [], annotation: "Сборник рассказов о людях, дороге и современном Казахстане.", pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", coverTone: "sand", links: [] },
      { id: 23, author: "Лейла Нур", title: "Свет в читальном зале", genres: [], annotation: "История о библиотеке, которая становится точкой притяжения для целого района.", pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", coverTone: "mint", links: [] },
    ],
    reviews: [],
    excerpts: [],
    publisherNews: [
      { id: 31, ownerId: 2, title: "Открыли предзаказ на осенние новинки", previewText: "Рассказываем о трёх книгах, которые выйдут этой осенью, и показываем первые обложки.", bodyHtml: "<p>Рассказываем о трёх книгах, которые выйдут этой осенью, и показываем первые обложки.</p>", body: "Рассказываем о трёх книгах, которые выйдут этой осенью, и показываем первые обложки.", createdAt: new Date().toISOString() },
    ],
    wishBooks: [],
  },
];

const state = {
  linkedProfiles: [],
  // Demo keeps the catalogue separately from personal libraries as production does.
  catalogBooks: [
    ...users.flatMap((user) => [...(user.books ?? []), ...(user.authorBooks ?? [])]),
    { id: 24, catalogBookId: 24, author: "Айгерим Жансугурова", title: "Точки на карте", genres: ["Современная проза"], annotation: "Каталожная книга без записи в личной библиотеке.", pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", coverTone: "mint", links: [] },
  ],
  messages: {},
  friendRequests: [],
  friendships: [],
  communityMemberships: [],
  follows: [],
  blocks: [],
  reports: [],
  notifications: [],
  likes: {},
  saves: {},
  comments: {},
  events: [{
    id: 41, creatorId: 2, creatorName: "Издательство Тест", title: "Встреча с авторами издательства «Тест»",
    summary: "Разговор о новых казахстанских книгах и автограф-сессия.",
    description: "Познакомимся с авторами осенних новинок и обсудим, как рождаются современные книги.",
    date: "2026-12-12", time: "18:30", city: "Астана", cityId: 1, country: "Казахстан",
    address: "проспект Республики, 1", mapUrl: "", detailsUrl: "",
    status: "published", moderationNote: "", pinned: false, reminderUserIds: [], reminderCount: 0, createdAt: new Date().toISOString(),
    linkedBookId: 21, linkedBookIds: [21], linkedBooks: [{ id: 21, title: "Город между строк", author: "Айдана Сарсен", annotation: "Роман о городе, памяти и встречах, которые меняют привычный маршрут.", coverTone: "blue" }], bookTitle: "Город между строк", bookAuthor: "Айдана Сарсен",
  }],
  occasions: [],
};

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

function currentUserId(request) {
  return sessions.get(cookieValue(request, "book_meet_demo")) ?? null;
}

function requireUser(request, response, next) {
  const userId = currentUserId(request);
  if (!userId) return response.status(401).json({ error: "Требуется вход" });
  const user = users.find((item) => item.id === userId);
  if (user?.deletedAt || user?.purged) return response.status(410).json({ deletedProfile: true, purged: Boolean(user.purged), daysRemaining: user.deletionExpiresAt ? Math.max(0, Math.ceil((new Date(user.deletionExpiresAt).getTime() - Date.now()) / 86_400_000)) : 0 });
  if (user?.suspension && (user.suspension.permanent || new Date(user.suspension.until).getTime() > Date.now())) return response.status(423).json({ suspended: true, ...user.suspension });
  if (user?.suspension) delete user.suspension;
  request.demoUserId = userId;
  next();
}

function bootstrap(userId) {
  const viewer = users.find((user) => user.id === userId);
  const profileGate = demoProfileAccess(viewer);
  const legalGate = demoLegalAccess(userId);
  const adultStatus = viewer?.isAdmin || Number(viewer?.profile.age ?? -1) >= 18 ? "adult" : viewer?.profile.birthDate ? "minor" : "missing";
  const restricted = adultStatus === "adult" ? {} : {
    book: users.flatMap((user) => [...(user.books ?? []), ...(user.authorBooks ?? [])]).filter((item) => item.isAdult).map((item) => item.id),
    review: users.flatMap((user) => user.reviews ?? []).filter((item) => item.isAdult).map((item) => item.id),
    excerpt: users.flatMap((user) => user.excerpts ?? []).filter((item) => item.isAdult).map((item) => item.id),
    event: state.events.filter((item) => item.isAdult && item.status === "published").map((item) => item.id),
    occasion: state.occasions.filter((item) => item.isAdult && item.status === "published").map((item) => item.id),
  };
  const relatedBlocks = state.blocks.filter((block) => block.blockerId === userId || block.blockedId === userId);
  const blockedByUserIds = relatedBlocks.filter((block) => block.blockedId === userId).map((block) => block.blockerId);
  const friendCountByUser = new Map(users.map((user) => [user.id, state.friendships.filter((entry) => entry.userA === user.id || entry.userB === user.id).length]));
  const followerCountByUser = new Map(users.map((user) => [user.id, state.follows.filter((entry) => entry.targetId === user.id && !state.friendships.some((friendship) => [friendship.userA, friendship.userB].includes(user.id) && [friendship.userA, friendship.userB].includes(entry.followerId))).length]));
  const visibleUsers = users.map((user) => ({ ...user, friendCount: user.deletedAt || user.purged ? 0 : friendCountByUser.get(user.id) ?? 0, followerCount: user.deletedAt || user.purged ? 0 : followerCountByUser.get(user.id) ?? 0 })).filter((user) => !["Издатель", "Сообщество"].includes(user.profile.type)
    || user.profile.publisherStatus === "approved"
    || user.id === userId
    || viewer?.isAdmin).filter((user) => viewer?.isAdmin || user.id === userId || !blockedByUserIds.includes(user.id)).map((user) => {
    const friend = state.friendships.some((entry) => [entry.userA, entry.userB].includes(user.id) && [entry.userA, entry.userB].includes(userId));
    const privateVisible = user.id === userId || friend;
    const profile = user.id === userId || viewer?.isAdmin ? user.profile : {
      ...user.profile,
      birthDate: (user.profile.birthDateVisibility ?? (user.profile.showBirthDateToFriends ? "friends" : "nobody")) === "everyone" || (user.profile.birthDateVisibility ?? (user.profile.showBirthDateToFriends ? "friends" : "nobody")) === "friends" && friend ? user.profile.birthDate : undefined,
      birthDateVisibility: undefined,
      showBirthDateToFriends: undefined,
      publisherLegalName: undefined, publisherBin: undefined, publisherAccount: undefined,
      publisherBik: undefined, publisherBank: undefined, publisherLegalAddress: undefined,
      publisherPostalAddress: undefined, publisherModerationNote: undefined,
    };
    return { ...user, books: (user.books ?? []).filter((item) => adultStatus === "adult" || !item.isAdult), authorBooks: (user.authorBooks ?? []).filter((item) => adultStatus === "adult" || !item.isAdult), reviews: (user.reviews ?? []).filter((item) => adultStatus === "adult" || !item.isAdult), excerpts: (user.excerpts ?? []).filter((item) => adultStatus === "adult" || !item.isAdult), blockedByMe: relatedBlocks.some((block) => block.blockerId === userId && block.blockedId === user.id), profile, wishBooks: (user.wishBooks ?? []).map((item) => privateVisible ? { ...item, productUrl: user.id === userId ? item.productUrl : undefined, privateVisible: true } : { id: item.id, ownerId: item.ownerId, catalogBookId: item.catalogBookId, author: item.author, title: item.title, genres: item.genres, annotation: item.annotation, coverUrl: item.coverUrl, coverTone: item.coverTone, marketplace: item.marketplace, reservedByUserId: item.reservedByUserId, privateVisible: false }) };
  });
  const link = state.linkedProfiles.find((item) => item.personalUserId === userId || item.communityUserId === userId);
  const linked = link ? users.find((item) => item.id === (link.personalUserId === userId ? link.communityUserId : link.personalUserId)) : undefined;
  const { linkedProfiles: _linkedProfiles, saves: saveEntries, ...publicState } = state;
  const saves = {};
  const savedMaterialRefs = [];
  for (const [key, entries] of Object.entries(saveEntries)) {
    const own = entries.find((entry) => entry.userId === userId);
    if (!own) continue;
    saves[key] = [userId];
    const [kind, id] = key.split(/-(?=\d+$)/);
    savedMaterialRefs.push({ kind, id: Number(id), createdAt: own.createdAt });
  }
  savedMaterialRefs.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const likedMaterialRefs = Object.entries(state.likes).filter(([, ids]) => ids.includes(userId)).map(([key]) => {
    const [kind, id] = key.split(/-(?=\d+$)/);
    return { kind, id: Number(id), createdAt: new Date().toISOString() };
  });
  return structuredClone({ activeUserId: userId, profileCompleted: profileGate.complete, accessGate: { profileComplete: profileGate.complete, missingProfileFields: profileGate.missing, legalConfigured: legalGate.configured, pendingLegalDocuments: legalGate.pending, legalDocuments: legalGate.documents }, adultAccess: { status: adultStatus, restricted }, users: visibleUsers, ...publicState, saves, savedMaterialRefs, likedMaterialRefs, linkedProfile: linked ? { id: linked.id, name: linked.profile.name, type: linked.profile.type, avatarUrl: linked.avatarUrl, profileCompleted: demoProfileAccess(linked).complete } : undefined, books: state.catalogBooks.filter((item) => adultStatus === "adult" || !item.isAdult), blocks: relatedBlocks, blockedByUserIds, reports: viewer?.isAdmin ? state.reports : [], events: state.events.filter((item) => (viewer?.isAdmin || adultStatus === "adult" || !item.isAdult) && (viewer?.isAdmin || item.status === "published" || item.creatorId === userId)), occasions: state.occasions.filter((item) => (viewer?.isAdmin || adultStatus === "adult" || !item.isAdult) && (viewer?.isAdmin || item.creatorId === userId || item.status === "published" && (item.targetGender === "Все" || item.targetGender === viewer?.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === viewer?.profile.type))) });
}

function conversationKey(first, second) {
  return [Number(first), Number(second)].sort((a, b) => a - b).join("-");
}

function notification(userId, actorId, type, title, text, extra = {}) {
  state.notifications.push({ id: nextId++, userId, actorId, type, title, text, unread: true, createdAt: "сейчас", ...extra });
}

router.get("/health", (_request, response) => {
  response.json({ ok: true, service: "book-meet", database: "demo-memory" });
});

router.get("/auth/providers", (_request, response) => response.json({ google: false }));
router.get("/auth/legal-documents", (_request, response) => response.json({ required: legalConsentRequired(), configured: true, documents: demoLegalDocuments }));

// Local visual QA helper. This router is only mounted when DEMO_MODE=1 and is
// never part of the production API.
router.get("/auth/demo-login", (request, response) => {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, Number(request.query.user) === 2 ? 2 : 1);
  response.setHeader("Set-Cookie", `book_meet_demo=${token}; Path=/; HttpOnly; SameSite=Lax`);
  response.redirect("/");
});

router.post("/auth/login", (request, response) => {
  const locale = requestLocale(request);
  const email = String(request.body?.email ?? "").trim().toLocaleLowerCase("en");
  const attempt = loginAttempts.state([`ip:${request.ip || request.socket.remoteAddress || "unknown"}`, `identity:${email}`]);
  if (attempt.blocked) {
    response.setHeader("Retry-After", String(attempt.retryAfterSeconds));
    return response.status(429).json({ code: "AUTH_TOO_MANY_ATTEMPTS", error: authText(locale, "tooManyAttempts") });
  }
  const password = String(request.body?.password ?? "");
  const code = String(request.body?.totp ?? "");
  const account = users.find((user) => user.email?.toLocaleLowerCase("en") === email);
  if (!account || account.passwordLoginEnabled === false || password !== passwords.get(account.id)) {
    attempt.fail();
    return response.status(401).json({ error: "Неверный e-mail или пароль" });
  }
  if (account.suspension && (account.suspension.permanent || new Date(account.suspension.until).getTime() > Date.now())) return response.status(423).json({ suspended: true, ...account.suspension });
  if (account.totpEnabled && !code) return response.status(202).json({ requiresTotp: true });
  if (account.totpEnabled && !verifyTotp(account.totpSecret, code)) {
    const recoveryIndex = recoveryCodeIndex(account.totpRecoveryCodes ?? [], code);
    if (recoveryIndex < 0) { attempt.fail(); return response.status(401).json({ error: "Неверный одноразовый или резервный код" }); }
    account.totpRecoveryCodes.splice(recoveryIndex, 1);
  }
  attempt.clearIdentity();
  const token = randomBytes(24).toString("hex");
  sessions.set(token, account.id);
  response.setHeader("Set-Cookie", `book_meet_demo=${token}; Path=/; HttpOnly; SameSite=Lax`);
  if (account.deletedAt || account.purged) return response.status(202).json({ deletedProfile: true, purged: Boolean(account.purged), daysRemaining: account.deletionExpiresAt ? Math.max(0, Math.ceil((new Date(account.deletionExpiresAt).getTime() - Date.now()) / 86_400_000)) : 0 });
  response.json(bootstrap(account.id));
});

const demoCities = [
  ["Астана", "Казахстан"], ["Алматы", "Казахстан"], ["Шымкент", "Казахстан"], ["Караганда", "Казахстан"],
  ["Актобе", "Казахстан"], ["Жезказган", "Казахстан"], ["Атырау", "Казахстан"], ["Павлодар", "Казахстан"],
  ["Костанай", "Казахстан"], ["Тараз", "Казахстан"], ["Туркестан", "Казахстан"], ["Уральск", "Казахстан"],
  ["Петропавловск", "Казахстан"], ["Усть-Каменогорск", "Казахстан"], ["Семей", "Казахстан"], ["Кызылорда", "Казахстан"],
  ["Кокшетау", "Казахстан"], ["Талдыкорган", "Казахстан"], ["Экибастуз", "Казахстан"], ["Темиртау", "Казахстан"],
  ["Рудный", "Казахстан"], ["Актау", "Казахстан"], ["Балхаш", "Казахстан"], ["Конаев", "Казахстан"],
];
router.get("/cities", (request, response) => {
  const query = String(request.query.q ?? "").trim().toLocaleLowerCase("ru");
  response.json({ cities: demoCities.filter(([city]) => city.toLocaleLowerCase("ru").includes(query)).map(([name, country], index) => ({ id: index + 1, name, countryCode: "", country })) });
});

router.post("/auth/register", async (request, response) => {
  const locale = requestLocale(request);
  const email = String(request.body?.email ?? "").trim().toLocaleLowerCase("en");
  const password = String(request.body?.password ?? "");
  const username = normalizeUsername(request.body?.username);
  const legalAcceptance = request.body?.legalAcceptance ?? request.body?.legal;
  const acceptedDocumentIds = new Set((Array.isArray(legalAcceptance?.documentIds) ? legalAcceptance.documentIds : []).map(Number));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return response.status(400).json({ error: "Укажите корректный e-mail и пароль не короче 8 знаков" });
  const usernameError = usernameValidationError(username);
  if (usernameError) return response.status(400).json({ code: usernameError, error: authText(locale, usernameError === "USERNAME_RESERVED" ? "usernameReserved" : "usernameInvalid") });
  if (legalConsentRequired() && (!legalAcceptance?.agreementAccepted || !legalAcceptance?.personalDataAccepted || demoRequiredLegalDocuments.some((document) => !acceptedDocumentIds.has(document.id)))) return response.status(400).json({ error: "Для регистрации необходимо принять пользовательское соглашение и согласие на обработку персональных данных", code: "LEGAL_ACCEPTANCE_REQUIRED" });
  if (users.some((user) => user.email?.toLocaleLowerCase("en") === email)) return response.status(409).json({ error: "Профиль с таким e-mail уже существует" });
  const displayName = email.split("@")[0];
  if (users.some((user) => user.username === username)) return response.status(409).json({ code: "USERNAME_TAKEN", error: authText(locale, "usernameTaken") });
  const user = { id: nextId++, email, emailVerifiedAt: undefined, passwordLoginEnabled: true, profileCompleted: false, username, usernameIsTemporary: false, initials: displayName.slice(0, 2).toLocaleUpperCase("ru"), color: "blue", joined: "сегодня", joinedAt: new Date().toISOString(), profile: { name: displayName, city: "", type: "Читатель", gender: "Не указан", bio: "", authorInfluences: "", writingThemes: "", weekend: "", joy: "", talk: "", strangerMessage: "", favoriteGenres: [], dislikedGenres: [] }, books: [], authorBooks: [], reviews: [], excerpts: [], wishBooks: [] };
  const verificationToken = createOpaqueActionToken();
  users.push(user); passwords.set(user.id, password); demoLegalAcceptances.set(user.id, new Set(legalConsentRequired() ? demoRequiredLegalDocuments.map((document) => document.id) : [])); await replaceDemoActionToken(user.id, "email_verify", verificationToken, EMAIL_VERIFICATION_TTL_MINUTES); const token = randomBytes(24).toString("hex"); sessions.set(token, user.id); response.setHeader("Set-Cookie", `book_meet_demo=${token}; Path=/; HttpOnly; SameSite=Lax`); response.status(201).json(bootstrap(user.id));
});

router.post("/auth/email-verification/confirm", async (request, response) => {
  const token = String(request.body?.token ?? "");
  const userId = await consumeDemoActionToken(token, "email_verify");
  const user = users.find((entry) => entry.id === userId);
  if (!user) return response.status(400).json({ error: "Ссылка подтверждения недействительна или истекла" });
  user.emailVerifiedAt = new Date().toISOString();
  response.json({ verified: true });
});

router.post("/auth/password-reset/request", async (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLocaleLowerCase("en");
  const account = users.find((user) => user.email?.toLocaleLowerCase("en") === email && !user.purged);
  if (account && !account.googleSubject && account.passwordLoginEnabled !== false) {
    await replaceDemoActionToken(account.id, "password_reset", createOpaqueActionToken(), PASSWORD_RESET_TTL_MINUTES);
  }
  response.json({ ok: true, message: "Если такой e-mail зарегистрирован, дальнейшие инструкции отправлены." });
});

router.post("/auth/password-reset/confirm", async (request, response) => {
  const token = String(request.body?.token ?? "");
  const password = String(request.body?.password ?? "");
  if (password.length < 8) return response.status(400).json({ error: "Не удалось сохранить новый пароль. Проверьте ссылку и требования к паролю." });
  const userId = await consumeDemoActionToken(token, "password_reset");
  const account = users.find((user) => user.id === userId && !user.purged);
  if (!account || account.googleSubject && account.passwordLoginEnabled === false) return response.status(400).json({ error: "Ссылка восстановления недействительна или истекла" });
  passwords.set(account.id, password);
  for (const [session, sessionUserId] of sessions) if (sessionUserId === account.id) sessions.delete(session);
  response.json({ reset: true });
});

router.post("/auth/logout", (request, response) => {
  sessions.delete(cookieValue(request, "book_meet_demo"));
  response.setHeader("Set-Cookie", "book_meet_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  response.json({ ok: true });
});

router.get("/bootstrap", (request, response) => {
  const userId = currentUserId(request);
  if (!userId) return response.status(401).json({ error: "Требуется вход" });
  const user = users.find((item) => item.id === userId);
  if (user?.deletedAt || user?.purged) return response.status(410).json({ deletedProfile: true, purged: Boolean(user.purged), daysRemaining: user.deletionExpiresAt ? Math.max(0, Math.ceil((new Date(user.deletionExpiresAt).getTime() - Date.now()) / 86_400_000)) : 0 });
  if (user?.suspension && (user.suspension.permanent || new Date(user.suspension.until).getTime() > Date.now())) return response.status(423).json({ suspended: true, ...user.suspension });
  response.json(bootstrap(userId));
});

router.get("/bootstrap/:section", (request, response) => {
  const userId = currentUserId(request);
  if (!userId) return response.status(401).json({ error: "Требуется вход" });
  const user = users.find((item) => item.id === userId);
  if (user?.deletedAt || user?.purged) return response.status(410).json({ deletedProfile: true, purged: Boolean(user.purged), daysRemaining: user.deletionExpiresAt ? Math.max(0, Math.ceil((new Date(user.deletionExpiresAt).getTime() - Date.now()) / 86_400_000)) : 0 });
  if (user?.suspension && (user.suspension.permanent || new Date(user.suspension.until).getTime() > Date.now())) return response.status(423).json({ suspended: true, ...user.suspension });
  const keys = {
    session: ["activeUserId", "profileCompleted", "accessGate"],
    catalog: ["activeUserId", "adultAccess", "users", "books", "events", "occasions"],
    social: ["activeUserId", "blocks", "blockedByUserIds", "friendRequests", "friendships", "communityMemberships", "follows", "notifications", "messages", "likes", "saves", "likedMaterialRefs", "savedMaterialRefs"],
    moderation: ["activeUserId", "reports"],
  }[request.params.section];
  if (!keys) return response.status(404).json({ error: "Неизвестный набор данных" });
  const data = bootstrap(userId);
  response.json(Object.fromEntries(keys.map((key) => [key, data[key]])));
});

router.get("/public/catalog", (_request, response) => {
  const books = [...new Map(users.flatMap((owner) => [...(owner.books ?? []), ...(owner.authorBooks ?? [])])
    .filter((book) => !book.isAdult)
    .map((book) => [book.catalogBookId ?? book.id, { id: book.catalogBookId ?? book.id, author: book.author, title: book.title, isbn: book.isbn, publisher: book.publisher, genres: book.genres ?? [], annotation: book.annotation ?? "", coverUrl: book.coverUrl, coverTone: book.coverTone ?? "blue", addedAt: book.createdAtValue ?? new Date().toISOString(), popularity: users.filter((user) => user.books.some((item) => (item.catalogBookId ?? item.id) === (book.catalogBookId ?? book.id))).length }])).values()];
  const materials = users.flatMap((owner) => [
    ...(owner.reviews ?? []).filter((item) => !item.isAdult).map((item) => ({ id: item.id, kind: "review", title: item.bookTitle, preview: item.preview, ownerName: owner.profile.name, owner: { id: owner.id, name: owner.profile.name, initials: owner.initials, color: owner.color, avatarUrl: owner.avatarUrl }, createdAt: item.createdAtValue ?? new Date().toISOString() })),
    ...(owner.excerpts ?? []).filter((item) => !item.isAdult).map((item) => ({ id: item.id, kind: "excerpt", title: item.bookTitle || "Публикация", preview: item.previewText, ownerName: owner.profile.name, owner: { id: owner.id, name: owner.profile.name, initials: owner.initials, color: owner.color, avatarUrl: owner.avatarUrl }, createdAt: item.createdAtValue ?? new Date().toISOString() })),
    ...(["Издатель", "Сообщество"].includes(owner.profile.type) && owner.profile.publisherStatus === "approved" ? (owner.publisherNews ?? []).filter((item) => !item.isAdult).map((item) => ({ id: item.id, kind: "publisher_news", title: item.title, preview: item.previewText, ownerName: owner.profile.name, owner: { id: owner.id, name: owner.profile.name, initials: owner.initials, color: owner.color, avatarUrl: owner.avatarUrl }, createdAt: item.createdAtValue ?? new Date().toISOString() })) : []),
  ]).sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
  const events = state.events.filter((item) => isPublicUpcomingEvent(item)).map((item) => ({ id: item.id, title: item.title, summary: item.summary, date: item.date, time: item.time, city: item.city, address: item.address, createdAt: item.createdAt }));
  const occasions = state.occasions.filter(isPublicOccasion).map((item) => ({ id: item.id, type: item.type, primaryText: item.primaryText, audienceText: item.audienceText, targetCities: item.targetCities ?? [], meetingDate: item.meetingDate, meetingStartTime: item.meetingStartTime, meetingEndTime: item.meetingEndTime, meetingCity: item.meetingCity, meetingAddress: item.meetingAddress, createdAt: item.createdAt }));
  const organizations = users.filter((user) => ["Издатель", "Сообщество"].includes(user.profile.type) && user.profile.publisherStatus === "approved").map((user) => ({ id: user.id, name: user.profile.name, city: user.profile.city, type: user.profile.type, bio: user.profile.bio, communityType: user.profile.communityType, communityIsClosed: user.profile.type === "Сообщество" ? Boolean(user.profile.communityIsClosed) : false, initials: user.initials, color: user.color, avatarUrl: user.avatarUrl }));
  response.json({ books, materials, events, occasions, organizations });
});

router.post("/auth/deleted-profile/restore", (request, response) => {
  const userId = currentUserId(request);
  const user = users.find((item) => item.id === userId);
  if (!user?.deletedAt || user.purged) return response.status(409).json({ error: "Профиль нельзя восстановить" });
  delete user.deletedAt;
  delete user.deletionExpiresAt;
  response.json(bootstrap(user.id));
});

router.post("/auth/deleted-profile/new", (request, response) => {
  const oldUserId = currentUserId(request);
  const oldUser = users.find((item) => item.id === oldUserId);
  if (!oldUser?.deletedAt || oldUser.purged) return response.status(409).json({ error: "Новый профиль нельзя создать" });
  const email = oldUser.email;
  const password = passwords.get(oldUser.id);
  oldUser.purged = true;
  oldUser.email = `deleted-${oldUser.id}@invalid.local`;
  oldUser.profile = { ...oldUser.profile, name: "Удалённый пользователь", city: "", cityId: undefined, bio: "", birthDate: undefined, age: undefined };
  const displayName = String(email).split("@")[0];
  const user = { id: nextId++, email, profileCompleted: false, username: displayName, initials: displayName.slice(0, 2).toLocaleUpperCase("ru"), color: "blue", joined: "сегодня", joinedAt: new Date().toISOString(), profile: { name: displayName, city: "", type: "Читатель", gender: "Не указан", bio: "", authorInfluences: "", writingThemes: "", weekend: "", joy: "", talk: "", strangerMessage: "", favoriteGenres: [], dislikedGenres: [] }, books: [], authorBooks: [], reviews: [], excerpts: [], wishBooks: [] };
  users.push(user);
  passwords.set(user.id, password);
  const token = randomBytes(24).toString("hex");
  sessions.delete(cookieValue(request, "book_meet_demo"));
  sessions.set(token, user.id);
  response.setHeader("Set-Cookie", `book_meet_demo=${token}; Path=/; HttpOnly; SameSite=Lax`);
  response.status(201).json(bootstrap(user.id));
});

router.use(requireUser);

router.get("/search/materials", (request, response) => {
  const result = searchBootstrapMaterials(bootstrap(request.demoUserId), request.query.q, { page: request.query.page, limit: request.query.limit });
  if (result.error) return response.status(400).json({ code: result.error, error: result.error === "SEARCH_QUERY_TOO_LONG" ? "Запрос слишком длинный" : "Введите не менее двух символов" });
  response.json(result);
});

const personalLinkTypes = new Set(["Читатель", "Писатель", "Блогер"]);
function demoLinkPair(personalId, communityId) {
  const personal = users.find((item) => item.id === personalId);
  const community = users.find((item) => item.id === communityId);
  if (!personal || !community || personal.id === community.id || !personalLinkTypes.has(personal.profile.type) || community.profile.type !== "Сообщество" || personal.deletedAt || community.deletedAt || personal.purged || community.purged || personal.suspension || community.suspension) throw Object.assign(new Error("Связать можно только активный личный профиль и сообщество"), { statusCode: 409 });
  if (state.linkedProfiles.some((item) => [item.personalUserId, item.communityUserId].includes(personalId) || [item.personalUserId, item.communityUserId].includes(communityId))) throw Object.assign(new Error("Один из профилей уже связан"), { statusCode: 409 });
}

router.post("/linked-profiles/create", async (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLocaleLowerCase("en");
  const password = String(request.body?.password ?? "");
  const name = String(request.body?.name ?? "Новое сообщество").trim().slice(0, 120) || "Новое сообщество";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return response.status(400).json({ error: "Укажите e-mail и пароль не короче 8 символов" });
  if (users.some((item) => item.email?.toLocaleLowerCase("en") === email)) return response.status(409).json({ error: "Этот e-mail уже используется" });
  const community = { id: nextId++, email, passwordLoginEnabled: true, profileCompleted: false, username: name, initials: name.slice(0, 2).toLocaleUpperCase("ru"), color: "blue", joined: "сегодня", joinedAt: new Date().toISOString(), profile: { name, city: "", type: "Сообщество", gender: "Не указан", publisherStatus: "draft", bio: "", authorInfluences: "", writingThemes: "", weekend: "", joy: "", talk: "", strangerMessage: "", favoriteGenres: [], dislikedGenres: [] }, books: [], authorBooks: [], reviews: [], excerpts: [], wishBooks: [] };
  users.push(community);
  try { demoLinkPair(request.demoUserId, community.id); } catch (error) { users.pop(); return response.status(error.statusCode ?? 400).json({ error: error.message }); }
  passwords.set(community.id, password); state.linkedProfiles.push({ personalUserId: request.demoUserId, communityUserId: community.id });
  await replaceDemoActionToken(community.id, "email_verify", createOpaqueActionToken(), EMAIL_VERIFICATION_TTL_MINUTES);
  response.status(201).json({ linkedProfile: { id: community.id, name, type: "Сообщество", profileCompleted: false }, created: true });
});

router.post("/linked-profiles/attach", (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLocaleLowerCase("en");
  const password = String(request.body?.password ?? "");
  const code = String(request.body?.totp ?? "");
  const community = users.find((item) => item.email?.toLocaleLowerCase("en") === email);
  if (!community || community.passwordLoginEnabled === false || passwords.get(community.id) !== password) return response.status(401).json({ error: "Не удалось подтвердить профиль сообщества" });
  if (community.totpEnabled && !code) return response.status(202).json({ requiresTotp: true });
  if (community.totpEnabled && !verifyTotp(community.totpSecret, code)) {
    const recoveryIndex = recoveryCodeIndex(community.totpRecoveryCodes ?? [], code);
    if (recoveryIndex < 0) return response.status(401).json({ error: "Неверный одноразовый код" });
    community.totpRecoveryCodes.splice(recoveryIndex, 1);
  }
  try { demoLinkPair(request.demoUserId, community.id); } catch (error) { return response.status(error.statusCode ?? 400).json({ error: error.message }); }
  state.linkedProfiles.push({ personalUserId: request.demoUserId, communityUserId: community.id });
  response.json({ linked: true, communityId: community.id });
});

router.post("/linked-profiles/switch", (request, response) => {
  const link = state.linkedProfiles.find((item) => item.personalUserId === request.demoUserId || item.communityUserId === request.demoUserId);
  if (!link) return response.status(404).json({ error: "Связанный профиль не найден" });
  const targetId = link.personalUserId === request.demoUserId ? link.communityUserId : link.personalUserId;
  const target = users.find((item) => item.id === targetId);
  if (!target || target.deletedAt || target.purged || target.suspension) return response.status(409).json({ error: "Связанный профиль недоступен" });
  const token = randomBytes(24).toString("hex"); sessions.delete(cookieValue(request, "book_meet_demo")); sessions.set(token, targetId);
  response.setHeader("Set-Cookie", `book_meet_demo=${token}; Path=/; HttpOnly; SameSite=Lax`);
  response.json(bootstrap(targetId));
});

router.delete(["/linked-profiles", "/linked-profiles/unlink"], (request, response) => {
  const index = state.linkedProfiles.findIndex((item) => item.personalUserId === request.demoUserId || item.communityUserId === request.demoUserId);
  if (index < 0) return response.status(404).json({ error: "Связанный профиль не найден" });
  state.linkedProfiles.splice(index, 1); response.json({ unlinked: true });
});

router.post("/legal/acceptances", (request, response) => {
  if (!legalConsentRequired()) return response.json({ accepted: true });
  const ids = new Set((Array.isArray(request.body?.documentIds) ? request.body.documentIds : []).map(Number));
  if (!request.body?.agreementAccepted || !request.body?.personalDataAccepted || demoLegalDocuments.some((document) => !ids.has(document.id))) return response.status(400).json({ error: "Необходимо принять все актуальные документы", code: "LEGAL_ACCEPTANCE_REQUIRED" });
  demoLegalAcceptances.set(request.demoUserId, new Set(demoLegalDocuments.map((document) => document.id)));
  response.json({ accepted: true });
});

router.use((request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)
    || request.path === "/users/me/state"
    || request.path === "/users/me/home-view"
    || request.path === "/users/me/profile-complete"
    || request.path === "/legal/acceptances"
    || request.path === "/auth/logout") return next();
  const user = users.find((item) => item.id === request.demoUserId);
  const legalGate = demoLegalAccess(request.demoUserId);
  if (legalGate.pending.length) return response.status(428).json({ code: "LEGAL_REACCEPTANCE_REQUIRED", error: "Необходимо принять новую версию юридических документов", documents: legalGate.pending });
  const profileGate = demoProfileAccess(user);
  if (!profileGate.complete) return response.status(428).json({ code: "PROFILE_COMPLETION_REQUIRED", error: "Укажите имя, город и дату рождения в профиле", missingFields: profileGate.missing });
  if (["Издатель", "Сообщество"].includes(user?.profile.type) && user.profile.publisherStatus !== "approved") {
    return response.status(403).json({ error: "Профиль организации ожидает официального подтверждения" });
  }
  next();
});

router.delete("/users/me/profile", (request, response) => {
  const user = users.find((item) => item.id === request.demoUserId);
  if (!user || user.isAdmin) return response.status(403).json({ error: "Профиль администратора нельзя удалить" });
  user.deletedAt = new Date().toISOString();
  user.deletionExpiresAt = new Date(Date.now() + 15 * 86_400_000).toISOString();
  user.consentWithdrawnAt = new Date().toISOString();
  delete user.avatarUrl;
  for (const [token, userId] of sessions) if (userId === user.id) sessions.delete(token);
  response.setHeader("Set-Cookie", "book_meet_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  response.json({ ok: true, deletionExpiresAt: user.deletionExpiresAt });
});

router.post("/admin/users/:id/restore", (request, response) => {
  const admin = users.find((item) => item.id === request.demoUserId);
  const user = users.find((item) => item.id === Number(request.params.id));
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  if (!user?.deletedAt || user.purged) return response.status(409).json({ error: "Профиль нельзя восстановить" });
  delete user.deletedAt;
  delete user.deletionExpiresAt;
  delete user.consentWithdrawnAt;
  response.json({ ok: true });
});

router.delete("/admin/users/:id/permanent", (request, response) => {
  const admin = users.find((item) => item.id === request.demoUserId);
  const user = users.find((item) => item.id === Number(request.params.id));
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  if (!user?.deletedAt || user.purged) return response.status(409).json({ error: "Профиль нельзя удалить окончательно" });
  user.purged = true;
  user.email = `deleted-${user.id}@invalid.local`;
  user.profile = { ...user.profile, name: "Удалённый пользователь", city: "", cityId: undefined, bio: "", birthDate: undefined, age: undefined };
  for (const report of state.reports) if (report.reporterId === user.id) { report.reporterId = undefined; report.reporterName = "Удалённый пользователь"; report.reporterAnonymized = true; }
  response.json({ ok: true });
});

router.post("/reports", (request, response) => {
  const reporter = users.find((user) => user.id === request.demoUserId);
  const targetKind = String(request.body?.targetKind ?? "");
  const targetId = Number(request.body?.targetId);
  const reason = String(request.body?.reason ?? "").trim();
  if (!reason) return response.status(400).json({ error: "Опишите причину жалобы" });
  let targetUserId;
  let targetTitle = "";
  if (targetKind === "user") {
    const target = users.find((user) => user.id === targetId);
    targetUserId = target?.id; targetTitle = target?.profile.name ?? "";
  } else if (targetKind === "event") {
    const target = state.events.find((item) => item.id === targetId);
    targetUserId = target?.creatorId; targetTitle = target?.title ?? "";
  } else if (targetKind === "occasion") {
    const target = state.occasions.find((item) => item.id === targetId);
    targetUserId = target?.creatorId; targetTitle = target?.primaryText ?? "";
  } else if (targetKind === "chat") {
    const target = users.find((user) => user.id === targetId);
    targetUserId = target?.id;
    targetTitle = target ? `Диалог с ${target.profile.name}` : "";
  } else if (targetKind === "comment") {
    const located = Object.entries(state.comments).flatMap(([key, comments]) => comments.map((comment) => ({ key, comment }))).find((entry) => entry.comment.id === targetId);
    if (located) {
      const [materialKind, materialId] = located.key.split(/-(?=\d+$)/);
      targetUserId = located.comment.userId;
      targetTitle = `Комментарий: ${located.comment.text.slice(0, 120)}`;
      request.reportContext = { commentText: located.comment.text, materialKind, materialId: Number(materialId) };
    }
  } else {
    const owner = users.find((user) => targetKind === "book"
      ? [...user.books, ...(user.authorBooks ?? [])].some((item) => item.id === targetId)
      : targetKind === "review" ? user.reviews.some((item) => item.id === targetId)
      : targetKind === "excerpt" ? (user.excerpts ?? []).some((item) => item.id === targetId)
      : (user.publisherNews ?? []).some((item) => item.id === targetId));
    targetUserId = owner?.id;
    const item = targetKind === "book" ? [...(owner?.books ?? []), ...(owner?.authorBooks ?? [])].find((entry) => entry.id === targetId)
      : targetKind === "review" ? owner?.reviews.find((entry) => entry.id === targetId)
      : targetKind === "excerpt" ? owner?.excerpts?.find((entry) => entry.id === targetId)
      : owner?.publisherNews?.find((entry) => entry.id === targetId);
    targetTitle = item?.title ?? item?.bookTitle ?? "Материал";
  }
  if (!targetUserId || targetUserId === request.demoUserId) return response.status(400).json({ error: "Объект жалобы не найден" });
  const id = nextId++;
  const createdAt = new Date().toISOString();
  const report = { id, reference: `BMC-${new Date().getUTCFullYear()}-${String(id).padStart(6, "0")}`, reporterId: request.demoUserId, reporterName: reporter.profile.name, targetKind, targetId, targetUserId, targetUserName: users.find((user) => user.id === targetUserId)?.profile.name, targetTitle, reason, status: "new", createdAt, dueAt: new Date(new Date(createdAt).setUTCHours(0, 0, 0, 0) + 21 * 86_400_000).toISOString(), statusHistory: [{ oldStatus: null, newStatus: "new", createdAt }], ...(request.reportContext ?? {}), ...(targetKind === "chat" ? { conversationMessages: structuredClone(state.messages[conversationKey(request.demoUserId, targetId)] ?? []) } : {}) };
  state.reports.unshift(report);
  if (targetKind === "user" && request.body?.blockUser) {
    state.blocks.push({ blockerId: request.demoUserId, blockedId: targetId, createdAt: new Date().toISOString() });
    state.follows = state.follows.filter((item) => ![item.followerId, item.targetId].every((id) => [request.demoUserId, targetId].includes(id)));
    state.friendships = state.friendships.filter((item) => ![item.userA, item.userB].every((id) => [request.demoUserId, targetId].includes(id)));
    state.communityMemberships = state.communityMemberships.filter((item) => ![item.communityId, item.memberId].every((id) => [request.demoUserId, targetId].includes(id)));
    state.friendRequests = state.friendRequests.filter((item) => ![item.fromId, item.toId].every((id) => [request.demoUserId, targetId].includes(id)));
    delete state.messages[conversationKey(request.demoUserId, targetId)];
  }
  response.status(201).json({ id: report.id, reference: report.reference, status: report.status, blocked: Boolean(request.body?.blockUser) });
});

router.get("/reports/mine", (request, response) => response.json({ reports: state.reports.filter((item) => item.reporterId === request.demoUserId) }));

router.post("/reports/:id/appeal", (request, response) => {
  const report = state.reports.find((item) => item.id === Number(request.params.id) && item.reporterId === request.demoUserId);
  const text = String(request.body?.text ?? "").trim();
  if (!report || !["satisfied", "rejected"].includes(report.status)) return response.status(409).json({ error: "Обжаловать можно только рассмотренное решение" });
  if (!text) return response.status(400).json({ error: "Опишите причины обжалования" });
  report.appealText = text; report.appealedAt = new Date().toISOString();
  response.status(201).json({ appealed: true });
});

router.delete("/social/blocks/:targetId", (request, response) => {
  const before = state.blocks.length;
  state.blocks = state.blocks.filter((item) => !(item.blockerId === request.demoUserId && item.blockedId === Number(request.params.targetId)));
  if (before === state.blocks.length) return response.status(404).json({ error: "Пользователь не был заблокирован" });
  response.json({ ok: true });
});

router.patch("/admin/reports/:id/processed", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const report = state.reports.find((item) => item.id === Number(request.params.id));
  if (!report) return response.status(404).json({ error: "Жалоба не найдена" });
  const motivatedResponse = String(request.body?.motivatedResponse ?? request.body?.reason ?? "").trim();
  if (!motivatedResponse) return response.status(400).json({ error: "Заполните мотивированный ответ" });
  report.statusHistory ??= []; report.statusHistory.push({ oldStatus: report.status, newStatus: "satisfied", createdAt: new Date().toISOString() });
  report.status = "satisfied"; report.motivatedResponse = motivatedResponse; report.responseAt = new Date().toISOString();
  response.json({ ok: true });
});

router.patch("/admin/reports/:id", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  const report = state.reports.find((item) => item.id === Number(request.params.id));
  const status = String(request.body?.status ?? "");
  const motivatedResponse = String(request.body?.motivatedResponse ?? "").trim();
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  if (!report) return response.status(404).json({ error: "Жалоба не найдена" });
  if (!["new", "reviewing", "satisfied", "rejected"].includes(status)) return response.status(400).json({ error: "Некорректный статус" });
  if (["satisfied", "rejected"].includes(status) && !motivatedResponse) return response.status(400).json({ error: "Заполните мотивированный ответ" });
  report.statusHistory ??= []; report.statusHistory.push({ oldStatus: report.status, newStatus: status, createdAt: new Date().toISOString() });
  report.status = status;
  if (["satisfied", "rejected"].includes(status)) { report.motivatedResponse = motivatedResponse; report.responseAt = new Date().toISOString(); }
  response.json({ ok: true });
});

router.post("/admin/reports/:id/delete-material", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  const report = state.reports.find((item) => item.id === Number(request.params.id));
  const reason = String(request.body?.reason ?? "").trim();
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  if (!report || !reason) return response.status(400).json({ error: "Укажите причину удаления" });
  if (report.targetKind === "event") state.events = state.events.filter((item) => item.id !== report.targetId);
  else if (report.targetKind === "occasion") state.occasions = state.occasions.filter((item) => item.id !== report.targetId);
  else users.forEach((user) => {
    if (report.targetKind === "book") { user.books = user.books.filter((item) => item.id !== report.targetId); user.authorBooks = (user.authorBooks ?? []).filter((item) => item.id !== report.targetId); }
    if (report.targetKind === "review") user.reviews = user.reviews.filter((item) => item.id !== report.targetId);
    if (report.targetKind === "excerpt") user.excerpts = (user.excerpts ?? []).filter((item) => item.id !== report.targetId);
    if (report.targetKind === "publisher_news") user.publisherNews = (user.publisherNews ?? []).filter((item) => item.id !== report.targetId);
  });
  const key = conversationKey(admin.id, report.targetUserId);
  (state.messages[key] ??= []).push({ id: nextId++, senderId: admin.id, mine: true, text: `Служба поддержки удалила ваш материал. Причина: ${reason}`, createdAt: new Date().toISOString(), time: "сейчас" });
  report.statusHistory ??= []; report.statusHistory.push({ oldStatus: report.status, newStatus: "satisfied", createdAt: new Date().toISOString() });
  report.status = "satisfied"; report.motivatedResponse = reason; report.responseAt = new Date().toISOString();
  response.json({ ok: true });
});

router.post("/admin/users/:id/suspension", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  const target = users.find((user) => user.id === Number(request.params.id) && !user.isAdmin);
  const reason = String(request.body?.reason ?? "").trim();
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  if (!target || !reason) return response.status(400).json({ error: "Укажите причину блокировки" });
  target.suspension = { permanent: Boolean(request.body?.permanent), until: request.body?.permanent ? undefined : new Date(Date.now() + Math.max(1, Number(request.body?.days) || 1) * 86400000).toISOString(), reason };
  const report = state.reports.find((item) => item.id === Number(request.body?.reportId));
  if (report) { report.statusHistory ??= []; report.statusHistory.push({ oldStatus: report.status, newStatus: "satisfied", createdAt: new Date().toISOString() }); report.status = "satisfied"; report.motivatedResponse = reason; report.responseAt = new Date().toISOString(); }
  response.json({ ok: true });
});

router.delete("/admin/users/:id/suspension", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const target = users.find((user) => user.id === Number(request.params.id));
  if (target) delete target.suspension;
  response.json({ ok: true });
});

router.get("/auth/totp/status", (request, response) => {
  const account = users.find((user) => user.id === request.demoUserId);
  if (!account?.isAdmin) return response.status(403).json({ error: "Настройка доступна только администратору" });
  response.json({ enabled: Boolean(account.totpEnabled), pending: Boolean(account.totpPendingSecret), recoveryCodesLeft: account.totpRecoveryCodes?.length ?? 0 });
});

router.post("/auth/totp/setup/start", async (request, response) => {
  const account = users.find((user) => user.id === request.demoUserId);
  if (!account?.isAdmin) return response.status(403).json({ error: "Настройка доступна только администратору" });
  if (String(request.body?.password ?? "") !== passwords.get(account.id)) return response.status(401).json({ error: "Неверный текущий пароль" });
  account.totpPendingSecret = generateTotpSecret();
  account.totpPendingExpiresAt = Date.now() + 600_000;
  const issuer = "Book Meet";
  const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account.email)}?secret=${account.totpPendingSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  const qrDataUrl = await QRCode.toDataURL(otpauth, { width: 260, margin: 2, color: { dark: "#153d66", light: "#ffffff" } });
  response.json({ secret: account.totpPendingSecret, qrDataUrl, expiresInSeconds: 600 });
});

router.post("/auth/totp/setup/confirm", (request, response) => {
  const account = users.find((user) => user.id === request.demoUserId);
  if (!account?.isAdmin) return response.status(403).json({ error: "Настройка доступна только администратору" });
  if (!account.totpPendingSecret || account.totpPendingExpiresAt <= Date.now()) return response.status(410).json({ error: "Время настройки истекло. Создайте новый QR-код" });
  if (!verifyTotp(account.totpPendingSecret, request.body?.code)) return response.status(400).json({ error: "Код не подошёл" });
  const recoveryCodes = generateRecoveryCodes();
  account.totpSecret = account.totpPendingSecret;
  account.totpPendingSecret = null;
  account.totpPendingExpiresAt = null;
  account.totpEnabled = true;
  account.totpRecoveryCodes = recoveryCodes.map(hashRecoveryCode);
  response.json({ enabled: true, recoveryCodes });
});

router.post("/auth/totp/recovery/regenerate", (request, response) => {
  const account = users.find((user) => user.id === request.demoUserId);
  if (!account?.isAdmin) return response.status(403).json({ error: "Настройка доступна только администратору" });
  if (String(request.body?.password ?? "") !== passwords.get(account.id) || !verifyTotp(account.totpSecret, request.body?.code)) return response.status(401).json({ error: "Пароль или одноразовый код не подошёл" });
  const recoveryCodes = generateRecoveryCodes();
  account.totpRecoveryCodes = recoveryCodes.map(hashRecoveryCode);
  response.json({ recoveryCodes });
});

router.post("/auth/totp/disable", (request, response) => {
  const account = users.find((user) => user.id === request.demoUserId);
  if (!account?.isAdmin) return response.status(403).json({ error: "Настройка доступна только администратору" });
  if (String(request.body?.password ?? "") !== passwords.get(account.id)) return response.status(401).json({ error: "Неверный текущий пароль" });
  const validCode = verifyTotp(account.totpSecret, request.body?.code) || recoveryCodeIndex(account.totpRecoveryCodes ?? [], request.body?.code) >= 0;
  if (!validCode) return response.status(401).json({ error: "Одноразовый или резервный код не подошёл" });
  account.totpSecret = null;
  account.totpEnabled = false;
  account.totpRecoveryCodes = [];
  response.json({ disabled: true });
});

router.put("/users/me/state", (request, response) => {
  const user = users.find((item) => item.id === request.demoUserId);
  if (!user) return response.status(404).json({ error: "Пользователь не найден" });
  const profile = request.body?.profile;
  if (!profile) return response.status(400).json({ error: "Профиль не передан" });
  const locale = requestLocale(request);
  const requestedUsernameValue = profile.username ?? request.body?.username;
  if (requestedUsernameValue !== undefined) {
    const username = normalizeUsername(requestedUsernameValue);
    const usernameError = usernameValidationError(username);
    if (usernameError) return response.status(400).json({ code: usernameError, error: authText(locale, usernameError === "USERNAME_RESERVED" ? "usernameReserved" : "usernameInvalid") });
    if (users.some((item) => item.id !== user.id && item.username === username)) return response.status(409).json({ code: "USERNAME_TAKEN", error: authText(locale, "usernameTaken") });
    user.username = username;
    user.usernameIsTemporary = false;
  }
  const allowedProfileTabs = new Set(["main", "author-books", "excerpts", "publisher-news", "library", "wishlist", "reviews", "events", "occasions", "friends", "admin", "settings"]);
  const switchingToPublisher = user.profile.type !== "Издатель" && profile?.type === "Издатель";
  profile.hiddenProfileTabs = Array.isArray(profile?.hiddenProfileTabs) ? [...new Set(profile.hiddenProfileTabs.filter((tab) => allowedProfileTabs.has(tab) && tab !== "main" && tab !== "settings"))] : [];
  const changesCommunitySemantics = user.profile.type !== profile?.type
    && (user.profile.type === "Сообщество" || profile?.type === "Сообщество");
  if (changesCommunitySemantics) {
    const hasRelationship = state.friendships.some((item) => [item.userA, item.userB].includes(user.id))
      || state.communityMemberships.some((item) => item.communityId === user.id || item.memberId === user.id)
      || state.friendRequests.some((item) => item.status === "pending" && (item.fromId === user.id || item.toId === user.id));
    if (hasRelationship) return response.status(409).json({ error: "Перед сменой типа профиля завершите дружбу, участие в сообществах и ожидающие заявки" });
  }
  const publisher = ["Издатель", "Сообщество"].includes(profile?.type);
  if (!String(profile?.name ?? "").trim() || !Number(profile?.cityId)) return response.status(400).json({ error: "Заполните обязательные поля" });
  if (!publisher && !/^\d{4}-\d{2}-\d{2}$/.test(String(profile?.birthDate ?? ""))) return response.status(400).json({ error: "Укажите корректную дату рождения" });
  if (!publisher) {
    const birth = new Date(`${profile.birthDate}T00:00:00Z`);
    const now = new Date();
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    if (now.getUTCMonth() < birth.getUTCMonth() || now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate()) age -= 1;
    if (!Number.isFinite(age) || age < 0 || age > 120) return response.status(400).json({ error: "Укажите корректную дату рождения" });
    profile.age = age;
  }
  if (publisher) {
    const required = profile.type === "Сообщество"
      ? [profile.communityType, profile.bio, profile.communityRules]
      : [profile.publisherWebsite, profile.bio, profile.publisherLegalName, profile.publisherBin, profile.publisherAccount, profile.publisherBik, profile.publisherBank, profile.publisherLegalAddress, profile.publisherPostalAddress];
    if (required.some((value) => !String(value ?? "").trim())) return response.status(400).json({ error: `Заполните обязательные поля ${profile.type === "Сообщество" ? "сообщества" : "издательства"}` });
    const currentApproved = user.profile.type === profile.type && user.profile.publisherStatus === "approved";
    profile.publisherStatus = currentApproved ? "approved" : "pending";
    if (profile.type === "Издатель") profile.publisherBin = String(profile.publisherBin).replace(/\D/g, "").slice(0, 12);
    else Object.assign(profile, { communityType: String(profile.communityType).trim().slice(0, 255), communityRules: String(profile.communityRules).trim(), communityIsClosed: Boolean(profile.communityIsClosed), publisherWebsite: "", publisherSalesLinks: [], publisherLegalName: "", publisherBin: "", publisherAccount: "", publisherBik: "", publisherBank: "", publisherLegalAddress: "", publisherPostalAddress: "" });
  } else {
    profile.publisherStatus = "not_required";
    profile.communityIsClosed = false;
  }
  if (switchingToPublisher) {
    state.friendRequests = state.friendRequests.filter((item) => !((item.fromId === user.id || item.toId === user.id) && !(item.fromId === user.id && users.find((entry) => entry.id === item.toId)?.profile.type === "Сообщество")));
    state.notifications = state.notifications.filter((item) => !(item.type === "friend_request" && (item.userId === user.id || item.actorId === user.id) && users.find((entry) => entry.id === item.userId)?.profile.type !== "Сообщество"));
  }
  if (profile) user.profile = structuredClone({ ...profile, homeView: "feed" });
  if (request.body?.avatarUrl !== undefined) user.avatarUrl = request.body.avatarUrl || undefined;
  if ((profile.type === "Читатель" || profile.type === "Блогер") && Array.isArray(request.body?.reviews)) user.reviews = structuredClone(request.body.reviews);
  if (["Читатель", "Писатель", "Блогер"].includes(profile.type) && Array.isArray(request.body?.excerpts)) {
    const excerpts = request.body.excerpts.map((item) => ({ ...item, previewText: String(item?.previewText ?? item?.text ?? "").trim(), text: String(item?.previewText ?? item?.text ?? "").trim() }));
    const invalidPublication = excerpts.some((item) => {
      if (!item.previewText) return true;
      if (Array.from(item.previewText).length <= 500) return false;
      const existing = (user.excerpts ?? []).find((entry) => entry.id === item.id);
      return !existing || String(existing.previewText ?? existing.text ?? "").trim() !== item.previewText;
    });
    if (invalidPublication) return response.status(400).json({ error: "Публикация должна содержать от 1 до 500 знаков" });
    user.excerpts = structuredClone(excerpts);
  }
  if (["Издатель", "Сообщество"].includes(profile.type) && profile.publisherStatus === "approved" && Array.isArray(request.body?.publisherNews)) user.publisherNews = structuredClone(request.body.publisherNews);
  response.json({ ok: true });
});

router.patch("/users/me/home-view", (request, response) => {
  const user = users.find((item) => item.id === request.demoUserId);
  const homeView = request.body?.homeView === "classic" ? "classic" : request.body?.homeView === "feed" ? "feed" : null;
  if (!user) return response.status(404).json({ error: "Пользователь не найден" });
  if (!homeView) return response.status(400).json({ error: "Некорректный вид главной страницы" });
  user.profile.homeView = homeView;
  response.json({ ok: true, homeView });
});

router.patch("/users/me/profile-complete", (request, response) => {
  const user = users.find((item) => item.id === request.demoUserId);
  const gate = demoProfileAccess(user);
  if (!gate.complete) return response.status(400).json({ error: "Сначала заполните имя, город и дату рождения", missingFields: gate.missing });
  if (user) user.profileCompleted = true;
  response.json({ ok: true, profileComplete: true });
});

router.get("/books/catalog", (request, response) => {
  const viewer = users.find((user) => user.id === request.demoUserId);
  const adultViewer = Boolean(viewer?.isAdmin || Number(viewer?.profile.age ?? -1) >= 18);
  const unique = new Map();
  for (const book of state.catalogBooks) {
    if (book.isAdult && !adultViewer) continue;
    const key = book.catalogBookId ?? book.isbn ?? `${book.author}|${book.title}`.toLocaleLowerCase("ru");
    const current = unique.get(key);
    const popularity = users.filter((user) => user.books.some((item) => (item.catalogBookId ?? item.id) === (book.catalogBookId ?? book.id))).length;
    if (!current || popularity > current.popularity) unique.set(key, { ...book, addedAt: book.addedAt ?? new Date().toISOString(), popularity });
  }
  response.json({ books: [...unique.values()] });
});

router.get("/books", (request, response) => {
  const query = String(request.query.q ?? "").trim();
  const tokens = query.normalize("NFKC").toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  const viewer = users.find((user) => user.id === request.demoUserId);
  const adultViewer = Boolean(viewer?.isAdmin || Number(viewer?.profile.age ?? -1) >= 18);
  response.json({ books: tokens.length ? state.catalogBooks.filter((book) => {
    const searchable = `${book.title} ${book.author} ${book.isbn ?? ""} ${book.publisher ?? ""}`.normalize("NFKC").toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ");
    return (adultViewer || !book.isAdult) && tokens.every((token) => searchable.includes(token));
  }).slice(0, 8) : [] });
});

router.post("/books", (request, response) => {
  const user = users.find((item) => item.id === request.demoUserId);
  const payload = structuredClone(request.body ?? {});
  const readerUsesExistingCanonical = Number(payload.useExistingId || 0) > 0 && !payload.isAuthor;
  if (payload.isAuthor && user.profile.type !== "Писатель" && !["Издатель", "Сообщество"].includes(user.profile.type)) return response.status(403).json({ error: "Добавлять книги могут только писатели и подтверждённые организации" });
  if (!payload.isAuthor && ["Издатель", "Сообщество"].includes(user.profile.type)) return response.status(403).json({ error: "Книги организации добавляются в специальной вкладке профиля" });
  const rating = Number(payload.rating);
  if (!payload.isAuthor && (payload.readingStatus ?? "read") === "read" && (!Number.isInteger(rating * 2) || rating < 0.5 || rating > 5)) return response.status(400).json({ error: "Оценка должна быть от 0,5 до 5 с шагом 0,5" });
  if (!payload.isAuthor && !readerUsesExistingCanonical) {
    try {
      for (const link of (payload.links ?? []).filter((item) => item?.label?.trim() && item?.url?.trim())) {
        const source = demoMarketplace(link.url);
        if (link.action === "Купить" && !["Flip", "Marwin/Меломан"].includes(source.name)) throw new Error("Для покупки поддерживаются только Flip и Marwin/Меломан");
        if ((link.action === "Читать" || link.action === "Слушать") && source.name !== "Яндекс.Книги") throw new Error("Для чтения и прослушивания поддерживаются только Яндекс.Книги");
        link.label = link.action === "Купить" ? source.name : "Яндекс.Книги";
      }
    } catch (error) { return response.status(400).json({ error: error.message }); }
  }
  const allBooks = state.catalogBooks;
  const normalizedIsbn = String(payload.isbn ?? "").replace(/\D/g, "");
  const sourceUrls = (payload.links ?? []).map((link) => String(link.url ?? ""));
  const exact = allBooks.find((item) => (normalizedIsbn && String(item.isbn ?? "").replace(/\D/g, "") === normalizedIsbn)
    || (item.links ?? []).some((link) => sourceUrls.includes(link.url))
    || Boolean(payload.flipUrl && item.flipUrl === payload.flipUrl));
  const id = Number(payload.useExistingId || exact?.id || payload.id || nextId++);
  const top3Requested = payload.top3 === true || Number(payload.topRank) > 0;
  if (top3Requested && !top3Eligibility({ isAuthor: (user.authorBooks ?? []).some((item) => item.id === id), readingStatus: payload.readingStatus ?? "read" }).allowed) return response.status(400).json({ error: "В TOP3 можно добавлять только прочитанные книги из своей библиотеки" });
  let topRank;
  if (!payload.isAuthor && (payload.readingStatus ?? "read") === "read" && top3Requested) {
    const topBooks = user.books.filter((item) => item.topRank && item.id !== id);
    if (topBooks.length >= 3) return response.status(409).json({ error: "В TOP3 уже добавлены три книги. Сначала снимите отметку с одной из них.", code: "TOP3_LIMIT" });
    topRank = nextTopRank(topBooks, id);
  }
  const canonical = allBooks.find((item) => item.id === id);
  if (readerUsesExistingCanonical && !canonical) return response.status(404).json({ error: "Выбранная книга не найдена" });
  const ownerFields = { rating, review: String(payload.shortReview ?? payload.review ?? ""), readMonth: payload.readMonth, readYear: payload.readYear, readingStatus: payload.readingStatus ?? "read", lastReadChapter: payload.lastReadChapter, readingComment: payload.readingComment, topRank };
  const book = canonical
    ? readerUsesExistingCanonical
      ? { ...canonical, ...ownerFields, id, catalogBookId: id }
      : { ...canonical, ...payload, id, catalogBookId: id, topRank, author: canonical.author, title: canonical.title, isbn: canonical.isbn || payload.isbn, publisher: canonical.publisher || payload.publisher, annotation: canonical.annotation, coverUrl: canonical.coverUrl || payload.coverUrl, links: [...(canonical.links ?? []), ...(payload.links ?? [])].filter((link, index, list) => list.findIndex((item) => item.url === link.url) === index) }
    : { ...payload, id, catalogBookId: id, topRank, links: payload.links ?? [] };
  const target = payload.isAuthor ? (user.authorBooks ??= []) : user.books;
  const index = target.findIndex((item) => item.id === id);
  if (index >= 0) target[index] = book; else target.unshift(book);
  const catalogIndex = state.catalogBooks.findIndex((item) => item.id === id);
  if (catalogIndex >= 0) {
    if (!readerUsesExistingCanonical) state.catalogBooks[catalogIndex] = { ...state.catalogBooks[catalogIndex], ...book, rating: 0, review: "", readingStatus: undefined, topRank: undefined };
  } else state.catalogBooks.push({ ...book, rating: 0, review: "", readingStatus: undefined, topRank: undefined });
  response.json({ ok: true, bookId: id, topRank });
});

function demoMarketplace(value) {
  const url = new URL(String(value ?? ""));
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "flip.kz" || host.endsWith(".flip.kz")) return { name: "Flip", url: url.toString(), suggestedAction: "Купить" };
  if (host === "meloman.kz" || host.endsWith(".meloman.kz") || host === "marwin.kz" || host.endsWith(".marwin.kz")) return { name: "Marwin/Меломан", url: url.toString(), suggestedAction: "Купить" };
  if (host === "books.yandex.kz" || host.endsWith(".books.yandex.kz")) return { name: "Яндекс.Книги", url: url.toString(), suggestedAction: /audio|listen/i.test(url.pathname + url.search) ? "Слушать" : "Читать" };
  throw new Error("Поддерживаются ссылки Flip, Marwin/Меломан и Яндекс.Книги");
}

function demoDecode(value) {
  return String(value ?? "").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function demoMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return demoDecode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)`, "i"))?.[1] ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"))?.[1]);
}

function demoWithoutAuthorPrefix(value, author) {
  const title = demoDecode(value);
  const match = title.match(/^(.+?)\s*:\s*(.+)$/);
  if (!match || !author) return title;
  const comparable = (part) => demoDecode(part).normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[\s.,;:()[\]{}'"’`-]+/g, "");
  return comparable(match[1]) === comparable(author) ? match[2].trim() : title;
}

function demoMarwinDescription(html) {
  return html.match(/class=["']product attribute description["'][^>]*>[\s\S]*?<div[^>]+class=["'][^"']*\bvalue\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]+class=["']product_rate["'])/i)?.[1] ?? "";
}

function demoProductAttribute(html, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = html.match(new RegExp(`<td[^>]+data-th=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1]
      ?? html.match(new RegExp(`<th[^>]*>\\s*${escaped}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1]
      ?? html.match(new RegExp(`<div[^>]+class=["'][^"']*\\bcell\\b[^"']*["'][^>]*>\\s*${escaped}\\s*<\\/div>\\s*<div[^>]+class=["'][^"']*\\bcell\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i"))?.[1]
      ?? html.match(new RegExp(`["']${escaped}["']\\s*:\\s*["']([^"']+)`, "i"))?.[1];
    if (value) return demoDecode(value);
  }
  return "";
}

function demoIsbn(value) {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized.length === 10 || normalized.length === 13 ? normalized : "";
}

async function demoBookProduct(value, flipOnly = false) {
  const marketplace = demoMarketplace(value);
  if (flipOnly && marketplace.name !== "Flip") throw new Error("Поддерживаются только ссылки Flip.kz");
  const result = await fetch(marketplace.url, { headers: { "user-agent": "Mozilla/5.0 BookMeet/1.0", "accept-language": "ru-KZ,ru;q=0.9" } });
  if (!result.ok) throw new Error(`${marketplace.name} не вернул карточку книги`);
  const html = await result.text();
  let product;
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const candidates = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      product = candidates.find((item) => {
        const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
        return types.includes("Product") || types.includes("Book");
      }) ?? product;
    } catch { /* ignore */ }
  }
  const pageTitle = demoDecode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const marwinTitleRaw = marketplace.name === "Marwin/Меломан" ? demoDecode(html.match(/<span[^>]+data-ui-id=["']page-title-wrapper["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]) : "";
  const marwinAuthor = marketplace.name === "Marwin/Меломан" ? demoDecode(html.match(/<td[^>]+data-th=["']Автор["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]) : "";
  const titleWithPrefix = demoDecode(marwinTitleRaw || product?.name || demoMeta(html, "og:title") || pageTitle.split(/\s+[—|]\s+/)[0])
    .replace(/^(?:Купить|Читать|Слушать)\s+(?:книгу|аудиокнигу)\s+/i, "")
    .replace(/\s+(?:в интернет-магазине.*|[-—|]\s*(?:Flip|Marwin|Меломан|Яндекс(?:\.Книги| Книги)).*)$/i, "");
  const title = demoWithoutAuthorPrefix(titleWithPrefix, marwinAuthor);
  const structuredAuthor = Array.isArray(product?.author) ? product.author[0]?.name ?? product.author[0] : product?.author?.name ?? product?.author;
  const embeddedAuthor = html.match(/["']authors?["']\s*:\s*(?:\[\s*\{\s*)?["'](?:name|title)["']\s*:\s*["']([^"']+)/i)?.[1] ?? html.match(/["']author["']\s*:\s*["']([^"']+)/i)?.[1];
  const parts = pageTitle.split(/\s+[—|]\s+/).map(demoDecode);
  const author = demoDecode(marwinAuthor || structuredAuthor || demoMeta(html, "book:author") || embeddedAuthor || (parts[0] === title ? parts[1] : ""));
  const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  if (!title || !author) throw new Error(`Не удалось определить название и автора книги на ${marketplace.name}`);
  const marwinDescription = marketplace.name === "Marwin/Меломан" ? demoMarwinDescription(html) : "";
  const isbn = demoIsbn(product?.isbn || product?.isbn13 || product?.isbn10 || product?.gtin13 || product?.gtin || demoProductAttribute(html, ["ISBN", "ISBN-13", "ISBN 13", "Штрихкод"]));
  const rawPublisher = product?.publisher;
  const publisher = demoDecode(Array.isArray(rawPublisher) ? rawPublisher.map((item) => item?.name ?? item).join(", ") : rawPublisher?.name ?? rawPublisher ?? demoProductAttribute(html, ["Издательство", "Издатель"]));
  return { marketplace: marketplace.name, productUrl: marketplace.url, title, author, isbn: isbn || undefined, publisher: publisher || undefined, annotation: demoDecode(product?.description || marwinDescription || demoMeta(html, "description") || demoMeta(html, "og:description")), coverUrl: (Array.isArray(product?.image) ? product.image[0] : product?.image) || demoMeta(html, "og:image"), price: Number(offers?.price) || undefined, currency: String(offers?.priceCurrency ?? "KZT"), suggestedAction: marketplace.suggestedAction };
}

async function demoPreviewCover(value) {
  if (!value) return "";
  const url = new URL(value);
  const allowedHost = (hostname) => {
    const host = hostname.toLowerCase();
    return host === "s.f.kz" || host.endsWith(".s.f.kz") || host === "simg.marwin.kz" || host === "api.bookmate.ru" || host === "books.yandex.kz";
  };
  if (!allowedHost(url.hostname)) return "";
  try {
    const result = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 BookMeet/1.0" } });
    if (!result.ok || !allowedHost(new URL(result.url).hostname)) return "";
    const content = Buffer.from(await result.arrayBuffer());
    const mime = String(result.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!mime.startsWith("image/") || content.length > 5 * 1024 * 1024) return "";
    return `data:${mime};base64,${content.toString("base64")}`;
  } catch {
    return "";
  }
}

router.post("/wishlist/preview", async (request, response) => {
  try { const product = await demoBookProduct(request.body?.productUrl, true); response.json({ product: { ...product, coverUrl: await demoPreviewCover(product.coverUrl) } }); }
  catch (error) { response.status(422).json({ error: error.message }); }
});

router.post("/books/preview", async (request, response) => {
  try {
    const product = await demoBookProduct(request.body?.productUrl);
    const allBooks = users.flatMap((user) => [...user.books, ...(user.authorBooks ?? [])]);
    const match = allBooks.find((book) => (product.isbn && book.isbn === product.isbn) || book.flipUrl === product.productUrl || (book.links ?? []).some((link) => link.url === product.productUrl));
    response.json({ product: match ? { ...product, catalogBookId: match.id, author: match.author, title: match.title, isbn: match.isbn || product.isbn, publisher: match.publisher || product.publisher, annotation: match.annotation || product.annotation, coverUrl: match.coverUrl || await demoPreviewCover(product.coverUrl) } : { ...product, coverUrl: await demoPreviewCover(product.coverUrl) } });
  }
  catch (error) { response.status(422).json({ error: error.message }); }
});

router.post("/wishlist", async (request, response) => {
  const owner = users.find((user) => user.id === request.demoUserId);
  if (owner?.profile.type !== "Читатель" && owner?.profile.type !== "Блогер") return response.status(403).json({ error: "Список «Хочу почитать!» доступен профилям читателей и блогеров" });
  let product;
  try { product = await demoBookProduct(request.body?.productUrl, true); }
  catch (error) { return response.status(400).json({ error: error.message }); }
  const allBooks = users.flatMap((user) => [...user.books, ...(user.authorBooks ?? [])]);
  const catalogBook = allBooks.find((book) => book.author.toLocaleLowerCase("ru") === product.author.toLocaleLowerCase("ru") && book.title.toLocaleLowerCase("ru") === product.title.toLocaleLowerCase("ru"));
  const catalogBookId = catalogBook?.id;
  const item = {
    id: nextId++, ownerId: owner.id, catalogBookId,
    author: product.author,
    title: product.title,
    genres: structuredClone(catalogBook?.genres ?? []),
    annotation: product.annotation || catalogBook?.annotation || "",
    coverUrl: product.coverUrl || catalogBook?.coverUrl,
    coverTone: catalogBook?.coverTone ?? request.body?.coverTone ?? "blue",
    marketplace: product.marketplace, productUrl: product.productUrl,
    pickupAddress: String(request.body?.pickupAddress ?? "").trim(),
    phone: String(request.body?.phone ?? "").trim(),
    price: product.price, priceCurrency: product.currency, priceCheckedAt: new Date().toISOString(), privateVisible: true,
  };
  if (!item.author || !item.title || !item.pickupAddress || !item.phone) return response.status(400).json({ error: "Заполните обязательные поля" });
  owner.wishBooks.unshift(item);
  response.status(201).json({ item });
});

router.get("/wishlist/:id/price", (request, response) => {
  const item = users.flatMap((user) => user.wishBooks ?? []).find((entry) => entry.id === Number(request.params.id));
  if (!item) return response.status(404).json({ error: "Карточка недоступна" });
  response.json({ price: item.price, currency: item.priceCurrency ?? "KZT", checkedAt: new Date().toISOString(), marketplace: item.marketplace });
});

router.post("/wishlist/:id/reserve", (request, response) => {
  const owner = users.find((user) => (user.wishBooks ?? []).some((entry) => entry.id === Number(request.params.id)));
  const item = owner?.wishBooks.find((entry) => entry.id === Number(request.params.id));
  const friends = owner && state.friendships.some((entry) => [entry.userA, entry.userB].includes(owner.id) && [entry.userA, entry.userB].includes(request.demoUserId));
  if (!item || !friends) return response.status(403).json({ error: "Список доступен только друзьям" });
  if (item.reservedByUserId && item.reservedByUserId !== request.demoUserId) return response.status(409).json({ error: "Подарок уже забронирован" });
  item.reservedByUserId = request.demoUserId; item.reservedAt = new Date().toISOString();
  notification(owner.id, request.demoUserId, "gift_reserved", "Подарок забронирован", `${users.find((user) => user.id === request.demoUserId)?.profile.name} забронировал(а) подарок «${item.title}».`, { materialKind: "wishlist", materialId: item.id });
  response.json({ checkoutUrl: item.productUrl, reservedByUserId: request.demoUserId });
});

router.delete("/wishlist/:id/reservation", (request, response) => {
  const owner = users.find((user) => user.id === request.demoUserId);
  const item = owner?.wishBooks.find((entry) => entry.id === Number(request.params.id));
  if (!item) return response.status(404).json({ error: "Карточка не найдена" });
  delete item.reservedByUserId; delete item.reservedAt;
  response.json({ ok: true });
});

router.delete("/wishlist/:id", (request, response) => {
  const owner = users.find((user) => user.id === request.demoUserId);
  const index = owner?.wishBooks.findIndex((entry) => entry.id === Number(request.params.id)) ?? -1;
  if (index < 0) return response.status(404).json({ error: "Книга не найдена" });
  owner.wishBooks.splice(index, 1);
  response.json({ ok: true });
});

router.get("/reactions", (request, response) => {
  response.json({ userIds: state.likes[`${request.query.kind}-${request.query.id}`] ?? [] });
});

router.post("/reactions", (request, response) => {
  const key = `${request.body.materialKind}-${request.body.materialId}`;
  const values = state.likes[key] ?? [];
  if (!values.includes(request.demoUserId)) values.push(request.demoUserId);
  state.likes[key] = values;
  response.json({ ok: true, userIds: values });
});

router.delete("/reactions", (request, response) => {
  const key = `${request.body.materialKind}-${request.body.materialId}`;
  state.likes[key] = (state.likes[key] ?? []).filter((id) => id !== request.demoUserId);
  response.json({ ok: true, userIds: state.likes[key] });
});

router.get("/saves", (request, response) => {
  const key = `${request.query.kind}-${request.query.id}`;
  response.json({ saved: Boolean((state.saves[key] ?? []).some((entry) => entry.userId === request.demoUserId)) });
});

router.post("/saves", (request, response) => {
  const key = `${request.body.materialKind}-${request.body.materialId}`;
  const entries = state.saves[key] ?? [];
  if (!entries.some((entry) => entry.userId === request.demoUserId)) entries.push({ userId: request.demoUserId, createdAt: new Date().toISOString() });
  state.saves[key] = entries;
  response.status(201).json({ ok: true });
});

router.delete("/saves", (request, response) => {
  const key = `${request.body.materialKind}-${request.body.materialId}`;
  state.saves[key] = (state.saves[key] ?? []).filter((entry) => entry.userId !== request.demoUserId);
  response.json({ ok: true });
});

router.get("/comments", (request, response) => {
  response.json({ comments: state.comments[`${request.query.kind}-${request.query.id}`] ?? [] });
});

router.get("/material-stats", (request, response) => {
  const commenters = {};
  const commentCounts = {};
  for (const [key, comments] of Object.entries(state.comments)) { commenters[key] = [...new Set(comments.map((comment) => comment.userId))]; commentCounts[key] = comments.length; }
  const savedMaterialRefs = Object.entries(state.saves).flatMap(([key, entries]) => {
    const entry = entries.find((item) => item.userId === request.demoUserId);
    if (!entry) return [];
    const [kind, id] = key.split(/-(?=\d+$)/);
    return [{ kind, id: Number(id), createdAt: entry.createdAt }];
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const saveCounts = Object.fromEntries(Object.entries(state.saves).map(([key, entries]) => [key, entries.length]));
  response.json({ commenters, commentCounts, savedMaterialRefs, saveCounts });
});

router.get("/admin/statistics", (request, response) => {
  const viewer = users.find((user) => user.id === request.demoUserId);
  if (!viewer?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const communityUsers = users.filter((user) => !user.isAdmin && !user.deletedAt && !user.purged);
  const usersByType = { "Читатель": 0, "Писатель": 0, "Блогер": 0, "Издатель": 0, "Сообщество": 0 };
  const cityCounts = new Map();
  for (const user of communityUsers) {
    if (Object.prototype.hasOwnProperty.call(usersByType, user.profile.type)) usersByType[user.profile.type] += 1;
    const city = String(user.profile.city ?? "").trim();
    if (city) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
  }
  const friendshipUsers = new Set(state.friendships.flatMap((item) => [item.userA, item.userB]));
  const wishlistBooks = communityUsers.flatMap((user) => user.wishBooks ?? []);
  response.json({
    totalUsers: communityUsers.length,
    usersByType,
    cities: [...cityCounts.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "ru")),
    books: new Set(communityUsers.flatMap((user) => [...user.books, ...(user.authorBooks ?? [])]).map((book) => book.catalogBookId ?? book.id)).size,
    reviews: communityUsers.reduce((total, user) => total + user.reviews.length, 0),
    publications: communityUsers.reduce((total, user) => total + (user.excerpts ?? []).length, 0),
    events: state.events.length,
    occasions: state.occasions.length,
    wishlistBooks: wishlistBooks.length,
    reservedGifts: wishlistBooks.filter((book) => book.reservedByUserId).length,
    friendshipUsers: friendshipUsers.size,
  });
});

router.post("/comments", (request, response) => {
  const key = `${request.body.materialKind}-${request.body.materialId}`;
  const comment = { id: nextId++, userId: request.demoUserId, text: String(request.body.body ?? ""), createdAt: new Date().toISOString() };
  (state.comments[key] ??= []).push(comment);
  response.json({ comment });
});

router.delete("/comments/:id", (request, response) => {
  const user = users.find((entry) => entry.id === request.demoUserId);
  const commentId = Number(request.params.id);
  for (const [key, comments] of Object.entries(state.comments)) {
    const comment = comments.find((entry) => entry.id === commentId);
    if (!comment) continue;
    if (comment.userId !== request.demoUserId && !user?.isAdmin) return response.status(403).json({ error: "Удалить комментарий может только его автор или администратор" });
    state.comments[key] = comments.filter((entry) => entry.id !== commentId);
    return response.json({ ok: true });
  }
  response.status(404).json({ error: "Комментарий не найден" });
});

router.post("/social/friend-requests", (request, response) => {
  const targetId = Number(request.body.targetId);
  const source = users.find((user) => user.id === request.demoUserId);
  const target = users.find((user) => user.id === targetId);
  if (!target) return response.status(404).json({ error: "Пользователь не найден" });
  if (target.isAdmin) return response.status(403).json({ error: "Службу поддержки нельзя добавить в друзья" });
  if (!canCreateFriendRequest(source?.profile.type, target.profile.type, { communityMembership: target.profile.type === "Сообщество" })) return response.status(403).json({ error: "Издательствам недоступны запросы дружбы" });
  if (source?.profile.type === "Сообщество") return response.status(403).json({ error: "Сообщество не может отправлять запросы дружбы" });
  const membership = target.profile.type === "Сообщество";
  if (membership && state.communityMemberships.some((item) => item.communityId === targetId && item.memberId === request.demoUserId)) return response.status(409).json({ error: "Вы уже состоите в сообществе" });
  if (membership && !target.profile.communityIsClosed) {
    state.friendRequests = state.friendRequests.filter((item) => !(item.status === "pending" && item.fromId === request.demoUserId && item.toId === targetId));
    state.notifications = state.notifications.filter((item) => !(item.userId === targetId && item.actorId === request.demoUserId && item.type === "friend_request"));
    state.communityMemberships.push({ communityId: targetId, memberId: request.demoUserId });
    const systemText = "Вы стали участником открытого сообщества и можете начать переписку";
    const key = conversationKey(request.demoUserId, targetId);
    (state.messages[key] ??= []).push({ id: nextId++, system: true, text: systemText, time: "сейчас" });
    notification(targetId, request.demoUserId, "friendship_started", "Новый участник", `${source?.profile.name} присоединился(ась) к открытому сообществу.`);
    notification(request.demoUserId, targetId, "friendship_started", "Вы вступили в сообщество", systemText);
    return response.status(201).json({ ok: true });
  }
  if (state.friendRequests.some((item) => item.status === "pending" && item.fromId === request.demoUserId && item.toId === targetId)) return response.status(409).json({ error: membership ? "Заявка на вступление уже отправлена" : "Предложение уже отправлено" });
  const entry = { id: nextId++, fromId: request.demoUserId, toId: targetId, status: "pending", message: String(request.body.message ?? "") };
  state.friendRequests.push(entry);
  notification(targetId, request.demoUserId, "friend_request", membership ? "Новая заявка" : "Новый друг", membership ? `${source?.profile.name} хочет присоединиться к сообществу.` : `${source?.profile.name} хочет добавить вас в друзья.`);
  response.json({ ok: true, request: entry });
});

router.delete("/social/friend-requests/:targetId", (request, response) => {
  const targetId = Number(request.params.targetId);
  const before = state.friendRequests.length;
  state.friendRequests = state.friendRequests.filter((item) => !(item.status === "pending" && item.fromId === request.demoUserId && item.toId === targetId));
  if (state.friendRequests.length === before) return response.status(404).json({ error: "Предложение дружбы не найдено" });
  state.notifications = state.notifications.filter((item) => !(item.userId === targetId && item.actorId === request.demoUserId && item.type === "friend_request"));
  response.json({ ok: true });
});

router.post("/social/friends/:targetId/accept", (request, response) => {
  const targetId = Number(request.params.targetId);
  const pending = state.friendRequests.find((item) => item.status === "pending" && item.fromId === targetId && item.toId === request.demoUserId);
  if (!pending) return response.status(404).json({ error: "Предложение дружбы не найдено" });
  const acceptor = users.find((user) => user.id === request.demoUserId);
  const requester = users.find((user) => user.id === targetId);
  if (!canCreateFriendRequest(acceptor?.profile.type, requester?.profile.type, { communityMembership: acceptor?.profile.type === "Сообщество" })) return response.status(403).json({ error: "Издательствам недоступны запросы дружбы" });
  pending.status = "accepted";
  const isCommunity = users.find((user) => user.id === request.demoUserId)?.profile.type === "Сообщество";
  if (isCommunity) {
    if (!state.communityMemberships.some((item) => item.communityId === request.demoUserId && item.memberId === targetId)) state.communityMemberships.push({ communityId: request.demoUserId, memberId: targetId });
  } else {
    if (!state.friendships.some((item) => [item.userA, item.userB].includes(targetId) && [item.userA, item.userB].includes(request.demoUserId))) state.friendships.push({ userA: targetId, userB: request.demoUserId });
    for (const follow of [{ followerId: targetId, targetId: request.demoUserId }, { followerId: request.demoUserId, targetId }]) {
      if (!state.follows.some((item) => item.followerId === follow.followerId && item.targetId === follow.targetId)) state.follows.push(follow);
    }
  }
  const key = conversationKey(targetId, request.demoUserId);
  const community = isCommunity;
  (state.messages[key] ??= []).push({ id: nextId++, system: true, text: community ? "Заявка принята. Теперь вы участник сообщества и можете начать переписку" : "Теперь вы друзья и можете начать переписку", time: "сейчас" });
  response.json({ ok: true });
});

router.post("/social/friends/:targetId/reject", (request, response) => {
  const pending = state.friendRequests.find((item) => item.status === "pending" && item.fromId === Number(request.params.targetId) && item.toId === request.demoUserId);
  if (pending) { pending.status = "rejected"; pending.comment = String(request.body.comment ?? ""); }
  response.json({ ok: true });
});

router.delete("/social/friends/:targetId", (request, response) => {
  const targetId = Number(request.params.targetId);
  const communityId = users.find((user) => user.id === request.demoUserId)?.profile.type === "Сообщество" ? request.demoUserId : users.find((user) => user.id === targetId)?.profile.type === "Сообщество" ? targetId : null;
  if (communityId) state.communityMemberships = state.communityMemberships.filter((item) => !(item.communityId === communityId && item.memberId === (communityId === targetId ? request.demoUserId : targetId)));
  else state.friendships = state.friendships.filter((item) => !([item.userA, item.userB].includes(targetId) && [item.userA, item.userB].includes(request.demoUserId)));
  response.json({ ok: true });
});

router.post("/social/follows", (request, response) => {
  const targetId = Number(request.body.targetId);
  const target = users.find((user) => user.id === targetId);
  if (!target) return response.status(404).json({ error: "Пользователь не найден" });
  if (target.isAdmin) return response.status(403).json({ error: "На службу поддержки нельзя подписаться" });
  if (!state.follows.some((item) => item.followerId === request.demoUserId && item.targetId === targetId)) state.follows.push({ followerId: request.demoUserId, targetId });
  response.json({ ok: true });
});

router.delete("/social/follows/:targetId", (request, response) => {
  const targetId = Number(request.params.targetId);
  state.follows = state.follows.filter((item) => !(item.followerId === request.demoUserId && item.targetId === targetId));
  state.notifications = state.notifications.filter((item) => !(item.userId === targetId && item.actorId === request.demoUserId && item.type === "new_follower"));
  response.json({ ok: true });
});

router.post("/social/messages", (request, response) => {
  const targetId = Number(request.body.targetId);
  const sender = users.find((user) => user.id === request.demoUserId);
  const target = users.find((user) => user.id === targetId);
  if (!target) return response.status(404).json({ error: "Пользователь не найден" });
  const blockedPair = state.blocks.some((item) => [item.blockerId, item.blockedId].includes(request.demoUserId) && [item.blockerId, item.blockedId].includes(targetId));
  if (blockedPair) return response.status(403).json({ error: "Взаимодействие с пользователем недоступно" });
  const friends = state.friendships.some((item) => [item.userA, item.userB].includes(request.demoUserId) && [item.userA, item.userB].includes(targetId));
  const membership = state.communityMemberships.some((item) => (item.communityId === request.demoUserId && item.memberId === targetId) || (item.communityId === targetId && item.memberId === request.demoUserId));
  if (!canMessagePair({ friends, communityMembers: membership, hasAdmin: Boolean(sender?.isAdmin || target?.isAdmin), firstProfileType: sender?.profile.type, secondProfileType: target?.profile.type })) return response.status(403).json({ error: "Переписка доступна только друзьям, участникам сообщества, издательствам и службе поддержки" });
  const body = String(request.body.body ?? "").trim();
  const attachment = request.body.attachment && Number(request.body.attachment.id) ? { kind: String(request.body.attachment.kind), id: Number(request.body.attachment.id) } : undefined;
  if (!body && !attachment) return response.status(400).json({ error: "Сообщение пусто" });
  const message = { id: nextId++, senderId: request.demoUserId, mine: true, unread: true, text: body, attachment, time: "сейчас" };
  (state.messages[conversationKey(request.demoUserId, targetId)] ??= []).push(message);
  notification(targetId, request.demoUserId, "new_message", "Новое сообщение", message.text);
  response.json({ ok: true, message });
});

router.patch("/social/messages/:targetId/read", (request, response) => {
  const key = conversationKey(request.demoUserId, Number(request.params.targetId));
  (state.messages[key] ?? []).forEach((item) => { if (item.senderId !== request.demoUserId) item.unread = false; });
  state.notifications.forEach((item) => { if (item.userId === request.demoUserId && item.actorId === Number(request.params.targetId) && item.type === "new_message") item.unread = false; });
  response.json({ ok: true });
});

router.post("/events", (request, response) => {
  const creator = users.find((user) => user.id === request.demoUserId);
  const linkedBookIds = Array.from(new Set((request.body.linkedBookIds ?? []).map(Number).filter(Boolean)));
  const catalog = state.catalogBooks;
  const linkedBooks = linkedBookIds.map((id) => catalog.find((book) => book.id === id)).filter(Boolean).map((book) => ({ id: book.id, title: book.title, author: book.author, annotation: book.annotation, coverUrl: book.coverUrl, coverTone: book.coverTone }));
  const event = { id: nextId++, creatorId: request.demoUserId, creatorName: creator?.isAdmin ? "" : creator?.profile.name ?? "", title: String(request.body.title), summary: String(request.body.summary), description: String(request.body.description), isAdult: Boolean(request.body.isAdult), date: String(request.body.date), time: String(request.body.time), city: String(request.body.city), cityId: ["Казахстан", "Онлайн"].includes(String(request.body.city)) ? undefined : Number(request.body.cityId) || undefined, address: String(request.body.address), mapUrl: String(request.body.mapUrl ?? ""), detailsUrl: String(request.body.detailsUrl ?? ""), linkedBookIds, linkedBooks, linkedBookId: linkedBookIds[0], bookTitle: linkedBooks[0]?.title, bookAuthor: linkedBooks[0]?.author, bookAnnotation: linkedBooks[0]?.annotation, bookCoverUrl: linkedBooks[0]?.coverUrl, bookCoverTone: linkedBooks[0]?.coverTone, status: "pending", moderationNote: "", organizerName: creator?.isAdmin ? "" : creator?.profile.name, createdAt: new Date().toISOString() };
  if (!event.city || (!["Казахстан", "Онлайн"].includes(event.city) && !event.address)) return response.status(400).json({ error: "Укажите место события" });
  state.events.push(event);
  notification(request.demoUserId, request.demoUserId, "event_submitted", "Событие на модерации", `Событие «${event.title}» отправлено на модерацию.`, { materialKind: "event", materialId: event.id });
  response.status(201).json({ event });
});

router.get("/events/:id/attendees", (request, response) => {
  const event = state.events.find((item) => item.id === Number(request.params.id));
  if (!event) return response.status(404).json({ error: "Событие не найдено" });
  const pageSize = 8;
  const attendeeUsers = (event.reminderUserIds ?? []).map((id) => users.find((user) => user.id === id)).filter(Boolean);
  const pageCount = Math.max(1, Math.ceil(attendeeUsers.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(request.query.page) || 1)));
  const attendees = attendeeUsers.slice((page - 1) * pageSize, page * pageSize).map((user) => ({ id: user.id, name: user.profile.name, type: user.profile.type, city: user.profile.city, initials: user.initials, color: user.color, avatarUrl: user.avatarUrl }));
  response.json({ attendees, page, pageCount, total: attendeeUsers.length });
});

router.post("/events/:id/reminder", (request, response) => {
  const event = state.events.find((item) => item.id === Number(request.params.id) && item.status === "published");
  if (!event) return response.status(404).json({ error: "Событие не найдено" });
  event.reminderSet = true;
  event.reminderUserIds = Array.from(new Set([...(event.reminderUserIds ?? []), request.demoUserId]));
  event.reminderCount = event.reminderUserIds.length;
  response.status(201).json({ ok: true });
});

router.delete("/events/:id/reminder", (request, response) => {
  const event = state.events.find((item) => item.id === Number(request.params.id));
  if (!event?.reminderSet) return response.status(404).json({ error: "Напоминание не найдено" });
  event.reminderSet = false;
  event.reminderUserIds = (event.reminderUserIds ?? []).filter((id) => id !== request.demoUserId);
  event.reminderCount = event.reminderUserIds.length;
  response.json({ ok: true });
});

router.patch("/events/:id", (request, response) => {
  const event = state.events.find((item) => item.id === Number(request.params.id) && item.creatorId === request.demoUserId);
  if (!event) return response.status(404).json({ error: "Событие не найдено" });
  if (event.status !== "needs_changes") return response.status(409).json({ error: "Редактировать можно только событие, отправленное на доработку" });
  Object.assign(event, request.body, { status: "pending", moderationNote: "" });
  response.json({ event });
});

router.patch("/admin/events/:id", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const event = state.events.find((item) => item.id === Number(request.params.id));
  if (!event) return response.status(404).json({ error: "Событие не найдено" });
  const action = request.body.action;
  if (action === "edit") Object.assign(event, request.body.event);
  else { event.status = action === "accept" ? "published" : action === "revision" ? "needs_changes" : "rejected"; event.moderationNote = String(request.body.note ?? ""); }
  response.json({ ok: true });
});

router.post("/occasions", (request, response) => {
  const creator = users.find((user) => user.id === request.demoUserId);
  if (["Издатель", "Сообщество"].includes(creator?.profile.type)) return response.status(403).json({ error: "Организационные профили не могут создавать поводы познакомиться" });
  if (hasMultipleOccasionCities(request.body)) return response.status(400).json({ error: "Для повода можно выбрать только один город" });
  const catalog = state.catalogBooks;
  const linkedBook = catalog.find((book) => book.id === Number(request.body.linkedBookId));
  const occasion = { id: nextId++, creatorId: request.demoUserId, type: request.body.type, primaryText: String(request.body.primaryText ?? ""), audienceText: String(request.body.audienceText ?? ""), isAdult: Boolean(request.body.isAdult), targetGender: request.body.targetGender, targetCities: structuredClone(request.body.targetCities ?? []), targetProfileType: request.body.targetProfileType, meetingDate: request.body.type === "invite" ? String(request.body.meetingDate ?? "") : undefined, meetingStartTime: request.body.type === "invite" ? String(request.body.meetingStartTime ?? "") || undefined : undefined, meetingEndTime: request.body.type === "invite" ? String(request.body.meetingEndTime ?? "") || undefined : undefined, meetingCity: request.body.type === "invite" ? String(request.body.meetingCity ?? request.body.targetCities?.[0] ?? "") : undefined, meetingCityId: ["Казахстан", "Онлайн"].includes(String(request.body.meetingCity)) ? undefined : Number(request.body.meetingCityId) || undefined, meetingAddress: request.body.type === "invite" ? String(request.body.meetingAddress ?? "") : undefined, meetingMapUrl: request.body.type === "invite" ? String(request.body.meetingMapUrl ?? "") : undefined, linkedBookId: linkedBook?.id, linkedBooks: linkedBook ? [{ id: linkedBook.id, title: linkedBook.title, author: linkedBook.author, annotation: linkedBook.annotation, coverUrl: linkedBook.coverUrl, coverTone: linkedBook.coverTone }] : [], status: "pending", moderationNote: "", creatorName: creator?.profile.name ?? "", createdAt: new Date().toISOString() };
  if (!occasion.type || !occasion.primaryText || !occasion.audienceText) return response.status(400).json({ error: "Заполните все поля повода для знакомства" });
  if (occasion.type === "invite" && (!/^\d{4}-\d{2}-\d{2}$/.test(occasion.meetingDate) || occasion.meetingDate <= new Date().toISOString().slice(0, 10))) return response.status(400).json({ error: "Выберите будущую дату встречи" });
  if (occasion.type === "invite" && occasion.meetingEndTime && !occasion.meetingStartTime) return response.status(400).json({ error: "Время завершения можно указать только после времени начала" });
  if (occasion.type === "invite" && occasion.meetingCity && !["Казахстан", "Онлайн"].includes(occasion.meetingCity) && !occasion.meetingAddress) return response.status(400).json({ error: "Укажите место встречи" });
  if (occasion.type === "discuss" && !occasion.linkedBookId) return response.status(400).json({ error: "Выберите книгу для обсуждения" });
  state.occasions.push(occasion);
  notification(request.demoUserId, request.demoUserId, "event_submitted", "Повод на модерации", "Повод для знакомства отправлен на модерацию.", { materialKind: "occasion", materialId: occasion.id });
  response.status(201).json({ occasion });
});

router.patch("/occasions/:id", (request, response) => {
  const occasion = state.occasions.find((item) => item.id === Number(request.params.id) && item.creatorId === request.demoUserId);
  if (!occasion) return response.status(404).json({ error: "Повод не найден" });
  if (occasion.status !== "needs_changes") return response.status(409).json({ error: "Редактировать можно только повод, отправленный на доработку" });
  if (hasMultipleOccasionCities(request.body)) return response.status(400).json({ error: "Для повода можно выбрать только один город" });
  Object.assign(occasion, request.body, { status: "pending", moderationNote: "" });
  response.json({ occasion });
});

router.patch("/admin/occasions/:id", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const occasion = state.occasions.find((item) => item.id === Number(request.params.id));
  if (!occasion) return response.status(404).json({ error: "Повод не найден" });
  const action = request.body.action;
  if (action === "edit") {
    if (hasMultipleOccasionCities(request.body.occasion)) return response.status(400).json({ error: "Для повода можно выбрать только один город" });
    Object.assign(occasion, request.body.occasion);
  }
  else { occasion.status = action === "accept" ? "published" : action === "revision" ? "needs_changes" : "rejected"; occasion.moderationNote = String(request.body.note ?? ""); }
  response.json({ ok: true });
});

router.patch("/admin/publishers/:id", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const publisher = users.find((user) => user.id === Number(request.params.id) && ["Издатель", "Сообщество"].includes(user.profile.type));
  if (!publisher) return response.status(404).json({ error: "Профиль организации не найден" });
  const statuses = { accept: "approved", revision: "needs_changes", reject: "rejected" };
  const status = statuses[request.body?.action];
  if (!status) return response.status(400).json({ error: "Неизвестное действие модерации" });
  publisher.profile.publisherStatus = status;
  publisher.profile.publisherModerationNote = String(request.body?.note ?? "");
  const organization = publisher.profile.type === "Сообщество" ? "сообщества" : "издательства";
  notification(publisher.id, admin.id, "event_moderation", status === "approved" ? `Профиль ${organization} подтверждён` : status === "needs_changes" ? `Профиль ${organization} требует доработки` : `Профиль ${organization} отклонён`, publisher.profile.publisherModerationNote || "Статус профиля организации изменён.");
  response.json({ ok: true });
});

router.delete("/admin/materials/:kind/:id", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const id = Number(request.params.id);
  const kind = String(request.params.kind);
  if (kind === "event") state.events = state.events.filter((item) => item.id !== id);
  else if (kind === "occasion") state.occasions = state.occasions.filter((item) => item.id !== id);
  else if (kind === "book") users.forEach((user) => { user.books = user.books.filter((item) => item.id !== id); user.authorBooks = user.authorBooks.filter((item) => item.id !== id); user.reviews = user.reviews.filter((item) => item.bookId !== id); user.excerpts = user.excerpts.map((item) => item.bookId === id ? { ...item, bookId: undefined } : item); });
  else if (kind === "review") users.forEach((user) => { user.reviews = user.reviews.filter((item) => item.id !== id); });
  else if (kind === "excerpt") users.forEach((user) => { user.excerpts = user.excerpts.filter((item) => item.id !== id); });
  else return response.status(400).json({ error: "Некорректный материал" });
  response.json({ ok: true });
});

router.patch("/notifications/read-all", (request, response) => {
  state.notifications.forEach((item) => { if (item.userId === request.demoUserId) item.unread = false; });
  response.json({ ok: true });
});

router.patch("/notifications/:id/read", (request, response) => {
  const item = state.notifications.find((notificationItem) => notificationItem.id === Number(request.params.id) && notificationItem.userId === request.demoUserId);
  if (item) item.unread = false;
  response.json({ ok: true });
});

export default router;
