-- Social-list visibility is enforced by the bootstrap projection, never by the UI alone.
ALTER TABLE profiles
  ADD COLUMN followers_visibility ENUM('nobody', 'friends', 'everyone') NOT NULL DEFAULT 'friends' AFTER birth_date_visibility,
  ADD COLUMN friends_visibility ENUM('nobody', 'friends', 'everyone') NOT NULL DEFAULT 'friends' AFTER followers_visibility,
  ADD COLUMN wishlist_visibility ENUM('nobody', 'friends', 'everyone') NOT NULL DEFAULT 'friends' AFTER friends_visibility;
