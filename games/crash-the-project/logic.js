// Pure logic for Crash the Project: critical path method (CPM), the cost of a
// crashed schedule, and the true minimum-cost schedule and time-cost curve
// found by checking every combination of crash days. No DOM access.

const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;
export { usd };

export const COST_STEP = 50; // every cost per day is a multiple of this
export const MAX_COMBINATIONS = 150000; // cap on crash combinations, so the exhaustive search stays instant

// Networks are fixed drawings (col, row place the boxes); the numbers are drawn per round.
const NETWORKS = {
  line: {
    project: "Install a new packaging machine",
    acts: [
      { id: "A", name: "Plan the layout", preds: [], col: 0, row: 0.5 },
      { id: "B", name: "Order the machine", preds: ["A"], col: 1, row: 0 },
      { id: "C", name: "Train operators", preds: ["A"], col: 1.5, row: 1 },
      { id: "D", name: "Install the machine", preds: ["B"], col: 2, row: 0 },
      { id: "E", name: "Test run", preds: ["C", "D"], col: 3, row: 0.5 },
    ],
  },
  launch: {
    project: "Launch a new product",
    acts: [
      { id: "A", name: "Finalize the design", preds: [], col: 0, row: 1 },
      { id: "B", name: "Build tooling", preds: ["A"], col: 1, row: 0.5 },
      { id: "C", name: "Order materials", preds: ["A"], col: 1, row: 1.5 },
      { id: "D", name: "Set up the line", preds: ["B"], col: 2, row: 0 },
      { id: "E", name: "Make first parts", preds: ["B", "C"], col: 2, row: 1 },
      { id: "F", name: "Print packaging", preds: ["C"], col: 2, row: 2 },
      { id: "G", name: "Ship first order", preds: ["D", "E", "F"], col: 3, row: 1 },
    ],
  },
  move: {
    project: "Move into a new warehouse",
    acts: [
      { id: "A", name: "Plan the layout", preds: [], col: 0, row: 0.5 },
      { id: "B", name: "Hire the crew", preds: [], col: 0, row: 1.5 },
      { id: "C", name: "Order racks", preds: ["A"], col: 1, row: 0 },
      { id: "D", name: "Clear the floor", preds: ["A", "B"], col: 1, row: 1 },
      { id: "E", name: "Train the crew", preds: ["B"], col: 1, row: 2 },
      { id: "F", name: "Install racks", preds: ["C", "D"], col: 2, row: 0.5 },
      { id: "G", name: "Move the stock", preds: ["D", "E"], col: 2, row: 1.5 },
      { id: "H", name: "Final audit", preds: ["F", "G"], col: 3, row: 1 },
    ],
  },
  plant: {
    project: "Expand the plant",
    acts: [
      { id: "A", name: "Get permits", preds: [], col: 0, row: 1 },
      { id: "B", name: "Pour foundation", preds: ["A"], col: 1, row: 0 },
      { id: "C", name: "Order equipment", preds: ["A"], col: 1, row: 1 },
      { id: "D", name: "Hire staff", preds: ["A"], col: 1, row: 2 },
      { id: "E", name: "Build walls", preds: ["B"], col: 2, row: 0 },
      { id: "F", name: "Install equipment", preds: ["B", "C"], col: 2, row: 1 },
      { id: "G", name: "Train staff", preds: ["D"], col: 2, row: 2 },
      { id: "H", name: "Inspect building", preds: ["E", "F"], col: 3, row: 0.5 },
      { id: "I", name: "Trial production", preds: ["F", "G"], col: 3, row: 1.5 },
    ],
  },
};

export const LEVELS = [
  { id: "1", name: "One long path", blurb: "5 activities", network: "line", dur: [3, 8], cost: [100, 700], indirect: [300, 500] },
  { id: "2", name: "Parallel paths", blurb: "7 activities", network: "launch", dur: [3, 9], cost: [100, 800], indirect: [350, 550] },
  { id: "3", name: "Deadline", blurb: "8 activities, late penalty", network: "move", dur: [3, 9], cost: [100, 900], indirect: [150, 300], penalty: [400, 800], late: [2, 4] },
  { id: "4", name: "Big build", blurb: "9 activities, late penalty", network: "plant", dur: [3, 9], cost: [100, 900], indirect: [150, 300], penalty: [400, 800], late: [3, 5] },
];

/** The model's simplifying assumptions, shown on the intro and results screens. */
export const ASSUMPTIONS = [
  "Activity durations are known and fixed. Every link is finish-to-start: an activity can begin as soon as every activity before it is finished.",
  "Each activity can be shortened between its normal and crash times, in whole days, at a constant cost per day (linear time-cost trade-off).",
  `Indirect cost (overhead) is a fixed amount per project day. In deadline levels (${LEVELS.filter((l) => l.penalty)
    .map((l) => l.id)
    .join(" and ")}), every day past the deadline also costs a fixed late penalty. There is no bonus for finishing early.`,
  "Resources are unlimited, and crashing one activity doesn't change any other activity.",
  "Project length is the longest (critical) path. Only crashing critical activities shortens the project, and new critical paths can appear as you crash.",
  "Costs count only what your choices change: crash cost, indirect cost, and late penalty. The normal cost of the activities is the same in every plan, so it is left out.",
  "The benchmark is the true minimum total cost, found by checking every possible combination of crash days.",
];

