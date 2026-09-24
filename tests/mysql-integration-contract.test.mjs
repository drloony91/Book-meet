import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectMigrationFiles } from "../scripts/migration-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("staged migration stop points require an exact existing filename", () => {
  const files = ["051_previous.sql", "052_unified_conversations_stop_point.sql", "053_group_chat_server_foundations.sql"];
  assert.deepEqual(selectMigrationFiles(files), files);
  assert.deepEqual(selectMigrationFiles(files, ["--through=052_unified_conversations_stop_point.sql"]), files.slice(0, 2));
  assert.throws(() => selectMigrationFiles(files, ["--through=053_missing.sql"]), /Unknown migration stop point/);
  assert.throws(() => selectMigrationFiles(files, ["--through=../052_unified_conversations_stop_point.sql"]), /Unknown migration stop point/);
  assert.throws(() => selectMigrationFiles(files, ["--through=052_unified_conversations_stop_point.sql", "extra"]), /Use exactly/);
});

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("disposable MySQL package, Compose and test-safety contracts stay isolated", async () => {
  const packageJson = JSON.parse(await text("package.json"));
  assert.equal(packageJson.scripts["db:test:up"], "node scripts/db-test.mjs up");
  assert.equal(packageJson.scripts["db:test"], "node scripts/db-test.mjs test");
  assert.equal(packageJson.scripts["db:test:down"], "node scripts/db-test.mjs down");
  assert.equal(packageJson.scripts["verify:db"], "node scripts/db-test.mjs verify");
  assert.equal(packageJson.scripts["db:migrate:status"], "node scripts/migrate-status.mjs");
  assert.equal(packageJson.scripts["db:migrate:retry"], "node scripts/migrate-retry.mjs");
  assert.equal(packageJson.scripts.verify, "pnpm run check && pnpm test", "regular verification must remain Docker-free");

  const compose = await text("compose.mysql-test.yml");
  for (const marker of [
    "image: mysql:8.4.11",
    "MYSQL_DATABASE: book_meet_test",
    "MYSQL_USER: book_meet_test",
    "MYSQL_ROOT_HOST: \"%\"",
    "127.0.0.1:3307:3306",
    "--character-set-server=utf8mb4",
    "--collation-server=utf8mb4_unicode_ci",
    "mysql-test-data:/var/lib/mysql",
    "mysql --protocol=TCP",
    "-ubook_meet_test",
    "-D book_meet_test",
  ]) assert.match(compose, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
  assert.doesNotMatch(compose, /book_meet_local|bookmeet\.club|production/i);

  const orchestration = await text("scripts/db-test.mjs");
  for (const marker of [
    "composeProject = \"book-meet-mysql-test\"",
    "compose.mysql-test.yml",
    "NODE_ENV",
    "MYSQL_INTEGRATION_TEST",
    "DB_HOST",
    "DB_NAME",
    "DB_USER",
    "Docker Desktop with a running Docker Engine is required",
    "--volumes",
    "finally",
    "tests/mysql-integration.test.mjs",
  ]) assert.match(orchestration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);

  const migrationRunner = await text("scripts/migrate.js");
  for (const marker of [
    "schema_migration_attempts",
    "cleanCompletedAttempts",
    "unresolvedMigrationAttempts",
    "unresolvedAttemptError",
    "statement_index",
    "error_message",
    "createMigrationMetadataConnection",
    "metadataConnection.query",
    "migrationFailureWithDiagnosticError",
    "committed = true",
    "if (committed)",
    "canonical in schema_migrations",
  ]) assert.match(migrationRunner, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
  assert.doesNotMatch(migrationRunner, /pool\.query\(/, "runner metadata queries must not share the migration pool connection");
  assert.ok(
    migrationRunner.indexOf("if (committed)") > migrationRunner.indexOf("connection.release()"),
    "attempt-marker cleanup must occur after the transaction has left its failure path",
  );

  const migrationUtilities = await text("scripts/migration-utils.mjs");
  for (const marker of [
    "NODE_ENV !== \"test\"",
    "MYSQL_INTEGRATION_TEST !== \"1\"",
    "tests", "fixtures", "mysql-migrations",
    "schema_migration_attempts",
    "status ENUM('running', 'failed')",
    "statement_index INT UNSIGNED",
    "recoveryCommand",
    "Refusing blind migration rerun",
    "mysql.createConnection",
    "assertDatabaseConfig",
  ]) assert.match(migrationUtilities, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
  assert.doesNotMatch(migrationUtilities, /DB_CONNECTION_LIMIT/, "metadata connection must not silently alter pool sizing");

  const retry = await text("scripts/migrate-retry.mjs");
  for (const marker of [
    "--confirm-schema-reviewed",
    "exact migration file",
    "schema_migrations",
    "DELETE attempts FROM schema_migration_attempts",
    "Actual schema and schema_migrations were not changed",
  ]) assert.match(retry, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);

  const integration = await text("tests/mysql-integration.test.mjs");
  for (const marker of [
    "schema_migrations",
    "withTransaction",
    "foreign key",
    "material_saves",
    "fixture_ddl_first",
    "fixture_ddl_dependency",
    "schema_migration_attempts",
    "confirm-schema-reviewed",
    "MYSQL_MIGRATIONS_DIR",
    "scripts/seed.js",
    "scripts/seed-publisher.js",
  ]) assert.match(integration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
});

test("canonical database documentation records the Docker prerequisite and verified A-01 status", async () => {
  const documentation = await Promise.all([
    text("docs/codex/DATA_MODEL.md"),
    text("docs/codex/TESTING.md"),
    text("docs/codex/CONVENTIONS.md"),
    text("docs/codex/KNOWN_TECH_DEBT.md"),
  ]);
  const joined = documentation.join("\n");
  for (const marker of [
    "Docker Desktop",
    "Docker Compose",
    "mysql:8.4.11",
    "pnpm db:test:up",
    "pnpm db:test",
    "pnpm db:test:down",
    "pnpm verify:db",
    "pnpm db:migrate:status",
    "confirm-schema-reviewed",
    "MariaDB 10.6.27",
    "A-01 is closed",
    "passed on disposable MySQL 8.4.11",
    "not a claim that MySQL DDL rolls back transactionally",
  ]) assert.match(joined, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
});
