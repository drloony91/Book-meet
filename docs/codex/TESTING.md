# Testing and definition of done

## Canonical checks

```bash
pnpm run setup
pnpm verify
git diff --check
```

`packageManager` pins pnpm 11.9.0 and CI installs that exact version before `pnpm run setup`; the repository intentionally has no `.node-version`. CI uses Node 22.13.0 while `engines.node` accepts Node 22.13.0 or newer. Record the exact Node/pnpm versions for every staging or release run instead of assuming the local shell matches CI. `pnpm run setup` installs the locked dependency graph. `pnpm run check` runs the type-check, safe static architecture and migration checks, and generated-doc freshness. `pnpm verify` runs `pnpm run check && pnpm test`; `pnpm test` first runs `vite build`, then the Node test inventory from `package.json`, including security, architecture, bootstrap, compliance, desktop/mobile contracts, search, spreadsheet lazy loading and `tests/codex-docs-contract.test.mjs`.

The architecture check rejects global `fetch(` in active browser source outside `app/services/api.ts`; JSON boundary tests cover record/array validation without network access.

Generated route/schema maps are refreshed with `pnpm docs:generate`; `pnpm docs:check` fails on drift and is included in `pnpm check`. Dependency audit remains a separate network-aware command:

```bash
pnpm audit --audit-level high
```

Useful focused checks:

```bash
pnpm lint
node scripts/check-architecture.mjs
node scripts/check-migrations.mjs
pnpm docs:check
node --test tests/codex-docs-contract.test.mjs
pnpm build
```

## Disposable MySQL integration workflow

Docker Desktop with Docker Compose v2 is a required external prerequisite. The repository pins Docker Official Image `mysql:8.4.11` in `compose.mysql-test.yml`; it exposes only the local test database `book_meet_test` at `127.0.0.1:3307` with test-only credentials.

```bash
pnpm db:test:up
pnpm db:test
pnpm db:test:down
pnpm verify:db
pnpm db:migrate:status
pnpm db:migrate:retry -- <exact-migration-name.sql> --confirm-schema-reviewed
```

`pnpm db:test` requires the dedicated container already running and rejects any environment other than `NODE_ENV=test`, `MYSQL_INTEGRATION_TEST=1`, local host `127.0.0.1`, exact database `book_meet_test`, and exact test user. `pnpm verify:db` removes only the named volume within the dedicated Compose project, starts it with health waiting, runs the suite using its fixed test environment, and removes it in `finally`, including after a failed test. It proves real migration application and second-run no-op behavior, final schema/ledger, seed idempotency and production seed guards, DML rollback, foreign keys, representative `CASCADE`/`SET NULL`, and the A-01 partial-DDL fixture.

`pnpm db:migrate:status` only reports unresolved attempt markers against the canonical ledger. If it reports one, inspect the actual schema first. `pnpm db:migrate:retry -- <exact-migration-name.sql> --confirm-schema-reviewed` then clears only that exact marker after checking that the migration is a selected file and absent from `schema_migrations`; it never drops, alters or otherwise reconciles schema automatically. It explicitly leaves actual schema and the canonical ledger unchanged.

`pnpm verify` intentionally remains Docker-free. A-01 was reproduced on an isolated real MariaDB 10.6.27 database: the first DDL persisted, the next DDL failed, no canonical ledger row was written, and the unguarded retry hit the existing table. On 2026-08-24 the updated runner and its explicit recovery workflow passed `pnpm verify:db` on disposable MySQL 8.4.11: the first DDL remained after the forced failure, the failed marker blocked blind rerun, status exposed the exact statement/error, an unconfirmed retry was refused, and a confirmed marker clear after manual schema reconciliation allowed the migration to finish. A-01 is closed by this fail-closed operational recovery path; this does not claim transactional MySQL DDL rollback. Run `pnpm verify:db` before a release that changes schema/migrations, seed behavior, database transaction code, or relational constraints.

The last command is a direct Vite build; the `pnpm test` build is already part of the canonical suite. Use the exact package script for the full suite rather than relying on a hand-maintained subset.

## Browser regression (demo)

The permanent Playwright suite runs the built frontend against an isolated local `DEMO_MODE=1` server on port `4173`. The web server is rebuilt and started for the run, each test resets the process-local demo fixtures through the demo-only `/api/__test__/reset` hook, and the desktop (`1440x900`) and touch mobile (`390x844`) projects use the same logical scenarios. Playwright screenshots and traces are retained only for failures; `playwright-report/` and `test-results/` are ignored.

