// Pure logic for Invest or Wait: project cash flows, net present value (NPV),
// simple payback, internal rate of return (IRR), the NPV-maximizing choice
// under a capital budget, and a "payback-only" benchmark. No DOM access.

export const MARR_CHOICES = [0.08, 0.1, 0.12]; // one is drawn per round
export const HOURS = { payback: 1, npv: 2, irr: 3 }; // analyst hours each calculation costs
export const PAYBACK_CUTOFF = 3; // years: the payback-only benchmark funds nothing slower

const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;

export const LEVELS = [
  { id: "1", name: "Yes or no", blurb: "one project at a time", kind: "single", deals: 3, hours: 4, tools: ["payback", "npv"] },
  { id: "2", name: "Pick one", blurb: "three rivals, one winner", kind: "exclusive", deals: 2, hours: 6, tools: ["payback", "npv", "irr"] },
  { id: "3", name: "Tight budget", blurb: "build a portfolio", kind: "portfolio", deals: 1, hours: 7, tools: ["payback", "npv", "irr"] },
  { id: "4", name: "Unequal lives", blurb: "short life vs. long life", kind: "lives", deals: 2, hours: 5, tools: ["payback", "npv", "irr"] },
  { id: "5", name: "Risky bet", blurb: "two possible futures", kind: "risky", deals: 2, hours: 5, tools: ["payback", "npv", "irr"] },
];

/**
 * The model's simplifying assumptions, shown on the intro and results screens.
 * Numbers come from the constants in this file so the text can't drift from the code.
 */
export const ASSUMPTIONS = [
  `Cash flows are known with certainty, except in the level labeled risky (level ${LEVELS.findIndex((l) => l.kind === "risky") + 1}). There, two scenarios have known probabilities, and the best choice has the highest expected (probability-weighted) NPV.`,
  "End-of-year convention: each year's cash flow happens at the end of that year. The first cost is paid today (year 0), savings are the same every year, and salvage arrives with the last year's savings.",
  "One constant interest rate (MARR) for discounting, and money not invested earns the MARR. So waiting, or leaving budget unspent, has an NPV of $0.",
  "No inflation (real dollars), no taxes and no depreciation.",
  "Projects are independent or mutually exclusive, as stated, with a fixed capital budget. A project is funded in full or not at all.",
  "Unequal lives are compared over a common period (repeatability assumption): the shorter-lived project is bought again, at the same cost and savings, until both cover the same number of years.",
  `The payback-only benchmark uses simple payback (no discounting). It funds the fastest payback first and never funds a project that takes more than ${PAYBACK_CUTOFF} years to pay back.`,
];

// ---- Time value of money ---------------------------------------------------

/** Value today of $1 received at the end of year n (the P/F factor). */
export function pvFactor(rate, n) {
  return 1 / (1 + rate) ** n;
}

/** Value today of $1 received at the end of each of n years (the P/A factor). */
export function annuityFactor(rate, n) {
  return rate === 0 ? n : (1 - (1 + rate) ** -n) / rate;
}

/**
 * Year-by-year cash flows of a project; index = year, year 0 = today.
 * opts.annual   override the yearly savings (used for scenarios)
 * opts.horizon  repeat the project back to back until this many years are covered
 */
export function cashFlows(p, opts = {}) {
  const annual = opts.annual ?? p.annual;
  const cycles = opts.horizon ? Math.round(opts.horizon / p.life) : 1;
  const flows = new Array(p.life * cycles + 1).fill(0);
  for (let c = 0; c < cycles; c++) {
    const t0 = c * p.life;
    flows[t0] -= p.cost;
    for (let t = 1; t <= p.life; t++) flows[t0 + t] += annual;
    flows[t0 + p.life] += p.salvage;
  }
  return flows;
}

/** Net present value of a list of end-of-year cash flows. */
export function npv(flows, rate) {
  return flows.reduce((sum, f, t) => sum + f * pvFactor(rate, t), 0);
}

