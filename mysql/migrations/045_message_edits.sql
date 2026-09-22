ALTER TABLE messages
  ADD COLUMN edited_at TIMESTAMP NULL AFTER read_at;

CREATE TABLE IF NOT EXISTS message_edit_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NULL,
  message_reference_id BIGINT UNSIGNED NOT NULL,
  editor_user_id BIGINT UNSIGNED NULL,
  previous_body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY message_edit_history_message_cursor (message_reference_id, id),
  KEY message_edit_history_message_fk (message_id),
  KEY message_edit_history_editor_cursor (editor_user_id, created_at),
  CONSTRAINT message_edit_history_message_fk FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT message_edit_history_editor_fk FOREIGN KEY (editor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
