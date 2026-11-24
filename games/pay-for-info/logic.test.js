import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  PLAYS,
  emvs,
  bestBlind,
  mostLikelyAction,
  valueWithPerfectInfo,
  evpi,
  joint,
  reportProbabilities,
  posteriors,
  jointCounts,
  bestPlan,
  valueWithForecast,
  evsi,
  buys,
  policyValue,
  optimalPolicy,
  simulate,
  starsFor,
  scoreRound,
  generateRound,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const level = (kind) => LEVELS.find((l) => l.kind === kind);
const rounds = (kind, n = 200) => Array.from({ length: n }, (_, s) => generateRound(createRng(`t:${kind}:${s}`), level(kind)));

// A textbook example: build a large or small plant; demand is strong (60%) or weak (40%).
const plant = {
  actions: ["Large", "Small"],
  states: ["Strong", "Weak"],
  prior: [0.6, 0.4],
  payoff: [
    [200, -120],
    [90, 30],
  ],
  forecast: {
    reports: ["says strong", "says weak"],
    likelihood: [
      [0.8, 0.2],
      [0.3, 0.7],
    ],
  },
  price: 10,
};

test("EMV is the probability-weighted average payoff", () => {
  const e = emvs(plant);
  close(e[0], 0.6 * 200 + 0.4 * -120); // 72
  close(e[1], 0.6 * 90 + 0.4 * 30); // 66
  assert.deepEqual(bestBlind(plant), { action: 0, value: e[0] });
});

test("EVPI is what knowing the state in advance would add", () => {
  close(valueWithPerfectInfo(plant), 0.6 * 200 + 0.4 * 30); // 132
  close(evpi(plant), 132 - 72);
});

test("Bayes' rule turns priors and likelihoods into posteriors", () => {
  const j = joint(plant);
  close(j[0][0], 0.48);
  close(j[1][0], 0.12);
  const pr = reportProbabilities(plant);
  close(pr[0], 0.6);
  close(pr[1], 0.4);
  const post = posteriors(plant);
  close(post[0][0], 0.48 / 0.6); // P(strong | says strong) = 0.8
  close(post[1][0], 0.12 / 0.4); // P(strong | says weak) = 0.3
  post.forEach((row) => close(row[0] + row[1], 1));
  assert.deepEqual(jointCounts(plant), [
    [48, 12],
    [12, 28],
  ]);
});

test("EVSI is the value with the forecast minus the value without it", () => {
  assert.deepEqual(bestPlan(plant), [0, 1]);
  // says strong -> Large: 0.48*200 + 0.12*-120 = 81.6; says weak -> Small: 0.12*90 + 0.28*30 = 19.2
  close(valueWithForecast(plant), 81.6 + 19.2);
  close(evsi(plant), 100.8 - 72);
  assert.ok(evsi(plant) <= evpi(plant));
  // Ignoring the report is the same as not having it.
  close(valueWithForecast(plant, [0, 0]), emvs(plant)[0]);
  close(valueWithForecast(plant, [1, 1]), emvs(plant)[1]);
});

test("a perfect forecast is worth exactly EVPI, and a coin flip is worth nothing", () => {
  const perfect = { ...plant, forecast: { reports: ["a", "b"], likelihood: [[1, 0], [0, 1]] } };
  close(evsi(perfect), evpi(plant));
  const coin = { ...plant, forecast: { reports: ["a", "b"], likelihood: [[0.5, 0.5], [0.5, 0.5]] } };
  close(evsi(coin), 0);
  assert.equal(evsi({ ...plant, forecast: null }), 0);
});

test("the best policy buys only when the forecast is worth more than its price", () => {
  assert.deepEqual(optimalPolicy({ ...plant, price: 10 }), { buy: true, action: 0, plan: [0, 1] });
  assert.deepEqual(optimalPolicy({ ...plant, price: 40 }), { buy: false, action: 0, plan: null });
  close(policyValue({ ...plant, price: 10 }, { buy: true, action: 0, plan: [0, 1] }), 100.8 - 10);
  close(policyValue(plant, { buy: false, action: 1, plan: null }), 66);
  assert.ok(buys(12, 12) && buys(13, 12) && !buys(11, 12));
});

