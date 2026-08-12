ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME NULL AFTER email_key,
  ADD COLUMN password_login_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER password_hash;

-- Existing accounts keep their current ability to sign in; verification is only pending for new password registrations.
UPDATE users
   SET email_verified_at = COALESCE(email_verified_at, created_at, UTC_TIMESTAMP());

CREATE TABLE account_action_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  purpose ENUM('email_verify', 'password_reset') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_action_tokens_hash (token_hash),
  KEY idx_account_action_tokens_lookup (purpose, token_hash, expires_at, consumed_at),
  KEY idx_account_action_tokens_user_purpose (user_id, purpose),
  CONSTRAINT fk_account_action_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
