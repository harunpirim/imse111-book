import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  PERIOD_MIN,
  REPLICATIONS,
  STAR_RATIOS,
  sampleDay,
  generateDay,
  createSim,
  simulate,
  replicate,
  utilization,
  erlangC,
  mmc,
  hourlyCost,
  minCounters,
  bestCounters,
  formulaPlan,
  leanPlan,
  tightestPeriod,
  starsFor,
  clock,
} from "./logic.js";

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/** A hand-made day: customers arrive at the given minutes and need the given service minutes. */
function handDay(arrivals, services, extra = {}) {
  return { periods: 1, rates: [arrivals.length], mu: 12, staffCost: 20, waitCost: 15, maxCounters: 4, openHour: 9, arrivals, services, ...extra };
}

test("Erlang C matches known M/M/c results", () => {
  // One counter: the chance of waiting equals the utilization.
  assert.ok(near(erlangC(1, 0.5), 0.5));
  assert.ok(near(erlangC(1, 0.9), 0.9));
  // Two counters with offered load 1 (rho = 0.5): P(wait) = 1/3, Lq = 1/3.
  assert.ok(near(erlangC(2, 1), 1 / 3));
  const two = mmc(12, 12, 2);
  assert.ok(near(two.rho, 0.5));
  assert.ok(near(two.Lq, 1 / 3));
  assert.ok(near(two.Wq, (1 / 3 / 12) * 60));
  // M/M/1 with rho = 0.8: Lq = rho^2 / (1 - rho) = 3.2, Wq = 16 minutes at lambda = 12 per hour.
  const one = mmc(12, 15, 1);
  assert.ok(near(one.Lq, 3.2));
  assert.ok(near(one.Wq, 16));
  // Overloaded: no long-run average exists.
  assert.equal(mmc(30, 12, 2).stable, false);
  assert.equal(mmc(24, 12, 2).Wq, Infinity);
});

test("waits explode as utilization nears 100%", () => {
  const w = [0.5, 0.8, 0.9, 0.95, 0.99].map((rho) => mmc(rho * 36, 12, 3).Wq);
  for (let i = 1; i < w.length; i++) assert.ok(w[i] > w[i - 1] * 1.5);
  assert.ok(w[4] > 50 * w[0]);
  // More counters always shorten the wait and lower the utilization.
  for (let c = 3; c < 8; c++) {
    assert.ok(mmc(30, 12, c + 1).Wq < mmc(30, 12, c).Wq);
    assert.ok(utilization(30, 12, c + 1) < utilization(30, 12, c));
  }
});

test("best number of counters minimizes staff cost plus waiting cost", () => {
  assert.equal(minCounters(30, 12), 3); // 30 / 12 = 2.5
  assert.equal(minCounters(24, 12), 3); // exactly 2 counters' worth still needs a third
  for (const [lambda, mu, cs, cw] of [[30, 12, 20, 15], [60, 12, 20, 15], [44, 20, 22, 45], [20, 6, 32, 8]]) {
    const best = bestCounters(lambda, mu, cs, cw, 12);
    assert.ok(best >= minCounters(lambda, mu));
    for (let c = minCounters(lambda, mu); c <= 12; c++) {
      assert.ok(hourlyCost(lambda, mu, best, cs, cw) <= hourlyCost(lambda, mu, c, cs, cw) + 1e-9);
    }
  }
  // Costlier waiting never means fewer counters; costlier staff never means more.
  assert.ok(bestCounters(40, 12, 20, 60) >= bestCounters(40, 12, 20, 5));
  assert.ok(bestCounters(40, 12, 60, 15) <= bestCounters(40, 12, 10, 15));
});

test("simulation serves first come, first served with one line", () => {
  // Three customers arrive together at minute 0; each needs 10 minutes; one counter.
  const s = simulate(handDay([0, 0, 0], [10, 10, 10]), [1]);
  assert.deepEqual(s.waits, [0, 10, 20]);
  assert.ok(near(s.avgWait, 10));
  assert.equal(s.maxQueue, 2);
  assert.equal(s.maxWait, 20);
  // Two counters: the third customer waits for the first free counter.
  const s2 = simulate(handDay([0, 0, 0], [10, 4, 10]), [2]);
  assert.deepEqual(s2.waits, [0, 0, 4]);
});

test("costs: scheduled counter-hours, overtime, and time in line", () => {
  // One hour, 2 counters at $20: $40. One customer waits 30 minutes at $15 per hour: $7.50.
  const s = simulate(handDay([0, 0, 0], [30, 45, 10]), [2]);
  assert.deepEqual(s.waits, [0, 0, 30]);
  assert.equal(s.counterHours, 2);
  assert.ok(near(s.staffCost, 40));
  assert.ok(near(s.waitCost, 7.5));
  assert.ok(near(s.totalCost, 47.5));
  assert.ok(near(s.utilization, 85 / 120));
  // Overtime: a customer arriving at minute 50 with a 30-minute job keeps one counter 20 minutes late.
  const late = simulate(handDay([50], [30]), [1]);
  assert.ok(near(late.overtimeMin, 20));
  assert.ok(near(late.staffCost, 20 * (1 + 20 / 60)));
  assert.equal(late.endTime, 80);
});