/**
 * Simple (undiscounted) payback in years: when the running total of cash
 * flows first reaches zero, interpolating inside the year. Infinity = never.
 */
export function paybackYears(flows) {
  let cum = flows[0];
  if (cum >= 0) return 0;
  for (let t = 1; t < flows.length; t++) {
    const next = cum + flows[t];
    if (next >= 0) return t - 1 + -cum / flows[t];
    cum = next;
  }
  return Infinity;
}

/** Internal rate of return: the rate where NPV = 0 (bisection). null if there is none in (-99%, 1000%). */
export function irr(flows) {
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(flows, lo);
  const fHi = npv(flows, hi);
  if (!(fLo > 0 && fHi < 0)) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(flows, mid);
    if (fMid > 0) {
      lo = mid;
      fLo = fMid;
    } else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

// ---- One project inside a deal ---------------------------------------------

/** The yearly savings to plan with: the probability-weighted average in risky deals. */
export function expectedAnnual(p) {
  if (!p.scenarios) return p.annual;
  return p.scenarios.reduce((s, sc) => s + sc.p * sc.annual, 0);
}

/**
 * The number a project is judged by in its deal: NPV at the MARR, taken over
 * the common period when lives differ, and over expected cash flows when risky.
 */
export function projectValue(p, deal, rate) {
  return npv(cashFlows(p, { annual: expectedAnnual(p), horizon: deal.horizon }), rate);
}

/** Everything the calculator can report about one project (one life, per scenario when risky). */
export function analyze(p, deal, rate) {
  const one = (annual) => {
    const flows = cashFlows(p, { annual });
    return { npv: npv(flows, rate), payback: paybackYears(flows), irr: irr(flows) };
  };
  const base = one(expectedAnnual(p));
  return {
    ...base,
    value: projectValue(p, deal, rate),
    scenarios: p.scenarios ? p.scenarios.map((sc) => ({ name: sc.name, p: sc.p, annual: sc.annual, ...one(sc.annual) })) : null,
  };
}

// ---- Choosing projects -----------------------------------------------------

export function selectionCost(deal, picks) {
  return picks.reduce((s, i) => s + deal.projects[i].cost, 0);
}

/** A choice is allowed if it fits the budget and, for mutually exclusive projects, funds at most one. */
export function isFeasible(deal, picks) {
  if (new Set(picks).size !== picks.length) return false;
  if (deal.mode === "exclusive" && picks.length > 1) return false;
  return selectionCost(deal, picks) <= deal.budget;
}

export function selectionValue(deal, picks, rate) {
  return picks.reduce((s, i) => s + projectValue(deal.projects[i], deal, rate), 0);
}

/** The feasible choice with the highest total value (every subset is checked). Ties go to the cheaper choice. */
export function bestSelection(deal, rate) {
  const n = deal.projects.length;
  const values = deal.projects.map((p) => projectValue(p, deal, rate));
  let best = { picks: [], value: 0, cost: 0 };
  for (let mask = 1; mask < 1 << n; mask++) {
    const picks = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) picks.push(i);
    if (!isFeasible(deal, picks)) continue;
    const value = picks.reduce((s, i) => s + values[i], 0);
    const cost = selectionCost(deal, picks);
    if (value > best.value + 1e-9 || (Math.abs(value - best.value) <= 1e-9 && cost < best.cost)) best = { picks, value, cost };
  }
  return { picks: best.picks, value: best.value };
}

/** All feasible choices, best first (used to check that a round has a clear answer). */
export function rankedSelections(deal, rate) {
  const n = deal.projects.length;
  const out = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const picks = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) picks.push(i);
    if (isFeasible(deal, picks)) out.push({ picks, value: selectionValue(deal, picks, rate) });
  }
  return out.sort((a, b) => b.value - a.value);
}

/**
 * What payback-only thinking picks: fastest simple payback first, nothing
 * slower than PAYBACK_CUTOFF years, as long as the budget allows.
 */
