import "dotenv/config";
import mysql from "mysql2/promise";

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];

export function assertDatabaseConfig() {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Не заданы переменные подключения к MySQL: ${missing.join(", ")}`);
  }
}

let pool;

export function getPool() {
  assertDatabaseConfig();
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      charset: "utf8mb4",
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
      waitForConnections: true,
      queueLimit: 0,
      timezone: "Z",
      decimalNumbers: true,
    });
  }
  return pool;
}

export async function withTransaction(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