test("the best policy is never beaten by any other policy", () => {
  for (const kind of ["perfect", "imperfect", "worthless"]) {
    for (const m of rounds(kind, 60)) {
      const best = policyValue(m, optimalPolicy(m));
      for (const a of [0, 1]) {
        assert.ok(policyValue(m, { buy: false, action: a, plan: null }) <= best + 1e-9);
        for (const b of [0, 1]) assert.ok(policyValue(m, { buy: true, action: 0, plan: [a, b] }) <= best + 1e-9);
      }
    }
  }
});

test("the simulation's long-run average approaches the expected value", () => {
  const policies = [
    { buy: true, action: 0, plan: [0, 1] },
    { buy: false, action: 0, plan: null },
  ];
  const sim = simulate(plant, policies, createRng("long-run"), 40000);
  close(sim.results[0].mean, policyValue(plant, policies[0]), 2);
  close(sim.results[1].mean, policyValue(plant, policies[1]), 2);
  // Same seed, same plays; every policy faces the same states and reports.
  const again = simulate(plant, policies, createRng("long-run"), 50);
  assert.deepEqual(again.plays, sim.plays.slice(0, 50));
  assert.equal(again.results[0].running.length, 50);
  close(again.results[0].running[49], again.results[0].mean);
  // Frequencies match the model.
  const strong = sim.plays.filter((p) => p.state === 0).length / 40000;
  close(strong, 0.6, 0.01);
  const saysStrongGivenStrong = sim.plays.filter((p) => p.state === 0 && p.report === 0).length / sim.plays.filter((p) => p.state === 0).length;
  close(saysStrongGivenStrong, 0.8, 0.01);
});

test("level 1: the best EMV is not the best action for the most likely state", () => {
  for (const m of rounds("none")) {
    assert.equal(m.forecast, null);
    assert.equal(m.actions.length, 3);
    assert.equal(m.states.length, 3);
    assert.notEqual(mostLikelyAction(m).action, bestBlind(m).action);
    const e = emvs(m).slice().sort((a, b) => b - a);
    assert.ok(e[0] - e[1] >= 3 - 1e-9);
    assert.equal(scoreRound(m, { bid: null, action: bestBlind(m).action, plan: null }).stars, 3);
    assert.ok(scoreRound(m, { bid: null, action: mostLikelyAction(m).action, plan: null }).stars < 3);
  }
});

test("level 2: a perfect forecast is worth EVPI and is priced clearly above or below it", () => {
  let worth = 0;
  for (const m of rounds("perfect")) {
    close(evsi(m), evpi(m));
    assert.ok(evpi(m) >= 8);
    assert.ok(Number.isInteger(m.price) && m.price >= 1);
    assert.equal(m.worthIt, m.price < evpi(m));
    assert.ok(Math.abs(m.price - evpi(m)) >= 1 - 1e-9);
    assert.equal(optimalPolicy(m).buy, m.worthIt);
    worth += m.worthIt ? 1 : 0;
  }
  assert.ok(worth > 60 && worth < 140);
});

test("level 3: an imperfect forecast is worth less than EVPI", () => {
  let tempting = 0;
  for (const m of rounds("imperfect")) {
    const v = evsi(m);
    assert.ok(v >= 3 - 1e-9 && v < evpi(m));
    assert.ok(Number.isInteger(m.price) && m.price >= 1);
    assert.equal(m.worthIt, m.price < v);
    assert.ok(Math.abs(m.price - v) > 1e-6);
    assert.equal(optimalPolicy(m).buy, m.worthIt);
    if (!m.worthIt && m.price < evpi(m)) tempting += 1;
    // Whole numbers out of 100, so the Bayes table needs no decimals.
    joint(m)
      .flat()
      .forEach((p) => close(p * 100, Math.round(p * 100), 1e-6));
  }
  assert.ok(tempting > 50, "often priced under the EVPI ceiling but above its real value");
});

