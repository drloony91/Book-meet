ALTER TABLE profiles
  MODIFY COLUMN show_birth_date_to_friends BOOLEAN NOT NULL DEFAULT TRUE,
  MODIFY COLUMN birth_date_visibility ENUM('nobody', 'friends', 'everyone') NOT NULL DEFAULT 'friends';

UPDATE profiles
SET show_birth_date_to_friends = 1,
    birth_date_visibility = 'friends',
    followers_visibility = 'friends',
    friends_visibility = 'friends',
    wishlist_visibility = 'friends';
