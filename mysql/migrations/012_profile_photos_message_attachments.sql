ALTER TABLE users
  ADD COLUMN avatar_path VARCHAR(500) NULL AFTER color;

ALTER TABLE messages
  ADD COLUMN attachment_kind VARCHAR(20) NULL AFTER body,
  ADD COLUMN attachment_id BIGINT UNSIGNED NULL AFTER attachment_kind,
  ADD KEY messages_attachment_idx (attachment_kind, attachment_id);
