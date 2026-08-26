ALTER TABLE user_books
  ADD COLUMN publication_month TINYINT UNSIGNED NULL AFTER featured_year,
  ADD COLUMN publication_year SMALLINT UNSIGNED NULL AFTER publication_month,
  ADD CONSTRAINT chk_user_books_publication_month CHECK (publication_month IS NULL OR publication_month BETWEEN 1 AND 12),
  ADD CONSTRAINT chk_user_books_publication_pair CHECK (
    (publication_month IS NULL AND publication_year IS NULL)
    OR (publication_month IS NOT NULL AND publication_year BETWEEN 1900 AND 2100)
  ),
  ADD KEY idx_user_books_publication_date (user_id, publication_year, publication_month);
