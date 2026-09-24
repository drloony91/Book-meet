CREATE TABLE notification_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(64) NOT NULL,
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
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  material_kind VARCHAR(20) NULL,
  material_id BIGINT UNSIGNED NULL,
  dedupe_key VARCHAR(190) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notification_events_recipient_dedupe (recipient_user_id, dedupe_key),
  KEY idx_notification_events_material (material_kind, material_id),
  KEY idx_notification_events_created (recipient_user_id, created_at),
  CONSTRAINT fk_notification_events_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notifications
  ADD COLUMN notification_event_id BIGINT UNSIGNED NULL AFTER id,
  ADD UNIQUE KEY uq_notifications_event (notification_event_id),
  ADD CONSTRAINT fk_notifications_event FOREIGN KEY (notification_event_id) REFERENCES notification_events(id) ON DELETE SET NULL;

CREATE TABLE notification_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('in_app', 'telegram', 'email') NOT NULL,
  mode ENUM('immediate', 'daily') NOT NULL DEFAULT 'immediate',
  idempotency_key VARCHAR(190) NOT NULL,
  status ENUM('pending', 'processing', 'delivered', 'failed', 'cancelled') NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  digest_window_at DATETIME NULL,
  locked_at DATETIME NULL,
  locked_by VARCHAR(100) NULL,
  delivered_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  last_error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notification_deliveries_idempotency (idempotency_key),
  UNIQUE KEY uq_notification_deliveries_event_channel_mode (event_id, channel, mode),
  KEY idx_notification_deliveries_due (status, next_attempt_at, locked_at),
  KEY idx_notification_deliveries_digest (channel, mode, user_id, digest_window_at, status),
  KEY idx_notification_deliveries_user_channel (user_id, channel, status),
  CONSTRAINT fk_notification_deliveries_event FOREIGN KEY (event_id) REFERENCES notification_events(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_deliveries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_notification_deliveries_digest_window CHECK (channel <> 'email' OR mode <> 'daily' OR digest_window_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
