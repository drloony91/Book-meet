# Book Meet: аудит перед рефакторингом

Дата: 2026-08-24
Исходный commit: `05b811f` (`agent/modular-architecture`)
Область: tracked-код в `app/`, `src/`, `server/`, `mysql/`, `scripts/`, `tests/`, `public/` и корневые runtime-конфиги.

## Исходное состояние

### Runtime и архитектура

| Область | Фактическое состояние |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8; `src/main.tsx` → `app/page.tsx` → `app/BookMeetApp.tsx` → `app/hooks/useBookMeetController.tsx` |
| Routing | Собственный History API router в `app/navigation/routes.ts`; React Router не используется |
| Backend | Один Express-процесс; entry point `server/index.js`, основной router `server/api.js` |
| Data | MySQL/MariaDB через `mysql2/promise`; DTO собираются в `server/data.js` |
| Schema | Последовательные SQL-миграции `mysql/migrations/001_*.sql` … `033_*.sql`; runner `scripts/migrate.js` |
| Auth | Cookie-сессии, scrypt, Google OAuth, TOTP/recovery codes; `server/security.js` и auth helpers в `server/api.js` |
| Permissions | Серверные проверки в `server/api.js`, `server/modules/social-permissions.js`, `server/modules/compliance.js` и material access helpers |
| Roles/profile types | Серверная роль `admin`; продуктовые типы профиля читателя, автора/блогера, издателя и сообщества |
| Localization | `ru`, `kk`, `en` через `app/i18n/index.tsx` и `app/i18n/messages.ts`; серверные auth-тексты в `server/modules/i18n.js` |
| Realtime/background | SSE `/api/realtime`, напоминания, age/deletion maintenance и transactional Telegram outbox |
| Storage/integrations | Локальный `UPLOAD_DIR`, SMTP, Telegram, Google Identity, внешние книжные страницы Flip/Marwin/Meloman/Yandex |
| Deploy | Vite assets + Express/Node в Plesk; canonical origin задаётся `APP_ORIGIN` |

### Команды и baseline

| Проверка | Результат до изменений |
|---|---|
| Toolchain | `packageManager=pnpm@11.9.0`, `engines.node >=22.13.0`; baseline выполнен Node `v24.19.0`, pnpm `11.19.0` |
| `pnpm lint` | PASS (`tsc --noEmit`) |
| `pnpm build` | PASS вне sandbox; sandbox-only запуск дал Vite/rolldown `spawn EPERM` |
| `pnpm test` | PASS: 105/105 |
| Bundle | основной JS `1,210.69 kB`, gzip `334.18 kB`; Vite предупреждает о chunk >500 kB |
| Runtime smoke | PASS в `DEMO_MODE=1`: `/api/health`, `/`, прямой `/books` → HTTP 200; health сообщает `demo-memory` |
| MySQL integration | В текущем baseline не выполнялась: отдельная disposable MySQL-база не предоставлена |

До начала работы tracked-файлы были чистыми. В workspace уже находились untracked пользовательские `AGENTS.md`, `.codex/*`, `README-CODEX.md`, staging-копия nodemailer и release-артефакты. Они не считаются результатом этого аудита и не подлежат автоматическому удалению.

## Существенные находки

### A-01 — P1 — runner миграций ошибочно полагается на rollback DDL

- Категория: надёжность / база данных.
- Место: `scripts/migrate.js`; многооператорные DDL-миграции, например `mysql/migrations/019_profile_age_material_controls.sql`, `023_material_books_occasions_home_view.sql`, `030_legal_safety_compliance.sql`.
- Проблема: runner оборачивает файл в транзакцию, но MySQL выполняет implicit commit для большинства DDL. При частичном сбое первые `ALTER/CREATE` могут сохраниться без записи в `schema_migrations`; повторный запуск затем падает на уже созданной колонке/таблице.
- Решение: не переписывать применённые миграции; спроектировать отдельный recovery/preflight механизм для новых миграций и документировать восстановление частично применённого файла.
- Риск изменения: высокий — затрагивает production schema lifecycle.
- Решение в текущем рефакторинге: документация/техдолг и regression-test контракта runner; полная смена стратегии требует отдельной DB-задачи с disposable MySQL.

### A-02 — P1 — production seed допускает известный пароль и игнорирует `ADMIN_EMAIL`

- Категория: безопасность / воспроизводимость.
- Место: `scripts/seed.js`, `.env.example`, `README.md`, `PLESK_DEPLOY.md`; историческое значение также находится в уже применённой `mysql/migrations/008_email_social_auth_totp.sql`.
- Проблема: `scripts/seed.js` содержит fallback-пароль и фиксированный e-mail; `ADMIN_EMAIL` документирован, но seed его не читает. Production-инструкция вызывает `db:setup`, поэтому ошибочная конфигурация может создать/сбросить административную учётную запись на известные данные.
- Решение: в production требовать явные `ADMIN_EMAIL` и `TEST1_PASSWORD`; в non-production сохранить удобный локальный fallback. Применённую миграцию `008` не переписывать.
- Риск изменения: средний; меняется только fail-fast поведение ручного seed.
- Решение в текущем рефакторинге: да, с контрактным тестом.

