// Pure logic for Build for Uptime: series and parallel reliability, design
// cost, the most reliable design within budget, and a Monte Carlo run of many
// missions. No DOM access, so it runs in node --test.
//
// Vocabulary
//   part     { name, r, cost }: reliability r = chance it works for a whole mission
//   stage    one function the system needs: { id, name, need, max, parts: [part, part, part] }
//            the stage works when at least `need` of its installed units work
//   design   array with one entry per stage: a list of part indices (the units installed)
//   level    { stages, budget, target, mission }

export const MISSIONS = 200; // simulated missions per run
export const MAX_UNITS = 3; // most units a stage can hold (unless a level says otherwise)
export const K_NEEDED = 2; // units that must work in the bonus level's pump stage
export const COST_STEP = 10; // every price is a multiple of this many dollars

const usd = (x) => `$${x.toLocaleString("en-US")}`;
export { usd };

export const LEVELS = [
  { id: "1", name: "All in a row", blurb: "3 stages · no spares", kind: "series" },
  { id: "2", name: "Add a spare", blurb: "4 stages · redundancy", kind: "spare" },
  { id: "3", name: "Tight budget", blurb: "price isn't quality", kind: "tight" },
  { id: "4", name: "Two of three", blurb: `bonus · needs ${K_NEEDED} pumps`, kind: "kofn" },
];

/**
 * Reliability of one stage: the chance that at least `need` of its units work.
 * Units fail independently. With need = 1 this is a parallel block:
 * 1 - (1 - r1)(1 - r2)... With one unit it is just that unit's reliability.
 */
export function stageReliability(stage, units) {
  const rs = units.map((u) => stage.parts[u].r);
  const need = stage.need || 1;
  if (rs.length < need) return 0;
  // dist[j] = chance that exactly j of the units seen so far work
  let dist = [1];
  for (const r of rs) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((p, j) => {
      next[j] += p * (1 - r);
      next[j + 1] += p * r;
    });
    dist = next;
  }
  return dist.slice(need).reduce((s, p) => s + p, 0);
}

/** Series system: the product of the stage reliabilities. */
export function systemReliability(level, design) {
  return level.stages.reduce((p, st, i) => p * stageReliability(st, design[i] || []), 1);
}

export function designCost(level, design) {
  return level.stages.reduce((s, st, i) => s + (design[i] || []).reduce((c, u) => c + st.parts[u].cost, 0), 0);
}

export function evaluate(level, design) {
  const stageR = level.stages.map((st, i) => stageReliability(st, design[i] || []));
  const reliability = stageR.reduce((p, r) => p * r, 1);
  const cost = designCost(level, design);
  const missing = level.stages.map((st, i) => Math.max(0, (st.need || 1) - (design[i] || []).length));
  const complete = missing.every((m) => m === 0);
  let weakest = -1;
  stageR.forEach((r, i) => {
    if (complete && (weakest < 0 || r < stageR[weakest])) weakest = i;
  });
  return {
    stageR,
    reliability,
    cost,
    complete,
    missing,
    weakest,
    withinBudget: cost <= level.budget,
    meetsTarget: complete && reliability >= level.target - 1e-12,
    units: design.reduce((s, d) => s + (d || []).length, 0),
  };
}

/** Every way to fill one stage: multisets of parts from `need` up to `max` units. */
export function stageOptions(stage) {
  const out = [];
  const need = stage.need || 1;
  const rec = (start, units) => {
    if (units.length >= need) out.push({ units: units.slice(), r: stageReliability(stage, units), cost: units.reduce((c, u) => c + stage.parts[u].cost, 0) });
    if (units.length === stage.max) return;
    for (let p = start; p < stage.parts.length; p++) {
      units.push(p);
      rec(p, units);
      units.pop();
    }
  };
  rec(0, []);
  return out;
}

/**
 * The most reliable design that fits the budget, by exhaustive search.
 * Each stage's options are enumerated, then a table over the budget combines
 * the stages (the system reliability is a product, so the best design for a
 * budget is built from the best designs of smaller budgets). Ties on
 * reliability go to the cheaper design.
 */
