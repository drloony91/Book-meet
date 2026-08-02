import { Router } from "express";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, recoveryCodeIndex, verifyTotp } from "./security.js";

const router = Router();
const sessions = new Map();
const passwords = new Map([
  [1, process.env.TEST1_PASSWORD || "testtest1"],
  [2, process.env.PUBLISHER_TEST_PASSWORD || "publisher2026"],
]);
let nextId = 100;

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
      type: "Читатель",
      gender: "Мужской",
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
    reviews: [],
    excerpts: [],
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
      city: "",
      type: "Издатель",
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
  messages: {},
  friendRequests: [],
  friendships: [],
  follows: [],
  blocks: [],
  reports: [],
  notifications: [],
  likes: {},
  comments: {},
  events: [{
    id: 41, creatorId: 2, title: "Встреча с авторами издательства «Тест»",
    summary: "Разговор о новых казахстанских книгах и автограф-сессия.",
    description: "Познакомимся с авторами осенних новинок и обсудим, как рождаются современные книги.",
    date: "2026-12-12", time: "18:30", city: "Астана", cityId: 1,
    address: "проспект Республики, 1", mapUrl: "", detailsUrl: "",
    status: "published", moderationNote: "", pinned: false, createdAt: new Date().toISOString(),
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
  if (user?.suspension && (user.suspension.permanent || new Date(user.suspension.until).getTime() > Date.now())) return response.status(423).json({ suspended: true, ...user.suspension });
  if (user?.suspension) delete user.suspension;
  request.demoUserId = userId;
  next();
}

function bootstrap(userId) {
  const viewer = users.find((user) => user.id === userId);
  const relatedBlocks = state.blocks.filter((block) => block.blockerId === userId || block.blockedId === userId);
  const blockedByUserIds = relatedBlocks.filter((block) => block.blockedId === userId).map((block) => block.blockerId);
  const visibleUsers = users.filter((user) => user.profile.type !== "Издатель"
    || user.profile.publisherStatus === "approved"
    || user.id === userId
    || viewer?.isAdmin).filter((user) => viewer?.isAdmin || user.id === userId || !blockedByUserIds.includes(user.id)).map((user) => {
    const friend = state.friendships.some((entry) => [entry.userA, entry.userB].includes(user.id) && [entry.userA, entry.userB].includes(userId));
    const privateVisible = user.id === userId || friend;
    const profile = user.id === userId || viewer?.isAdmin ? user.profile : {
      ...user.profile,
      publisherLegalName: undefined, publisherBin: undefined, publisherAccount: undefined,
      publisherBik: undefined, publisherBank: undefined, publisherLegalAddress: undefined,
      publisherPostalAddress: undefined, publisherModerationNote: undefined,
    };
    return { ...user, blockedByMe: relatedBlocks.some((block) => block.blockerId === userId && block.blockedId === user.id), profile, wishBooks: (user.wishBooks ?? []).map((item) => privateVisible ? { ...item, productUrl: user.id === userId ? item.productUrl : undefined, privateVisible: true } : { id: item.id, ownerId: item.ownerId, catalogBookId: item.catalogBookId, author: item.author, title: item.title, genres: item.genres, annotation: item.annotation, coverUrl: item.coverUrl, coverTone: item.coverTone, marketplace: item.marketplace, reservedByUserId: item.reservedByUserId, privateVisible: false }) };
  });
  return structuredClone({ activeUserId: userId, profileCompleted: viewer?.profileCompleted !== false, users: visibleUsers, ...state, blocks: relatedBlocks, blockedByUserIds, reports: viewer?.isAdmin ? state.reports : [], events: state.events.filter((item) => viewer?.isAdmin || item.status === "published" || item.creatorId === userId), occasions: state.occasions.filter((item) => viewer?.isAdmin || item.creatorId === userId || item.status === "published" && (item.targetGender === "Все" || item.targetGender === viewer?.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === viewer?.profile.type)) });
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

router.post("/auth/login", (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLocaleLowerCase("en");
  const password = String(request.body?.password ?? "");
  const code = String(request.body?.totp ?? "");
  const account = users.find((user) => user.email?.toLocaleLowerCase("en") === email);
  if (!account || password !== passwords.get(account.id)) return response.status(401).json({ error: "Неверный e-mail или пароль" });
  if (account.suspension && (account.suspension.permanent || new Date(account.suspension.until).getTime() > Date.now())) return response.status(423).json({ suspended: true, ...account.suspension });
  if (account.totpEnabled && !code) return response.status(202).json({ requiresTotp: true });
  if (account.totpEnabled && !verifyTotp(account.totpSecret, code)) {
    const recoveryIndex = recoveryCodeIndex(account.totpRecoveryCodes ?? [], code);
    if (recoveryIndex < 0) return response.status(401).json({ error: "Неверный одноразовый или резервный код" });
    account.totpRecoveryCodes.splice(recoveryIndex, 1);
  }
  const token = randomBytes(24).toString("hex");
  sessions.set(token, account.id);
  response.setHeader("Set-Cookie", `book_meet_demo=${token}; Path=/; HttpOnly; SameSite=Lax`);
  response.json(bootstrap(account.id));
});

const demoCities = ["Астана", "Алматы", "Шымкент", "Караганда", "Актобе", "Атырау", "Павлодар", "Костанай", "Тараз", "Бишкек", "Ташкент", "Минск", "Москва", "Ереван", "Баку"];
router.get("/cities", (request, response) => {
  const query = String(request.query.q ?? "").trim().toLocaleLowerCase("ru");
  response.json({ cities: demoCities.filter((city) => city.toLocaleLowerCase("ru").includes(query)).map((name, index) => ({ id: index + 1, name, countryCode: "", country: name === "Астана" || name === "Алматы" ? "Казахстан" : "СНГ" })) });
});

router.post("/auth/register", (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLocaleLowerCase("en");
  const password = String(request.body?.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return response.status(400).json({ error: "Укажите корректный e-mail и пароль не короче 8 знаков" });
  if (users.some((user) => user.email?.toLocaleLowerCase("en") === email)) return response.status(409).json({ error: "Профиль с таким e-mail уже существует" });
  const displayName = email.split("@")[0];
  const user = { id: nextId++, email, profileCompleted: false, username: displayName, initials: displayName.slice(0, 2).toLocaleUpperCase("ru"), color: "blue", joined: "сегодня", joinedAt: new Date().toISOString(), profile: { name: displayName, city: "", type: "Читатель", gender: "Не указан", bio: "", authorInfluences: "", writingThemes: "", weekend: "", joy: "", talk: "", strangerMessage: "", favoriteGenres: [], dislikedGenres: [] }, books: [], authorBooks: [], reviews: [], excerpts: [], wishBooks: [] };
  users.push(user); passwords.set(user.id, password); const token = randomBytes(24).toString("hex"); sessions.set(token, user.id); response.setHeader("Set-Cookie", `book_meet_demo=${token}; Path=/; HttpOnly; SameSite=Lax`); response.status(201).json(bootstrap(user.id));
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
  if (user?.suspension && (user.suspension.permanent || new Date(user.suspension.until).getTime() > Date.now())) return response.status(423).json({ suspended: true, ...user.suspension });
  response.json(bootstrap(userId));
});

router.get("/bootstrap/:section", (request, response) => {
  const userId = currentUserId(request);
  if (!userId) return response.status(401).json({ error: "Требуется вход" });
  const user = users.find((item) => item.id === userId);
  if (user?.suspension && (user.suspension.permanent || new Date(user.suspension.until).getTime() > Date.now())) return response.status(423).json({ suspended: true, ...user.suspension });
  const keys = {
    session: ["activeUserId", "profileCompleted"],
    catalog: ["activeUserId", "users", "events", "occasions"],
    social: ["activeUserId", "blocks", "blockedByUserIds", "friendRequests", "friendships", "follows", "notifications", "messages", "likes"],
    moderation: ["activeUserId", "reports"],
  }[request.params.section];
  if (!keys) return response.status(404).json({ error: "Неизвестный набор данных" });
  const data = bootstrap(userId);
  response.json(Object.fromEntries(keys.map((key) => [key, data[key]])));
});

router.use(requireUser);

router.use((request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)
    || request.path === "/users/me/state"
    || request.path === "/users/me/profile-complete"
    || request.path === "/auth/logout") return next();
  const user = users.find((item) => item.id === request.demoUserId);
  if (user?.profile.type === "Издатель" && user.profile.publisherStatus !== "approved") {
    return response.status(403).json({ error: "Профиль издательства ожидает официального подтверждения" });
  }
  next();
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
  const report = { id: nextId++, reporterId: request.demoUserId, reporterName: reporter.profile.name, targetKind, targetId, targetUserId, targetUserName: users.find((user) => user.id === targetUserId)?.profile.name, targetTitle, reason, status: "new", createdAt: new Date().toISOString(), ...(request.reportContext ?? {}), ...(targetKind === "chat" ? { conversationMessages: structuredClone(state.messages[conversationKey(request.demoUserId, targetId)] ?? []) } : {}) };
  state.reports.unshift(report);
  if (targetKind === "user" && request.body?.blockUser) {
    state.blocks.push({ blockerId: request.demoUserId, blockedId: targetId, createdAt: new Date().toISOString() });
    state.follows = state.follows.filter((item) => ![item.followerId, item.targetId].every((id) => [request.demoUserId, targetId].includes(id)));
    state.friendships = state.friendships.filter((item) => ![item.userA, item.userB].every((id) => [request.demoUserId, targetId].includes(id)));
    state.friendRequests = state.friendRequests.filter((item) => ![item.fromId, item.toId].every((id) => [request.demoUserId, targetId].includes(id)));
    delete state.messages[conversationKey(request.demoUserId, targetId)];
  }
  response.status(201).json({ id: report.id, blocked: Boolean(request.body?.blockUser) });
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
  report.status = "reviewed";
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
  report.status = "reviewed";
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
  if (report) report.status = "reviewed";
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
  const publisher = profile?.type === "Издатель";
  if (!String(profile?.name ?? "").trim() || !Number(profile?.cityId)) return response.status(400).json({ error: "Заполните обязательные поля" });
  if (publisher) {
    const required = [profile.publisherWebsite, profile.bio, profile.publisherLegalName, profile.publisherBin, profile.publisherAccount, profile.publisherBik, profile.publisherBank, profile.publisherLegalAddress, profile.publisherPostalAddress];
    if (required.some((value) => !String(value ?? "").trim())) return response.status(400).json({ error: "Заполните обязательные поля издательства" });
    const currentApproved = user.profile.type === "Издатель" && user.profile.publisherStatus === "approved";
    profile.publisherStatus = currentApproved ? "approved" : "pending";
    profile.publisherBin = String(profile.publisherBin).replace(/\D/g, "").slice(0, 12);
  } else {
    profile.publisherStatus = "not_required";
  }
  if (profile) user.profile = structuredClone(profile);
  if (request.body?.avatarUrl !== undefined) user.avatarUrl = request.body.avatarUrl || undefined;
  if ((profile.type === "Читатель" || profile.type === "Блогер") && Array.isArray(request.body?.reviews)) user.reviews = structuredClone(request.body.reviews);
  if ((profile.type === "Писатель" || profile.type === "Блогер") && Array.isArray(request.body?.excerpts)) user.excerpts = structuredClone(request.body.excerpts);
  if (profile.type === "Издатель" && profile.publisherStatus === "approved" && Array.isArray(request.body?.publisherNews)) user.publisherNews = structuredClone(request.body.publisherNews);
  response.json({ ok: true });
});

router.patch("/users/me/profile-complete", (request, response) => {
  const user = users.find((item) => item.id === request.demoUserId);
  if (user) user.profileCompleted = true;
  response.json({ ok: true });
});

router.get("/books", (request, response) => {
  const query = String(request.query.q ?? "").trim().toLocaleLowerCase("ru");
  const books = users.flatMap((user) => [...user.books, ...(user.authorBooks ?? [])]);
  const unique = [...new Map(books.map((book) => [book.isbn || `${book.author}|${book.title}`.toLocaleLowerCase("ru"), book])).values()];
  response.json({ books: query ? unique.filter((book) => `${book.author} ${book.title} ${book.isbn ?? ""}`.toLocaleLowerCase("ru").includes(query)).slice(0, 8) : [] });
});

router.post("/books", (request, response) => {
  const user = users.find((item) => item.id === request.demoUserId);
  const payload = structuredClone(request.body ?? {});
  if (payload.isAuthor && user.profile.type !== "Писатель" && user.profile.type !== "Издатель") return response.status(403).json({ error: "Добавлять книги могут только писатели и подтверждённые издательства" });
  if (!payload.isAuthor && user.profile.type === "Издатель") return response.status(403).json({ error: "Издательские книги добавляются во вкладке «Книги издательства»" });
  const rating = Number(payload.rating);
  if (!payload.isAuthor && (payload.readingStatus ?? "read") === "read" && (!Number.isInteger(rating * 2) || rating < 0.5 || rating > 5)) return response.status(400).json({ error: "Оценка должна быть от 0,5 до 5 с шагом 0,5" });
  if (!payload.isAuthor) {
    try {
      for (const link of (payload.links ?? []).filter((item) => item?.label?.trim() && item?.url?.trim())) {
        const source = demoMarketplace(link.url);
        if (link.action === "Купить" && !["Flip", "Marwin/Меломан"].includes(source.name)) throw new Error("Для покупки поддерживаются только Flip и Marwin/Меломан");
        if ((link.action === "Читать" || link.action === "Слушать") && source.name !== "Яндекс.Книги") throw new Error("Для чтения и прослушивания поддерживаются только Яндекс.Книги");
        link.label = link.action === "Купить" ? source.name : "Яндекс.Книги";
      }
    } catch (error) { return response.status(400).json({ error: error.message }); }
  }
  const allBooks = users.flatMap((entry) => [...entry.books, ...(entry.authorBooks ?? [])]);
  const normalizedIsbn = String(payload.isbn ?? "").replace(/\D/g, "");
  const sourceUrls = (payload.links ?? []).map((link) => String(link.url ?? ""));
  const exact = allBooks.find((item) => (normalizedIsbn && String(item.isbn ?? "").replace(/\D/g, "") === normalizedIsbn)
    || (item.links ?? []).some((link) => sourceUrls.includes(link.url))
    || Boolean(payload.flipUrl && item.flipUrl === payload.flipUrl));
  const id = Number(payload.useExistingId || exact?.id || payload.id || nextId++);
  const canonical = allBooks.find((item) => item.id === id);
  const book = canonical
    ? { ...canonical, ...payload, id, author: canonical.author, title: canonical.title, isbn: canonical.isbn || payload.isbn, publisher: canonical.publisher || payload.publisher, annotation: canonical.annotation, coverUrl: canonical.coverUrl || payload.coverUrl, links: [...(canonical.links ?? []), ...(payload.links ?? [])].filter((link, index, list) => list.findIndex((item) => item.url === link.url) === index) }
    : { ...payload, id, links: payload.links ?? [] };
  const target = payload.isAuthor ? (user.authorBooks ??= []) : user.books;
  const index = target.findIndex((item) => item.id === id);
  if (index >= 0) target[index] = book; else target.unshift(book);
  response.json({ ok: true, bookId: id });
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

router.get("/comments", (request, response) => {
  response.json({ comments: state.comments[`${request.query.kind}-${request.query.id}`] ?? [] });
});

router.get("/material-stats", (_request, response) => {
  const commenters = {};
  for (const [key, comments] of Object.entries(state.comments)) commenters[key] = [...new Set(comments.map((comment) => comment.userId))];
  response.json({ commenters });
});

router.get("/admin/statistics", (request, response) => {
  const viewer = users.find((user) => user.id === request.demoUserId);
  if (!viewer?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const communityUsers = users.filter((user) => !user.isAdmin);
  const usersByType = { "Читатель": 0, "Писатель": 0, "Блогер": 0, "Издатель": 0 };
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
  const target = users.find((user) => user.id === targetId);
  if (!target) return response.status(404).json({ error: "Пользователь не найден" });
  if (target.isAdmin) return response.status(403).json({ error: "Службу поддержки нельзя добавить в друзья" });
  const entry = { id: nextId++, fromId: request.demoUserId, toId: targetId, status: "pending", message: String(request.body.message ?? "") };
  state.friendRequests.push(entry);
  notification(targetId, request.demoUserId, "friend_request", "Новый друг", `${users.find((user) => user.id === request.demoUserId)?.profile.name} хочет добавить вас в друзья.`);
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
  if (pending) pending.status = "accepted";
  if (!state.friendships.some((item) => [item.userA, item.userB].includes(targetId) && [item.userA, item.userB].includes(request.demoUserId))) state.friendships.push({ userA: targetId, userB: request.demoUserId });
  for (const follow of [{ followerId: targetId, targetId: request.demoUserId }, { followerId: request.demoUserId, targetId }]) {
    if (!state.follows.some((item) => item.followerId === follow.followerId && item.targetId === follow.targetId)) state.follows.push(follow);
  }
  const key = conversationKey(targetId, request.demoUserId);
  (state.messages[key] ??= []).push({ id: nextId++, system: true, text: "Теперь вы друзья и можете начать переписку", time: "сейчас" });
  response.json({ ok: true });
});

router.post("/social/friends/:targetId/reject", (request, response) => {
  const pending = state.friendRequests.find((item) => item.status === "pending" && item.fromId === Number(request.params.targetId) && item.toId === request.demoUserId);
  if (pending) { pending.status = "rejected"; pending.comment = String(request.body.comment ?? ""); }
  response.json({ ok: true });
});

router.delete("/social/friends/:targetId", (request, response) => {
  const targetId = Number(request.params.targetId);
  state.friendships = state.friendships.filter((item) => !([item.userA, item.userB].includes(targetId) && [item.userA, item.userB].includes(request.demoUserId)));
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
  const friends = state.friendships.some((item) => [item.userA, item.userB].includes(request.demoUserId) && [item.userA, item.userB].includes(targetId));
  if (!friends && !sender?.isAdmin && !target?.isAdmin) return response.status(403).json({ error: "Переписка доступна только друзьям и службе поддержки" });
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
  const event = { id: nextId++, creatorId: request.demoUserId, title: String(request.body.title), summary: String(request.body.summary), description: String(request.body.description), date: String(request.body.date), time: String(request.body.time), city: String(request.body.city), address: String(request.body.address), mapUrl: String(request.body.mapUrl ?? ""), detailsUrl: String(request.body.detailsUrl ?? ""), status: "pending", moderationNote: "", organizerName: creator?.isAdmin ? "" : creator?.profile.name, createdAt: new Date().toISOString() };
  state.events.push(event);
  notification(request.demoUserId, request.demoUserId, "event_submitted", "Событие на модерации", `Событие «${event.title}» отправлено на модерацию.`, { materialKind: "event", materialId: event.id });
  response.status(201).json({ event });
});

router.post("/events/:id/reminder", (request, response) => {
  const event = state.events.find((item) => item.id === Number(request.params.id) && item.status === "published");
  if (!event) return response.status(404).json({ error: "Событие не найдено" });
  event.reminderSet = true;
  response.status(201).json({ ok: true });
});

router.delete("/events/:id/reminder", (request, response) => {
  const event = state.events.find((item) => item.id === Number(request.params.id));
  if (!event?.reminderSet) return response.status(404).json({ error: "Напоминание не найдено" });
  event.reminderSet = false;
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
  if (creator?.profile.type === "Издатель") return response.status(403).json({ error: "Издательства не могут создавать поводы познакомиться" });
  const occasion = { id: nextId++, creatorId: request.demoUserId, type: request.body.type, primaryText: String(request.body.primaryText ?? ""), audienceText: String(request.body.audienceText ?? ""), targetGender: request.body.targetGender, targetCities: structuredClone(request.body.targetCities ?? []), targetProfileType: request.body.targetProfileType, status: "pending", moderationNote: "", creatorName: creator?.profile.name ?? "", createdAt: new Date().toISOString() };
  if (!occasion.type || !occasion.primaryText || !occasion.audienceText || !occasion.targetCities.length) return response.status(400).json({ error: "Заполните все поля повода для знакомства" });
  state.occasions.push(occasion);
  notification(request.demoUserId, request.demoUserId, "event_submitted", "Повод на модерации", "Повод для знакомства отправлен на модерацию.", { materialKind: "occasion", materialId: occasion.id });
  response.status(201).json({ occasion });
});

router.patch("/occasions/:id", (request, response) => {
  const occasion = state.occasions.find((item) => item.id === Number(request.params.id) && item.creatorId === request.demoUserId);
  if (!occasion) return response.status(404).json({ error: "Повод не найден" });
  if (occasion.status !== "needs_changes") return response.status(409).json({ error: "Редактировать можно только повод, отправленный на доработку" });
  Object.assign(occasion, request.body, { status: "pending", moderationNote: "" });
  response.json({ occasion });
});

router.patch("/admin/occasions/:id", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const occasion = state.occasions.find((item) => item.id === Number(request.params.id));
  if (!occasion) return response.status(404).json({ error: "Повод не найден" });
  const action = request.body.action;
  if (action === "edit") Object.assign(occasion, request.body.occasion);
  else { occasion.status = action === "accept" ? "published" : action === "revision" ? "needs_changes" : "rejected"; occasion.moderationNote = String(request.body.note ?? ""); }
  response.json({ ok: true });
});

router.patch("/admin/publishers/:id", (request, response) => {
  const admin = users.find((user) => user.id === request.demoUserId);
  if (!admin?.isAdmin) return response.status(403).json({ error: "Доступно только администратору" });
  const publisher = users.find((user) => user.id === Number(request.params.id) && user.profile.type === "Издатель");
  if (!publisher) return response.status(404).json({ error: "Профиль издательства не найден" });
  const statuses = { accept: "approved", revision: "needs_changes", reject: "rejected" };
  const status = statuses[request.body?.action];
  if (!status) return response.status(400).json({ error: "Неизвестное действие модерации" });
  publisher.profile.publisherStatus = status;
  publisher.profile.publisherModerationNote = String(request.body?.note ?? "");
  notification(publisher.id, admin.id, "event_moderation", status === "approved" ? "Профиль издательства подтверждён" : status === "needs_changes" ? "Профиль издательства требует доработки" : "Профиль издательства отклонён", publisher.profile.publisherModerationNote || "Статус профиля издательства изменён.");
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
