CREATE TABLE conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_type ENUM('direct', 'group', 'marketplace') NOT NULL,
  direct_user_low_id BIGINT UNSIGNED NULL,
  direct_user_high_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NULL,
  avatar_path VARCHAR(500) NULL,
  created_actor_type ENUM('user', 'community', 'publisher', 'system') NULL,
  created_actor_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  add_members_policy ENUM('owner_only', 'owner_or_moderators', 'members') NOT NULL DEFAULT 'owner_only',
  remove_members_policy ENUM('owner_only', 'owner_or_moderators') NOT NULL DEFAULT 'owner_only',
  state ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
  history_cleared_at DATETIME NULL,
  history_cleared_message_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversations_direct_pair (conversation_type, direct_user_low_id, direct_user_high_id),
  KEY conversations_creator_idx (created_by_user_id, created_at),
  KEY conversations_history_clear_idx (history_cleared_message_id),
  CONSTRAINT fk_conversations_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_conversations_history_cleared_message FOREIGN KEY (history_cleared_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT chk_conversations_direct_pair CHECK (
    (conversation_type = 'direct' AND direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL AND direct_user_low_id < direct_user_high_id)
    OR (conversation_type IN ('group', 'marketplace') AND direct_user_low_id IS NULL AND direct_user_high_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversation_members (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner', 'moderator', 'member') NOT NULL DEFAULT 'member',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at DATETIME NULL,
  settings_json JSON NULL,
  PRIMARY KEY (conversation_id, user_id),
  KEY conversation_members_active_user_idx (user_id, left_at, conversation_id),
  CONSTRAINT fk_conversation_members_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_conversation_members_left_after_joined CHECK (left_at IS NULL OR left_at >= joined_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A durable audit of pre-existing rows whose pair cannot be recovered. These
-- rows deliberately remain inaccessible to the future conversation boundary.
CREATE TABLE conversation_backfill_orphans (
  message_reference_id BIGINT UNSIGNED NOT NULL,
  recipient_reference_id BIGINT UNSIGNED NOT NULL,
  message_id BIGINT UNSIGNED NULL,
  recipient_user_id BIGINT UNSIGNED NULL,
  reason ENUM('missing_sender_identity', 'self_pair') NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_reference_id),
  KEY conversation_backfill_orphans_message_idx (message_id),
  KEY conversation_backfill_orphans_recipient_idx (recipient_user_id, recorded_at),
  CONSTRAINT fk_conversation_backfill_orphans_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_conversation_backfill_orphans_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- This closed operational record is the release-audit reconciliation snapshot,
-- not an application data source. It deliberately has no live-data foreign keys.
CREATE TABLE conversation_backfill_reconciliations (
  migration_name VARCHAR(190) NOT NULL,
  source_message_total BIGINT UNSIGNED NOT NULL,
  mapped_message_total BIGINT UNSIGNED NOT NULL,
  orphan_message_total BIGINT UNSIGNED NOT NULL,
  direct_conversation_total BIGINT UNSIGNED NOT NULL,
  active_membership_total BIGINT UNSIGNED NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (migration_name),
  CONSTRAINT chk_conversation_backfill_reconciliation_totals CHECK (source_message_total = mapped_message_total + orphan_message_total)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE messages
  ADD COLUMN conversation_id BIGINT UNSIGNED NULL AFTER recipient_user_id,
  ADD KEY messages_conversation_created_idx (conversation_id, created_at, id),
  ADD CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

-- Direct-pair identifiers are historical canonical IDs rather than user FKs so
-- that a sender anonymized by ON DELETE SET NULL can still be paired from its
-- retained deletion evidence without restoring access for that deleted account.
INSERT INTO conversations (conversation_type, direct_user_low_id, direct_user_high_id, created_at, updated_at)
SELECT
  'direct',
  pairs.direct_user_low_id,
  pairs.direct_user_high_id,
  MIN(pairs.created_at),
  MAX(pairs.created_at)
FROM (
  SELECT
    LEAST(COALESCE(m.sender_user_id, evidence.sender_reference_id), m.recipient_user_id) AS direct_user_low_id,
    GREATEST(COALESCE(m.sender_user_id, evidence.sender_reference_id), m.recipient_user_id) AS direct_user_high_id,
    m.created_at
  FROM messages m
  LEFT JOIN message_deletion_evidence evidence ON evidence.message_reference_id = m.id
  WHERE COALESCE(m.sender_user_id, evidence.sender_reference_id) IS NOT NULL
    AND COALESCE(m.sender_user_id, evidence.sender_reference_id) <> m.recipient_user_id
) pairs
GROUP BY pairs.direct_user_low_id, pairs.direct_user_high_id;

INSERT INTO conversation_members (conversation_id, user_id, role, joined_at)
SELECT conversations.id, users.id, 'member', conversations.created_at
FROM conversations
JOIN users ON users.id IN (conversations.direct_user_low_id, conversations.direct_user_high_id)
  AND users.deleted_at IS NULL
  AND users.purged_at IS NULL
WHERE conversations.conversation_type = 'direct';

UPDATE messages m
LEFT JOIN message_deletion_evidence evidence ON evidence.message_reference_id = m.id
JOIN conversations ON conversations.conversation_type = 'direct'
  AND conversations.direct_user_low_id = LEAST(COALESCE(m.sender_user_id, evidence.sender_reference_id), m.recipient_user_id)
  AND conversations.direct_user_high_id = GREATEST(COALESCE(m.sender_user_id, evidence.sender_reference_id), m.recipient_user_id)
SET m.conversation_id = conversations.id
WHERE COALESCE(m.sender_user_id, evidence.sender_reference_id) IS NOT NULL
  AND COALESCE(m.sender_user_id, evidence.sender_reference_id) <> m.recipient_user_id;

INSERT INTO conversation_backfill_orphans (message_reference_id, recipient_reference_id, message_id, recipient_user_id, reason)
SELECT
  m.id,
  m.recipient_user_id,
  m.id,
  m.recipient_user_id,
  CASE
    WHEN COALESCE(m.sender_user_id, evidence.sender_reference_id) IS NULL THEN 'missing_sender_identity'
    ELSE 'self_pair'
  END
FROM messages m
LEFT JOIN message_deletion_evidence evidence ON evidence.message_reference_id = m.id
WHERE m.conversation_id IS NULL;

INSERT INTO conversation_backfill_reconciliations (
  migration_name,
  source_message_total,
  mapped_message_total,
  orphan_message_total,
  direct_conversation_total,
  active_membership_total
)
SELECT
  '052_unified_conversations_stop_point.sql',
  (SELECT COUNT(*) FROM messages),
  (SELECT COUNT(*) FROM messages WHERE conversation_id IS NOT NULL),
  (SELECT COUNT(*) FROM conversation_backfill_orphans),
  (SELECT COUNT(*) FROM conversations WHERE conversation_type = 'direct'),
  (SELECT COUNT(*) FROM conversation_members WHERE left_at IS NULL);
