ALTER TABLE sessions
  ADD COLUMN operator_user_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD KEY sessions_operator_idx (operator_user_id, expires_at),
  ADD CONSTRAINT fk_sessions_operator_user FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE SET NULL;

UPDATE sessions SET operator_user_id = user_id WHERE operator_user_id IS NULL;

ALTER TABLE conversation_members
  ADD COLUMN last_read_message_id BIGINT UNSIGNED NULL AFTER left_at,
  ADD COLUMN last_read_at DATETIME NULL AFTER last_read_message_id,
  ADD KEY conversation_members_read_idx (conversation_id, user_id, last_read_message_id);

ALTER TABLE messages
  MODIFY COLUMN recipient_user_id BIGINT UNSIGNED NULL,
  ADD KEY messages_conversation_read_idx (conversation_id, read_at, id),
  ADD KEY messages_conversation_search_idx (conversation_id, created_at, id),
  ADD COLUMN group_deleted_by_role ENUM('owner', 'moderator') NULL AFTER moderation_retained_until;

-- Group author deletion retains the same private evidence record as a direct
-- message, but a group has no single recipient reference.
ALTER TABLE message_deletion_evidence
  MODIFY COLUMN recipient_reference_id BIGINT UNSIGNED NULL;

CREATE TABLE conversation_polls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  message_id BIGINT UNSIGNED NOT NULL,
  creator_user_id BIGINT UNSIGNED NULL,
  question VARCHAR(500) NOT NULL,
  allows_multiple TINYINT(1) NOT NULL DEFAULT 0,
  may_change_vote TINYINT(1) NOT NULL DEFAULT 1,
  closes_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversation_polls_message (message_id),
  KEY conversation_polls_conversation_idx (conversation_id, closes_at, id),
  CONSTRAINT fk_conversation_polls_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_polls_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_conversation_polls_creator FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_conversation_polls_close_after_create CHECK (closes_at IS NULL OR closes_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversation_poll_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  poll_id BIGINT UNSIGNED NOT NULL,
  option_order TINYINT UNSIGNED NOT NULL,
  body VARCHAR(300) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversation_poll_option_poll_id (poll_id, id),
  UNIQUE KEY uq_conversation_poll_option_order (poll_id, option_order),
  UNIQUE KEY uq_conversation_poll_option_body (poll_id, body),
  CONSTRAINT fk_conversation_poll_options_poll FOREIGN KEY (poll_id) REFERENCES conversation_polls(id) ON DELETE CASCADE,
  CONSTRAINT chk_conversation_poll_option_order CHECK (option_order BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversation_poll_votes (
  poll_id BIGINT UNSIGNED NOT NULL,
  option_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (poll_id, option_id, user_id),
  KEY conversation_poll_votes_user_idx (poll_id, user_id),
  CONSTRAINT fk_conversation_poll_votes_option_for_poll FOREIGN KEY (poll_id, option_id) REFERENCES conversation_poll_options(poll_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_poll_votes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE group_message_moderation_evidence (
  message_reference_id BIGINT UNSIGNED NOT NULL,
  message_id BIGINT UNSIGNED NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  author_reference_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NULL,
  deleter_reference_id BIGINT UNSIGNED NOT NULL,
  deleted_by_user_id BIGINT UNSIGNED NULL,
  deleted_by_role ENUM('owner', 'moderator') NOT NULL,
  original_body TEXT NOT NULL,
  original_message_kind VARCHAR(30) NOT NULL,
  original_sticker_id VARCHAR(80) NULL,
  original_attachment_kind VARCHAR(30) NULL,
  original_attachment_id BIGINT UNSIGNED NULL,
  deleted_at DATETIME NOT NULL,
  PRIMARY KEY (message_reference_id),
  KEY group_message_moderation_evidence_conversation_idx (conversation_id, deleted_at),
  KEY group_message_moderation_evidence_message_idx (message_id),
  CONSTRAINT fk_group_message_moderation_evidence_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_group_message_moderation_evidence_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_group_message_moderation_evidence_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_group_message_moderation_evidence_deleter FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