### A-03 — P1 — deployment/runbook расходится с текущим runtime

- Категория: документация / эксплуатационная надёжность.
- Место: `README.md`, `PLESK_DEPLOY.md`, `.env.example`, `scripts/seed.js`.
- Проблема: `.env.example` и runtime считают `bookmeet.club` canonical, а Plesk guide — `bot.oqyastana.kz`; README/Plesk обещают два seed-аккаунта, хотя seed создаёт один, а migration `008` удаляет старый `Тест 2`; инструкция допускает невоспроизводимый `npm install` без npm lockfile.
- Решение: синхронизировать guide с `APP_ORIGIN=https://bookmeet.club`, пометить `bot.oqyastana.kz` legacy redirect, описать один административный seed и оставить только frozen pnpm install.
- Риск изменения: низкий.
- Решение в текущем рефакторинге: да.

### A-04 — P2 — XLSX загружается всем пользователям eagerly

- Категория: производительность / дублирование.
- Место: статические imports в `app/components/content/ContentComponents.tsx` и `app/screens/ProfileScreens.tsx`; два file-import handler используют `XLSX.read`.
- Проблема: `xlsx.mjs` занимает около 1 MB и попадает в основной bundle ради двух редких действий импорта.
- Решение: общий helper с `await import("xlsx")`, вызываемый только после выбора файла; сохранить текущие схемы парсинга.
- Риск изменения: низкий/средний; нужны regression tests обеих форм импорта.
- Решение в текущем рефакторинге: да.

### A-05 — P2 — подтверждённый frontend dead code и неиспользуемые assets

- Категория: мёртвый код / репозиторий.
- Место: `app/services/api.ts` (`apiJson`, `jsonBody`); `app/components/content/ContentComponents.tsx` (`FriendProfile`, `LegacyAuthorBooksTab`, `AdminExcerptEditor`); `public/book-meet-favicon.png`, `public/book-meet-header-logo.png`, `public/book-meet-header-logo-v2.png`, `public/favicon.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg`.
- Доказательство: в tracked text нет import/call/URL-ссылок. Старый favicon побайтно равен используемому `book-meet-favicon-v2.png`; два старых header logo равны друг другу, а runtime использует только `book-meet-header-logo-v3.png`.
- Решение: удалить только перечисленные символы/файлы; не трогать shared CSS без отдельного доказательства.
- Риск изменения: низкий.
- Решение в текущем рефакторинге: да, с build/test и повторным поиском.

### A-06 — P2 — `/api/material-stats` выполняет request-time N+1

- Категория: backend performance.
- Место: `server/api.js`, route `GET /material-stats`.
- Проблема: после агрегатов endpoint последовательно вызывает `readableMaterialInfo` для каждого материала комментариев, сохранений пользователя и общих save-counts; один материал может проверяться повторно в нескольких циклах.
- Решение: сначала добавить request-scoped cache по `(kind,id)`, сохранив существующие permission helpers; полноценную batch permission query делать только с отдельными тестами/замерами.
- Риск изменения: средний из-за privacy/18+ contracts.
- Решение в текущем рефакторинге: только локальная дедупликация без изменения DTO/permissions.

### A-07 — P2 — presence heartbeat пишет в DB на каждый SSE socket

- Категория: backend performance / устойчивость.
- Место: `server/api.js`, `GET /realtime`; `presenceTouches` и `authenticatedUser` в том же файле.
- Проблема: каждая вкладка запускает собственный 20-секундный `UPDATE users`, хотя уже существует 30-секундное request-level окно `presenceTouches`; лимита активных SSE-соединений на пользователя нет.
- Решение: единый throttled presence helper или user-level heartbeat ownership; лимит соединений проектировать отдельно.
- Риск изменения: средний — online status и reconnect behavior.
- Решение в текущем рефакторинге: только если существующий cache можно переиспользовать с узким тестом; иначе техдолг.

### A-08 — P2 — catalog bootstrap/search масштабируются от всей базы

- Категория: backend performance / границы данных.
- Место: `server/data.js` (`loadUsers`, `loadBootstrap`), `server/api.js` (`/search/materials`).
- Проблема: catalog section загружает всех users и связанные libraries/reviews/excerpts/news; memberships и likes также читаются глобально для своих секций. Material search строится через bootstrap и фильтрацию в памяти.
- Решение: отдельные server-side paginated/scoped queries и измерение payload/query count.
- Риск изменения: высокий — DTO, visibility, блокировки, 18+, friendship/community isolation.
- Решение в текущем рефакторинге: не менять; описать как техдолг и отдельную performance-инициативу.

### A-09 — P2 — крупные центры логики усложняют безопасные изменения

- Категория: поддерживаемость / архитектура.
- Место: `server/api.js` (~3610 строк), `app/components/content/ContentComponents.tsx` (~1764), `app/hooks/useBookMeetController.tsx` (~1415), `app/globals.css` (~4434, 15 mobile media-query blocks).
- Проблема: controller одновременно владеет bootstrap/realtime/routing/actions/modal state; content-файл объединяет несвязанные UI; серверный router содержит большинство доменов; поздние CSS-слои зависят от порядка и specificity.
- Решение: только последовательные extract-by-feature операции с неизменными public contracts и browser QA desktop/mobile.
- Риск изменения: высокий.
- Решение в текущем рефакторинге: не выполнять широкое дробление; удалить подтверждённый мусор и задокументировать реальные boundaries.

