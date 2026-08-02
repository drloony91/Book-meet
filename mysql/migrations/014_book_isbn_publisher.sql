ALTER TABLE books
  ADD COLUMN isbn VARCHAR(32) NULL AFTER title_key,
  ADD COLUMN isbn_key VARCHAR(32) NULL AFTER isbn,
  ADD COLUMN publisher VARCHAR(255) NULL AFTER isbn_key,
  ADD UNIQUE KEY books_isbn_key_unique (isbn_key);
