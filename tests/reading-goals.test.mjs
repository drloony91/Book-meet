import assert from "node:assert/strict";
import test from "node:test";
import { annualPlan, eligibleGoalPeriods, goalProgressColor, monthPace, validateGoalPayload } from "../server/modules/reading-goals.js";

test("goal periods and monthly pace are timezone-aware, inclusive and leap-safe", () => {
  const february = new Date("2028-02-29T12:00:00Z");
  const periods = eligibleGoalPeriods("UTC", february);
  assert.deepEqual(periods.months, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(periods.years, [2028, 2029]);
  const pace = monthPace({ targetYear: 2028, targetMonth: 2, targetCount: 1 }, "UTC", february);
  assert.equal(pace.days, 1);
  assert.equal(monthPace({ targetYear: 2028, targetMonth: 3, targetCount: 32 }, "UTC", february).moreThanOnePerDay, true);
  assert.deepEqual(eligibleGoalPeriods("UTC", new Date("2028-03-01T00:00:00Z")).years, [2029]);
});

test("annual projection freezes elapsed slots and allocates only from its current anchor", () => {
  const goal = { targetYear: 2028, targetCount: 12, startMonth: 1 };
  assert.deepEqual(annualPlan(goal, [], "UTC", new Date("2028-01-15T00:00:00Z")).plan.map((entry) => entry.target), Array(12).fill(1));
  const march = annualPlan(goal, [{ completedYear: 2028, completedMonth: 1 }, { completedYear: 2028, completedMonth: 2 }], "UTC", new Date("2028-03-15T00:00:00Z"));
  assert.deepEqual(march.plan.map((entry) => entry.target), Array(12).fill(1));
  const backlog = annualPlan(goal, [], "UTC", new Date("2028-03-15T00:00:00Z"));
  assert.deepEqual(backlog.plan.slice(0, 2).map((entry) => entry.target), [1, 2]);
  assert.deepEqual(backlog.plan.slice(2).map((entry) => entry.target), [2, 2, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(annualPlan(goal, Array.from({ length: 12 }, () => ({ completedYear: 2028, completedMonth: 1 })), "UTC", new Date("2028-08-01T00:00:00Z")).plan[7].target, 0);
});

test("goal validation preserves an existing period for count-only PATCH and colors include exact thresholds", () => {
  const existing = { goal_kind: "year", target_count: 4, target_year: 2026, target_month: null, start_month: 1 };
  assert.equal(validateGoalPayload({ targetCount: 5 }, { timezone: "UTC", now: new Date("2028-03-01T00:00:00Z"), existing }).targetYear, 2026);
  assert.throws(() => validateGoalPayload({ targetCount: 5, targetYear: 2029 }, { timezone: "UTC", now: new Date("2028-03-01T00:00:00Z"), existing }), (error) => error.statusCode === 422);
  assert.equal(goalProgressColor(0, 1), "muted-red");
  assert.equal(goalProgressColor(50, 100), "muted-yellow");
  assert.equal(goalProgressColor(80, 100), "muted-yellow");
  assert.equal(goalProgressColor(81, 100), "muted-green");
  assert.equal(goalProgressColor(99, 100), "muted-green");
  assert.equal(goalProgressColor(100, 100), "green");
  assert.equal(goalProgressColor(49, 100), "muted-red");
  assert.equal(goalProgressColor(101, 100), "green");
  assert.equal(goalProgressColor(0, 0), "green");
  assert.equal(goalProgressColor(1, undefined), "blue");
});

test("goal input rejects coercion and annual January/February pace keeps the saved start", () => {
  const now = new Date("2028-02-01T00:00:00Z");
  assert.throws(() => validateGoalPayload({ goalKind: ["year"], targetYear: 2028, targetCount: 2 }, { now }), /тип/);
  for (const targetCount of [true, null, [], {}, "2", 0, -1, 1.5, 4_294_967_296]) {
    assert.throws(() => validateGoalPayload({ goalKind: "year", targetYear: 2028, targetCount }, { now }), /числ/);
  }
  const february = validateGoalPayload({ goalKind: "year", targetYear: 2028, targetCount: 22 }, { now });
  assert.equal(february.startMonth, 2);
  assert.equal(annualPlan(february, [], "UTC", now).booksPerMonth, 2);
  const nextYear = validateGoalPayload({ goalKind: "year", targetYear: 2029, targetCount: 25 }, { now });
  assert.equal(nextYear.startMonth, 1);
  assert.equal(annualPlan(nextYear, [], "UTC", now).booksPerMonth, 2.1);
  assert.equal(annualPlan(nextYear, [], "UTC", now).plan.reduce((sum, slot) => sum + slot.target, 0), 25);
  assert.deepEqual(eligibleGoalPeriods("America/Los_Angeles", new Date("2028-03-01T00:30:00Z")).years, [2028, 2029]);
  assert.equal(monthPace({ targetYear: 2028, targetMonth: 2, targetCount: 2 }, "UTC", new Date("2028-02-27T12:00:00Z")).text, "по одной книге за 1–2 дня");
});
