import { postponedOverdue } from "./reading-state.js";

// Kept dependency-injected so the real-MySQL suite can run deterministic
// periods without booting a minute timer or relying on wall-clock time.
export async function deliverDuePostponedBookReminders({ withTransaction, now = new Date(), broadcast = () => {}, limit = 100 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid postponed reminder batch size");
  let delivered = 0;
  let afterUser = 0;
  let afterBook = 0;
  // Keyset pagination advances past candidates that are not due in their own
  // timezone yet. Such rows must never starve already-due schedules behind them.
  for (;;) {
    const batch = await withTransaction(async (connection) => {
      const [candidates] = await connection.query(
        `SELECT ub.user_id, ub.book_id FROM user_books ub JOIN users u ON u.id = ub.user_id
        WHERE ub.reading_status = 'postponed' AND ub.postponed_year IS NOT NULL
          AND ub.postponed_notified_at IS NULL AND u.deleted_at IS NULL AND u.purged_at IS NULL
          AND (ub.user_id > ? OR ub.user_id = ? AND ub.book_id > ?)
          AND (ub.postponed_year < YEAR(DATE_ADD(?, INTERVAL 14 HOUR))
            OR ub.postponed_year = YEAR(DATE_ADD(?, INTERVAL 14 HOUR))
              AND ub.postponed_month IS NOT NULL AND ub.postponed_month < MONTH(DATE_ADD(?, INTERVAL 14 HOUR)))
        ORDER BY ub.user_id, ub.book_id LIMIT ?`, [afterUser, afterUser, afterBook, now, now, now, limit],
      );
      let count = 0;
      for (const candidate of candidates) {
        const [[user]] = await connection.query("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND purged_at IS NULL FOR UPDATE", [candidate.user_id]);
        if (!user) continue;
        const [[book]] = await connection.query("SELECT postponed_month, postponed_year, postponed_timezone, postponed_notified_at FROM user_books WHERE user_id = ? AND book_id = ? AND reading_status = 'postponed' FOR UPDATE", [candidate.user_id, candidate.book_id]);
        if (!book || book.postponed_notified_at || !postponedOverdue(book.postponed_month, book.postponed_year, book.postponed_timezone ?? "UTC", now)) continue;
        await connection.query("INSERT INTO notifications (user_id, actor_user_id, notification_type, title, body, material_kind, material_id, group_key) VALUES (?, NULL, 'postponed_book', 'Пора вернуться к книге', 'Срок отложенной книги уже наступил.', 'book', ?, NULL)", [candidate.user_id, candidate.book_id]);
        const [updated] = await connection.query("UPDATE user_books SET postponed_notified_at = UTC_TIMESTAMP() WHERE user_id = ? AND book_id = ? AND postponed_notified_at IS NULL", [candidate.user_id, candidate.book_id]);
        if (updated.affectedRows) count += 1;
      }
      return { delivered: count, size: candidates.length, last: candidates.at(-1) };
    });
    delivered += batch.delivered;
    if (batch.size < limit) break;
    afterUser = Number(batch.last.user_id);
    afterBook = Number(batch.last.book_id);
  }
  if (delivered) broadcast();
  return delivered;
}
