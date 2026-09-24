ALTER TABLE profiles
  ADD COLUMN birth_date DATE NULL AFTER gender,
  ADD COLUMN show_birth_date_to_friends TINYINT(1) NOT NULL DEFAULT 0 AFTER birth_date,
  ADD COLUMN profile_tab_order LONGTEXT NULL AFTER show_birth_date_to_friends;

ALTER TABLE user_books
  ADD COLUMN last_read_chapter INT UNSIGNED NULL AFTER reading_status,
  ADD COLUMN reading_comment TEXT NULL AFTER last_read_chapter;

ALTER TABLE books ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER annotation;
ALTER TABLE reviews ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER body;
ALTER TABLE excerpts ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER body;
ALTER TABLE events ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER description;
ALTER TABLE occasions ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER audience_text;
ALTER TABLE publisher_news ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER body;

UPDATE users u
JOIN profiles p ON p.user_id = u.id
   SET u.profile_completed = 0
 WHERE p.profile_type IN ('Читатель', 'Писатель', 'Блогер')
   AND p.birth_date IS NULL;
