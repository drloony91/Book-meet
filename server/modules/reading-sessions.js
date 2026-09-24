import { Router } from "express";
import { validTimezone } from "./reading-state.js";

export const READING_SESSION_LEASE_SECONDS = 120;

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function idParam(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw failure(400, "INVALID_READING_SESSION_ID", "Некорректный идентификатор");
  return id;
}

function timezoneFrom(request) {
  return validTimezone(request.get("X-BookMeet-Timezone") || "UTC");
}

function utcSql(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function localReadingDate(timezone, instant) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: validTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function readingSessionDaySlices(start, end, timezone) {
  const first = Math.floor(new Date(start).getTime() / 1000);
  const last = Math.floor(new Date(end).getTime() / 1000);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) throw new Error("Invalid reading interval");
  const slices = [];
  let current = first;
  while (current < last) {
    const date = localReadingDate(timezone, new Date(current * 1000));
    let high = last;
    if (localReadingDate(timezone, new Date((last - 1) * 1000)) !== date) {
      let low = current + 1;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (localReadingDate(timezone, new Date(mid * 1000)) === date) low = mid + 1;
        else high = mid;
      }
      high = low;
    }
    const seconds = high - current;
    if (seconds <= 0) throw new Error("Invalid reading date boundary");
    slices.push({ date, seconds });
    current = high;
  }
  return slices;
}

export function manualReadingInput(payload, timezone, now = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw failure(422, "INVALID_READING_SESSION", "Укажите дату и длительность");
  const { date, hours, minutes, seconds } = payload;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > localReadingDate(timezone, now)) throw failure(422, "INVALID_READING_SESSION_DATE", "Укажите прошедшую или сегодняшнюю дату");
  if (![hours, minutes, seconds].every((value) => typeof value === "number" && Number.isInteger(value)) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) throw failure(422, "INVALID_READING_SESSION_DURATION", "Укажите часы, минуты и секунды");
  const durationSeconds = hours * 3600 + minutes * 60 + seconds;
  if (durationSeconds <= 0 || durationSeconds > 86400) throw failure(422, "INVALID_READING_SESSION_DURATION", "Длительность должна быть больше нуля и не более 24 часов");
  return { date, durationSeconds };
}

function sessionDto(row) {
  if (!row) return null;
  const asIso = (value) => value ? new Date(value).toISOString() : null;
  const asDate = (value) => typeof value === "string" ? value.slice(0, 10) : value?.toISOString?.().slice(0, 10) ?? null;
  return {
    id: Number(row.id), bookId: Number(row.book_id), readingCycleId: row.reading_cycle_id == null ? null : Number(row.reading_cycle_id),
    date: asDate(row.local_date), timezone: row.timezone, source: row.source, state: row.state,
    durationSeconds: Number(row.duration_seconds), startedAt: asIso(row.started_at), endedAt: asIso(row.ended_at),
    runningSince: asIso(row.running_since), leaseExpiresAt: asIso(row.lease_expires_at),
    requiresResumeConfirmation: Boolean(row.expired_at), createdAt: asIso(row.created_at), updatedAt: asIso(row.updated_at),
  };
}

async function lockOwner(connection, userId) {
  const [[row]] = await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
  if (!row) throw failure(404, "READING_SESSION_OWNER_NOT_FOUND", "Пользователь не найден");
}

async function ownerSession(connection, userId, id) {
  const [[row]] = await connection.query("SELECT * FROM reading_sessions WHERE id = ? AND user_id = ? FOR UPDATE", [id, userId]);
  if (!row) throw failure(404, "READING_SESSION_NOT_FOUND", "Сессия не найдена");
  return row;
}

async function ownerBook(connection, userId, bookId) {
  const [[row]] = await connection.query(
    "SELECT ub.user_id, ub.book_id FROM user_books ub JOIN profiles p ON p.user_id = ub.user_id WHERE ub.user_id = ? AND ub.book_id = ? AND ub.is_author = 0 AND p.profile_type IN ('Читатель', 'Писатель', 'Блогер') FOR UPDATE",
    [userId, bookId],
  );
  if (!row) throw failure(404, "READING_SESSION_BOOK_NOT_FOUND", "Книга не найдена в личной библиотеке");
  const [[cycle]] = await connection.query("SELECT id FROM reading_cycles WHERE user_id = ? AND book_id = ? AND status IN ('active', 'completed') ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id DESC LIMIT 1", [userId, bookId]);
  return { cycleId: cycle?.id ?? null };
}

async function selected(connection, userId, id) {
  const [[row]] = await connection.query("SELECT * FROM reading_sessions WHERE id = ? AND user_id = ?", [id, userId]);
  return sessionDto(row);
}

