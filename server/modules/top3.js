export function nextTopRank(rows, bookId) {
  const current = rows.find((row) => Number(row.book_id ?? row.id) === Number(bookId));
  if (current?.top_rank) return Number(current.top_rank);
  const occupied = new Set(rows.map((row) => Number(row.top_rank ?? row.topRank)).filter((rank) => rank >= 1 && rank <= 3));
  return [1, 2, 3].find((rank) => !occupied.has(rank)) ?? null;
}

export function top3Eligibility({ isAuthor, readingStatus }) {
  if (isAuthor) return { allowed: false, reason: "author-copy" };
  if (readingStatus !== "read") return { allowed: false, reason: "not-read" };
  return { allowed: true };
}
