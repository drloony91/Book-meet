-- Реальный статус присутствия, связь события с единой карточкой книги и закрепление.

ALTER TABLE users
  ADD COLUMN last_seen_at DATETIME NULL AFTER profile_completed,
  ADD KEY users_last_seen_idx (last_seen_at);

ALTER TABLE events
  ADD COLUMN city_id BIGINT UNSIGNED NULL AFTER city,
  ADD COLUMN book_id BIGINT UNSIGNED NULL AFTER details_url,
  ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER book_id,
  ADD KEY events_pinned_date_idx (status, is_pinned, event_date, event_time),
  ADD KEY events_book_idx (book_id),
  ADD KEY events_city_idx (city_id),
  ADD CONSTRAINT events_book_fk FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
  ADD CONSTRAINT events_city_fk FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL;

UPDATE events e
JOIN cities c ON c.name_key = LOWER(TRIM(e.city))
SET e.city_id = c.id
WHERE e.city_id IS NULL;
