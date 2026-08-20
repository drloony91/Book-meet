ALTER TABLE users
  ADD COLUMN username_is_temporary TINYINT(1) NOT NULL DEFAULT 0 AFTER username_key;

-- Preserve old names during the rewrite so e-mail never becomes a public name.
CREATE TEMPORARY TABLE migration_032_usernames AS
SELECT id, LOWER(username) AS username
  FROM users;

-- First move every unique key to a value legacy generators could not have
-- emitted. This prevents a transient UNIQUE collision when, for example,
-- user #2 previously owned the otherwise-valid `user-1`.
UPDATE users
   SET username = CONCAT('#migration032#', id),
       username_key = CONCAT('#migration032#', id),
       username_is_temporary = 1;

-- Then allocate deterministic, valid, unique fallbacks. A later update only
-- restores legacy values that satisfy the new public-route policy.
UPDATE users
   SET username = CONCAT('user-', id),
       username_key = CONCAT('user-', id),
       username_is_temporary = 1;

UPDATE users u
JOIN migration_032_usernames legacy ON legacy.id = u.id
LEFT JOIN (
  SELECT username
    FROM migration_032_usernames
   WHERE username REGEXP '^[a-z0-9]([a-z0-9._-]{1,28})[a-z0-9]$'
     AND username NOT IN ('admin', 'api', 'auth', 'profile', 'users', 'books', 'events', 'reviews', 'blog', 'meet', 'chat', 'publishing', 'communities', 'notifications', 'login', 'register', 'settings', 'support', 'book-meet-return')
   GROUP BY username
  HAVING COUNT(*) = 1
) valid_unique ON valid_unique.username = legacy.username
   SET u.username = legacy.username,
       u.username_key = legacy.username,
       u.username_is_temporary = 0
 WHERE valid_unique.username IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM migration_032_usernames conflict
      WHERE conflict.id <> u.id AND CONCAT('user-', conflict.id) = legacy.username
   );

DROP TEMPORARY TABLE migration_032_usernames;

ALTER TABLE profiles
  ADD COLUMN community_is_closed TINYINT(1) NOT NULL DEFAULT 0 AFTER community_rules;

CREATE TABLE material_saves (
  user_id BIGINT UNSIGNED NOT NULL,
  material_kind ENUM('book', 'review', 'excerpt', 'event', 'occasion', 'publisher_news') NOT NULL,
  material_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, material_kind, material_id),
  KEY material_saves_material_idx (material_kind, material_id, created_at),
  CONSTRAINT material_saves_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
