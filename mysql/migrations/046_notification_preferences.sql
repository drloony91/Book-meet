ALTER TABLE users
  ADD COLUMN notification_timezone VARCHAR(64) NULL AFTER telegram_subject,
  ADD COLUMN telegram_user_id BIGINT UNSIGNED NULL AFTER notification_timezone,
  ADD COLUMN telegram_connected_at DATETIME NULL AFTER telegram_user_id,
  ADD UNIQUE KEY users_telegram_user_id_unique (telegram_user_id);

CREATE TABLE notification_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  category ENUM(
    'friendships_follows',
    'likes',
    'comments_replies',
    'mentions',
    'reposts',
    'events_communities',
    'reading_reminders',
    'system_security'
  ) NOT NULL,
  in_app_enabled TINYINT(1) NOT NULL DEFAULT 1,
  telegram_enabled TINYINT(1) NOT NULL DEFAULT 0,
  email_mode ENUM('off', 'immediate', 'daily') NOT NULL DEFAULT 'off',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, category),
  CONSTRAINT fk_notification_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_notification_preferences_system_in_app CHECK (category <> 'system_security' OR in_app_enabled = 1)
);