// ---- Critical path method --------------------------------------------------

/** Index of each activity id, and a check that predecessors are listed before successors. */
function indexOf(acts) {
  const idx = new Map(acts.map((a, i) => [a.id, i]));
  acts.forEach((a, i) =>
    a.preds.forEach((p) => {
      if (!(idx.get(p) < i)) throw new Error(`activity ${a.id} must come after its predecessor ${p}`);
    }),
  );
  return idx;
}

/**
 * Forward and backward pass. `durations[i]` is the duration of acts[i].
 * Returns earliest/latest start and finish, slack, the critical flags, and the project duration.
 */
export function schedule(acts, durations) {
  const idx = indexOf(acts);
  const n = acts.length;
  const es = new Array(n).fill(0);
  const ef = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    es[i] = Math.max(0, ...acts[i].preds.map((p) => ef[idx.get(p)]));
    ef[i] = es[i] + durations[i];
  }
  const duration = Math.max(...ef);
  const lf = new Array(n).fill(duration);
  const ls = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    ls[i] = lf[i] - durations[i];
    for (const p of acts[i].preds) {
      const j = idx.get(p);
      lf[j] = Math.min(lf[j], ls[i]);
    }
  }
  const slack = es.map((v, i) => ls[i] - v);
  return { es, ef, ls, lf, slack, critical: slack.map((s) => s === 0), duration };
}

/** Every start-to-finish path, as arrays of activity indices. */
export function enumeratePaths(acts) {
  const idx = indexOf(acts);
  const succ = acts.map(() => []);
  acts.forEach((a, i) => a.preds.forEach((p) => succ[idx.get(p)].push(i)));
  const paths = [];
  const walk = (i, path) => {
    const next = [...path, i];
    if (!succ[i].length) paths.push(next);
    else succ[i].forEach((j) => walk(j, next));
  };
  acts.forEach((a, i) => {
    if (!a.preds.length) walk(i, []);
  });
  return paths;
}

// ---- Costs -----------------------------------------------------------------

/** Indirect cost plus late penalty of finishing in `duration` days. */
export function timeCost(project, duration) {
  const late = project.deadline == null ? 0 : Math.max(0, duration - project.deadline);
  return { indirect: project.indirect * duration, penalty: late * (project.penalty || 0), late };
}

/** What one more day of project length costs when the project lasts `duration` days. */
export function savingPerDay(project, duration) {
  const a = timeCost(project, duration);
  const b = timeCost(project, duration - 1);
  return a.indirect + a.penalty - b.indirect - b.penalty;
}

/** Keep a crash plan inside each activity's limits (whole days between 0 and maxCrash). */
export function clampCrash(project, crash) {
  return project.acts.map((a, i) => Math.max(0, Math.min(a.maxCrash, Math.round(crash[i] || 0))));
}

/** Schedule and cost of a crash plan. crash[i] = days bought off activity i. */
export function evaluate(project, crashPlan) {
  const { acts } = project;
  const crash = clampCrash(project, crashPlan);
  const durations = acts.map((a, i) => a.normal - crash[i]);
  const s = schedule(acts, durations);
  const crashCost = acts.reduce((sum, a, i) => sum + crash[i] * a.costPerDay, 0);
  const t = timeCost(project, s.duration);
  const paths = enumeratePaths(acts).map((p) => {
    const length = p.reduce((sum, i) => sum + durations[i], 0);
    return { ids: p.map((i) => acts[i].id), length, critical: length === s.duration };
  });
  return { ...s, crash, durations, crashCost, ...t, total: crashCost + t.indirect + t.penalty, paths };
}

/**
 * Check every combination of crash days. Returns the cheapest plan, the
 * normal plan, the all-out plan, and the time-cost curve: for each possible
 * project duration, the cheapest way to reach it.
 */