test("counters change on the hour and a closing counter finishes its customer", () => {
  const day = handDay([0, 0, 59, 59, 61], [70, 70, 5, 5, 5], { periods: 2, rates: [4, 1] });
  // Hour 1: two counters, both busy until minute 70. Hour 2: one counter.
  const sim = createSim(day, [2, 1]);
  sim.advance(65);
  let st = sim.state();
  assert.equal(st.open, 1);
  assert.equal(st.busy, 2, "both customers are still being served after the hour");
  assert.equal(st.queue.length, 3);
  sim.advance(70);
  st = sim.state();
  assert.equal(st.busy, 1, "only one counter takes a new customer");
  sim.advance(Infinity);
  assert.equal(sim.finished, true);
  assert.deepEqual(sim.summary().waits.map((w) => Math.round(w)), [0, 0, 11, 16, 19]);
});

test("the plan is read at each hour, so later hours can change mid-run", () => {
  const day = handDay([0, 0, 0, 0, 0, 0], [40, 40, 40, 40, 40, 40], { periods: 2, rates: [6, 0] });
  const plan = [1, 1];
  const sim = createSim(day, plan);
  sim.advance(30);
  plan[1] = 4;
  sim.advance(Infinity);
  // One counter until minute 60 (starts at 0 and 40), then four counters.
  assert.deepEqual(sim.summary().waits, [0, 40, 60, 60, 60, 80]);
});

test("every customer is served and time in line adds up", () => {
  for (const spec of LEVELS) {
    for (let s = 1; s <= 8; s++) {
      const day = generateDay(createRng(`${spec.id}-${s}`), spec);
      for (const plan of [formulaPlan(day), leanPlan(day), day.rates.map(() => 1)]) {
        const r = simulate(day, plan);
        assert.equal(r.customers, day.arrivals.length);
        assert.ok(r.waits.every((w) => w >= -1e-9 && Number.isFinite(w)), "everyone is served, nobody leaves");
        assert.ok(near(r.waits.reduce((a, b) => a + b, 0) / r.customers, r.avgWait, 1e-6));
        assert.ok(r.utilization > 0 && r.utilization <= 1 + 1e-9);
        assert.ok(near(r.totalCost, r.staffCost + r.waitCost));
        assert.ok(r.endTime >= day.periods * PERIOD_MIN);
        assert.equal(r.perPeriod.reduce((a, p) => a + p.arrivals, 0), r.customers);
        // First come, first served: service starts in arrival order.
        const starts = r.waits.map((w, i) => day.arrivals[i] + w);
        for (let i = 1; i < starts.length; i++) assert.ok(starts[i] >= starts[i - 1] - 1e-9);
      }
    }
  }
});

test("stepping the simulation gives the same result as running it in one go", () => {
  const day = generateDay(createRng("step"), LEVELS[2]);
  const plan = formulaPlan(day);
  const whole = simulate(day, plan);
  const sim = createSim(day, plan);
  for (let t = 0; !sim.finished; t += 0.37) sim.advance(t);
  const stepped = sim.summary();
  assert.ok(near(stepped.totalCost, whole.totalCost, 1e-6));
  assert.deepEqual(stepped.waits.map((w) => w.toFixed(6)), whole.waits.map((w) => w.toFixed(6)));
  const st = sim.state();
  assert.ok(near(st.staffCost + st.waitCost, whole.totalCost, 1e-6), "live cost ends at the final cost");
});

test("random days follow the stated rates", () => {
  const base = { periods: 2, rates: [30, 60], mu: 12, staffCost: 20, waitCost: 15, maxCounters: 8, openHour: 9 };
  let first = 0;
  let second = 0;
  let service = 0;
  let count = 0;
  const rng = createRng("rates");
  for (let r = 0; r < 400; r++) {
    const d = sampleDay(base, rng.fork(`d${r}`));
    for (let i = 1; i < d.arrivals.length; i++) assert.ok(d.arrivals[i] > d.arrivals[i - 1], "one at a time, in order");
    first += d.arrivals.filter((t) => t < 60).length;
    second += d.arrivals.filter((t) => t >= 60).length;
    service += d.services.reduce((a, b) => a + b, 0);
    count += d.services.length;
  }
  assert.ok(Math.abs(first / 400 - 30) < 1, `hour 1 mean ${first / 400}`);
  assert.ok(Math.abs(second / 400 - 60) < 1.5, `hour 2 mean ${second / 400}`);
  assert.ok(Math.abs(service / count - 5) < 0.1, `mean service ${service / count} min`);
});

