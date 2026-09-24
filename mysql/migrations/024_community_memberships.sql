CREATE TABLE IF NOT EXISTS community_memberships (
  community_user_id BIGINT UNSIGNED NOT NULL,
  member_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (community_user_id, member_user_id),
  KEY community_memberships_member_idx (member_user_id),
  CONSTRAINT community_memberships_community_fk FOREIGN KEY (community_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT community_memberships_member_fk FOREIGN KEY (member_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Before this migration, accepted membership was represented by friendships.
-- Only rows whose profile is already a community are converted: converting a
-- regular profile later intentionally does not make its existing friends members.
INSERT IGNORE INTO community_memberships (community_user_id, member_user_id, created_at)
SELECT CASE WHEN low_profile.profile_type = 'Сообщество' THEN f.user_low_id ELSE f.user_high_id END,
       CASE WHEN low_profile.profile_type = 'Сообщество' THEN f.user_high_id ELSE f.user_low_id END,
       f.created_at
  FROM friendships f
  JOIN profiles low_profile ON low_profile.user_id = f.user_low_id
  JOIN profiles high_profile ON high_profile.user_id = f.user_high_id
 WHERE (low_profile.profile_type = 'Сообщество' AND high_profile.profile_type <> 'Сообщество')
    OR (high_profile.profile_type = 'Сообщество' AND low_profile.profile_type <> 'Сообщество');

DELETE f FROM friendships f
  JOIN profiles low_profile ON low_profile.user_id = f.user_low_id
  JOIN profiles high_profile ON high_profile.user_id = f.user_high_id
 WHERE low_profile.profile_type = 'Сообщество' OR high_profile.profile_type = 'Сообщество';
