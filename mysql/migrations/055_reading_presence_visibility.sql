ALTER TABLE profiles
  ADD COLUMN reading_presence_visibility ENUM('nobody', 'friends', 'followers', 'everyone') NOT NULL DEFAULT 'nobody' AFTER wishlist_visibility;
