# Развёртывание Book Meet в Plesk

## 1. Подготовить домен и базу

Канонический production-домен — `bookmeet.club`. `bot.oqyastana.kz` сохраняется только как legacy-домен и должен перенаправлять запросы на canonical origin.

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
- версия Node.js: 22 LTS или новее;
- Application Root: каталог `book-meet`;
- Document Root: `book-meet/dist/client`;
- Application Startup File: `server/index.js`;
- домен: `bookmeet.club`;

Порт вручную фиксировать не нужно: приложение читает переменную `PORT`, которую выдаёт Plesk/Passenger.

## 4. Добавить переменные окружения

```text
NODE_ENV=production
APP_ORIGIN=https://bookmeet.club
LEGACY_ORIGIN=https://bot.oqyastana.kz
DB_HOST=адрес_mysql
DB_PORT=3306
DB_NAME=имя_базы
DB_USER=пользователь_базы
DB_PASSWORD=сложный_пароль
DB_CONNECTION_LIMIT=5
SESSION_DAYS=7
UPLOAD_DIR=../book-meet-uploads
MAX_COVER_BYTES=5242880
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

Используется только Corepack/pnpm с обязательным `--frozen-lockfile`; при недоступности этого инструмента установку следует остановить и устранить ограничение окружения. Production seed создаёт один административный аккаунт и требует явные `ADMIN_EMAIL` и `TEST1_PASSWORD`.

После этого перезапустить Node.js-приложение в Plesk.

## 6. Включить HTTPS

Выпустить сертификат Let's Encrypt для `bookmeet.club` (и legacy-домена, если он обслуживается этим же Plesk), включить постоянное перенаправление HTTP → HTTPS и проверить 301 с `bot.oqyastana.kz` на canonical origin. Production-cookie помечаются `Secure`.

## 7. Проверить перед открытием

1. `https://bookmeet.club/api/health` отвечает JSON с `"ok": true` и `"database": "mysql"`.
2. Открываются canonical root и прямые SPA-маршруты; legacy-домен возвращает 301 на `https://bookmeet.club` с сохранением пути.
3. Выполняется вход единственным seed-аккаунтом администратора.
4. Новая книга после обновления страницы остаётся в библиотеке; обложка открывается по `/uploads/...`.
5. В логах нет ошибок доступа к `book-meet-uploads` и MySQL.

Автоматический `pnpm test` не поднимает отдельную реальную MySQL-базу. Если disposable-база доступна, миграцию, seed и вход проверьте отдельным эксплуатационным smoke перед открытием домена.

## 8. Резервное копирование

Ежедневно копировать одновременно:

- MySQL-базу;
- папку `book-meet-uploads`;
- текущий production-релиз и файл с переменными окружения — в защищённом хранилище.

База и `book-meet-uploads` составляют единый снимок данных. Восстановление только одного из них приведёт к потерянным обложкам или ссылкам на отсутствующие файлы.

## Обновления после запуска

Перед каждым обновлением создать backup, затем:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm run db:migrate
```

После успешных миграций перезапустить приложение и проверить `/api/health`. `db:seed` на обычных обновлениях запускать не нужно: он предназначен для создания единственного seed-аккаунта администратора и сброса его пароля.
