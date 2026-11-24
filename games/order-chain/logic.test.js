import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import {
  ASSUMPTIONS,
  LEVELS,
  STAGES,
  N_STAGES,
  ORDER_DELAY,
  SHIP_DELAY,
  HOLD_COST,
  BACKORDER_COST,
  MAX_ORDER,
  STOCK_WEEKS,
  NAIVE_ADJUST,
  NAIVE_PIPELINE,
  FORECAST_WEEKS,
  STAR_SHARE,
  generateScenario,
  createChain,
  beginWeek,
  stageView,
  placeOrders,
  clampOrder,
  naivePolicy,
  steadyPolicy,
  baseStockPolicy,
  sharedForecast,
  bestSteadyInSeat,
  runChain,
  allNaive,
  allBaseStock,
  variance,
  summarize,
  references,
  starsFor,
} from "./logic.js";

const scenario = (spec, seed) => generateScenario(createRng(`order-chain:${spec.id}:${seed}`), spec);
const flat = (weeks = 12, base = 10, shipDelay = SHIP_DELAY) => ({
  weeks,
  base,
  after: base,
  stepWeek: weeks + 1,
  orderDelay: ORDER_DELAY,
  shipDelay,
  leadTime: ORDER_DELAY + shipDelay,
  initInv: Math.round(base * STOCK_WEEKS),
  demand: new Array(weeks).fill(base),
});
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("scenarios: steady demand with exactly one step change, reproducible from the seed", () => {
  for (const spec of LEVELS) {
    assert.deepEqual(scenario(spec, 5), scenario(spec, 5));
    for (let seed = 1; seed <= 30; seed++) {
      const scn = scenario(spec, seed);
      assert.equal(scn.demand.length, spec.weeks);
      const changes = scn.demand.filter((d, t) => t > 0 && d !== scn.demand[t - 1]).length;
      assert.equal(changes, 1, "exactly one step");
      assert.equal(scn.demand[0], scn.base);
      assert.equal(scn.demand[scn.stepWeek - 1], scn.after);
      assert.equal(scn.demand[scn.stepWeek - 2], scn.base);
      assert.ok(spec.kind === "down" ? scn.after < scn.base : scn.after > scn.base);
      assert.equal(scn.orderDelay, ORDER_DELAY);
      assert.equal(scn.shipDelay, spec.shipDelay);
      assert.equal(scn.leadTime, ORDER_DELAY + spec.shipDelay);
      assert.equal(scn.initInv, Math.round(scn.base * STOCK_WEEKS));
      assert.ok(spec.weeks >= 30 && spec.weeks <= 40);
    }
  }
});

test("with no change in demand, every rule keeps the chain perfectly steady", () => {
  const scn = flat();
  const rules = { naive: allNaive(), baseStock: allBaseStock(), steady: STAGES.map(() => steadyPolicy({ smooth: 0.3, adjust: 0.5 })) };
  for (const [name, policies] of Object.entries(rules)) {
    const state = runChain(scn, policies);
    state.history.forEach((h) => {
      assert.deepEqual(h.order, new Array(scn.weeks).fill(scn.base), `${name}: orders stay at demand`);
      assert.deepEqual(h.inv, new Array(scn.weeks).fill(scn.initInv), `${name}: stock stays put`);
      assert.equal(sum(h.backlog), 0);
    });
    assert.equal(summarize(state).teamCost, N_STAGES * scn.weeks * scn.initInv * HOLD_COST);
  }
});

test("orders and shipments take the stated delays", () => {
  const scn = flat(12, 10);
  const state = createChain(scn);
  const pulse = 7; // extra helmets ordered once, by one stage, in week 2
  for (const who of [0, N_STAGES - 1]) {
    const st = createChain(scn);
    for (let w = 1; w <= scn.weeks; w++) {
      beginWeek(st);
      placeOrders(st, STAGES.map((_, i) => scn.base + (w === 2 && i === who ? pulse : 0)));
    }
    if (who === 0) {
      // The wholesaler sees the bigger order ORDER_DELAY weeks later...
      assert.equal(st.history[1].incoming[2 + ORDER_DELAY - 1], scn.base + pulse);
      // ...ships it at once, and it reaches the retailer SHIP_DELAY weeks after that.
      assert.equal(st.history[0].arrived[2 + ORDER_DELAY + SHIP_DELAY - 1], scn.base + pulse);
      assert.equal(sum(st.history[0].arrived), scn.base * scn.weeks + pulse);
    } else {
      // The factory's production order arrives after the same total delay, whatever its size.
      assert.equal(st.history[who].arrived[2 + ORDER_DELAY + SHIP_DELAY - 1], scn.base + pulse);
    }
  }
  assert.equal(state.phase, "start");
  assert.throws(() => placeOrders(state, [1, 1, 1, 1]), /beginWeek/);
  beginWeek(state);
  assert.throws(() => beginWeek(state));
});

