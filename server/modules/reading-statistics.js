import { readingSessionDaySlices } from "./reading-sessions.js";
import { progressPercent } from "./reading-state.js";

function bookDto(row) {
  return {
    id: Number(row.book_id), title: row.title, author: row.author,
    coverUrl: row.cover_path ?? null, coverTone: row.cover_tone ?? "blue",
  };
}

function monthKey(year, month) { return `${year}-${String(month).padStart(2, "0")}`; }

function calendarMonth(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 7);
  return String(value).slice(0, 7);
}

function addBookSeconds(months, date, book, seconds) {
  if (seconds <= 0) return;
  const key = calendarMonth(date);
  let month = months.get(key);
  if (!month) { month = new Map(); months.set(key, month); }
  const current = month.get(book.id);
  month.set(book.id, { book, durationSeconds: (current?.durationSeconds ?? 0) + seconds });
}

export function assembleReadingStatistics({ year, completed = [], reading = [], dayRows = [], cycleRows = [], running = [], now = new Date() }) {
  const monthlyBooks = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, books: [] }));
  const bookCounts = Array(12).fill(0);
  const cycleSeconds = new Map(cycleRows.map((row) => [Number(row.reading_cycle_id), Number(row.duration_seconds)]));
  const months = new Map();
  const currentReading = reading.map((row) => {
    const current = row.progress_unit === "chapters" ? row.chapters_current : row.progress_unit === "pages" ? row.pages_current : null;
    const total = row.progress_unit === "chapters" ? row.chapters_total : row.progress_unit === "pages" ? row.pages_total : null;
    return { book: bookDto(row), progressPercent: progressPercent(current === null ? null : Number(current), total === null ? null : Number(total)), durationSeconds: cycleSeconds.get(Number(row.cycle_id)) ?? 0, cycleId: row.cycle_id === null ? null : Number(row.cycle_id) };
  });
  for (const row of completed) {
    if (Number(row.completed_year) !== year || !Number.isInteger(Number(row.completed_month)) || Number(row.completed_month) < 1 || Number(row.completed_month) > 12) continue;
    const month = Number(row.completed_month);
    bookCounts[month - 1] += 1;
    monthlyBooks[month - 1].books.push({ book: bookDto(row), durationSeconds: cycleSeconds.get(Number(row.cycle_id)) ?? 0, cycleId: Number(row.cycle_id) });
  }
  for (const row of dayRows) addBookSeconds(months, row.local_date, bookDto(row), Number(row.duration_seconds));
  for (const row of running) {
    const start = new Date(row.running_since);
    const end = new Date(Math.min(now.getTime(), new Date(row.lease_expires_at).getTime()));
    if (end <= start) continue;
    const book = bookDto(row);
    for (const slice of readingSessionDaySlices(start, end, row.timezone)) addBookSeconds(months, slice.date, book, slice.seconds);
    const current = currentReading.find((entry) => entry.cycleId !== null && entry.cycleId === Number(row.reading_cycle_id));
    if (current) current.durationSeconds += Math.floor((end.getTime() - start.getTime()) / 1000);
  }
  const timeMonths = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, books: [...(months.get(monthKey(year, index + 1))?.values() ?? [])].sort((a, b) => b.durationSeconds - a.durationSeconds || a.book.id - b.book.id) }));
  return {
    bookCounts,
    bookMonths: monthlyBooks,
    currentReading: currentReading.map(({ cycleId: _cycleId, ...entry }) => entry),
    timeCounts: timeMonths.map((month) => month.books.reduce((sum, entry) => sum + entry.durationSeconds, 0)),
    timeMonths,
  };
}

export async function loadReadingStatistics(connection, userId, year, now = new Date()) {
  const [[completed], [reading], [dayRows], [cycleRows], [running]] = await Promise.all([
    connection.query(`SELECT rc.id AS cycle_id, rc.book_id, rc.completed_month, rc.completed_year, b.title, b.author, b.cover_path, b.cover_tone
        FROM reading_cycles rc
        JOIN (SELECT book_id, MAX(id) AS id FROM reading_cycles WHERE user_id = ? AND status = 'completed' GROUP BY book_id) latest ON latest.id = rc.id
        JOIN user_books ub ON ub.user_id = rc.user_id AND ub.book_id = rc.book_id AND ub.is_author = 0 AND ub.reading_status = 'read'
        JOIN books b ON b.id = rc.book_id
       WHERE rc.completed_year = ?`, [userId, year]),
    connection.query(`SELECT ub.book_id, ub.progress_unit, ub.chapters_current, ub.chapters_total, ub.pages_current, ub.pages_total, rc.id AS cycle_id, b.title, b.author, b.cover_path, b.cover_tone
        FROM user_books ub JOIN books b ON b.id = ub.book_id
        LEFT JOIN reading_cycles rc ON rc.user_id = ub.user_id AND rc.book_id = ub.book_id AND rc.status = 'active'
       WHERE ub.user_id = ? AND ub.is_author = 0 AND ub.reading_status = 'reading'`, [userId]),
    connection.query(`SELECT d.local_date, s.book_id, b.title, b.author, b.cover_path, b.cover_tone, SUM(d.duration_seconds) AS duration_seconds
        FROM reading_session_days d JOIN reading_sessions s ON s.id = d.session_id JOIN books b ON b.id = s.book_id
       WHERE s.user_id = ? AND d.local_date >= ? AND d.local_date < ?
       GROUP BY d.local_date, s.book_id, b.title, b.author, b.cover_path, b.cover_tone`, [userId, `${year}-01-01`, `${year + 1}-01-01`]),
    connection.query(`SELECT reading_cycle_id, SUM(duration_seconds) AS duration_seconds FROM reading_sessions
       WHERE user_id = ? AND reading_cycle_id IS NOT NULL GROUP BY reading_cycle_id`, [userId]),
    connection.query(`SELECT s.book_id, s.reading_cycle_id, s.running_since, s.lease_expires_at, s.timezone, b.title, b.author, b.cover_path, b.cover_tone
        FROM reading_sessions s JOIN books b ON b.id = s.book_id
       WHERE s.user_id = ? AND s.state = 'running' AND s.running_since IS NOT NULL AND s.lease_expires_at IS NOT NULL`, [userId]),
  ]);
  return assembleReadingStatistics({ year, completed, reading, dayRows, cycleRows, running, now });
}