async function addElapsed(connection, row, now) {
  if (row.state !== "running") return row;
  const start = new Date(row.running_since);
  const limit = new Date(row.lease_expires_at);
  const end = new Date(Math.min(now.getTime(), limit.getTime()));
  const slices = readingSessionDaySlices(start, end, row.timezone);
  const seconds = slices.reduce((sum, item) => sum + item.seconds, 0);
  if (seconds > 0) {
    for (const slice of slices) await connection.query("INSERT INTO reading_session_days (session_id, local_date, duration_seconds) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE duration_seconds = duration_seconds + VALUES(duration_seconds)", [row.id, slice.date, slice.seconds]);
    await connection.query("UPDATE reading_sessions SET duration_seconds = duration_seconds + ? WHERE id = ?", [seconds, row.id]);
    row.duration_seconds = Number(row.duration_seconds) + seconds;
  }
  row.running_since = null;
  row.lease_expires_at = null;
  row.state = "paused";
  row.expired_at = now.getTime() > limit.getTime() ? limit : null;
  await connection.query("UPDATE reading_sessions SET state = 'paused', running_since = NULL, lease_expires_at = NULL, expired_at = ? WHERE id = ?", [row.expired_at ? utcSql(limit) : null, row.id]);
  return row;
}

function serverNow() { return new Date(Math.floor(Date.now() / 1000) * 1000); }

export function readingSessionsEnabled() {
  return ["1", "true"].includes(String(process.env.BOOK_MEET_READING_SESSIONS_ENABLED ?? "").toLowerCase());
}

