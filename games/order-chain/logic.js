// Pure logic for Order Chain: a four-stage serial supply chain for bicycle
// helmets, simulated week by week. Includes the automated players' ordering
// rule, a steadier rule, the shared-information benchmark, and the bullwhip
// measures. No DOM access, so it runs in node --test.
//
// Vocabulary
//   stage     0 = retailer (closest to the customers) ... 3 = factory
//   scenario  { weeks, base, after, stepWeek, orderDelay, shipDelay, initInv, demand: [units per week] }
//   state     the whole chain at one moment (see createChain)
//   view      what ONE stage can see: its own stock, backlog, incoming order, arrivals, and past orders
//   policy    (view) => order quantity for this week

export const STAGES = [
  { id: "retailer", name: "Retailer", short: "R", place: "Bike shop" },
  { id: "wholesaler", name: "Wholesaler", short: "W", place: "Regional wholesaler" },
  { id: "distributor", name: "Distributor", short: "D", place: "National distributor" },
  { id: "factory", name: "Factory", short: "F", place: "Helmet factory" },
];
export const N_STAGES = STAGES.length;

export const ORDER_DELAY = 1; // weeks for an order to reach the supplier
export const SHIP_DELAY = 2; // weeks for a shipment to arrive (3 in the "Slow boat" level)
export const HOLD_COST = 1; // $ per helmet in stock per week
export const BACKORDER_COST = 2; // $ per helmet owed to a customer per week
export const MAX_ORDER = 99; // largest order a stage can place in one week
export const STOCK_WEEKS = 1.5; // starting stock, in weeks of starting demand
export const NAIVE_ADJUST = 0.4; // share of the stock gap the automated players try to close each week
export const NAIVE_PIPELINE = 0.3; // share of what's already on order that the automated players count
export const FORECAST_WEEKS = 3; // the benchmark forecasts demand as the average of this many weeks

const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;
export { usd };

export const LEVELS = [
  { id: "1", name: "Trail opens", blurb: "demand steps up", kind: "up", weeks: 30, shipDelay: SHIP_DELAY },
  { id: "2", name: "Season ends", blurb: "demand steps down", kind: "down", weeks: 30, shipDelay: SHIP_DELAY },
  { id: "3", name: "Slow boat", blurb: "longer shipping delay", kind: "up", weeks: 36, shipDelay: SHIP_DELAY + 1 },
  { id: "4", name: "Viral video", blurb: "a big jump in demand", kind: "jump", weeks: 36, shipDelay: SHIP_DELAY },
];

const STORIES = {
  up: "A new bike trail opens and more riders want helmets.",
  down: "The riding season ends and fewer riders buy helmets.",
  jump: "A safety video goes viral and helmet sales jump.",
};

/** Build a scenario from the seeded generator: steady demand with exactly one step change. */
export function generateScenario(rng, spec) {
  const base = spec.kind === "down" ? rng.pick([12, 14, 16]) : rng.pick([8, 10, 12]);
  const after = spec.kind === "jump" ? Math.round(base * 1.8) : spec.kind === "down" ? Math.round(base * rng.pick([0.5, 0.6])) : Math.round(base * rng.pick([1.4, 1.5, 1.6]));
  const stepWeek = rng.int(4, 7); // first week of the new demand (1-based)
  const demand = Array.from({ length: spec.weeks }, (_, t) => (t + 1 >= stepWeek ? after : base));
  return {
    kind: spec.kind,
    story: STORIES[spec.kind],
    weeks: spec.weeks,
    base,
    after,
    stepWeek,
    orderDelay: ORDER_DELAY,
    shipDelay: spec.shipDelay,
    leadTime: ORDER_DELAY + spec.shipDelay,
    initInv: Math.round(base * STOCK_WEEKS),
    demand,
  };
}

/**
 * A chain in steady state: every stage holds the starting stock, and every
 * pipeline is full of the starting demand, so nothing changes until demand does.
 */
