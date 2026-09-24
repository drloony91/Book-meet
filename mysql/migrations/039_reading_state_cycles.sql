ALTER TABLE user_books
  MODIFY COLUMN reading_status ENUM('want', 'reading', 'read', 'abandoned', 'postponed') NOT NULL DEFAULT 'read',
  ADD COLUMN chapters_current INT UNSIGNED NULL AFTER last_read_chapter,
  ADD COLUMN chapters_total INT UNSIGNED NULL AFTER chapters_current,
  ADD COLUMN pages_current INT UNSIGNED NULL AFTER chapters_total,
  ADD COLUMN pages_total INT UNSIGNED NULL AFTER pages_current,
  ADD COLUMN progress_unit VARCHAR(16) NULL AFTER pages_total,
  ADD COLUMN postponed_month TINYINT UNSIGNED NULL AFTER progress_unit,
  ADD COLUMN postponed_year SMALLINT UNSIGNED NULL AFTER postponed_month,
  ADD COLUMN postponed_notified_at DATETIME NULL AFTER postponed_year,
  ADD COLUMN postponed_timezone VARCHAR(64) NOT NULL DEFAULT 'UTC' AFTER postponed_notified_at,
  ADD CONSTRAINT chk_user_books_reading_status_039 CHECK (reading_status IN ('want', 'reading', 'read', 'abandoned', 'postponed')),
  ADD CONSTRAINT chk_user_books_progress_unit_039 CHECK (progress_unit IS NULL OR progress_unit IN ('chapters', 'pages')),
  ADD CONSTRAINT chk_user_books_progress_values_039 CHECK ((chapters_total IS NULL OR chapters_total > 0) AND (pages_total IS NULL OR pages_total > 0) AND (chapters_total IS NULL OR chapters_current IS NULL OR chapters_current <= chapters_total) AND (pages_total IS NULL OR pages_current IS NULL OR pages_current <= pages_total)),
  ADD CONSTRAINT chk_user_books_postponed_month_039 CHECK (postponed_month IS NULL OR postponed_month BETWEEN 1 AND 12),
  ADD CONSTRAINT chk_user_books_postponed_year_039 CHECK (postponed_year IS NULL OR postponed_year BETWEEN 1900 AND 2100);

UPDATE user_books
   SET chapters_current = last_read_chapter,
       progress_unit = 'chapters'
 WHERE last_read_chapter IS NOT NULL AND last_read_chapter >= 0;

UPDATE user_books
   SET read_month = NULL
 WHERE read_month IS NOT NULL AND read_month NOT BETWEEN 1 AND 12;

UPDATE user_books
   SET read_year = NULL
 WHERE read_year IS NOT NULL AND read_year NOT BETWEEN 1900 AND 2100;

CREATE TABLE IF NOT EXISTS reading_cycles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  book_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_month TINYINT UNSIGNED NULL,
  completed_year SMALLINT UNSIGNED NULL,
  completed_at DATETIME NULL,
  status VARCHAR(16) NOT NULL,
  active_slot TINYINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reading_cycles_active (user_id, book_id, active_slot),
  KEY idx_reading_cycles_history (user_id, completed_year, completed_month),
  CONSTRAINT chk_reading_cycles_status CHECK (status IN ('active', 'completed', 'abandoned', 'postponed')),
  CONSTRAINT chk_reading_cycles_completed_month CHECK (completed_month IS NULL OR completed_month BETWEEN 1 AND 12),
  CONSTRAINT chk_reading_cycles_completed_year CHECK (completed_year IS NULL OR completed_year BETWEEN 1900 AND 2100),
  CONSTRAINT reading_cycles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT reading_cycles_book_fk FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO reading_cycles (user_id, book_id, completed_month, completed_year, completed_at, status)
SELECT ub.user_id, ub.book_id, ub.read_month, ub.read_year, NULL, 'completed'
  FROM user_books ub
  JOIN profiles p ON p.user_id = ub.user_id
 WHERE ub.is_author = 0 AND p.profile_type IN ('Читатель', 'Писатель', 'Блогер') AND ub.reading_status = 'read';

INSERT INTO reading_cycles (user_id, book_id, status)
SELECT ub.user_id, ub.book_id, 'active'
  FROM user_books ub
  JOIN profiles p ON p.user_id = ub.user_id
 WHERE ub.is_author = 0 AND p.profile_type IN ('Читатель', 'Писатель', 'Блогер') AND ub.reading_status = 'reading';
