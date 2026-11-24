// Pure logic for Spot the Shift: simulated process data, X-bar and R chart
// limits, Western Electric / Nelson run rules, a rule-following "benchmark
// operator", costs, and average run length (ARL). No DOM access.

export const N = 5; // subgroup size
export const A2 = 0.577; // X-bar chart factor for n = 5
export const D3 = 0; // R chart lower factor for n = 5
export const D4 = 2.114; // R chart upper factor for n = 5
export const TARGET = 500; // mL, bottle fill volume
export const SIGMA = 2; // mL, in-control standard deviation of one bottle
export const SETUP = 20; // subgroups used to set the limits
export const HORIZON = 60; // live subgroups per round
export const COST = { falseAlarm: 300, scrapPerSubgroup: 100, missed: 1000 };

export const ROUNDS = [
  { id: "1", name: "Big jump", blurb: "warm-up", type: "mean", size: 1.6 },
  { id: "2", name: "Small slip", blurb: "harder to see", type: "mean", size: -0.8 },
  { id: "3", name: "Getting shaky", blurb: "watch the R chart", type: "variance", size: 2.2 },
  { id: "4", name: "Slow creep", blurb: "patience", type: "trend", size: 0.07 },
  { id: "5", name: "Mystery", blurb: "anything goes", type: "mystery" },
];

export const SHIFT_STORIES = {
  mean: (s) =>
    `A filler valve setting slipped, moving the average fill ${s > 0 ? "up" : "down"} by ${Math.abs(s).toFixed(1)} standard deviations (${Math.abs(s * SIGMA).toFixed(1)} mL).`,
  variance: (s) => `A worn valve seal made the fills erratic: the standard deviation grew ${s.toFixed(1)} times, while the average stayed on target.`,
  trend: (s) => `The pump slowly warmed up, so the average fill crept upward by ${(s * SIGMA).toFixed(2)} mL every subgroup after the change.`,
};

export const RULES = [
  { id: "R1", short: "Rule 1", text: "One point beyond a 3σ control limit" },
  { id: "R2", short: "Rule 2", text: "2 of 3 points in a row beyond 2σ on the same side" },
  { id: "R3", short: "Rule 3", text: "4 of 5 points in a row beyond 1σ on the same side" },
  { id: "R4", short: "Rule 4", text: "8 points in a row on the same side of the center line" },
  { id: "TR", short: "Trend", text: "6 points in a row steadily rising or falling" },
  { id: "RR", short: "R chart", text: "A subgroup range above the R chart's upper limit" },
];
export const ALL_RULE_IDS = RULES.map((r) => r.id);

/** Resolve a "mystery" round into a concrete shift type and size. */
export function resolveSpec(rng, spec) {
  if (spec.type !== "mystery") return { ...spec };
  const type = rng.pick(["mean", "mean", "variance", "trend"]);
  const size =
    type === "mean" ? rng.pick([-1, 1]) * rng.uniform(0.7, 1.4) : type === "variance" ? rng.uniform(1.8, 2.6) : rng.pick([-1, 1]) * rng.uniform(0.05, 0.1);
  return { ...spec, type, size };
}

/** Process mean and sd for live subgroup i given the shift. */
export function processAt(i, onset, type, size) {
  if (i < onset) return { mean: TARGET, sd: SIGMA };
  if (type === "mean") return { mean: TARGET + size * SIGMA, sd: SIGMA };
  if (type === "variance") return { mean: TARGET, sd: SIGMA * size };
  return { mean: TARGET + size * SIGMA * (i - onset + 1), sd: SIGMA }; // trend
}

function subgroup(rng, mean, sd) {
  const values = Array.from({ length: N }, () => rng.normal(mean, sd));
  const xbar = values.reduce((a, b) => a + b, 0) / N;
  const r = Math.max(...values) - Math.min(...values);
  return { values, xbar, r };
}

/** Control limits from setup subgroups (X-bar and R method). */
export function computeLimits(setup) {
  const xbarbar = setup.reduce((a, s) => a + s.xbar, 0) / setup.length;
  const rbar = setup.reduce((a, s) => a + s.r, 0) / setup.length;
  const half = A2 * rbar;
  return {
    cl: xbarbar,
    ucl: xbarbar + half,
    lcl: xbarbar - half,
    sigmaXbar: half / 3, // one zone width on the X-bar chart
    rbar,
    rucl: D4 * rbar,
    rlcl: D3 * rbar,
  };
}

/** Generate one round: setup data, limits, and the live stream with a hidden shift. */
export function generateRound(rng, roundSpec) {
  const spec = resolveSpec(rng, roundSpec);
  const setup = Array.from({ length: SETUP }, () => subgroup(rng, TARGET, SIGMA));
  const limits = computeLimits(setup);
  const onset = rng.int(12, 40);
  const live = Array.from({ length: HORIZON }, (_, i) => {
    const p = processAt(i, onset, spec.type, spec.size);
    return subgroup(rng, p.mean, p.sd);
  });
  return { spec, setup, limits, onset, live };
}