export function paybackSelection(deal) {
  const ranked = deal.projects
    .map((p, i) => ({ i, cost: p.cost, pb: paybackYears(cashFlows(p, { annual: expectedAnnual(p) })) }))
    .filter((x) => x.pb <= PAYBACK_CUTOFF)
    .sort((a, b) => a.pb - b.pb || a.cost - b.cost || a.i - b.i);
  const picks = [];
  let left = deal.budget;
  for (const x of ranked) {
    if (x.cost > left) continue;
    picks.push(x.i);
    left -= x.cost;
    if (deal.mode === "exclusive") break;
  }
  return picks.sort((a, b) => a - b);
}

/** What comparing one-life NPVs (ignoring unequal lives) picks in a mutually exclusive deal. */
export function oneLifeSelection(deal, rate) {
  let best = -1;
  let bestValue = 0;
  deal.projects.forEach((p, i) => {
    const v = npv(cashFlows(p, { annual: expectedAnnual(p) }), rate);
    if (v > bestValue && p.cost <= deal.budget) {
      best = i;
      bestValue = v;
    }
  });
  return best < 0 ? [] : [best];
}

/** Stars from the value you added compared with the best possible. */
export function starsFor(you, best) {
  if (you >= best - 1) return 3;
  if (best > 0 && (best - you) / best <= 0.25) return 2;
  return you > 0 ? 1 : 0;
}

/** Score a whole round. choices[k] = array of project indices picked in deal k. */
export function scoreRound(round, choices) {
  const deals = round.deals.map((deal, k) => {
    const mine = choices[k] || [];
    const best = bestSelection(deal, round.marr);
    const pb = paybackSelection(deal);
    return {
      you: { picks: mine, value: selectionValue(deal, mine, round.marr) },
      best,
      payback: { picks: pb, value: selectionValue(deal, pb, round.marr) },
    };
  });
  const total = (key) => deals.reduce((s, d) => s + d[key].value, 0);
  const totals = { you: total("you"), best: total("best"), payback: total("payback") };
  return { deals, totals, stars: starsFor(totals.you, totals.best) };
}

// ---- Round generation ------------------------------------------------------

const roundTo = (x, step) => Math.round(x / step) * step;

const NAMES = [
  "LED lighting retrofit",
  "Robotic palletizer",
  "Air compressor upgrade",
  "Conveyor sorter",
  "Vision inspection camera",
  "Heat recovery unit",
  "Electric forklift fleet",
  "CNC tool changer",
  "Barcode tracking system",
  "Insulated dock doors",
  "3D printer for fixtures",
  "Rooftop solar panels",
  "Automated guided cart",
  "Packaging line upgrade",
  "Water recycling loop",
  "Variable-speed pump drives",
];
const LIFE_PAIRS = [
  ["Economy pump", "Stainless pump"],
  ["Standard forklift", "Heavy-duty forklift"],
  ["Basic compressor", "Premium compressor"],
  ["Light-duty conveyor", "Heavy-duty conveyor"],
  ["Painted steel racks", "Galvanized racks"],
];
const RISK_PAIRS = [
  ["Second production line", "Extra shift cell"],
  ["Full automation cell", "Semi-automatic station"],
  ["Large solar field", "Rooftop pilot array"],
  ["Regional warehouse", "Leased storage bay"],
];
const RISK_SCENARIOS = [
  ["Strong demand", "Weak demand"],
  ["Contract renewed", "Contract lost"],
  ["High energy prices", "Low energy prices"],
];
export const UNEQUAL_LIVES = [
  [2, 4],
  [3, 6],
  [2, 6],
  [4, 8],
  [3, 9],
  [6, 12],
];

/** Draw candidates until one passes `ok` (the last draw is used if none does, so play never breaks). */
function sample(make, ok, tries = 400) {
  let c = make();
  for (let k = 1; k < tries && !ok(c); k++) c = make();
  return c;
}

