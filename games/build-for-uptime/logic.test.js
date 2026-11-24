import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  MISSIONS,
  MAX_UNITS,
  K_NEEDED,
  COST_STEP,
  stageReliability,
  systemReliability,
  designCost,
  evaluate,
  stageOptions,
  bestDesign,
  cheapestDesign,
  simulate,
  starsFor,
  generateLevel,
  stageFormula,
} from "./logic.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);
const gen = (spec, seed) => generateLevel(createRng(`build-for-uptime:${spec.id}:${seed}`), spec);
const part = (r, cost) => ({ name: `r${r}`, r, cost });
const stage = (parts, need = 1, max = MAX_UNITS) => ({ id: "s", name: "Stage", need, max, parts });

test("one unit: the stage is as reliable as the unit", () => {
  const st = stage([part(0.9, 100)]);
  near(stageReliability(st, [0]), 0.9);
  assert.equal(stageReliability(st, []), 0);
});

test("parallel units: multiply the chances of failure", () => {
  const st = stage([part(0.9, 100), part(0.8, 50)]);
  near(stageReliability(st, [0, 0]), 1 - 0.1 * 0.1);
  near(stageReliability(st, [0, 0, 0]), 1 - 0.1 ** 3);
  near(stageReliability(st, [0, 1]), 1 - 0.1 * 0.2);
  // Diminishing returns: each extra unit adds less than the one before.
  const gain2 = stageReliability(st, [0, 0]) - stageReliability(st, [0]);
  const gain3 = stageReliability(st, [0, 0, 0]) - stageReliability(st, [0, 0]);
  assert.ok(gain3 < gain2 && gain3 > 0);
});

test("k-out-of-n stage", () => {
  const st = stage([part(0.9, 100)], 2, 4);
  assert.equal(stageReliability(st, [0]), 0);
  near(stageReliability(st, [0, 0]), 0.81); // both must work: like series
  near(stageReliability(st, [0, 0, 0]), 0.9 ** 3 + 3 * 0.9 ** 2 * 0.1); // 0.972
  near(stageReliability(st, [0, 0, 0, 0]), 1 - 0.1 ** 4 - 4 * 0.9 * 0.1 ** 3);
});

test("series system: multiply the stage reliabilities", () => {
  const level = { stages: [stage([part(0.9, 100)]), stage([part(0.95, 80)]), stage([part(0.8, 40)])], budget: 300, target: 0.6 };
  near(systemReliability(level, [[0], [0], [0]]), 0.9 * 0.95 * 0.8);
  assert.equal(designCost(level, [[0], [0], [0, 0]]), 260);
  const e = evaluate(level, [[0], [0], [0]]);
  assert.equal(e.weakest, 2);
  assert.equal(e.complete, true);
  assert.equal(e.withinBudget, true);
  assert.equal(e.meetsTarget, true);
  // A series system is never more reliable than its weakest stage.
  assert.ok(e.reliability <= Math.min(...e.stageR));
  const missing = evaluate(level, [[0], [], [0]]);
  assert.equal(missing.complete, false);
  assert.equal(missing.reliability, 0);
  assert.deepEqual(missing.missing, [0, 1, 0]);
  assert.equal(evaluate(level, [[0], [0], [0, 0, 0]]).withinBudget, true);
  assert.equal(evaluate(level, [[0, 0], [0], [0, 0]]).withinBudget, false);
});

test("stage options list every multiset of parts", () => {
  const three = stage([part(0.8, 10), part(0.9, 20), part(0.99, 40)]);
  assert.equal(stageOptions(three).length, 3 + 6 + 10); // sizes 1, 2, 3
  assert.equal(stageOptions({ ...three, max: 1 }).length, 3);
  assert.equal(stageOptions({ ...three, need: 2, max: 4 }).length, 6 + 10 + 15);
});

function bruteBest(level) {
  let best = null;
  const opts = level.stages.map(stageOptions);
  const rec = (i, r, cost, design) => {
    if (cost > level.budget) return;
    if (i === opts.length) {
      if (!best || r > best.reliability + 1e-12 || (Math.abs(r - best.reliability) <= 1e-12 && cost < best.cost)) best = { reliability: r, cost, design: design.slice() };
      return;
    }
    for (const o of opts[i]) rec(i + 1, r * o.r, cost + o.cost, [...design, o.units]);
  };
  rec(0, 1, 0, []);
  return best;
}

test("the benchmark is the most reliable design within budget (checked by brute force)", () => {
  for (const spec of LEVELS) {
    for (let seed = 1; seed <= (spec.kind === "kofn" ? 4 : 8); seed++) {
      const level = gen(spec, seed);
      const best = bestDesign(level);
      const brute = bruteBest(level);
      near(best.reliability, brute.reliability, 1e-10);
      assert.equal(best.cost, brute.cost);
      assert.ok(best.cost <= level.budget);
      near(systemReliability(level, best.design), best.reliability, 1e-10);
      assert.equal(designCost(level, best.design), best.cost);
    }
  }
});