/** z-score of an X-bar point in zone units (1 = one sigma of X-bar). */
function z(x, L) {
  return (x - L.cl) / L.sigmaXbar;
}

/**
 * Which rules are satisfied by the window of points [start, i]?
 * Only points at or after `start` count, so a pattern that started before an
 * investigation doesn't fire again after the restart.
 */
export function rulesAt(points, i, L, start = 0) {
  const fired = [];
  const zs = (k) => z(points[k].xbar, L);
  const from = (len) => Math.max(start, i - len + 1);
  const win = (len) => {
    const out = [];
    for (let k = from(len); k <= i; k++) out.push(zs(k));
    return out;
  };
  const zi = zs(i);
  if (Math.abs(zi) > 3) fired.push("R1");
  for (const side of [1, -1]) {
    const w3 = win(3);
    if (w3.filter((v) => side * v > 2).length >= 2 && side * zi > 2) fired.push("R2");
    const w5 = win(5);
    if (w5.filter((v) => side * v > 1).length >= 4 && side * zi > 1) fired.push("R3");
    const w8 = win(8);
    if (w8.length === 8 && w8.every((v) => side * v > 0)) fired.push("R4");
  }
  const w6 = win(6);
  if (w6.length === 6) {
    let up = true;
    let down = true;
    for (let k = 1; k < 6; k++) {
      if (!(w6[k] > w6[k - 1])) up = false;
      if (!(w6[k] < w6[k - 1])) down = false;
    }
    if (up || down) fired.push("TR");
  }
  if (points[i].r > L.rucl || points[i].r < L.rlcl - 1e-9) fired.push("RR");
  return [...new Set(fired)];
}

/** First index (>= start) where each rule fires, scanning the whole stream once. */
export function firstFirings(points, L, start = 0) {
  const first = {};
  for (let i = start; i < points.length; i++) {
    for (const id of rulesAt(points, i, L, start)) if (first[id] === undefined) first[id] = i;
  }
  return first;
}

/** Cost of an outcome. detectIndex = null means the shift was never caught. */
export function costOf({ falseAlarms, detectIndex, onset, horizon = HORIZON }) {
  const fa = falseAlarms * COST.falseAlarm;
  if (detectIndex == null) return fa + (horizon - onset) * COST.scrapPerSubgroup + COST.missed;
  return fa + (detectIndex - onset + 1) * COST.scrapPerSubgroup;
}

/** Outcome of a sequence of stop presses (indices of live subgroups). */
export function scoreStops(stops, onset, horizon = HORIZON) {
  let falseAlarms = 0;
  let detectIndex = null;
  for (const s of [...stops].sort((a, b) => a - b)) {
    if (s < onset) falseAlarms += 1;
    else {
      detectIndex = s;
      break;
    }
  }
  return { falseAlarms, detectIndex, delay: detectIndex == null ? null : detectIndex - onset + 1, cost: costOf({ falseAlarms, detectIndex, onset, horizon }) };
}

/**
 * An operator who stops the line the moment any of `ruleIds` fires. After a
 * false alarm the rules restart from the next subgroup.
 */
export function simulateOperator(round, ruleIds = ALL_RULE_IDS) {
  const { live, limits, onset } = round;
  const stops = [];
  let start = 0;
  for (let i = 0; i < live.length; i++) {
    const fired = rulesAt(live, i, limits, start).filter((id) => ruleIds.includes(id));
    if (!fired.length) continue;
    stops.push({ index: i, rules: fired, falseAlarm: i < onset });
    if (i >= onset) break;
    start = i + 1;
  }
  return { stops, ...scoreStops(stops.map((s) => s.index), onset, live.length) };
}

/** Stars: 3 = as good as the rule book or better, 2 = close, 1 = caught it late, 0 = missed. */
export function starsFor(player, benchmark) {
  if (player.detectIndex == null) return 0;
  if (player.cost <= benchmark.cost) return 3;
  if (player.cost <= benchmark.cost * 1.5 + COST.falseAlarm) return 2;
  return 1;
}

// ---- Normal distribution and average run length ---------------------------

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, error < 1.5e-7). */
export function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * Probability that one X-bar point falls outside 3-sigma limits (Rule 1).
 * type "none" | "mean" (size = shift in sigmas of one item) | "variance" (size = sd multiplier)
 */
export function rule1Probability(type, size = 0, n = N) {
  if (type === "mean") {
    const d = size * Math.sqrt(n);
    return normCdf(-3 - d) + normCdf(-3 + d);
  }
  if (type === "variance") return 2 * normCdf(-3 / size);
  return 2 * normCdf(-3);
}

/** Average run length for Rule 1 alone: the expected number of subgroups until a signal. */
export function arlRule1(type, size, n = N) {
  return 1 / rule1Probability(type, size, n);
}
