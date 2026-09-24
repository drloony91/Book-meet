ALTER TABLE profiles
  ADD COLUMN birth_date_visibility ENUM('nobody', 'friends', 'everyone') NOT NULL DEFAULT 'nobody' AFTER show_birth_date_to_friends;

UPDATE profiles
SET birth_date_visibility = CASE WHEN show_birth_date_to_friends = 1 THEN 'friends' ELSE 'nobody' END;