export function createChain(scn) {
  return {
    scn,
    week: 0, // weeks completed
    phase: "start", // "start" -> beginWeek() -> "decide" -> placeOrders() -> "start" ... -> "done"
    stages: STAGES.map(() => ({
      inv: scn.initInv,
      backlog: 0,
      inbound: new Array(scn.shipDelay).fill(scn.base), // shipments on their way to this stage
      orderOut: new Array(scn.orderDelay).fill(scn.base), // this stage's orders on their way to its supplier
      placed: scn.base * (scn.orderDelay + scn.shipDelay), // everything ordered so far (starts with what's in the pipelines)
      received: 0,
      cost: 0,
    })),
    history: STAGES.map(() => ({ incoming: [], arrived: [], shipped: [], inv: [], backlog: [], order: [], cost: [] })),
    now: null, // this week's incoming / arrived / shipped per stage, while phase is "decide"
  };
}

/**
 * First half of a week, the same for everyone and with no decisions:
 * 1. shipments that were on their way arrive, 2. incoming orders arrive,
 * 3. each stage ships as much of (incoming order + backlog) as its stock allows.
 */
export function beginWeek(state) {
  if (state.phase !== "start") throw new Error("beginWeek: week already in progress or game over");
  const { scn, stages } = state;
  const arrived = stages.map((s) => s.inbound.shift());
  stages.forEach((s, i) => {
    s.inv += arrived[i];
    s.received += arrived[i];
  });
  // Orders travel up the chain; the retailer's "order" is customer demand.
  const incoming = stages.map((s, i) => (i === 0 ? scn.demand[state.week] : stages[i - 1].orderOut.shift()));
  // The factory's own order is a production order: unlimited material, so it is always started in full.
  const factory = stages[N_STAGES - 1];
  factory.inbound.push(factory.orderOut.shift());
  const shipped = stages.map((s, i) => {
    const want = incoming[i] + s.backlog;
    const ship = Math.min(s.inv, want);
    s.inv -= ship;
    s.backlog = want - ship;
    if (i > 0) stages[i - 1].inbound.push(ship);
    return ship;
  });
  state.now = { incoming, arrived, shipped };
  state.phase = "decide";
  return state;
}

/** What stage i can see right now. Nothing here comes from another stage's books. */
export function stageView(state, i) {
  const s = state.stages[i];
  const h = state.history[i];
  return {
    stage: i,
    week: state.week + 1,
    weeks: state.scn.weeks,
    incoming: state.now ? state.now.incoming[i] : null,
    arrived: state.now ? state.now.arrived[i] : null,
    shipped: state.now ? state.now.shipped[i] : null,
    inv: s.inv,
    backlog: s.backlog,
    onOrder: s.placed - s.received, // own bookkeeping: ordered but not yet arrived
    lastOrder: h.order.length ? h.order[h.order.length - 1] : state.scn.base,
    costSoFar: s.cost,
    history: h,
    // Known to every stage from the start (the chain's own setup, not live data):
    initInv: state.scn.initInv,
    leadTime: state.scn.leadTime,
    startDemand: state.scn.base,
  };
}

export function clampOrder(q) {
  if (!Number.isFinite(q)) return 0;
  return Math.max(0, Math.min(MAX_ORDER, Math.round(q)));
}

/** Second half of a week: every stage places its order, costs are charged, and the week ends. */
export function placeOrders(state, orders) {
  if (state.phase !== "decide") throw new Error("placeOrders: call beginWeek first");
  const { stages, history, now } = state;
  stages.forEach((s, i) => {
    const q = clampOrder(orders[i]);
    s.orderOut.push(q);
    s.placed += q;
    const cost = HOLD_COST * s.inv + BACKORDER_COST * s.backlog;
    s.cost += cost;
    const h = history[i];
    h.incoming.push(now.incoming[i]);
    h.arrived.push(now.arrived[i]);
    h.shipped.push(now.shipped[i]);
    h.inv.push(s.inv);
    h.backlog.push(s.backlog);
    h.order.push(q);
    h.cost.push(cost);
  });
  state.week += 1;
  state.now = null;
  state.phase = state.week >= state.scn.weeks ? "done" : "start";
  return state;
}

// ---- Ordering rules ------------------------------------------------------------