function project(cost, paybackTarget, life, salvage = 0) {
  return { cost, annual: Math.max(100, roundTo(cost / paybackTarget, 100)), salvage, life };
}
const oneNpv = (p, rate) => npv(cashFlows(p), rate);
const onePayback = (p) => paybackYears(cashFlows(p));

// Archetypes. Each returns a project that payback and NPV judge in a known way.

/** Pays back fast but dies young: payback says yes, NPV says no. */
function sprinter(rng, rate, step = 1000, range = [8000, 30000]) {
  return sample(
    () => {
      const life = rng.pick([2, 3]);
      const pa = annuityFactor(rate, life);
      return project(roundTo(rng.uniform(...range), step), rng.uniform(pa + 0.05, life - 0.02), life);
    },
    (p) => onePayback(p) <= PAYBACK_CUTOFF && oneNpv(p, rate) <= -300,
  );
}

/** Pays back slowly but keeps saving for years: payback says no, NPV says yes. */
function marathoner(rng, rate, step = 5000, range = [20000, 60000]) {
  return sample(
    () => {
      const life = rng.pick([8, 10, 12]);
      const cost = roundTo(rng.uniform(...range), step);
      const salvage = rng.chance(0.35) ? roundTo(0.1 * cost, 1000) : 0;
      return project(cost, rng.uniform(3.3, 0.78 * annuityFactor(rate, life)), life, salvage);
    },
    (p) => onePayback(p) > PAYBACK_CUTOFF + 0.05 && oneNpv(p, rate) >= 0.08 * p.cost,
  );
}

/** Good on every measure. */
function winner(rng, rate, step = 1000, range = [10000, 40000]) {
  return sample(
    () => project(roundTo(rng.uniform(...range), step), rng.uniform(1.6, 2.6), rng.pick([5, 6])),
    (p) => onePayback(p) < PAYBACK_CUTOFF && oneNpv(p, rate) >= 0.1 * p.cost,
  );
}

/** Bad on every measure. */
function loser(rng, rate, step = 1000, range = [10000, 40000]) {
  return sample(
    () => {
      const life = rng.pick([4, 5]);
      const pa = annuityFactor(rate, life);
      return project(roundTo(rng.uniform(...range), step), rng.uniform(Math.max(3.15, pa + 0.2), pa + 1), life);
    },
    (p) => onePayback(p) > PAYBACK_CUTOFF && oneNpv(p, rate) <= -0.03 * p.cost,
  );
}

/** Barely better than leaving the money at the MARR. */
function modest(rng, rate, step = 1000, range = [10000, 30000]) {
  return sample(
    () => {
      const life = rng.pick([5, 6, 7]);
      return project(roundTo(rng.uniform(...range), step), annuityFactor(rate, life) * rng.uniform(0.85, 0.95), life);
    },
    (p) => oneNpv(p, rate) >= 300 && onePayback(p) > PAYBACK_CUTOFF,
  );
}

function label(projects, names) {
  return projects.map((p, i) => ({ id: String.fromCharCode(65 + i), name: names[i], ...p }));
}

function singleDeals(rng, rate, names) {
  const third = rng.chance(0.5) ? winner(rng, rate) : loser(rng, rate);
  const list = rng.shuffle([sprinter(rng, rate), marathoner(rng, rate), third]);
  return list.map((p, k) => ({ mode: "independent", budget: Math.ceil(p.cost / 5000) * 5000, projects: label([p], [names[k]]) }));
}

