CREATE TABLE IF NOT EXISTS user_hides (
  hider_user_id BIGINT UNSIGNED NOT NULL,
  hidden_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hider_user_id, hidden_user_id),
  CONSTRAINT user_hides_distinct_users_check CHECK (hider_user_id <> hidden_user_id),
  CONSTRAINT user_hides_hider_user_fk FOREIGN KEY (hider_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_hides_hidden_user_fk FOREIGN KEY (hidden_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS book_progress_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  book_id BIGINT UNSIGNED NOT NULL,
  reading_cycle_id BIGINT UNSIGNED NULL,
  body TEXT NOT NULL,
  progress_unit ENUM('chapters', 'pages') NOT NULL,
  progress_current INT UNSIGNED NOT NULL,
  progress_total INT UNSIGNED NOT NULL,
  progress_percent TINYINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY book_progress_notes_book_cursor (book_id, id DESC),
  KEY book_progress_notes_user_cursor (user_id, book_id, id DESC),
  CONSTRAINT book_progress_notes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT book_progress_notes_book_fk FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  CONSTRAINT book_progress_notes_cycle_fk FOREIGN KEY (reading_cycle_id) REFERENCES reading_cycles(id) ON DELETE SET NULL,
  CONSTRAINT book_progress_notes_body_check CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 3000),
  CONSTRAINT book_progress_notes_values_check CHECK (progress_total > 0 AND progress_current <= progress_total AND progress_percent = FLOOR(progress_current * 100 / progress_total))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