test("level 4: the forecast is worth nothing, because no report changes the best action", () => {
  let coins = 0;
  for (const m of rounds("worthless")) {
    close(evsi(m), 0);
    assert.ok(evpi(m) >= 8);
    const plan = bestPlan(m);
    assert.ok(plan.every((a) => a === bestBlind(m).action));
    assert.equal(optimalPolicy(m).buy, false);
    assert.ok(m.price >= 2);
    if (m.coin) {
      coins += 1;
      // A coin flip: the report is equally likely whatever the state.
      assert.deepEqual(m.forecast.likelihood[0], m.forecast.likelihood[1]);
    } else assert.ok(m.forecast.likelihood[0][0] > m.forecast.likelihood[1][0], "informative, but not decisive");
    // Bidding $0 and choosing the best blind action is perfect play.
    assert.equal(scoreRound(m, { bid: 0, action: bestBlind(m).action, plan: null }).stars, 3);
    // Buying it costs exactly its price.
    const bought = scoreRound(m, { bid: m.price, action: bestBlind(m).action, plan });
    close(bought.regret, m.price);
  }
  assert.ok(coins > 40 && coins < 140);
});

test("scoring: bid sets whether you buy, and stars need a good decision and a good valuation", () => {
  const m = { ...plant, price: 10 }; // forecast worth 28.8
  const perfect = scoreRound(m, { bid: 29, action: 0, plan: [0, 1] });
  assert.equal(perfect.you.buy, true);
  close(perfect.value.you, 90.8);
  close(perfect.regret, 0);
  assert.equal(perfect.stars, 3);
  // Right decision, but valued the forecast far too high: 2 stars.
  assert.equal(scoreRound(m, { bid: 55, action: 0, plan: [0, 1] }).stars, 2);
  // Bid too low: no forecast, lose its net value (28.8 - 10 = 18.8 of an EVPI of 60).
  const low = scoreRound(m, { bid: 5, action: 0, plan: [0, 1] });
  assert.equal(low.you.buy, false);
  close(low.regret, 18.8);
  assert.equal(low.stars, 1);
  // Bought it, then ignored it.
  close(scoreRound(m, { bid: 29, action: 0, plan: [0, 0] }).value.you, 72 - 10);
  assert.equal(starsFor({ regret: 0, scale: 60, bidGap: 0 }), 3);
  assert.equal(starsFor({ regret: 5, scale: 60 }), 2);
  assert.equal(starsFor({ regret: 40, scale: 60 }), 0);
});

test("rounds are reproducible from the seed", () => {
  for (const lvl of LEVELS) assert.deepEqual(generateRound(createRng(`seed:${lvl.id}`), lvl), generateRound(createRng(`seed:${lvl.id}`), lvl));
});

test("assumptions text matches the model", () => {
  const text = ASSUMPTIONS.join(" ");
  assert.ok(text.includes(`replays it ${PLAYS.toLocaleString("en-US")} times`));
  assert.ok(PLAYS >= 1000, "enough replays for the average to settle");
  for (const lvl of LEVELS) {
    for (let s = 0; s < 40; s++) {
      const m = generateRound(createRng(`assume:${lvl.id}:${s}`), lvl);
      // States cover every possibility: priors sum to 1; so do the reports for each state.
      close(m.prior.reduce((a, b) => a + b, 0), 1);
      assert.ok(m.prior.every((p) => p > 0));
      if (m.forecast) m.forecast.likelihood.forEach((row) => close(row.reduce((a, b) => a + b, 0), 1));
      // A known payoff for each action-state pair.
      assert.equal(m.payoff.length, m.actions.length);
      m.payoff.forEach((row) => assert.equal(row.length, m.states.length));
      // EVPI is the ceiling on any forecast's value.
      assert.ok(evsi(m) <= evpi(m) + 1e-9);
      assert.equal(Boolean(m.forecast), lvl.kind !== "none");
    }
  }
  // Information doesn't change the outcome: the same plays with or without buying.
  const policies = [
    { buy: true, action: 0, plan: [0, 0] },
    { buy: false, action: 0, plan: null },
  ];
  const sim = simulate(plant, policies, createRng("same-world"), 200);
  sim.results[0].payoffs.forEach((v, k) => close(v + plant.price, sim.results[1].payoffs[k]));
});
