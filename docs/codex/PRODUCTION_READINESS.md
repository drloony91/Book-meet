# Book Meet production-readiness gate

Этот gate выполняется до отдельного решения о production deployment. Он не разрешает migrations, restart, произвольное изменение environment или данных production. Единственное точечное исключение финальной подготовки от 28 августа 2026 — явно разрешённое `LEGAL_CONSENT_REQUIRED=1`, фиксирующее уже действовавший default без изменения legal-gate поведения.

## Обязательные gates

- [x] Release привязан к точному commit; архив содержит build/server/migrations, но не `.env`, uploads или локальные artifacts.
- [x] Зафиксированы фактические `node --version` и `pnpm --version`; Node удовлетворяет `engines.node`, pnpm равен `packageManager`; выполнен `pnpm install --frozen-lockfile`.
- [x] Прошли `pnpm verify`, `pnpm audit --audit-level high` и `git diff --check`.
- [x] Прошёл `pnpm verify:db` на текущем наборе migrations в disposable MySQL; контейнер, volume и network удалены.
- [x] Прошёл `pnpm test:e2e`: desktop, mobile, upload, console/network diagnostics.
- [x] Доказана изоляция staging domain, DB, accounts, uploads и integrations от production.
- [x] Env-проверка содержит только статусы `configured`, `missing`, `invalid format`, `not applicable`; секреты не выводятся.
- [x] Migration preflight сравнил repository и staging ledger, проверил unresolved attempts и создал согласованный backup DB/uploads до apply.
- [x] На staging прошли frozen install, build, start, health, root, direct routes, fresh assets, bootstrap, login/profile/logout и нужные API.
- [x] На staging проверены upload write/read/public access/cleanup и сохранность файла после restart/redeploy.
- [x] На staging проверены SSE connect/reconnect/no-buffering и только безопасные SMTP/Google/Telegram smoke.
- [x] После smoke и restart в application/Plesk logs нет новых 5xx, unhandled, DB, auth или upload errors.
- [x] Подготовлен и, где безопасно, отрепетирован rollback кода/process; для DB указано, где возможен только restore backup, включая partial DDL.
- [x] Production deployment отдельно и явно разрешён пользователем после итогового verdict (2026-09-08).

## Goals, progress notes and book shelves (queue 3) — 2026-09-08 release candidate

Verdict: **LOCAL RELEASE GATES PASS; PRODUCTION DEPLOYMENT AUTHORIZED**. Deployment must use the exact committed artifact, coordinated backup, migration stop gates and post-restart smoke below.

- Candidate schema: append-only `040_reading_goals.sql`, `041_book_progress_notes.sql` and `042_book_shelves.sql`. Goals are private; note bodies are server-filtered by frozen progress and viewer-aware privacy; public shelves apply block/hide/age rules and participate in the existing material-action and moderation flows.
- Local evidence: `pnpm verify` passed the production build and 170/170 Node tests; `pnpm verify:db` passed 3/3 top-level disposable-MySQL tests including authenticated queue-3 HTTP matrices and removed its resources; the full desktop/mobile Playwright run passed 77 scenarios with 3 expected cross-viewport skips; `pnpm audit --audit-level=high` found four moderate findings and no high/critical finding; generated documentation and `git diff --check` passed.
- Visual evidence: desktop and mobile screenshots were inspected for goals, inline notes, owner shelf detail and foreign shelf detail, including material actions, comments and batch-add feedback.
- Current production before this deployment remains commit `8efb4205446edeac5d48cf91961fa74c7dbaf179` with 39 applied migrations. No seed, credential rotation or external Telegram/SMTP delivery belongs to this release.
- Stop gates: verify the release commit and SHA-256, create and off-host-verify the coordinated DB/uploads/current-release/redacted-environment backup, then run migration status → apply → status → no-op → status with zero unresolved attempts before restart.

## Reading state (queue 2) — 2026-09-04, release candidate

Verdict: **LOCAL RELEASE GATES PASS; STAGING AND PRODUCTION DEPLOYMENT AUTHORIZED AND PENDING**. Publication proceeds only with the exact committed artifact, coordinated backups, migration stop gates and post-restart smoke.

