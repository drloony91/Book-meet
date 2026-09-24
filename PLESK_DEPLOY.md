# Развёртывание Book Meet в Plesk

## 1. Подготовить домен и базу

Канонический production-домен — `bookmeet.club`. `bot.oqyastana.kz` retired: не восстанавливать его DNS, сертификат или redirect и не задавать `LEGACY_ORIGIN`.

1. Отключить старое приложение бота в Plesk.
2. Создать новую MySQL-базу и отдельного пользователя только для Book Meet.
3. Выдать этому пользователю права на созданную базу, не использовать root.
4. Убедиться, что сервер БД, резервные копии и файловое хранилище физически находятся в Казахстане.
5. Сохранить экспорт старой базы бота отдельно; web-приложение её не использует.

Рекомендуемая кодировка базы — `utf8mb4`, сравнение — `utf8mb4_unicode_ci`.

## 2. Загрузить приложение

Загрузить содержимое папки `web project` в отдельный каталог, например:

```text
httpdocs/book-meet
```

Не загружать `.env`, локальный `node_modules` и старую D1-базу. Создать рядом с приложением постоянную папку `book-meet-uploads`, доступную процессу Node.js на запись.

## 3. Настроить Node.js в Plesk

- режим: `production`;
- версия Node.js: `22.13.0` (или более новая версия, явно принятая после проверки `engines.node`);
- пакетный менеджер: `pnpm@11.9.0` через Corepack;
- Application Root: каталог `book-meet`;
- Document Root: `book-meet/dist/client`;
- Application Startup File: `server/index.js`;
- домен: `bookmeet.club`;

Порт вручную фиксировать не нужно: приложение читает переменную `PORT`, которую выдаёт Plesk/Passenger.

## 4. Добавить переменные окружения

```text
NODE_ENV=production
APP_ORIGIN=https://bookmeet.club
DB_HOST=адрес_mysql
DB_PORT=3306
DB_NAME=имя_базы
DB_USER=пользователь_базы
DB_PASSWORD=сложный_пароль
DB_CONNECTION_LIMIT=5
SESSION_DAYS=7
UPLOAD_DIR=../book-meet-uploads
MARKETPLACE_PRIVATE_UPLOAD_DIR=../book-meet-marketplace-private-uploads
MAX_COVER_BYTES=5242880
BOOK_MEET_GROUP_CHATS_ENABLED=0
BOOK_MEET_READING_SESSIONS_ENABLED=0
BOOK_MEET_MARKETPLACE_ENABLED=0
# Только для явного db:seed/reset; после операции удалить из постоянного production environment.
TEST1_PASSWORD=отдельный_сложный_пароль
ADMIN_EMAIL=адрес_администратора
```

Секреты задаются в панели Plesk или в недоступном из web `.env`; их нельзя помещать в Git.

## 5. Установить и подготовить

В терминале Plesk из Application Root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm run db:setup
```

Используется только Corepack/pnpm с обязательным `--frozen-lockfile`; при недоступности этого инструмента установку следует остановить и устранить ограничение окружения. Production seed создаёт один административный аккаунт и требует явные `ADMIN_EMAIL` и `TEST1_PASSWORD`. `TEST1_PASSWORD` не читается normal startup или migrations: задавайте её только на время явного seed/reset и удаляйте после операции.

После этого перезапустить Node.js-приложение в Plesk.

## 6. Включить HTTPS

Выпустить сертификат Let's Encrypt для `bookmeet.club` и включить постоянное перенаправление HTTP → HTTPS. Retired `bot.oqyastana.kz` не должен участвовать в production-конфигурации. Production-cookie помечаются `Secure`.

Document Root указывает на `dist/client`, поэтому Plesk/nginx может отдавать `/` и статические assets напрямую, минуя middleware заголовков в `server/index.js`. На уровне Plesk/web server должны быть настроены эквивалентные security headers; перед релизом отдельно проверить обычным GET корневой HTML, direct SPA route, API и asset. Для HTML обязательны как минимум HSTS, CSP, `X-Content-Type-Options` и защита от framing.

## 7. Проверить перед открытием

1. `https://bookmeet.club/api/health` отвечает JSON с `"ok": true` и `"database": "mysql"`.
2. Открываются canonical root и прямые SPA-маршруты с production assets.
3. Выполняется вход единственным seed-аккаунтом администратора.
4. Новая книга после обновления страницы остаётся в библиотеке; обложка открывается по `/uploads/...`.
5. В логах нет ошибок доступа к `book-meet-uploads` и MySQL.

