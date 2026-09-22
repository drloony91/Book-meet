import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { closePool, withTransaction } from "../server/db.js";
import { assertSafeIntegrationEnvironment, createTestEnvironment, testDatabaseEnvironment } from "../scripts/db-test.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "mysql", "migrations");
const databaseName = testDatabaseEnvironment.DB_NAME;

assertSafeIntegrationEnvironment();

const rootPool = mysql.createPool({
  host: testDatabaseEnvironment.DB_HOST,
  port: Number(testDatabaseEnvironment.DB_PORT),
  database: databaseName,
  user: testDatabaseEnvironment.MYSQL_TEST_ROOT_USER,
  password: testDatabaseEnvironment.MYSQL_TEST_ROOT_PASSWORD,
  waitForConnections: true,
  connectionLimit: 1,
});

const adminPool = mysql.createPool({
  host: testDatabaseEnvironment.DB_HOST,
  port: Number(testDatabaseEnvironment.DB_PORT),
  user: testDatabaseEnvironment.MYSQL_TEST_ROOT_USER,
  password: testDatabaseEnvironment.MYSQL_TEST_ROOT_PASSWORD,
  waitForConnections: true,
  connectionLimit: 1,
});

function runNode(script, overrides = {}, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: createTestEnvironment(overrides),
    encoding: "utf8",
    shell: false,
  });
}

function assertSucceeded(result, label) {
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr || result.stdout}`);
}

function assertFailed(result, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded:\n${result.stdout}`);
}

