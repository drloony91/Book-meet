CREATE TABLE linked_profiles (
  personal_user_id BIGINT UNSIGNED NOT NULL,
  community_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (personal_user_id),
  UNIQUE KEY uq_linked_profiles_community (community_user_id),
  CONSTRAINT fk_linked_profiles_personal FOREIGN KEY (personal_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_linked_profiles_community FOREIGN KEY (community_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_linked_profiles_distinct CHECK (personal_user_id <> community_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