export function solve(project) {
  const { acts } = project;
  const n = acts.length;
  const paths = enumeratePaths(acts);
  const crash = new Array(n).fill(0);
  const cheapest = new Map(); // duration -> { crashCost, crash }
  for (;;) {
    let duration = 0;
    for (const p of paths) {
      let len = 0;
      for (const i of p) len += acts[i].normal - crash[i];
      if (len > duration) duration = len;
    }
    let cost = 0;
    for (let i = 0; i < n; i++) cost += crash[i] * acts[i].costPerDay;
    const seen = cheapest.get(duration);
    if (!seen || cost < seen.crashCost) cheapest.set(duration, { crashCost: cost, crash: crash.slice() });
    // Next combination (like an odometer).
    let k = 0;
    while (k < n && crash[k] === acts[k].maxCrash) crash[k++] = 0;
    if (k === n) break;
    crash[k] += 1;
  }
  const curve = [...cheapest.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([duration, c]) => {
      const t = timeCost(project, duration);
      return { duration, crashCost: c.crashCost, crash: c.crash, indirect: t.indirect, penalty: t.penalty, total: c.crashCost + t.indirect + t.penalty };
    });
  // Cheapest total; a tie goes to the plan with fewer crash dollars (the longer one).
  const best = curve.reduce((a, b) => (b.total < a.total || (b.total === a.total && b.crashCost < a.crashCost) ? b : a));
  return { best, curve, normal: curve[curve.length - 1], allOut: curve[0], minDuration: curve[0].duration };
}

/** Number of crash combinations the exhaustive search has to check. */
export function combinations(project) {
  return project.acts.reduce((m, a) => m * (a.maxCrash + 1), 1);
}

/**
 * The step-by-step logic of crashing: for each day taken off the project, what
 * the cheapest way costs and what that day saves. Starts at the normal length.
 */
export function marginalSteps(project, curve) {
  const steps = [];
  for (let k = curve.length - 1; k > 0; k--) {
    const from = curve[k];
    const to = curve[k - 1];
    const days = from.duration - to.duration;
    const saves = from.indirect + from.penalty - to.indirect - to.penalty;
    const costs = to.crashCost - from.crashCost;
    steps.push({ from: from.duration, to: to.duration, days, costs, saves, worth: costs < saves });
  }
  return steps;
}

/** Stars: 3 = minimum total cost, 2 = most of the possible saving, 1 = some saving, 0 = no better than not crashing. */
export function starsFor(youTotal, bestTotal, normalTotal) {
  if (youTotal <= bestTotal) return 3;
  const possible = normalTotal - bestTotal;
  const got = normalTotal - youTotal;
  if (possible > 0 && got / possible >= 0.7) return 2;
  return got > 0 ? 1 : 0;
}

// ---- Round generation ------------------------------------------------------

const roundTo = (x, step) => Math.round(x / step) * step;
const stepped = (rng, [lo, hi]) => roundTo(rng.int(lo, hi), COST_STEP);

function draw(rng, level) {
  const net = NETWORKS[level.network];
  const acts = net.acts.map((a) => {
    const normal = rng.int(level.dur[0], level.dur[1]);
    const maxCrash = Math.max(0, Math.min(normal - 2, rng.pick([0, 1, 1, 2, 2, 3])));
    return { ...a, normal, maxCrash, crashTime: normal - maxCrash, costPerDay: stepped(rng, level.cost) };
  });
  const project = { name: net.project, acts, indirect: stepped(rng, level.indirect), deadline: null, penalty: 0 };
  if (level.penalty) {
    const normalDuration = schedule(acts, acts.map((a) => a.normal)).duration;
    project.deadline = normalDuration - rng.int(level.late[0], level.late[1]);
    project.penalty = stepped(rng, level.penalty);
  }
  return project;
}

/** Does a drawn project teach what its level is meant to teach? */
export function fitsLevel(project, level, solved = solve(project)) {
  if (combinations(project) > MAX_COMBINATIONS) return false;
  const { best, normal, minDuration } = solved;
  const zero = project.acts.map(() => 0);
  const before = evaluate(project, zero);
  const after = evaluate(project, best.crash);
  const crashDays = best.crash.reduce((a, b) => a + b, 0);
  const crashedActs = best.crash.filter((c) => c > 0).length;
  if (normal.total - best.total < 300 || crashedActs < 2) return false;
  const criticalBefore = before.paths.filter((p) => p.critical).length;
  const criticalAfter = after.paths.filter((p) => p.critical).length;
  if (criticalBefore !== 1) return false; // start from one clear critical path
  // Some critical activity must be too expensive to be worth crashing all the way.
  const leftAlone = project.acts.some((a, i) => after.critical[i] && best.crash[i] < a.maxCrash);
  if (!leftAlone) return false;
  const usedNonCritical = best.crash.some((c, i) => c > 0 && !before.critical[i]);
  if (level.network === "line") {
    // One path stays the only critical path: no crashing off the original path is ever needed.
    return crashDays >= 2 && !usedNonCritical && criticalAfter === 1;
  }
  if (criticalAfter < 2 || !usedNonCritical) return false; // a second path must become critical and need crashing
  if (level.penalty) return crashDays >= 4 && minDuration <= project.deadline && best.duration < before.duration - 1;
  return crashDays >= 3;
}

/** Generate one project for a level (redrawn until it fits the level's lesson). */
export function generateProject(rng, level) {
  let project = draw(rng, level);
  for (let k = 0; k < 3000 && !fitsLevel(project, level); k++) project = draw(rng, level);
  return project;
}
