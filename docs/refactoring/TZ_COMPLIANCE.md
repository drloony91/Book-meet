# Book Meet: соответствие исходному ТЗ 1–61

Дата сверки: **2026-08-24**
Базовый commit: **`05b811f`**; проверяется текущий незакоммиченный worktree.
Источник требований: исходное пользовательское ТЗ, а не только `REFACTOR_PLAN.md`.

## Метод и статусы

Сверка выполнена без повторного общего аудита: `AGENTS.md` → `docs/codex/INDEX.md` → канонические документы, `REFACTOR_AUDIT.md`, `REFACTOR_PLAN.md`, `REFACTOR_REPORT.md`, текущий diff и только точечные entry points/tooling checks. Колонка **До закрытия** сохраняет состояние на момент первой сверки; **Итог** обновляется после безопасного implementation pass.

- **DONE** — реализовано и проверено.
- **DONE / NOT APPLICABLE** — проверено; дополнительная реализация не нужна.
- **PARTIAL** — выполнена только часть.
- **DEFERRED** — сознательно отложено из-за риска или отсутствующей среды.
- **NOT DONE** — требование ещё не реализовано.

## Матрица 1–61

| № | Требование | До закрытия | Итог | Доказательство / точный остаток |
|---:|---|---|---|---|
| 1 | Исходный код — источник истины | DONE | DONE | Audit опирается на active tracked paths, routes, dynamic imports, runtime/config/migrations и фактические consumers. |
| 2 | Консервативность и сохранение поведения | DONE | DONE | Не менялись schema/API/URL/roles/privacy/UI contracts; рискованные центры вынесены в долг. |
| 3 | Baseline до изменений | DONE | DONE | `REFACTOR_AUDIT.md`: clean tracked baseline, Node/pnpm, lint/build, 105 tests, demo smoke и отсутствие disposable MySQL. |
| 4 | Системный аудит dead code | DONE | DONE | Удалены только доказанные exports/functions и 7 assets; dynamic/hidden usage проверено contracts/search. |
| 5 | Дублирование | PARTIAL | DONE | Подтверждённые дубли закрыты: XLSX parsing использует общий lazy helper, все browser HTTP flows — `apiFetch`; бизнес-различающиеся row/DTO/form mappings не объединялись. Structural check запрещает возврат параллельного HTTP entry. |
| 6 | Слишком сложные участки | DEFERRED | DEFERRED | **Осталось:** `server/api.js`, `useBookMeetController.tsx`, `ContentComponents.tsx`, layered CSS. **Почему:** широкое дробление несёт routing/privacy/mobile regression risk. **Сейчас:** нет, только отдельными feature extraction задачами. **Проверка:** full contracts, desktop/mobile browser matrix, API/privacy regressions. |
| 7 | Производительность | PARTIAL | PARTIAL | **Осталось:** residual material-stats batching, broad bootstrap/search reads, SSE writes, main chunk >500 kB. **Почему:** нужны метрики и privacy/load acceptance. **Сейчас:** только локальные измеримые optimizations; широкие изменения небезопасны. **Проверка:** query/payload/load measurements, permission tests, browser/build bundle comparison. |
| 8 | Надёжность | PARTIAL | PARTIAL | **Осталось:** MySQL DDL partial-apply recovery и SSE ownership. **Почему:** нет disposable MySQL/load stand; semantics рискованны. **Сейчас:** документирование/static workflow checks безопасны, runtime redesign — нет. **Проверка:** real-DB failure/retry и reconnect/load tests. |
| 9 | Доступ и безопасность | DONE | DONE | Server permissions/input/content/secret/env boundaries проверены; seed guards и vulnerable dependencies исправлены; security contracts проходят. |
| 10 | Dependencies | DONE | DONE | Direct imports подтверждены; массовых updates/deletions нет; Nodemailer/nanoid обновлены точечно; audit чистый. |
| 11 | `REFACTOR_AUDIT.md` до крупных изменений | DONE | DONE | Findings A-01…A-14 содержат category/location/reason/solution/risk/priority. |
| 12 | Поэтапный план | DONE | DONE | `REFACTOR_PLAN.md`; блоки выполнялись последовательно, один subagent за раз. |
| 13 | Выполнить подтверждённый рефакторинг | DONE | DONE | Blocks 1–4c реализованы с targeted/full checks. |
| 14 | Не маскировать проблемы | DONE | DONE | Tests/lint/validation не отключались, `any` не добавлялся, failures не подавлялись. |
| 15 | Финальная техническая проверка | PARTIAL | PARTIAL | **Осталось:** real MySQL, production/Plesk, полноценный mobile/upload browser pass. **Почему:** внешние среды/доступ отсутствуют. **Сейчас:** нет; demo/desktop/local checks доступны. **Проверка:** disposable DB migration/seed, production health/assets/routes, mobile/upload console/server-log matrix. |
| 16 | Codex-документация как навигатор | DONE | DONE | Компактный `docs/codex/*` создан и cold-start проверен. |
| 17 | Минимальная структура документации | DONE | DONE | Все 11 требуемых документов и `AGENTS.md` присутствуют. |
| 18 | Короткий `AGENTS.md` и алгоритм | DONE | DONE | Сохраняет обязательные project/orchestration guardrails, INDEX-first алгоритм, commands и maintenance rule. |
| 19 | `INDEX.md` как маршрутизатор | DONE | DONE | Task → 1–3 docs → core entry points, active paths и cold start. |
| 20 | `PROJECT_OVERVIEW.md` | DONE | DONE | Product, stack, runtime, roles, storage, deployment boundary. |
| 21 | `ARCHITECTURE.md` | DONE | DONE | Фактический graph, ownership, startup, navigation, access, data and exceptions. |
| 22 | `FEATURE_MAP.md` | DONE | DONE | 11 крупных feature chains frontend → API → data → permissions → tests. |
| 23 | `DATA_MODEL.md` | DONE | DONE | Main entities, relations, nullable/cascade/ownership and migration pointers. |
| 24 | `ROUTES_AND_API.md` | DONE | DONE | Frontend/backend groups, auth and handler/data navigation без построчного копирования API. |
| 25 | `CODE_MAP.md` | DONE | DONE | Active-path allowlist, responsibilities, entry points and high-coupling centers. |
| 26 | `INTEGRATIONS.md` | DONE | DONE | Реальные integrations, code paths, env names without values, fallback/deployment boundaries. |
| 27 | `CONVENTIONS.md` | DONE | DONE | Фактические scope, privacy, API/data, localization, migration/release guardrails. |
| 28 | `TESTING.md` | DONE | DONE | Commands, suites, change-type checklist, gaps and demo smoke. |
| 29 | `KNOWN_TECH_DEBT.md` | DONE | DONE | Unresolved items link to detailed audit reason/risk/next bounded step. |
| 30 | Точные пути | DONE | DONE | INDEX/maps use real source paths and symbols. |
| 31 | Не дублировать документацию | DONE | DONE | Canonical ownership split; compatibility/historical docs point to current sources. |
| 32 | Актуальность snapshot | PARTIAL | DONE | INDEX/tech-debt metadata обновлены до текущего compliance worktree; generated maps проверяются автоматически. |
| 33 | Cold-start проверка | DONE | DONE | 5/5 auth/profile/material/chat/events, 0 broken local links. |
| 34 | Локальные `AGENTS.md` | DONE / NOT APPLICABLE | DONE / NOT APPLICABLE | Автономных частей с отдельными правилами недостаточно; дополнительные файлы увеличили бы контекст. |
| 35 | Контекстная компактность docs | DONE | DONE | Короткие tables/lists/cross-links, без больших code copies. |
| 36 | Финальный отчёт | DONE | DONE | `REFACTOR_REPORT.md` содержит required before/after, changes, deletions, optimization, gaps and checks. |
| 37 | Финальный ответ пользователю | DONE | DONE | Был дан краткий outcome, checks, remaining risks and key document links. |
| 38 | Definition of Done исходного этапа | PARTIAL | PARTIAL | Safe local requirements 39–61 закрыты и доказаны этой матрицей. **Осталось:** real DB/mobile/production gates и high-risk performance/refactor debt. **Почему:** отсутствует внешняя среда или требуется отдельная acceptance matrix. **Сейчас:** нет. **Проверка:** deferred checks из пунктов 6–8/15/42/55. |
| 39 | Постоянная эффективность Codex | DONE | DONE | Repository-level AGENTS/index/maps/tests являются постоянным lightweight navigation contract. |
| 40 | Одна полная verify-команда | PARTIAL | DONE | `pnpm verify` fail-fast выполняет `check` (types, architecture, migrations, generated freshness), затем build и полный test inventory. Network audit и Git whitespace check остаются явно отдельными по средовым причинам. |
| 41 | Быстрая и полная проверки | DONE / NOT APPLICABLE | DONE / NOT APPLICABLE | Полный verify занимает секунды; отдельный tier исходным ТЗ не требуется при быстром full suite. |
| 42 | Воспроизводимая dev-среда | PARTIAL | PARTIAL | Локальная часть закрыта: safe development `.env.example`, `pnpm run setup`, отдельный no-DB demo quick start и clean-copy verification. **Осталось:** full MySQL bootstrap. **Почему:** disposable MySQL отсутствует. **Сейчас:** нет без внешней БД. **Проверка:** clean DB, migrations, seed, login and transaction/privacy smoke. |
| 43 | Версии основных инструментов | PARTIAL | DONE | `.node-version` и CI фиксируют Node `22.13.0`; `packageManager`/CI фиксируют pnpm `11.9.0`; build tools exact в lock/package. |
| 44 | Предсказуемая структура | PARTIAL | DONE / NOT APPLICABLE | Active paths/ownership/high-coupling exceptions mapped; generated maps and layer checks make locations predictable. Mass moves and deletion of user archives are objectively unnecessary/risky and therefore not required. |
| 45 | Уменьшить архитектурные исключения | PARTIAL | DONE | Все active browser requests используют существующий `apiFetch`; permissions/validation/navigation references зафиксированы. Различающиеся business DTO/forms сохранены намеренно. |
| 46 | Эталонные реализации | NOT DONE | DONE | `CONVENTIONS.md` теперь даёт точные active paths для HTTP, authenticated handler, permissions, JSON validation, form, transaction, routing/modal, localization и regression test; paths guarded docs contract. |
| 47 | Строгие boundary types/runtime validation | PARTIAL | PARTIAL | Явный `any` и untyped Google global устранены; bootstrap/public catalog top-level/collections валидируются как unknown JSON. **Осталось:** многие endpoint-specific field casts и JS DB rows. **Почему:** массовая schema migration рискованна. **Сейчас:** только по изменяемым endpoint families. **Проверка:** typecheck, invalid-shape and frontend/backend contracts. |
| 48 | Frontend/backend API contracts | PARTIAL | PARTIAL | Exact endpoint inventory/auth navigation и critical client DTO/error guards есть. **Осталось:** единый machine-readable request/response/error schema registry для всего Express API. **Почему:** JS backend и большой API; новый framework неоправдан. **Сейчас:** безопасно только family-by-family. **Проверка:** targeted contract/security tests plus full suite. |
| 49 | Generated technical docs | NOT DONE | DONE | `pnpm docs:generate` создаёт deterministic exact production API, frontend route constants и migration/schema inventories в `docs/codex/generated/`. |
| 50 | Generated ≠ manual duplication | NOT DONE | DONE | Manual docs сохраняют purpose/auth/ownership/semantics; generated files содержат только exact extractable structure и связаны cross-links. |
| 51 | Freshness check generated docs | NOT DONE | DONE | `pnpm docs:check` сравнивает in-memory output с checked-in files, входит в `check`/`verify`; intentional drift failure проверен. |
| 52 | Machine-checkable architecture rules | PARTIAL | DONE | Offline check запрещает client server/DB/Node imports, server UI imports и global browser fetch outside `apiFetch`; migration/generated invariants также machine-enforced. |
| 53 | Forbidden imports/layers | NOT DONE | DONE | `scripts/check-architecture.mjs` проверяет static/dynamic imports для реальных client/server boundaries и включён в canonical verify. |
| 54 | Critical smoke/regression coverage | DONE | DONE | Build + 120 Node security/architecture/bootstrap/compliance/desktop/mobile/material/docs contracts; clean-copy demo health/root/direct-route smoke проходит. |
| 55 | Schema/migrations workflow | PARTIAL | PARTIAL | Static filename/contiguous/order/nonempty/terminal-semicolon check и generated inventory добавлены. **Осталось:** real-DB apply, DDL partial failure/retry and schema semantic drift. **Почему:** disposable MySQL отсутствует. **Сейчас:** нет. **Проверка:** clean MySQL apply plus injected failure/retry and schema inspection. |
| 56 | Неоднозначные источники истины | PARTIAL | DONE / NOT APPLICABLE | HTTP entry унифицирован; exact routes/schema генерируются из source; migration history/domain types remain canonical. Разные server/client/material DTO сохраняются там, где они отражают реальные viewer/business representations. |
| 57 | Устаревшие инструкции | DONE | DONE | Active README/Plesk/env synchronized; architecture pointer and security snapshot explicitly marked; user release archives excluded from source. |
| 58 | Шумовые/устаревшие комментарии | DONE / NOT APPLICABLE | DONE / NOT APPLICABLE | Targeted active-path scan found no commented-out implementation/deprecated TODO; remaining comments explain non-obvious business/temporary-account semantics. |
| 59 | Качество навигации | DONE | DONE | 5 subsystem cold starts and link validation; INDEX → feature → entry/API/data/tests works without global search. |
| 60 | Не создавать AI-инфраструктуру | DONE / NOT APPLICABLE | DONE / NOT APPLICABLE | No RAG/vector DB/MCP/memory infrastructure added. |
| 61 | Расширенный Definition of Done | PARTIAL | PARTIAL | `TESTING.md` теперь закрепляет pinning, clean setup, references, generated freshness, layer/migration/HTTP rules, types, docs and regressions. **Осталось:** критерии, доказуемые только real MySQL/mobile/production, и полный API schema registry. **Почему:** внешняя среда/несоразмерный риск. **Сейчас:** нет. **Проверка:** соответствующие deferred gates; local DoD проверяется `check`/`verify`. |

