export const READING_STATUSES = new Set(["want", "reading", "read", "abandoned", "postponed"]);
const PROGRESS_UNITS = new Set(["chapters", "pages"]);

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: "INVALID_READING_STATE" });
}

function optionalInteger(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!Number.isInteger(value) || value < 0 || value > 4_294_967_295) throw inputError(`${label} должно быть целым неотрицательным числом`);
  return value;
}

function optionalMonth(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!Number.isInteger(value) || value < 1 || value > 12) throw inputError("Укажите корректный месяц");
  return value;
}

function optionalYear(value, now, maxYear = now.getUTCFullYear()) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!Number.isInteger(value) || value < 1900 || value > maxYear) throw inputError("Укажите корректный год");
  return value;
}

export function validTimezone(value) {
  const timezone = String(value ?? "UTC");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); return timezone; } catch { throw inputError("Укажите корректный часовой пояс"); }
}

export function currentYearInTimezone(timezone, now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: validTimezone(timezone), year: "numeric" }).format(now));
}

export function postponedOverdue(month, year, timezone = "UTC", now = new Date()) {
  if (!Number.isInteger(year)) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: validTimezone(timezone), year: "numeric", month: "numeric" }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return year < values.year || year === values.year && Number.isInteger(month) && month < values.month;
}

export function progressPercent(current, total) {
  if (!Number.isInteger(current) || !Number.isInteger(total) || total <= 0 || current < 0 || current > total) return null;
  return Math.min(100, Math.max(0, Math.floor(current / total * 100)));
}

export function normalizeReadingState(payload = {}, existing = {}, { now = new Date(), timezone = "UTC", defaultStatus = "read" } = {}) {
  const has = (name) => Object.hasOwn(payload, name);
  let readingStatus = has("readingStatus") ? payload.readingStatus : (existing.readingStatus ?? existing.reading_status ?? defaultStatus);
  if (!READING_STATUSES.has(readingStatus)) throw inputError("Укажите корректный статус чтения");
  const result = { readingStatus };
  if (readingStatus === "reading") {
    const pairs = [["chapters", "chaptersCurrent", "chaptersTotal"], ["pages", "pagesCurrent", "pagesTotal"]];
    const editedUnits = [];
    for (const [unit, currentName, totalName] of pairs) {
      const current = optionalInteger(payload[currentName], currentName);
      const total = optionalInteger(payload[totalName], totalName);
      const savedCurrent = existing[currentName] ?? existing[currentName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] ?? null;
      const savedTotal = existing[totalName] ?? existing[totalName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] ?? null;
      const mergedCurrent = current === undefined ? savedCurrent : current;
      const mergedTotal = total === undefined ? savedTotal : total;
      if (mergedTotal !== null && mergedTotal <= 0) throw inputError(`${totalName} должно быть больше нуля`);
      if (mergedCurrent !== null && mergedTotal !== null && mergedCurrent > mergedTotal) throw inputError("Прочитанное значение не может быть больше общего");
      result[currentName] = mergedCurrent;
      result[totalName] = mergedTotal;
      if (current !== undefined && current !== savedCurrent || total !== undefined && total !== savedTotal) editedUnits.push(unit);
    }
    if (has("progressUnit") && !PROGRESS_UNITS.has(payload.progressUnit)) throw inputError("Укажите корректную единицу прогресса");
    result.progressUnit = editedUnits.length === 1 ? editedUnits[0] : (existing.progressUnit ?? existing.progress_unit ?? null);
    if (editedUnits.length === 2 && has("progressUnit")) result.progressUnit = payload.progressUnit;
    if (editedUnits.length === 2 && !has("progressUnit")) result.progressUnit = "pages";
    result.readingComment = has("readingComment") ? String(payload.readingComment ?? "").trim().slice(0, 3000) : (existing.readingComment ?? existing.reading_comment ?? "");
  }
  if (readingStatus === "read") {
    const rating = has("rating") ? Number(payload.rating) : Number(existing.rating);
    const shortReview = has("shortReview") || has("review") ? String(payload.shortReview ?? payload.review ?? "").trim() : String(existing.shortReview ?? existing.short_review ?? existing.review ?? "").trim();
    const readMonth = optionalMonth(has("readMonth") ? payload.readMonth : existing.readMonth ?? existing.read_month);
    const readYear = optionalYear(has("readYear") ? payload.readYear : existing.readYear ?? existing.read_year, now, currentYearInTimezone(timezone, now));
    if (!Number.isInteger(rating * 2) || rating < .5 || rating > 5 || !shortReview || !readMonth || !readYear) throw inputError("Для прочитанной книги обязательны оценка, краткий отзыв, месяц и год");
    result.rating = rating; result.shortReview = shortReview; result.readMonth = readMonth; result.readYear = readYear;
  }
  if (readingStatus === "abandoned") result.shortReview = has("shortReview") || has("review") ? String(payload.shortReview ?? payload.review ?? "").trim() : String(existing.shortReview ?? existing.short_review ?? existing.review ?? "").trim();
  if (readingStatus === "postponed") {
    const month = optionalMonth(has("postponedMonth") ? payload.postponedMonth : existing.postponedMonth ?? existing.postponed_month);
    let year = optionalYear(has("postponedYear") ? payload.postponedYear : existing.postponedYear ?? existing.postponed_year, now, 2100);
    if (month && year == null) year = currentYearInTimezone(timezone, now);
    result.postponedMonth = month; result.postponedYear = year;
    result.readingComment = has("readingComment") ? String(payload.readingComment ?? "").trim().slice(0, 3000) : (existing.readingComment ?? existing.reading_comment ?? "");
  }
  return result;
}

