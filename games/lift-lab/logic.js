// Pure logic for Lift Lab: the revised NIOSH lifting equation (1991), the
// redesign options of each job, and the cheapest redesign that makes the lift
// acceptable. No DOM access, so it runs in node --test.
//
// Source for every formula and table in this file:
//   Waters, T. R., Putz-Anderson, V., & Garg, A. (1994). Applications Manual
//   for the Revised NIOSH Lifting Equation. DHHS (NIOSH) Publication No. 94-110.
//   Equation and metric multipliers: p. 13. Table 5 (frequency): p. 26.
//   Table 7 (coupling): p. 31. Lifting Index: pp. 33-35.
//
// Vocabulary
//   job      { load (kg), H, V, Vdest (cm), A (degrees), F (lifts/min), duration, coupling }
//   factor   one thing the player may change: { id, name, options: [{ label, cost, set }] }
//            option 0 is always "keep as is" at $0
//   choice   array with one option index per factor

export const LC = 23; // load constant, kg
export const H_MIN = 25; // cm: closer than this counts as 25
export const H_MAX = 63; // cm: farther than this and HM = 0
export const V_REF = 75; // cm: knuckle height, the best height to lift from
export const V_MAX = 175; // cm
export const D_MIN = 25; // cm: shorter travel counts as 25
export const D_MAX = 175; // cm
export const A_MAX = 135; // degrees
export const LI_LIMIT = 1; // a Lifting Index at or below this is acceptable
export const LI_HIGH = 3; // above this, nearly all workers are at increased risk (manual p. 35)

/** Horizontal multiplier: HM = 25 / H. */
export function hm(H) {
  if (H > H_MAX) return 0;
  return 25 / Math.max(H, H_MIN);
}

/** Vertical multiplier: VM = 1 - 0.003 |V - 75|. */
export function vm(V) {
  if (V < 0 || V > V_MAX) return 0;
  return 1 - 0.003 * Math.abs(V - V_REF);
}

/** Distance multiplier: DM = 0.82 + 4.5 / D. */
export function dm(D) {
  if (D > D_MAX) return 0;
  return 0.82 + 4.5 / Math.max(D, D_MIN);
}

/** Asymmetric multiplier: AM = 1 - 0.0032 A. */
export function am(A) {
  if (A > A_MAX) return 0;
  return 1 - 0.0032 * Math.max(0, A);
}

export const DURATIONS = [
  { id: "short", label: "1 hour or less", short: "≤ 1 h" },
  { id: "moderate", label: "1 to 2 hours", short: "1-2 h" },
  { id: "long", label: "2 to 8 hours", short: "2-8 h" },
];

// Table 5 of the manual. Each row: lifts per minute, then FM for
// [≤1 h, V<75] [≤1 h, V≥75] [1-2 h, V<75] [1-2 h, V≥75] [2-8 h, V<75] [2-8 h, V≥75].
export const FM_TABLE = [
  [0.2, 1.0, 1.0, 0.95, 0.95, 0.85, 0.85],
  [0.5, 0.97, 0.97, 0.92, 0.92, 0.81, 0.81],
  [1, 0.94, 0.94, 0.88, 0.88, 0.75, 0.75],
  [2, 0.91, 0.91, 0.84, 0.84, 0.65, 0.65],
  [3, 0.88, 0.88, 0.79, 0.79, 0.55, 0.55],
  [4, 0.84, 0.84, 0.72, 0.72, 0.45, 0.45],
  [5, 0.8, 0.8, 0.6, 0.6, 0.35, 0.35],
  [6, 0.75, 0.75, 0.5, 0.5, 0.27, 0.27],
  [7, 0.7, 0.7, 0.42, 0.42, 0.22, 0.22],
  [8, 0.6, 0.6, 0.35, 0.35, 0.18, 0.18],
  [9, 0.52, 0.52, 0.3, 0.3, 0.0, 0.15],
  [10, 0.45, 0.45, 0.26, 0.26, 0.0, 0.13],
  [11, 0.41, 0.41, 0.0, 0.23, 0.0, 0.0],
  [12, 0.37, 0.37, 0.0, 0.21, 0.0, 0.0],
  [13, 0.0, 0.34, 0.0, 0.0, 0.0, 0.0],
  [14, 0.0, 0.31, 0.0, 0.0, 0.0, 0.0],
  [15, 0.0, 0.28, 0.0, 0.0, 0.0, 0.0],
];
export const FM_RATES = FM_TABLE.map((r) => r[0]);

