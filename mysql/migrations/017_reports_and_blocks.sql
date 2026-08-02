CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_user_id BIGINT UNSIGNED NOT NULL,
  blocked_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CONSTRAINT fk_user_blocks_blocker FOREIGN KEY (blocker_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_blocks_blocked FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_user_id BIGINT UNSIGNED NOT NULL,
  target_kind VARCHAR(32) NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reports_status_created (status, created_at),
  KEY idx_reports_target (target_kind, target_id),
  CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_target_user FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_reports_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE users
  ADD COLUMN suspension_reason TEXT NULL,
  ADD COLUMN suspended_until DATETIME NULL,
  ADD COLUMN suspended_permanently TINYINT(1) NOT NULL DEFAULT 0;