test("stock is conserved, shipments never exceed stock, and unfilled demand is backordered", () => {
  for (const spec of LEVELS) {
    const scn = scenario(spec, 11);
    const state = runChain(scn, allNaive());
    assert.equal(state.phase, "done");
    assert.equal(state.week, scn.weeks);
    state.history.forEach((h, i) => {
      for (let t = 0; t < scn.weeks; t++) {
        assert.ok(h.inv[t] >= 0 && h.backlog[t] >= 0 && h.shipped[t] >= 0);
        assert.ok(h.inv[t] === 0 || h.backlog[t] === 0, "never both stock and backlog");
        // net stock = starting stock + everything that arrived - everything ordered from this stage
        assert.equal(h.inv[t] - h.backlog[t], scn.initInv + sum(h.arrived.slice(0, t + 1)) - sum(h.incoming.slice(0, t + 1)));
        // backordered, not lost: shipped so far + backlog = ordered so far
        assert.equal(sum(h.shipped.slice(0, t + 1)) + h.backlog[t], sum(h.incoming.slice(0, t + 1)));
        assert.equal(h.cost[t], HOLD_COST * h.inv[t] + BACKORDER_COST * h.backlog[t]);
        assert.ok(Number.isInteger(h.order[t]) && h.order[t] >= 0 && h.order[t] <= MAX_ORDER);
      }
      assert.equal(state.stages[i].cost, sum(h.cost));
      if (i === 0) assert.deepEqual(h.incoming, scn.demand);
      // What one stage ships is what the next one down receives SHIP_DELAY weeks later.
      if (i > 0) for (let t = 0; t + scn.shipDelay < scn.weeks; t++) assert.equal(state.history[i - 1].arrived[t + scn.shipDelay], h.shipped[t]);
    });
  }
});

test("a stage's view holds only its own information", () => {
  const scn = scenario(LEVELS[0], 3);
  const state = createChain(scn);
  for (let w = 0; w < 10; w++) {
    beginWeek(state);
    const views = STAGES.map((_, i) => stageView(state, i));
    views.forEach((v, i) => {
      assert.deepEqual(Object.keys(v).sort(), ["arrived", "backlog", "costSoFar", "history", "incoming", "initInv", "inv", "lastOrder", "leadTime", "onOrder", "shipped", "stage", "startDemand", "week", "weeks"]);
      assert.equal(v.history, state.history[i]);
      assert.equal(v.inv, state.stages[i].inv);
      assert.equal(v.onOrder, state.stages[i].placed - state.stages[i].received);
    });
    placeOrders(state, views.map(naivePolicy));
  }
  // Upstream stages only learn about the demand step through the orders they receive.
  const done = runChain(scn, allNaive());
  const first = (h) => h.incoming.findIndex((x) => x !== scn.base) + 1;
  assert.equal(first(done.history[0]), scn.stepWeek);
  for (let i = 1; i < N_STAGES; i++) assert.ok(first(done.history[i]) >= first(done.history[i - 1]) + ORDER_DELAY);
});

test("clampOrder keeps orders whole and within range", () => {
  assert.equal(clampOrder(-3), 0);
  assert.equal(clampOrder(12.4), 12);
  assert.equal(clampOrder(12.5), 13);
  assert.equal(clampOrder(500), MAX_ORDER);
  assert.equal(clampOrder(NaN), 0);
  assert.equal(clampOrder("7"), 0);
});

test("the automated rule and the benchmark rule do what the text says", () => {
  const view = { incoming: 10, inv: 5, backlog: 0, initInv: 15, onOrder: 20, startDemand: 10, leadTime: 3, week: 4, history: { incoming: [10, 10, 10] } };
  // stock gap 10; usual on order 10 x (3 - 1) = 20, so no pipeline correction
  assert.equal(naivePolicy(view), Math.round(10 + NAIVE_ADJUST * 10));
  // 10 extra already on order only cancels a small part of the shortage
  assert.equal(naivePolicy({ ...view, onOrder: 30 }), Math.round(10 + NAIVE_ADJUST * (10 - NAIVE_PIPELINE * 10)));
  // backlog counts as negative stock
  assert.equal(naivePolicy({ ...view, inv: 0, backlog: 5 }), Math.round(10 + NAIVE_ADJUST * 20));
  assert.equal(naivePolicy({ ...view, inv: 200 }), 0);

  const scn = flat(10, 10);
  scn.demand = [10, 10, 10, 16, 16, 16, 16, 16, 16, 16];
  assert.equal(sharedForecast(scn, 1), 10);
  assert.equal(sharedForecast(scn, 4), (10 + 10 + 16) / FORECAST_WEEKS);
  assert.equal(sharedForecast(scn, 6), 16);
  // order up to lead time x forecast + starting stock, counting everything on order
  assert.equal(baseStockPolicy({ ...view, week: 6, inv: 5, onOrder: 30 }, { scn }), 16 * 3 + 15 - (5 + 30));
  assert.equal(baseStockPolicy({ ...view, week: 6, inv: 5, onOrder: 90 }, { scn }), 0);
});