/**
 * Frequency multiplier from Table 5. Rates below 0.2 lifts/min count as 0.2,
 * rates above 15 give 0, and a rate between two rows is interpolated (p. 13).
 * The game only offers rates that are rows of the table.
 */
export function fm(F, duration, V) {
  const d = DURATIONS.findIndex((x) => x.id === duration);
  if (d < 0) throw new Error(`unknown duration "${duration}"`);
  const col = 1 + 2 * d + (V >= V_REF ? 1 : 0);
  const f = Math.max(F, FM_RATES[0]);
  if (f > FM_RATES[FM_RATES.length - 1]) return 0;
  for (let i = 0; i < FM_TABLE.length; i++) {
    if (f === FM_TABLE[i][0]) return FM_TABLE[i][col];
    if (f < FM_TABLE[i][0]) {
      const lo = FM_TABLE[i - 1];
      const hi = FM_TABLE[i];
      return lo[col] + ((hi[col] - lo[col]) * (f - lo[0])) / (hi[0] - lo[0]);
    }
  }
  return 0;
}

// Table 7 of the manual: [V < 75 cm, V >= 75 cm].
export const COUPLINGS = [
  { id: "poor", label: "Poor", cm: [0.9, 0.9] },
  { id: "fair", label: "Fair", cm: [0.95, 1.0] },
  { id: "good", label: "Good", cm: [1.0, 1.0] },
];

/** Coupling multiplier from Table 7. */
export function cm(coupling, V) {
  const c = COUPLINGS.find((x) => x.id === coupling);
  if (!c) throw new Error(`unknown coupling "${coupling}"`);
  return c.cm[V >= V_REF ? 1 : 0];
}

export const MULTIPLIERS = [
  { id: "HM", name: "Horizontal", what: "how far the load is from your ankles" },
  { id: "VM", name: "Vertical", what: "how far the hands are from knuckle height (75 cm) at the start" },
  { id: "DM", name: "Distance", what: "how far the load travels up or down" },
  { id: "AM", name: "Asymmetry", what: "how far you twist away from straight ahead" },
  { id: "FM", name: "Frequency", what: "how often you lift, and for how long" },
  { id: "CM", name: "Coupling", what: "how good the grip is" },
];

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Analyze one lifting job at the origin of the lift.
 * Returns the six multipliers, the travel distance D, the recommended weight
 * limit RWL (kg), and the Lifting Index LI = load / RWL.
 * `li` is LI rounded to two decimals, and `ok` uses that rounded value, so the
 * number on screen and the verdict can never disagree.
 */
export function analyze(job) {
  const D = Math.abs(job.Vdest - job.V);
  const m = {
    HM: hm(job.H),
    VM: vm(job.V),
    DM: dm(D),
    AM: am(job.A),
    FM: fm(job.F, job.duration, job.V),
    CM: cm(job.coupling, job.V),
  };
  const RWL = LC * m.HM * m.VM * m.DM * m.AM * m.FM * m.CM;
  const LI = RWL > 0 ? job.load / RWL : Infinity;
  const li = Number.isFinite(LI) ? round2(LI) : Infinity;
  return { ...m, D, RWL, LI, li, ok: li <= LI_LIMIT };
}

/** The multiplier that takes the most away from the load constant. */
export function weakest(a) {
  return MULTIPLIERS.map((x) => x.id).reduce((best, id) => (a[id] < a[best] ? id : best), "HM");
}

/** Risk band of a Lifting Index, in words (color is never the only signal). */
export function riskBand(li) {
  if (li <= LI_LIMIT) return { id: "ok", label: "Acceptable", state: "good" };
  if (li <= LI_HIGH) return { id: "raised", label: "Increased risk", state: "warn" };
  return { id: "high", label: "High risk", state: "bad" };
}

// ---- Jobs and redesign options ---------------------------------------------

export const LEVELS = [
  { id: "1", name: "Feed store", blurb: "one bad job · roomy budget", kind: "warmup" },
  { id: "2", name: "Fast line", blurb: "pace or height?", kind: "pace" },
  { id: "3", name: "Long reach", blurb: "height or reach?", kind: "reach" },
  { id: "4", name: "Too heavy", blurb: "the load must change", kind: "heavy" },
  { id: "5", name: "Tight budget", blurb: "every dollar counts", kind: "tight" },
];