- Candidate schema: append-only `039_reading_state_cycles.sql`, five reading statuses, private chapter/page progress, timezone-aware postponed periods and retained completion cycles. No production migration or restart has been performed for this candidate at the time this release document is committed.
- Local evidence: `pnpm verify` passed build and 159/159 tests. `pnpm verify:db` passed 3/3 top-level tests, including the production HTTP transition/privacy/transaction matrix and an actual populated 038-to-039 upgrade; disposable MySQL resources were removed afterward. The final repeated `pnpm test:e2e` passed 59 scenarios with one expected desktop-only skip after the isolated rerun of one transient SSE fetch failure also passed. `pnpm audit --audit-level high` passed with four moderate findings and no high/critical finding; `git diff --check` passed.
- Read-only production preflight: Node `22.23.2`, pnpm `11.9.0`, MariaDB `10.6.27`; repository and ledger both contain 38 migrations, with zero unresolved attempts. The observed database contains 14 canonical books and 23 library relations. Uploads are outside the application release directory.
- Plesk's command runner does not inherit the web-process environment. The existing private `.env` has a retired origin, while the active Plesk environment has the canonical production origin. Before the read-only DB check, DB host/port/name/user and upload settings were compared against the active Plesk settings; only the short-lived runner process received the verified canonical origin. No persistent environment settings or credential values were changed or recorded.
- Telegram and SMTP are configured in the active Plesk environment; the Telegram outbox had zero pending rows at preflight. No external messages were sent. Recheck this condition at the actual restart gate.
- The prior `da686a4` release archive remains available locally and its SHA-256 was reverified as `CA8F2A116359D4E17BAB1763E54931D48EE318DB9A2D2BB2A64026013D9CD6C1`.
- Still required after this commit: bind the candidate to an exact artifact and checksum; isolated staging verification; coordinated production DB/uploads/release/config backup with off-host proof; migration/status/no-op checks; restart and authenticated production smoke/log review. Do not seed, rotate credentials, send integration messages or clean unrelated legacy paths as part of this update.

## Chat, notifications and deleted organizations release candidate — 2026-08-30

Verdict: **READY FOR USER-MANAGED PLESK UPLOAD WITH PRE-RESTART MIGRATION**. Codex prepares and verifies the exact local artifact; upload, production migration and restart remain user-managed.

- Scope: chat system-message deduplication for new friendship/community events, browser-local message dates and times, live read receipts, activity sorting with support last, per-viewer history clearing, deleted-organization directory filtering and removal of personal messages from the general notification center.
- Schema: append-only `038_chat_history_clears.sql`. It adds a per-viewer message-ID cursor and removes historical `new_message` notification rows; it does not delete message rows, friendships, report evidence or the peer's history.
- Required Plesk order: coordinated production backup -> extract the exact artifact -> frozen install -> production build -> `db:migrate` -> `db:migrate:status` -> repeat `db:migrate` as a no-op -> repeat status -> only then restart.
- Seed is forbidden for this update. If migration status reports an unresolved attempt, stop and reconcile the actual schema before any retry.
- Local evidence: `pnpm verify` 132/132, `pnpm test:e2e` 29 passed with one expected desktop skip, `pnpm verify:db` 2/2 with 38 migrations and disposable-resource cleanup, plus `git diff --check` pass.
- Existing historical reciprocal system-message duplicates are not bulk-deleted because the database does not contain an explicit duplicate marker; new friendship/community events create one persisted system row.

## Final production preparation — 2026-08-28

Verdict: **PRODUCTION READY WITH EXPLICIT RISKS**. Production deployment, migrations и restart не выполнялись; production data не изменялись.