export function bestDesign(level, budget = level.budget) {
  const B = Math.floor(budget / COST_STEP);
  // table[b] = best { r, cost, design } using the stages so far with at most b budget steps
  let table = Array.from({ length: B + 1 }, () => ({ r: 1, cost: 0, design: [] }));
  for (const stage of level.stages) {
    const opts = stageOptions(stage);
    const next = new Array(B + 1).fill(null);
    for (let b = 0; b <= B; b++) {
      for (const o of opts) {
        const c = o.cost / COST_STEP;
        if (c > b || !table[b - c]) continue;
        const prev = table[b - c];
        const r = prev.r * o.r;
        const cost = prev.cost + o.cost;
        const cur = next[b];
        if (!cur || r > cur.r + 1e-12 || (Math.abs(r - cur.r) <= 1e-12 && cost < cur.cost)) next[b] = { r, cost, design: [...prev.design, o.units] };
      }
    }
    table = next;
  }
  const best = table[B];
  return best ? { design: best.design, reliability: best.r, cost: best.cost } : null;
}

/** The cheapest complete design: the cheapest part in every stage, with no spares. */
export function cheapestDesign(level) {
  return level.stages.map((st) => {
    const p = st.parts.reduce((b, part, i) => (part.cost < st.parts[b].cost ? i : b), 0);
    return new Array(st.need || 1).fill(p);
  });
}

/**
 * Run many missions. In each one every installed unit works with probability
 * r, independently; a stage works if enough of its units work; the system
 * works if every stage works. Returns the outcomes and which stage failed.
 */
export function simulate(level, design, rng, missions = MISSIONS) {
  const outcomes = [];
  const failsByStage = level.stages.map(() => 0);
  let successes = 0;
  for (let m = 0; m < missions; m++) {
    let ok = true;
    let first = -1;
    level.stages.forEach((st, i) => {
      let working = 0;
      for (const u of design[i] || []) if (rng.next() < st.parts[u].r) working++;
      if (working < (st.need || 1)) {
        failsByStage[i]++;
        if (ok) first = i;
        ok = false;
      }
    });
    outcomes.push(ok ? -1 : first); // -1 = mission completed, else index of the first failed stage
    if (ok) successes++;
  }
  return { missions, successes, failures: missions - successes, failsByStage, outcomes, rate: successes / missions };
}

/** Stars: 3 = as reliable as the best design, 2 = meets the target, 1 = works within budget, 0 = incomplete or over budget. */
export function starsFor(result, best) {
  if (!result.complete || !result.withinBudget) return 0;
  if (result.reliability >= best.reliability - 5e-4) return 3;
  if (result.meetsTarget) return 2;
  return 1;
}

// ---- Level generation ---------------------------------------------------------

const STAGE_KINDS = {
  power: { name: "Power", parts: ["Old grid line", "Diesel generator", "Solar with battery"] },
  pump: { name: "Pump", parts: ["Rebuilt pump", "Standard pump", "Heavy-duty pump"] },
  controller: { name: "Controller", parts: ["Basic timer", "Field controller", "Sealed controller"] },
  sensor: { name: "Soil sensor", parts: ["Budget probe", "Field probe", "Sealed probe"] },
  valve: { name: "Valve", parts: ["Plastic valve", "Brass valve", "Steel valve"] },
};

const SCENARIOS = {
  series: { system: "a garden drip line", mission: "one summer", stages: ["pump", "controller", "valve"] },
  spare: { system: "a center-pivot irrigator", mission: "one growing season", stages: ["power", "pump", "controller", "sensor"] },
  tight: { system: "a remote pasture well", mission: "one grazing season", stages: ["power", "pump", "controller", "valve"] },
  kofn: { system: "a pumping station where two pumps must run at once", mission: "one growing season", stages: ["power", "pump", "controller", "sensor"] },
};

const step = (rng, lo, hi) => COST_STEP * rng.int(Math.round(lo / COST_STEP), Math.round(hi / COST_STEP));

function draftStage(rng, kindId, levelKind) {
  const kind = STAGE_KINDS[kindId];
  const basicR = rng.pick([0.8, 0.85, 0.9]);
  const midR = rng.pick([0.92, 0.94, 0.95, 0.96]);
  const topR = rng.pick([0.98, 0.99]);
  const basicCost = step(rng, 60, 140);
  // In the tight level some premium parts are bargains and some are overpriced,
  // so "buy the best" and "buy the cheapest twice" both fail somewhere.
  const bargain = levelKind === "tight" && rng.chance(0.5);
  const midCost = step(rng, basicCost * 1.4, basicCost * 2.1);
  const topCost = bargain ? step(rng, basicCost * 1.5, basicCost * 1.9) : step(rng, basicCost * 2.6, basicCost * 3.8);
  const parts = [
    { name: kind.parts[0], r: basicR, cost: basicCost },
    { name: kind.parts[1], r: midR, cost: Math.max(midCost, basicCost + COST_STEP) },
    { name: kind.parts[2], r: topR, cost: Math.max(topCost, midCost + COST_STEP) },
  ];
  const stage = { id: kindId, name: kind.name, need: 1, max: levelKind === "series" ? 1 : MAX_UNITS, parts };
  if (levelKind === "kofn" && kindId === "pump") {
    stage.need = K_NEEDED;
    stage.max = MAX_UNITS + 1;
  }
  return stage;
}

