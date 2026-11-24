import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  MARR_CHOICES,
  HOURS,
  PAYBACK_CUTOFF,
  UNEQUAL_LIVES,
  pvFactor,
  annuityFactor,
  cashFlows,
  npv,
  paybackYears,
  irr,
  expectedAnnual,
  projectValue,
  analyze,
  isFeasible,
  selectionValue,
  bestSelection,
  rankedSelections,
  paybackSelection,
  oneLifeSelection,
  starsFor,
  scoreRound,
  generateRound,
} from "./logic.js";

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const level = (kind) => LEVELS.find((l) => l.kind === kind);
const rounds = (kind, n = 150) => Array.from({ length: n }, (_, s) => generateRound(createRng(`t:${kind}:${s}`), level(kind)));

test("discount factors match the textbook tables", () => {
  close(pvFactor(0.1, 5), 0.6209, 1e-4);
  close(annuityFactor(0.1, 5), 3.7908, 1e-4);
  close(annuityFactor(0.08, 10), 6.7101, 1e-4);
  close(annuityFactor(0, 4), 4);
});

test("cash flows follow the end-of-year convention", () => {
  const p = { cost: 10000, annual: 3000, salvage: 2000, life: 4 };
  assert.deepEqual(cashFlows(p), [-10000, 3000, 3000, 3000, 5000]);
  // Repeated back to back: the second purchase lands in the same year as the first salvage.
  assert.deepEqual(cashFlows({ ...p, life: 2 }, { horizon: 4 }), [-10000, 3000, 5000 - 10000, 3000, 5000]);
});

test("NPV equals first cost, savings and salvage brought back to today", () => {
  const p = { cost: 20000, annual: 4500, salvage: 2000, life: 10 };
  const expected = -20000 + 4500 * annuityFactor(0.1, 10) + 2000 * pvFactor(0.1, 10);
  close(npv(cashFlows(p), 0.1), expected, 1e-6);
  close(npv(cashFlows(p), 0), -20000 + 45000 + 2000);
});

test("simple payback ignores discounting and interpolates within the year", () => {
  close(paybackYears(cashFlows({ cost: 12000, annual: 4500, salvage: 0, life: 3 })), 12000 / 4500);
  close(paybackYears(cashFlows({ cost: 10000, annual: 5000, salvage: 0, life: 4 })), 2);
  assert.equal(paybackYears(cashFlows({ cost: 10000, annual: 2000, salvage: 0, life: 4 })), Infinity);
});

test("IRR is the rate where NPV is zero, and beats the MARR exactly when NPV is positive", () => {
  const flows = cashFlows({ cost: 10000, annual: 4000, salvage: 0, life: 4 });
  const r = irr(flows);
  close(npv(flows, r), 0, 1e-4);
  close(irr([-100, 110]), 0.1, 1e-8);
  assert.equal(irr([-100, 0, 0]), null);
  for (const kind of ["single", "exclusive"]) {
    for (const round of rounds(kind, 40)) {
      for (const deal of round.deals) {
        for (const p of deal.projects) {
          const a = analyze(p, deal, round.marr);
          if (a.irr != null && Math.abs(a.npv) > 1) assert.equal(a.irr > round.marr, a.npv > 0);
        }
      }
    }
  }
});

test("budget and mutual exclusivity limit the choices", () => {
  const projects = [
    { cost: 10000, annual: 5000, salvage: 0, life: 4 },
    { cost: 20000, annual: 9000, salvage: 0, life: 4 },
    { cost: 15000, annual: 1000, salvage: 0, life: 4 },
  ];
  const independent = { mode: "independent", budget: 30000, projects };
  assert.ok(isFeasible(independent, [0, 1]));
  assert.ok(!isFeasible(independent, [0, 1, 2]));
  assert.ok(!isFeasible({ ...independent, mode: "exclusive" }, [0, 1]));
  assert.deepEqual(bestSelection(independent, 0.1).picks, [0, 1]);
  assert.deepEqual(bestSelection({ ...independent, mode: "exclusive" }, 0.1).picks, [1]);
  // Nothing worth funding: the best choice is to wait, worth exactly $0.
  const bad = { mode: "independent", budget: 30000, projects: [projects[2]] };
  assert.deepEqual(bestSelection(bad, 0.1), { picks: [], value: 0 });
});

