-- Несколько книг в материалах, место встречи и серверная настройка главной страницы.

ALTER TABLE profiles
  ADD COLUMN home_view VARCHAR(12) NOT NULL DEFAULT 'feed' AFTER profile_tab_order;

ALTER TABLE occasions
  ADD COLUMN meeting_city VARCHAR(120) NULL AFTER meeting_end_time,
  ADD COLUMN meeting_city_id BIGINT UNSIGNED NULL AFTER meeting_city,
  ADD COLUMN meeting_address VARCHAR(255) NULL AFTER meeting_city_id,
  ADD COLUMN meeting_map_url VARCHAR(1000) NULL AFTER meeting_address,
  ADD COLUMN book_id BIGINT UNSIGNED NULL AFTER meeting_map_url,
  ADD KEY occasions_meeting_city_idx (meeting_city_id),
  ADD KEY occasions_book_idx (book_id),
  ADD CONSTRAINT occasions_meeting_city_fk FOREIGN KEY (meeting_city_id) REFERENCES cities(id) ON DELETE SET NULL,
  ADD CONSTRAINT occasions_book_fk FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS material_books (
  material_kind VARCHAR(20) NOT NULL,
  material_id BIGINT UNSIGNED NOT NULL,
  book_id BIGINT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (material_kind, material_id, book_id),
  KEY material_books_order_idx (material_kind, material_id, position),
  KEY material_books_book_idx (book_id),
  CONSTRAINT material_books_book_fk FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO material_books (material_kind, material_id, book_id, position)
SELECT 'event', id, book_id, 0 FROM events WHERE book_id IS NOT NULL;

INSERT IGNORE INTO material_books (material_kind, material_id, book_id, position)
SELECT 'excerpt', id, book_id, 0 FROM excerpts WHERE book_id IS NOT NULL;

INSERT IGNORE INTO material_books (material_kind, material_id, book_id, position)
SELECT 'review', id, book_id, 0 FROM reviews WHERE book_id IS NOT NULL;

ALTER TABLE books
  DROP INDEX books_author_title_unique,
  ADD KEY books_author_title_idx (author_key, title_key);
