import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  EXACT_LIMIT,
  MAP_KM,
  GRID,
  distanceMatrix,
  generateInstance,
  routeLength,
  routeLoad,
  planLength,
  evaluate,
  nearestNeighbor,
  twoOptRoute,
  twoOpt,
  localSearch,
  bestFound,
  optimalPlan,
  singleTourLength,
  minTrucks,
  tourCount,
  longestLeg,
  countCrossings,
  gap,
  starsFor,
} from "./logic.js";

/** Build an instance from [x, y, demand] rows; the first row is the depot. */
function make(rows, trucks = 1, capacity = Infinity) {
  const nodes = rows.map(([x, y, demand = 0], id) => ({ id, label: id ? String.fromCharCode(64 + id) : "Depot", x, y, demand }));
  return { nodes, n: nodes.length - 1, trucks, capacity, totalDemand: nodes.reduce((s, c) => s + c.demand, 0), d: distanceMatrix(nodes) };
}

/** Every permutation of an array (for brute-force checks). */
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

function bruteForceTour(inst) {
  const ids = inst.nodes.slice(1).map((c) => c.id);
  return Math.min(...permutations(ids).map((p) => routeLength(inst, p)));
}

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// A 30 x 40 rectangle of grid units = 3 km x 4 km, depot on one corner.
const rect = make([
  [10, 10],
  [40, 10],
  [40, 50],
  [10, 50],
]);

test("distances are straight-line, symmetric, and in km", () => {
  assert.ok(near(rect.d[0][1], 3));
  assert.ok(near(rect.d[1][2], 4));
  assert.ok(near(rect.d[0][2], 5));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) assert.equal(rect.d[i][j], rect.d[j][i]);
  assert.equal(MAP_KM / GRID, 0.1);
});

test("route length includes the trip out from and back to the depot", () => {
  assert.equal(routeLength(rect, []), 0);
  assert.ok(near(routeLength(rect, [1]), 6));
  assert.ok(near(routeLength(rect, [1, 2, 3]), 14)); // around the rectangle
  assert.ok(near(routeLength(rect, [2, 1, 3]), 5 + 4 + 5 + 4)); // crossing diagonals
  assert.ok(near(planLength(rect, [[1], [2, 3]]), 6 + 5 + 3 + 4));
});

test("evaluate reports unvisited customers, loads, and feasibility", () => {
  const inst = make(
    [
      [50, 50],
      [60, 50, 3],
      [70, 50, 4],
      [40, 50, 5],
    ],
    2,
    8,
  );
  const partial = evaluate(inst, [[1], []]);
  assert.deepEqual(partial.unvisited, [2, 3]);
  assert.equal(partial.feasible, false);
  const ok = evaluate(inst, [[1, 2], [3]]);
  assert.deepEqual(ok.loads, [7, 5]);
  assert.equal(ok.trucksUsed, 2);
  assert.equal(ok.feasible, true);
  assert.ok(near(ok.total, 4 + 2));
  const over = evaluate(inst, [[1, 2, 3], []]);
  assert.deepEqual(over.overloaded, [0]);
  assert.equal(over.feasible, false);
  assert.equal(routeLoad(inst, [1, 2, 3]), 12);
});

test("nearest neighbor always takes the closest unvisited customer", () => {
  // On a line the greedy rule zig-zags: depot at 50, customers at 49, 52, 45, 60.
  const line = make([
    [50, 50],
    [49, 50],
    [52, 50],
    [45, 50],
    [60, 50],
  ]);
  assert.deepEqual(nearestNeighbor(line), [[1, 2, 3, 4]]);
  // Best possible on a line is out and back: 2 x (60 - 45) units = 3 km.
  assert.ok(near(optimalPlan(line).length, 3));
  assert.ok(routeLength(line, nearestNeighbor(line)[0]) > 3 + 1e-6);
});

test("nearest neighbor respects capacity and sends another truck", () => {
  const inst = make(
    [
      [50, 50],
      [55, 50, 4],
      [60, 50, 4],
      [65, 50, 4],
    ],
    2,
    8,
  );
  assert.deepEqual(nearestNeighbor(inst), [[1, 2], [3]]);
});

test("2-opt removes the crossing on the rectangle", () => {
  const res = twoOptRoute(rect, [2, 1, 3]);
  assert.ok(near(routeLength(rect, res.route), 14));
  assert.ok(res.swaps >= 1);
  const same = twoOptRoute(rect, [1, 2, 3]);
  assert.equal(same.swaps, 0);
  assert.deepEqual(same.route, [1, 2, 3]);
});

test("crossings are counted per route, and 2-opt leaves none", () => {
  assert.equal(countCrossings(rect, [[2, 1, 3]]), 1);
  assert.equal(countCrossings(rect, [[1, 2, 3]]), 0);
  for (let s = 1; s <= 10; s++) {
    const inst = generateInstance(createRng(`cross-${s}`), LEVELS[1]);
    const ids = createRng(`order-${s}`).shuffle(inst.nodes.slice(1).map((c) => c.id));
    assert.equal(countCrossings(inst, twoOpt(inst, [ids]).plan), 0);
    assert.equal(countCrossings(inst, optimalPlan(inst).plan), 0);
  }
});

test("exact optimum equals brute force on small one-truck maps", () => {
  for (let s = 1; s <= 12; s++) {
    const inst = generateInstance(createRng(`bf-${s}`), { n: 7, trucks: 1, capacitated: false });
    const opt = optimalPlan(inst);
    assert.equal(opt.plan.length, 1);
    assert.ok(near(opt.length, bruteForceTour(inst), 1e-9));
    assert.ok(near(planLength(inst, opt.plan), opt.length, 1e-9));
  }
});

