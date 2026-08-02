ALTER TABLE profiles
  ADD COLUMN author_influences TEXT NULL AFTER bio,
  ADD COLUMN writing_themes TEXT NULL AFTER author_influences;

UPDATE profiles
   SET author_influences = COALESCE(author_influences, ''),
       writing_themes = COALESCE(writing_themes, '');
