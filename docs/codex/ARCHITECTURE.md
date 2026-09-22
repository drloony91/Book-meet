# Architecture

## Component graph

```text
Browser
  src/main.tsx -> app/page.tsx -> app/BookMeetApp.tsx
  -> app/hooks/useBookMeetController.tsx
  -> app/navigation/routes.ts + app/screens/* + app/components/*
  -> app/services/api.ts + app/services/bootstrap.ts
      -> /api/* (server/index.js middleware -> server/api.js/modules/*)
          -> server/data.js / server/db.js -> MySQL/MariaDB
          -> uploads/ and external services (see INTEGRATIONS.md)
```

`app/` — active client; `src/` содержит bootstrap entry. `server/api.js` остаётся большим предметным router и импортирует узкие helpers; `server/data.js` — read/DTO boundary, а не место для UI state. Полная карта символов — [CODE_MAP.md](./CODE_MAP.md).

## Startup and middleware ownership

`server/index.js`:

- проверяет production invariants (`DEMO_MODE`, `AUDIT_HASH_SECRET`), configured `APP_ORIGIN` и `PORT`;
- ставит JSON/urlencoded limits, security headers (CSP, HSTS в production, `nosniff`, frame/referrer/permissions policies), Origin guard и `apiRateLimit`;
- публикует `/uploads`, монтирует `/api`, затем Vite middleware в development или `dist/client` + SPA fallback в production/demo;
- запускает независимые admin Telegram и user-notification outbox dispatchers и останавливает их при graceful shutdown.

`server/api.js` владеет auth, sessions, profile/account, books/materials, social, events, moderation, legal and admin endpoints. `server/modules/` owns reusable validation/security/search/bootstrap/location/mail/Telegram helpers. Новую большую группу сначала выделять в module/router без изменения public contract.

## Client loading and navigation

`loadApplicationData()` делает `Promise.all` по bootstrap sections. `useBookMeetController()` применяет snapshot, затем refresh-ит данные по visibility/realtime; endpoint `/material-stats` возвращает commenters/counts/saves отдельным запросом.

`app/navigation/routes.ts` — единственный route parser/history owner: main views (`/`, `/users`, `/books`, `/events`, `/meet`, `/blog`, `/publishing`, `/communities`, `/chat`, `/liked`, `/saved`, `/notifications`), profile tabs, dynamic overlays and mobile workflows. `openOverlayRoute()`/`closeOverlayRoute()` используют History API; не добавляйте независимый `popstate` listener для обхода этого ownership.

Личная связь читателя с книгой обновляется только через `app/services/library-mutations.ts`: проверенный owner DTO (`book` + `readingHistory`) рассылается контроллеру как событие с captured viewer id. Epoch защищает этот DTO от запоздалого bootstrap/SSE snapshot при сохранении или переключении аккаунта. `MyProfile` не отправляет `books` обратно через profile PUT.

## Authorization and data boundary

UI visibility does not grant access. `authenticatedUser`/server handlers, `server/modules/social-permissions.js`, `server/modules/compliance.js`, age/material helpers and ownership checks enforce access. Community membership is separate from friendship; friendship-only privacy, chat and wishlist rules must not be broadened by membership. Legal documents are managed separately from registration consent. `withTransaction()` is required for multi-row state transitions; applied migrations are append-only.

## Realtime and scheduled work

SSE `/api/realtime` keeps connected sessions informed. Ordinary writes use the legacy `update` invalidation, while successful message create/edit/delete/reaction/read mutations enqueue a minimal `chat` invalidation only for the two dialog participants; per-viewer history clearing targets only that viewer. The event carries no message content or authorization facts and the client treats it only as a signal to reload `/bootstrap/social`. Failed writes emit nothing. Event and postponed-book reminders create domain notification events transactionally. Every active producer uses `server/modules/notification-events.js`, which persists an append-only event, the selected in-app projection, and readiness-filtered channel jobs under the caller transaction.

The generic user-delivery worker claims due jobs with row locks, reclaims an expired `processing` lease after a worker crash, and retains stable idempotency keys, bounded exponential retry and sanitized errors. `server/index.js` injects the Telegram and SMTP adapters and starts the dispatcher; readiness switches still fail closed until live delivery is separately verified. Telegram receives only a generic title/summary/link. Daily email jobs become due at the next 09:00 in the effective user timezone; all claimed jobs for one user and immutable digest window are delivered through one safe `payloads[]` adapter call and completed or retried by one batch update. Email uses deterministic message IDs and a signed optional-notification unsubscribe link. Admin `telegram_alert_outbox` and its existing runtime dispatcher remain separate. Deleted-profile maintenance purges expired rows through explicit cleanup plus foreign-key cascades; personal message text is never a general notification event.

## Deliberate non-goals

Микросервисы, полная pagination/bootstrap redesign, новый SSE connection limiter и широкое дробление `useBookMeetController.tsx`, `server/api.js` или `globals.css` требуют отдельной performance/browser acceptance матрицы. Остатки перечислены в [KNOWN_TECH_DEBT.md](./KNOWN_TECH_DEBT.md).
