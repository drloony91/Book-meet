# Known technical debt

Snapshot: **2026-08-24**, base commit `05b811f`, current worktree after blocks 1–4c and the TZ compliance pass. This is the canonical unresolved/deferred list; implementation decisions remain in [docs/refactoring/REFACTOR_AUDIT.md](../refactoring/REFACTOR_AUDIT.md) and [TZ_COMPLIANCE.md](../refactoring/TZ_COMPLIANCE.md).

## Unresolved or residual

| ID | Current state | Risk / next bounded step |
| --- | --- | --- |
| A-01 — migration DDL recovery | **Unresolved.** `scripts/migrate.js` wraps files in transactions, but MySQL implicit DDL commits can leave partial schema with no ledger row. | P1 reliability. Design preflight/recovery for new migrations and test against disposable MySQL; never rewrite applied migrations. |
| A-06 — `/api/material-stats` N+1 residual | **Partially fixed in block 4.** Request-local cache deduplicates repeated `readableMaterialInfo(kind,id)` checks; global batch permission query and payload/query scaling remain. | P2 privacy/performance. Measure first; only introduce batch/scoped queries with permission regression tests. |
| A-07 — SSE presence heartbeat | **Deferred.** Each SSE socket can still update `users` on heartbeat despite request-level `presenceTouches`; no per-user connection limit. | P2 performance/online semantics. Design user-level ownership/throttle and reconnect/load tests. |
| A-08 — bootstrap/search scale | **Deferred.** `loadUsers`/catalog and `/search/materials` still read broad data and filter in memory. | P2/P1 at scale. Introduce server-side pagination/scoped queries while preserving block, community, friendship and age visibility. |
| A-09 — large logic centers | **Deferred.** `server/api.js`, `ContentComponents.tsx`, `useBookMeetController.tsx` and layered `globals.css` remain high-coupling centers. | P2 maintainability. Extract one feature at a time with unchanged contracts and desktop/mobile browser QA. |
| Workspace clutter | **Intentional, unresolved navigation debt.** Many untracked release/deploy/staging directories, ZIPs, `dist`, `tmp` and dependency trees sit beside active source. | Do not delete without explicit scope. Use [CODE_MAP.md](./CODE_MAP.md) allowlist and scoped `rg`. |
| No disposable MySQL | **Current validation gap.** Automated tests use mocks/demo/static contracts and do not apply migrations to a throwaway real database. | Provision a disposable MySQL/MariaDB fixture before claiming migration/transaction/seed production confidence. |
| API contract completeness | **Partially explicit.** Critical client DTOs and bootstrap/public JSON top-level shapes are typed/validated, exact routes are generated, but the JavaScript Express backend has no single request/response schema registry for every endpoint. | Add shared contracts one critical endpoint family at a time only when changing it; avoid a broad OpenAPI/schema migration without product value and regression coverage. |

## Blocks 1–4c disposition

- **Block 1 fixed:** canonical `pnpm verify`, production-safe explicit `ADMIN_EMAIL`/`TEST1_PASSWORD` seed, README/Plesk/env drift corrected, associated contracts added.
- **Block 2 fixed:** only audited frontend dead exports and obsolete duplicate public assets removed; broad cleanup remains out of scope.
- **Block 3 fixed:** XLSX is loaded through shared lazy helper `app/services/spreadsheet.ts`; both consumers retain their distinct row mapping contracts.
- **Block 4 fixed locally:** `/api/material-stats` uses request-scoped readability cache. Full batch optimization remains A-06 residual above.
- **Block 4b fixed locally:** `scripts/seed-publisher.js` fails before DB/security module loading when `NODE_ENV=production`; the approved publisher fixture remains local-only and production-prohibited.
- **Block 4c fixed:** Nodemailer is pinned to patched `9.0.1`; the PostCSS nanoid dependency is overridden to patched `3.3.18`; the final high-level audit reports no known vulnerabilities.
- **TZ compliance tooling fixed:** pinned local toolchain, clean demo setup, generated route/schema inventories with drift detection, migration/import/HTTP boundary checks, canonical `apiFetch`, reference implementations and critical JSON shape guards.
- **Block 5 (this document set) records navigation and guardrails.** It does not change application behavior, migrations or production state.