/** Apply a choice (one option index per factor) to a level's base job. */
export function applyChoice(level, choice) {
  const job = { ...level.base };
  let lifts = 1;
  level.factors.forEach((f, i) => {
    const opt = f.options[choice[i] ?? 0];
    Object.assign(job, opt.set);
    if (opt.lifts) lifts *= opt.lifts;
  });
  // Smaller packs mean more lifts for the same throughput.
  job.F = job.F * lifts;
  return job;
}

export function choiceCost(level, choice) {
  return level.factors.reduce((s, f, i) => s + f.options[choice[i] ?? 0].cost, 0);
}

export function evaluate(level, choice) {
  const job = applyChoice(level, choice);
  const a = analyze(job);
  const cost = choiceCost(level, choice);
  return { job, analysis: a, cost, withinBudget: cost <= level.budget, changes: choice.filter((c) => c > 0).length };
}

/** Every possible choice for a level (the option sets are small). */
export function* allChoices(level) {
  const n = level.factors.length;
  const choice = new Array(n).fill(0);
  while (true) {
    yield choice.slice();
    let i = n - 1;
    while (i >= 0 && choice[i] === level.factors[i].options.length - 1) choice[i--] = 0;
    if (i < 0) return;
    choice[i]++;
  }
}

/**
 * Cheapest redesign with LI <= 1, by checking every combination of options.
 * Ties on cost go to the lower Lifting Index. Returns null if nothing works.
 * `allow(choice)` can restrict the search (used when generating levels).
 */
export function cheapestFix(level, allow) {
  let best = null;
  for (const choice of allChoices(level)) {
    if (allow && !allow(choice)) continue;
    const job = applyChoice(level, choice);
    const a = analyze(job);
    if (!a.ok) continue;
    const cost = choiceCost(level, choice);
    if (!best || cost < best.cost || (cost === best.cost && a.LI < best.analysis.LI)) best = { choice, cost, job, analysis: a };
  }
  return best;
}

/** Stars: 3 = cheapest possible fix, 2 = fixed for a bit more, 1 = fixed, 0 = still above 1 or over budget. */
export function starsFor(result, best) {
  if (!result.analysis.ok || !result.withinBudget) return 0;
  if (result.cost <= best.cost) return 3;
  if (result.cost <= best.cost * 1.25) return 2;
  return 1;
}

const usd = (x) => `$${x.toLocaleString("en-US")}`;

/** A lift rate in words: "3 lifts per minute", "1 lift every 2 minutes". */
export function rateText(F) {
  if (F >= 1) return `${F} lift${F === 1 ? "" : "s"} per minute`;
  return `1 lift every ${Math.round(1 / F)} minutes`;
}
const pick50 = (rng, lo, hi) => 50 * rng.int(Math.round(lo / 50), Math.round(hi / 50));

const SCENES = {
  warmup: { item: "bags of calf feed", from: "a pallet on the floor", to: "a high shelf" },
  pace: { item: "cartons of bottled sunflower oil", from: "a low conveyor", to: "a shipping pallet" },
  reach: { item: "boxes of bolts", from: "the far side of a deep bin", to: "a workbench shelf" },
  heavy: { item: "sacks of seed", from: "a pallet on the floor", to: "a hopper platform" },
  tight: { item: "crates of machine parts", from: "a floor pallet", to: "a rack" },
};

function factor(id, name, symbol, options) {
  // Drop any option that would leave the job exactly as it is (for example
  // "twist 30°" when the job already twists 30°).
  const asIs = JSON.stringify(options[0].set);
  return { id, name, symbol, options: options.filter((o, i) => i === 0 || JSON.stringify(o.set) !== asIs) };
}

