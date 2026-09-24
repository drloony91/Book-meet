-- Operational ban on new marketplace listings; immutable decisions live in
-- moderation_audit_log even after this current-state row is cleared.
CREATE TABLE marketplace_seller_restrictions (
  seller_user_id BIGINT UNSIGNED NOT NULL,
  restricted_until DATETIME NULL,
  reason VARCHAR(2000) NOT NULL,
  moderator_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (seller_user_id),
  KEY marketplace_restrictions_until_idx (restricted_until),
  CONSTRAINT fk_marketplace_restriction_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_restriction_moderator FOREIGN KEY (moderator_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_marketplace_restriction_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
