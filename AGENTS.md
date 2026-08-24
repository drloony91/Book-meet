# Book Meet — Codex project instructions

## Project scope

Work on the current Book Meet web application in this workspace. Current source code is always the source of truth.

For a compact route from this file to the current project map, read [`docs/codex/INDEX.md`](docs/codex/INDEX.md). It is a navigation index, not a replacement for these guardrails.

## Mandatory new-task algorithm

For every new task, follow this order:

1. Read `AGENTS.md` → [`docs/codex/INDEX.md`](docs/codex/INDEX.md).
2. Identify the subsystem and select only the 1–3 relevant canonical docs.
3. Open the listed core entry points and symbols.
4. Expand `rg`/file inspection only when those docs and entry points do not answer the question.

Do not repeat a full repository analysis when the canonical docs are sufficient. If a task changes architecture, file ownership/location, API, data model, routes, integrations or dependencies, update the corresponding `docs/codex/*.md` in the same task.

Core commands: `pnpm run setup`, `pnpm dev`, `pnpm check`, `pnpm verify`, `pnpm db:migrate`, `pnpm docs:generate`, `pnpm docs:check`.

`pnpm check` is the fast offline gate (types, architectural boundaries, migration structure, generated-doc freshness). `pnpm verify` is the full local gate and additionally runs the production build and all tests. Dependency audit and `git diff --check` remain explicit final checks because the first requires network and the second requires a Git worktree.

Expected active areas: `app/`, `server/`, `mysql/`, `scripts/`, `tests/`.

Do not edit `docs/codex/generated/*` manually; update its source and run `pnpm docs:generate`.

Do not edit legacy/prototype/release/archive copies unless explicitly asked: `bot/`, `book-meet-site/`, `.release-*`, `release-*`, `deploy-*`, `.prod-*`, `book-meet-*.zip`, old database exports.

Do not deploy, modify Plesk/production settings, or touch production data unless explicitly requested.

## Primary thread

The primary Codex thread is the sole orchestrator, planner, and final reviewer. The user normally selects Sol High for the primary thread.

Do not spawn Sol subagents. Do not use subagents as a parallel team.

For coding tasks, delegate only the stage that benefits from a cheaper specialist, wait for it to finish, inspect its result, and only then decide the next stage.

## Hard orchestration rules

1. NEVER run more than one subagent at a time.
2. ALWAYS wait for the current subagent to finish before spawning another.
3. NEVER fan out the same task to multiple agents.
4. Subagents must not spawn their own subagents.
5. The primary thread owns the plan and every handoff.
6. Pass only what the next stage needs: task, acceptance criteria, relevant files/symbols, prior findings, constraints.
7. Do not make every task use every agent.
8. Reuse earlier stage findings instead of rediscovering the same code.
9. The primary thread performs the final review itself. Do not spawn a separate reviewer.
10. Keep the user's selected primary model unchanged.

## Project agents

### `scout` — Luna Medium, read-only
Use only when the relevant implementation or root cause is not already clear.
Skip it for obvious, narrowly located changes.
The primary thread must read its result and make the implementation brief.

### `luna_implementer` — Luna Extra High, write-capable
DEFAULT coding agent.
Use whenever the desired behavior and acceptance criteria can be stated precisely:
- local UI/state fixes;
- focused API changes;
- ordinary multi-file fixes/features;
- implementation after scout has clarified the path.

Do not use Terra merely because several files are involved.

### `terra_implementer` — Terra High, write-capable
ESCALATION agent, not default.
Use only when implementation itself requires substantial independent judgment, for example:
- shared navigation/state ownership must be redesigned;
- client + API + database contracts need coordinated redesign;
- auth, permissions, moderation, privacy, destructive deletion, or migrations require non-trivial decisions;
- a broad refactor changes ownership/boundaries;
- Luna reports that the supplied plan is insufficient for a safe implementation;
- a previous Luna attempt failed for a substantive reasoning/correctness reason.

If the primary thread can give a precise bounded plan, prefer Luna.

### `verifier` — Luna Medium
Use after non-trivial implementation for targeted checks.
Skip a separate verifier for tiny cosmetic/text/local-style edits when the implementer can validate them itself.

## Routing

### Tiny / obvious
`primary -> luna_implementer -> primary final review`

### Normal product fix or feature — DEFAULT
`primary -> scout (only if needed) -> primary plan -> luna_implementer -> verifier (if behavior-sensitive) -> primary final review`

### Complex implementation
`primary -> scout -> primary plan -> terra_implementer -> verifier -> primary final review`

### High-risk implementation
`primary -> scout -> primary detailed plan -> terra_implementer -> verifier -> primary full final review`

High-risk includes auth/session/TOTP, permissions/visibility, blocks/reports/moderation, chat privacy, schema migrations, destructive/cascade behavior, transactions, and broad shared navigation changes.

## Escalation / retries

If `luna_implementer` discovers unresolved architectural choices, it must stop broadening scope and return the uncertainty/evidence. The primary thread decides whether to sharpen the plan and retry Luna or escalate to Terra.

Do not automatically retry with Terra after every Luna issue.

If verification fails, the primary thread diagnoses the failure and sends a narrow correction to the same appropriate implementer. Re-verify only as needed. Avoid repeating full exploration unless new evidence invalidates it.

## Book Meet guardrails

### Navigation / modals
Historically routing is distributed across `routes.ts`, `useBookMeetController`, routed popup logic, modal components, chat, and notifications.
For navigation bugs, trace user action -> selected state -> URL/history -> modal -> close/Back. Avoid another independent history listener unless clearly necessary. Fix ownership/root cause, not only the visible popup symptom.

### Bootstrap / client state
The app historically combines bootstrap refresh, SSE signals, visibility refresh, and optimistic state. Check for stale overwrites and competing sources of truth.

### Content models
Books, reviews, publications, events, occasions, publisher news, and wishlist entries may have different server/client/card/modal representations. Do not assume similarly named types contain identical fields.

### Server / database
Preserve server-side authorization and transaction atomicity. For schema changes, add a new sequential migration and account for existing production rows; do not rewrite applied migrations.

### Security
UI hiding never replaces server authorization. Treat auth, visibility, blocking, moderation, privacy, and destructive data behavior as high-risk.

### External book sources
Flip, Marwin/Meloman, and Yandex Books integrations may depend on scraping. Treat remote markup as unstable and untrusted.

## Validation

For a normal non-trivial change, prefer:
1. focused reproduction/test;
2. `pnpm lint`;
3. relevant tests / `pnpm test` when appropriate;
4. `pnpm build` for frontend/build-affecting changes.

Do not claim a behavioral bug is fixed only because TypeScript compiles.

## Final response

The primary thread should report root cause/rationale, material files changed, checks/results, remaining risk, and migration/deployment action if any.

Do not report completion while known failures remain unexplained.