// User progress is deliberately retained while a book is not currently being
// read. It is private state for resume/sorting, not a public status projection.
export function readingStateStorage(state, existing = {}) {
  const saved = (camel, snake) => existing[camel] ?? existing[snake] ?? null;
  const active = state.readingStatus === "reading";
  const value = (camel, snake) => active ? state[camel] : saved(camel, snake);
  const chaptersCurrent = value("chaptersCurrent", "chapters_current");
  return {
    chaptersCurrent,
    chaptersTotal: value("chaptersTotal", "chapters_total"),
    pagesCurrent: value("pagesCurrent", "pages_current"),
    pagesTotal: value("pagesTotal", "pages_total"),
    progressUnit: value("progressUnit", "progress_unit"),
    lastReadChapter: chaptersCurrent,
    readingComment: state.readingStatus === "reading" || state.readingStatus === "postponed" ? state.readingComment : saved("readingComment", "reading_comment"),
    postponedMonth: state.readingStatus === "postponed" ? state.postponedMonth : null,
    postponedYear: state.readingStatus === "postponed" ? state.postponedYear : null,
  };
}

export function readingStateDto(book, { owner = false } = {}) {
  const unit = book.progressUnit ?? book.progress_unit ?? null;
  const current = unit === "chapters" ? book.chaptersCurrent ?? book.chapters_current : unit === "pages" ? book.pagesCurrent ?? book.pages_current : null;
  const total = unit === "chapters" ? book.chaptersTotal ?? book.chapters_total : unit === "pages" ? book.pagesTotal ?? book.pages_total : null;
  const state = { readingStatus: book.readingStatus ?? book.reading_status ?? "read", progressPercent: current == null || total == null ? null : progressPercent(Number(current), Number(total)) };
  if (owner) Object.assign(state, {
    chaptersCurrent: book.chaptersCurrent ?? book.chapters_current ?? undefined, chaptersTotal: book.chaptersTotal ?? book.chapters_total ?? undefined,
    pagesCurrent: book.pagesCurrent ?? book.pages_current ?? undefined, pagesTotal: book.pagesTotal ?? book.pages_total ?? undefined,
    progressUnit: unit ?? undefined,
    lastReadChapter: book.lastReadChapter ?? book.last_read_chapter ?? undefined,
  });
  if (owner && state.readingStatus === "reading") state.readingComment = book.readingComment ?? book.reading_comment ?? "";
  if (owner && state.readingStatus === "postponed") {
    state.readingComment = book.readingComment ?? book.reading_comment ?? "";
    state.postponedMonth = book.postponedMonth ?? book.postponed_month ?? undefined;
    state.postponedYear = book.postponedYear ?? book.postponed_year ?? undefined;
    state.postponedOverdue = postponedOverdue(state.postponedMonth, state.postponedYear, book.postponedTimezone ?? book.postponed_timezone ?? "UTC");
  }
  return state;
}
