import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ROUNDS,
  HORIZON,
  COST,
  computeLimits,
  generateRound,
  rulesAt,
  firstFirings,
  scoreStops,
  simulateOperator,
  normCdf,
  arlRule1,
  rule1Probability,
  starsFor,
} from "./logic.js";

// Limits with center 0 and one zone = 1, so points can be written as z-scores.
const L = { cl: 0, ucl: 3, lcl: -3, sigmaXbar: 1, rbar: 1, rucl: 2.114, rlcl: 0 };
const pts = (zs, r = 1) => zs.map((xbar) => ({ xbar, r }));

test("limits follow the X-bar and R formulas", () => {
  const setup = [
    { xbar: 10, r: 2 },
    { xbar: 12, r: 4 },
  ];
  const lim = computeLimits(setup);
  assert.equal(lim.cl, 11);
  assert.equal(lim.rbar, 3);
  assert.ok(Math.abs(lim.ucl - (11 + 0.577 * 3)) < 1e-12);
  assert.ok(Math.abs(lim.lcl - (11 - 0.577 * 3)) < 1e-12);
  assert.ok(Math.abs(lim.rucl - 2.114 * 3) < 1e-12);
  assert.equal(lim.rlcl, 0);
});

test("Rule 1 fires on a point beyond 3 sigma", () => {
  assert.deepEqual(rulesAt(pts([0, 3.2]), 1, L), ["R1"]);
  assert.deepEqual(rulesAt(pts([0, -3.5]), 1, L).includes("R1"), true);
  assert.deepEqual(rulesAt(pts([0, 2.9]), 1, L), []);
});

test("Rule 2 needs 2 of 3 beyond 2 sigma on the same side", () => {
  assert.ok(rulesAt(pts([2.5, 0, 2.2]), 2, L).includes("R2"));
  assert.ok(!rulesAt(pts([2.5, 0, -2.2]), 2, L).includes("R2"));
});

test("Rule 3 needs 4 of 5 beyond 1 sigma on the same side", () => {
  assert.ok(rulesAt(pts([1.5, 1.2, 0.2, 1.1, 1.3]), 4, L).includes("R3"));
  assert.ok(!rulesAt(pts([1.5, 1.2, 0.2, 0.9, 1.3]), 4, L).includes("R3"));
});

test("Rule 4 needs 8 in a row on one side", () => {
  const eight = pts([0.1, 0.4, 0.2, 0.3, 0.6, 0.2, 0.1, 0.5]);
  assert.ok(rulesAt(eight, 7, L).includes("R4"));
  assert.ok(!rulesAt(eight, 6, L).includes("R4"));
  assert.ok(!rulesAt(pts([0.1, 0.4, 0.2, -0.3, 0.6, 0.2, 0.1, 0.5]), 7, L).includes("R4"));
});

test("trend rule needs 6 points steadily rising or falling", () => {
  assert.ok(rulesAt(pts([-1, -0.5, 0, 0.2, 0.4, 0.9]), 5, L).includes("TR"));
  assert.ok(!rulesAt(pts([-1, -0.5, 0, 0.2, 0.1, 0.9]), 5, L).includes("TR"));
});

test("R chart rule fires on a large range", () => {
  assert.deepEqual(rulesAt([{ xbar: 0, r: 2.5 }], 0, L), ["RR"]);
});

test("a restart window ignores points before the restart", () => {
  const p = pts([0.1, 0.4, 0.2, 0.3, 0.6, 0.2, 0.1, 0.5]);
  assert.ok(!rulesAt(p, 7, L, 3).includes("R4"));
  assert.deepEqual(firstFirings(pts([0, 3.5, 0, -3.2]), L), { R1: 1 });
});

test("scoring: false alarms and scrap", () => {
  const s = scoreStops([5, 31], 30);
  assert.equal(s.falseAlarms, 1);
  assert.equal(s.detectIndex, 31);
  assert.equal(s.delay, 2);
  assert.equal(s.cost, COST.falseAlarm + 2 * COST.scrapPerSubgroup);
  const miss = scoreStops([], 30);
  assert.equal(miss.detectIndex, null);
  assert.equal(miss.cost, (HORIZON - 30) * COST.scrapPerSubgroup + COST.missed);
});

test("the rule-following operator is consistent with first firings", () => {
  for (const spec of ROUNDS) {
    for (let s = 0; s < 30; s++) {
      const round = generateRound(createRng(`${spec.id}:${s}`), spec);
      assert.equal(round.live.length, HORIZON);
      assert.ok(round.onset >= 12 && round.onset <= 40);
      const op = simulateOperator(round);
      if (op.stops.length) {
        const first = Math.min(...Object.values(firstFirings(round.live, round.limits)));
        assert.equal(op.stops[0].index, first);
      }
      op.stops.slice(0, -1).forEach((st) => assert.ok(st.falseAlarm));
      assert.ok(op.cost >= COST.scrapPerSubgroup || op.detectIndex == null);
    }
  }
});

test("big shifts are usually caught quickly by the rules", () => {
  let caught = 0;
  let delay = 0;
  for (let s = 0; s < 200; s++) {
    const op = simulateOperator(generateRound(createRng(`big:${s}`), ROUNDS[0]));
    if (op.detectIndex != null) {
      caught += 1;
      delay += op.delay;
    }
  }
  assert.ok(caught >= 195, `caught ${caught}`);
  assert.ok(delay / caught < 3, `mean delay ${delay / caught}`);
});

test("normal CDF and Rule 1 average run length", () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(rule1Probability("none") - 0.0027) < 1e-4);
  assert.ok(Math.abs(arlRule1("none") - 370.4) < 1);
  // A 1-sigma mean shift with n = 5 is a 2.24-sigma shift of X-bar.
  assert.ok(Math.abs(arlRule1("mean", 1) - 4.5) < 0.2);
  assert.ok(arlRule1("variance", 2) < 10);
});

test("stars compare the player with the rule book", () => {
  const bench = { cost: 400, detectIndex: 30 };
  assert.equal(starsFor({ cost: 300, detectIndex: 30 }, bench), 3);
  assert.equal(starsFor({ cost: 800, detectIndex: 33 }, bench), 2);
  assert.equal(starsFor({ cost: 2000, detectIndex: 50 }, bench), 1);
  assert.equal(starsFor({ cost: 4000, detectIndex: null }, bench), 0);
});
