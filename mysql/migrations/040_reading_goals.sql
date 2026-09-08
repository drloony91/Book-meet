CREATE TABLE IF NOT EXISTS reading_goals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  goal_kind ENUM('month', 'year') NOT NULL,
  target_count INT UNSIGNED NOT NULL,
  target_month TINYINT UNSIGNED NULL,
  target_year SMALLINT UNSIGNED NOT NULL,
  start_month TINYINT UNSIGNED NULL,
  goal_month_slot TINYINT UNSIGNED AS (COALESCE(target_month, 0)) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY reading_goals_owner_period_unique (user_id, goal_kind, target_year, goal_month_slot),
  CONSTRAINT reading_goals_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT reading_goals_target_count_check CHECK (target_count > 0),
  CONSTRAINT reading_goals_year_check CHECK (target_year BETWEEN 1900 AND 65535),
  CONSTRAINT reading_goals_period_check CHECK ((goal_kind = 'month' AND target_month IS NOT NULL AND target_month BETWEEN 1 AND 12 AND start_month IS NULL) OR (goal_kind = 'year' AND target_month IS NULL AND start_month IS NOT NULL AND start_month BETWEEN 1 AND 2))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