Install the Chromium browser once on a machine that will execute the suite, then use the canonical command or the focused project/upload commands:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:desktop
pnpm test:e2e:mobile
pnpm test:e2e:upload
```

Use these gates after the corresponding changes:

| Change | Required browser command after the normal focused checks |
| --- | --- |
| Backend-only with no browser/API contract change | No browser run; use the relevant Node/security checks and `pnpm lint` |
| Frontend, route, auth, feed, social, chat or desktop interaction | `pnpm build` and `pnpm test:e2e:desktop` |
| Mobile layout, header/menu/search/touch behavior | `pnpm build` and `pnpm test:e2e:mobile` |
| Avatar/file or shared upload flow | `pnpm build` and `pnpm test:e2e:upload`; run full `pnpm test:e2e` when shared upload code or routes changed |
| Release or cross-cutting client/API change | `pnpm test:e2e` after `pnpm check` and `pnpm test` |

The fixture fails on page errors, console errors and non-React unexpected warnings, failed requests, broken local assets, and unexpected HTTP 4xx/5xx responses. The demo realtime endpoint is a valid SSE connection; it is not globally ignored. Chromium's generic negative-response console message is tolerated only when its observed status and source path match an explicit allowance in the current test; other negative responses must be allowed by the individual test. This suite checks deterministic in-memory demo behavior and does not replace real-DB, production-auth, multi-process, email, storage, or Plesk checks.

## Reading state (queue 2)

- `tests/reading-state.test.mjs` exercises conditional server validation, progress calculations, active-unit semantics and timezone-aware postponed periods.
- `tests/reading-client.test.mjs` exercises deterministic reader ordering, unknown versus zero progress, and paused viewers with or without completed history.
- `tests/reading-demo-http.test.mjs` runs the demo router over HTTP and checks five statuses, authoritative mutation DTOs, canonical-ID consistency, history retention, notification deduplication and private-field isolation.
- `tests/reading-http-mysql.mjs` is launched only by the guarded disposable-MySQL integration suite. It runs the production API with real cookie sessions and relational data: transitions, partial updates, explicit nulls, rereads, Top-3, aggregate ratings, notification concurrency/timezones, owner/friend/stranger/blocked/minor matrix, deliberate transaction failures and account-finalization cleanup. It must never be pointed at staging or production.
- `tests/mysql-integration.test.mjs` also applies migration 039 to populated pre-039 libraries, preserving zero chapters and unknown completion dates, excluding organization books, and proving the second migration pass is a no-op.

Before release, run the complete canonical Node, disposable-MySQL and desktop/mobile browser suites; a passing demo adapter alone is not evidence of production transaction behavior.

## Reading goals (queue 3, stage 1)

- `tests/reading-goals.test.mjs` covers timezone boundaries, leap days, inclusive remaining days, annual integer allocation and backlog, saved January/February starts, strict input and chart color thresholds.
- `tests/browser/reading-goals.spec.ts` checks desktop/mobile creation, invalid drafts, delayed GET races, independent row edits/deletion, monthly/annual chart periods and plans, both mobile close controls, exact background query, refresh and re-authentication. It captures annual chart screenshots for visual review. The desktop-only skip is the mobile workflow test.
- `tests/reading-goals-http-mysql.mjs`, launched by the guarded disposable MySQL suite, exercises production cookie-authenticated routes, owner-only CRUD and statistics, concurrent annual uniqueness, completed cycles without library membership, SQL checks, rollback and both hard-delete and account-finalization cleanup.
- `tests/helpers/queue3-http.mjs` rejects all environments except the fixed disposable database and disables external deliveries before importing the production router. It is shared test infrastructure, not a staging/production runner.
- The goal period is fixed after creation; `PATCH` changes the positive integer target. The saved annual start is January or February. Past slots are reconstructed from completion totals preceding each historical month; current/future slots distribute the remaining target once from the current month. There is no scheduled plan mutation.

## Change-type checklist

| Change | Minimum evidence |
| --- | --- |
| Markdown/navigation/CI/package contract | targeted docs contract, `pnpm lint`, `pnpm test`, `git diff --check`; verify links and canonical command text |
| Client behavior/routing/CSS | focused contract or regression test, `pnpm lint`, `pnpm test`, `pnpm build`, browser smoke at affected desktop/mobile breakpoints |
| API/auth/privacy/moderation | focused security/architecture/compliance test, full `pnpm test`, type-check/build, inspect server authorization and transaction boundaries |
| SQL/migration/data ownership | migration contract plus real MySQL apply on a disposable/prepared database; inspect nullable/FK/cascade and rollback/retry implications |
| External integration/deployment | local contracts plus configured staging/production smoke: `/api/health`, assets, direct SPA paths, login/logout and logs; never put secrets in tests/docs |

## Staging smoke contract

The permanent staging target is `https://staging.bookmeet.club`, isolated from `https://bookmeet.club`. A staging run must use Node `22.13.0` (or a recorded version satisfying `engines.node`), `pnpm@11.9.0`, `pnpm install --frozen-lockfile`, a clean staging MariaDB database/user, and `../book-meet-staging-uploads`. Apply the complete migration chain, run `pnpm db:migrate:status`, repeat `pnpm db:migrate` and status to prove a no-op, then seed only the explicitly configured staging admin.

With Basic Auth or an equivalent access restriction in place, check staging HTTPS, `/api/health`, `/`, `/books`, a direct SPA route, fresh assets, login/logout, upload persistence and application/Plesk logs. At the Plesk/nginx boundary verify HSTS, CSP, `X-Content-Type-Options: nosniff`, framing protection and `X-Robots-Tag: noindex, nofollow, noarchive`. Google, SMTP and Telegram remain disabled until a separate explicit safety decision; no staging smoke may send to ordinary users. The runbook is a procedure, not evidence that staging currently exists or has passed.

