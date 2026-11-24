import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  LC,
  LI_LIMIT,
  FM_TABLE,
  FM_RATES,
  DURATIONS,
  hm,
  vm,
  dm,
  am,
  fm,
  cm,
  analyze,
  weakest,
  riskBand,
  generateLevel,
  applyChoice,
  choiceCost,
  evaluate,
  allChoices,
  cheapestFix,
  starsFor,
  describeJob,
} from "./logic.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);
const gen = (spec, seed) => generateLevel(createRng(`lift-lab:${spec.id}:${seed}`), spec);

test("horizontal, vertical, distance and asymmetric multipliers follow the manual", () => {
  near(hm(25), 1);
  near(hm(10), 1); // closer than 25 cm counts as 25
  near(hm(50), 0.5);
  near(hm(63), 25 / 63);
  assert.equal(hm(64), 0);

  near(vm(75), 1);
  near(vm(0), 0.775);
  near(vm(175), 0.7);
  assert.equal(vm(176), 0);

  near(dm(25), 1);
  near(dm(10), 1); // shorter than 25 cm counts as 25
  near(dm(175), 0.82 + 4.5 / 175);
  assert.equal(dm(176), 0);

  near(am(0), 1);
  near(am(90), 0.712);
  near(am(135), 0.568);
  assert.equal(am(136), 0);
});

