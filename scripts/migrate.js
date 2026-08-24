import { readFile } from "node:fs/promises";
import path from "node:path";
import { closePool, getPool } from "../server/db.js";
import {
  cleanCompletedAttempts,
  createMigrationMetadataConnection,
  ensureMigrationMetadata,
  migrationFiles,
  resolveMigrationsDir,
  splitMigrationStatements,
  statementPreview,
  unresolvedAttemptError,
  unresolvedMigrationAttempts,
} from "./migration-utils.mjs";

const migrationsDir = resolveMigrationsDir();

function migrationFailureWithDiagnosticError(migrationError, diagnosticErrors) {
  const original = String(migrationError?.message ?? migrationError);
  const diagnostics = diagnosticErrors.map((error) => String(error?.message ?? error)).join("; ");
  const combined = new Error(`Migration failed: ${original}. Additionally, durable attempt diagnostics could not be fully recorded: ${diagnostics}`, { cause: migrationError });
  if (migrationError?.code) combined.code = migrationError.code;
  return combined;
}

let metadataConnection;
try {
  const pool = getPool();
  metadataConnection = await createMigrationMetadataConnection();
  await ensureMigrationMetadata(metadataConnection);
  await cleanCompletedAttempts(metadataConnection);
  const unresolvedAttempts = await unresolvedMigrationAttempts(metadataConnection);
  if (unresolvedAttempts.length) throw new Error(unresolvedAttemptError(unresolvedAttempts[0]));
  const [appliedRows] = await metadataConnection.query("SELECT migration_name FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.migration_name));
  const files = await migrationFiles(migrationsDir);
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const statements = splitMigrationStatements(sql);
    const firstStatement = statements[0] ?? "<empty migration>";
    try {
      await metadataConnection.query(
        `INSERT INTO schema_migration_attempts (migration_name, status, statement_index, statement_preview, error_code, error_message)
         VALUES (?, 'running', 1, ?, NULL, NULL)`,
        [file, statementPreview(firstStatement)],
      );
    } catch (error) {
      const attempts = await unresolvedMigrationAttempts(metadataConnection);
      const existingAttempt = attempts.find((attempt) => attempt.migration_name === file);
      if (existingAttempt) throw new Error(unresolvedAttemptError(existingAttempt));
      throw error;
    }
    const connection = await pool.getConnection();
    let committed = false;
    try {
      await connection.beginTransaction();
      for (const [index, statement] of statements.entries()) {
        await metadataConnection.query(
          `UPDATE schema_migration_attempts
              SET status = 'running', statement_index = ?, statement_preview = ?, error_code = NULL, error_message = NULL
            WHERE migration_name = ?`,
          [index + 1, statementPreview(statement), file],
        );
        await connection.query(statement);
      }
      await connection.query("INSERT INTO schema_migrations (migration_name) VALUES (?)", [file]);
      await connection.commit();
      committed = true;
    } catch (error) {
      const diagnosticErrors = [];
      try {
        await connection.rollback();
      } catch (rollbackError) {
        diagnosticErrors.push(rollbackError);
      }
      try {
        await metadataConnection.query(
          `UPDATE schema_migration_attempts
              SET status = 'failed', error_code = ?, error_message = ?
            WHERE migration_name = ?`,
          [String(error.code ?? error.errno ?? "UNKNOWN").slice(0, 64), String(error.message ?? error).slice(0, 1000), file],
        );
      } catch (metadataError) {
        diagnosticErrors.push(metadataError);
      }
      if (diagnosticErrors.length) throw migrationFailureWithDiagnosticError(error, diagnosticErrors);
      throw error;
    } finally {
      connection.release();
    }
    if (committed) {
      try {
        await metadataConnection.query("DELETE FROM schema_migration_attempts WHERE migration_name = ?", [file]);
      } catch (cleanupError) {
        console.warn(`Migration ${file} is canonical in schema_migrations, but its diagnostic marker could not be removed. It will be cleaned on the next runner startup: ${cleanupError.message}`);
      }
      console.log(`Применена миграция ${file}`);
    }
  }
  console.log("MySQL-схема Book Meet готова");
} finally {
  try {
    if (metadataConnection) await metadataConnection.end();
  } finally {
    await closePool();
  }
}
