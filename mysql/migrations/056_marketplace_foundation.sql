CREATE TABLE marketplace_listings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  seller_user_id BIGINT UNSIGNED NULL,
  seller_reference_id BIGINT UNSIGNED NOT NULL,
  catalog_book_id BIGINT UNSIGNED NULL,
  book_title VARCHAR(255) NOT NULL,
  book_author VARCHAR(255) NOT NULL,
  listing_type ENUM('sale', 'exchange') NOT NULL,
  item_condition VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  city_id BIGINT UNSIGNED NULL,
  city_name VARCHAR(180) NOT NULL,
  price_amount DECIMAL(10, 2) NULL,
  price_currency CHAR(3) NULL,
  exchange_wishes TEXT NULL,
  status ENUM('active', 'reserved', 'sold', 'exchanged', 'closed', 'removed') NOT NULL DEFAULT 'active',
  moderation_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY marketplace_listings_feed_idx (status, created_at, id),
  KEY marketplace_listings_city_feed_idx (city_id, status, created_at, id),
  KEY marketplace_listings_seller_idx (seller_user_id, status, created_at),
  KEY marketplace_listings_type_price_idx (listing_type, status, price_currency, price_amount, id),
  KEY marketplace_listings_catalog_book_idx (catalog_book_id),
  CONSTRAINT fk_marketplace_listings_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_marketplace_listings_catalog_book FOREIGN KEY (catalog_book_id) REFERENCES books(id) ON DELETE SET NULL,
  CONSTRAINT fk_marketplace_listings_city FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL,
  CONSTRAINT chk_marketplace_listings_seller_reference CHECK (seller_reference_id > 0),
  CONSTRAINT chk_marketplace_listings_book_snapshot CHECK (CHAR_LENGTH(TRIM(book_title)) > 0 AND CHAR_LENGTH(TRIM(book_author)) > 0),
  CONSTRAINT chk_marketplace_listings_condition CHECK (CHAR_LENGTH(TRIM(item_condition)) > 0),
  CONSTRAINT chk_marketplace_listings_city_snapshot CHECK (CHAR_LENGTH(TRIM(city_name)) > 0),
  CONSTRAINT chk_marketplace_listings_offer_fields CHECK (
    (listing_type = 'sale' AND price_amount IS NOT NULL AND price_amount > 0 AND price_currency IS NOT NULL AND exchange_wishes IS NULL)
    OR (listing_type = 'exchange' AND price_amount IS NULL AND price_currency IS NULL AND exchange_wishes IS NOT NULL AND CHAR_LENGTH(TRIM(exchange_wishes)) > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE marketplace_listing_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id BIGINT UNSIGNED NOT NULL,
  image_order TINYINT UNSIGNED NOT NULL,
  image_path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_marketplace_listing_images_order (listing_id, image_order),
  CONSTRAINT fk_marketplace_listing_images_listing FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  CONSTRAINT chk_marketplace_listing_images_order CHECK (image_order BETWEEN 0 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE conversations
  ADD COLUMN marketplace_listing_id BIGINT UNSIGNED NULL AFTER conversation_type,
  ADD COLUMN marketplace_buyer_user_id BIGINT UNSIGNED NULL AFTER marketplace_listing_id,
  ADD COLUMN marketplace_buyer_reference_id BIGINT UNSIGNED NULL AFTER marketplace_buyer_user_id,
  ADD UNIQUE KEY uq_conversations_marketplace_listing_buyer (marketplace_listing_id, marketplace_buyer_reference_id),
  ADD KEY conversations_marketplace_buyer_idx (marketplace_buyer_user_id, created_at),
  ADD CONSTRAINT fk_conversations_marketplace_listing FOREIGN KEY (marketplace_listing_id) REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conversations_marketplace_buyer FOREIGN KEY (marketplace_buyer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_conversations_marketplace_metadata CHECK (
    (conversation_type = 'marketplace' AND marketplace_listing_id IS NOT NULL AND marketplace_buyer_reference_id IS NOT NULL)
    OR (conversation_type <> 'marketplace' AND marketplace_listing_id IS NULL AND marketplace_buyer_reference_id IS NULL)
  );

-- Hiding a marketplace conversation is per participant and does not change
-- membership or delete the other participant's history.
CREATE TABLE marketplace_conversation_hidden (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  hidden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id),
  KEY marketplace_conversation_hidden_user_idx (user_id, hidden_at),
  CONSTRAINT fk_marketplace_conversation_hidden_member FOREIGN KEY (conversation_id, user_id) REFERENCES conversation_members(conversation_id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
