# Testing and definition of done

## Canonical checks

```bash
pnpm run setup
pnpm verify
git diff --check
```

`pnpm run setup` installs the locked dependency graph with pnpm 11.9.0. `pnpm run check` runs the type-check, safe static architecture and migration checks, and generated-doc freshness. `pnpm verify` runs `pnpm run check && pnpm test`; `pnpm test` first runs `vite build`, then the Node test inventory from `package.json`, including security, architecture, bootstrap, compliance, desktop/mobile contracts, search, spreadsheet lazy loading and `tests/codex-docs-contract.test.mjs`.

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

The last command is a direct Vite build; the `pnpm test` build is already part of the canonical suite. Use the exact package script for the full suite rather than relying on a hand-maintained subset.

## Change-type checklist

| Change | Minimum evidence |
| --- | --- |
| Markdown/navigation/CI/package contract | targeted docs contract, `pnpm lint`, `pnpm test`, `git diff --check`; verify links and canonical command text |
| Client behavior/routing/CSS | focused contract or regression test, `pnpm lint`, `pnpm test`, `pnpm build`, browser smoke at affected desktop/mobile breakpoints |
| API/auth/privacy/moderation | focused security/architecture/compliance test, full `pnpm test`, type-check/build, inspect server authorization and transaction boundaries |
| SQL/migration/data ownership | migration contract plus real MySQL apply on a disposable/prepared database; inspect nullable/FK/cascade and rollback/retry implications |
| External integration/deployment | local contracts plus configured staging/production smoke: `/api/health`, assets, direct SPA paths, integration-specific action; never put secrets in tests/docs |

## Explicit gaps

- The automated suite does **not** provision or connect to a disposable real MySQL/MariaDB instance. `server/demo-api.js` is an in-memory adapter and cannot prove SQL schema, transaction atomicity, DDL migration recovery, indexes or production seed behavior.
- No automated browser visual/interaction suite is part of `pnpm test`; static mobile/desktop contracts do not replace browser QA. Navigation, responsive CSS, chat and modal changes need manual/browser checks.
- Production checks are not run by CI. Before a Plesk release, separately verify `/api/health`, fresh JS/CSS, direct routes, HTTPS/legacy redirect, migration/seed and relevant authenticated behavior.
- `pnpm audit --audit-level high` is a separate dependency check; it is not silently folded into `pnpm verify`.

## Demo smoke (optional)

With safe local settings, `pnpm demo` can prove process startup, `/api/health`, root and a direct SPA route. Demo memory state is not a substitute for MySQL or two-account privacy/chat verification.

## Definition of done for future Codex tasks

- Start from `AGENTS.md` and `INDEX.md`; use active paths and reference implementations from `CONVENTIONS.md`.
- Use Node `22.13.0`, `pnpm@11.9.0` and the frozen lockfile; update `.env.example` only with safe non-secret values.
- Run `pnpm check` while iterating and `pnpm verify` before handoff; run dependency audit and `git diff --check` explicitly.
- Keep browser HTTP behind `apiFetch`, client/server imports within enforced boundaries, migrations append-only/contiguous, and generated maps fresh.
- Add or update explicit types/runtime validation at any changed untrusted data boundary; preserve server authorization and frontend/backend response expectations.
- Update the canonical Codex document when routes, schema, architecture, ownership, integrations, dependencies or reference implementations change.
- Remove a competing implementation/source of truth only when equivalence is proven; preserve intentional business-specific representations.
- Add a focused regression for a repaired high-impact path; use the change-type matrix above for browser, DB and production evidence.
- Do not claim MySQL, mobile browser or production validation unless the corresponding external check actually ran.
