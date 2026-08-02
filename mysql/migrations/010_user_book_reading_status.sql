ALTER TABLE user_books
  ADD COLUMN reading_status ENUM('want', 'reading', 'read') NOT NULL DEFAULT 'read' AFTER read_year;