/** Draw one candidate job for a level kind. Constraints are checked by generateLevel(). */
function draft(rng, kind) {
  const base = { load: 12, H: 55, V: 20, Vdest: 150, A: 60, F: 2, duration: "long", coupling: "fair" };
  const factors = [];

  const reach = (h0, costs) =>
    factor("reach", "Reach", "H", [
      { label: `As is: load ${h0} cm from the ankles`, cost: 0, set: { H: h0 } },
      { label: "Pallet turntable: load 45 cm away", cost: costs[0], set: { H: 45 } },
      { label: "Turntable and tilt stand: load 30 cm away", cost: costs[1], set: { H: 30 } },
    ]);
  const origin = (v0, costs) =>
    factor("origin", "Pick-up height", "V", [
      { label: `As is: hands start ${v0} cm above the floor`, cost: 0, set: { V: v0 } },
      { label: "Pallet stand: hands start at 50 cm", cost: costs[0], set: { V: 50 } },
      { label: "Lift table: hands start at 75 cm", cost: costs[1], set: { V: 75 } },
    ]);
  const dest = (v0, costs) =>
    factor("dest", "Set-down height", "D", [
      { label: `As is: set down at ${v0} cm`, cost: 0, set: { Vdest: v0 } },
      { label: "Lower shelf: set down at 120 cm", cost: costs[0], set: { Vdest: 120 } },
      { label: "Waist-high roller table: set down at 90 cm", cost: costs[1], set: { Vdest: 90 } },
    ]);
  const twist = (a0, costs) =>
    factor("twist", "Twist", "A", [
      { label: `As is: twist ${a0}°`, cost: 0, set: { A: a0 } },
      { label: "Angle the shelf: twist 30°", cost: costs[0], set: { A: 30 } },
      { label: "Shelf straight ahead: no twist", cost: costs[1], set: { A: 0 } },
    ]);
  const rate = (f0, steps, costs) =>
    factor("rate", "Pace", "F", [
      { label: `As is: ${rateText(f0)}`, cost: 0, set: { F: f0 } },
      ...steps.map((f, i) => ({ label: `${i === 0 ? "Share the job" : "Add a second lifter"}: ${rateText(f)}`, cost: costs[i], set: { F: f } })),
    ]);
  const hours = (d0, costs) => {
    const start = DURATIONS.findIndex((d) => d.id === d0);
    const opts = [{ label: `As is: lifting for ${DURATIONS[start].label}`, cost: 0, set: { duration: d0 } }];
    if (start > 1) opts.push({ label: "Rotate jobs: lifting for 1 to 2 hours", cost: costs[0], set: { duration: "moderate" } });
    opts.push({ label: "Rotate jobs: lifting for 1 hour or less", cost: costs[start > 1 ? 1 : 0], set: { duration: "short" } });
    return factor("hours", "Hours of lifting", "F", opts);
  };
  const grip = (c0, costs) => {
    const opts = [{ label: `As is: ${c0} grip`, cost: 0, set: { coupling: c0 } }];
    if (c0 === "poor") opts.push({ label: "Cut hand-holds: fair grip", cost: costs[0], set: { coupling: "fair" } });
    opts.push({ label: "Totes with handles: good grip", cost: costs[c0 === "poor" ? 1 : 0], set: { coupling: "good" } });
    return factor("grip", "Grip", "C", opts);
  };
  const load = (kg, cost) =>
    factor("load", "Load", "L", [
      { label: `As is: ${kg} kg each`, cost: 0, set: { load: kg } },
      { label: `Half-size packs: ${kg / 2} kg each, twice as many lifts`, cost, set: { load: kg / 2 }, lifts: 2 },
    ]);

  if (kind === "warmup") {
    Object.assign(base, { load: rng.int(9, 12), H: rng.pick([45, 50, 55]), V: rng.pick([15, 20, 25]), Vdest: rng.pick([140, 150, 160]), A: rng.pick([30, 45, 60]), F: rng.pick([1, 2]), duration: "moderate", coupling: "fair" });
    factors.push(
      reach(base.H, [pick50(rng, 250, 350), pick50(rng, 600, 750)]),
      origin(base.V, [pick50(rng, 150, 250), pick50(rng, 650, 850)]),
      dest(base.Vdest, [pick50(rng, 100, 200), pick50(rng, 350, 500)]),
      twist(base.A, [pick50(rng, 50, 100), pick50(rng, 200, 300)]),
      rate(base.F, base.F === 2 ? [1, 0.5] : [0.5, 0.2], [pick50(rng, 400, 550), pick50(rng, 900, 1100)]),
      grip(base.coupling, [pick50(rng, 100, 200)]),
    );
  } else if (kind === "pace") {
    // A fast, all-shift job from a low pick-up point. The floor-level start
    // looks like the problem, but slowing down or rotating is what pays.
    Object.assign(base, { load: rng.int(7, 10), H: rng.pick([35, 40]), V: rng.pick([20, 30]), Vdest: rng.pick([90, 100]), A: rng.pick([0, 30]), F: rng.pick([5, 6, 7]), duration: "long", coupling: "good" });
    factors.push(
      origin(base.V, [pick50(rng, 300, 400), pick50(rng, 800, 1000)]),
      factor("reach", "Reach", "H", [
        { label: `As is: load ${base.H} cm from the ankles`, cost: 0, set: { H: base.H } },
        { label: "Tilt stand: load 30 cm away", cost: pick50(rng, 400, 550), set: { H: 30 } },
      ]),
      rate(base.F, [base.F - 2, Math.max(2, base.F - 4)], [pick50(rng, 250, 350), pick50(rng, 600, 750)]),
      hours("long", [pick50(rng, 200, 300), pick50(rng, 450, 600)]),
    );
  } else if (kind === "reach") {
    // A slow job with a long reach and a low start. Raising the pick-up point
    // or slowing down costs a lot and gains little; bringing the load close pays.
    Object.assign(base, { load: rng.int(11, 14), H: rng.pick([58, 60, 63]), V: rng.pick([30, 40]), Vdest: rng.pick([110, 120]), A: rng.pick([30, 45]), F: rng.pick([0.5, 1]), duration: rng.pick(["moderate", "short"]), coupling: "fair" });
    factors.push(
      origin(base.V, [pick50(rng, 250, 350), pick50(rng, 700, 900)]),
      factor("reach", "Reach", "H", [
        { label: `As is: load ${base.H} cm from the ankles`, cost: 0, set: { H: base.H } },
        { label: "Slide-out tray: load 40 cm away", cost: pick50(rng, 200, 300), set: { H: 40 } },
        { label: "Tray and cut-away bin front: load 30 cm away", cost: pick50(rng, 450, 600), set: { H: 30 } },
      ]),
      twist(base.A, [pick50(rng, 100, 150), pick50(rng, 250, 350)]),
      rate(base.F, base.F === 1 ? [0.5, 0.2] : [0.2], [pick50(rng, 500, 650), pick50(rng, 1000, 1200)]),
      grip(base.coupling, [pick50(rng, 150, 250)]),
    );
  } else if (kind === "heavy") {
    // Heavier than the 23 kg load constant, so no multiplier can rescue it.
    const kg = rng.pick([26, 28, 30, 32]);
    Object.assign(base, { load: kg, H: rng.pick([35, 40]), V: rng.pick([25, 40]), Vdest: rng.pick([90, 100]), A: 0, F: rng.pick([0.5, 1]), duration: rng.pick(["short", "moderate"]), coupling: "poor" });
    factors.push(
      load(kg, pick50(rng, 300, 450)),
      factor("reach", "Reach", "H", [
        { label: `As is: load ${base.H} cm from the ankles`, cost: 0, set: { H: base.H } },
        { label: "Pallet turntable: load 30 cm away", cost: pick50(rng, 300, 400), set: { H: 30 } },
      ]),
      origin(base.V, [pick50(rng, 150, 250), pick50(rng, 600, 800)]),
      hours(base.duration, [pick50(rng, 200, 300), pick50(rng, 450, 600)]),
      grip("poor", [pick50(rng, 50, 100), pick50(rng, 200, 300)]),
    );
  } else {
    // tight: everything is a little wrong and the budget fits only the best mix.
    Object.assign(base, { load: rng.int(9, 13), H: rng.pick([45, 50, 55]), V: rng.pick([15, 25]), Vdest: rng.pick([130, 140, 150]), A: rng.pick([30, 45, 60]), F: rng.pick([2, 3]), duration: "long", coupling: "poor" });
    factors.push(
      reach(base.H, [pick50(rng, 250, 400), pick50(rng, 550, 800)]),
      origin(base.V, [pick50(rng, 150, 300), pick50(rng, 600, 850)]),
      dest(base.Vdest, [pick50(rng, 100, 200), pick50(rng, 300, 450)]),
      twist(base.A, [pick50(rng, 50, 150), pick50(rng, 200, 300)]),
      rate(base.F, [Math.max(1, base.F - 2), base.F <= 2 ? 0.5 : 1].filter((v, i, a) => a.indexOf(v) === i), [pick50(rng, 300, 450), pick50(rng, 700, 900)]),
      hours("long", [pick50(rng, 200, 350), pick50(rng, 500, 650)]),
      grip("poor", [pick50(rng, 50, 100), pick50(rng, 150, 250)]),
    );
  }
  // A factor with nothing left to change (already at its best) is left out.
  const level = { kind, base, factors: factors.filter((f) => f.options.length > 1), budget: Infinity, scene: SCENES[kind] };
  return level;
}