| Предыдущий blocker | Фактическое evidence | Статус |
| --- | --- | --- |
| Stray runtime export | Единственный unstaged hunk `export function bookProductFromHtml` удалён точечно. Runtime/source и migrations снова не имеют diff относительно staging-tested candidate `8107864d0c18e4ee77142b7de8104df588f918a6`; оставшиеся локальные изменения — canonical env example, focused test и этот readiness report | RESOLVED |
| Credentials exposure | Focused scan текущего tracked tree, Git history по известным token/private-key форматам и release archive не нашёл фактических secret values или приватных env-файлов; значения не переносились в Git, evidence или отчёт. Пользователь явно отложил ротацию production credentials | ACCEPTED EXPLICIT RISK: выполнить coordinated rotation после deployment window; доказанная утечка немедленно вернёт статус BLOCKED |
| Legal consent ambiguity | Staging не имел явного `LEGAL_CONSENT_REQUIRED=0` и работал по default `1`. В production Plesk сохранено только `LEGAL_CONSENT_REQUIRED=1`; UI показывает status `configured`. Health/MySQL остались PASS без restart, а публичный legal contract остался `required=true`, `configured=true`. `.env.example` теперь содержит `LEGAL_CONSENT_REQUIRED=1`; focused test доказывает эквивалентность default и явного `1`, а также обязательность полного registration consent | RESOLVED |

### Финальный verification snapshot

- `pnpm verify`: PASS, production build и 129/129 tests;
- `pnpm verify:db`: PASS, 2/2 disposable-MySQL integration tests; scoped container, volume и network удалены;
- `pnpm test:e2e`: 23 PASS, 1 ожидаемый desktop project-skip;
- `pnpm audit --audit-level high`: PASS, no known vulnerabilities;
- `git diff --check`: PASS;
- production health: `ok=true`, service `book-meet`, database `mysql`; root продолжает отдавать проверенные hashed JS/CSS assets;
- последние 1000 production Plesk log entries: HTTP 5xx `0`, error/exception/fatal/unhandled signals `0`;
- remote `origin/agent/modular-architecture` остаётся на `05b811f`; push не выполнялся.

### Остаточные явные риски

- production credentials сознательно не ротируются в этой задаче; это принятое решение, а не доказательство утечки;
- final candidate и воспроизводимый artifact сохраняются локально, пока GitHub branch не обновлён из-за прежнего workflow-authorization ограничения;
- production backup/restore не репетируется в этой задаче: перед deployment обязателен coordinated DB/uploads/release/env snapshot, off-host copy и проверенный manifest; staging rehearsal остаётся доказательством процедуры, но не заменяет production backup;
- после будущего deployment/restart нужно повторить authenticated SSE, controlled upload, Google OAuth, ограниченные SMTP/Telegram smoke, headers, routes и log window. Любой failed gate требует STOP/rollback.

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
| Runtime | Plesk Node `22.23.2`, pnpm `11.9.0`, `NODE_ENV=production`, отдельные Application/Document Root и `server/index.js`; offline `install --frozen-lockfile`, build и Plesk restart PASS. Для scheduler build явно использован Node 22 PATH, чтобы не подхватить системный legacy Node | PASS |
| Migrations | чистая staging DB получила все 37 migrations; unresolved attempts `0`; второй migration run — no-op | PASS |
| Seed/integrations | отдельный staging admin и ровно по одному fixture каждого profile type; на исходном этапе Google, SMTP и Telegram были выключены и отправок не выполнялось; позднейшие разрешённые integration smoke зафиксированы ниже | PASS |
| Smoke | health/MySQL, root, `/books`, direct route, fresh asset, login/bootstrap/logout, URL/profile regression и security headers прошли; upload marker сохранился после Passenger restart и затем был удалён с отдельным подтверждением; после smoke нет новых 5xx/unhandled/DB/auth/upload errors | PASS |

### Staging URL/profile regression checklist

Эти проверки выполнены 27–28 августа 2026 на изолированной staging DB локальным loopback smoke-процессом на staging-хосте. Временные smoke sessions удалены в `finally`; profile fixture сохраняет только валидные поля через публичный API-контракт.

- malformed publisher website → `400 INVALID_URL` — PASS;
- malformed publisher sales links → `400 INVALID_URL` — PASS;
- empty optional URLs → `200` — PASS;
- malformed/incomplete URL в `/api/books/preview` → `400` — PASS;
- корректные URL Flip, Marwin/Меломан и Яндекс.Книги → `200` с распознанным marketplace — PASS;
- `PUT /api/users/me/state` и последующий bootstrap refresh для `Читатель`, `Писатель`, `Блогер`, `Издатель`, `Сообщество` — PASS;
- после URL/profile smoke в staging access logs остаётся только ранний `GET /api/health` 500 от 27 августа 15:18, до успешного запуска; новых HTTP 500 и записей error/exception/fatal/unhandled после smoke нет — PASS.