test("the best selection is at least as good as every feasible one", () => {
  for (const kind of ["portfolio", "exclusive", "lives", "risky"]) {
    for (const round of rounds(kind, 40)) {
      for (const deal of round.deals) {
        const best = bestSelection(deal, round.marr);
        assert.ok(isFeasible(deal, best.picks));
        const ranked = rankedSelections(deal, round.marr);
        close(best.value, ranked[0].value, 1e-6);
        const pb = paybackSelection(deal);
        assert.ok(isFeasible(deal, pb));
        assert.ok(selectionValue(deal, pb, round.marr) <= best.value + 1e-6);
      }
    }
  }
});

test("payback-only thinking funds the fastest payback and nothing slower than the cutoff", () => {
  const deal = {
    mode: "independent",
    budget: 30000,
    projects: [
      { cost: 20000, annual: 5000, salvage: 0, life: 12 }, // 4.0 years: too slow, though NPV is high
      { cost: 10000, annual: 4000, salvage: 0, life: 3 }, // 2.5 years
      { cost: 20000, annual: 10000, salvage: 0, life: 2 }, // 2.0 years
      { cost: 10000, annual: 3500, salvage: 0, life: 5 }, // 2.86 years: no budget left
    ],
  };
  assert.deepEqual(paybackSelection(deal), [1, 2]);
  assert.deepEqual(paybackSelection({ ...deal, mode: "exclusive" }), [2]);
  assert.equal(PAYBACK_CUTOFF, 3);
});

test("level 1: every round has a payback trap in each direction", () => {
  for (const round of rounds("single")) {
    assert.equal(round.deals.length, 3);
    assert.ok(MARR_CHOICES.includes(round.marr));
    const facts = round.deals.map((deal) => {
      assert.equal(deal.projects.length, 1);
      assert.ok(deal.budget >= deal.projects[0].cost);
      const a = analyze(deal.projects[0], deal, round.marr);
      return { quick: a.payback <= PAYBACK_CUTOFF, good: a.npv > 0 };
    });
    assert.ok(facts.some((f) => f.quick && !f.good), "fast payback, negative NPV");
    assert.ok(facts.some((f) => !f.quick && f.good), "slow payback, positive NPV");
    const score = scoreRound(round, [[], [], []]);
    assert.ok(score.totals.best > 0 && score.totals.payback < score.totals.best);
  }
});

test("level 2: one project is clearly best, and in trap deals it is not the fastest payback or highest IRR", () => {
  let traps = 0;
  for (const round of rounds("exclusive")) {
    for (const deal of round.deals) {
      assert.equal(deal.mode, "exclusive");
      assert.equal(deal.projects.length, 3);
      assert.ok(deal.projects.every((p) => p.cost <= deal.budget));
      const ranked = rankedSelections(deal, round.marr);
      assert.equal(ranked[0].picks.length, 1);
      assert.ok(ranked[0].value - ranked[1].value >= 1500);
      const best = ranked[0].picks[0];
      const pb = paybackSelection(deal);
      assert.equal(pb.length, 1);
      if (deal.trap) {
        traps += 1;
        assert.notEqual(pb[0], best);
        const irrs = deal.projects.map((p) => irr(cashFlows(p)));
        assert.notEqual(irrs.indexOf(Math.max(...irrs)), best);
      } else assert.equal(pb[0], best);
    }
    assert.ok(round.deals.some((d) => d.trap));
  }
  assert.ok(traps > 150);
});

test("level 3: the budget binds and payback order loses to the best portfolio", () => {
  for (const round of rounds("portfolio")) {
    const [deal] = round.deals;
    assert.equal(deal.projects.length, 6);
    const total = deal.projects.reduce((s, p) => s + p.cost, 0);
    assert.ok(deal.budget < total);
    const best = bestSelection(deal, round.marr);
    assert.ok(best.picks.length >= 2);
    assert.ok(best.value - selectionValue(deal, paybackSelection(deal), round.marr) >= 2000);
  }
});

test("level 4: projects are compared over the common period", () => {
  let traps = 0;
  for (const round of rounds("lives")) {
    for (const deal of round.deals) {
      const short = deal.projects[deal.short];
      const long = deal.projects[1 - deal.short];
      assert.ok(UNEQUAL_LIVES.some(([a, b]) => a === short.life && b === long.life));
      assert.equal(deal.horizon, long.life);
      assert.equal(deal.horizon % short.life, 0);
      // Repeating a project k times is its one-life NPV counted once per purchase, each discounted to today.
      const one = npv(cashFlows(short), round.marr);
      let repeated = 0;
      for (let t = 0; t < deal.horizon; t += short.life) repeated += one * pvFactor(round.marr, t);
      close(projectValue(short, deal, round.marr), repeated, 1e-6);
      close(projectValue(long, deal, round.marr), npv(cashFlows(long), round.marr), 1e-9);
      const best = bestSelection(deal, round.marr).picks[0];
      if (deal.trap) {
        traps += 1;
        assert.equal(best, deal.short);
        assert.deepEqual(oneLifeSelection(deal, round.marr), [1 - deal.short]);
      } else assert.equal(best, 1 - deal.short);
    }
  }
  assert.ok(traps > 150);
});

