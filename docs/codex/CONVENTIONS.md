# Conventions and guardrails

These conventions complement, and never replace, the full project instructions in [AGENTS.md](../../AGENTS.md).

## Ownership and scope

- Active source is `app/`, `src/`, `server/`, `mysql/`, `scripts/`, `tests/`; release/archive copies are not source of truth.
- Keep the single-process deployment boundary unless metrics justify extraction. Make a focused feature module/router before broad refactors.
- `useBookMeetController.tsx`, `server/api.js` and `globals.css` are known high-coupling centers. Preserve public contracts and perform browser QA for UI/routing changes.
- Do not edit application/server logic or applied migrations as part of documentation-only work. New schema work uses the next sequential migration and accounts for existing rows.

## Authorization and privacy

- Server authorization is mandatory; hiding a button or card is not permission. Re-check ownership, session, admin, block, friendship, community membership and age at the API/data boundary.
- Community membership, friendship, follow and linked profile are separate concepts. Membership must not grant friend-only privacy or chat access.
- Legal document lifecycle is separate from mandatory registration consent. Preserve `legal_documents`/`legal_acceptances` semantics and audit evidence.
- Use transactions for multi-row social, moderation, deletion and reminder transitions. Preserve nullability/cascade rules in [DATA_MODEL.md](./DATA_MODEL.md).

## Client/API/data style

- TypeScript client types live in `app/types/domain.ts`; do not assume similarly named book/material DTOs have identical fields.
- `apiFetch` is the normal browser HTTP entry; keep same-origin credentials and locale headers. Validate URL/HTML/image inputs in server modules before persistence or remote fetch.
- `server/data.js` owns DTO assembly and viewer-aware visibility. Keep generic polymorphic material IDs behind `readableMaterialInfo`/permission helpers.
- `app/navigation/routes.ts` owns History API state. Trace action → selected state → URL/history → overlay → close/back before adding listeners.
- Locale strings belong in `app/i18n/messages.ts` and server auth strings in `server/modules/i18n.js`; supported locales are `ru`, `kk`, `en`.

## Migrations, dependencies and release

- Migrations are append-only and sorted by `scripts/migrate.js`; never rewrite an applied file. DDL rollback is not reliable in MySQL, so partial-apply recovery is a documented tech debt.
- Use `pnpm` and the checked-in lockfile; `pnpm verify` is the canonical local check. Do not claim release readiness with unexplained failures or without relevant browser/production checks.
- Reproducibility uses `.node-version` (`22.13.0`), `packageManager` (`pnpm@11.9.0`) and `pnpm run setup` (`pnpm install --frozen-lockfile`). Keep generated route/schema inventories under `docs/codex/generated/` fresh with `pnpm docs:check`.
- `pnpm run check` enforces safe client/server static-import boundaries, the canonical browser HTTP entry, and append-only migration filename/terminal-semicolon invariants. It does not require a real database.
- Keep secrets out of Git and docs. Plesk production changes require explicit user scope; this documentation task does not deploy or touch production data.

## Reference implementations

Use these concrete active-path examples when adding a new flow:

- browser HTTP client: `app/services/api.ts` (`apiFetch`);
- authenticated server handler: `server/api.js` (`requireUser`, then the route handler);
- permission predicate: `server/modules/social-permissions.js` (`canMessagePair`) and `server/api.js` (`assertUsersCanInteract`);
- JSON boundary validation: `app/services/response-validation.mjs` (`requireJsonRecord`, `parsePublicCatalogData`);
- validated form: `app/screens/AuthScreens.tsx` (`LoginScreen`) or `app/components/content/ContentComponents.tsx` (`EventForm`);
- database transaction: `server/db.js` (`withTransaction`);
- routing/modal ownership: `app/navigation/routes.ts` and `app/components/content/ContentComponents.tsx` (`ReadingModal`/`UnifiedBookModal`);
- localization: `app/i18n/messages.ts` and `app/i18n/index.ts` (`useI18n`/`localizedApiError`);
- regression contract: `tests/architecture-security.test.mjs` (security/architecture) and `tests/response-validation.test.mjs` (JSON boundary).

New code should link to the closest reference above and preserve its boundary rather than introduce a parallel helper.
