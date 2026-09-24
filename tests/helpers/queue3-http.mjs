// Only the guarded disposable-MySQL runner may import this fixture.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import mysql from "mysql2/promise";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertSafeIntegrationEnvironment, testDatabaseEnvironment } from "../../scripts/db-test.mjs";
import { hashSessionToken } from "../../server/security.js";

assertSafeIntegrationEnvironment();
process.env.LEGAL_CONSENT_REQUIRED = "0";
process.env.TELEGRAM_ALERTS_ENABLED = "0";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.SMTP_HOST = "";

export async function queue3HttpFixture(prefix, { serveClient = false } = {}) {
  const { default: router } = await import("../../server/api.js");
  const { closePool } = await import("../../server/db.js");
  const db = mysql.createPool({ host: testDatabaseEnvironment.DB_HOST, port: Number(testDatabaseEnvironment.DB_PORT), database: testDatabaseEnvironment.DB_NAME, user: testDatabaseEnvironment.MYSQL_TEST_ROOT_USER, password: testDatabaseEnvironment.MYSQL_TEST_ROOT_PASSWORD, timezone: "Z", decimalNumbers: true, connectionLimit: 3 });
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  if (serveClient) {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const clientRoot = path.join(projectRoot, "dist", "client");
    const indexPath = path.join(clientRoot, "index.html");
    if (!existsSync(indexPath)) throw new Error("Built dist/client/index.html is required for the real-MySQL browser fixture");
    app.use(express.static(clientRoot, { index: false, maxAge: 0 }));
    app.get(/^\/(?!api\/).*/, (_request, response) => response.sendFile(indexPath));
  }
  app.use((error, _request, response, _next) => response.status(error.statusCode ?? 500).json({ error: error.message, code: error.code }));
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const year = new Date().getUTCFullYear();
  const month = new Date().getUTCMonth() + 1;
  const accounts = [];
  const books = [];

  async function user(name, { role = "user", type = "Читатель", minor = false } = {}) {
    const username = `${prefix}-${name}`;
    const [created] = await db.query("INSERT INTO users (username, username_key, password_hash, initials, color, role, profile_completed) VALUES (?, ?, 'test-only-hash', 'Q3', 'blue', ?, 1)", [username, username, role]);
    const id = Number(created.insertId);
    accounts.push(id);
    await db.query("INSERT INTO profiles (user_id, display_name, city, profile_type, gender, birth_date, bio, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres, publisher_status) VALUES (?, ?, 'Астана', ?, 'Женский', ?, '', '', '', '', '', '[]', '[]', 'approved')", [id, username, type, `${year - (minor ? 15 : 30)}-01-01`]);
    const token = randomBytes(32).toString("hex");
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))", [hashSessionToken(token), id]);
    return { id, cookie: `book_meet_session=${token}` };
  }

  async function book(name, adult = false) {
    const title = `${prefix}-${name}`;
    const [created] = await db.query("INSERT INTO books (author, author_key, title, title_key, genres, annotation, is_adult) VALUES ('Queue Three', 'queue three', ?, ?, '[]', 'Canonical annotation', ?)", [title, title, adult ? 1 : 0]);
    books.push(Number(created.insertId));
    return Number(created.insertId);
  }

  async function request(actor, method, route, body, headers = {}) {
    const response = await fetch(`${origin}/api${route}`, { method, headers: { ...(actor ? { cookie: actor.cookie } : {}), "content-type": "application/json", "X-BookMeet-Timezone": "UTC", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    return { status: response.status, data };
  }

  async function call(actor, method, route, body, expected = 200, headers = {}) {
    const { status, data } = await request(actor, method, route, body, headers);
    assert.equal(status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  }

  async function close() {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closePool();
    // These exact IDs were created by this fixture in the allowlisted test DB.
    if (books.length) await db.query("DELETE FROM books WHERE id IN (?)", [books]);
    if (accounts.length) await db.query("DELETE FROM users WHERE id IN (?)", [accounts]);
    await db.end();
  }
  return { db, origin, year, month, user, book, request, call, close };
}
