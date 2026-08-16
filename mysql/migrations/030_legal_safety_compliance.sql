CREATE TABLE IF NOT EXISTS legal_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_type ENUM('user_agreement', 'privacy_policy', 'personal_data_consent') NOT NULL,
  version VARCHAR(40) NOT NULL,
  language_code ENUM('ru', 'kk', 'en') NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  file_name VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  requires_reacceptance TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by_user_id BIGINT UNSIGNED NULL,
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_legal_document_version_language (document_type, version, language_code),
  KEY idx_legal_documents_active (document_type, language_code, is_active),
  CONSTRAINT fk_legal_documents_admin FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('user_agreement', 'privacy_policy', 'personal_data_consent') NOT NULL,
  document_version VARCHAR(40) NOT NULL,
  language_code ENUM('ru', 'kk', 'en') NOT NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_legal_acceptance_user_document (user_id, document_id),
  KEY idx_legal_acceptances_user_type (user_id, document_type, accepted_at),
  CONSTRAINT fk_legal_acceptances_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_legal_acceptances_document FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
  ADD COLUMN preferred_locale ENUM('ru', 'kk', 'en') NOT NULL DEFAULT 'ru' AFTER profile_completed,
  ADD COLUMN consent_withdrawn_at DATETIME NULL AFTER purged_at,
  ADD COLUMN telegram_notifications_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER telegram_subject,
  ADD COLUMN telegram_notification_categories LONGTEXT NULL AFTER telegram_notifications_enabled;

ALTER TABLE sessions
  ADD COLUMN last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER created_at,
  ADD COLUMN ip_hash CHAR(64) NULL AFTER last_seen_at,
  ADD COLUMN user_agent_hash CHAR(64) NULL AFTER ip_hash;

ALTER TABLE reports DROP FOREIGN KEY fk_reports_reporter;
ALTER TABLE reports MODIFY reporter_user_id BIGINT UNSIGNED NULL;
ALTER TABLE reports
  ADD COLUMN reference_code VARCHAR(32) NULL AFTER id,
  ADD COLUMN reporter_anonymized TINYINT(1) NOT NULL DEFAULT 0 AFTER reporter_user_id,
  ADD COLUMN due_at DATETIME NULL AFTER created_at,
  ADD COLUMN motivated_response TEXT NULL AFTER reviewed_at,
  ADD COLUMN response_at DATETIME NULL AFTER motivated_response,
  ADD COLUMN appealed_at DATETIME NULL AFTER response_at,
  ADD COLUMN appeal_text TEXT NULL AFTER appealed_at,
  ADD UNIQUE KEY uq_reports_reference_code (reference_code),
  ADD KEY idx_reports_due (status, due_at),
  ADD CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE SET NULL;

UPDATE reports
   SET reference_code = CONCAT('BMC-', YEAR(created_at), '-', LPAD(id, 6, '0')),
       due_at = DATE_ADD(DATE(created_at), INTERVAL 21 DAY),
       status = CASE WHEN status = 'reviewed' THEN 'satisfied' ELSE status END
 WHERE reference_code IS NULL;

ALTER TABLE reports MODIFY reference_code VARCHAR(32) NOT NULL;

CREATE TABLE IF NOT EXISTS report_status_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  old_status VARCHAR(20) NULL,
  new_status VARCHAR(20) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_report_history_report (report_id, created_at),
  CONSTRAINT fk_report_history_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_history_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO report_status_history (report_id, actor_user_id, old_status, new_status, note, created_at)
SELECT id, reviewed_by_user_id, NULL, status, motivated_response, created_at FROM reports;

CREATE TABLE IF NOT EXISTS report_appeals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_id BIGINT UNSIGNED NOT NULL,
  appellant_user_id BIGINT UNSIGNED NULL,
  appeal_text TEXT NOT NULL,
  status ENUM('new', 'reviewing', 'satisfied', 'rejected') NOT NULL DEFAULT 'new',
  response_text TEXT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_report_appeals_report (report_id, created_at),
  CONSTRAINT fk_report_appeals_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_appeals_appellant FOREIGN KEY (appellant_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_report_appeals_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS moderation_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(80) NOT NULL,
  object_type VARCHAR(40) NOT NULL,
  object_id BIGINT UNSIGNED NULL,
  old_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NULL,
  reason TEXT NULL,
  report_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_moderation_audit_created (created_at),
  KEY idx_moderation_audit_object (object_type, object_id),
  CONSTRAINT fk_moderation_audit_admin FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_moderation_audit_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS security_event_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) NOT NULL,
  result VARCHAR(32) NOT NULL,
  ip_hash CHAR(64) NULL,
  user_agent_hash CHAR(64) NULL,
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_security_event_created (created_at),
  KEY idx_security_event_user (user_id, created_at),
  CONSTRAINT fk_security_event_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS security_incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  incident_code VARCHAR(32) NOT NULL,
  detected_at DATETIME NOT NULL,
  description TEXT NOT NULL,
  affected_data TEXT NOT NULL,
  affected_user_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  cause TEXT NOT NULL,
  measures TEXT NOT NULL,
  resolved_at DATETIME NULL,
  authority_notified_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_security_incident_code (incident_code),
  KEY idx_security_incidents_detected (detected_at),
  CONSTRAINT fk_security_incident_admin FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finalized_profile_deletions (
  user_id BIGINT UNSIGNED NOT NULL,
  tombstone_key CHAR(64) NOT NULL,
  finalized_at DATETIME NOT NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_finalized_deletion_tombstone (tombstone_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
