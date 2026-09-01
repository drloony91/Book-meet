# Data model

Source of truth: `mysql/migrations/001_initial.sql` … `038_chat_history_clears.sql`. `scripts/migrate.js` applies sorted files and records `schema_migrations`; it splits statements and must not be used to rewrite an applied migration. `server/data.js` is the read/DTO projection layer. Nullable below means the current schema accepts `NULL`; JSON/LONGTEXT empty defaults are separate from SQL null.

Real-schema verification runs through the disposable Docker Compose MySQL 8.4.11 fixture (`compose.mysql-test.yml`), isolated as `book_meet_test` on `127.0.0.1:3307`. It validates the final schema and ledger against the real engine; it never targets production configuration or credentials. On 2026-08-24 `pnpm verify:db` passed the complete clean-schema, repeat-run, seed, transaction, relational and A-01 recovery suite and removed its container and named data volume afterward.

## Accounts, profiles and access

| Tables | Main fields / nullable | Ownership and delete behavior | Source |
| --- | --- | --- | --- |
| `users` ↔ `profiles` | `users.id/username/username_key/password_hash/initials/color/role` required; account `email`, Google/Telegram subjects, TOTP secrets, `avatar_path`, `last_seen_at`, deletion/suspension timestamps and `consent_withdrawn_at` nullable. `profiles.user_id/display_name/city/profile_type/gender` required; `city_id`, birth date, publisher/legal/community settings and hidden tabs nullable. `followers_visibility`, `friends_visibility` and `wishlist_visibility` are required `nobody/friends/everyone`, default `friends`. | 1:1 profile owned by user; `profiles.user_id → users.id ON DELETE CASCADE`. `users.role=admin`; product profile types are in `profiles.profile_type`. | `001`, `002`, `008`, `009`, `011`, `012`, `017`, `019`, `021`, `023`, `025`, `030`, `032`, `033`, `034`; `server/data.js` `loadUsers`. |
| `sessions` | token hash, user, expiry and creation required; `last_seen_at` required after `030`, `ip_hash` and `user_agent_hash` nullable. | `user_id → users ON DELETE CASCADE`; session token itself never stored raw. | `001`, `030`; `server/security.js`. |
| `account_action_tokens` | user, purpose, token hash, expiry required; consumed timestamp nullable. | account-owned verification/reset token; user cascade. | `028`; `server/modules/account-tokens.js`. |
| `linked_profiles` | personal and community user IDs required, distinct; each side unique. | both FKs to `users ON DELETE CASCADE`; link is account relationship, not friendship. | `029`; `/api/linked-profiles/*`. |

## Books, library and materials

| Tables | Main fields / nullable | Ownership and delete behavior | Source |
| --- | --- | --- | --- |
| `books` | creator nullable (`ON DELETE SET NULL`); author/title/genres/annotation required; cover, ISBN/publisher, `flip_url` nullable; `is_adult` required default false. | canonical book can be created by user or import; links and library rows reference it. | `001`, `007`, `014`, `019`, `023`; `server/data.js` `resolveBook`. |
| `book_links` | book/owner/action/label/url required. | book and owner cascade; unique per book/owner/url. | `001`; owner checks in `server/api.js`. |
| `user_books` | user/book required; rating, short review, read dates, top rank, chapter and reading comment nullable; reading status/is_author required defaults. | user and book cascade; composite `(user_id, book_id)`, optional one of top ranks 1–3. Catalogue aggregate rating uses only non-author rows with a non-null rating and non-empty trimmed short review from non-deleted/non-purged users; full `reviews` are excluded. | `001`, `007`, `010`, `013`, `019`, `026`. |
| `reviews`, `excerpts`, `publisher_news` | owner required; review book required; excerpt book nullable (`SET NULL`); excerpt read URL nullable; text/body required; `is_adult` defaults false. | owner/user cascade; linked book deletion cascades reviews but nulls excerpt book. | `001`, `003`, `004`, `015`, `019`; material DTO in `server/data.js`. |
| `material_books` | polymorphic `material_kind/material_id` plus required book/position; no FK to polymorphic material target, book FK required. | book deletion cascades associations; target ownership/visibility checked in code. | `023`; `material_books` queries in `server/data.js`. |
| `material_likes`, `material_saves`, `material_comments` | user/material kind/id required; comment body/created time required. | user-owned rows cascade on user delete; generic target has no SQL FK and needs `readableMaterialInfo`/ownership/age checks. | `001` likes/comments, `032` saves; `/api/reactions`, `/api/saves`, `/api/comments`. |
| `wishlist_items` | owner and gift fields required; catalog book, cover, price, checked time, reservation user/time nullable; recipient name required after `007`. | owner cascade; catalog/reserver `ON DELETE SET NULL`; reserve actions additionally require friendship/privacy rules. | `005`, `007`; `/api/wishlist/*`. |

## Events, occasions and geography

