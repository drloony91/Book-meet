import assert from "node:assert/strict";
import test from "node:test";
import { queue3HttpFixture } from "./helpers/queue3-http.mjs";

test("TZ3 goals: authenticated real MySQL, calendar projection, owner isolation and lifecycle", async (t) => {
  const fixture = await queue3HttpFixture("q3-goals");
  const { db, year, month, user, book, call, request } = fixture;
  try {
    const owner = await user("owner");
    const other = await user("other");
    const admin = await user("admin", { role: "admin" });
    let monthly;

    await t.test("private monthly CRUD and strict authenticated input", async () => {
      await call(null, "GET", "/reading-goals", undefined, 401);
      monthly = (await call(owner, "POST", "/reading-goals", { goalKind: "month", targetYear: year, targetMonth: month, targetCount: 4, userId: other.id }, 201)).goal;
      assert.equal(monthly.targetCount, 4);
      assert.equal(monthly.startMonth, null);
      assert.deepEqual((await call(other, "GET", "/reading-goals")).goals, []);
      await call(other, "PATCH", `/reading-goals/${monthly.id}`, { targetCount: 8 }, 404);
      await call(other, "DELETE", `/reading-goals/${monthly.id}`, undefined, 404);
      assert.equal((await call(owner, "PATCH", `/reading-goals/${monthly.id}`, { targetCount: 5 })).goal.targetCount, 5);
      await call(owner, "PATCH", `/reading-goals/${monthly.id}`, { targetYear: year }, 422);
      for (const targetCount of [true, 0, -1, 1.5, 4_294_967_296]) await call(owner, "POST", "/reading-goals", { goalKind: "month", targetYear: year, targetMonth: month, targetCount }, 400);
      await call(owner, "POST", "/reading-goals", { goalKind: "month", targetYear: year + 1, targetMonth: 1, targetCount: 1 }, 400);
      if (month > 1) await call(owner, "POST", "/reading-goals", { goalKind: "month", targetYear: year, targetMonth: month - 1, targetCount: 1 }, 400);
      if (month > 2) await call(owner, "POST", "/reading-goals", { goalKind: "year", targetYear: year, targetCount: 12 }, 400);
      await call(owner, "PATCH", "/reading-goals/NaN", { targetCount: 2 }, 400);
      await call(owner, "DELETE", "/reading-goals/1.5", undefined, 400);
      await call(owner, "GET", "/reading-statistics?year=bad", undefined, 400);
      await call(owner, "GET", `/reading-statistics?year=${year}&month=13`, undefined, 400);
    });

    await t.test("annual NULL normalization prevents concurrent duplicate goals and leaks no owner data", async () => {
      const payload = { goalKind: "year", targetYear: year + 1, targetCount: 13 };
      const outcomes = await Promise.all([request(owner, "POST", "/reading-goals", payload), request(owner, "POST", "/reading-goals", payload)]);
      assert.deepEqual(outcomes.map((result) => result.status).sort(), [201, 409]);
      assert.equal(outcomes.find((result) => result.status === 409).data.code, "READING_GOAL_DUPLICATE");
      const statistics = await call(owner, "GET", `/reading-statistics?year=${year + 1}`);
      assert.equal(statistics.goals.length, 1);
      assert.equal(statistics.goals[0].startMonth, 1);
      assert.deepEqual(statistics.goals[0].projection.plan.map((slot) => slot.target), [2, ...Array(11).fill(1)]);
      assert.deepEqual((await call(other, "GET", `/reading-statistics?year=${year + 1}`)).goals, []);
      const bootstrap = await call(other, "GET", "/bootstrap/catalog");
      for (const person of bootstrap.users) assert.equal(Object.hasOwn(person, "readingGoals") || Object.hasOwn(person, "goals"), false);
      await call(other, "POST", "/reading-goals", payload, 201);
    });

    await t.test("statistics count completion cycles separately even without current library membership", async () => {
      const id = await book("reread");
      await db.query("INSERT INTO reading_cycles (user_id, book_id, completed_year, completed_month, status) VALUES (?, ?, ?, ?, 'completed'), (?, ?, ?, ?, 'completed'), (?, ?, ?, NULL, 'completed'), (?, ?, ?, ?, 'completed')", [owner.id, id, year, month, owner.id, id, year, month, owner.id, id, year, other.id, id, year, month]);
      const statistics = await call(owner, "GET", `/reading-statistics?year=${year}&month=${month}`);
      assert.equal(statistics.counts[month - 1], 2);
      assert.equal(statistics.counts.reduce((sum, count) => sum + count, 0), 2);
      assert.equal(statistics.goals.find((goal) => goal.id === monthly.id).projection.actual, 2);
      assert.equal((await call(other, "GET", `/reading-statistics?year=${year}&month=${month}`)).counts[month - 1], 1);
    });

    await t.test("schema rejects NULL period holes and invalid counts; target update rolls back on SQL failure", async () => {
      const insert = "INSERT INTO reading_goals (user_id, goal_kind, target_year, target_month, start_month, target_count) VALUES (?, ?, ?, ?, ?, ?)";
      for (const values of [[owner.id, "month", year, null, null, 1], [owner.id, "year", year, null, null, 1], [owner.id, "year", year, null, 3, 1], [owner.id, "month", year, month, null, 0]]) await assert.rejects(db.query(insert, values));
      await db.query("CREATE TRIGGER q3_goals_reject_update BEFORE UPDATE ON reading_goals FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deliberate goal update failure'");
      try { await call(owner, "PATCH", `/reading-goals/${monthly.id}`, { targetCount: 99 }, 500); }
      finally { await db.query("DROP TRIGGER q3_goals_reject_update"); }
      assert.equal((await call(owner, "GET", "/reading-goals")).goals.find((goal) => goal.id === monthly.id).targetCount, 5);
    });

    await t.test("hard deletion cascades goals; account finalization also removes private goals from tombstones", async () => {
      const deleted = await user("cascade");
      const retired = await user("retired");
      for (const actor of [deleted, retired]) await call(actor, "POST", "/reading-goals", { goalKind: "year", targetYear: year + 1, targetCount: 4 }, 201);
      await db.query("DELETE FROM users WHERE id = ?", [deleted.id]);
      await call(retired, "DELETE", "/users/me/profile");
      await call(admin, "DELETE", `/admin/users/${retired.id}/permanent`);
      const [[count]] = await db.query("SELECT COUNT(*) AS total FROM reading_goals WHERE user_id IN (?, ?)", [deleted.id, retired.id]);
      assert.equal(Number(count.total), 0);
      await call(owner, "DELETE", `/reading-goals/${monthly.id}`);
      assert.equal((await call(owner, "GET", "/reading-goals")).goals.some((goal) => goal.id === monthly.id), false);
    });
  } finally { await fixture.close(); }
});
