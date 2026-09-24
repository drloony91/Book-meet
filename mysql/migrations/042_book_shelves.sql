CREATE TABLE IF NOT EXISTS book_shelves (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY book_shelves_owner_cursor (owner_user_id, id DESC),
  CONSTRAINT book_shelves_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT book_shelves_title_check CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 120),
  CONSTRAINT book_shelves_description_check CHECK (CHAR_LENGTH(description) <= 500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE material_saves
  MODIFY COLUMN material_kind ENUM('book', 'review', 'excerpt', 'event', 'occasion', 'publisher_news', 'shelf') NOT NULL;

CREATE TABLE IF NOT EXISTS book_shelf_items (
  shelf_id BIGINT UNSIGNED NOT NULL,
  book_id BIGINT UNSIGNED NULL,
  position INT UNSIGNED NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (shelf_id, position),
  UNIQUE KEY book_shelf_items_unique_book (shelf_id, book_id),
  KEY book_shelf_items_book (book_id),
  CONSTRAINT book_shelf_items_shelf_fk FOREIGN KEY (shelf_id) REFERENCES book_shelves(id) ON DELETE CASCADE,
  CONSTRAINT book_shelf_items_book_fk FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
  CONSTRAINT book_shelf_items_description_check CHECK (CHAR_LENGTH(description) <= 500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
