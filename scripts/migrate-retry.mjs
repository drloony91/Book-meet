import { closePool, getPool } from "../server/db.js";
import { migrationFiles, recoveryCommand, resolveMigrationsDir } from "./migration-utils.mjs";

const [migrationName, confirmation, ...extra] = process.argv.slice(2);
if (!migrationName || confirmation !== "--confirm-schema-reviewed" || extra.length) {
  throw new Error("Usage: pnpm db:migrate:retry -- <exact-migration-name.sql> --confirm-schema-reviewed");
}

const migrationsDir = resolveMigrationsDir();
const files = await migrationFiles(migrationsDir);
if (!files.includes(migrationName)) {
  throw new Error(`Refusing retry marker clear: ${migrationName} is not an exact migration file in the selected migration directory.`);
}

try {
  const pool = getPool();
  const [attemptTable] = await pool.query("SHOW TABLES LIKE 'schema_migration_attempts'");
  const [ledgerTable] = await pool.query("SHOW TABLES LIKE 'schema_migrations'");
  if (!attemptTable.length || !ledgerTable.length) throw new Error("No migration diagnostics are available; the runner has not initialized both ledgers.");
  const [[attempt]] = await pool.query("SELECT migration_name, status, statement_index FROM schema_migration_attempts WHERE migration_name = ?", [migrationName]);
  if (!attempt) throw new Error(`Refusing retry marker clear: no unresolved attempt exists for ${migrationName}.`);
  const [[applied]] = await pool.query("SELECT migration_name FROM schema_migrations WHERE migration_name = ?", [migrationName]);
  if (applied) throw new Error(`Refusing retry marker clear: ${migrationName} is already canonical in schema_migrations.`);
  const [result] = await pool.query(
    `DELETE attempts FROM schema_migration_attempts attempts
      LEFT JOIN schema_migrations migrations ON migrations.migration_name = attempts.migration_name
      WHERE attempts.migration_name = ? AND migrations.migration_name IS NULL`,
    [migrationName],
  );
  if (result.affectedRows !== 1) throw new Error(`Refusing retry marker clear: ${migrationName} changed while being reviewed. Run ${recoveryCommand(migrationName)} again after re-checking status.`);
  console.log(`Cleared only the diagnostic attempt marker for ${migrationName} (last recorded statement #${attempt.statement_index}). Actual schema and schema_migrations were not changed; rerun db:migrate only after reconciliation.`);
} finally {
  await closePool();
}