/**
 * The automated players. A typical, well-meaning rule: order what was just
 * ordered from you, plus part of the gap between your starting stock and your
 * stock now (backlog counts as negative stock). It counts only a small part
 * of what is already on order, so it tends to order the same shortage again.
 */
export function naivePolicy(view) {
  const net = view.inv - view.backlog;
  // At decision time this week's shipment has just arrived, so a stage in
  // balance has (lead time - 1) weeks of demand on order.
  const usualOnOrder = view.startDemand * (view.leadTime - 1);
  const gap = view.initInv - net + NAIVE_PIPELINE * (usualOnOrder - view.onOrder);
  return clampOrder(view.incoming + NAIVE_ADJUST * gap);
}

/**
 * A steadier rule that still uses only the stage's own information: smooth
 * the incoming orders into a forecast, then close part of the gap in stock AND
 * in what is on order, counting everything already ordered.
 *   smooth  weight on the newest incoming order (1 = no smoothing)
 *   adjust  share of the gap closed each week
 */
export function steadyPolicy({ smooth, adjust }) {
  return (view) => {
    let forecast = view.startDemand;
    for (const x of [...view.history.incoming, view.incoming]) forecast += smooth * (x - forecast);
    const net = view.inv - view.backlog;
    const gap = view.initInv - net + (forecast * (view.leadTime - 1) - view.onOrder);
    return clampOrder(forecast + adjust * gap);
  };
}
export const STEADY_GRID = { smooth: [0.1, 0.2, 0.3, 0.5, 1], adjust: [0.1, 0.2, 0.3, 0.5, 0.75, 1] };

/**
 * "A steady hand in your seat": the best steady rule for one seat, with the
 * automated players everywhere else, found by trying every setting in
 * STEADY_GRID. It is a hindsight reference, not something a player could know.
 */
export function bestSteadyInSeat(scn, seat) {
  let best = null;
  for (const smooth of STEADY_GRID.smooth) {
    for (const adjust of STEADY_GRID.adjust) {
      const policy = steadyPolicy({ smooth, adjust });
      const state = runChain(scn, STAGES.map((_, i) => (i === seat ? policy : naivePolicy)));
      const teamCost = state.stages.reduce((c, st) => c + st.cost, 0);
      if (!best || teamCost < best.teamCost) best = { smooth, adjust, teamCost, state };
    }
  }
  return best;
}

/**
 * The benchmark: a base-stock (order-up-to) rule with shared demand
 * information. Every stage sees real customer demand, forecasts it as the
 * average of the last few weeks, and orders up to
 * (lead time x forecast + starting stock), counting everything already on order.
 */
export function sharedForecast(scn, week) {
  // week is 1-based; demand before week 1 was the starting demand
  let sum = 0;
  for (let k = 0; k < FORECAST_WEEKS; k++) {
    const t = week - 1 - k;
    sum += t >= 0 ? scn.demand[t] : scn.base;
  }
  return sum / FORECAST_WEEKS;
}
export function baseStockPolicy(view, state) {
  const forecast = sharedForecast(state.scn, view.week);
  const target = forecast * view.leadTime + view.initInv;
  const position = view.inv - view.backlog + view.onOrder;
  return clampOrder(target - position);
}

/** Play a whole game with one policy per stage: (view, state) => order. */
export function runChain(scn, policies) {
  const state = createChain(scn);
  while (state.phase !== "done") {
    beginWeek(state);
    placeOrders(
      state,
      STAGES.map((_, i) => policies[i](stageView(state, i), state)),
    );
  }
  return state;
}

export const allNaive = () => STAGES.map(() => naivePolicy);
export const allBaseStock = () => STAGES.map(() => baseStockPolicy);

// ---- Measures ----------------------------------------------------------------

export function variance(xs) {
  if (!xs.length) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
}

/**
 * Summary of a finished (or running) game: cost per stage and for the team,
 * and the bullwhip at each stage = variance of its orders / variance of
 * customer demand over the same weeks.
 */
