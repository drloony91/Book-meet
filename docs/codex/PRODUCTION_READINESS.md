# Book Meet production-readiness gate

Этот gate выполняется до отдельного решения о production deployment. Он не разрешает migrations, restart, изменение environment или данных production.

## Обязательные gates

- [ ] Release привязан к точному commit; архив содержит build/server/migrations, но не `.env`, uploads или локальные artifacts.
- [ ] Зафиксированы фактические `node --version` и `pnpm --version`; Node удовлетворяет `engines.node`, pnpm равен `packageManager`; выполнен `pnpm install --frozen-lockfile`.
- [ ] Прошли `pnpm verify`, `pnpm audit --audit-level high` и `git diff --check`.
- [ ] Прошёл `pnpm verify:db` на текущем наборе migrations в disposable MySQL; контейнер, volume и network удалены.
- [ ] Прошёл `pnpm test:e2e`: desktop, mobile, upload, console/network diagnostics.
- [ ] Доказана изоляция staging domain, DB, accounts, uploads и integrations от production.
- [ ] Env-проверка содержит только статусы `configured`, `missing`, `invalid format`, `not applicable`; секреты не выводятся.
- [ ] Migration preflight сравнил repository и staging ledger, проверил unresolved attempts и создал согласованный backup DB/uploads до apply.
- [ ] На staging прошли frozen install, build, start, health, root, direct routes, fresh assets, bootstrap, login/profile/logout и нужные API.
- [ ] На staging проверены upload write/read/public access/cleanup и сохранность файла после restart/redeploy.
- [ ] На staging проверены SSE connect/reconnect/no-buffering и только безопасные SMTP/Google/Telegram smoke.
- [ ] После smoke и restart в application/Plesk logs нет новых 5xx, unhandled, DB, auth или upload errors.
- [ ] Подготовлен и, где безопасно, отрепетирован rollback кода/process; для DB указано, где возможен только restore backup, включая partial DDL.
- [ ] Production deployment отдельно и явно разрешён пользователем после итогового verdict.

## Verification snapshot — 2026-08-27

Verdict: **NOT PRODUCTION READY**. Production не изменялся.

| Область | Доказательство | Статус |
| --- | --- | --- |
| Local install/toolchain | Frozen install PASS, но доступный local runtime Node 24.19.0 / pnpm 11.19.0 не совпадает с CI baseline Node 22.13.0 / `packageManager` pnpm 11.9.0 | BLOCKED |
| Local gate | `pnpm verify`: build и 128/128 tests PASS; `pnpm audit --audit-level high`: no known vulnerabilities; `git diff --check` PASS | PASS |
| Browser regression | `pnpm test:e2e`: 23 PASS, 1 ожидаемый project-skip (mobile-only test в desktop project) | PASS, demo-only |
| Disposable MySQL | `pnpm verify:db` PASS на 37 последовательных migrations; production migrations/seed и A-01 recovery fixture прошли 2/2, scoped container/volume/network удалены | PASS |
| Environment | В доступном Plesk найдена только production-среда `bookmeet.club`; отдельные staging domain/DB не найдены | BLOCKED |
| Plesk runtime | Node 22.23.2, production mode, ожидаемые roots/startup file; UI command runner предоставляет npm/yarn, фактический pnpm 11.9.0 не подтверждён | BLOCKED |
| Public smoke | Health/MySQL, root, `/books`, `/profile`, public catalog и текущие hashed JS/CSS отвечают; unauthenticated bootstrap/realtime возвращают ожидаемый 401; browser console errors 0 в выполненном guest desktop smoke | PARTIAL |
| HTTPS/proxy | TLS verify и HTTP→HTTPS 301 PASS. Legacy hostname не разрешается через DNS. `/books` и API получают security headers, но `/` и static asset — нет | BLOCKED |
| Env validation | Critical DB/session/audit/upload/Google/Telegram/SMTP variables присутствуют; `LEGACY_ORIGIN` отсутствует, obsolete `TEST2_PASSWORD` присутствует; defaulted/managed variables требуют отдельной сверки | BLOCKED |
| Migrations | Production ledger, pending migrations, unresolved attempts и DB engine version не проверялись без отдельного staging/production read-only DB procedure | BLOCKED |
| Uploads | Persistent sibling `book-meet-uploads` существует вне release-каталога; write/read/public/cleanup и persistence after restart не проверены | BLOCKED |
| Logs | Read-only разбор исторических Plesk logs нашёл все 7 HTTP 500 и общий дефект URL validation; для двух `POST /api/books/preview` связь с дефектом имеет высокую уверенность, но для пяти `PUT /api/users/me/state` точная историческая причина не доказана из-за отсутствия request body/stack trace | BLOCKED |
| Backup/restart | В Plesk виден backup с датой 16.08.2026; полнота DB/uploads и restore не проверены. Restart/redeploy не выполнялись, потому что staging отсутствует | BLOCKED |
| Integrations/SSE | Конфигурация presence проверена без значений; реальная отправка SMTP/Telegram, Google login и authenticated SSE/reconnect не выполнялись против production | BLOCKED |

