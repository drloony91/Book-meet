ALTER TABLE profiles
  ADD COLUMN community_type VARCHAR(255) NULL AFTER publisher_moderation_note,
  ADD COLUMN community_rules TEXT NULL AFTER community_type,
  ADD COLUMN hidden_profile_tabs LONGTEXT NULL AFTER profile_tab_order;

DELETE notification
FROM notifications notification
JOIN profiles recipient_profile ON recipient_profile.user_id = notification.user_id
LEFT JOIN profiles actor_profile ON actor_profile.user_id = notification.actor_user_id
WHERE notification.notification_type = 'friend_request'
  AND recipient_profile.profile_type <> 'Сообщество'
  AND (recipient_profile.profile_type = 'Издатель' OR actor_profile.profile_type = 'Издатель');

DELETE fr
FROM friend_requests fr
JOIN profiles source_profile ON source_profile.user_id = fr.from_user_id
JOIN profiles target_profile ON target_profile.user_id = fr.to_user_id
WHERE fr.status = 'pending'
  AND target_profile.profile_type <> 'Сообщество'
  AND (source_profile.profile_type = 'Издатель' OR target_profile.profile_type = 'Издатель');