The guarded live regression runner is:

```bash
STAGING_SMOKE=1 corepack pnpm run staging:smoke
# after the Plesk/Passenger restart
STAGING_SMOKE=1 corepack pnpm run staging:smoke -- --verify-upload-marker
# only after explicit approval to remove the test artifact
STAGING_SMOKE=1 corepack pnpm run staging:smoke -- --verify-upload-marker --cleanup-upload-marker
```

It fails closed unless `NODE_ENV=production`, `APP_ORIGIN` targets `staging.bookmeet.club`, and both DB name and upload path are visibly staging-scoped. It also refuses enabled Telegram alerts, configured Google OAuth or a complete SMTP configuration. The main mode uses the isolated staging DB, creates short-lived sessions for the five fixture profile types, exercises profile/URL regressions through a loopback server, removes those sessions in `finally`, and writes a deterministic upload marker. Verification is read-only by default; only the separately approved `--cleanup-upload-marker` flag removes that exact marker.

## Explicit gaps

- `pnpm verify` does **not** provision or connect to a disposable real MySQL/MariaDB instance. `server/demo-api.js` is an in-memory adapter and cannot prove SQL schema, transaction atomicity, DDL migration recovery, indexes or production seed behavior. `pnpm verify:db` covers these only when Docker Desktop/Compose is actually available and succeeds.
- The Playwright browser suite is intentionally separate from `pnpm test` and `pnpm verify` because it requires an installed browser and a longer build/server run. Static mobile/desktop contracts do not replace browser QA; use the browser gates above for navigation, responsive CSS, chat, modal and upload changes.
- Production checks are not run by CI. Before a Plesk release, separately verify `/api/health`, fresh JS/CSS, direct routes, HTTPS, migration/seed and relevant authenticated behavior. Staging checks must be completed against its isolated domain, database, uploads and credentials before any production decision.
- `pnpm audit --audit-level high` is a separate dependency check; it is not silently folded into `pnpm verify`.

## Demo smoke (optional)

With safe local settings, `pnpm demo` can prove process startup, `/api/health`, root and a direct SPA route. Demo memory state is not a substitute for MySQL or two-account privacy/chat verification.

## Definition of done for future Codex tasks

- Start from `AGENTS.md` and `INDEX.md`; use active paths and reference implementations from `CONVENTIONS.md`.
- Use a Node version accepted by `engines.node` (CI baseline `22.13.0`), exact `pnpm@11.9.0` and the frozen lockfile; update `.env.example` only with safe non-secret values.
- Run `pnpm check` while iterating and `pnpm verify` before handoff; run dependency audit and `git diff --check` explicitly.
- Keep browser HTTP behind `apiFetch`, client/server imports within enforced boundaries, migrations append-only/contiguous, and generated maps fresh.
- Add or update explicit types/runtime validation at any changed untrusted data boundary; preserve server authorization and frontend/backend response expectations.
- Update the canonical Codex document when routes, schema, architecture, ownership, integrations, dependencies or reference implementations change.
- Remove a competing implementation/source of truth only when equivalence is proven; preserve intentional business-specific representations.
- Add a focused regression for a repaired high-impact path; use the change-type matrix above for browser, DB and production evidence.
- Do not claim MySQL, mobile browser or production validation unless the corresponding external check actually ran.

## Progress notes (queue 3, stage 2)

`tests/book-progress-notes.test.mjs` covers strict bodies, snapshot preconditions, cursor validation and demo HTTP visibility. `tests/book-progress-notes-http-mysql.mjs` runs through the guarded disposable suite: owner/progress/read/want/absent/unknown/authored relation/block/hide/minor matrix, no closed body in API responses, immutable snapshots, ownership and reporting, SQL/FK/cycle deletion and account cleanup. Unknown progress includes a known current value with NULL total and a NULL active unit.

`tests/browser/book-progress-notes.spec.ts` exercises desktop/mobile confirmation, cancellation, thoughts preservation, autosave followed by unchanged note snapshots, text edits/deletion and the 40%/41% response gate. It captures inline-card screenshots for visual inspection.

## Book shelves (queue 3, stage 3)

- `tests/book-shelves.test.mjs` covers strict Unicode payload limits, unique ordered items and cursor validation.
- `tests/book-shelves-http-mysql.mjs`, launched only by the guarded disposable suite, covers authenticated CRUD, owner-library enforcement, transactional reorder, concurrent idempotent batch addition, status preservation, 18+ filtering, block/hide behavior, all material actions, report moderation and relation cleanup without deleting canonical books.
- `tests/browser/book-shelves.spec.ts` covers desktop/mobile owner creation, reorder/edit, public library mode, like/comment/save/share/report, batch addition, direct-route reauthentication and exact return to `mode=shelves`. It captures owner and foreign detail screenshots for visual inspection.