const changed = (level, choice, id) => {
  const i = level.factors.findIndex((f) => f.id === id);
  return i >= 0 && choice[i] > 0;
};

/** Does a drafted level teach what its kind promises? Sets the budget when it does. */
function accept(level) {
  const before = analyze(level.base);
  if (before.li < 1.25) return false;
  const best = cheapestFix(level);
  if (!best) return false;
  const most = level.factors.reduce((s, f) => s + Math.max(...f.options.map((o) => o.cost)), 0);
  const up50 = (x) => 50 * Math.ceil(x / 50);
  const nChanges = best.choice.filter((c) => c > 0).length;
  const only = (ids) => cheapestFix(level, (c) => level.factors.every((f, i) => c[i] === 0 || ids.includes(f.id)));

  if (level.kind === "warmup") {
    if (nChanges < 1 || nChanges > 2) return false;
    level.budget = up50(Math.max(best.cost * 2, most * 0.4));
  } else if (level.kind === "pace") {
    if (!(changed(level, best.choice, "rate") || changed(level, best.choice, "hours"))) return false;
    if (changed(level, best.choice, "origin")) return false;
    const geometry = only(["origin", "reach"]);
    if (geometry && geometry.cost <= best.cost * 1.5) return false;
    level.budget = up50(best.cost * 1.5 + 100);
  } else if (level.kind === "reach") {
    if (!changed(level, best.choice, "reach")) return false;
    if (changed(level, best.choice, "rate") || changed(level, best.choice, "origin")) return false;
    const noReach = cheapestFix(level, (c) => !changed(level, c, "reach"));
    if (noReach && noReach.cost <= best.cost * 1.5) return false;
    level.budget = up50(best.cost * 1.5 + 100);
  } else if (level.kind === "heavy") {
    if (level.base.load <= LC) return false;
    if (nChanges < 2 || nChanges > 3) return false;
    level.budget = up50(best.cost * 1.3 + 50);
  } else {
    // Tight means tight: the budget is the cheapest fix plus $50.
    if (nChanges < 3 || nChanges > 4) return false;
    level.budget = best.cost + 50;
  }
  if (level.budget >= most) return false; // "buy everything" must never be an answer
  level.best = best;
  level.before = before;
  return true;
}

