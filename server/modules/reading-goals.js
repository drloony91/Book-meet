import { validTimezone } from "./reading-state.js";

export const GOAL_KINDS = new Set(["month", "year"]);

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: "INVALID_READING_GOAL" });
}

export function zonedDateParts(timezone = "UTC", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: validTimezone(timezone), year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

export function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

export function eligibleGoalPeriods(timezone = "UTC", now = new Date()) {
  const { year, month } = zonedDateParts(timezone, now);
  return { year, month, months: Array.from({ length: 13 - month }, (_, index) => month + index), years: month <= 2 ? [year, year + 1] : [year + 1] };
}

export function validateGoalPayload(payload = {}, { timezone = "UTC", now = new Date(), existing = null } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw inputError("Укажите параметры цели");
  for (const field of ["targetCount", "targetYear", "targetMonth"]) {
    if (Object.hasOwn(payload, field) && !(field === "targetMonth" && payload[field] === null) && typeof payload[field] !== "number") throw inputError("Параметры цели должны быть числами");
  }
  const kind = payload.goalKind ?? payload.goal_kind ?? existing?.goalKind ?? existing?.goal_kind;
  if (typeof kind !== "string" || !GOAL_KINDS.has(kind)) throw inputError("Укажите тип цели");
  const targetCount = payload.targetCount === undefined ? Number(existing?.targetCount ?? existing?.target_count) : Number(payload.targetCount);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 4_294_967_295) throw inputError("Количество книг должно быть целым числом больше нуля");
  const periods = eligibleGoalPeriods(timezone, now);
  const year = payload.targetYear === undefined ? Number(existing?.targetYear ?? existing?.target_year) : Number(payload.targetYear);
  const month = kind === "month" ? (payload.targetMonth === undefined ? Number(existing?.targetMonth ?? existing?.target_month) : Number(payload.targetMonth)) : null;
  // A PATCH that only changes count preserves a once-valid historical period.
  const periodChanged = !existing || payload.goalKind !== undefined || payload.goal_kind !== undefined || payload.targetYear !== undefined || payload.target_year !== undefined || payload.targetMonth !== undefined || payload.target_month !== undefined;
  if (existing && periodChanged) throw Object.assign(new Error("Период существующей цели нельзя изменить; измените количество или создайте новую цель"), { statusCode: 422, code: "READING_GOAL_PERIOD_IMMUTABLE" });
  if (!Number.isInteger(year) || year < 1900 || year > periods.year + 1) throw inputError("Укажите корректный год");
  if (kind === "month") {
    if (!Number.isInteger(month) || month < 1 || month > 12) throw inputError("Укажите корректный месяц");
    if (periodChanged && (year !== periods.year || !periods.months.includes(month))) throw inputError("Можно выбрать месяц от текущего до декабря");
  } else if (periodChanged && !periods.years.includes(year)) throw inputError("Можно выбрать только допустимый год");
  const startMonth = kind === "year" ? (existing?.startMonth ?? existing?.start_month ?? (year === periods.year ? periods.month : 1)) : null;
  return { goalKind: kind, targetCount, targetYear: year, targetMonth: month, startMonth: startMonth === null ? null : Number(startMonth) };
}

export function monthPace(goal, timezone = "UTC", now = new Date()) {
  const { year, month, day } = zonedDateParts(timezone, now);
  const days = goal.targetYear === year && goal.targetMonth === month ? daysInMonth(year, month) - day + 1 : daysInMonth(goal.targetYear, goal.targetMonth);
  const value = days / goal.targetCount;
  const dayWord = (count) => ({ one: "день", few: "дня", many: "дней", other: "дня" })[new Intl.PluralRules("ru").select(count)];
  return { days, daysPerBook: value, moreThanOnePerDay: goal.targetCount > days, text: goal.targetCount > days ? "больше одной книги в день" : Number.isInteger(value) ? `по одной книге за ${value} ${dayWord(value)}` : `по одной книге за ${Math.floor(value)}–${Math.ceil(value)} ${dayWord(Math.ceil(value))}` };
}

export function annualPlan(goal, completions = [], timezone = "UTC", now = new Date()) {
  const start = Number(goal.startMonth ?? goal.start_month ?? 1);
  const period = Array.from({ length: 13 - start }, (_, index) => start + index);
  const counts = new Map(period.map((month) => [month, 0]));
  for (const entry of completions) if (Number(entry.completedYear ?? entry.completed_year) === Number(goal.targetYear ?? goal.target_year) && counts.has(Number(entry.completedMonth ?? entry.completed_month))) counts.set(Number(entry.completedMonth ?? entry.completed_month), (counts.get(Number(entry.completedMonth ?? entry.completed_month)) ?? 0) + 1);
  const local = zonedDateParts(timezone, now);
  const targetYear = Number(goal.targetYear ?? goal.target_year);
  const targetCount = Number(goal.targetCount ?? goal.target_count);
  const anchor = targetYear < local.year ? 13 : targetYear > local.year ? start : Math.max(start, local.month);
  const frozenTarget = (month) => {
    const completedBefore = period.filter((item) => item < month).reduce((sum, item) => sum + (counts.get(item) ?? 0), 0);
    const remaining = Math.max(0, targetCount - completedBefore); const slots = 13 - month;
    return Math.floor(remaining / slots) + (remaining % slots > 0 ? 1 : 0);
  };
  const completedBeforeAnchor = period.filter((item) => item < anchor).reduce((sum, item) => sum + (counts.get(item) ?? 0), 0);
  const remaining = Math.max(0, targetCount - completedBeforeAnchor);
  const slots = Math.max(0, 13 - anchor);
  const plan = period.map((month) => {
    const target = month < anchor ? frozenTarget(month) : slots ? Math.floor(remaining / slots) + (month - anchor < remaining % slots ? 1 : 0) : 0;
    return { month, target, actual: counts.get(month) ?? 0 };
  });
  return { startMonth: start, targetCount, booksPerMonth: Number((targetCount / period.length).toFixed(1)), plan, currentMonth: local.year === targetYear ? local.month : null };
}

export function goalProgressColor(actual, target) {
  if (target == null) return "blue";
  if (target === 0) return "green";
  const percent = actual / target * 100;
  if (percent < 50) return "muted-red";
  if (percent <= 80) return "muted-yellow";
  if (percent < 100) return "muted-green";
  return "green";
}