test("long simulated runs agree with the Erlang C formulas", () => {
  // 300 hours at a constant rate: the simulated average wait should be close to Wq.
  for (const [lambda, mu, c] of [[30, 12, 3], [50, 12, 5], [10, 12, 1]]) {
    const base = { periods: 300, rates: new Array(300).fill(lambda), mu, staffCost: 20, waitCost: 15, maxCounters: 8, openHour: 0 };
    const day = sampleDay(base, createRng(`long-${lambda}-${c}`));
    const sim = simulate(day, new Array(300).fill(c));
    const formula = mmc(lambda, mu, c);
    assert.ok(Math.abs(sim.avgWait - formula.Wq) / formula.Wq < 0.15, `lambda ${lambda}, c ${c}: sim ${sim.avgWait.toFixed(2)} vs formula ${formula.Wq.toFixed(2)}`);
    assert.ok(Math.abs(sim.utilization - formula.rho) < 0.02);
  }
});

test("levels: the formula plan is stable, fits the desk, and holds up against the lean plan", () => {
  for (const spec of LEVELS) {
    for (let s = 1; s <= 12; s++) {
      const rng = createRng(`lvl-${spec.id}-${s}`);
      const day = generateDay(rng, spec);
      assert.equal(day.rates.length, spec.shape.length);
      if (spec.flat) assert.equal(new Set(day.rates).size, 1);
      const best = formulaPlan(day);
      const lean = leanPlan(day);
      day.rates.forEach((r, p) => {
        assert.ok(utilization(r, day.mu, best[p]) < 1);
        assert.ok(best[p] < day.maxCounters, "the desk has a spare counter beyond the formula plan");
        assert.ok(lean[p] <= best[p]);
        assert.ok(utilization(r, day.mu, lean[p]) < 1);
      });
      const repRng = rng.fork("replications");
      const a = replicate(day, best, repRng, 60);
      const b = replicate(day, lean, repRng, 60);
      const c = replicate(day, day.rates.map(() => day.maxCounters), repRng, 60);
      // The formula treats each hour as if it ran forever, so on a short day a lean plan can tie it
      // or edge it by a percent or two (seen on levels 2 and 5). It is never clearly worse, and
      // where the lean plan runs near 100% or waiting is costly (levels 1, 3, 4) it is clearly better.
      assert.ok(a.totalCost <= b.totalCost * 1.05, `level ${spec.id}: formula ${a.totalCost} vs lean ${b.totalCost}`);
      if (["1", "3", "4"].includes(spec.id)) assert.ok(a.totalCost < b.totalCost * 0.97, `level ${spec.id}: formula ${a.totalCost} vs lean ${b.totalCost}`);
      assert.ok(a.totalCost < c.totalCost, "opening every counter all day costs more");
      // The formula's own cost forecast is close to what the simulation gives.
      const forecast = day.rates.reduce((sum, r, p) => sum + hourlyCost(r, day.mu, best[p], day.staffCost, day.waitCost), 0);
      assert.ok(Math.abs(a.totalCost / forecast - 1) < 0.08, `level ${spec.id}: simulated ${a.totalCost} vs forecast ${forecast}`);
    }
  }
});

test("tightest period is the hour closest to 100% with the fewest counters", () => {
  const day = { rates: [26, 35, 47, 12], mu: 12 };
  // Fewest counters: 3, 3, 4, 2 -> utilization 72%, 97%, 98%, 50%.
  assert.equal(tightestPeriod(day), 2);
});

test("same seed gives the same day and the same long-run averages", () => {
  const a = generateDay(createRng("x"), LEVELS[1]);
  const b = generateDay(createRng("x"), LEVELS[1]);
  assert.deepEqual(a, b);
  const plan = formulaPlan(a);
  assert.deepEqual(replicate(a, plan, createRng("r"), 20), replicate(b, plan, createRng("r"), 20));
});

test("stars and clock", () => {
  assert.equal(starsFor(100, 100), 3);
  assert.equal(starsFor(95, 100), 3);
  assert.equal(starsFor(110, 100), 2);
  assert.equal(starsFor(130, 100), 1);
  assert.deepEqual(STAR_RATIOS, [1.03, 1.15]);
  assert.equal(clock({ openHour: 9 }, 0), "9:00");
  assert.equal(clock({ openHour: 9 }, 275.4), "13:35");
});

test("assumptions text matches the model", () => {
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`every ${PERIOD_MIN} minutes`)));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`${REPLICATIONS} simulated days`)));
  assert.equal(PERIOD_MIN, 60, "rates are per hour and periods are one hour");
  // The desk opens empty and closes its doors on time.
  const day = generateDay(createRng("assume"), LEVELS[2]);
  const sim = createSim(day, formulaPlan(day));
  const st = sim.state();
  assert.equal(st.queue.length + st.busy, 0);
  assert.ok(day.arrivals.every((t) => t >= 0 && t < day.periods * PERIOD_MIN));
});