async function resetDatabase() {
  assertSafeIntegrationEnvironment();
  await closePool();
  await adminPool.query("DROP DATABASE IF EXISTS `book_meet_test`");
  await adminPool.query("CREATE DATABASE `book_meet_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  await rootPool.query("USE `book_meet_test`");
}

async function appliedMigrationNames() {
  const [rows] = await rootPool.query("SELECT migration_name FROM schema_migrations ORDER BY migration_name");
  return rows.map((row) => row.migration_name);
}

async function productionMigrationNames() {
  return (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
}

async function createTableTargets() {
  const targets = new Set();
  for (const name of await productionMigrationNames()) {
    const sql = await readFile(path.join(migrationsDir, name), "utf8");
    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z0-9_]+)`?/gi)) targets.add(match[1]);
  }
  return [...targets].sort();
}

async function schemaColumns() {
  const [rows] = await rootPool.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = ?",
    [databaseName],
  );
  return new Set(rows.map((row) => `${row.TABLE_NAME ?? row.table_name}.${row.COLUMN_NAME ?? row.column_name}`));
}

async function insertUser(username) {
  const [result] = await rootPool.query(
    `INSERT INTO users (username, username_key, email, email_key, password_hash, initials, color, role, profile_completed)
     VALUES (?, ?, ?, ?, 'test-hash', 'TI', 'blue', 'user', 1)`,
    [username, username, `${username}@example.test`, `${username}@example.test`],
  );
  return result.insertId;
}

test("MySQL production migrations, seed and critical relational behavior", async () => {
  await resetDatabase();
  const expectedMigrations = await productionMigrationNames();

  assertSucceeded(runNode("scripts/migrate.js"), "first production migration run");
  assert.deepEqual(await appliedMigrationNames(), expectedMigrations, "schema_migrations must record every production migration exactly once");

  assertSucceeded(runNode("scripts/migrate.js"), "second no-op production migration run");
  assert.deepEqual(await appliedMigrationNames(), expectedMigrations, "second runner invocation must not add or reorder ledger rows");

  const [tableRows] = await rootPool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
    [databaseName],
  );
  const actualTables = new Set(tableRows.map((row) => row.TABLE_NAME ?? row.table_name));
  for (const table of await createTableTargets()) assert.ok(actualTables.has(table), `missing CREATE TABLE target ${table}`);

  const columns = await schemaColumns();
  for (const column of [
    "users.email",
    "users.consent_withdrawn_at",
    "users.username_is_temporary",
    "profiles.birth_date_visibility",
    "profiles.community_is_closed",
    "user_books.top_rank",
    "reports.reference_code",
    "legal_documents.document_type",
    "telegram_alert_outbox.actor_user_id",
    "material_saves.material_kind",
    "chat_history_clears.cleared_through_message_id",
    "user_books.chapters_current",
    "user_books.postponed_timezone",
    "reading_cycles.active_slot",
    "book_progress_notes.progress_percent",
    "user_hides.hidden_user_id",
    "book_shelves.owner_user_id",
    "book_shelf_items.book_id",
    "material_comments.parent_comment_id",
    "material_comments.reply_to_comment_id",
    "content_mentions.mention_token",
    "reposts.source_root_id",
    "excerpts.provenance_repost_id",
    "message_reactions.reaction_type",
    "messages.edited_at",
    "messages.deleted_at",
    "messages.deleted_before_read",
    "messages.moderation_retained_until",
    "message_edit_history.message_reference_id",
    "message_edit_history.previous_body",
    "message_deletion_evidence.message_reference_id",
    "message_deletion_evidence.original_body",
    "users.telegram_display_name",
    "users.telegram_delivery_error_at",
    "telegram_link_tokens.token_hash",
    "telegram_link_tokens.expires_at",
    "telegram_link_tokens.consumed_at",
  ]) assert.ok(columns.has(column), `missing late-schema column ${column}`);

  const [messageSearchIndexes] = await rootPool.query(
    "SELECT index_name, index_type, column_name FROM information_schema.statistics WHERE table_schema = ? AND table_name = 'messages' AND index_name = 'messages_body_fulltext'",
    [databaseName],
  );
  assert.deepEqual(messageSearchIndexes.map((row) => [row.INDEX_NAME ?? row.index_name, row.INDEX_TYPE ?? row.index_type, row.COLUMN_NAME ?? row.column_name]), [["messages_body_fulltext", "FULLTEXT", "body"]]);

  const [foreignKeys] = await rootPool.query(
    `SELECT table_name, referenced_table_name, delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = ?`,
    [databaseName],
  );
  const rules = new Set(foreignKeys.map((row) => `${row.TABLE_NAME ?? row.table_name}->${row.REFERENCED_TABLE_NAME ?? row.referenced_table_name}:${row.DELETE_RULE ?? row.delete_rule}`));
  for (const rule of ["profiles->users:CASCADE", "messages->users:SET NULL", "chat_history_clears->users:CASCADE", "legal_acceptances->legal_documents:RESTRICT", "book_progress_notes->reading_cycles:SET NULL", "book_progress_notes->users:CASCADE", "user_hides->users:CASCADE", "book_shelves->users:CASCADE", "book_shelf_items->book_shelves:CASCADE", "book_shelf_items->books:SET NULL", "material_comment_likes->material_comments:CASCADE", "content_mentions->users:CASCADE", "reposts->users:CASCADE", "excerpts->reposts:SET NULL", "message_reactions->messages:CASCADE", "message_reactions->users:CASCADE", "message_edit_history->messages:SET NULL", "message_edit_history->users:SET NULL", "message_deletion_evidence->messages:SET NULL", "message_deletion_evidence->users:SET NULL", "telegram_link_tokens->users:CASCADE"]) {
    assert.ok(rules.has(rule), `missing foreign-key rule ${rule}`);
  }

  const cycleUserId = await insertUser("reading-cycle-user");
  const [cycleBook] = await rootPool.query("INSERT INTO books (author, author_key, title, title_key, genres, annotation) VALUES ('Cycle', 'cycle', 'Cycle', 'cycle', '[]', '')");
  await rootPool.query("INSERT INTO reading_cycles (user_id, book_id, status) VALUES (?, ?, 'active')", [cycleUserId, cycleBook.insertId]);
  await assert.rejects(rootPool.query("INSERT INTO reading_cycles (user_id, book_id, status) VALUES (?, ?, 'active')", [cycleUserId, cycleBook.insertId]), /duplicate/i, "generated active slot must permit only one active cycle");
  await rootPool.query("UPDATE reading_cycles SET status = 'completed', completed_month = NULL, completed_year = NULL WHERE user_id = ? AND book_id = ?", [cycleUserId, cycleBook.insertId]);
  await rootPool.query("INSERT INTO reading_cycles (user_id, book_id, status) VALUES (?, ?, 'active')", [cycleUserId, cycleBook.insertId]);

  assertSucceeded(runNode("scripts/seed.js"), "first seed run");
  assertSucceeded(runNode("scripts/seed.js"), "second idempotent seed run");
  const [[seededAdmin]] = await rootPool.query("SELECT COUNT(*) AS count FROM users WHERE email_key = ?", [testDatabaseEnvironment.ADMIN_EMAIL]);
  assert.equal(seededAdmin.count, 1, "ADMIN_EMAIL seed must remain idempotent");

  const productionWithoutCredentials = { ...process.env, NODE_ENV: "production", DOTENV_CONFIG_PATH: path.join(root, "tests", "fixtures", "no-production-env") };
  delete productionWithoutCredentials.ADMIN_EMAIL;
  delete productionWithoutCredentials.TEST1_PASSWORD;
  const seedProduction = spawnSync(process.execPath, ["scripts/seed.js"], { cwd: root, env: productionWithoutCredentials, encoding: "utf8", shell: false });
  assertFailed(seedProduction, "production seed without credentials");
  assert.match(seedProduction.stderr, /ADMIN_EMAIL.*TEST1_PASSWORD/);
  const publisherProduction = spawnSync(process.execPath, ["scripts/seed-publisher.js"], { cwd: root, env: productionWithoutCredentials, encoding: "utf8", shell: false });
  assertFailed(publisherProduction, "production publisher seed");
  assert.match(publisherProduction.stderr, /local-only fixture/);

  assert.throws(() => assertSafeIntegrationEnvironment({ ...testDatabaseEnvironment, DB_HOST: "example.test" }), /DB_HOST=127\.0\.0\.1/);
  assert.throws(() => assertSafeIntegrationEnvironment({ ...testDatabaseEnvironment, DB_NAME: "book_meet" }), /DB_NAME=book_meet_test/);
  assert.throws(() => assertSafeIntegrationEnvironment({ ...testDatabaseEnvironment, DB_USER: "root" }), /DB_USER=book_meet_test/);

  const rollbackTitle = "transaction-rollback-test";
  await assert.rejects(
    withTransaction(async (connection) => {
      await connection.query(
        "INSERT INTO books (author, author_key, title, title_key, genres, annotation) VALUES ('Test', 'test', ?, ?, '[]', 'rollback')",
        [rollbackTitle, rollbackTitle],
      );
      throw new Error("rollback sentinel");
    }),
    /rollback sentinel/,
  );
  const [[rolledBack]] = await rootPool.query("SELECT COUNT(*) AS count FROM books WHERE title_key = ?", [rollbackTitle]);
  assert.equal(rolledBack.count, 0, "withTransaction must roll back DML on an actual MySQL connection");

  await assert.rejects(
    rootPool.query("INSERT INTO messages (recipient_user_id, body) VALUES (999999999, 'invalid FK')"),
    /foreign key/i,
    "MySQL must reject an invalid foreign key",
  );

  const clearViewerId = await insertUser("chat-clear-viewer");
  const clearPeerId = await insertUser("chat-clear-peer");
  const [olderMessage] = await rootPool.query("INSERT INTO messages (sender_user_id, recipient_user_id, body) VALUES (?, ?, 'older')", [clearViewerId, clearPeerId]);
  const [newerMessage] = await rootPool.query("INSERT INTO messages (sender_user_id, recipient_user_id, body) VALUES (?, ?, 'newer')", [clearPeerId, clearViewerId]);
  await rootPool.query("INSERT INTO chat_history_clears (user_id, peer_user_id, cleared_through_message_id) VALUES (?, ?, ?)", [clearViewerId, clearPeerId, newerMessage.insertId]);
  const [[viewerCursor]] = await rootPool.query("SELECT cleared_through_message_id FROM chat_history_clears WHERE user_id = ? AND peer_user_id = ?", [clearViewerId, clearPeerId]);
  const [[peerCursor]] = await rootPool.query("SELECT COUNT(*) AS count FROM chat_history_clears WHERE user_id = ? AND peer_user_id = ?", [clearPeerId, clearViewerId]);
  assert.equal(Number(viewerCursor.cleared_through_message_id), Number(newerMessage.insertId), "clear cursor must stop at the viewer's current pair maximum");
  assert.equal(peerCursor.count, 0, "clearing must not create a cursor for the peer");
  const [laterMessage] = await rootPool.query("INSERT INTO messages (sender_user_id, recipient_user_id, body) VALUES (?, ?, 'later')", [clearPeerId, clearViewerId]);
  assert.ok(Number(laterMessage.insertId) > Number(viewerCursor.cleared_through_message_id), "messages sent after clearing must remain visible above the cursor");
  assert.ok(Number(olderMessage.insertId) <= Number(viewerCursor.cleared_through_message_id));

  await rootPool.query("INSERT INTO message_reactions (message_id, user_id) VALUES (?, ?)", [laterMessage.insertId, clearViewerId]);
  await assert.rejects(rootPool.query("INSERT INTO message_reactions (message_id, user_id) VALUES (?, ?)", [laterMessage.insertId, clearViewerId]), /duplicate/i, "one user reaction per message must stay unique");
  await rootPool.query("DELETE FROM messages WHERE id = ?", [laterMessage.insertId]);
  let [[reactionCount]] = await rootPool.query("SELECT COUNT(*) AS count FROM message_reactions WHERE message_id = ?", [laterMessage.insertId]);
  assert.equal(Number(reactionCount.count), 0, "message deletion must cascade to reactions");
  const reactionOnlyUserId = await insertUser("reaction-cascade-user");
  const [reactionTargetMessage] = await rootPool.query("INSERT INTO messages (sender_user_id, recipient_user_id, body) VALUES (?, ?, 'reaction user cascade')", [clearPeerId, clearViewerId]);
  await rootPool.query("INSERT INTO message_reactions (message_id, user_id) VALUES (?, ?)", [reactionTargetMessage.insertId, reactionOnlyUserId]);
  await rootPool.query("DELETE FROM users WHERE id = ?", [reactionOnlyUserId]);
  [[reactionCount]] = await rootPool.query("SELECT COUNT(*) AS count FROM message_reactions WHERE message_id = ?", [reactionTargetMessage.insertId]);
  assert.equal(Number(reactionCount.count), 0, "user deletion must cascade to reactions without deleting an unrelated message");
  const [[retainedReactionTarget]] = await rootPool.query("SELECT COUNT(*) AS count FROM messages WHERE id = ?", [reactionTargetMessage.insertId]);
  assert.equal(Number(retainedReactionTarget.count), 1);

  const editEvidenceUserId = await insertUser("message-edit-evidence-user");
  const [editEvidenceMessage] = await rootPool.query("INSERT INTO messages (sender_user_id, recipient_user_id, body) VALUES (?, ?, 'current evidence')", [editEvidenceUserId, clearViewerId]);
  await rootPool.query("INSERT INTO message_edit_history (message_id, message_reference_id, editor_user_id, previous_body) VALUES (?, ?, ?, 'previous evidence')", [editEvidenceMessage.insertId, editEvidenceMessage.insertId, editEvidenceUserId]);
  await rootPool.query("DELETE FROM messages WHERE id = ?", [editEvidenceMessage.insertId]);
  let [[editEvidence]] = await rootPool.query("SELECT message_id, message_reference_id, editor_user_id, previous_body FROM message_edit_history WHERE message_reference_id = ?", [editEvidenceMessage.insertId]);
  assert.equal(editEvidence.message_id, null, "message removal must retain private edit evidence");
  assert.equal(Number(editEvidence.message_reference_id), Number(editEvidenceMessage.insertId));
  await rootPool.query("DELETE FROM users WHERE id = ?", [editEvidenceUserId]);
  [[editEvidence]] = await rootPool.query("SELECT editor_user_id, previous_body FROM message_edit_history WHERE message_reference_id = ?", [editEvidenceMessage.insertId]);
  assert.equal(editEvidence.editor_user_id, null, "user removal must anonymize retained edit evidence");
  assert.equal(editEvidence.previous_body, "previous evidence");

  const deletionEvidenceUserId = await insertUser("message-deletion-evidence-user");
  const [deletionEvidenceMessage] = await rootPool.query("INSERT INTO messages (sender_user_id, recipient_user_id, body) VALUES (?, ?, 'private deletion evidence')", [deletionEvidenceUserId, clearViewerId]);
  await rootPool.query(
    `INSERT INTO message_deletion_evidence
       (message_id, message_reference_id, sender_user_id, sender_reference_id, recipient_user_id, recipient_reference_id, original_body, was_read, deleted_before_read, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'private deletion evidence', 0, 1, UTC_TIMESTAMP())`,
    [deletionEvidenceMessage.insertId, deletionEvidenceMessage.insertId, deletionEvidenceUserId, deletionEvidenceUserId, clearViewerId, clearViewerId],
  );
  await rootPool.query("DELETE FROM messages WHERE id = ?", [deletionEvidenceMessage.insertId]);
  let [[deletionEvidence]] = await rootPool.query("SELECT message_id, message_reference_id, sender_user_id, original_body, moderation_retained_until FROM message_deletion_evidence WHERE message_reference_id = ?", [deletionEvidenceMessage.insertId]);
  assert.equal(deletionEvidence.message_id, null, "message removal must retain private deletion evidence");
  assert.equal(Number(deletionEvidence.message_reference_id), Number(deletionEvidenceMessage.insertId));
  assert.equal(deletionEvidence.original_body, "private deletion evidence");
  assert.equal(deletionEvidence.moderation_retained_until, null, "retention deadline stays unset until policy approval");
  await rootPool.query("DELETE FROM users WHERE id = ?", [deletionEvidenceUserId]);
  [[deletionEvidence]] = await rootPool.query("SELECT sender_user_id, sender_reference_id, original_body FROM message_deletion_evidence WHERE message_reference_id = ?", [deletionEvidenceMessage.insertId]);
  assert.equal(deletionEvidence.sender_user_id, null, "user removal must anonymize the live deletion-evidence FK");
  assert.equal(Number(deletionEvidence.sender_reference_id), Number(deletionEvidenceUserId));
  assert.equal(deletionEvidence.original_body, "private deletion evidence");

  const cascadeUserId = await insertUser("cascade-user-test");
  await rootPool.query("INSERT INTO material_saves (user_id, material_kind, material_id) VALUES (?, 'book', 1)", [cascadeUserId]);
  await rootPool.query("DELETE FROM users WHERE id = ?", [cascadeUserId]);
  const [[cascaded]] = await rootPool.query("SELECT COUNT(*) AS count FROM material_saves WHERE user_id = ?", [cascadeUserId]);
  assert.equal(cascaded.count, 0, "ON DELETE CASCADE must remove user-owned saves");

  const setNullUserId = await insertUser("set-null-user-test");
  const [bookResult] = await rootPool.query(
    "INSERT INTO books (creator_user_id, author, author_key, title, title_key, genres, annotation) VALUES (?, 'Set Null', 'set-null', 'Set Null', 'set-null', '[]', 'test')",
    [setNullUserId],
  );
  await rootPool.query("DELETE FROM users WHERE id = ?", [setNullUserId]);
  const [[setNullBook]] = await rootPool.query("SELECT creator_user_id FROM books WHERE id = ?", [bookResult.insertId]);
  assert.equal(setNullBook.creator_user_id, null, "ON DELETE SET NULL must preserve canonical books");
  const noteUserId = await insertUser("note-relations-user");
  const [noteBook] = await rootPool.query("INSERT INTO books (author, author_key, title, title_key, genres, annotation) VALUES ('Note', 'note', 'Note relation', 'note relation', '[]', '')");
  const [noteCycle] = await rootPool.query("INSERT INTO reading_cycles (user_id, book_id, status) VALUES (?, ?, 'active')", [noteUserId, noteBook.insertId]);
  const [note] = await rootPool.query("INSERT INTO book_progress_notes (user_id, book_id, reading_cycle_id, body, progress_unit, progress_current, progress_total, progress_percent) VALUES (?, ?, ?, 'relation', 'chapters', 1, 4, 25)", [noteUserId, noteBook.insertId, noteCycle.insertId]);
  await assert.rejects(rootPool.query("INSERT INTO user_hides (hider_user_id, hidden_user_id) VALUES (?, ?)", [noteUserId, noteUserId]), /check/i, "a user cannot hide themself");
  await rootPool.query("DELETE FROM reading_cycles WHERE id = ?", [noteCycle.insertId]);
  const [[noteAfterCycle]] = await rootPool.query("SELECT reading_cycle_id FROM book_progress_notes WHERE id = ?", [note.insertId]);
  assert.equal(noteAfterCycle.reading_cycle_id, null, "deleting a cycle must retain the frozen note");
  await rootPool.query("DELETE FROM books WHERE id = ?", [noteBook.insertId]);
  const [[noteAfterBook]] = await rootPool.query("SELECT COUNT(*) AS count FROM book_progress_notes WHERE id = ?", [note.insertId]);
  assert.equal(Number(noteAfterBook.count), 0, "book deletion must cascade to notes");
  assertSucceeded(runNode("tests/reading-http-mysql.mjs"), "TZ2 authenticated HTTP transaction and privacy matrix");
  assertSucceeded(runNode("tests/reading-goals-http-mysql.mjs"), "TZ3 goals authenticated HTTP, privacy, uniqueness and cascade");
  assertSucceeded(runNode("tests/message-reactions-http-mysql.mjs"), "TZ5 message reactions authenticated HTTP authorization and idempotency");
  assertSucceeded(runNode("tests/message-edits-http-mysql.mjs"), "TZ5 message edits authenticated HTTP ownership, privacy and transactionality");
  assertSucceeded(runNode("tests/message-deletions-http-mysql.mjs"), "TZ5 message deletions authenticated HTTP evidence, race and transactionality");
  assertSucceeded(runNode("tests/message-stickers-http-mysql.mjs"), "TZ5 stickers authenticated HTTP persistence and deletion evidence");
  assertSucceeded(runNode("tests/message-search-http-mysql.mjs"), "TZ5 message search FULLTEXT authorization, visibility, pagination and grouping");
  assertSucceeded(runNode("tests/notification-preferences-http-mysql.mjs"), "TZ5 notification preferences persistence, constraints, readiness and range read-all");
  assertSucceeded(runNode("tests/notification-events-http-mysql.mjs"), "TZ5 notification domain events, delivery outbox and worker claim state");
  assertSucceeded(runNode("tests/book-progress-notes-http-mysql.mjs"), "TZ3 notes authenticated HTTP, spoiler/privacy and moderation matrix");
  assertSucceeded(runNode("tests/book-shelves-http-mysql.mjs"), "TZ3 shelves authenticated HTTP, visibility, material actions and atomic batch matrix");
  assertSucceeded(runNode("tests/social-content-http-mysql.mjs"), "TZ4 social content authenticated HTTP, privacy, mention, comment and repost matrix");
});

test("039 upgrades populated legacy libraries without losing unknown completion dates", async () => {
  await resetDatabase();
  const fixturesRoot = path.resolve(root, "tests", "fixtures", "mysql-migrations");
  const legacyDirectory = await mkdtemp(path.join(fixturesRoot, "tz2-upgrade-"));
  try {
    const migrations = await productionMigrationNames();
    for (const name of migrations.filter((name) => Number.parseInt(name, 10) < 39)) await copyFile(path.join(migrationsDir, name), path.join(legacyDirectory, name));
    assertSucceeded(runNode("scripts/migrate.js", { MYSQL_MIGRATIONS_DIR: legacyDirectory }), "legacy schema through 038");
    const reader = await insertUser("tz2-legacy-reader");
    const community = await insertUser("tz2-legacy-community");
    for (const [userId, type] of [[reader, "Читатель"], [community, "Сообщество"]]) await rootPool.query("INSERT INTO profiles (user_id, display_name, profile_type, bio, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres) VALUES (?, 'Legacy', ?, '', '', '', '', '', '[]', '[]')", [userId, type]);
    const ids = [];
    for (const name of ["known", "unknown", "invalid", "reading-zero", "reading-number", "community"]) {
      const [created] = await rootPool.query("INSERT INTO books (author, author_key, title, title_key, genres, annotation) VALUES ('TZ2 Legacy', 'tz2 legacy', ?, ?, '[]', '')", [name, name]);
      ids.push(Number(created.insertId));
    }
    await rootPool.query("INSERT INTO user_books (user_id, book_id, reading_status, read_month, read_year) VALUES (?, ?, 'read', 5, 2024), (?, ?, 'read', NULL, NULL), (?, ?, 'read', 13, 1)", [reader, ids[0], reader, ids[1], reader, ids[2]]);
    await rootPool.query("INSERT INTO user_books (user_id, book_id, reading_status, last_read_chapter) VALUES (?, ?, 'reading', 0), (?, ?, 'reading', 7)", [reader, ids[3], reader, ids[4]]);
    await rootPool.query("INSERT INTO user_books (user_id, book_id, reading_status) VALUES (?, ?, 'read')", [community, ids[5]]);
    assertSucceeded(runNode("scripts/migrate.js"), "populated legacy upgrade to 039");
    const [cycles] = await rootPool.query("SELECT book_id, status, completed_month, completed_year, completed_at FROM reading_cycles WHERE user_id = ? ORDER BY book_id", [reader]);
    assert.equal(cycles.length, 5);
    assert.deepEqual(cycles.slice(0, 3).map((row) => [row.status, row.completed_month, row.completed_year, row.completed_at]), [["completed", 5, 2024, null], ["completed", null, null, null], ["completed", null, null, null]]);
    const [progress] = await rootPool.query("SELECT chapters_current, chapters_total, progress_unit FROM user_books WHERE user_id = ? AND reading_status = 'reading' ORDER BY book_id", [reader]);
    assert.deepEqual(progress.map((row) => [row.chapters_current, row.chapters_total, row.progress_unit]), [[0, null, "chapters"], [7, null, "chapters"]]);
    const [[organizationCycles]] = await rootPool.query("SELECT COUNT(*) AS count FROM reading_cycles WHERE user_id = ?", [community]);
    assert.equal(organizationCycles.count, 0);
    assertSucceeded(runNode("scripts/migrate.js"), "repeat legacy upgrade is a no-op");
    assert.deepEqual(await appliedMigrationNames(), migrations);
    const [[afterRepeat]] = await rootPool.query("SELECT COUNT(*) AS count FROM reading_cycles WHERE user_id = ?", [reader]);
    assert.equal(afterRepeat.count, 5);
  } finally {
    const resolved = path.resolve(legacyDirectory);
    assert.equal(path.dirname(resolved), fixturesRoot);
    assert.ok(path.basename(resolved).startsWith("tz2-upgrade-"));
    await rm(resolved, { recursive: true, force: true });
  }
});

test("A-01 fixture blocks blind rerun until explicit schema reconciliation and marker retry", async () => {
  await resetDatabase();
  const fixtureEnvironment = { MYSQL_MIGRATIONS_DIR: "tests/fixtures/mysql-migrations" };
  const fixtureMigration = "001_fixture_partial_ddl.sql";
  const firstRun = runNode("scripts/migrate.js", fixtureEnvironment);
  assertFailed(firstRun, "A-01 first fixture run");

  const [firstTable] = await rootPool.query("SHOW TABLES LIKE 'fixture_ddl_first'");
  const [dependentTable] = await rootPool.query("SHOW TABLES LIKE 'fixture_ddl_requires_dependency'");
  assert.equal(firstTable.length, 1, "first DDL must remain after the later deliberate migration failure");
  assert.equal(dependentTable.length, 0, "missing fixture dependency must prevent the second DDL table");
  assert.deepEqual(await appliedMigrationNames(), [], "failed fixture migration must not be entered in schema_migrations");
  const [[failedAttempt]] = await rootPool.query(
    "SELECT migration_name, status, statement_index, statement_preview, error_code, error_message FROM schema_migration_attempts WHERE migration_name = ?",
    [fixtureMigration],
  );
  assert.equal(failedAttempt.migration_name, fixtureMigration);
  assert.equal(failedAttempt.status, "failed");
  assert.equal(failedAttempt.statement_index, 2);
  assert.match(failedAttempt.statement_preview, /fixture_ddl_requires_dependency/);
  assert.ok(failedAttempt.error_code, "failed attempt must preserve the engine error code");
  assert.match(failedAttempt.error_message, /fixture_ddl_dependency|referenced/i);

  const retry = runNode("scripts/migrate.js", fixtureEnvironment);
  assertFailed(retry, "A-01 blind retry");
  assert.match(retry.stderr, /Refusing blind migration rerun/);
  const [firstTableAfterRetry] = await rootPool.query("SHOW TABLES LIKE 'fixture_ddl_first'");
  assert.equal(firstTableAfterRetry.length, 1, "retry must preserve the diagnostic partial table state");
  assert.deepEqual(await appliedMigrationNames(), [], "retry must not synthesize a migration ledger row");

  const status = runNode("scripts/migrate-status.mjs", fixtureEnvironment);
  assertSucceeded(status, "migration status");
  assert.match(status.stdout, /fixture_ddl_requires_dependency/);
  assert.match(status.stdout, /db:migrate:retry/);

  await rootPool.query("CREATE TABLE fixture_ddl_dependency (id BIGINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  const missingConfirmation = runNode("scripts/migrate-retry.mjs", fixtureEnvironment, [fixtureMigration]);
  assertFailed(missingConfirmation, "retry marker clear without confirmation");
  const [[attemptAfterRejectedClear]] = await rootPool.query("SELECT migration_name FROM schema_migration_attempts WHERE migration_name = ?", [fixtureMigration]);
  assert.equal(attemptAfterRejectedClear.migration_name, fixtureMigration);

  const confirmedRetry = runNode("scripts/migrate-retry.mjs", fixtureEnvironment, [fixtureMigration, "--confirm-schema-reviewed"]);
  assertSucceeded(confirmedRetry, "confirmed retry marker clear");
  assert.match(confirmedRetry.stdout, /Actual schema and schema_migrations were not changed/);
  const [[clearedAttempt]] = await rootPool.query("SELECT COUNT(*) AS count FROM schema_migration_attempts WHERE migration_name = ?", [fixtureMigration]);
  assert.equal(clearedAttempt.count, 0, "recovery command must clear only the exact attempt marker");
  assert.deepEqual(await appliedMigrationNames(), [], "recovery command must not insert a canonical migration ledger row");

  assertSucceeded(runNode("scripts/migrate.js", fixtureEnvironment), "reconciled fixture rerun");
  assert.deepEqual(await appliedMigrationNames(), [fixtureMigration]);
  const [[remainingAttempt]] = await rootPool.query("SELECT COUNT(*) AS count FROM schema_migration_attempts WHERE migration_name = ?", [fixtureMigration]);
  assert.equal(remainingAttempt.count, 0, "successful migration must remove its attempt marker");
});

after(async () => {
  await closePool();
  await rootPool.end();
  await adminPool.end();
});
