ALTER TABLE messages
  ADD FULLTEXT KEY messages_body_fulltext (body);