Автоматический `pnpm test` не поднимает отдельную реальную MySQL-базу. Если disposable-база доступна, миграцию, seed и вход проверьте отдельным эксплуатационным smoke перед открытием домена.

## 8. Резервное копирование

Ежедневно копировать одновременно:

- MySQL-базу;
- папку `book-meet-uploads`;
- приватную папку `book-meet-marketplace-private-uploads` (после включения маркетплейса);
- текущий production-релиз и файл с переменными окружения — в защищённом хранилище.

База, общие uploads и приватные изображения маркетплейса составляют единый снимок данных. Восстановление только части снимка приведёт к потерянным изображениям или ссылкам на отсутствующие файлы.

## Обновления после запуска

Перед каждым обновлением создать backup, затем:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm run db:migrate
```

После успешных миграций перезапустить приложение и проверить `/api/health`. `db:seed` на обычных обновлениях запускать не нужно: он предназначен для создания единственного seed-аккаунта администратора и сброса его пароля. Для recovery временно задать `ADMIN_EMAIL`/`TEST1_PASSWORD`, выполнить явную операцию, проверить вход и снова удалить `TEST1_PASSWORD` из постоянного environment; обычный restart и migration chain от неё не зависят.

### Поэтапный выпуск ТЗ 6

Релизный архив содержит все аддитивные миграции 052–057, но feature flags сначала остаются `0`. После согласованного backup и frozen install/build запускать миграции только до проверенного stop point; если части выпускаются в разные окна, перед каждым окном нужен новый согласованный backup. Параметр `--through` принимает точное имя существующего файла и не применяет следующие миграции:

GitHub-репозиторий в Plesk подключён к `bookmeet.club` в режиме **ручного** развёртывания; активная ветка — `agent/modular-architecture`, путь развёртывания — `/httpdocs/book-meet`. Подключение и `Получить сейчас` не являются разрешением нажимать `Развернуть сейчас`. Перед каждым ручным развёртыванием сверить точный SHA ветки с утверждённым release commit, инвентаризировать файлы сервера, которых нет в Git или которые отличаются от предыдущего release, и включить их в проверяемый backup. Если есть неучтённые серверные правки, остановить развёртывание до решения, как сохранить их; не считать Git-копию единственным источником данных для существующего production-каталога.

```bash
node scripts/migrate.js --through=052_unified_conversations_stop_point.sql
corepack pnpm run db:migrate:status
# Сверить conversation_backfill_reconciliations и число orphan-сообщений до продолжения.
node scripts/migrate.js --through=053_group_chat_server_foundations.sql
corepack pnpm run db:migrate:status
# После проверки 6A и отдельного включения его флага:
node scripts/migrate.js --through=055_reading_presence_visibility.sql
corepack pnpm run db:migrate:status
# После проверки 6B и отдельного включения его флага:
node scripts/migrate.js --through=057_marketplace_seller_restrictions.sql
corepack pnpm run db:migrate:status
```

Каждый stop point требует нулевых unresolved attempts, повторного no-op запуска до той же границы, проверки API/UI соответствующей части и отдельного решения о включении её флага. До включения маркетплейса убедиться, что `MARKETPLACE_PRIVATE_UPLOAD_DIR` указывает на persistent приватную папку вне Document Root и включён в согласованный backup. Нельзя запускать обычный `db:migrate` до завершения всех stop points: он применяет весь оставшийся chain.

## Rollback обновления

До production-обновления сохранить согласованный snapshot: текущий release-каталог, приватные environment settings, MySQL, `book-meet-uploads` и `book-meet-marketplace-private-uploads` (если папка существует). Backup базы и обоих хранилищ должен относиться к одной точке времени.

1. Для rollback кода восстановить предыдущий release в `/httpdocs/book-meet`, не запускать seed или migrations повторно, перезапустить Node.js и проверить health/assets/direct routes.
2. SQL-миграции не имеют универсального автоматического down-пути. Если прежний код совместим с уже расширенной схемой, оставить схему вперёд и откатить только код. Иначе восстанавливать pre-deploy backup базы вместе с соответствующим snapshot uploads.
3. При partial MySQL DDL не повторять migration вслепую и не считать `rollback()` доказательством отката. Проверить фактическую схему и `schema_migration_attempts`; marker-only retry разрешён только после ручного reconciliation и не является rollback.
4. После любого восстановления проверить `/api/health`, корневой HTML, direct SPA routes, вход тестовым аккаунтом, чтение существующего upload и отсутствие новых 5xx/DB/upload errors в logs.

Короткий обязательный gate и текущий verification snapshot находятся в [`docs/codex/PRODUCTION_READINESS.md`](./docs/codex/PRODUCTION_READINESS.md).

## Постоянная topology и staging runbook

Эта схема является частью deployment-контракта; production и staging никогда не используют одну базу, DB user, uploads-папку, seed credentials или secrets:

| Среда | Адрес/назначение | Данные и границы |
| --- | --- | --- |
| Production | `https://bookmeet.club` | production MariaDB, отдельный DB user и persistent `../book-meet-uploads` / `../book-meet-marketplace-private-uploads`; production seed только с явными credentials |
| Staging | `https://staging.bookmeet.club` | чистая отдельная MariaDB/database/user, persistent `../book-meet-staging-uploads` / `../book-meet-staging-marketplace-private-uploads`, отдельный staging admin и secrets; production data не копируется |
| Local/demo | `DEMO_MODE=1`, обычно `http://127.0.0.1:3000` | in-memory demo adapter, без внешней БД и без внешних integrations; не является staging или production |
| Local disposable MySQL | `127.0.0.1:3307` через `compose.mysql-test.yml` | test-only `book_meet_test`, test-only user, disposable container/volume/network; production и staging не подключаются |

