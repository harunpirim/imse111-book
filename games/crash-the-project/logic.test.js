import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  COST_STEP,
  MAX_COMBINATIONS,
  schedule,
  enumeratePaths,
  timeCost,
  savingPerDay,
  clampCrash,
  evaluate,
  solve,
  combinations,
  marginalSteps,
  starsFor,
  fitsLevel,
  generateProject,
} from "./logic.js";

// A small textbook network:  A -> B -> D,  A -> C -> D.
const act = (id, preds, normal, maxCrash, costPerDay) => ({ id, name: id, preds, normal, maxCrash, crashTime: normal - maxCrash, costPerDay });
const demo = {
  name: "demo",
  acts: [act("A", [], 4, 1, 300), act("B", ["A"], 6, 2, 100), act("C", ["A"], 5, 1, 150), act("D", ["B", "C"], 3, 1, 500)],
  indirect: 400,
  deadline: null,
  penalty: 0,
};
const projects = (level, n = 60) => Array.from({ length: n }, (_, s) => generateProject(createRng(`t:${level.id}:${s}`), level));

test("forward and backward pass give start, finish, slack, and the critical path", () => {
  const s = schedule(demo.acts, [4, 6, 5, 3]);
  assert.deepEqual(s.es, [0, 4, 4, 10]);
  assert.deepEqual(s.ef, [4, 10, 9, 13]);
  assert.deepEqual(s.ls, [0, 4, 5, 10]);
  assert.deepEqual(s.slack, [0, 0, 1, 0]);
  assert.deepEqual(s.critical, [true, true, false, true]);
  assert.equal(s.duration, 13);
});

test("the project length is the longest path", () => {
  const paths = enumeratePaths(demo.acts);
  assert.deepEqual(paths, [
    [0, 1, 3],
    [0, 2, 3],
  ]);
  for (const level of LEVELS) {
    for (const p of projects(level, 15)) {
      const e = evaluate(p, p.acts.map(() => 0));
      assert.equal(e.duration, Math.max(...e.paths.map((x) => x.length)));
      // An activity is critical exactly when it lies on a longest path.
      p.acts.forEach((a, i) => assert.equal(e.critical[i], e.paths.some((x) => x.critical && x.ids.includes(a.id))));
    }
  }
});

test("predecessors must be listed first", () => {
  assert.throws(() => schedule([act("B", ["A"], 2, 0, 100), act("A", [], 2, 0, 100)], [2, 2]));
});

test("crashing a critical activity shortens the project; a non-critical one doesn't", () => {
  const base = evaluate(demo, [0, 0, 0, 0]);
  assert.equal(base.total, 13 * 400);
  const critical = evaluate(demo, [0, 1, 0, 0]);
  assert.equal(critical.duration, 12);
  assert.equal(critical.crashCost, 100);
  assert.equal(critical.total, 100 + 12 * 400);
  // After one day off B, both paths are 12 days long: a new critical path appeared.
  assert.equal(critical.paths.filter((p) => p.critical).length, 2);
  const wasted = evaluate(demo, [0, 0, 1, 0]);
  assert.equal(wasted.duration, 13);
  assert.equal(wasted.total, 150 + 13 * 400);
  // Once both paths are critical, B alone no longer helps: B and C must be crashed together.
  assert.equal(evaluate(demo, [0, 2, 0, 0]).duration, 12);
  assert.equal(evaluate(demo, [0, 2, 1, 0]).duration, 11);
});

test("crash plans are clamped to each activity's limits", () => {
  assert.deepEqual(clampCrash(demo, [5, -1, 0.6, 1]), [1, 0, 1, 1]);
  assert.deepEqual(evaluate(demo, [9, 9, 9, 9]).durations, [3, 4, 4, 2]);
});

test("the exhaustive search finds the cheapest plan and the time-cost curve", () => {
  const { best, curve, normal, allOut, minDuration } = solve(demo);
  assert.equal(combinations(demo), 2 * 3 * 2 * 2);
  assert.equal(normal.duration, 13);
  assert.equal(normal.crashCost, 0);
  assert.equal(minDuration, 9);
  assert.equal(allOut.duration, 9);
  // Cheapest way to each length: B (100), then B+C (250), then A (300), then D (500).
  assert.deepEqual(curve.map((c) => [c.duration, c.crashCost]), [
    [9, 1150],
    [10, 650],
    [11, 350],
    [12, 100],
    [13, 0],
  ]);
  // Days costing less than the $400 overhead are worth buying: stop at 10 days.
  assert.equal(best.duration, 10);
  assert.equal(best.total, 650 + 10 * 400);
  assert.deepEqual(marginalSteps(demo, curve).map((s) => [s.from, s.to, s.costs, s.saves, s.worth]), [
    [13, 12, 100, 400, true],
    [12, 11, 250, 400, true],
    [11, 10, 300, 400, true],
    [10, 9, 500, 400, false],
  ]);
});