Перед повторным gate нужен отдельный staging или прямое разрешение на строго перечисленные read-only/controlled production checks. До этого нельзя выполнять production migrations, restart или deploy.

## Staging verification status — 2026-08-28

Постоянная staging-среда создана и проверена отдельно от production. Production `bookmeet.club`, её DB, uploads, environment и процесс в ходе staging-развёртывания не изменялись. Значения секретов в evidence и документацию не переносились.

| Проверка | Требуемое evidence | Статус |
| --- | --- | --- |
| Domain/access | `staging.bookmeet.club`: trusted Let's Encrypt TLS, HTTP → HTTPS, unauthenticated `401` с realm `Book Meet Staging`; authenticated root/static ранее подтвердили `X-Robots-Tag`, HSTS, CSP, `nosniff` и framing protection | PASS |
| Isolation | отдельные MariaDB database/user, staging admin/secrets и `../book-meet-staging-uploads`; production data/credentials не использовались, production не изменялся | PASS |
| Runtime | Plesk Node `22.23.2`, `NODE_ENV=production`, отдельные Application/Document Root и `server/index.js`; build/start и фактический Passenger restart подтверждены. Отдельное доказательство успешного Plesk-side `pnpm@11.9.0 install --frozen-lockfile` не сохранено | PARTIAL |
| Migrations | чистая staging DB получила все 37 migrations; unresolved attempts `0`; второй migration run — no-op | PASS |
| Seed/integrations | отдельный staging admin и ровно по одному fixture каждого profile type; Google, SMTP и Telegram выключены, отправок не выполнялось | PASS |
| Smoke | health/MySQL, root, `/books`, direct route, fresh asset, login/bootstrap/logout, URL/profile regression и security headers прошли; upload marker сохранился после Passenger restart; после smoke нет новых 5xx/unhandled/DB/auth/upload errors | PASS |

### Staging URL/profile regression checklist

Эти проверки выполнены 27–28 августа 2026 на изолированной staging DB локальным loopback smoke-процессом на staging-хосте. Временные smoke sessions удалены в `finally`; profile fixture сохраняет только валидные поля через публичный API-контракт.

- malformed publisher website → `400 INVALID_URL` — PASS;
- malformed publisher sales links → `400 INVALID_URL` — PASS;
- empty optional URLs → `200` — PASS;
- malformed/incomplete URL в `/api/books/preview` → `400` — PASS;
- корректные URL Flip, Marwin/Меломан и Яндекс.Книги → `200` с распознанным marketplace — PASS;
- `PUT /api/users/me/state` и последующий bootstrap refresh для `Читатель`, `Писатель`, `Блогер`, `Издатель`, `Сообщество` — PASS;
- после URL/profile smoke в staging access logs остаётся только ранний `GET /api/health` 500 от 27 августа 15:18, до успешного запуска; новых HTTP 500 и записей error/exception/fatal/unhandled после smoke нет — PASS.

