import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.join(root, "docs", "codex");

const requiredDocs = [
  ["INDEX.md", "# Book Meet Codex navigation"],
  ["PROJECT_OVERVIEW.md", "# Project overview"],
  ["ARCHITECTURE.md", "# Architecture"],
  ["FEATURE_MAP.md", "# Feature map"],
  ["DATA_MODEL.md", "# Data model"],
  ["ROUTES_AND_API.md", "# Routes and API"],
  ["CODE_MAP.md", "# Code map"],
  ["INTEGRATIONS.md", "# Integrations and deployment"],
  ["CONVENTIONS.md", "# Conventions and guardrails"],
  ["TESTING.md", "# Testing and definition of done"],
  ["KNOWN_TECH_DEBT.md", "# Known technical debt"],
];

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("Codex navigation contains all canonical documents and headings", async () => {
  for (const [name, heading] of requiredDocs) {
    const content = await readFile(path.join(docsRoot, name), "utf8");
    assert.match(content, new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `${name} heading`);
  }
});

test("Codex index carries snapshot metadata, task routes and active core paths", async () => {
  const index = await text("docs/codex/INDEX.md");
  assert.match(index, /2026-08-24/);
  assert.match(index, /05b811f/);
  assert.match(index, /worktree/i);
  for (const relativePath of [
    "app/navigation/routes.ts",
    "app/hooks/useBookMeetController.tsx",
    "server/index.js",
    "server/api.js",
    "server/data.js",
    "mysql/migrations/001_initial.sql",
    "tests/",
  ]) {
    await access(path.join(root, relativePath));
    assert.match(index, new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${relativePath} must be routed from INDEX`);
  }
  for (const heading of ["Auth/account", "Profile, privacy", "Feed/materials", "Books/library", "Events", "Chat", "Endpoint contract", "Schema", "External services", "New change"]) {
    assert.match(index, new RegExp(heading, "i"), `INDEX task route ${heading}`);
  }
});

test("AGENTS points to the Codex index without removing project instructions", async () => {
  const agents = await text("AGENTS.md");
  assert.match(agents, /docs\/codex\/INDEX\.md/);
  for (const phrase of ["Hard orchestration rules", "Do not deploy", "Server / database", "Security", "Validation"]) {
    assert.match(agents, new RegExp(phrase), `AGENTS guardrail ${phrase}`);
  }
  for (const marker of [
    "Mandatory new-task algorithm",
    "Read `AGENTS.md` →",
    "1–3 relevant canonical docs",
    "Expand `rg`/file inspection only when",
    "Do not repeat a full repository analysis",
    "pnpm dev",
    "pnpm build",
    "pnpm lint",
    "pnpm test",
    "pnpm verify",
    "pnpm db:migrate",
    "update the corresponding `docs/codex/*.md` in the same task",
  ]) {
    assert.match(agents, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `AGENTS algorithm/command marker ${marker}`);
  }
});

test("CI and package scripts use pnpm verify as the canonical check", async () => {
  const ci = await text(".github/workflows/ci.yml");
  const packageJson = JSON.parse(await text("package.json"));
  const nodeVersion = await text(".node-version");
  assert.match(ci, /run:\s*pnpm verify/);
  assert.match(ci, /node-version:\s*22\.13\.0/);
  assert.equal(nodeVersion.trim(), "22.13.0");
  assert.equal(packageJson.packageManager, "pnpm@11.9.0");
  assert.equal(packageJson.scripts.setup, "pnpm install --frozen-lockfile");
  assert.match(packageJson.scripts.check, /check-architecture\.mjs/);
  assert.match(packageJson.scripts.check, /check-migrations\.mjs/);
  assert.match(packageJson.scripts.check, /docs:check/);
  assert.equal(packageJson.scripts.verify, "pnpm run check && pnpm test");
  assert.equal(packageJson.scripts["docs:generate"], "node scripts/generate-codex-docs.mjs");
  assert.equal(packageJson.scripts["docs:check"], "node scripts/generate-codex-docs.mjs --check");
  assert.match(packageJson.scripts.test, /tests\/codex-docs-contract\.test\.mjs/);
  assert.match(packageJson.scripts.test, /tests\/response-validation\.test\.mjs/);
});

test("generated route and schema inventories are tracked and marked as generated", async () => {
  const index = await text("docs/codex/INDEX.md");
  for (const relativePath of [
    "docs/codex/generated/API_ROUTES.md",
    "docs/codex/generated/FRONTEND_ROUTES.md",
    "docs/codex/generated/SCHEMA.md",
  ]) {
    const generated = await text(relativePath);
    assert.match(generated, /^<!-- GENERATED FILE: do not edit directly\./);
    const indexPath = `./${relativePath.replace(/^docs\/codex\//, "")}`;
    assert.match(index, new RegExp(indexPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(await text("docs/codex/generated/API_ROUTES.md"), /`GET` \| `\/api\/health`/);
  assert.match(await text("docs/codex/generated/SCHEMA.md"), /`001_initial\.sql`/);
});

test("canonical docs cover required cross-cutting topics and core references", async () => {
  const featureMap = await text("docs/codex/FEATURE_MAP.md");
  for (const topic of ["Auth/account", "Profiles", "Feed/materials", "Books/catalog", "Events", "Occasions", "Social", "Chat", "Search", "Admin", "Localization"]) {
    assert.match(featureMap, new RegExp(topic, "i"), `feature topic ${topic}`);
  }
  const dataModel = await text("docs/codex/DATA_MODEL.md");
  for (const table of ["users", "profiles", "books", "user_books", "events", "occasions", "friendships", "messages", "notifications", "reports", "legal_documents"]) {
    assert.match(dataModel, new RegExp(`\\b${table}\\b`), `data table ${table}`);
  }
  const routes = await text("docs/codex/ROUTES_AND_API.md");
  for (const endpoint of ["/api/auth", "/api/bootstrap", "/api/books", "/api/events", "/api/social", "/api/realtime", "/api/admin"]) {
    assert.match(routes, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `API group ${endpoint}`);
  }
  assert.match(featureMap, /publishers.*canMessagePair/i);
  assert.match(routes, /\/reviews/);
  assert.match(routes, /app\/components\/notifications\/Notifications\.tsx/);
  const integrations = await text("docs/codex/INTEGRATIONS.md");
  for (const envName of ["LEGAL_CONSENT_REQUIRED", "DEMO_MODE", "ADMIN_EMAIL", "TEST1_PASSWORD", "PUBLISHER_TEST_EMAIL", "PUBLISHER_TEST_PASSWORD", "SENDMAIL_PATH"]) {
    assert.match(integrations, new RegExp(`\\b${envName}\\b`), `integration env ${envName}`);
  }
  const conventions = await text("docs/codex/CONVENTIONS.md");
  for (const reference of ["app/services/api.ts", "server/api.js", "server/modules/social-permissions.js", "app/services/response-validation.mjs", "server/db.js", "app/navigation/routes.ts", "app/i18n/messages.ts", "tests/response-validation.test.mjs"]) {
    assert.match(conventions, new RegExp(reference.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")), `reference implementation ${reference}`);
  }
});
