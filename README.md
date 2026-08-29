# Book Meet Web MVP

Самостоятельное web-приложение Book Meet для размещения на Hoster.kz/Plesk. Telegram-бот, Cloudflare Workers и D1 приложению не нужны.

Канонический production-адрес приложения — `https://bookmeet.club`. Retired `bot.oqyastana.kz` не входит в текущую конфигурацию: DNS, `LEGACY_ORIGIN` и runtime redirect для него не требуются.

Постоянная topology проекта разделена на четыре среды:

| Среда | Назначение | Граница данных |
| --- | --- | --- |
| Production | `https://bookmeet.club` | отдельная production MariaDB и `../book-meet-uploads` |
| Staging | `https://staging.bookmeet.club` | отдельная чистая MariaDB, DB user и `../book-meet-staging-uploads`; production data не копируется |
| Local/demo | `DEMO_MODE=1` | in-memory adapter, без внешней БД и integrations |
| Local disposable MySQL | `127.0.0.1:3307` | test-only `book_meet_test` из `compose.mysql-test.yml`, удаляемый после проверки |

Production и staging используют разные DB credentials, seed admin, upload storage и secrets. Подробный staging runbook находится в [PLESK_DEPLOY.md](./PLESK_DEPLOY.md).

## Архитектура

- React + Vite — интерфейс;
- Node.js + Express — сайт и `/api/*` в одном процессе;
- MySQL/MariaDB — постоянные данные;
- локальная папка `uploads` — загруженные обложки;
- защищённые cookie-сессии; пароли хэшируются через `scrypt`.

Приложение разворачивается единым процессом, но код разделён на внутренние клиентские и серверные модули. Каноническая Codex-навигация и карта текущего worktree находятся в [docs/codex/INDEX.md](./docs/codex/INDEX.md); краткая архитектура — в [docs/codex/ARCHITECTURE.md](./docs/codex/ARCHITECTURE.md). Старый [docs/architecture.md](./docs/architecture.md) оставлен compatibility pointer.

В MySQL сохраняются профили, единые карточки книг, библиотеки, книги писателей и ссылки, рецензии, отрывки, дружба, подписки, переписка, лайки, комментарии и уведомления.

## Воспроизводимая локальная среда

Проект фиксирует Node.js `22.13.0` в `.node-version`, `pnpm@11.9.0` в `package.json` и использует Corepack. Перед установкой проверьте `node --version` и включите Corepack (`corepack enable`), затем используйте frozen lockfile:

```bash
corepack enable
corepack pnpm run setup
```

Проектный скрипт `setup` выполняет `pnpm install --frozen-lockfile`. Production values не берутся из `.env.example`.

## Быстрый запуск demo без базы

Для проверки процесса, `/api/health`, корневой страницы и прямого SPA-маршрута MySQL не нужен:

```bash
corepack pnpm run setup
corepack pnpm demo
```

Demo использует отдельный in-memory адаптер и не доказывает работу реальной схемы, транзакций, seed или двухаккаунтных privacy/chat сценариев.

## Локальный запуск с MySQL

Требуется MySQL/MariaDB и пустая локальная база с `utf8mb4`. Скопируйте `.env.example` в `.env`, при необходимости измените только локальные параметры `DB_*`, затем:

```bash
cp .env.example .env
corepack pnpm install --frozen-lockfile
corepack pnpm run db:setup
corepack pnpm run dev
```

После заполнения `.env` сайт откроется по адресу `http://localhost:3000`.

`db:setup` применяет миграции и создаёт ровно один seed-аккаунт администратора:

- имя пользователя: `Тест 1`;
- email: значение `ADMIN_EMAIL`;
- пароль: значение `TEST1_PASSWORD`.

Для production переменные `ADMIN_EMAIL` и `TEST1_PASSWORD` нужно задать явно перед намеренным запуском seed/reset. `TEST1_PASSWORD` не является runtime credential: после операции удалите её из постоянного production environment. Не храните значения секретов в Git.

Production использует другие значения: `NODE_ENV=production`, `APP_ORIGIN=https://bookmeet.club`, отдельного пользователя БД без root, production `UPLOAD_DIR` и собственные admin credentials для явного seed/reset. Staging использует те же runtime boundaries с собственными domain, DB, uploads, admin и secrets; Google, SMTP и Telegram на staging выключены до отдельного явного решения. Полный список и порядок настройки находятся в [PLESK_DEPLOY.md](./PLESK_DEPLOY.md); локальный `.env.example` намеренно не содержит production/staging endpoints или credentials.

## Production

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm run db:setup
NODE_ENV=production corepack pnpm start
```

Пошаговая инструкция для панели находится в [PLESK_DEPLOY.md](./PLESK_DEPLOY.md).

## Проверки

```bash
corepack pnpm run verify
corepack pnpm audit --audit-level high
```

`pnpm test` выполняет сборку и статические/контрактные тесты; отдельное подключение к реальному MySQL в этот набор не входит. Перед переключением домена выполните миграцию, seed и проверку входа seed-аккаунтом на отдельной подготовленной базе, если такая база доступна.

Результаты и оставшиеся эксплуатационные проверки зафиксированы в [docs/security-audit.md](./docs/security-audit.md).