test("the optimum is never beaten by any crash plan", () => {
  for (const level of LEVELS.slice(0, 3)) {
    const rng = createRng(`random-plans:${level.id}`);
    for (const p of projects(level, 12)) {
      const { best, curve } = solve(p);
      const byDuration = new Map(curve.map((c) => [c.duration, c]));
      assert.equal(evaluate(p, best.crash).total, best.total);
      for (let k = 0; k < 300; k++) {
        const plan = p.acts.map((a) => rng.int(0, a.maxCrash));
        const e = evaluate(p, plan);
        assert.ok(e.total >= best.total);
        assert.ok(e.crashCost >= byDuration.get(e.duration).crashCost);
      }
    }
  }
});

test("each extra day costs more than the one before (so cheapest-first works)", () => {
  for (const level of LEVELS) {
    for (const p of projects(level)) {
      const { curve } = solve(p);
      const steps = marginalSteps(p, curve);
      assert.ok(steps.every((s) => s.days === 1), "every duration between the shortest and the normal one is reachable");
      for (let i = 1; i < steps.length; i++) assert.ok(steps[i].costs >= steps[i - 1].costs);
    }
  }
});

test("deadline levels charge a penalty for every late day", () => {
  const late = { ...demo, deadline: 11, penalty: 700 };
  assert.deepEqual(timeCost(late, 13), { indirect: 5200, penalty: 1400, late: 2 });
  assert.deepEqual(timeCost(late, 10), { indirect: 4000, penalty: 0, late: 0 });
  assert.equal(savingPerDay(late, 13), 400 + 700);
  assert.equal(savingPerDay(late, 11), 400);
  assert.equal(evaluate(late, [0, 0, 0, 0]).total, 5200 + 1400);
  // With the penalty, even the $500 day is worth buying while late, but not once on time.
  assert.equal(solve(late).best.duration, 10);
  assert.equal(solve({ ...late, deadline: 8 }).best.duration, 9);
});

test("generated projects fit their level", () => {
  for (const level of LEVELS) {
    for (const p of projects(level)) {
      const solved = solve(p);
      assert.ok(fitsLevel(p, level, solved), `level ${level.id}`);
      assert.ok(combinations(p) <= MAX_COMBINATIONS);
      const normal = evaluate(p, p.acts.map(() => 0));
      const best = evaluate(p, solved.best.crash);
      assert.equal(normal.paths.filter((x) => x.critical).length, 1);
      assert.ok(solved.best.total < solved.normal.total);
      p.acts.forEach((a) => {
        assert.equal(a.crashTime, a.normal - a.maxCrash);
        assert.ok(a.crashTime >= 2 && a.maxCrash >= 0);
        assert.equal(a.costPerDay % COST_STEP, 0);
      });
      if (level.network === "line") assert.equal(best.paths.filter((x) => x.critical).length, 1);
      else assert.ok(best.paths.filter((x) => x.critical).length >= 2, "a second path becomes critical");
      assert.equal(p.deadline != null, Boolean(level.penalty));
      if (level.penalty) {
        assert.ok(normal.duration - p.deadline >= level.late[0]);
        assert.ok(solved.minDuration <= p.deadline);
      }
    }
  }
});

test("projects are reproducible from the seed", () => {
  for (const level of LEVELS) {
    assert.deepEqual(generateProject(createRng(`seed:${level.id}`), level), generateProject(createRng(`seed:${level.id}`), level));
  }
});

test("stars reward the share of the possible saving", () => {
  assert.equal(starsFor(9000, 9000, 11000), 3);
  assert.equal(starsFor(9400, 9000, 11000), 2);
  assert.equal(starsFor(10500, 9000, 11000), 1);
  assert.equal(starsFor(11000, 9000, 11000), 0);
  assert.equal(starsFor(12000, 9000, 11000), 0);
});

test("assumptions text matches the model", () => {
  const text = ASSUMPTIONS.join(" ");
  const deadlineLevels = LEVELS.filter((l) => l.penalty).map((l) => l.id);
  assert.ok(text.includes(`deadline levels (${deadlineLevels.join(" and ")})`));
  // Constant cost per day, whole days: every extra crash day on one activity costs the same.
  const p = generateProject(createRng("assume"), LEVELS[1]);
  p.acts.forEach((a, i) => {
    for (let d = 1; d <= a.maxCrash; d++) {
      const plan = p.acts.map((_, j) => (j === i ? d : 0));
      assert.equal(evaluate(p, plan).crashCost, d * a.costPerDay);
      // Crashing one activity doesn't change any other activity's duration.
      evaluate(p, plan).durations.forEach((dur, j) => assert.equal(dur, p.acts[j].normal - (j === i ? d : 0)));
    }
  });
  // Indirect cost is a fixed amount per day, and there is no bonus for finishing early.
  const dl = generateProject(createRng("assume-deadline"), LEVELS[2]);
  assert.equal(timeCost(dl, dl.deadline - 3).penalty, 0);
  assert.equal(timeCost(dl, dl.deadline - 3).indirect, dl.indirect * (dl.deadline - 3));
  assert.equal(timeCost(dl, dl.deadline + 2).penalty, 2 * dl.penalty);
  // The benchmark checks every combination: its count is the product of the options per activity.
  assert.equal(combinations(demo), demo.acts.reduce((m, a) => m * (a.maxCrash + 1), 1));
});
