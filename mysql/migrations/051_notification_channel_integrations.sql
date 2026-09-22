ALTER TABLE users
  ADD COLUMN telegram_display_name VARCHAR(120) NULL AFTER telegram_connected_at,
  ADD COLUMN telegram_delivery_error_at DATETIME NULL AFTER telegram_display_name;

CREATE TABLE telegram_link_tokens (
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_telegram_link_tokens_hash (token_hash),
  KEY idx_telegram_link_tokens_expiry (expires_at),
  CONSTRAINT fk_telegram_link_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
