import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  SHIFT_SECONDS,
  generateInstance,
  theoreticalMinStations,
  positionalWeights,
  evaluate,
  largestCandidate,
  rankedPositionalWeight,
  optimalStations,
  readyTasks,
  starsFor,
} from "./logic.js";

// A small textbook-style instance with a known answer.
//   A(20) -> B(15) -> D(25)
//   A(20) -> C(10) -> D
//   D -> E(18)
const fixed = {
  tasks: [
    { id: 0, label: "A", time: 20, preds: [] },
    { id: 1, label: "B", time: 15, preds: [0] },
    { id: 2, label: "C", time: 10, preds: [0] },
    { id: 3, label: "D", time: 25, preds: [1, 2] },
    { id: 4, label: "E", time: 18, preds: [3] },
  ],
  takt: 40,
  demand: SHIFT_SECONDS / 40,
  availableSec: SHIFT_SECONDS,
  totalTime: 88,
};

function feasible(inst, assignment) {
  return evaluate(inst, assignment, 0).feasible;
}

test("theoretical minimum is ceil(sum t / C)", () => {
  assert.equal(theoreticalMinStations(fixed), 3); // 88 / 40 = 2.2
});

test("positional weight adds all downstream task times", () => {
  assert.deepEqual(positionalWeights(fixed.tasks), [88, 58, 53, 43, 18]);
});

test("evaluate reports loads, efficiency and precedence violations", () => {
  const m = evaluate(fixed, [0, 0, 1, 1, 2], 3);
  assert.deepEqual(m.loads, [35, 35, 18]);
  assert.equal(m.cycleTime, 35);
  assert.equal(m.bottleneck, 0);
  assert.equal(m.idlePerUnit, 3 * 40 - 88);
  assert.ok(Math.abs(m.efficiency - 88 / 120) < 1e-12);
  assert.equal(m.violations.length, 0);
  assert.equal(m.feasible, true);

  const bad = evaluate(fixed, [1, 0, 1, 1, 2], 3); // B before its predecessor A
  assert.deepEqual(bad.violations, [{ from: 0, to: 1 }]);
  assert.equal(bad.feasible, false);

  const over = evaluate(fixed, [0, 0, 0, 1, 2], 3);
  assert.deepEqual(over.overloaded, [0]);
  assert.equal(over.feasible, false);

  const partial = evaluate(fixed, [0, null, null, null, null], 1);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.unassigned, [1, 2, 3, 4]);
});

test("ready tasks have all predecessors placed", () => {
  assert.deepEqual(readyTasks(fixed, [null, null, null, null, null]), [0]);
  assert.deepEqual(readyTasks(fixed, [0, null, null, null, null]), [1, 2]);
});

test("heuristics and the exact method agree on the fixed instance", () => {
  const rpw = rankedPositionalWeight(fixed);
  const lcr = largestCandidate(fixed);
  const opt = optimalStations(fixed);
  assert.equal(opt.stations, 3);
  assert.equal(rpw.stations, 3);
  assert.ok(feasible(fixed, rpw.assignment));
  assert.ok(feasible(fixed, lcr.assignment));
  assert.ok(feasible(fixed, opt.assignment));
});

test("optimal beats or ties every heuristic and the bound holds on random levels", () => {
  for (const spec of LEVELS) {
    for (let s = 1; s <= 25; s++) {
      const inst = generateInstance(createRng(`${spec.id}-${s}`), spec);
      assert.equal(inst.tasks.length, spec.n);
      assert.ok(inst.takt >= Math.max(...inst.tasks.map((t) => t.time)), "every task fits in one station");
      assert.equal(Math.round(inst.availableSec / inst.demand), inst.takt, "takt is a whole number of seconds");
      const lb = theoreticalMinStations(inst);
      const opt = optimalStations(inst);
      const rpw = rankedPositionalWeight(inst);
      const lcr = largestCandidate(inst);
      assert.ok(feasible(inst, opt.assignment));
      assert.ok(feasible(inst, rpw.assignment));
      assert.ok(feasible(inst, lcr.assignment));
      assert.equal(evaluate(inst, opt.assignment, 0).stationsUsed, opt.stations);
      assert.ok(lb <= opt.stations);
      assert.ok(opt.stations <= rpw.stations);
      assert.ok(opt.stations <= lcr.stations);
    }
  }
});

test("same seed gives the same instance", () => {
  const a = generateInstance(createRng("x"), LEVELS[2]);
  const b = generateInstance(createRng("x"), LEVELS[2]);
  assert.deepEqual(a, b);
});

test("stars reward reaching the optimum", () => {
  assert.equal(starsFor(4, 4), 3);
  assert.equal(starsFor(5, 4), 2);
  assert.equal(starsFor(7, 4), 1);
});

test("assumptions text matches the model", () => {
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`${SHIFT_SECONDS / 60}-minute shift`)));
  // "No task is longer than the takt time" and "takt = available time / demand" hold on every level.
  for (const spec of LEVELS) {
    for (let s = 1; s <= 25; s++) {
      const inst = generateInstance(createRng(`assume-${spec.id}-${s}`), spec);
      assert.ok(Math.max(...inst.tasks.map((t) => t.time)) <= inst.takt);
      assert.equal(inst.availableSec, SHIFT_SECONDS);
      assert.equal(inst.availableSec / inst.demand, inst.takt);
    }
  }
});