function exclusiveDeal(rng, rate, trap, names) {
  const margin = (a, b) => a - b >= Math.max(1500, 0.15 * a);
  const projects = sample(
    () => {
      const lifeQ = trap ? rng.pick([3, 4]) : rng.pick([4, 5]);
      const quick = project(
        roundTo(rng.uniform(trap ? 10000 : 15000, trap ? 20000 : 25000), 1000),
        annuityFactor(rate, lifeQ) * (trap ? rng.uniform(0.72, 0.9) : rng.uniform(0.55, 0.7)),
        lifeQ,
      );
      const lifeL = rng.pick([8, 10]);
      const paL = annuityFactor(rate, lifeL);
      const costL = roundTo(rng.uniform(30000, 50000), 5000);
      const long = project(costL, trap ? rng.uniform(3.2, 0.72 * paL) : paL * rng.uniform(0.9, 1), lifeL, rng.chance(0.3) ? roundTo(0.1 * costL, 1000) : 0);
      const lifeD = rng.pick([5, 6]);
      const decoy = project(roundTo(rng.uniform(18000, 32000), 1000), annuityFactor(rate, lifeD) * rng.uniform(0.97, 1.12), lifeD);
      return { quick, long, decoy };
    },
    ({ quick, long, decoy }) => {
      const [q, l, d] = [quick, long, decoy].map((p) => oneNpv(p, rate));
      const fastest = onePayback(quick) <= PAYBACK_CUTOFF && onePayback(quick) < Math.min(onePayback(long), onePayback(decoy)) - 0.2;
      if (!fastest || q <= 500) return false;
      if (trap) return margin(l, Math.max(q, d)) && irr(cashFlows(quick)) > irr(cashFlows(long)) + 0.01;
      return margin(q, Math.max(l, d));
    },
  );
  const list = rng.shuffle([projects.quick, projects.long, projects.decoy]);
  const budget = Math.ceil(Math.max(...list.map((p) => p.cost)) / 5000) * 5000;
  return { mode: "exclusive", budget, trap, projects: label(list, names) };
}

function portfolioDeal(rng, rate, names) {
  const s5 = 5000;
  return sample(
    () => {
      const list = rng.shuffle([
        marathoner(rng, rate, s5, [15000, 35000]),
        marathoner(rng, rate, s5, [15000, 35000]),
        sprinter(rng, rate, s5, [10000, 20000]),
        winner(rng, rate, s5, [10000, 25000]),
        loser(rng, rate, s5, [10000, 30000]),
        modest(rng, rate, s5, [10000, 30000]),
      ]);
      const total = list.reduce((s, p) => s + p.cost, 0);
      return { mode: "independent", budget: roundTo(0.5 * total, s5), projects: label(list, names) };
    },
    (deal) => {
      const ranked = rankedSelections(deal, rate);
      const best = ranked[0];
      const pb = selectionValue(deal, paybackSelection(deal), rate);
      return best.picks.length >= 2 && best.value - ranked[1].value >= 300 && best.value - pb >= Math.max(2000, 0.1 * best.value);
    },
    200,
  );
}

function livesDeal(rng, rate, trap, names) {
  const gap = (a, b) => a - b >= Math.max(800, 0.1 * a);
  return sample(
    () => {
      const [ls, ll] = rng.pick(UNEQUAL_LIVES);
      const costS = roundTo(rng.uniform(8000, 20000), 1000);
      const short = project(costS, annuityFactor(rate, ls) * rng.uniform(0.7, 0.92), ls);
      const long = project(roundTo(costS * rng.uniform(1.5, 2.6), 1000), annuityFactor(rate, ll) * rng.uniform(0.6, 0.95), ll);
      const list = rng.chance(0.5) ? [short, long] : [long, short];
      const budget = Math.ceil(Math.max(short.cost, long.cost) / 5000) * 5000;
      return { mode: "exclusive", budget, horizon: ll, trap, short: list.indexOf(short), projects: label(list, names) };
    },
    (deal) => {
      const short = deal.projects[deal.short];
      const long = deal.projects[1 - deal.short];
      const s1 = oneNpv(short, rate);
      const l1 = oneNpv(long, rate);
      const sCommon = projectValue(short, deal, rate);
      if (s1 <= 300) return false;
      return trap ? gap(l1, s1) && gap(sCommon, l1) : gap(l1, sCommon);
    },
    800,
  );
}

