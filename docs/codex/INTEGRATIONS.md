# Integrations and deployment

This document records boundaries and **environment variable names only**. Values, tokens and passwords are never documentation content; configure them in Plesk or a private `.env`.

| Integration | Runtime boundary | Env names |
| --- | --- | --- |
| MySQL/MariaDB | `mysql2/promise` pool in `server/db.js`; migrations via `scripts/migrate.js`; transactions via `withTransaction` | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_CONNECTION_LIMIT` |
| Sessions/security | cookie session, HSTS/secure cookie in production, audit metadata HMAC | `SESSION_DAYS`, `ADMIN_SESSION_HOURS`, `AUDIT_HASH_SECRET`, `NODE_ENV`, `DEMO_MODE`, `LEGAL_CONSENT_REQUIRED` |
| Uploads/images | local `UPLOAD_DIR`, `/uploads` static serving; `image-storage.js` checks signatures, bytes and allowed remote hosts | `UPLOAD_DIR`, `MAX_COVER_BYTES` |
| Google Identity | OAuth callback and Google Identity credential flow in `server/api.js`; JWKS cache/seed in `server/google-jwks.json` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| SMTP / local MTA | verification/reset mail plus user-notification adapter in `server/modules/mailer.js` and `notification-channels.js`; no mail is sent when not configured. User notification preferences expose email only when the address is verified and the separately audited delivery switch is enabled. Optional user mail includes a signed unsubscribe action. | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `SENDMAIL_PATH`, `NOTIFICATION_UNSUBSCRIBE_SECRET`, `USER_EMAIL_NOTIFICATIONS_READY` |
| Telegram | admin alert dispatcher remains separate from the user-notification adapter. User binding uses an authenticated webhook and a server-generated one-time deep link; no username/chat ID is accepted from the browser. Personal message/internal notification bodies are excluded. The legacy auth subject is not connection proof. | `TELEGRAM_ALERTS_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `USER_TELEGRAM_NOTIFICATIONS_READY` |
| External book sources | remote preview/cover and price paths; Flip, Marwin/Меломан and Yandex Books markup is untrusted and may change; SSRF/redirect/size limits in `image-storage.js` and `api.js` | no dedicated source credentials in current runtime |
| Seed/test accounts | main `scripts/seed.js` requires explicit production admin credentials only for an intentional seed/reset; normal startup and migrations do not read them, so `TEST1_PASSWORD` should be removed from long-lived production/staging environment after the operation; obsolete `TEST2_PASSWORD` is unsupported; `scripts/seed-publisher.js` is a local-only optional publisher fixture and is prohibited in production | `ADMIN_EMAIL`, `TEST1_PASSWORD`, `PUBLISHER_TEST_EMAIL`, `PUBLISHER_TEST_PASSWORD` |
| Canonical origin/CORS | `server/index.js` validates mutating API Origin against the configured application origin; retired legacy hosts are not part of runtime | `APP_ORIGIN` |
| Plesk/Node | one Node/Express process serves API and Vite output; production and staging roots/startup paths are in `PLESK_DEPLOY.md` | `PORT`, `NODE_ENV`, `APP_ORIGIN`, `DEMO_MODE` |

`mailerDiagnostics()` and `telegramDiagnostics()` are configuration-only helpers for local/operator checks. `configured_unverified` explicitly means that values have the required shape only; it does not imply host reachability, TLS validity, authentication or delivery. They report only structural status (and missing SMTP field names / safe transport mode); they do not reveal values, resolve hosts, open a connection, authenticate, or send a message.

`USER_EMAIL_NOTIFICATIONS_READY` and `USER_TELEGRAM_NOTIFICATIONS_READY` default to `0`. They may be set to `1` only after the corresponding user-delivery path has been independently verified. Stage 3A stores preferences but does not create an outbox, domain events, network connections or sends.

The user-delivery worker is started by `server/index.js` with Telegram and SMTP adapters, but both external paths remain fail-closed behind their readiness switches. External payload projection is generic and excludes internal notification bodies. Expired worker leases are reclaimed safely; daily email is one digest per user and immutable 09:00-local window, not one message per event. Stable message IDs support transport idempotency. This user-delivery outbox is independent of the existing admin `telegram_alert_outbox`.

`pnpm diagnose:notifications` performs live SMTP/TLS authentication and Telegram bot/webhook checks while printing status booleans only. `--send-test-email=<allowlisted address>` additionally sends one fixed diagnostic message after SMTP verification; it must be run only with an explicitly authorized recipient. The command does not print credential values.

`pnpm configure:telegram-webhook -- --apply` registers the canonical HTTPS `/api/integrations/telegram/webhook` URL with Telegram and then verifies bot/webhook status. The explicit `--apply` gate is mandatory because this changes external bot state; output contains status booleans only.

## Deployment contract

The permanent topology is production (`bookmeet.club`), staging (`staging.bookmeet.club`), local/demo (`DEMO_MODE=1`, in-memory) and local disposable MySQL (`127.0.0.1:3307`, test-only `book_meet_test`). Production and staging require separate MariaDB databases/users, upload directories, seed admin credentials and secrets. Staging uses `../book-meet-staging-uploads`, HTTPS, Basic Auth or equivalent access restriction, `X-Robots-Tag: noindex, nofollow, noarchive`, and nginx/Plesk boundary security headers. Google, SMTP and Telegram remain disabled on staging until explicitly approved safe.

Build with the lockfile (`pnpm install --frozen-lockfile`, `pnpm build`), apply migrations/seed only with an explicitly configured target database, restart Node in Plesk, then check `/api/health`, fresh hashed assets, canonical root and direct SPA routes. For staging, run migration status, a second migration pass to prove no-op behavior, and the login/logout/log smoke described in [PLESK_DEPLOY.md](../../PLESK_DEPLOY.md). Keep `.env`, cookies, uploads and production archives outside Git. See [TESTING.md](./TESTING.md) for what local checks do not prove.
