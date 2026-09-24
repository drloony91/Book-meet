import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LoginAttemptTracker } from "../server/modules/login-attempts.js";
import { isValidUsername, normalizeUsername, usernameStem, usernameValidationError } from "../server/modules/username.js";

const root = path.resolve(import.meta.dirname, "..");

test("public usernames are normalized, route-safe and reject reserved names", () => {
  assert.equal(normalizeUsername("  Alice.BOOK_7  "), "alice.book_7");
  assert.equal(isValidUsername("alice.book_7"), true);
  assert.equal(usernameValidationError("ab"), "USERNAME_INVALID");
  assert.equal(usernameValidationError("-alice"), "USERNAME_INVALID");
  assert.equal(usernameValidationError("alice-"), "USERNAME_INVALID");
  assert.equal(usernameValidationError("Алиса"), "USERNAME_INVALID");
  assert.equal(usernameValidationError("admin"), "USERNAME_RESERVED");
  assert.equal(usernameValidationError("book-meet-return"), "USERNAME_RESERVED");
  assert.equal(usernameStem("admin"), "reader");
});

test("login attempts retain IP defence after a successful identity and expire", () => {
  let now = 1_000;
  const tracker = new LoginAttemptTracker({ limit: 2, windowMs: 100, maxEntries: 2, now: () => now });
  const first = tracker.state(["ip:1", "identity:a"]);
  first.fail(); first.fail();
  assert.equal(tracker.state(["ip:1", "identity:a"]).blocked, true);
  first.clearIdentity();
  assert.equal(tracker.state(["ip:1", "identity:a"]).blocked, true, "IP bucket is not cleared by a successful account");
  now += 101;
  assert.equal(tracker.state(["ip:1", "identity:a"]).blocked, false);
  tracker.state(["ip:2", "identity:b"]);
  tracker.state(["ip:3", "identity:c"]);
  assert.ok(tracker.buckets.size <= 2, "tracker cleanup stays bounded");
});

test("migration and server contract keep memberships separate and saves private", async () => {
  const [migration, api, data, demo] = await Promise.all([
    readFile(path.join(root, "mysql", "migrations", "032_desktop_identity_community_saves.sql"), "utf8"),
    readFile(path.join(root, "server", "api.js"), "utf8"),
    readFile(path.join(root, "server", "data.js"), "utf8"),
    readFile(path.join(root, "server", "demo-api.js"), "utf8"),
  ]);
  assert.match(migration, /username_is_temporary TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(migration, /#migration032#/);
  assert.match(migration, /community_is_closed TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(migration, /CREATE TABLE material_saves/);
  assert.match(migration, /PRIMARY KEY \(user_id, material_kind, material_id\)/);
  assert.match(api, /if \(membership && !target\.community_is_closed\)/);
  assert.match(api, /INSERT IGNORE INTO community_memberships/);
  assert.doesNotMatch(api.slice(api.indexOf('if (membership && !target.community_is_closed)'), api.indexOf('if (membership && !target.community_is_closed)') + 1800), /INSERT IGNORE INTO friendships/);
  assert.match(api, /router\.post\("\/saves"/);
  assert.match(api, /readableMaterialInfo\(connection, userId, kind, materialId\)/);
  assert.match(data, /FROM material_saves WHERE user_id = \?/);
  assert.match(data, /savedMaterialRefs/);
  assert.match(demo, /if \(membership && !target\.profile\.communityIsClosed\)/);
  assert.match(demo, /router\.post\("\/saves"/);
});

test("bootstrap preserves birthday friendship isolation from community memberships", async () => {
  const data = await readFile(path.join(root, "server", "data.js"), "utf8");
  const birthdayCondition = data.match(/birthDate:[\s\S]{0,300}?isViewerFriend\(row\.id\)/)?.[0] ?? "";
  assert.match(birthdayCondition, /isViewerFriend/);
  assert.doesNotMatch(birthdayCondition, /communityMembership/);
});