### A-10 — P2 — отсутствует единая локальная команда полной проверки

- Категория: tooling / Definition of Done.
- Место: `package.json`, `README.md`, `.github/workflows/ci.yml`.
- Проблема: CI запускает typecheck и tests, но разработчик должен помнить несколько команд; `test` уже включает build, отдельного `verify` нет.
- Решение: добавить `pnpm verify`, которое fail-fast запускает `lint`, `test` и repository contract check; `git diff --check` оставить явной Git-проверкой в документации, так как package script не должен зависеть от наличия Git.
- Риск изменения: низкий.
- Решение в текущем рефакторинге: да.

### A-11 — P2 — workspace содержит много нетекущих копий проекта

- Категория: навигация Codex / repo hygiene.
- Место: untracked `.release-*`, `release-*`, `deploy-*`, `.prod-*`, архивы, staging-каталоги, `dist`, `tmp`, `node_modules` рядом с активным кодом.
- Проблема: глобальный поиск легко принимает snapshot за source of truth. Git эти копии не отслеживает, поэтому это не проблема release source, но это проблема локальной навигации.
- Решение: короткий active-path allowlist в `AGENTS.md`/`docs/codex/CODE_MAP.md`; физическое удаление/перенос пользовательских архивов не входит в задачу без отдельного разрешения.
- Риск изменения: отсутствует для документации, высокий для массовой очистки.
- Решение в текущем рефакторинге: только документация.

### A-12 — P3 — существующая документация полезна, но не образует Codex-навигацию

- Категория: документация.
- Место: `docs/architecture.md`, `docs/security-audit.md`, `README.md`, untracked исходный `AGENTS.md`.
- Проблема: нет feature → frontend → API → data map, route matrix, entity map и cold-start index; часть runbook устарела.
- Решение: создать `docs/codex/*`, оставить один основной источник для каждой темы и ссылаться на него из короткого `AGENTS.md`.
- Риск изменения: низкий.
- Решение в текущем рефакторинге: да.

### A-13 — P2 — тестовый publisher fixture можно запустить в production

- Категория: безопасность / seed tooling.
- Место: `scripts/seed-publisher.js`, команда `db:seed-publisher` в `package.json`.
- Проблема: скрипт создаёт заведомо тестовое уже одобренное издательство, книги и событие и использует известные fallback credentials, но не проверяет `NODE_ENV`.
- Решение: полностью запретить этот fixture при `NODE_ENV=production`; переменные `PUBLISHER_TEST_EMAIL`/`PUBLISHER_TEST_PASSWORD` оставить только для локального тестового сценария.
- Риск изменения: низкий; production fixture не является поддерживаемым пользовательским сценарием.
- Решение в текущем рефакторинге: да, отдельным fail-fast guard и contract test.

### A-14 — P1 — lockfile содержит high-уязвимости в почтовой и build dependency

- Категория: безопасность / supply chain.
- Место: direct `nodemailer@6.9.16`; транзитивный `nanoid@3.3.17` через `postcss`.
- Проблема: финальный `pnpm audit --audit-level high` обнаружил три high advisory: две в Nodemailer и одну в nanoid. Текущий mailer не передаёт Nodemailer `raw`, но уязвимая версия всё равно не должна оставаться в production lockfile.
- Решение: точечно обновить Nodemailer до первой исправленной `9.0.1` и закрепить транзитивный nanoid на исправленной `3.3.18` через pnpm override; массово остальные dependencies не обновлять.
- Риск изменения: низкий/средний; публичный API Nodemailer, используемый проектом (`createTransport().sendMail()`), нужно проверить отдельно и затем повторить полный verify/audit.
- Решение в текущем рефакторинге: да, отдельным блоком после обнаружения на финальном dependency audit.

## Проверка зависимостей

Все direct runtime dependencies из `package.json` имеют подтверждённые import sites: `dotenv`, `express`, `mysql2`, `nodemailer`, `qrcode`, `react`, `react-dom`, `sanitize-html`, `xlsx`. Оснований удалять dependency нет. Массовое обновление версий не входит в задачу; исключение — точечные security updates из A-14.

## Приоритет выполнения

1. Закрепить baseline и audit tests.
2. Исправить seed/runbook drift и добавить единую verify-команду.
3. Удалить только доказанный dead code/assets.
4. Вынести XLSX в lazy runtime helper.
5. Дедуплицировать permission checks внутри одного `/material-stats` request без изменения политики доступа.
6. Запретить production-запуск тестового publisher fixture.
7. Устранить high dependency advisories точечными обновлениями и повторным audit.
8. Создать `docs/codex/*`, техдолг и провести cold-start проверку.
9. Не выполнять в этой итерации широкую перестройку bootstrap/controller/server routes или migration lifecycle без отдельного MySQL/browser performance стенда.