function riskyDeal(rng, rate, boldWins, names, scenarioNames) {
  const gap = (a, b) => a - b >= Math.max(1500, 0.15 * Math.abs(a));
  return sample(
    () => {
      const pStrong = rng.pick([0.5, 0.6, 0.7]);
      const life = rng.pick([5, 6, 8]);
      const pa = annuityFactor(rate, life);
      const scen = (hi, lo) => [
        { name: scenarioNames[0], p: pStrong, annual: hi },
        { name: scenarioNames[1], p: Math.round((1 - pStrong) * 10) / 10, annual: lo },
      ];
      const costS = roundTo(rng.uniform(15000, 30000), 1000);
      const baseS = costS / (pa * rng.uniform(0.75, 0.9));
      const steady = { cost: costS, salvage: 0, life, scenarios: scen(roundTo(baseS * 1.1, 100), roundTo(baseS * 0.9, 100)) };
      const costB = roundTo(costS * rng.uniform(1.8, 2.6), 1000);
      const bold = { cost: costB, salvage: 0, life, scenarios: scen(roundTo(costB / (pa * rng.uniform(0.5, 0.65)), 100), roundTo(costB / (pa * rng.uniform(1.3, 2.2)), 100)) };
      const list = rng.chance(0.5) ? [bold, steady] : [steady, bold];
      list.forEach((p) => (p.annual = Math.round(expectedAnnual(p))));
      const budget = Math.ceil(costB / 5000) * 5000;
      return { mode: "exclusive", budget, risky: true, boldWins, bold: list.indexOf(bold), pStrong, scenarioNames, projects: label(list, names) };
    },
    (deal) => {
      const bold = deal.projects[deal.bold];
      const steady = deal.projects[1 - deal.bold];
      const eb = projectValue(bold, deal, rate);
      const es = projectValue(steady, deal, rate);
      const boldWeak = npv(cashFlows(bold, { annual: bold.scenarios[1].annual }), rate);
      const boldStrong = npv(cashFlows(bold, { annual: bold.scenarios[0].annual }), rate);
      const steadyStrong = npv(cashFlows(steady, { annual: steady.scenarios[0].annual }), rate);
      if (es <= 500 || boldWeak >= -1000) return false;
      return boldWins ? gap(eb, es) : gap(es, eb) && boldStrong >= 1.5 * steadyStrong;
    },
    800,
  );
}

/** Generate one round (a level's deals) from a seeded generator. */
export function generateRound(rng, level) {
  const marr = rng.pick(MARR_CHOICES);
  const names = rng.shuffle(NAMES);
  let deals;
  if (level.kind === "single") deals = singleDeals(rng, marr, names);
  else if (level.kind === "exclusive") {
    const traps = rng.shuffle([true, rng.chance(0.5)]);
    deals = traps.map((trap, k) => exclusiveDeal(rng, marr, trap, names.slice(3 * k, 3 * k + 3)));
  } else if (level.kind === "portfolio") deals = [portfolioDeal(rng, marr, names)];
  else if (level.kind === "lives") {
    const pairs = rng.shuffle(LIFE_PAIRS);
    const traps = rng.shuffle([true, rng.chance(0.5)]);
    deals = traps.map((trap, k) => {
      const deal = livesDeal(rng, marr, trap, ["", ""]);
      // Name the short-lived machine first in its pair, whatever its position.
      deal.projects.forEach((p, i) => (p.name = pairs[k][i === deal.short ? 0 : 1]));
      return deal;
    });
  } else {
    const pairs = rng.shuffle(RISK_PAIRS);
    const scenarios = rng.shuffle(RISK_SCENARIOS);
    deals = rng.shuffle([true, false]).map((boldWins, k) => {
      const deal = riskyDeal(rng, marr, boldWins, ["", ""], scenarios[k]);
      deal.projects.forEach((p, i) => (p.name = pairs[k][i === deal.bold ? 0 : 1]));
      deal.realized = rng.chance(deal.pStrong) ? 0 : 1;
      return deal;
    });
  }
  return { marr, kind: level.kind, hours: level.hours, tools: level.tools, deals };
}

export { usd };
