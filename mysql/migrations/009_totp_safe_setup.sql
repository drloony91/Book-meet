ALTER TABLE users
  ADD COLUMN totp_pending_secret VARCHAR(128) NULL AFTER totp_secret,
  ADD COLUMN totp_pending_expires_at DATETIME NULL AFTER totp_pending_secret,
  ADD COLUMN totp_recovery_codes JSON NULL AFTER totp_enabled;
