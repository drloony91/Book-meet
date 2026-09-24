<!-- GENERATED FILE: do not edit directly. Source: mysql/migrations/*.sql. Command: pnpm docs:generate. -->
# Generated migration/schema inventory

This is a deterministic file-level inventory of migration names and `CREATE TABLE`/`ALTER TABLE` references. Field semantics and ownership remain in [DATA_MODEL.md](../DATA_MODEL.md).

| Migration | Table references |
| --- | --- |
| `001_initial.sql` | `CREATE TABLE users`, `CREATE TABLE profiles`, `CREATE TABLE sessions`, `CREATE TABLE books`, `CREATE TABLE book_links`, `CREATE TABLE user_books`, `CREATE TABLE reviews`, `CREATE TABLE excerpts`, `CREATE TABLE friend_requests`, `CREATE TABLE friendships`, `CREATE TABLE follows`, `CREATE TABLE messages`, `CREATE TABLE material_likes`, `CREATE TABLE material_comments`, `CREATE TABLE notifications`, `CREATE TABLE schema_migrations` |
| `002_events_admin_support.sql` | `ALTER TABLE users`, `CREATE TABLE events` |
| `003_profile_author_fields.sql` | `ALTER TABLE profiles` |
| `004_excerpt_preview_fields.sql` | `ALTER TABLE excerpts` |
| `005_wishlist.sql` | `CREATE TABLE wishlist_items` |
| `006_occasions_cities.sql` | `CREATE TABLE cities`, `CREATE TABLE occasions` |
| `007_book_sources_reading_stats.sql` | `ALTER TABLE books`, `ALTER TABLE user_books`, `ALTER TABLE wishlist_items` |
| `008_email_social_auth_totp.sql` | `ALTER TABLE users` |
| `009_totp_safe_setup.sql` | `ALTER TABLE users` |
| `010_user_book_reading_status.sql` | `ALTER TABLE user_books` |
| `011_presence_event_books_pinning.sql` | `ALTER TABLE users`, `ALTER TABLE events` |
| `012_profile_photos_message_attachments.sql` | `ALTER TABLE users`, `ALTER TABLE messages` |
| `013_half_step_book_ratings.sql` | `ALTER TABLE user_books` |
| `014_book_isbn_publisher.sql` | `ALTER TABLE books` |
| `015_publishers.sql` | `ALTER TABLE profiles`, `CREATE TABLE publisher_news` |
| `016_event_reminders.sql` | `CREATE TABLE event_reminders` |
| `017_reports_and_blocks.sql` | `CREATE TABLE user_blocks`, `CREATE TABLE reports`, `ALTER TABLE users` |
| `018_city_catalog_corrections.sql` | — |
| `019_profile_age_material_controls.sql` | `ALTER TABLE profiles`, `ALTER TABLE user_books`, `ALTER TABLE books`, `ALTER TABLE reviews`, `ALTER TABLE excerpts`, `ALTER TABLE events`, `ALTER TABLE occasions`, `ALTER TABLE publisher_news` |
| `020_occasion_meeting_schedule.sql` | `ALTER TABLE occasions`, `ALTER TABLE occasions` |
| `021_deleted_profiles.sql` | `ALTER TABLE users` |
| `022_kazakhstan_city_aliases.sql` | `CREATE TABLE city_aliases` |
| `023_material_books_occasions_home_view.sql` | `ALTER TABLE profiles`, `ALTER TABLE occasions`, `CREATE TABLE material_books`, `ALTER TABLE books` |
| `024_community_memberships.sql` | `CREATE TABLE community_memberships` |
| `025_community_profile_settings.sql` | `ALTER TABLE profiles` |
| `026_user_books_top3.sql` | `ALTER TABLE user_books` |
| `027_telegram_alert_outbox.sql` | `CREATE TABLE telegram_alert_outbox` |
| `028_account_email_tokens.sql` | `ALTER TABLE users`, `CREATE TABLE account_action_tokens` |
| `029_linked_profiles.sql` | `CREATE TABLE linked_profiles` |
| `030_legal_safety_compliance.sql` | `CREATE TABLE legal_documents`, `CREATE TABLE legal_acceptances`, `ALTER TABLE users`, `ALTER TABLE sessions`, `ALTER TABLE reports`, `ALTER TABLE reports`, `ALTER TABLE reports`, `ALTER TABLE reports`, `CREATE TABLE report_status_history`, `CREATE TABLE report_appeals`, `CREATE TABLE moderation_audit_log`, `CREATE TABLE security_event_log`, `CREATE TABLE security_incidents`, `CREATE TABLE finalized_profile_deletions` |
| `031_community_moderation_legal_document.sql` | `ALTER TABLE legal_documents`, `ALTER TABLE legal_acceptances` |
| `032_desktop_identity_community_saves.sql` | `ALTER TABLE users`, `ALTER TABLE profiles`, `CREATE TABLE material_saves` |
| `033_profile_birth_date_visibility.sql` | `ALTER TABLE profiles` |
| `034_profile_social_visibility.sql` | `ALTER TABLE profiles` |
| `035_community_book_month.sql` | `ALTER TABLE user_books` |
| `036_privacy_friends_defaults.sql` | `ALTER TABLE profiles` |
| `037_publisher_book_dates.sql` | `ALTER TABLE user_books` |
| `038_chat_history_clears.sql` | `CREATE TABLE chat_history_clears` |
| `039_reading_state_cycles.sql` | `ALTER TABLE user_books`, `CREATE TABLE reading_cycles` |
| `040_reading_goals.sql` | `CREATE TABLE reading_goals` |
| `041_book_progress_notes.sql` | `CREATE TABLE user_hides`, `CREATE TABLE book_progress_notes` |
| `042_book_shelves.sql` | `CREATE TABLE book_shelves`, `ALTER TABLE material_saves`, `CREATE TABLE book_shelf_items` |
| `043_social_content.sql` | `ALTER TABLE material_comments`, `CREATE TABLE material_comment_likes`, `CREATE TABLE content_mentions`, `CREATE TABLE reposts`, `ALTER TABLE excerpts` |
| `044_message_reactions.sql` | `CREATE TABLE message_reactions` |
| `045_message_edits.sql` | `ALTER TABLE messages`, `CREATE TABLE message_edit_history` |
| `046_notification_preferences.sql` | `ALTER TABLE users`, `CREATE TABLE notification_preferences` |
| `047_notification_delivery_outbox.sql` | `CREATE TABLE notification_events`, `ALTER TABLE notifications`, `CREATE TABLE notification_deliveries` |
| `048_message_deletion_evidence.sql` | `ALTER TABLE messages`, `CREATE TABLE message_deletion_evidence` |
| `049_message_search.sql` | `ALTER TABLE messages` |
| `050_message_stickers.sql` | `ALTER TABLE messages`, `ALTER TABLE message_deletion_evidence` |
| `051_notification_channel_integrations.sql` | `ALTER TABLE users`, `CREATE TABLE telegram_link_tokens` |
| `052_unified_conversations_stop_point.sql` | `CREATE TABLE conversations`, `CREATE TABLE conversation_members`, `CREATE TABLE conversation_backfill_orphans`, `CREATE TABLE conversation_backfill_reconciliations`, `ALTER TABLE messages` |
| `053_group_chat_server_foundations.sql` | `ALTER TABLE sessions`, `ALTER TABLE conversation_members`, `ALTER TABLE messages`, `ALTER TABLE message_deletion_evidence`, `CREATE TABLE conversation_polls`, `CREATE TABLE conversation_poll_options`, `CREATE TABLE conversation_poll_votes`, `CREATE TABLE group_message_moderation_evidence` |
| `054_reading_sessions.sql` | `CREATE TABLE reading_sessions`, `CREATE TABLE reading_session_days` |
| `055_reading_presence_visibility.sql` | `ALTER TABLE profiles` |
| `056_marketplace_foundation.sql` | `CREATE TABLE marketplace_listings`, `CREATE TABLE marketplace_listing_images`, `ALTER TABLE conversations`, `CREATE TABLE marketplace_conversation_hidden` |
| `057_marketplace_seller_restrictions.sql` | `CREATE TABLE marketplace_seller_restrictions` |