test("exact optimum equals brute force with two capacitated trucks", () => {
  for (let s = 1; s <= 10; s++) {
    const inst = generateInstance(createRng(`bf2-${s}`), { n: 6, trucks: 2, capacitated: true });
    const ids = inst.nodes.slice(1).map((c) => c.id);
    let best = Infinity;
    for (const p of permutations(ids)) {
      for (let cut = 1; cut <= p.length; cut++) {
        const plan = [p.slice(0, cut), p.slice(cut)];
        if (plan.some((r) => routeLoad(inst, r) > inst.capacity)) continue;
        best = Math.min(best, planLength(inst, plan));
      }
    }
    const opt = optimalPlan(inst);
    assert.ok(near(opt.length, best, 1e-9), `seed ${s}: ${opt.length} vs ${best}`);
    assert.ok(evaluate(inst, opt.plan).feasible);
  }
});

test("every level: benchmarks are feasible and ordered optimum <= 2-opt <= nearest neighbor", () => {
  for (const spec of LEVELS) {
    for (let s = 1; s <= (spec.n > EXACT_LIMIT ? 6 : 15); s++) {
      const inst = generateInstance(createRng(`${spec.id}-${s}`), spec);
      assert.equal(inst.nodes.length, spec.n + 1);
      assert.equal(inst.trucks, spec.trucks);
      const nn = nearestNeighbor(inst);
      const two = twoOpt(inst, nn);
      const mNN = evaluate(inst, nn);
      const mTwo = evaluate(inst, two.plan);
      assert.ok(mNN.feasible, "nearest neighbor fits in the fleet");
      assert.ok(mTwo.feasible);
      assert.ok(mTwo.total <= mNN.total + 1e-9);
      const best = spec.n <= EXACT_LIMIT ? optimalPlan(inst) : bestFound(inst);
      const mBest = evaluate(inst, best.plan);
      assert.ok(mBest.feasible, "benchmark plan is feasible");
      assert.ok(near(mBest.total, best.length, 1e-9));
      assert.ok(best.length <= mTwo.total + 1e-9);
      if (spec.capacitated) {
        assert.ok(Number.isFinite(inst.capacity));
        assert.ok(inst.capacity * inst.trucks >= inst.totalDemand);
        assert.ok(minTrucks(inst) <= inst.trucks);
        // Capacity can only make the best plan longer than one unlimited tour.
        assert.ok(singleTourLength(inst).length <= best.length + 1e-9);
      } else {
        assert.equal(inst.capacity, Infinity);
        assert.equal(minTrucks(inst), 1);
      }
    }
  }
});

test("local search never beats the exact optimum and never makes a plan worse", () => {
  for (let s = 1; s <= 10; s++) {
    const inst = generateInstance(createRng(`ls-${s}`), LEVELS[3]);
    const nn = nearestNeighbor(inst);
    const ls = localSearch(inst, nn);
    const opt = optimalPlan(inst);
    assert.ok(evaluate(inst, ls).feasible);
    assert.ok(planLength(inst, ls) <= planLength(inst, nn) + 1e-9);
    assert.ok(opt.length <= planLength(inst, ls) + 1e-9);
    assert.ok(opt.length <= bestFound(inst).length + 1e-9);
  }
});

test("same seed gives the same map", () => {
  const a = generateInstance(createRng("x"), LEVELS[3]);
  const b = generateInstance(createRng("x"), LEVELS[3]);
  assert.deepEqual(a, b);
});

test("helpers: tour count, longest leg, gap, stars", () => {
  assert.equal(tourCount(3), 3);
  assert.equal(tourCount(6), 360);
  assert.equal(tourCount(9), 181440);
  const leg = longestLeg(rect, [[2, 1, 3]]);
  assert.ok(near(leg.km, 5));
  assert.ok(near(gap(11, 10), 0.1));
  assert.equal(gap(9, 10), 0);
  assert.equal(starsFor(10, 10), 3);
  assert.equal(starsFor(10.1, 10), 3);
  assert.equal(starsFor(10.5, 10), 2);
  assert.equal(starsFor(12, 10), 1);
});

test("assumptions text matches the model", () => {
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`${MAP_KM} km × ${MAP_KM} km`)));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`up to ${EXACT_LIMIT} customers`)));
  for (const spec of LEVELS) {
    for (let s = 1; s <= 10; s++) {
      const inst = generateInstance(createRng(`assume-${spec.id}-${s}`), spec);
      // One depot (id 0, no demand); customers inside the map with known whole-number demands.
      assert.equal(inst.nodes[0].demand, 0);
      for (const c of inst.nodes) {
        assert.ok(c.x >= 0 && c.x <= GRID && c.y >= 0 && c.y <= GRID);
        assert.ok(Number.isInteger(c.demand));
      }
      // No single order is bigger than a truck, so no order ever needs splitting.
      assert.ok(Math.max(...inst.nodes.map((c) => c.demand)) <= inst.capacity);
      // Symmetric distances.
      for (let i = 0; i <= inst.n; i++) for (let j = 0; j <= inst.n; j++) assert.equal(inst.d[i][j], inst.d[j][i]);
    }
  }
  // Only the levels above EXACT_LIMIT use the "best found" benchmark.
  assert.deepEqual(LEVELS.filter((l) => l.n > EXACT_LIMIT).map((l) => l.id), ["5"]);
});
