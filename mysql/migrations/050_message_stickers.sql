ALTER TABLE messages
  ADD COLUMN message_kind VARCHAR(16) NOT NULL DEFAULT 'text' AFTER is_system,
  ADD COLUMN sticker_id VARCHAR(64) NULL AFTER message_kind,
  ADD CONSTRAINT chk_messages_kind_and_sticker CHECK (
    (message_kind = 'text' AND sticker_id IS NULL)
    OR (message_kind = 'sticker' AND sticker_id IS NOT NULL AND body = '' AND attachment_kind IS NULL AND attachment_id IS NULL AND is_system = 0)
  );

ALTER TABLE message_deletion_evidence
  ADD COLUMN message_kind VARCHAR(16) NOT NULL DEFAULT 'text' AFTER original_body,
  ADD COLUMN sticker_id VARCHAR(64) NULL AFTER message_kind,
  ADD CONSTRAINT chk_message_deletion_evidence_kind_and_sticker CHECK (
    (message_kind = 'text' AND sticker_id IS NULL)
    OR (message_kind = 'sticker' AND sticker_id IS NOT NULL AND original_body = '' AND attachment_kind IS NULL AND attachment_id IS NULL)
  );