export function createReadingSessionsRouter({ getPool, withTransaction, queueOwnerRealtime }) {
  const router = Router();
  const asyncRoute = (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
  router.use((request, response, next) => {
    if (!/^\/(?:reading-sessions(?:\/|$)|books\/[^/]+\/reading-sessions(?:\/|$))/.test(request.path)) return next();
    return readingSessionsEnabled() ? next() : response.status(404).json({ error: "Не найдено" });
  });

  router.get("/reading-sessions/active", asyncRoute(async (request, response) => {
    const userId = request.bookMeetUser.id;
    const active = await withTransaction(async (connection) => {
      await lockOwner(connection, userId);
      const [[row]] = await connection.query("SELECT * FROM reading_sessions WHERE user_id = ? AND state IN ('running', 'paused') FOR UPDATE", [userId]);
      if (!row) return null;
      if (row.state === "running" && serverNow().getTime() > new Date(row.lease_expires_at).getTime()) await addElapsed(connection, row, serverNow());
      return selected(connection, userId, row.id);
    });
    response.json({ session: active });
  }));

  router.post("/books/:bookId/reading-sessions/timer/start", asyncRoute(async (request, response) => {
    const userId = request.bookMeetUser.id; const bookId = idParam(request.params.bookId);
    const timezone = timezoneFrom(request);
    const result = await withTransaction(async (connection) => {
      await lockOwner(connection, userId);
      const { cycleId } = await ownerBook(connection, userId, bookId);
      const [[active]] = await connection.query("SELECT * FROM reading_sessions WHERE user_id = ? AND state IN ('running', 'paused') FOR UPDATE", [userId]);
      if (active) {
        if (Number(active.book_id) !== bookId) return { conflict: true, session: sessionDto(active) };
        if (active.state === "running" && serverNow().getTime() > new Date(active.lease_expires_at).getTime()) await addElapsed(connection, active, serverNow());
        return { session: await selected(connection, userId, active.id), created: false };
      }
      const now = serverNow(); const lease = new Date(now.getTime() + READING_SESSION_LEASE_SECONDS * 1000);
      const [created] = await connection.query(
        "INSERT INTO reading_sessions (user_id, book_id, library_user_id, library_book_id, reading_cycle_id, local_date, timezone, started_at, source, state, running_since, lease_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'timer', 'running', ?, ?)",
        [userId, bookId, userId, bookId, cycleId, localReadingDate(timezone, now), timezone, utcSql(now), utcSql(now), utcSql(lease)],
      );
      return { session: await selected(connection, userId, created.insertId), created: true };
    });
    if (result.conflict) return response.status(409).json({ code: "READING_SESSION_ACTIVE_OTHER_BOOK", session: result.session });
    if (result.created) queueOwnerRealtime(response, userId, { presenceBookId: bookId });
    else response.locals.suppressRealtime = true;
    response.status(result.created ? 201 : 200).json({ session: result.session });
  }));

  async function timerAction(request, response, action) {
    const userId = request.bookMeetUser.id; const id = idParam(request.params.id);
    const result = await withTransaction(async (connection) => {
      await lockOwner(connection, userId);
      const row = await ownerSession(connection, userId, id);
      if (row.source !== "timer") throw failure(409, "READING_SESSION_NOT_TIMER", "Это не таймерная сессия");
      if (row.state === "closed") return { session: sessionDto(row), changed: false };
      const now = serverNow();
      const wasRunning = row.state === "running";
      if (row.state === "running" && (action === "pause" || action === "stop" || now.getTime() > new Date(row.lease_expires_at).getTime())) await addElapsed(connection, row, now);
      if (action === "heartbeat") {
        if (row.state !== "running") return { session: await selected(connection, userId, id), expired: true };
        const lease = new Date(now.getTime() + READING_SESSION_LEASE_SECONDS * 1000);
        await connection.query("UPDATE reading_sessions SET lease_expires_at = ? WHERE id = ?", [utcSql(lease), id]);
        return { session: await selected(connection, userId, id), heartbeat: true };
      }
      if (action === "pause") return { session: await selected(connection, userId, id), changed: wasRunning };
      if (action === "resume") {
        if (row.state === "running") return { session: sessionDto(row), changed: false };
        if (row.expired_at && request.body?.confirmExpired !== true) return { session: await selected(connection, userId, id), needsConfirmation: true };
        const lease = new Date(now.getTime() + READING_SESSION_LEASE_SECONDS * 1000);
        await connection.query("UPDATE reading_sessions SET state = 'running', running_since = ?, lease_expires_at = ?, expired_at = NULL WHERE id = ?", [utcSql(now), utcSql(lease), id]);
        return { session: await selected(connection, userId, id), changed: true };
      }
      if (action === "stop") {
        await connection.query("UPDATE reading_sessions SET state = 'closed', ended_at = ?, running_since = NULL, lease_expires_at = NULL WHERE id = ?", [utcSql(now), id]);
        return { session: await selected(connection, userId, id), changed: true };
      }
      throw new Error("Unknown timer action");
    });
    if (result.needsConfirmation) return response.status(409).json({ code: "READING_SESSION_RESUME_CONFIRMATION_REQUIRED", session: result.session });
    if (result.expired) return response.status(409).json({ code: "READING_SESSION_LEASE_EXPIRED", session: result.session });
    if (result.changed) queueOwnerRealtime(response, userId, { presenceBookId: result.session.bookId });
    else response.locals.suppressRealtime = true;
    response.json({ session: result.session });
  }

  for (const action of ["pause", "resume", "heartbeat", "stop"]) router.post(`/reading-sessions/:id/${action}`, asyncRoute((request, response) => timerAction(request, response, action)));

  router.get("/books/:bookId/reading-sessions", asyncRoute(async (request, response) => {
    const userId = request.bookMeetUser.id; const bookId = idParam(request.params.bookId);
    const [rows] = await getPool().query("SELECT * FROM reading_sessions WHERE user_id = ? AND book_id = ? ORDER BY id DESC", [userId, bookId]);
    response.json({ sessions: rows.map(sessionDto) });
  }));

  router.post("/books/:bookId/reading-sessions", asyncRoute(async (request, response) => {
    const userId = request.bookMeetUser.id; const bookId = idParam(request.params.bookId);
    const timezone = timezoneFrom(request); const input = manualReadingInput(request.body, timezone);
    const session = await withTransaction(async (connection) => {
      await lockOwner(connection, userId);
      const { cycleId } = await ownerBook(connection, userId, bookId);
      const [created] = await connection.query("INSERT INTO reading_sessions (user_id, book_id, library_user_id, library_book_id, reading_cycle_id, local_date, timezone, duration_seconds, source, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'closed')", [userId, bookId, userId, bookId, cycleId, input.date, timezone, input.durationSeconds]);
      await connection.query("INSERT INTO reading_session_days (session_id, local_date, duration_seconds) VALUES (?, ?, ?)", [created.insertId, input.date, input.durationSeconds]);
      return selected(connection, userId, created.insertId);
    });
    queueOwnerRealtime(response, userId);
    response.status(201).json({ session });
  }));

  router.patch("/reading-sessions/:id", asyncRoute(async (request, response) => {
    const userId = request.bookMeetUser.id; const id = idParam(request.params.id);
    const timezone = timezoneFrom(request); const input = manualReadingInput(request.body, timezone);
    const session = await withTransaction(async (connection) => {
      await lockOwner(connection, userId);
      const row = await ownerSession(connection, userId, id);
      if (row.state !== "closed") throw failure(409, "READING_SESSION_ACTIVE", "Завершите сессию перед редактированием");
      await connection.query("UPDATE reading_sessions SET local_date = ?, timezone = ?, duration_seconds = ? WHERE id = ?", [input.date, timezone, input.durationSeconds, id]);
      await connection.query("DELETE FROM reading_session_days WHERE session_id = ?", [id]);
      await connection.query("INSERT INTO reading_session_days (session_id, local_date, duration_seconds) VALUES (?, ?, ?)", [id, input.date, input.durationSeconds]);
      return selected(connection, userId, id);
    });
    queueOwnerRealtime(response, userId);
    response.json({ session });
  }));

  router.delete("/reading-sessions/:id", asyncRoute(async (request, response) => {
    const userId = request.bookMeetUser.id; const id = idParam(request.params.id);
    await withTransaction(async (connection) => {
      await lockOwner(connection, userId);
      const row = await ownerSession(connection, userId, id);
      if (row.state !== "closed") throw failure(409, "READING_SESSION_ACTIVE", "Завершите сессию перед удалением");
      await connection.query("DELETE FROM reading_sessions WHERE id = ? AND user_id = ?", [id, userId]);
    });
    queueOwnerRealtime(response, userId);
    response.json({ ok: true });
  }));

  return router;
}
