import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  DECISION_VARIABLES,
  generateProblem,
  usage,
  profitAt,
  check,
  cornerPoints,
  solve,
  isOptimal,
  greedyPlan,
  valueOfOneMore,
  bestWithout,
  parallelConstraint,
  snapPoint,
  starsFor,
  formula,
} from "./logic.js";

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const con = (id, a, b, rhs, op = "<=") => ({ id, kind: "resource", name: `R${id}`, unit: "hours", a, b, op, rhs });

// A textbook problem with a known answer:
//   max 30x + 40y   s.t.  x + 2y <= 20,  x + y <= 12,  2x + y <= 20
// Corners: (0,0) (10,0) (8,4) (4,8) (0,10). Best: (4,8) with profit 440.
const book = { profit: [30, 40], constraints: [con(0, 1, 2, 20), con(1, 1, 1, 12), con(2, 2, 1, 20)], xMax: 14, yMax: 14 };

test("corner points are the feasible intersections, in order around the region", () => {
  const pts = cornerPoints(book).map((c) => [c.x, c.y]);
  assert.equal(pts.length, 5);
  for (const want of [[0, 0], [10, 0], [8, 4], [4, 8], [0, 10]]) {
    assert.ok(pts.some(([x, y]) => near(x, want[0]) && near(y, want[1])), `missing corner ${want}`);
  }
  // Counter-clockwise order: each turn is a left turn.
  for (let i = 0; i < pts.length; i++) {
    const [a, b, c] = [pts[i], pts[(i + 1) % pts.length], pts[(i + 2) % pts.length]];
    assert.ok((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0);
  }
});

test("solve finds the best corner by enumeration", () => {
  const sol = solve(book);
  assert.equal(sol.best, 440);
  assert.equal(sol.optimal.length, 1);
  assert.ok(near(sol.optimal[0].x, 4) && near(sol.optimal[0].y, 8));
  assert.deepEqual(sol.optimal[0].on.slice().sort(), [0, 1]);
  assert.ok(isOptimal(book, { x: 4, y: 8 }));
  assert.ok(!isOptimal(book, { x: 8, y: 4 }));
  assert.ok(!isOptimal(book, { x: 10, y: 10 }), "an infeasible plan is never optimal");
});

test("no feasible grid point beats the best corner", () => {
  const { best } = solve(book);
  for (let x = 0; x <= 14; x += 0.25) {
    for (let y = 0; y <= 14; y += 0.25) {
      if (check(book, x, y).feasible) assert.ok(profitAt(book, x, y) <= best + 1e-9);
    }
  }
});

test("check reports usage, slack, binding and violated limits", () => {
  const at = check(book, 4, 8);
  assert.equal(at.feasible, true);
  assert.deepEqual(at.binding, [0, 1]);
  assert.equal(at.rows[2].slack, 4); // 20 - (2*4 + 8)
  assert.equal(at.rows[2].state, "slack");
  assert.equal(at.profit, 440);
  const bad = check(book, 10, 6);
  assert.equal(bad.feasible, false);
  assert.deepEqual(bad.violated, [0, 1, 2]);
  assert.equal(bad.rows[1].slack, -4);
  assert.equal(usage(book.constraints[0], 3, 2), 7);
  assert.equal(check(book, -1, 2).feasible, false, "negative amounts are not allowed");
  const min = { profit: [10, 10], constraints: [con(0, 1, 1, 10), con(1, 0, 1, 3, ">=")], xMax: 12, yMax: 12 };
  assert.equal(check(min, 2, 1).feasible, false);
  assert.equal(check(min, 2, 3).rows[1].state, "binding");
  assert.equal(check(min, 2, 5).rows[1].slack, 2);
});

test("greedy maxes out the product with the higher unit profit first", () => {
  const g = greedyPlan(book);
  assert.equal(g.first, "y");
  assert.ok(near(g.x, 0) && near(g.y, 10));
  assert.equal(g.profit, 400); // less than the optimum of 440
});

test("value of one more unit: positive for binding limits, zero for limits with slack", () => {
  assert.ok(near(valueOfOneMore(book, 0), 10, 1e-6));
  assert.ok(near(valueOfOneMore(book, 1), 20, 1e-6));
  assert.ok(near(valueOfOneMore(book, 2), 0, 1e-6));
  assert.ok(bestWithout(book, 1) > solve(book).best);
});

test("a profit line parallel to a limit gives two optimal corners", () => {
  const tie = { ...book, profit: [30, 30] };
  const sol = solve(tie);
  assert.equal(sol.best, 360);
  assert.equal(sol.optimal.length, 2);
  assert.equal(parallelConstraint(tie).id, 1);
  assert.equal(parallelConstraint(book), null);
  // Every plan on the edge between the two corners is optimal too.
  assert.ok(isOptimal(tie, { x: 6, y: 6 }));
});

test("snapping pulls to corners first, then to edges, else rounds to 0.1", () => {
  const corner = snapPoint(book, 4.2, 7.9, 20, 20);
  assert.deepEqual([corner.x, corner.y, corner.snapped], [4, 8, "corner"]);
  const edge = snapPoint(book, 6.03, 5.8, 20, 20); // near x + y = 12
  assert.equal(edge.snapped, "edge");
  assert.ok(near(edge.x + edge.y, 12, 1e-9));
  assert.equal(check(book, edge.x, edge.y).rows[1].state, "binding");
  const free = snapPoint(book, 3.04, 2.96, 20, 20);
  assert.deepEqual([free.x, free.y, free.snapped], [3, 3, null]);
  const out = snapPoint(book, 99, -5, 20, 20);
  assert.ok(out.x <= book.xMax && out.y >= 0);
});

test("stars and formula text", () => {
  assert.equal(starsFor(440, 440), 3);
  assert.equal(starsFor(420, 440), 2);
  assert.equal(starsFor(300, 440), 1);
  assert.equal(formula(con(0, 1, 2, 20)), "x + 2y ≤ 20");
  assert.equal(formula(con(0, 3, 0, 9)), "3x ≤ 9");
  assert.equal(formula(con(0, 0, 1, 3, ">=")), "y ≥ 3");
});

test("every generated level is a clear, well-formed puzzle", () => {
  for (const spec of LEVELS) {
    for (let s = 1; s <= 150; s++) {
      const p = generateProblem(createRng(`${spec.id}-${s}`), spec);
      assert.ok(p.attempts >= 1, `level ${spec.id} seed ${s} fell back to the fixed problem`);
      assert.equal(p.constraints.length, spec.both + (spec.cap ? 1 : 0) + (spec.floor ? 1 : 0));
      const sol = solve(p);
      // Whole-number corners inside the plot, and every limit forms an edge of the region.
      for (const c of sol.corners) {
        assert.ok(Number.isInteger(c.x) && Number.isInteger(c.y), "corners are whole numbers");
        assert.ok(c.x <= p.xMax && c.y <= p.yMax);
      }
      for (const c of p.constraints) {
        assert.equal(sol.corners.filter((k) => k.on.includes(c.id)).length, 2, `limit ${c.name} touches two corners`);
        assert.ok(Number.isInteger(c.a) && Number.isInteger(c.b) && Number.isInteger(c.rhs) && c.rhs > 0);
      }
      assert.ok(p.profit.every((v) => Number.isInteger(v) && v > 0));
      assert.equal(sol.optimal.length, spec.tie ? 2 : 1);
      assert.equal(!!parallelConstraint(p), !!spec.tie);
      // The optimum makes both products, so the mix matters.
      for (const o of sol.optimal) assert.ok(o.x > 0 && o.y > 0);
      const g = greedyPlan(p);
      assert.ok(check(p, g.x, g.y).feasible);
      assert.ok(g.profit <= sol.best + 1e-9);
      if (!spec.floor) assert.ok(g.profit < sol.best - 1e-6, "greedy misses the optimum");
      // Binding limits are worth something at the margin; no limit is worth a negative amount.
      for (const c of p.constraints) {
        const v = valueOfOneMore(p, c.id);
        if (c.op === "<=") assert.ok(v >= -1e-9);
        else assert.ok(v <= 1e-9, "tightening a minimum order never helps");
      }
    }
  }
});

test("the minimum order binds in about half of the level 5 rounds", () => {
  const spec = LEVELS.find((l) => l.floor);
  let binding = 0;
  for (let s = 1; s <= 200; s++) {
    const p = generateProblem(createRng(`floor-${s}`), spec);
    const min = p.constraints.find((c) => c.op === ">=");
    const o = solve(p).optimal[0];
    if (o.on.includes(min.id)) {
      binding += 1;
      assert.ok(bestWithout(p, min.id) > solve(p).best, "dropping a binding minimum order raises profit");
    }
  }
  assert.ok(binding > 60 && binding < 140, `binding in ${binding} of 200`);
});

test("same seed gives the same problem", () => {
  const a = generateProblem(createRng("x"), LEVELS[2]);
  const b = generateProblem(createRng("x"), LEVELS[2]);
  assert.deepEqual(a, b);
});

test("assumptions text matches the model", () => {
  assert.equal(DECISION_VARIABLES, 2);
  assert.ok(ASSUMPTIONS[0].startsWith("Two decision variables"));
  assert.ok(ASSUMPTIONS.some((a) => a.includes("bounded")));
  for (const spec of LEVELS) {
    for (let s = 1; s <= 40; s++) {
      const p = generateProblem(createRng(`assume-${spec.id}-${s}`), spec);
      const sol = solve(p);
      // Bounded region: every corner is finite and inside the plot, and no plan on the plot's
      // outer frame is feasible (so the region can't run off to infinity).
      assert.ok(sol.corners.length >= 3);
      for (let t = 0; t <= 1; t += 0.05) {
        assert.equal(check(p, p.xMax, t * p.yMax).feasible, false);
        assert.equal(check(p, t * p.xMax, p.yMax).feasible, false);
      }
      // Proportional and additive: profit and usage are linear in the plan.
      assert.ok(near(profitAt(p, 2, 3) + profitAt(p, 1, 1), profitAt(p, 3, 4)));
      for (const c of p.constraints) assert.ok(near(usage(c, 2, 3) * 2, usage(c, 4, 6)));
      // Fractional plans are allowed: the midpoint of two corners is feasible.
      const [c0, c1] = sol.corners;
      assert.ok(check(p, (c0.x + c1.x) / 2, (c0.y + c1.y) / 2).feasible);
      // A best plan is at a corner: no feasible half-unit grid point beats it.
      for (let x = 0; x <= p.xMax; x += 0.5) {
        for (let y = 0; y <= p.yMax; y += 0.5) {
          if (check(p, x, y).feasible) assert.ok(profitAt(p, x, y) <= sol.best + 1e-9);
        }
      }
    }
  }
});
