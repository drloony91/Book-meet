ALTER TABLE material_comments
  ADD COLUMN parent_comment_id BIGINT UNSIGNED NULL AFTER material_id,
  ADD COLUMN reply_to_comment_id BIGINT UNSIGNED NULL AFTER parent_comment_id,
  ADD COLUMN deleted_at TIMESTAMP NULL AFTER body,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD KEY material_comments_roots_cursor (material_kind, material_id, parent_comment_id, id DESC),
  ADD KEY material_comments_parent_cursor (parent_comment_id, id DESC),
  ADD KEY material_comments_reply_to (reply_to_comment_id),
  ADD CONSTRAINT material_comments_parent_fk FOREIGN KEY (parent_comment_id) REFERENCES material_comments(id) ON DELETE CASCADE,
  ADD CONSTRAINT material_comments_reply_to_fk FOREIGN KEY (reply_to_comment_id) REFERENCES material_comments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS material_comment_likes (
  comment_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id),
  KEY material_comment_likes_user_cursor (user_id, comment_id),
  CONSTRAINT material_comment_likes_comment_fk FOREIGN KEY (comment_id) REFERENCES material_comments(id) ON DELETE CASCADE,
  CONSTRAINT material_comment_likes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_mentions (
  entity_type VARCHAR(32) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NOT NULL,
  mentioned_user_id BIGINT UNSIGNED NOT NULL,
  -- The token typed at selection time binds an old @username to its stable ID.
  mention_token VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_type, entity_id, mentioned_user_id),
  KEY content_mentions_author_cursor (author_user_id, created_at),
  KEY content_mentions_mentioned_cursor (mentioned_user_id, created_at),
  CONSTRAINT content_mentions_author_fk FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT content_mentions_mentioned_fk FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reposts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  source_material_type VARCHAR(32) NOT NULL,
  source_material_id BIGINT UNSIGNED NOT NULL,
  source_root_type VARCHAR(32) NOT NULL,
  source_root_id BIGINT UNSIGNED NOT NULL,
  clean_source_root_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY reposts_unique_clean_source (user_id, source_root_type, clean_source_root_id),
  KEY reposts_source_counter (source_root_type, source_root_id),
  KEY reposts_user_cursor (user_id, id DESC),
  CONSTRAINT reposts_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE excerpts
  ADD COLUMN provenance_repost_id BIGINT UNSIGNED NULL,
  ADD KEY excerpts_provenance_repost (provenance_repost_id),
  ADD CONSTRAINT excerpts_provenance_repost_fk FOREIGN KEY (provenance_repost_id) REFERENCES reposts(id) ON DELETE SET NULL;
