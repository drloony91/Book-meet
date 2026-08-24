# Book Meet Web MVP

Самостоятельное web-приложение Book Meet для размещения на Hoster.kz/Plesk. Telegram-бот, Cloudflare Workers и D1 приложению не нужны.

Канонический адрес приложения — `https://bookmeet.club`. Старый адрес `https://bot.oqyastana.kz` используется как legacy-домен и перенаправляет запросы на canonical origin ответом 301 с сохранением пути.

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

Для production переменные `ADMIN_EMAIL` и `TEST1_PASSWORD` нужно задать явно до первого запуска seed. Не храните их значения в Git.

Production использует другие значения: `NODE_ENV=production`, `APP_ORIGIN=https://bookmeet.club`, отдельного пользователя БД без root, production `UPLOAD_DIR`, сильные `TEST1_PASSWORD`/`ADMIN_EMAIL` и legacy-origin. Полный список и порядок настройки находятся в [PLESK_DEPLOY.md](./PLESK_DEPLOY.md); локальный `.env.example` намеренно не содержит production endpoints или credentials.

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