## Итог сверки

- **DONE — 45**, **DONE / NOT APPLICABLE — 6**, **PARTIAL — 9**, **DEFERRED — 1**, **NOT DONE — 0**.
- Все 61 номера присутствуют ровно один раз; итоговые статусы получены после safe implementation pass, а исходные статусы сохранены в колонке **До закрытия**.
- Clean-copy из active source без `node_modules`, `dist`, release/staging/archive artifacts: frozen install PASS, `check` PASS, production build PASS, **120/120 tests PASS**.
- Clean-copy demo smoke: `GET /api/health`, `/`, `/books` — HTTP 200; root container присутствует на обоих SPA routes.
- Intentional negative checks: generated-doc drift и запрещённый client → server import дают non-zero exit; временные probes после проверки удалены.
- Реальная MySQL/MariaDB, production/Plesk и полноценная mobile/upload browser matrix не запускались и не представлены как завершённые.

## Безопасные блоки текущего закрытия

1. Воспроизводимый local/demo bootstrap и standard Node version file.
2. Canonical client HTTP entry + узкая проверка architectural boundaries.
3. Deterministic generated route/schema maps + freshness check в `pnpm verify`.
4. Static migration workflow check без изменения SQL history.
5. Reference implementations, expanded Definition of Done и актуализация metadata/cross-links.
6. Точечное удаление явного `any` и минимальная runtime-проверка critical JSON boundaries; без массовой contract/schema миграции.

## Не закрывать формально

- Реальная MySQL/MariaDB: migration apply, DDL partial failure/retry, transactions и production seed.
- Production/Plesk и production data.
- Полноценная mobile browser/upload matrix.
- Broad pagination/SSE/controller/server/CSS redesign без metrics и acceptance stand.
