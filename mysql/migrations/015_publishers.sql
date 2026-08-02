ALTER TABLE profiles
  ADD COLUMN publisher_status VARCHAR(30) NOT NULL DEFAULT 'not_required' AFTER disliked_genres,
  ADD COLUMN publisher_website VARCHAR(1000) NULL AFTER publisher_status,
  ADD COLUMN publisher_sales_links LONGTEXT NULL AFTER publisher_website,
  ADD COLUMN publisher_legal_name VARCHAR(255) NULL AFTER publisher_sales_links,
  ADD COLUMN publisher_bin VARCHAR(32) NULL AFTER publisher_legal_name,
  ADD COLUMN publisher_account VARCHAR(120) NULL AFTER publisher_bin,
  ADD COLUMN publisher_bik VARCHAR(64) NULL AFTER publisher_account,
  ADD COLUMN publisher_bank VARCHAR(255) NULL AFTER publisher_bik,
  ADD COLUMN publisher_legal_address VARCHAR(500) NULL AFTER publisher_bank,
  ADD COLUMN publisher_postal_address VARCHAR(500) NULL AFTER publisher_legal_address,
  ADD COLUMN publisher_moderation_note TEXT NULL AFTER publisher_postal_address;

CREATE TABLE IF NOT EXISTS publisher_news (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  preview_text TEXT NOT NULL,
  body_html LONGTEXT NOT NULL,
  body LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY publisher_news_user_idx (user_id, created_at),
  CONSTRAINT publisher_news_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