test("level 5: the benchmark maximizes expected NPV over two scenarios", () => {
  for (const round of rounds("risky")) {
    assert.deepEqual(round.deals.map((d) => d.boldWins).sort(), [false, true]);
    for (const deal of round.deals) {
      assert.ok([0, 1].includes(deal.realized));
      for (const p of deal.projects) {
        assert.equal(p.scenarios.length, 2);
        close(p.scenarios[0].p + p.scenarios[1].p, 1, 1e-9);
        assert.equal(p.scenarios[0].p, deal.pStrong);
        const a = analyze(p, deal, round.marr);
        // Expected NPV is the probability-weighted average of the scenario NPVs.
        close(a.value, a.scenarios[0].p * a.scenarios[0].npv + a.scenarios[1].p * a.scenarios[1].npv, 1e-6);
        close(p.annual, expectedAnnual(p), 0.5);
      }
      const best = bestSelection(deal, round.marr).picks;
      assert.deepEqual(best, [deal.boldWins ? deal.bold : 1 - deal.bold]);
    }
  }
});

test("stars compare the value added with the best possible", () => {
  assert.equal(starsFor(10000, 10000), 3);
  assert.equal(starsFor(8000, 10000), 2);
  assert.equal(starsFor(3000, 10000), 1);
  assert.equal(starsFor(0, 10000), 0);
  assert.equal(starsFor(-500, 10000), 0);
  for (const lvl of LEVELS) {
    const round = generateRound(createRng(`stars:${lvl.id}`), lvl);
    const best = round.deals.map((d) => bestSelection(d, round.marr).picks);
    assert.equal(scoreRound(round, best).stars, 3);
    assert.ok(scoreRound(round, round.deals.map(() => [])).stars === 0);
  }
});

test("rounds are reproducible from the seed", () => {
  for (const lvl of LEVELS) {
    const a = generateRound(createRng(`seed:${lvl.id}`), lvl);
    const b = generateRound(createRng(`seed:${lvl.id}`), lvl);
    assert.deepEqual(a, b);
    assert.equal(a.deals.length, lvl.deals);
    // The analyst can't afford an NPV for every project, so players have to think.
    const projects = a.deals.reduce((s, d) => s + d.projects.length, 0);
    assert.ok(lvl.hours < projects * HOURS.npv);
    assert.ok(lvl.hours >= HOURS.npv);
  }
});

test("assumptions text matches the model", () => {
  const text = ASSUMPTIONS.join(" ");
  assert.ok(text.includes(`more than ${PAYBACK_CUTOFF} years`));
  assert.ok(text.includes(`level ${LEVELS.findIndex((l) => l.kind === "risky") + 1}`));
  // Certainty outside the risky level: only that level has scenarios.
  for (const lvl of LEVELS) {
    const round = generateRound(createRng(`assume:${lvl.id}`), lvl);
    const scenarios = round.deals.some((d) => d.projects.some((p) => p.scenarios));
    assert.equal(scenarios, lvl.kind === "risky");
    // Common period only where lives differ.
    assert.equal(round.deals.some((d) => d.horizon), lvl.kind === "lives");
    // "Projects are independent or mutually exclusive, as stated, with a fixed capital budget."
    for (const d of round.deals) {
      assert.ok(["independent", "exclusive"].includes(d.mode));
      assert.ok(d.budget > 0);
    }
  }
  // "Waiting has an NPV of $0", and money at the MARR is worth exactly what it costs.
  assert.equal(selectionValue({ mode: "independent", budget: 1, projects: [] }, [], 0.1), 0);
  close(npv([-1000, 0, 0, 1000 * 1.1 ** 3], 0.1), 0, 1e-9);
  // "Salvage arrives with the last year's savings"; "the first cost is paid today".
  const flows = cashFlows({ cost: 5000, annual: 1000, salvage: 700, life: 3 });
  assert.equal(flows[0], -5000);
  assert.equal(flows[3], 1700);
});