Открытые staging gaps до production decision: authenticated SSE connect/reconnect/no-buffering; публичное чтение/cleanup тестового upload; сохранённое доказательство точной Plesk-side frozen-install команды; согласованный backup/rollback rehearsal. Тестовый marker `.staging-upload-persistence-check` намеренно не удалён без отдельного подтверждения на удаление.

Каноническая процедура находится в [`PLESK_DEPLOY.md`](../../PLESK_DEPLOY.md), а тестовая матрица — в [`TESTING.md`](./TESTING.md). Production `bookmeet.club` остаётся неизменённым и не может быть заменён staging evidence.

## Диагностика семи HTTP 500 — 2026-08-27

Production исследовался только read-only. Deployment, migrations, restart, изменение env и production data не выполнялись. IP, cookies, токены, request bodies и значения секретов в отчёт не переносились.

### Исторические события

Plesk access logs содержат пять `PUT /api/users/me/state` со статусом 500 в `2026-08-26 14:38:18`, `14:38:30`, `14:38:58`, `14:41:01`, `19:12:44` и два `POST /api/books/preview` в `19:13:30`, `19:13:32` (время Plesk). Все семь относятся к одному обезличенному client/UA context. Рядом зафиксированы успешные state-запросы в `19:13:45`, `19:14:01`, `19:14:17`, успешный preview в `19:14:10` и успешные создания книг со статусом 201.

Доступные `error_log` и `proxy_error_log` не содержат соответствующих строк за 26 августа. В access logs отсутствуют request body, application stack trace, MySQL error/code и внешний marketplace response. Поэтому отсутствие новых 5xx в более позднем окне логов не является доказательством устранения, а точная атрибуция каждого исторического state-запроса невозможна.

### Установленный дефект и исправление

Обе цепочки использовали `cleanUrl()`. Для malformed/incomplete URL `new URL()` выбрасывал обычный `TypeError` без `statusCode`; глобальный error handler превращал его в HTTP 500. Preview UI отправляет введённое значение после debounce до предварительной проверки URL. Profile form имеет `noValidate`, а URL сайта/продаж издателя также проходят через `cleanUrl()` внутри state handler.

В `cleanUrl()` добавлена единая нормализация malformed и non-HTTP(S) URL в контролируемую ошибку `400 INVALID_URL`. Empty optional URL по-прежнему допустим. Контракты поддерживаемых marketplace не расширялись: Flip, Marwin/Меломан и Яндекс.Книги остаются прежними.

Regression test сначала воспроизвёл дефект: malformed publisher/profile/marketplace URL давал `TypeError` без `statusCode`. После исправления тот же сценарий возвращает 400. Fixture/mock проверки также покрывают metadata parsing Flip, Marwin и Яндекс.Книги, safe/broken redirects, upstream 503, DNS error, abort/timeout, malformed markup и oversized response; ожидаемые статусы 502/422 сохранены.

Для двух близких preview 500 наиболее вероятна одна причина: UI дважды отправил ещё некорректную/неполную ссылку, после чего исправленный ввод дал 200. Это подтверждается временной последовательностью и точным красно-зелёным воспроизведением дефекта, но исходный request body не сохранился. Для пяти state 500 доказан тот же достижимый дефект в publisher URL fields, однако отсутствующие payload/stack/MySQL trace не позволяют утверждать, что все пять вызваны только им; DB, filesystem/avatar и ownership branches исторически не исключены.

### Локальные gates

- `pnpm verify`: PASS, build и 128/128 tests.
- `pnpm test:e2e`: контрольный прогон PASS, 23 passed / 1 ожидаемый desktop skip. Первый прогон имел единичный desktop `Failed to fetch` в существующем avatar-upload test; изолированный повтор прошёл 2/2, затем полный повтор прошёл.
- `pnpm audit --audit-level high`: PASS, no known vulnerabilities.
- `git diff --check`: PASS.
- Repository migrations: 37 последовательных файлов, `001`–`037`.
- `pnpm verify:db`: PASS, 2/2 disposable-MySQL integration tests; scoped container, volume и network удалены. Production DB не использовалась.

Блокер семи 500 понижен только частично: исправление готово для staging, но production остаётся без изменений, а точная историческая атрибуция state cluster остаётся открытой.
