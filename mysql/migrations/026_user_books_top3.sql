ALTER TABLE user_books
  ADD COLUMN top_rank TINYINT UNSIGNED NULL AFTER reading_status,
  ADD CONSTRAINT chk_user_books_top_rank CHECK (top_rank BETWEEN 1 AND 3),
  ADD UNIQUE KEY uq_user_books_user_top_rank (user_id, top_rank);
