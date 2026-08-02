ALTER TABLE users
  ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user' AFTER color;

UPDATE users SET role = 'admin' WHERE username_key = 'тест 1';

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  creator_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary TEXT NOT NULL,
  description LONGTEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TIME NOT NULL,
  city VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL,
  map_url VARCHAR(1000) NULL,
  details_url VARCHAR(1000) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  moderation_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY events_status_date_idx (status, event_date, event_time),
  KEY events_creator_idx (creator_user_id, status),
  CONSTRAINT events_creator_fk FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
