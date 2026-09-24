ALTER TABLE user_books
  ADD COLUMN featured_month TINYINT UNSIGNED NULL AFTER reading_comment,
  ADD COLUMN featured_year SMALLINT UNSIGNED NULL AFTER featured_month,
  ADD CONSTRAINT chk_user_books_featured_month CHECK (featured_month IS NULL OR featured_month BETWEEN 1 AND 12),
  ADD CONSTRAINT chk_user_books_featured_pair CHECK ((featured_month IS NULL AND featured_year IS NULL) OR (featured_month IS NOT NULL AND featured_year BETWEEN 2000 AND 2100)),
  ADD KEY user_books_featured_idx (user_id, featured_year, featured_month);