test("frequency multiplier matches Table 5", () => {
  assert.equal(FM_TABLE.length, 17);
  assert.deepEqual(FM_RATES, [0.2, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(fm(0.2, "short", 30), 1);
  assert.equal(fm(0.1, "short", 30), 1); // slower than one lift per 5 minutes counts as 0.2
  assert.equal(fm(1, "moderate", 30), 0.88);
  assert.equal(fm(5, "long", 30), 0.35);
  assert.equal(fm(8, "short", 100), 0.6);
  // The height split at 75 cm only matters at high rates.
  assert.equal(fm(9, "long", 74), 0);
  assert.equal(fm(9, "long", 75), 0.15);
  assert.equal(fm(12, "moderate", 30), 0);
  assert.equal(fm(12, "moderate", 80), 0.21);
  assert.equal(fm(15, "short", 80), 0.28);
  assert.equal(fm(16, "short", 80), 0);
  near(fm(1.5, "long", 30), 0.7); // between two rows: interpolate
  // Every column falls (or stays level) as the rate rises.
  for (let c = 1; c <= 6; c++) for (let r = 1; r < FM_TABLE.length; r++) assert.ok(FM_TABLE[r][c] <= FM_TABLE[r - 1][c]);
  // Longer work never raises the multiplier.
  for (const row of FM_TABLE) {
    assert.ok(row[3] <= row[1] && row[5] <= row[3]);
    assert.ok(row[4] <= row[2] && row[6] <= row[4]);
  }
  assert.throws(() => fm(1, "weekend", 30));
});

test("coupling multiplier matches Table 7", () => {
  assert.equal(cm("good", 30), 1);
  assert.equal(cm("good", 100), 1);
  assert.equal(cm("fair", 74), 0.95);
  assert.equal(cm("fair", 75), 1);
  assert.equal(cm("poor", 30), 0.9);
  assert.equal(cm("poor", 100), 0.9);
  assert.throws(() => cm("sticky", 30));
});

test("analyze reproduces a hand-worked job", () => {
  const a = analyze({ load: 15, H: 40, V: 30, Vdest: 100, A: 45, F: 2, duration: "long", coupling: "fair" });
  near(a.HM, 0.625);
  near(a.VM, 0.865);
  assert.equal(a.D, 70);
  near(a.DM, 0.82 + 4.5 / 70);
  near(a.AM, 0.856);
  assert.equal(a.FM, 0.65);
  assert.equal(a.CM, 0.95);
  near(a.RWL, 5.8119, 1e-3);
  near(a.LI, 2.581, 1e-3);
  assert.equal(a.li, 2.58);
  assert.equal(a.ok, false);
  assert.equal(weakest(a), "HM");
});

test("the ideal lift has a recommended weight limit equal to the load constant", () => {
  const a = analyze({ load: LC, H: 25, V: 75, Vdest: 100, A: 0, F: 0.2, duration: "short", coupling: "good" });
  near(a.RWL, LC);
  assert.equal(a.li, 1);
  assert.equal(a.ok, true);
  // Nothing can raise the limit above the load constant.
  for (const spec of LEVELS) {
    const level = gen(spec, 3);
    for (const c of allChoices(level)) assert.ok(analyze(applyChoice(level, c)).RWL <= LC + 1e-9);
  }
});

test("a zero multiplier means the lift is never acceptable", () => {
  const a = analyze({ load: 1, H: 70, V: 75, Vdest: 100, A: 0, F: 1, duration: "short", coupling: "good" });
  assert.equal(a.RWL, 0);
  assert.equal(a.LI, Infinity);
  assert.equal(a.ok, false);
});

test("risk bands", () => {
  assert.equal(riskBand(0.8).id, "ok");
  assert.equal(riskBand(1).id, "ok");
  assert.equal(riskBand(1.01).id, "raised");
  assert.equal(riskBand(3).id, "raised");
  assert.equal(riskBand(3.2).id, "high");
});

test("levels are reproducible from the seed", () => {
  for (const spec of LEVELS) {
    assert.deepEqual(gen(spec, 42), gen(spec, 42));
    const jobs = new Set();
    for (let seed = 1; seed <= 12; seed++) jobs.add(JSON.stringify(gen(spec, seed)));
    assert.ok(jobs.size > 6, `${spec.name}: different seeds give different jobs`);
  }
});

test("every generated job starts unsafe, can be fixed within budget, and the benchmark is truly cheapest", () => {
  for (const spec of LEVELS) {
    for (let seed = 1; seed <= 40; seed++) {
      const level = gen(spec, seed);
      const none = level.factors.map(() => 0);
      assert.deepEqual(applyChoice(level, none), level.base, "option 0 keeps the job as it is");
      assert.equal(choiceCost(level, none), 0);
      assert.ok(analyze(level.base).li > LI_LIMIT, `${spec.name} seed ${seed} starts above 1`);

      const best = cheapestFix(level);
      assert.ok(best && best.analysis.ok);
      assert.ok(best.cost <= level.budget);
      assert.deepEqual(best.choice, level.best.choice);
      let all = 0;
      let cost = 0;
      for (const c of allChoices(level)) {
        const e = evaluate(level, c);
        if (e.analysis.ok) assert.ok(e.cost >= best.cost, "no acceptable redesign is cheaper than the benchmark");
        assert.ok(FM_RATES.includes(e.job.F), `rate ${e.job.F} is a row of the frequency table`);
        all++;
      }
      level.factors.forEach((f, fi) => {
        assert.ok(f.options.length >= 2, `${f.name} has something to change`);
        // Every option, taken alone, makes the lift easier than it was.
        f.options.slice(1).forEach((o, k) => {
          const alone = level.factors.map((_, i) => (i === fi ? k + 1 : 0));
          assert.ok(evaluate(level, alone).analysis.LI < analyze(level.base).LI, `${spec.name} seed ${seed}: "${o.label}" helps`);
        });
        assert.equal(f.options[0].cost, 0);
        f.options.slice(1).forEach((o) => assert.ok(o.cost > 0 && o.cost % 50 === 0));
        cost += Math.max(...f.options.map((o) => o.cost));
      });
      assert.equal(all, level.factors.reduce((p, f) => p * f.options.length, 1));
      assert.ok(level.budget < cost, "buying every top option is over budget");
      assert.ok(describeJob(level).includes(`${level.base.load} kg`));
    }
  }
});

test("each level teaches what its name promises", () => {
  const idx = (level, id) => level.factors.findIndex((f) => f.id === id);
  for (let seed = 1; seed <= 40; seed++) {
    const pace = gen(LEVELS[1], seed);
    assert.ok(pace.best.choice[idx(pace, "rate")] > 0 || pace.best.choice[idx(pace, "hours")] > 0, "fast line: slow down or rotate");
    assert.equal(pace.best.choice[idx(pace, "origin")], 0, "fast line: raising the pick-up point is not the answer");

    const reach = gen(LEVELS[2], seed);
    assert.ok(reach.best.choice[idx(reach, "reach")] > 0, "long reach: bring the load closer");
    assert.equal(reach.best.choice[idx(reach, "rate")], 0);

    const heavy = gen(LEVELS[3], seed);
    assert.ok(heavy.base.load > LC);
    const li = idx(heavy, "load");
    for (const c of allChoices(heavy)) if (c[li] === 0) assert.equal(evaluate(heavy, c).analysis.ok, false, "too heavy: nothing works without changing the load");
    assert.ok(heavy.best.choice[li] > 0);
    // Half-size packs double the lifts per minute.
    const half = heavy.factors.map((_, i) => (i === li ? 1 : 0));
    assert.equal(applyChoice(heavy, half).F, heavy.base.F * 2);
    assert.equal(applyChoice(heavy, half).load, heavy.base.load / 2);

    const tight = gen(LEVELS[4], seed);
    assert.equal(tight.budget, tight.best.cost + 50);
  }
});

test("stars reward the cheapest fix", () => {
  const level = gen(LEVELS[0], 7);
  const best = level.best;
  assert.equal(starsFor(evaluate(level, best.choice), best), 3);
  assert.equal(starsFor(evaluate(level, level.factors.map(() => 0)), best), 0);
  assert.equal(starsFor({ analysis: { ok: true }, withinBudget: true, cost: best.cost * 1.2 }, best), 2);
  assert.equal(starsFor({ analysis: { ok: true }, withinBudget: true, cost: best.cost * 2 }, best), 1);
  assert.equal(starsFor({ analysis: { ok: true }, withinBudget: false, cost: best.cost }, best), 0);
});

test("the listed assumptions match the model", () => {
  assert.ok(ASSUMPTIONS.length >= 5);
  ASSUMPTIONS.forEach((a) => assert.ok(typeof a === "string" && a.trim().length > 20));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`load constant of ${LC} kg`)));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`${FM_RATES[0]} to ${FM_RATES.at(-1)} lifts per minute`)));
  DURATIONS.forEach((d) => assert.ok(ASSUMPTIONS.some((a) => a.includes(d.label))));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`An index of ${LI_LIMIT} or less`)));

  // "Analyzed at the origin": the set-down height changes only the travel distance.
  const job = { load: 12, H: 40, V: 30, Vdest: 100, A: 30, F: 2, duration: "long", coupling: "fair" };
  const a = analyze(job);
  const b = analyze({ ...job, Vdest: 160 });
  for (const k of ["HM", "VM", "AM", "FM", "CM"]) assert.equal(a[k], b[k]);
  assert.notEqual(a.DM, b.DM);

  // "Rounded to two decimals": the verdict uses the number on screen.
  assert.equal(analyze({ ...job, load: a.RWL * 1.004 }).ok, true);
  assert.equal(analyze({ ...job, load: a.RWL * 1.006 }).ok, false);

  // "Each option changes only its own input", except half-size packs.
  const owns = { reach: ["H"], origin: ["V"], dest: ["Vdest"], twist: ["A"], rate: ["F"], hours: ["duration"], grip: ["coupling"], load: ["load"] };
  for (const spec of LEVELS) {
    for (let seed = 1; seed <= 10; seed++) {
      const level = gen(spec, seed);
      for (const f of level.factors) {
        for (const o of f.options) {
          assert.deepEqual(Object.keys(o.set), owns[f.id]);
          if (o.lifts) assert.equal(f.id, "load");
        }
      }
    }
  }
});
