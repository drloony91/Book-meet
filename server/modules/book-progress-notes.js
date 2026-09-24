const PROGRESS_UNITS = new Set(["chapters", "pages"]);
const UINT32_MAX = 4_294_967_295;

function inputError(message, code = "INVALID_BOOK_PROGRESS_NOTE") {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

export function noteBody(value) {
  if (typeof value !== "string") throw inputError("Текст заметки обязателен");
  const body = value.trim();
  if (!body || Array.from(body).length > 3000) throw inputError("Текст заметки должен содержать от 1 до 3000 символов");
  return body;
}

export function progressSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const unit = value.unit;
  const current = value.current;
  const total = value.total;
  if (!PROGRESS_UNITS.has(unit) || !Number.isInteger(current) || !Number.isInteger(total)
    || current < 0 || total < 1 || current > total || total > UINT32_MAX) return null;
  return { unit, current, total, percent: Math.floor(current / total * 100) };
}

export function expectedProgress(value) {
  if (value === undefined) return undefined;
  const snapshot = progressSnapshot(value);
  if (!snapshot || Object.hasOwn(value, "percent") && value.percent !== snapshot.percent) {
    throw inputError("Некорректный ожидаемый прогресс");
  }
  return snapshot;
}

export function sameProgress(left, right) {
  return left?.unit === right?.unit && left?.current === right?.current && left?.total === right?.total && left?.percent === right?.percent;
}

export function noteDto(row) {
  return {
    id: Number(row.id), userId: Number(row.user_id), bookId: Number(row.book_id),
    readingCycleId: row.reading_cycle_id == null ? null : Number(row.reading_cycle_id),
    body: row.body, progressUnit: row.progress_unit, progressCurrent: Number(row.progress_current),
    progressTotal: Number(row.progress_total), progressPercent: Number(row.progress_percent),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    author: { id: Number(row.user_id), name: row.author_name, initials: row.author_initials, ...(row.author_avatar_url ? { avatarUrl: row.author_avatar_url } : {}) },
  };
}

export function noteCursor(value) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(value).trim() !== String(parsed)) throw inputError("Некорректный курсор заметок");
  return parsed;
}
