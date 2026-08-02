ALTER TABLE users
  ADD COLUMN email VARCHAR(254) NULL AFTER username_key,
  ADD COLUMN email_key VARCHAR(254) NULL AFTER email,
  ADD COLUMN google_subject VARCHAR(255) NULL AFTER password_hash,
  ADD COLUMN telegram_subject VARCHAR(255) NULL AFTER google_subject,
  ADD COLUMN totp_secret VARCHAR(128) NULL AFTER telegram_subject,
  ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER totp_secret,
  ADD COLUMN profile_completed TINYINT(1) NOT NULL DEFAULT 1 AFTER totp_enabled,
  ADD UNIQUE KEY users_email_key_unique (email_key),
  ADD UNIQUE KEY users_google_subject_unique (google_subject),
  ADD UNIQUE KEY users_telegram_subject_unique (telegram_subject);

UPDATE users
   SET email = 'dr.loony91@gmail.com',
       email_key = 'dr.loony91@gmail.com'
 WHERE role = 'admin';

DELETE FROM users
 WHERE username_key = 'тест 2'
   AND role <> 'admin';
