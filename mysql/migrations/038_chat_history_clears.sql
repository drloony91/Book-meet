CREATE TABLE IF NOT EXISTS chat_history_clears (
  user_id BIGINT UNSIGNED NOT NULL,
  peer_user_id BIGINT UNSIGNED NOT NULL,
  cleared_through_message_id BIGINT UNSIGNED NOT NULL,
  cleared_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, peer_user_id),
  KEY chat_history_clears_peer_idx (peer_user_id, user_id),
  CONSTRAINT chat_history_clears_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chat_history_clears_peer_fk FOREIGN KEY (peer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_chat_history_clears_distinct CHECK (user_id <> peer_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM notifications WHERE notification_type = 'new_message';