| Tables | Main fields / nullable | Ownership and delete behavior | Source |
| --- | --- | --- | --- |
| `events` | creator/title/summary/description/date/time/city/address/status required; map/details URLs, moderation note, city/book IDs nullable; pinned/adult flags default false. | creator cascade; optional `book_id`/`city_id` set null; `event_reminders` cascade with event. | `002`, `011`, `019`, `023`; event handlers in `server/api.js`. |
| `occasions` | creator/type/text/target filters/status required; moderation note, schedule, meeting city/address/map/book IDs nullable; adult default false. | creator cascade; optional city/book set null; material-book association cascades with book. | `006`, `019`, `020`, `023`; `material-input.js`. |
| `cities`, `city_aliases` | city `geoname_id` nullable, name/country required; alias language/name required. | alias `city_id → cities ON DELETE CASCADE`; profile/event/occasion city FKs are nullable/set null. | `006`, `011`, `018`, `022`; `location-router.js`. |
| `event_reminders` | user/event/created required; `reminded_at` nullable. | both FKs cascade; duplicate prevented by composite key. | `016`; reminder timer in `server/api.js`. |

## Social, messages and notifications

| Tables | Main fields / nullable | Ownership and delete behavior | Source |
| --- | --- | --- | --- |
| `friend_requests` | from/to/status required; message/rejection comment nullable. | both users cascade; accepted state produces symmetric `friendships`. | `001`; social handlers and `social-permissions.js`. |
| `friendships`, `follows`, `community_memberships` | endpoint user IDs/created time required; friendship uses ordered low/high IDs. | all user FKs cascade. Community membership is directional community→member and is never a friendship/privacy grant. | `001`, `024`; `BootstrapData.communityMemberships`. |
| `user_blocks` | blocker/blocked/created required. | both users cascade; block filtering is viewer-aware in `loadUsers`. | `017`; `/api/social/blocks/*`. |
| `messages` | recipient/body/system/time required; sender, read time and attachment kind/id nullable. | recipient cascade; sender `ON DELETE SET NULL`; only permitted pairs/admin support can read/write. | `001`, `012`; `ChatScreen.tsx`. |
| `chat_history_clears` | viewer, peer, maximum hidden message ID and clear time required; viewer and peer must differ. | Composite viewer/peer key; both users cascade. This is a per-viewer visibility cursor only: message rows and the peer's history remain intact, and later message IDs remain visible. | `038`; `DELETE /api/social/messages/:targetId/history`, `server/data.js`. |
| `notifications` | recipient/type/title/body/time required; actor/material refs/group key nullable; unread defaults true. | recipient cascade; actor `SET NULL`; unique group key per recipient. | `001`; `/api/notifications/*`. |

Migration `038` also removes historical `new_message` rows from the general notification center. New personal messages retain unread/read state only in `messages`; they no longer create `notifications` rows.

`035_community_book_month.sql` adds nullable `user_books.featured_month` and `featured_year` for community-only catalogue associations; the pair is either both null or a valid month/year. `036_privacy_friends_defaults.sql` makes birth-date and social visibility default to `friends` and normalizes existing profiles.

## Moderation, legal and operational records

`reports` references reporter/target/reviewer; reporter was deliberately made nullable and `SET NULL` in `030` to preserve anonymized moderation evidence. `report_status_history` and `report_appeals` cascade with report; actor/appellant/reviewer are nullable and set null. `moderation_audit_log` keeps admin/report references nullable and set null. `security_event_log` and `security_incidents` retain nullable user/admin references; `finalized_profile_deletions` is a user tombstone with unique hash. See `017`, `030`, `031` and `server/modules/compliance.js`.

`legal_documents` has required type/version/language/content metadata and nullable uploader; `(document_type, version, language_code)` is unique. `legal_acceptances` requires user/document and cascades user but **restricts document deletion**. Community moderation legal documents are distinct from mandatory registration acceptance (`031`).

`telegram_alert_outbox` stores required event/entity/dedupe fields plus nullable actor, summary, lock/delivery/error timestamps; actor deletion sets null (`027`). `schema_migrations` is the canonical runner ledger, not application data. `schema_migration_attempts` is a separate operational diagnostic ledger: before an unapplied migration runs, the runner records a durable `running`/`failed` marker with the 1-based statement position, preview, engine error and timestamps. It is deleted only after the canonical migration row is committed; a stale/failed marker without a canonical row blocks blind rerun.

`tests/mysql-integration.test.mjs` applies all production migrations on a clean `book_meet_test`, compares the complete sorted ledger, reruns the actual runner as a no-op, and checks real late columns and representative foreign-key behavior. Its A-01 fixture is deliberately separate at `tests/fixtures/mysql-migrations/`: it models an idempotent first DDL followed by an absent required dependency, then verifies the diagnostic block and only-marker retry after explicit reconciliation. The unsafe behavior was reproduced on isolated MariaDB 10.6.27, and the durable diagnostic/recovery gate was subsequently verified end to end on disposable MySQL 8.4.11.

## Deletion and nullability rules

Foreign-key cascades remove user-owned operational rows, while content links that must survive an account/content deletion use `SET NULL`; report/legal records intentionally preserve evidence. Polymorphic material tables have no database-level target FK, so every read/write path must use server authorization and age/privacy helpers. For a complete field list consult the migration file named above; do not infer schema from client DTO optionality.

The deterministic migration/file and `CREATE TABLE`/`ALTER TABLE` inventory is generated in [generated/SCHEMA.md](./generated/SCHEMA.md). Run `pnpm docs:check` to detect stale output; keep field semantics and ownership in this document.
