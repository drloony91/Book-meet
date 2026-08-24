import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { assertDatabaseConfig } from "../server/db.js";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultMigrationsDir = path.join(projectRoot, "mysql", "migrations");
const testFixturesRoot = path.join(projectRoot, "tests", "fixtures", "mysql-migrations");

export function resolveMigrationsDir() {
  const requested = process.env.MYSQL_MIGRATIONS_DIR;
  if (!requested) return defaultMigrationsDir;
  if (process.env.NODE_ENV !== "test" || process.env.MYSQL_INTEGRATION_TEST !== "1") {
    throw new Error("MYSQL_MIGRATIONS_DIR is a test-only override and requires NODE_ENV=test plus MYSQL_INTEGRATION_TEST=1.");
  }
  const resolved = path.resolve(projectRoot, requested);
  const relative = path.relative(testFixturesRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("MYSQL_MIGRATIONS_DIR must resolve within tests/fixtures/mysql-migrations.");
  }
  return resolved;
}

export async function migrationFiles(migrationsDir = resolveMigrationsDir()) {
  return (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
}

export function splitMigrationStatements(sql) {
  return sql.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean);
}

export function statementPreview(statement) {
  return statement.replace(/\s+/g, " ").trim().slice(0, 480);
}

export async function createMigrationMetadataConnection() {
  assertDatabaseConfig();
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: "utf8mb4",
    timezone: "Z",
    decimalNumbers: true,
  });
}

export const schemaMigrationsSql = "CREATE TABLE IF NOT EXISTS schema_migrations (migration_name VARCHAR(255) NOT NULL PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
export const schemaMigrationAttemptsSql = `CREATE TABLE IF NOT EXISTS schema_migration_attempts (
  migration_name VARCHAR(255) NOT NULL PRIMARY KEY,
  status ENUM('running', 'failed') NOT NULL,
  statement_index INT UNSIGNED NOT NULL,
  statement_preview VARCHAR(480) NOT NULL,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(1000) NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export async function ensureMigrationMetadata(pool) {
  await pool.query(schemaMigrationsSql);
  await pool.query(schemaMigrationAttemptsSql);
}

export async function cleanCompletedAttempts(pool) {
  await pool.query(
    `DELETE attempts FROM schema_migration_attempts attempts
      JOIN schema_migrations migrations ON migrations.migration_name = attempts.migration_name`,
  );
}

export async function unresolvedMigrationAttempts(pool) {
  const [rows] = await pool.query(
    `SELECT attempts.migration_name, attempts.status, attempts.statement_index, attempts.statement_preview,
            attempts.error_code, attempts.error_message, attempts.started_at, attempts.updated_at
       FROM schema_migration_attempts attempts
       LEFT JOIN schema_migrations migrations ON migrations.migration_name = attempts.migration_name
      WHERE migrations.migration_name IS NULL
      ORDER BY attempts.started_at, attempts.migration_name`,
  );
  return rows;
}

export function recoveryCommand(migrationName) {
  return `pnpm db:migrate:retry -- ${migrationName} --confirm-schema-reviewed`;
}

export function unresolvedAttemptError(attempt) {
  return [
    `Refusing blind migration rerun: ${attempt.migration_name} has an unresolved ${attempt.status} attempt.`,
    `Last statement #${attempt.statement_index}: ${attempt.statement_preview}`,
    attempt.error_code ? `Database error ${attempt.error_code}: ${attempt.error_message}` : "No database error was recorded; treat this as a stale running attempt.",
    "Actual schema was not changed by this safety gate. Inspect and reconcile the schema manually before clearing only the attempt marker with:",
    recoveryCommand(attempt.migration_name),
  ].join("\n");
}