/**
 * Generate one job for a level. Drafts are drawn from the seeded generator
 * until one passes the level's checks, so every seed gives a fair puzzle.
 */
export function generateLevel(rng, spec) {
  for (let tries = 0; tries < 400; tries++) {
    const level = draft(rng, spec.kind);
    if (accept(level)) return { ...level, tries: tries + 1 };
  }
  throw new Error(`Lift Lab: no valid job found for level kind "${spec.kind}"`);
}

/** One-sentence description of the job as the player finds it. */
export function describeJob(level) {
  const b = level.base;
  const d = DURATIONS.find((x) => x.id === b.duration);
  return `A worker lifts ${b.load} kg ${level.scene.item} from ${level.scene.from} to ${level.scene.to}, at ${rateText(b.F)}, for ${d.label} a day.`;
}

/**
 * The model's simplifying assumptions, shown on the intro and results screens.
 * Numbers come from the constants above so the text can't drift from the code.
 */
export const ASSUMPTIONS = [
  `Uses the revised NIOSH lifting equation (1991) with a load constant of ${LC} kg.`,
  "Lifting and lowering only, with two hands, standing, in an unrestricted posture. No carrying, pushing, pulling, holding, one-handed, seated or kneeling lifts.",
  "Smooth lifts, not jerky. A moderate-width load (75 cm or less), good footing and grip friction, and a comfortable environment.",
  "Inputs are the six multipliers: horizontal distance, vertical height, travel distance, asymmetry, frequency (with work duration) and coupling. Only one task is analyzed at a time; there is no composite index across tasks.",
  "The lift is analyzed where it starts (the origin). The set-down point only changes the travel distance, as if the load needs no careful placing at the end.",
  `Lift rates are rows of the NIOSH frequency table (${FM_RATES[0]} to ${FM_RATES[FM_RATES.length - 1]} lifts per minute). Hours of lifting are read as one of three bands: ${DURATIONS.map((d) => d.label).join(", ")}. Rest breaks between lifting spells aren't modeled.`,
  `Lifting Index = load ÷ recommended weight limit, rounded to two decimals. An index of ${LI_LIMIT} or less is taken as safe for nearly all healthy workers. Above ${LI_LIMIT}, risk rises.`,
  "Redesign options and their prices are made up for the game. You may pick one option per factor, their costs add up, and each changes only its own input. The one exception is half-size packs, which also double the lifts per minute.",
  "The benchmark is the cheapest set of options that brings the Lifting Index to 1 or less, found by checking every combination.",
];

export { usd };
