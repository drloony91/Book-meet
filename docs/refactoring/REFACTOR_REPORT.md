# Book Meet: отчёт о рефакторинге

Дата: 2026-08-24
Базовый commit: `05b811f` (`agent/modular-architecture`)
Основание: [REFACTOR_AUDIT.md](./REFACTOR_AUDIT.md), [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) и полная сверка исходного ТЗ в [TZ_COMPLIANCE.md](./TZ_COMPLIANCE.md).

## Что проверено

- Активные frontend/backend/data entry points, custom routing, bootstrap/realtime, auth/roles/permissions, localization, integrations, migrations, scripts, dependencies, tests и deployment docs.
- Baseline до изменений: TypeScript PASS, production build PASS вне sandbox, 105/105 tests, demo health/root/direct route PASS.
- Direct dependencies имеют подтверждённые import sites; dependencies не удалялись и массово не обновлялись. Выполнены только два точечных security update из A-14.
- Пять cold-start цепочек (`auth`, `profiles/privacy`, `materials`, `chat`, `events`) находятся от `AGENTS.md`/`INDEX.md` до frontend/API/data/tests без глобального поиска; broken local Markdown links: 0.

## Сверка исходного ТЗ 1–61

- Проверены все 61 пункта исходного ТЗ, включая отдельную фактическую проверку пунктов 39–61; документация сама по себе не считалась доказательством реализации tooling/contracts.
- Итог: **45 DONE**, **6 DONE / NOT APPLICABLE**, **9 PARTIAL**, **1 DEFERRED**, **0 NOT DONE**.
- Безопасно закрыты локальные пробелы: pinned toolchain, clean/demo setup, единый browser HTTP entry, generated route/schema maps с drift check, import/layer и migration checks, reference implementations, critical JSON shape guards.
- Остатки не маскируются: real MySQL/migration recovery, production/Plesk, полноценный mobile/upload browser pass, performance/SSE/large-center work и полный API schema registry остаются PARTIAL/DEFERRED с точными следующими проверками в матрице.

## Что исправлено

### Tooling и production safety

- Добавлена единая fail-fast команда `pnpm verify`; она включает types, architecture, migrations, generated-doc freshness, build и полный regression inventory; CI использует её.
- `.node-version` и CI фиксируют Node `22.13.0`, `packageManager`/CI — pnpm `11.9.0`; `pnpm run setup` использует frozen lockfile. `.env.example` теперь безопасен для локального старта, а production values остаются в Plesk runbook.
- `scripts/seed.js` в production требует явные `ADMIN_EMAIL` и `TEST1_PASSWORD`, реально использует `ADMIN_EMAIL` и не допускает известный fallback.
- `scripts/seed-publisher.js` как тестовый fixture полностью запрещён в production до загрузки DB/security modules.
- `.env.example`, `README.md`, `PLESK_DEPLOY.md` синхронизированы с canonical `bookmeet.club`, legacy redirect, одним admin seed и frozen pnpm install.
- Уязвимый `nodemailer@6.9.16` обновлён до исправленного `9.0.1`; транзитивный `nanoid@3.3.17` закреплён на `3.3.18`. Dynamic import и используемый `createTransport` API проверены без отправки письма.

### Мёртвый код и assets

- Удалены неиспользуемые `apiJson`, `jsonBody`, `FriendProfile`, `LegacyAuthorBooksTab`, `AdminExcerptEditor` и ставшие ненужными imports/types.
- Удалены семь неиспользуемых/дублирующихся assets: старый favicon, две старые header-logo копии и четыре Vite starter SVG. Экономия tracked source — около 2.9 MB.
- Не удалялись CSS selectors и другие похожие реализации без отдельного доказательства.

### Производительность

- Общий `app/services/spreadsheet.ts` загружает `xlsx` dynamic import только после выбора файла; правила library/admin row mapping остались раздельными.
- Основной minified JS уменьшился с `1,210.69 kB` до `848.08 kB`; XLSX вынесен в async chunk `363.42 kB`.
- `/api/material-stats` теперь один раз за request проверяет readability каждого `(kind,id)` и переиспользует Promise в трёх циклах. SQL, DTO и permission/18+/block semantics не менялись.

### Надёжность и документация

