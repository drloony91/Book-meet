ALTER TABLE users
  ADD COLUMN deleted_at DATETIME NULL AFTER profile_completed,
  ADD COLUMN deletion_expires_at DATETIME NULL AFTER deleted_at,
  ADD COLUMN purged_at DATETIME NULL AFTER deletion_expires_at,
  ADD KEY users_deletion_state_idx (deleted_at, deletion_expires_at, purged_at);

