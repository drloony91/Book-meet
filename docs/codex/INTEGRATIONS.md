# Integrations and deployment

This document records boundaries and **environment variable names only**. Values, tokens and passwords are never documentation content; configure them in Plesk or a private `.env`.

| Integration | Runtime boundary | Env names |
| --- | --- | --- |
| MySQL/MariaDB | `mysql2/promise` pool in `server/db.js`; migrations via `scripts/migrate.js`; transactions via `withTransaction` | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_CONNECTION_LIMIT` |
| Sessions/security | cookie session, HSTS/secure cookie in production, audit metadata HMAC | `SESSION_DAYS`, `ADMIN_SESSION_HOURS`, `AUDIT_HASH_SECRET`, `NODE_ENV`, `DEMO_MODE`, `LEGAL_CONSENT_REQUIRED` |
| Uploads/images | local `UPLOAD_DIR`, `/uploads` static serving; `image-storage.js` checks signatures, bytes and allowed remote hosts | `UPLOAD_DIR`, `MAX_COVER_BYTES` |
| Google Identity | OAuth callback and Google Identity credential flow in `server/api.js`; JWKS cache/seed in `server/google-jwks.json` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| SMTP / local MTA | verification/reset mail in `server/modules/mailer.js`; no mail is sent when not configured; local fallback uses sendmail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `SENDMAIL_PATH` |
| Telegram | admin alert outbox/dispatcher; personal message text is excluded; user notifications require separate opt-in/product flow | `TELEGRAM_ALERTS_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| External book sources | remote preview/cover and price paths; Flip, Marwin/Меломан and Yandex Books markup is untrusted and may change; SSRF/redirect/size limits in `image-storage.js` and `api.js` | no dedicated source credentials in current runtime |
| Seed/test accounts | main `scripts/seed.js` requires explicit production admin credentials; `scripts/seed-publisher.js` is a local-only optional publisher fixture and is prohibited in production | `ADMIN_EMAIL`, `TEST1_PASSWORD`, `PUBLISHER_TEST_EMAIL`, `PUBLISHER_TEST_PASSWORD` |
| Canonical/legacy origins | `server/index.js` redirects legacy host and validates mutating API Origin | `APP_ORIGIN`, `LEGACY_ORIGIN` |
| Plesk/Node | one Node/Express process serves API and Vite output; production root and startup path are in `PLESK_DEPLOY.md` | `PORT`, `NODE_ENV`, `APP_ORIGIN`, `LEGACY_ORIGIN` |

## Deployment contract

Build with the lockfile (`pnpm install --frozen-lockfile`, `pnpm build`), apply migrations/seed only with an explicitly configured target database, restart Node in Plesk, then check `/api/health`, fresh hashed assets, canonical root and direct SPA routes. Keep `.env`, cookies, uploads and production archives outside Git. See [TESTING.md](./TESTING.md) for what local checks do not prove.