test("local information and delays create the bullwhip; shared information tames it", () => {
  for (const spec of LEVELS) {
    for (let seed = 1; seed <= 30; seed++) {
      const scn = scenario(spec, seed);
      const naive = summarize(runChain(scn, allNaive()));
      const shared = summarize(runChain(scn, allBaseStock()));
      assert.ok(shared.teamCost < naive.teamCost, `${spec.name} seed ${seed}: benchmark costs less`);
      // Order swings grow from stage to stage in the automated chain...
      for (let i = 1; i < N_STAGES; i++) assert.ok(naive.stages[i].bullwhip > naive.stages[i - 1].bullwhip, `${spec.name} seed ${seed}: stage ${i}`);
      assert.ok(naive.stages[0].bullwhip > 1);
      // ...and far more than with shared information.
      const ratio = naive.stages[N_STAGES - 1].bullwhip / shared.stages[N_STAGES - 1].bullwhip;
      assert.ok(ratio > (spec.kind === "down" ? 1 : 3), `${spec.name} seed ${seed}: factory bullwhip ratio ${ratio}`);
      assert.equal(naive.demandMin, Math.min(scn.base, scn.after));
      assert.equal(naive.demandMax, Math.max(scn.base, scn.after));
    }
  }
});

test("summary numbers add up", () => {
  assert.equal(variance([]), 0);
  assert.equal(variance([4, 4, 4]), 0);
  assert.equal(variance([1, 3]), 1);
  const scn = scenario(LEVELS[0], 2);
  const state = runChain(scn, allNaive());
  const s = summarize(state);
  assert.equal(s.weeks, scn.weeks);
  assert.equal(s.teamCost, sum(s.stages.map((x) => x.cost)));
  s.stages.forEach((x, i) => {
    assert.equal(x.cost, x.holding + x.backorder);
    assert.equal(x.orderMax, Math.max(...state.history[i].order));
    assert.ok(Math.abs(x.bullwhip - variance(state.history[i].order) / variance(scn.demand)) < 1e-9);
  });
});

test("the steady reference never loses to the autopilot by much, and stars follow the references", () => {
  for (const spec of LEVELS) {
    const scn = scenario(spec, 4);
    for (let seat = 0; seat < N_STAGES; seat++) {
      const best = bestSteadyInSeat(scn, seat);
      const refs = references(scn, seat);
      assert.equal(refs.steady.teamCost, best.teamCost);
      assert.ok(refs.steady.teamCost <= refs.naive.teamCost * 1.02, `${spec.name} seat ${seat}`);
      assert.ok(refs.shared.teamCost < refs.naive.teamCost);
      const steady = Math.min(refs.steady.teamCost, refs.naive.teamCost);
      assert.equal(starsFor(steady, refs), 3);
      assert.equal(starsFor(refs.naive.teamCost, refs) >= 2, true);
      assert.equal(starsFor(refs.naive.teamCost * 1.3 + 1, refs), 1);
      const three = steady + (1 - STAR_SHARE) * (refs.naive.teamCost - steady);
      assert.equal(starsFor(three, refs), 3);
    }
    const team = references(scn);
    assert.equal(team.steady, null);
    assert.equal(starsFor(team.shared.teamCost, team, false), 3);
    assert.equal(starsFor(team.naive.teamCost, team, false), 2);
    assert.equal(starsFor(team.naive.teamCost + 1, team, false), 1);
  }
});

test("the listed assumptions match the model", () => {
  assert.ok(ASSUMPTIONS.length >= 7);
  ASSUMPTIONS.forEach((a) => assert.ok(typeof a === "string" && a.trim().length > 20));
  assert.equal(N_STAGES, 4);
  assert.deepEqual(STAGES.map((s) => s.id), ["retailer", "wholesaler", "distributor", "factory"]);
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`an order takes ${ORDER_DELAY} week`) && a.includes(`a shipment takes ${SHIP_DELAY} weeks`) && a.includes(`${SHIP_DELAY + 1} in the "Slow boat" level`)));
  assert.deepEqual(LEVELS.filter((l) => l.shipDelay !== SHIP_DELAY).map((l) => [l.name, l.shipDelay]), [["Slow boat", SHIP_DELAY + 1]]);
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`Holding costs $${HOLD_COST}`) && a.includes(`a backorder costs $${BACKORDER_COST}`)));
  assert.ok(BACKORDER_COST > HOLD_COST, "backorders cost more");
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`${STOCK_WEEKS} weeks of stock`)));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`from 0 to ${MAX_ORDER}`)));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`plus ${NAIVE_ADJUST * 100}% of the gap`) && a.includes(`only ${NAIVE_PIPELINE * 100}% of what they already have on order`)));
  assert.ok(ASSUMPTIONS.some((a) => a.includes(`average of the last ${FORECAST_WEEKS} weeks`)));
});
