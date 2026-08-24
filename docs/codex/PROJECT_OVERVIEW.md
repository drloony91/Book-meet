# Project overview

Book Meet — web MVP социальной книжной платформы для читателей, авторов/блогеров, издателей и сообществ. Канонический production origin задаётся `APP_ORIGIN` (текущий публичный домен — `https://bookmeet.club`); legacy origin перенаправляется сервером. Telegram-бот, Workers и D1 не являются частью runtime приложения.

## Runtime

| Layer | Фактическая реализация | Entry point |
| --- | --- | --- |
| Browser | React 19 + TypeScript, Vite 8; собственный History API router | `src/main.tsx` → `app/page.tsx` → `app/BookMeetApp.tsx` |
| Client state | один controller соединяет bootstrap, realtime, navigation, модальные overlays и actions | `app/hooks/useBookMeetController.tsx` |
| HTTP/server | Node.js 22+ + Express; web и `/api/*` в одном процессе | `server/index.js`, `server/api.js` |
| Persistence | MySQL/MariaDB через `mysql2/promise`; DTO и visibility собираются в data layer | `server/db.js`, `server/data.js` |
| Schema lifecycle | последовательные SQL-файлы 001–033, runner | `mysql/migrations/`, `scripts/migrate.js` |
| Assets | Vite build в `dist/client`, user images в `UPLOAD_DIR` и `/uploads` | `vite.config.ts`, `server/index.js`, `server/modules/image-storage.js` |

Canonical development toolchain: `.node-version` = Node `22.13.0`, `packageManager` = `pnpm@11.9.0`; clean setup is `pnpm run setup`. Exact route/schema inventories are generated under `docs/codex/generated/` and checked by `pnpm check`.

## Product surface

Auth/account, профили и связанные profiles, privacy/18+, каталог книг, library и wishlist, feed из reviews/excerpts/publisher news, reactions/saves/comments, events/occasions, friendships/follows/communities, direct chat, notifications/realtime, material search, admin/moderation/compliance и локализация `ru`/`kk`/`en` реализованы в текущем web source. Сквозная карта — [FEATURE_MAP.md](./FEATURE_MAP.md).

## Request/data flow

1. `server/index.js` загружает env, выбирает `server/api.js` или `server/demo-api.js`, ставит security headers, Origin/rate-limit middleware, `/uploads`, API и SPA fallback.
2. Авторизованный browser получает параллельные секции `/api/bootstrap/session`, `/api/bootstrap/catalog`, `/api/bootstrap/social`, `/api/bootstrap/moderation` через `app/services/bootstrap.ts`. Старый `/api/bootstrap` сохранён для совместимости.
3. `server/data.js` читает relational rows, применяет viewer-aware block/friend/age/privacy filters и собирает DTO типов из `app/types/domain.ts`.
4. Изменения проходят через handlers `server/api.js`, часто в `withTransaction`; успешные записи broadcast-ят SSE `/api/realtime`, а reminder/Telegram outbox обрабатываются фоновыми механизмами.

## Operational boundary

Сервис намеренно остаётся modular monolith: extraction новых процессов (import, images, notifications, search) возможен только после метрик. Не редактируйте `release-*`, `.release-*`, `deploy-*`, `.prod-*`, ZIP, `dist`, `tmp` и `node_modules` как source of truth; active-path allowlist — [CODE_MAP.md](./CODE_MAP.md). Deployment/runbook — `PLESK_DEPLOY.md`, интеграции — [INTEGRATIONS.md](./INTEGRATIONS.md).