### Создание staging в Plesk

1. Создать отдельный поддомен `staging.bookmeet.club` (отдельный application root, например `/httpdocs/book-meet-staging`) и не подключать его к production subscription paths. Включить HTTPS/Let's Encrypt и HTTP → HTTPS redirect.
2. Создать чистые MariaDB database и DB user, например `book_meet_staging` и `book_meet_staging_app`, выдать user права только на staging database. Не использовать root и не переиспользовать production DB name, user или password.
3. Создать persistent sibling directories `../book-meet-staging-uploads` и `../book-meet-staging-marketplace-private-uploads`, доступные Node process на запись. Они должны быть отдельными от production-хранилищ и переживать build/redeploy; приватную папку маркетплейса нельзя публиковать через web root.
4. Настроить Node.js ровно по lock/runtime contract: Node `22.13.0` (или явно проверенный `>=22.13.0`), Corepack `pnpm@11.9.0`, Application Startup File `server/index.js`, Document Root `dist/client`, `NODE_ENV=production`, `DEMO_MODE=0`.
5. Задать staging `APP_ORIGIN=https://staging.bookmeet.club`, отдельные `DB_*`, `UPLOAD_DIR=../book-meet-staging-uploads`, `MARKETPLACE_PRIVATE_UPLOAD_DIR=../book-meet-staging-marketplace-private-uploads`, новый `AUDIT_HASH_SECRET`, новый `ADMIN_EMAIL` и новый `TEST1_PASSWORD`. Флаги частей 6A/6B/6C включать последовательно только для их приёмки. Значения секретов не записывать в Git, ticket, logs или этот runbook. Не задавать `LEGACY_ORIGIN`.
6. До отдельного явного решения Google, SMTP и Telegram оставить выключены: пустые `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, пустые SMTP settings и `TELEGRAM_ALERTS_ENABLED=0`. Не добавлять staging credentials production OAuth, SMTP или Telegram и не отправлять сообщения обычным пользователям.

Безопасный baseline отключённых staging integrations:

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
TELEGRAM_ALERTS_ENABLED=0
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Если когда-либо потребуется тестовый SMTP/Telegram smoke, это отдельное явно согласованное изменение с allowlist получателя/администратора; baseline выше не меняется автоматически.

7. На boundary Plesk/nginx включить Basic Auth (или эквивалентное access restriction) для staging и не считать один только `noindex` защитой доступа. Добавить `X-Robots-Tag: noindex, nofollow, noarchive` и, если используется отдельный staging HTML boundary, `<meta name="robots" content="noindex,nofollow,noarchive">`. Проверить, что staging не индексируется.
8. На Plesk/nginx boundary настроить security headers для root HTML и static assets, а не только для proxied API: HSTS после включения HTTPS, CSP, `X-Content-Type-Options: nosniff`, framing protection (`X-Frame-Options: DENY` или эквивалент CSP), Referrer-Policy и Permissions-Policy. Не ослаблять production headers.

### Frozen install, migrations и staging seed

Из Application Root staging выполнить последовательно, сохраняя вывод команд без секретов:

```bash
export PATH=/opt/plesk/node/22/bin:$PATH
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm run db:migrate
corepack pnpm run db:migrate:status
corepack pnpm run db:migrate
corepack pnpm run db:migrate:status
corepack pnpm run db:seed
```

На текущем Hoster scheduler явный Node 22 PATH обязателен: без него Corepack может запустить дочерний Vite через системный legacy Node, даже если сам `corepack pnpm --version` выполнен Node 22. Перед install/build записать `node --version` и `corepack pnpm --version`, не выводя environment.

Ожидается, что первый migration run применит весь текущий последовательный chain, status покажет отсутствие unresolved `schema_migration_attempts`, а второй migration run будет no-op. Если status показывает unresolved attempt, сначала сверить фактическую схему и ledger; не повторять migration вслепую. `db:seed` запускать только после явного задания staging `ADMIN_EMAIL`/`TEST1_PASSWORD`; `db:seed-publisher` и production credentials в staging не использовать.

### Staging smoke и logs

После запуска Node проверить через staging HTTPS и с Basic Auth:

1. `/api/health` сообщает `ok: true` и `database: "mysql"`; `/` и `/books` отдают staging HTML.
2. Прямой SPA route (например `/profile`), текущие hashed JS/CSS assets и `/uploads` отвечают ожидаемыми статусами; в HTML/assets присутствует `X-Robots-Tag` и на root/direct route применяются HSTS, CSP, `nosniff` и framing protection.
3. Выполнить login единственным staging admin, открыть bootstrap/profile, затем logout; проверить, что повторный запрос требует входа.
4. Прогнать URL-regression сценарии: malformed publisher website должен вернуть контролируемый `400` (не `500`); malformed publisher sales links должны вернуть `400` (не `500`); пустые optional URLs должны оставаться валидными; malformed/incomplete URL в `/api/books/preview` должен вернуть `400` (не `500`); корректные URL Flip, Marwin/Меломан и Яндекс.Книги должны успешно обработаться.
5. Для каждого profile type — `Читатель`, `Писатель`, `Блогер`, `Издатель`, `Сообщество` — сохранить профиль через `PUT /api/users/me/state`, проверить успешный ответ и сохранение после refresh.
6. После этих URL/profile сценариев проверить staging application/Plesk logs: новых HTTP 500, unhandled exceptions, DB/auth/upload errors быть не должно. Отдельно сохранить результаты миграционного status/no-op и доступность `book-meet-staging-uploads` после restart/redeploy.

Для воспроизводимого URL/profile/upload smoke в Application Root доступна fail-closed команда:

```bash
STAGING_SMOKE=1 corepack pnpm run staging:smoke
# после restart Passenger
STAGING_SMOKE=1 corepack pnpm run staging:smoke -- --verify-upload-marker
# только после отдельного подтверждения удаления test artifact
STAGING_SMOKE=1 corepack pnpm run staging:smoke -- --verify-upload-marker --cleanup-upload-marker
```

Runner разрешён только для `staging.bookmeet.club`, staging-scoped DB и uploads при выключенных Google/SMTP/Telegram. Он создаёт только временные staging sessions, удаляет их в `finally`, сохраняет валидные fixture-профили через API и не содержит секретов. Verification mode по умолчанию только читает `.staging-upload-persistence-check`; удаление этого точного marker выполняется лишь с отдельно подтверждённым `--cleanup-upload-marker`.

Этот runbook описывает процедуру, а датированное live evidence хранится в [`docs/codex/PRODUCTION_READINESS.md`](./docs/codex/PRODUCTION_READINESS.md). Production `bookmeet.club` в рамках staging work не изменять.
