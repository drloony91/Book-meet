import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { closePool, getPool } from "../server/db.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(projectRoot, "mysql", "migrations");

try {
  const pool = getPool();
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (migration_name VARCHAR(255) NOT NULL PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  const [appliedRows] = await pool.query("SELECT migration_name FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.migration_name));
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean)) {
        await connection.query(statement);
      }
      await connection.query("INSERT INTO schema_migrations (migration_name) VALUES (?)", [file]);
      await connection.commit();
      console.log(`Применена миграция ${file}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  console.log("MySQL-схема Book Meet готова");
} finally {
  await closePool();
}
