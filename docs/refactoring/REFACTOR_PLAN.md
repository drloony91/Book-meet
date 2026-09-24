# План безопасного рефакторинга Book Meet

Основание: [REFACTOR_AUDIT.md](./REFACTOR_AUDIT.md). Изменения выполняются последовательно; после каждого блока — целевые проверки и `git diff --check`.

## Блок 1 — tooling и production-safe seed

- Добавить единую `pnpm verify`.
- Сделать `scripts/seed.js` production fail-fast без явных `ADMIN_EMAIL`/`TEST1_PASSWORD`.
- Синхронизировать `.env.example`, `README.md`, `PLESK_DEPLOY.md` с одним seed-аккаунтом и canonical domain.
- Добавить/обновить статические contract tests.
- Проверки: `pnpm lint`, целевые tests, `pnpm test`.

## Блок 2 — подтверждённый dead code

- Удалить пять неиспользуемых frontend exports/functions.
- Удалить семь неиспользуемых/дублирующихся public-assets из audit allowlist.
- Повторить repository-wide поиск каждого имени.
- Проверки: `pnpm lint`, UI/production contracts, `pnpm build`.

## Блок 3 — spreadsheet lazy loading

- Создать небольшой общий frontend helper для чтения workbook через dynamic import.
- Не объединять различающиеся правила преобразования library/admin rows.
- Добавить контракт, исключающий static XLSX import и подтверждающий оба consumers.
- Проверки: `pnpm lint`, целевой test, `pnpm build`; сравнить bundle до/после.

## Блок 4 — локальная оптимизация material stats

- Ввести request-scoped cache результатов существующего `readableMaterialInfo`.
- Не менять SQL policy, DTO, 18+ и privacy semantics.
- Добавить статический/модульный regression contract на один cache key для повторных refs.
- Проверки: security/architecture tests и полный `pnpm test`.

## Блок 4b — production guard тестового publisher fixture

- `scripts/seed-publisher.js` должен завершаться до DB-вызова при `NODE_ENV=production`.
- Локальный optional fixture и его настраиваемые test credentials сохранить.
- Обновить contract test и документацию интеграций/проверок.

## Блок 4c — точечное устранение high dependency advisories

- Обновить direct Nodemailer только до первой исправленной версии `9.0.1`.
- Закрепить транзитивный nanoid на исправленной версии `3.3.18` через `pnpm.overrides`.
- Проверить фактически используемый mailer API, lockfile и повторить `pnpm audit --audit-level high`.
- Не выполнять массовое обновление остальных зависимостей.

## Блок 5 — техническая документация Codex

- Сохранить коротким корневой `AGENTS.md`; интегрировать его существующие orchestration/guardrail правила, а не стирать их.
- Создать `docs/codex/INDEX.md`, overview, architecture, feature/data/route/code maps, integrations, conventions, testing и tech debt.
- Исправить ссылки существующих README/docs, не дублируя canonical содержание.
- При необходимости generated inventory создавать детерминированным script; не хранить ручную копию каждой строки API.

## Блок 6 — финальная проверка

- `pnpm verify` и `git diff --check`.
- Demo runtime smoke: health, root, direct SPA route.
- Cold start: auth, profiles, materials/feed, chat, events — от `AGENTS.md`/`INDEX.md` до UI/API/data/tests не более чем за несколько переходов.
- Создать `docs/refactoring/REFACTOR_REPORT.md` с baseline vs final, изменениями, удалениями и остаточным риском.

## Осознанно вне текущего implementation scope

- Переписывание применённых миграций и запуск recovery на production DB.
- Полная batch/pagination перестройка bootstrap/search.
- Новый лимитер SSE или изменение online semantics без нагрузочного стенда.
- Массовое дробление `useBookMeetController`, `server/api.js` и `globals.css` без отдельной browser acceptance матрицы.
- Удаление пользовательских untracked release/archive/staging каталогов.
