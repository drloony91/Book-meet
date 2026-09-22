ALTER TABLE messages
  ADD COLUMN deleted_at DATETIME NULL AFTER edited_at,
  ADD COLUMN deleted_by_sender_at DATETIME NULL AFTER deleted_at,
  ADD COLUMN deleted_before_read TINYINT(1) NOT NULL DEFAULT 0 AFTER deleted_by_sender_at,
  ADD COLUMN moderation_retained_until DATETIME NULL AFTER deleted_before_read,
  ADD KEY messages_visible_recipient_idx (recipient_user_id, deleted_before_read, read_at, created_at);

CREATE TABLE message_deletion_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NULL,
  message_reference_id BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NULL,
  sender_reference_id BIGINT UNSIGNED NOT NULL,
  recipient_user_id BIGINT UNSIGNED NULL,
  recipient_reference_id BIGINT UNSIGNED NOT NULL,
  original_body TEXT NOT NULL,
  attachment_kind VARCHAR(30) NULL,
  attachment_id BIGINT UNSIGNED NULL,
  was_read TINYINT(1) NOT NULL,
  original_read_at DATETIME NULL,
  deleted_before_read TINYINT(1) NOT NULL,
  deleted_at DATETIME NOT NULL,
  moderation_retained_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_message_deletion_evidence_reference (message_reference_id),
  KEY message_deletion_evidence_message_fk (message_id),
  KEY message_deletion_evidence_sender_cursor (sender_reference_id, created_at),
  KEY message_deletion_evidence_recipient_cursor (recipient_reference_id, created_at),
  CONSTRAINT fk_message_deletion_evidence_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_message_deletion_evidence_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_message_deletion_evidence_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_message_deletion_evidence_read_state CHECK (deleted_before_read = 0 OR was_read = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