export function summarize(state) {
  const weeks = state.week;
  const demand = state.scn.demand.slice(0, weeks);
  const dVar = variance(demand);
  const stages = state.history.map((h, i) => {
    const oVar = variance(h.order);
    return {
      cost: state.stages[i].cost,
      holding: HOLD_COST * h.inv.reduce((a, b) => a + b, 0),
      backorder: BACKORDER_COST * h.backlog.reduce((a, b) => a + b, 0),
      orderMin: h.order.length ? Math.min(...h.order) : 0,
      orderMax: h.order.length ? Math.max(...h.order) : 0,
      orderVar: oVar,
      bullwhip: dVar > 0 ? oVar / dVar : 0,
      peakStock: h.inv.length ? Math.max(...h.inv) : 0,
      peakBacklog: h.backlog.length ? Math.max(...h.backlog) : 0,
    };
  });
  return {
    weeks,
    teamCost: stages.reduce((s, x) => s + x.cost, 0),
    stages,
    demandMin: Math.min(...demand),
    demandMax: Math.max(...demand),
    demandVar: dVar,
  };
}

/** The three reference games for a scenario, for the results screen. */
export function references(scn, seat = null) {
  const naive = summarize(runChain(scn, allNaive()));
  const shared = summarize(runChain(scn, allBaseStock()));
  const steady = seat == null ? null : bestSteadyInSeat(scn, seat);
  return { naive, shared, steady: steady && { ...summarize(steady.state), smooth: steady.smooth, adjust: steady.adjust } };
}

/**
 * Stars. One seat can only do so much, so a solo player is scored against two
 * games on the same demand: the all-automated chain ("autopilot in your
 * seat") and the best steady rule in that seat.
 *   3 = the team captured most of what a steady hand gains (or is within 5% of it)
 *   2 = no worse than leaving the seat on autopilot
 *   1 = the game was finished
 * A pass-and-play team of four is scored against the automated chain and the
 * shared-information benchmark: 3 = at least halfway to the benchmark.
 */
export const STAR_SHARE = 0.65; // share of the steady rule's gain needed for 3 stars
export function starsFor(teamCost, refs, solo = true) {
  const naive = refs.naive.teamCost;
  if (solo) {
    const steady = Math.min(refs.steady.teamCost, naive);
    if (teamCost <= Math.max(steady + (1 - STAR_SHARE) * (naive - steady), steady * 1.05)) return 3;
    if (teamCost <= Math.max(naive, steady * 1.25)) return 2;
    return 1;
  }
  const shared = refs.shared.teamCost;
  if (teamCost <= (shared + naive) / 2) return 3;
  if (teamCost <= naive) return 2;
  return 1;
}

/**
 * The model's simplifying assumptions, shown on the intro and results screens.
 * Numbers come from the constants above so the text can't drift from the code.
 */
export const ASSUMPTIONS = [
  "A serial chain with four stages (retailer, wholesaler, distributor, factory). Each stage has one supplier and one customer, and there is one product.",
  "Each player sees only their own inventory, incoming orders, arriving shipments and past orders. Customer demand isn't shared up the chain, and this, with the delays, is what creates the bullwhip.",
  `Fixed delays: an order takes ${ORDER_DELAY} week to reach the supplier and a shipment takes ${SHIP_DELAY} weeks to arrive (${SHIP_DELAY + 1} in the "Slow boat" level). Orders can't be cancelled.`,
  `The factory has unlimited capacity and raw material. Its production order takes as long as any other order plus shipment.`,
  `Unfilled demand is backordered, not lost. Holding costs ${usd(HOLD_COST)} and a backorder costs ${usd(BACKORDER_COST)} per helmet per week. Ordering and shipping are free.`,
  `Customer demand is steady except for one step change. The chain starts in balance, with ${STOCK_WEEKS} weeks of stock at every stage.`,
  `Orders are whole helmets from 0 to ${MAX_ORDER}, placed once a week by every stage at the same moment.`,
  `The automated players order what was just ordered from them, plus ${NAIVE_ADJUST * 100}% of the gap between their starting stock and their stock now. They count only ${NAIVE_PIPELINE * 100}% of what they already have on order.`,
  "The team's goal is the lowest total chain cost.",
  `The benchmark is the same demand with all four stages using a base-stock (order-up-to) rule and shared demand information: each forecasts real customer demand as the average of the last ${FORECAST_WEEKS} weeks and counts what it already has on order.`,
];
