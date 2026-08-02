ALTER TABLE books
  ADD COLUMN flip_url VARCHAR(1000) NULL AFTER cover_tone;

ALTER TABLE user_books
  ADD COLUMN read_month TINYINT UNSIGNED NULL AFTER short_review,
  ADD COLUMN read_year SMALLINT UNSIGNED NULL AFTER read_month;

ALTER TABLE wishlist_items
  ADD COLUMN recipient_name VARCHAR(255) NOT NULL DEFAULT '' AFTER pickup_address;
