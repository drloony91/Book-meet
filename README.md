# Book Meet Web MVP

Самостоятельное web-приложение Book Meet для размещения на Hoster.kz/Plesk. Telegram-бот, Cloudflare Workers и D1 приложению не нужны.

## Архитектура

- React + Vite — интерфейс;
- Node.js + Express — сайт и `/api/*` в одном процессе;
- MySQL/MariaDB — постоянные данные;
- локальная папка `uploads` — загруженные обложки;
- защищённые cookie-сессии; пароли хэшируются через `scrypt`.

В MySQL сохраняются профили, единые карточки книг, библиотеки, книги писателей и ссылки, рецензии, отрывки, дружба, подписки, переписка, лайки, комментарии и уведомления.

## Локальный запуск с MySQL

Требуется Node.js 22.13 или новее и пустая MySQL-база с `utf8mb4`.

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

После заполнения `.env` сайт откроется по адресу `http://localhost:3000`.

`db:setup` применяет миграции и создаёт два пустых тестовых аккаунта:

- `Тест 1` / `testtest1`
- `Тест 2` / `testtest2`

Пароли для production лучше переопределить переменными `TEST1_PASSWORD` и `TEST2_PASSWORD` до первого запуска seed.

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
npm run lint
npm test
```

Интеграционную проверку MySQL нужно выполнить на отдельной пустой базе перед переключением домена: миграция, seed, вход обоими аккаунтами и сценарий дружбы/сообщения/комментария.
