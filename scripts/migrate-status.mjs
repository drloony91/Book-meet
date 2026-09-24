import { closePool, getPool } from "../server/db.js";
import { recoveryCommand, unresolvedMigrationAttempts } from "./migration-utils.mjs";

try {
  const pool = getPool();
  const [attemptTable] = await pool.query("SHOW TABLES LIKE 'schema_migration_attempts'");
  const [ledgerTable] = await pool.query("SHOW TABLES LIKE 'schema_migrations'");
  if (!attemptTable.length || !ledgerTable.length) {
    console.log("Migration diagnostics are not initialized yet; no schema_migration_attempts/schema_migrations comparison is available.");
  } else {
    const attempts = await unresolvedMigrationAttempts(pool);
    if (!attempts.length) console.log("No unresolved migration attempts. Actual schema was not modified by this status command.");
    for (const attempt of attempts) {
      console.log(`${attempt.migration_name}: ${attempt.status}, statement #${attempt.statement_index}`);
      console.log(`Preview: ${attempt.statement_preview}`);
      if (attempt.error_code) console.log(`Database error ${attempt.error_code}: ${attempt.error_message}`);
      console.log(`After manual schema reconciliation only: ${recoveryCommand(attempt.migration_name)}`);
    }
  }
} finally {
  await closePool();
}