function draft(rng, kind) {
  const sc = SCENARIOS[kind];
  const stages = sc.stages.map((id) => draftStage(rng, id, kind));
  const level = { kind, system: sc.system, mission: sc.mission, stages, budget: 0, target: 0 };
  const cheapest = designCost(level, cheapestDesign(level));
  const allTop = stages.reduce((s, st) => s + (st.need || 1) * st.parts[2].cost, 0);
  const share = { series: rng.uniform(0.45, 0.7), spare: rng.uniform(0.35, 0.6), tight: rng.uniform(0.25, 0.45), kofn: rng.uniform(0.35, 0.6) }[kind];
  level.budget = COST_STEP * Math.round((cheapest + share * (allTop - cheapest)) / COST_STEP);
  return level;
}

function accept(level) {
  const best = bestDesign(level);
  if (!best) return false;
  const naive = evaluate(level, cheapestDesign(level));
  const allTop = level.stages.reduce((s, st) => s + (st.need || 1) * st.parts[2].cost, 0);
  if (allTop <= level.budget) return false; // "buy the best of everything" must not fit
  if (best.reliability - naive.reliability < 0.08) return false; // design choices must matter
  // Target: a round number a little below the best, so it takes a good design to reach it.
  level.target = Math.floor((best.reliability - 0.008) * 100) / 100;
  if (level.target <= naive.reliability + 0.03) return false;
  const spares = best.design.filter((d, i) => d.length > (level.stages[i].need || 1)).length;
  if (level.kind === "spare" && spares < 1) return false;
  if (level.kind === "tight") {
    // The best design must use a spare somewhere and a single premium part somewhere else.
    const premiumSingles = best.design.filter((d) => d.length === 1 && d[0] === 2).length;
    if (spares < 1 || premiumSingles < 1) return false;
    if (best.cost < level.budget - 3 * COST_STEP) return false;
  }
  if (level.kind === "kofn" && best.design[level.stages.findIndex((s) => s.need > 1)].length < K_NEEDED + 1) return false;
  level.best = best;
  level.naive = naive;
  return true;
}

/** Generate one level. Drafts are drawn from the seeded generator until one passes its checks. */
export function generateLevel(rng, spec) {
  for (let tries = 0; tries < 500; tries++) {
    const level = draft(rng, spec.kind);
    if (accept(level)) return { ...level, tries: tries + 1 };
  }
  throw new Error(`Build for Uptime: no valid level found for kind "${spec.kind}"`);
}

/** Text for how a stage's reliability is worked out, for the play screen and debrief. */
export function stageFormula(stage, units, digits = 3) {
  const rs = units.map((u) => stage.parts[u].r);
  const need = stage.need || 1;
  const f = (x) => x.toFixed(digits).replace(/0+$/, "").replace(/\.$/, ".0");
  if (rs.length < need) return need > 1 ? `needs ${need} units` : "empty";
  const r = stageReliability(stage, units);
  if (need > 1) return `at least ${need} of ${rs.length} work = ${f(r)}`;
  if (rs.length === 1) return f(r);
  return `1 − ${rs.map((x) => f(1 - x)).join(" × ")} = ${f(r)}`;
}

/**
 * The model's simplifying assumptions, shown on the intro and results screens.
 * Numbers come from the constants above so the text can't drift from the code.
 */
export const ASSUMPTIONS = [
  "Components fail independently, and each one either works or has failed.",
  "Each component's reliability over the mission is known and constant.",
  "In series, the system works only if every component works. In parallel (active redundancy), it works if at least one does.",
  "Switching between redundant units is perfect, and nothing is repaired during the mission.",
  `Component costs are known, with a fixed budget. A stage holds at most ${MAX_UNITS} units (one in the first level, which allows no spares), and spares may be different models of the same kind of part.`,
  `In the bonus level, the pump stage needs at least ${K_NEEDED} working pumps (a ${K_NEEDED}-out-of-n stage) and holds up to ${MAX_UNITS + 1}.`,
  `"Run the missions" simulates ${MISSIONS} independent missions with random numbers, so the count of failures varies from run to run around the calculated reliability.`,
  "The benchmark is the most reliable design within budget, found by checking every possible design.",
];