- Добавлены contracts для seed guards, dead assets, lazy XLSX, material-stats cache и Codex-документации.
- Все active browser HTTP flows используют `app/services/api.ts`; structural checker запрещает client → server/DB/Node imports, server → UI imports и новый global `fetch` вне canonical client.
- `pnpm docs:generate` формирует exact production API, frontend-route и migration/schema inventories; `pnpm docs:check` автоматически обнаруживает drift. Migration checker закрепляет именование, непрерывность, непустой SQL и terminal semicolon без изменения history.
- Удалён явный `any` у admin catalog source и нетипизированный Google global; bootstrap/public catalog JSON проверяется как `unknown` на критической верхней границе. Полная endpoint-schema миграция сознательно не выполнялась.
- `docs/architecture.md` оставлен коротким compatibility pointer; `docs/security-audit.md` явно помечен historical snapshot; data-processing audit ссылается на canonical model/integrations.
- Создана компактная текущая карта проекта в `docs/codex/`; корневой `AGENTS.md` сохраняет исходные orchestration/security/mobile guardrails и задаёт обязательный алгоритм cold start.

## Что сознательно не менялось

- Применённые SQL-миграции, schema/API/URL/business/role/privacy contracts.
- Широкое дробление `useBookMeetController.tsx`, `server/api.js`, `ContentComponents.tsx` и cascade-слоёв `globals.css` без отдельной browser acceptance матрицы.
- Полная pagination/batch-перестройка bootstrap/search и новый SSE limiter/online semantics.
- Пользовательские untracked release/archive/staging каталоги, `.codex/*`, nodemailer staging и production/Plesk state.
- Production deployment и production data.

## Оставшиеся проблемы

Канонический список: [KNOWN_TECH_DEBT.md](../codex/KNOWN_TECH_DEBT.md).

- P1: MySQL DDL partial-apply recovery в `scripts/migrate.js`.
- P2: residual N+1 в material stats, broad bootstrap/search reads, per-socket SSE presence writes, крупные logic/CSS centers.
- Validation gaps: нет disposable real MySQL в автоматическом наборе; нет полной browser automation mobile/upload; Vite всё ещё предупреждает об основном chunk >500 kB.

## Финальные проверки

| Проверка | Результат |
|---|---|
| `pnpm verify` | PASS: types + architecture + migrations + generated freshness + build + 120/120 tests |
| `pnpm audit --audit-level high` | PASS: no known vulnerabilities |
| `git diff --check` | PASS |
| Vite production build | PASS; main `848.54 kB`, XLSX async `363.42 kB` |
| Clean-copy bootstrap | PASS: frozen install, `check`, build, 120/120 tests |
| Demo HTTP smoke | PASS in clean copy: `/api/health`, `/`, `/books` |
| Generated/architecture negative probes | PASS: both intentional violations failed; probes removed |
| Browser desktop 1280×720 | PASS: guest feed, direct books, demo login, authenticated shell, direct profile route; console errors/warnings: 0 |
| Codex cold start | PASS 5/5; local Markdown links: 0 broken |
| Real MySQL / production | NOT RUN; не заявляется как проверенное |

## Созданная Codex-документация

- [INDEX.md](../codex/INDEX.md)
- [PROJECT_OVERVIEW.md](../codex/PROJECT_OVERVIEW.md)
- [ARCHITECTURE.md](../codex/ARCHITECTURE.md)
- [FEATURE_MAP.md](../codex/FEATURE_MAP.md)
- [DATA_MODEL.md](../codex/DATA_MODEL.md)
- [ROUTES_AND_API.md](../codex/ROUTES_AND_API.md)
- [CODE_MAP.md](../codex/CODE_MAP.md)
- [INTEGRATIONS.md](../codex/INTEGRATIONS.md)
- [CONVENTIONS.md](../codex/CONVENTIONS.md)
- [TESTING.md](../codex/TESTING.md)
- [KNOWN_TECH_DEBT.md](../codex/KNOWN_TECH_DEBT.md)
- [TZ_COMPLIANCE.md](./TZ_COMPLIANCE.md)
- [Generated API routes](../codex/generated/API_ROUTES.md), [frontend routes](../codex/generated/FRONTEND_ROUTES.md), [schema inventory](../codex/generated/SCHEMA.md)
