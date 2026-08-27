# Book Meet Codex navigation

Статус: каноническая карта текущего исходного кода. Снимок: **2026-08-24**. Базовый commit: **`05b811f`**. Среда: **worktree после blocks 1–4c и TZ compliance pass**, не отдельный release/archive snapshot.

## Как пользоваться

`AGENTS.md` содержит обязательные orchestration и project guardrails. Этот индекс маршрутизирует задачу к одному источнику правды по теме; не копируйте сюда детали из остальных документов.

| Задача | Читать | Core entry points |
| --- | --- | --- |
| Быстро понять продукт и границы | [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md), [ARCHITECTURE.md](./ARCHITECTURE.md) | `src/main.tsx`, `app/page.tsx`, `server/index.js` |
| Auth/account, session, TOTP, legal gate | [FEATURE_MAP.md](./FEATURE_MAP.md), [ROUTES_AND_API.md](./ROUTES_AND_API.md), [DATA_MODEL.md](./DATA_MODEL.md) | `app/screens/AuthScreens.tsx`, `server/api.js`, `server/security.js` |
| Profile, privacy, linked profiles, social permissions | [FEATURE_MAP.md](./FEATURE_MAP.md), [DATA_MODEL.md](./DATA_MODEL.md), [CONVENTIONS.md](./CONVENTIONS.md) | `app/screens/ProfileScreens.tsx`, `app/hooks/useBookMeetController.tsx`, `server/modules/social-permissions.js`, `server/modules/compliance.js` |
| Feed/materials, Books/library, wishlist | [FEATURE_MAP.md](./FEATURE_MAP.md), [ROUTES_AND_API.md](./ROUTES_AND_API.md) | `app/components/content/ContentComponents.tsx`, `app/screens/ContentScreens.tsx`, `server/data.js`, `server/api.js` |
| Events, occasions, catalog | [FEATURE_MAP.md](./FEATURE_MAP.md), [DATA_MODEL.md](./DATA_MODEL.md) | `app/types/domain.ts`, `server/modules/material-input.js`, `mysql/migrations/002_*.sql`, `006_*.sql` |
| Chat, notifications, realtime | [FEATURE_MAP.md](./FEATURE_MAP.md), [ARCHITECTURE.md](./ARCHITECTURE.md) | `app/screens/ChatScreen.tsx`, `app/components/chat/ChatComponents.tsx`, `server/api.js` (`/realtime`) |
| Endpoint contract or route navigation | [ROUTES_AND_API.md](./ROUTES_AND_API.md), [CODE_MAP.md](./CODE_MAP.md) | `app/navigation/routes.ts`, `server/api.js`, `server/modules/bootstrap-router.js` |
| Schema, ownership, nullable fields, cascade | [DATA_MODEL.md](./DATA_MODEL.md) | `mysql/migrations/001_initial.sql` … `033_profile_birth_date_visibility.sql`, `scripts/migrate.js`, `server/data.js` |
| External services and deployment | [INTEGRATIONS.md](./INTEGRATIONS.md), [TESTING.md](./TESTING.md) | `.env.example`, `server/index.js`, `PLESK_DEPLOY.md` |
| New change, regression, release readiness | [CONVENTIONS.md](./CONVENTIONS.md), [TESTING.md](./TESTING.md), [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md), [KNOWN_TECH_DEBT.md](./KNOWN_TECH_DEBT.md) | `package.json`, `tests/`, `.github/workflows/ci.yml` |

## Canonical documents

- [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) — продукт, runtime и системные границы.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — потоки запуска, bootstrap, навигация и ownership.
- [FEATURE_MAP.md](./FEATURE_MAP.md) — feature → frontend → API → data → permissions → tests.
- [DATA_MODEL.md](./DATA_MODEL.md) — фактические main tables, связи, nullability, cascade и migration pointers.
- [ROUTES_AND_API.md](./ROUTES_AND_API.md) — группы frontend routes и backend endpoints.
- [CODE_MAP.md](./CODE_MAP.md) — active-path allowlist и символы.
- [INTEGRATIONS.md](./INTEGRATIONS.md) — интеграционные границы и имена env-переменных без значений.
- [CONVENTIONS.md](./CONVENTIONS.md) — соглашения для безопасных изменений.
- [TESTING.md](./TESTING.md) — canonical check, тестовая матрица и честные gaps.
- [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) — короткий staging/production gate, текущий verification snapshot и обязательный rollback preflight.
- [KNOWN_TECH_DEBT.md](./KNOWN_TECH_DEBT.md) — unresolved/residual долги и scope выполненных блоков.

Generated structural inventories are maintained by `pnpm docs:generate` and checked by `pnpm docs:check`: [generated/API_ROUTES.md](./generated/API_ROUTES.md), [generated/FRONTEND_ROUTES.md](./generated/FRONTEND_ROUTES.md), [generated/SCHEMA.md](./generated/SCHEMA.md). Do not edit generated files directly.

`docs/architecture.md` оставлен compatibility pointer. `docs/security-audit.md` — исторический датированный snapshot полезных security facts; за текущей навигацией и тестами следуйте этому каталогу.

## Cold start

1. Прочитать [AGENTS.md](../../AGENTS.md) и этот индекс.
2. Для auth/profile/materials/chat/events открыть соответствующую строку таблицы выше.
3. Проверить изменяемые frontend/API/data/tests файлы по [CODE_MAP.md](./CODE_MAP.md); не искать по release/archive каталогам.
4. Перед handoff выполнить команды из [TESTING.md](./TESTING.md), включая `pnpm verify` и `git diff --check`.