test("generated levels are fair and reproducible", () => {
  for (const spec of LEVELS) {
    assert.deepEqual(gen(spec, 9), gen(spec, 9));
    for (let seed = 1; seed <= 30; seed++) {
      const level = gen(spec, seed);
      const cheap = evaluate(level, cheapestDesign(level));
      assert.ok(cheap.complete && cheap.withinBudget, "the cheapest design always fits");
      assert.ok(level.target > cheap.reliability, "the cheapest design misses the target");
      assert.ok(level.best.reliability >= level.target, "the target can be reached");
      assert.ok(level.target < 1 && Math.abs(level.target * 100 - Math.round(level.target * 100)) < 1e-9, "target is a whole percent");
      const allTop = level.stages.map((st) => new Array(st.need).fill(2));
      assert.ok(designCost(level, allTop) > level.budget, "the best of everything is over budget");
      for (const st of level.stages) {
        assert.equal(st.parts.length, 3);
        assert.ok(st.parts[0].r < st.parts[1].r && st.parts[1].r < st.parts[2].r);
        assert.ok(st.parts[0].cost < st.parts[1].cost && st.parts[1].cost < st.parts[2].cost);
        st.parts.forEach((p) => assert.equal(p.cost % COST_STEP, 0));
      }
      if (spec.kind === "series") {
        level.stages.forEach((st) => assert.equal(st.max, 1));
        assert.ok(level.best.design.every((d) => d.length === 1));
      }
      if (spec.kind === "spare") assert.ok(level.best.design.some((d) => d.length > 1), "the best design uses a spare");
      if (spec.kind === "tight") {
        assert.ok(level.best.design.some((d) => d.length > 1));
        assert.ok(level.best.design.some((d) => d.length === 1 && d[0] === 2), "one premium part is worth its price");
      }
      if (spec.kind === "kofn") {
        const pumps = level.stages.findIndex((st) => st.need === K_NEEDED);
        assert.ok(pumps >= 0);
        assert.equal(level.stages[pumps].max, MAX_UNITS + 1);
        assert.ok(level.best.design[pumps].length > K_NEEDED);
      } else {
        level.stages.forEach((st) => assert.equal(st.need, 1));
      }
    }
  }
});

test("the simulation agrees with the calculated reliability", () => {
  const level = gen(LEVELS[1], 5);
  const design = level.best.design;
  const a = simulate(level, design, createRng("sim-a"));
  const b = simulate(level, design, createRng("sim-a"));
  assert.deepEqual(a, b, "same seed, same missions");
  assert.equal(a.missions, MISSIONS);
  assert.equal(a.successes + a.failures, MISSIONS);
  assert.equal(a.outcomes.length, MISSIONS);
  assert.equal(a.outcomes.filter((o) => o >= 0).length, a.failures);

  const cheap = cheapestDesign(level);
  const r = systemReliability(level, cheap);
  const big = simulate(level, cheap, createRng("sim-big"), 40000);
  assert.ok(Math.abs(big.rate - r) < 0.01, `simulated ${big.rate} vs calculated ${r}`);
  // An incomplete design never completes a mission.
  assert.equal(simulate(level, level.stages.map(() => []), createRng(1), 50).successes, 0);
});

test("stars", () => {
  const level = gen(LEVELS[1], 3);
  assert.equal(starsFor(evaluate(level, level.best.design), level.best), 3);
  assert.equal(starsFor(evaluate(level, cheapestDesign(level)), level.best), 1);
  assert.equal(starsFor(evaluate(level, level.stages.map(() => [])), level.best), 0);
  assert.equal(starsFor({ complete: true, withinBudget: true, meetsTarget: true, reliability: level.best.reliability - 0.005 }, level.best), 2);
  assert.equal(starsFor({ complete: true, withinBudget: false, meetsTarget: true, reliability: 1 }, level.best), 0);
});

test("stage formulas read like the debrief", () => {
  const st = stage([part(0.9, 100), part(0.8, 50)]);
  assert.equal(stageFormula(st, []), "empty");
  assert.equal(stageFormula(st, [0]), "0.9");
  assert.equal(stageFormula(st, [0, 1]), "1 − 0.1 × 0.2 = 0.98");
  assert.equal(stageFormula({ ...st, need: 2, max: 4 }, [0]), "needs 2 units");
  assert.equal(stageFormula({ ...st, need: 2, max: 4 }, [0, 0, 0]), "at least 2 of 3 work = 0.972");
});

test("the listed assumptions match the model", () => {
  assert.ok(ASSUMPTIONS.length >= 5);
  ASSUMPTIONS.forEach((a) => assert.ok(typeof a === "string" && a.trim().length > 20));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`at most ${MAX_UNITS} units`)));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`at least ${K_NEEDED} working pumps`) && a.includes(`up to ${MAX_UNITS + 1}`)));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`${MISSIONS} independent missions`)));
  // "At most MAX_UNITS units per stage" outside the bonus stage.
  for (const spec of LEVELS) {
    const level = gen(spec, 2);
    level.stages.forEach((st) => assert.ok(st.max <= (st.need > 1 ? MAX_UNITS + 1 : MAX_UNITS)));
  }
});
