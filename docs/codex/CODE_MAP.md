# Code map

Active source of truth is limited to `app/`, `src/`, `server/`, `mysql/`, `scripts/`, `tests/`, `public/`, `docs/codex/`, root runtime configs and `.github/workflows/ci.yml`. Ignore adjacent `release-*`, `.release-*`, `deploy-*`, `.prod-*`, ZIP, `dist`, `tmp`, `node_modules` and build-generated folders. The checked-in `docs/codex/generated/` inventories are an exception: regenerate them from active source, never edit them manually.

## Client

| Path | Symbols / responsibility |
| --- | --- |
| `src/main.tsx` | browser bootstrap; imports `app/page.tsx` |
| `app/page.tsx`, `app/BookMeetApp.tsx` | app composition; `BookMeetApp` mounts controller and adaptive indicators |
| `app/hooks/useBookMeetController.tsx` | session/bootstrap/realtime state, actions, navigation and modal coordination; `useBookMeetController` is the current integration boundary |
| `app/navigation/routes.ts` | `MainView`, `mainViewPaths`, `profileTabPaths`, `appRouteFromPathname`, overlay/mobile history helpers |
| `app/services/api.ts` | `apiFetch`: same-origin credentials plus locale headers |
| `app/services/bootstrap.ts` | `BootstrapSection`, `loadApplicationData`, `loadPublicCatalog` |
| `app/types/domain.ts`, `app/lib/domain.ts` | client DTO/domain types, profile/material/social/admin contracts |
| `app/screens/*.tsx` | auth, content, profile, chat, guest, mobile search/messages and directory screens |
| `app/components/content/*`, `components/admin/*`, `components/safety/*`, `components/compliance/*` | feature UI, editors, moderation/statistics, access gate |
| `app/i18n/*`, `app/globals.css` | locale/messages and global responsive styles; last applicable CSS media layer wins |

## Server

| Path | Symbols / responsibility |
| --- | --- |
| `server/index.js` | process start, middleware/security headers, API/static/Vite mounting, SSE/Telegram lifecycle |
| `server/api.js` | main Express router and authorization-aware domain handlers; inspect route groups in [ROUTES_AND_API.md](./ROUTES_AND_API.md) |
| `server/demo-api.js` | demo in-memory adapter, not production data source |
| `server/db.js`, `server/data.js` | MySQL pool/transactions; `loadUsers`, `loadBootstrap`, `resolveBook`, DTO/visibility projection |
| `server/security.js` | password/session/TOTP/recovery code primitives |
| `server/modules/bootstrap-router.js`, `location-router.js` | sectioned bootstrap and city lookup routers |
| `server/modules/compliance.js`, `social-permissions.js` | legal/age/privacy/moderation and social pair policy |
| `server/modules/content-security.js`, `image-storage.js`, `material-input.js` | rich HTML, image signatures/remote cover SSRF limits, URL/event/occasion validation |
| `server/modules/material-search.js`, `public-catalog.js` | in-memory bootstrap material search and guest catalog projection |
| `server/modules/account-tokens.js`, `mailer.js`, `i18n.js`, `login-attempts.js` | account actions, email, localized server auth text and brute-force window |
| `server/modules/telegram-outbox.js`, `request-limits.js`, `top3.js`, `username.js` | external alert queue, write limits, top-3 library constraint, username normalization |

## Schema, scripts and tests

- `mysql/migrations/001_initial.sql` … `033_profile_birth_date_visibility.sql` — append-only schema history; table map is [DATA_MODEL.md](./DATA_MODEL.md).
- `scripts/migrate.js` — sorted migration runner; `scripts/seed.js` — one production admin seed requiring explicit env; `scripts/demo.js` — demo runtime.
- `scripts/check-architecture.mjs`, `check-migrations.mjs`, `generate-codex-docs.mjs` — offline structural gates used by `pnpm check`/`verify`.
- `tests/*.test.mjs` — Node contract/unit suites; `package.json` `test` list is the canonical inventory. `tests/codex-docs-contract.test.mjs` guards this navigation.
- `.env.example`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.github/workflows/ci.yml` — runtime/tooling contracts; no secret values belong in docs.
- `docs/codex/generated/` — deterministic route and migration inventories generated from active source; refresh with `pnpm docs:generate`, never edit manually.