### Production-like gates и rollback rehearsal — 2026-08-28

Итог: **STAGING READY WITH EXPLICIT RISKS**. Целевой staging release возвращён на `5d6e90b`; production deployment не выполнялся, production `bookmeet.club` не изменялся.

| Gate | Фактическое evidence | Статус |
| --- | --- | --- |
| Authenticated SSE | Авторизованный `GET /api/realtime` вернул `200 text/event-stream`, `Cache-Control: no-cache, no-transform`; first chunk 13–63 ms, heartbeat 20.019–20.069 s; три финальных reconnect получили connected event за 50–59 ms | PASS WITH RISK: функционально buffering не обнаружен, но внешний proxy не вернул диагностический `X-Accel-Buffering` header |
| Public staging upload | Публичный URL под staging Basic Auth вернул `200 image/png`, 68 bytes; SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460` совпал до backup, после restore, restart, redeploy, rollback и финального roll-forward | PASS |
| SMTP | Выполнена ровно одна разрешённая `[STAGING/TEST]` отправка только на `kitap@oqyastana.kz`; request accepted, SMTP socket transport success | PASS WITH RISK: подтверждён transport acceptance, но не ручное чтение письма в inbox |
| Telegram | Выполнено ровно одно `[STAGING/TEST]` сообщение существующим ботом только в admin chat; Telegram API вернул HTTP 200, recipient class `admin-chat-only`; пользовательских отправок не было | PASS |
| Google OAuth | `/api/auth/providers` вернул `google: false` и пустой client id; отдельные staging credentials намеренно не создавались | PASS, intentionally disabled |
| Backup capability | Native Plesk Backup Manager доступен только на уровне всей subscription и затрагивает production scope, поэтому для rehearsal не использовался. На хосте подтверждены `mysqldump`, `mysql`, `tar`, `gzip`; создан staging-only snapshot в защищённом subscription storage | PASS WITH RISK: staging backup пока является проверенной ручной процедурой, а не отдельной автоматической Plesk policy |
| Coordinated staging backup | `snapshot-3dfc5dc2beb07bda`, UTC `2026-08-28T10:41:33.327Z`: DB dump 168250 bytes, uploads archive 277 bytes, release/config archive 46468923 bytes; SHA-256 каждого файла записан в защищённом `manifest.json` | PASS |
| Restore rehearsal | Контрольная session row и PNG сначала доказанно отсутствовали; DB dump и uploads затем реально восстановлены. Session row и исходный SHA файла вернулись; `CHECK TABLE` проверил 40 таблиц, corruption `false` | PASS |
| Restart | После Plesk restart повторно прошли health, authenticated bootstrap, public upload SHA и полный SSE heartbeat | PASS |
| Same-release redeploy | Чистый Git archive `5d6e90b`: offline frozen install с pnpm 11.9.0, production build, migrations 37 → 37 no-op, unresolved attempts 0, restart, health/root/fresh assets/bootstrap/upload/SSE | PASS |
| Rollback | Чистый Git archive `a71e12b`: frozen install/build, migration compatibility 37/37 и unresolved 0, restart, health/root/bootstrap/upload/SSE; затем выполнен roll-forward обратно на `5d6e90b` с теми же gates | PASS |
| Application/Plesk logs | Полное добавившееся окно с `2026-08-28T10:34:39.114Z`: HTTP 5xx 0; application/proxy error signals 0; DB/auth/upload/SSE/integration/unhandled по 0 | PASS |
| Cleanup | Контрольная session row и PNG удалены; временный Basic Auth user `codex_staging_gate`, release archives и helper/runner-файлы удалены. Основной staging Basic Auth сохранён и unauthenticated access остаётся `401`; snapshot, `manifest.json` и `evidence.json` сохранены | PASS |

Явные остаточные риски не блокируют staging: отсутствие внешнего `X-Accel-Buffering` header компенсировано измеренным first-chunk/heartbeat/reconnect поведением; SMTP доказан до acceptance транспортом, не до ручного прочтения; Plesk не предоставляет изолированную staging-only backup policy, поэтому проверенная процедура backup/restore остаётся ручной. Перед production deployment всё равно требуется отдельное явное разрешение и production-scoped backup/change window.

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
